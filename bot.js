'use strict';
var Telegraf=require('telegraf').Telegraf;
var express=require('express');
var Groq=require('groq-sdk');
var fs=require('fs');
var path=require('path');
var BOT_TOKEN=process.env.BOT_TOKEN;
var GROQ_API_KEY=process.env.GROQ_API_KEY;
var WEBHOOK_URL=(process.env.WEBHOOK_URL||'').trim();
var PORT=process.env.PORT||3000;
var CA='';
var CHART='https://dexscreener.com/bsc/';
var BUY='https://pancakeswap.finance/swap?outputCurrency=';
var TWITTER='https://x.com/Mpc_cto';
var WEBSITE='';
var E={rocket:'\u{1F680}',fire:'\u{1F525}',chart:'\u{1F4C8}',lock:'\u{1F512}',check:'\u2705',zap:'\u26A1',gem:'\u{1F48E}',star:'\u2B50',money:'\u{1F4B0}',shield:'\u{1F6E1}',wave:'\u{1F44B}',dash:'\u2014',copy:'\u{1F4CB}'};
var bot=new Telegraf(BOT_TOKEN);
var app=express();
var groq=new Groq({apiKey:GROQ_API_KEY});
app.use(express.json());
var caUnlocked=false,groupChatId=null,silenceTimer=null;
var IS_CTO=true;
var imageMessages=new Map(),strikes=new Map(),spamTracker=new Map(),stickerTracker=new Map();
var lastReplies=[],MAX_REPLY_HIST=12;
var IMG=path.join(__dirname,'siren.jpg');
var SILENCE_DELAY=10*60*1000,STRIKE_RESET=86400000,SPAM_WINDOW=60000,SPAM_MAX=5;
function systemPrompt(withCa){
  var facts=[
    'You are the community bot for $Mpc, a BNB Smart Chain (BSC) meme token.',
    'Token: $Mpc ($Mpc) | Chain: BNB Smart Chain (BSC)',
    'Supply: N/A | Max Wallet: N/A',
    'Tax: 0% buy / 0% sell',
    'Contract: RENOUNCED | LP: LOCKED',
    'Dev is ACTIVE. Never say or imply otherwise.',
    'Twitter: '+TWITTER,
  ];
  if(withCa)facts.push('CA: '+CA+' | Chart: '+CHART+' | Buy on PancakeSwap: '+BUY);
  var s=facts.join('\n')+'\n';
  s+='\nNARRATIVE: '+""+'\n';
  s+='RULES: Keep replies concise and professional. 2-4 lines max. Never write essays. Vary every reply. Sound natural, not robotic. NEVER share TG group link. NEVER put emoji next to CA. NEVER repeat the same reply. If message is hype, casual with no question, or needs no answer: reply exactly IGNORE';
  return s;
}
async function askGroq(sys,msg){var r=await groq.chat.completions.create({model:'llama-3.3-70b-versatile',temperature:1.0,max_tokens:160,messages:[{role:'system',content:sys},{role:'user',content:msg}]});return r.choices[0].message.content.trim();}
function isDupe(r){return lastReplies.includes(r);}
function recordReply(r){lastReplies.push(r);if(lastReplies.length>MAX_REPLY_HIST)lastReplies.shift();}
async function smartAsk(sys,p){var r=await askGroq(sys,p);if(isDupe(r))r=await askGroq(sys,p+' Completely different from before.');recordReply(r);return r;}
async function deletePrevImage(chatId){var mid=imageMessages.get(chatId);if(mid){try{await bot.telegram.deleteMessage(chatId,mid);}catch(_){}imageMessages.delete(chatId);}}
var IMG_BUF=null;try{if(fs.existsSync(IMG))IMG_BUF=fs.readFileSync(IMG);}catch(_){}
async function sendImage(chatId,caption,extra){await deletePrevImage(chatId);extra=extra||{};if(IMG_BUF){try{var m=await bot.telegram.sendPhoto(chatId,{source:IMG_BUF},Object.assign({caption:caption,parse_mode:'HTML'},extra));imageMessages.set(chatId,m.message_id);return m;}catch(e){console.error('img:',e.message);IMG_BUF=null;}}return bot.telegram.sendMessage(chatId,caption,Object.assign({parse_mode:'HTML'},extra));}
function autoDelete(chatId,msgId,delay){setTimeout(function(){try{bot.telegram.deleteMessage(chatId,msgId);}catch(_){}},delay);}
async function isAdmin(ctx,uid){var t=ctx.chat&&ctx.chat.type;if(t!=='group'&&t!=='supergroup')return false;try{var m=await ctx.telegram.getChatMember(ctx.chat.id,uid);return m.status==='administrator'||m.status==='creator';}catch(_){return false;}}
function getStrike(uid){var now=Date.now(),s=strikes.get(uid);if(!s||now-s.since>STRIKE_RESET){s={count:0,since:now};strikes.set(uid,s);}return s;}
async function applyStrike(ctx,uid,reason){var s=getStrike(uid);s.count++;try{await ctx.deleteMessage();}catch(_){}var why=reason?' ('+reason+')':'';if(s.count>=3){s.count=0;try{await ctx.telegram.restrictChatMember(ctx.chat.id,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+300});}catch(_){}var m3=await ctx.reply('\u26A0\uFE0F Muted 5 min \u2014 3 strikes'+why+'.');autoDelete(ctx.chat.id,m3.message_id,12000);}else{var m=await ctx.reply('\u26A0\uFE0F Warning '+s.count+'/3'+why);autoDelete(ctx.chat.id,m.message_id,10000);}}
async function checkSpam(ctx,uid){var now=Date.now(),t=spamTracker.get(uid)||{count:0,since:now};if(now-t.since>SPAM_WINDOW)t={count:0,since:now};t.count++;spamTracker.set(uid,t);if(t.count>SPAM_MAX){try{await ctx.telegram.restrictChatMember(ctx.chat.id,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+300});}catch(_){}var m=await ctx.reply('Muted 5 min for spam.');autoDelete(ctx.chat.id,m.message_id,15000);return true;}return false;}
var FUD=['rug','rugpull','scam','ponzi','honeypot','shit','fuck','bitch','bastard','asshole','cunt','retard','idiot','dump','dumping','dead','worthless','trash','garbage','fake','fraud','exit scam','dev ran','dev is gone','abandoned'];
function hasFud(t){var l=t.toLowerCase();return FUD.some(function(w){return l.includes(w);});}
function hasBlockedLink(t){var u=t.match(/https?:\/\/[^\s]+/g)||[];return u.some(function(x){return!x.includes('x.com')&&!x.includes('twitter.com');});}
function hasExtMention(t){if(!t)return false;var mm=t.match(/@[a-zA-Z0-9_]+/g)||[];if(mm.length>1)return true;if(mm.length===1){var s=t.indexOf(mm[0]);if(s>0)return true;}return false;}
var notLiveMsgs=['$Mpc hasn\u2019t launched yet. CA coming soon.','Hold tight \u2014 the drop is close.','Not yet. Stay ready.','CA drops soon.'];
var caPrompts=['2 sharp lines. Why $Mpc right now. No CA.','2 lines. $Mpc fundamentals: renounced, locked LP. No CA.','2 lines. Early opportunity in $Mpc. No CA.','2 lines. What makes $Mpc worth holding. No CA.','2 lines. $Mpc built for the long game. No CA.'];
var caPromptIdx=0;
async function buildCaCaption(){var p=caPrompts[caPromptIdx%caPrompts.length];caPromptIdx++;var ai=await smartAsk(systemPrompt(true),p);return ai+'\n\n'+CA+'\n\n'+E.lock+' RENOUNCED '+E.check+' LP LOCKED';}
var xPrompts=['1 line. $Mpc on Twitter. Real energy. No hashtags.','1 sharp line. Follow $Mpc on X.','1 line. $Mpc Twitter is worth following.','1 line. Why $Mpc X matters right now.'];
var xPromptIdx=0;
async function buildXCaption(){var p=xPrompts[xPromptIdx%xPrompts.length];xPromptIdx++;var ai=await smartAsk(systemPrompt(false),p);return ai+'\n\n'+TWITTER;}
var socialsIdx=0;
function buildSocialsMsg(){var i=socialsIdx%3;socialsIdx++;var web=WEBSITE?'\n\u{1F310} <a href=\''+WEBSITE+'\'>Website</a>':'';if(i===0)return'<b>$Mpc</b>\n<a href=\''+CHART+'\'>Chart</a> | <a href=\''+BUY+'\'>PancakeSwap</a> | <a href=\''+TWITTER+'\'>Twitter</a>'+web;if(i===1)return E.chart+' <a href=\''+CHART+'\'>Chart</a>  '+E.money+' <a href=\''+BUY+'\'>PancakeSwap</a>  <a href=\''+TWITTER+'\'>Twitter/X</a>'+web;return'<a href=\''+CHART+'\'>DexScreener</a>  <a href=\''+BUY+'\'>PancakeSwap</a>  <a href=\''+TWITTER+'\'>X</a>'+(WEBSITE?' <a href=\''+WEBSITE+'\'>Site</a>':'');}
var silenceAngles=['2-3 lines. Why hold $Mpc now.','2-3 lines. Being early to $Mpc.','2-3 lines. $Mpc built clean: renounced, locked, low tax.','2-3 lines. What $Mpc holders know that others don\u2019t.','2-3 lines. $Mpc community is building quietly.','2-3 lines. The move in $Mpc is still early.'];
var silenceIdx=0;
async function fireSilenceBreaker(){if(!groupChatId){resetSilence();return;}try{var p=silenceAngles[silenceIdx%silenceAngles.length];silenceIdx++;var cap=await smartAsk(systemPrompt(caUnlocked),p);await sendImage(groupChatId,cap,{});}catch(_){}resetSilence();}
function resetSilence(){if(silenceTimer)clearTimeout(silenceTimer);silenceTimer=setTimeout(fireSilenceBreaker,SILENCE_DELAY);}
bot.on('new_chat_members',async function(ctx){if(ctx.message.new_chat_members.some(function(m){return m.is_bot;}))return;try{await ctx.deleteMessage();}catch(_){}
  for(var i=0;i<ctx.message.new_chat_members.length;i++){
    var mem=ctx.message.new_chat_members[i];
    var handle=mem.username?'@'+mem.username:mem.first_name;
    var opts=[
      handle+' just joined $Mpc.\nRENOUNCED \u2022 LP LOCKED \u2022 0%/0% tax\n'+(caUnlocked?CA:'CA coming soon \u2014 stay close.'),
      'Glad you\u2019re here, '+handle+'.\n$Mpc \u2022 BNB Smart Chain (BSC) \u2022 RENOUNCED \u2022 LP LOCKED\n'+(caUnlocked?'CA: '+CA:'Launch incoming.'),
      handle+' joined the $Mpc community.\n0%/0% tax \u2022 LP LOCKED \u2022 RENOUNCED\n'+(caUnlocked?CA:'CA reveals soon.'),
    ];
    var msg=opts[Math.floor(Math.random()*opts.length)];
    var sent=await ctx.reply(msg);autoDelete(ctx.chat.id,sent.message_id,60000);
  }
});
bot.on('sticker',async function(ctx){var uid=ctx.from.id;var admin=await isAdmin(ctx,uid);if(admin)return;if(ctx.message.forward_from||ctx.message.forward_sender_name||ctx.message.forward_from_chat)return applyStrike(ctx,uid,'no forwards');var cnt=(stickerTracker.get(uid)||0)+1;stickerTracker.set(uid,cnt);if(cnt>3){try{await ctx.deleteMessage();}catch(_){}}});
bot.on(['photo','video','document','audio','voice'],async function(ctx){var uid=ctx.from.id;var admin=await isAdmin(ctx,uid);if(admin)return;if(ctx.message.forward_from||ctx.message.forward_sender_name||ctx.message.forward_from_chat)return applyStrike(ctx,uid,'no forwards');});
async function sendXReply(ctx){
  var btn={reply_markup:{inline_keyboard:[[{text:'Follow on X',url:TWITTER}]]}};
  var fallbackCap='Follow '+TICKER+' on X';
  try{var cap=await buildXCaption();return sendImage(ctx.chat.id,cap,btn);}catch(_){}
  return sendImage(ctx.chat.id,fallbackCap,btn);
}
bot.command('x',function(ctx){return sendXReply(ctx);});
bot.command('twitter',function(ctx){return sendXReply(ctx);});
bot.command('ca',async function(ctx){if(!caUnlocked)return ctx.reply(notLiveMsgs[Math.floor(Math.random()*notLiveMsgs.length)]);try{var cap=await buildCaCaption();return sendImage(ctx.chat.id,cap,{reply_markup:{inline_keyboard:[[{text:E.copy+' Copy CA',copy_text:{text:CA}}]]}});}catch(_){return ctx.reply(CA);}});
bot.command('socials',async function(ctx){return ctx.reply(buildSocialsMsg(),{parse_mode:'HTML',disable_web_page_preview:true});});
bot.command('links',async function(ctx){return ctx.reply(buildSocialsMsg(),{parse_mode:'HTML',disable_web_page_preview:true});});
bot.command('revealca',async function(ctx){var t=ctx.chat&&ctx.chat.type;if(t==='private'){caUnlocked=true;return ctx.reply('CA is now REVEALED.');}var admin=await isAdmin(ctx,ctx.from.id);if(!admin)return;caUnlocked=true;var m=await ctx.reply('CA is now live.');autoDelete(ctx.chat.id,m.message_id,10000);});
bot.command('hideca',async function(ctx){var t=ctx.chat&&ctx.chat.type;if(t==='private'){caUnlocked=false;return ctx.reply('CA is now HIDDEN.');}var admin=await isAdmin(ctx,ctx.from.id);if(!admin)return;caUnlocked=false;var m=await ctx.reply('CA is now hidden.');autoDelete(ctx.chat.id,m.message_id,10000);});
bot.on('message',async function(ctx){var msg=ctx.message;if(!msg||!ctx.from)return;var uid=ctx.from.id,chatType=ctx.chat.type;var text=(msg.text||'').trim();var isPrivate=chatType==='private';if(!isPrivate&&groupChatId!==ctx.chat.id)groupChatId=ctx.chat.id;if(!isPrivate)resetSilence();var admin=await isAdmin(ctx,uid);if(!isPrivate&&!admin&&text){var spammed=await checkSpam(ctx,uid);if(spammed)return;stickerTracker.set(uid,0);if(msg.forward_from||msg.forward_sender_name||msg.forward_from_chat)return applyStrike(ctx,uid,'no forwards');if(hasBlockedLink(text))return applyStrike(ctx,uid,'no external links');      if(hasTmeLink(text))return applyStrike(ctx,uid,'no TG invite links');      if(hasExtMention(text))return applyStrike(ctx,uid,'no promoting other groups');      if(hasFud(text))return applyStrike(ctx,uid,'no FUD or toxic language');}if(!text)return;var lower=text.toLowerCase();var devWords=['dev','who is the dev','is dev active','dev status','dev gone','cto','community takeover','who runs','who owns','team active','team behind','who behind'];if(devWords.some(function(w){return lower.includes(w);})){if(IS_CTO){var ctoReplies=[TICKER+' is a CTO \u2014 community takeover. Original dev is gone. The community now owns and runs this completely. No dev to rug. The holders are the team.','This is a CTO. Original dev walked away. The community stepped up and took full ownership of '+TICKER+'. Community power, not a dev.','No dev here \u2014 '+TICKER+' is 100% community-owned. Original dev left. The community holds the wheel and is driving this forward.','CTO project. Original dev is gone. Community took over '+TICKER+' completely. That is the strength here \u2014 no single dev can rug this.',];return ctx.reply(ctoReplies[Math.floor(Math.random()*ctoReplies.length)]);}try{var dr2=await smartAsk(systemPrompt(caUnlocked),text);if(dr2&&dr2!=='IGNORE')return ctx.reply(dr2);}catch(_){}return;}var caWords=['ca','contract','contract address','token address','where is the ca','whats the ca','what is the ca','give ca','drop ca','show ca'];if(caWords.some(function(w){return lower===w||lower.includes(w);})){if(!caUnlocked)return ctx.reply(notLiveMsgs[Math.floor(Math.random()*notLiveMsgs.length)]);try{var cap=await buildCaCaption();return sendImage(ctx.chat.id,cap,{reply_markup:{inline_keyboard:[[{text:E.copy+' Copy CA',copy_text:{text:CA}}]]}});}catch(_){return ctx.reply(CA);}}if(lower==='x'||lower==='twitter')return sendXReply(ctx);if(lower==='socials'||lower==='links')return ctx.reply(buildSocialsMsg(),{parse_mode:'HTML',disable_web_page_preview:true});if(isPrivate){try{var dr=await smartAsk(systemPrompt(caUnlocked),text);if(dr!=='IGNORE')return ctx.reply(dr);}catch(_){}return;}try{var gr=await smartAsk(systemPrompt(caUnlocked),text);if(gr&&gr!=='IGNORE')return ctx.reply(gr);}catch(_){}});
app.post('/webhook',function(req,res){bot.handleUpdate(req.body,res);});
app.get('/',function(req,res){res.end('OK');});
app.get('/health',function(req,res){res.end('OK');});
async function registerWebhook(){if(!WEBHOOK_URL)return;var url=WEBHOOK_URL+'/webhook';for(var i=0;i<5;i++){try{var ok=await bot.telegram.setWebhook(url);if(ok){console.log('Webhook: '+url);return;}}catch(e){console.log('Attempt '+(i+1)+': '+e.message);}await new Promise(function(r){setTimeout(r,3000);});}}
process.on('uncaughtException',function(e){console.error('Uncaught:',e.message);});
process.on('unhandledRejection',function(e){console.error('Rejection:',e&&e.message);});
async function setCommands(){
  try{
    await bot.telegram.setMyCommands([{command:'ca',description:'Contract address'},{command:'x',description:'Follow on X'},{command:'socials',description:'All links'}]);
    await bot.telegram.setMyCommands([{command:'ca',description:'Contract address'},{command:'x',description:'Follow on X'},{command:'socials',description:'All links'},{command:'revealca',description:'Reveal CA'},{command:'hideca',description:'Hide CA'}],{scope:{type:'all_chat_administrators'}});
  }catch(e){console.log('cmds:',e.message);}
}
app.listen(PORT,async function(){console.log('$Mpc bot on port '+PORT);try{await new Promise(function(r){setTimeout(r,2000);});}catch(_){}try{await registerWebhook();}catch(e){console.log(e.message);}try{await setCommands();}catch(e){console.log(e.message);}try{resetSilence();}catch(_){}setInterval(function(){if(WEBHOOK_URL)fetch(WEBHOOK_URL+'/health').catch(function(){});},4*60*1000);console.log('$Mpc bot live');});