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
var TICKER='$Mpc';
var CA='0x5794FF15f6bd01Eaa25DB48353886810467B0D1D';
var TWITTER='https://x.com/mpc_ctolead';
var WEBSITE='';
var IS_CTO=true;
var RESPONSE_MODE='conversational';
var bot=new Telegraf(BOT_TOKEN);
var groq=new Groq({apiKey:GROQ_API_KEY});
var app=express();app.use(express.json());
var _SF='/tmp/state.json';
var caUnlocked=false,groupChatId=null,silTimer=null;
var SIL_DELAY=3600000;
function loadState(){try{var s=JSON.parse(fs.readFileSync(_SF,'utf8'));caUnlocked=!!s.u;groupChatId=s.g||null;}catch(_){}}
function saveState(){try{fs.writeFileSync(_SF,JSON.stringify({u:caUnlocked,g:groupChatId}));}catch(_){}}
loadState();
var _IMG1=path.join(__dirname,'mpc.jpg');
var _IMG2=path.join(__dirname,'siren.jpg');
var IMG=fs.existsSync(_IMG1)?_IMG1:(fs.existsSync(_IMG2)?_IMG2:_IMG1);
var IMG_BUF=null;try{if(fs.existsSync(IMG))IMG_BUF=fs.readFileSync(IMG);}catch(_){}
var imgMsgs=new Map(),strikes=new Map(),spamTracker=new Map(),lastReplies=[];
var SHOUTOUT_ON=false,shoutTimer=null;
async function delPrevImg(cid){var mid=imgMsgs.get(cid);if(mid){try{await bot.telegram.deleteMessage(cid,mid);}catch(_){}imgMsgs.delete(cid);}}
async function sendImg(cid,cap,extra){await delPrevImg(cid);extra=extra||{};if(IMG_BUF){try{var m=await bot.telegram.sendPhoto(cid,{source:IMG_BUF},Object.assign({caption:cap,parse_mode:'HTML'},extra));imgMsgs.set(cid,m.message_id);return m;}catch(e){IMG_BUF=null;}}return bot.telegram.sendMessage(cid,cap,Object.assign({parse_mode:'HTML'},extra));}
function autoDel(cid,mid,ms){setTimeout(function(){try{bot.telegram.deleteMessage(cid,mid);}catch(_){}},ms);}
async function isAdmin(ctx,uid){var t=ctx.chat&&ctx.chat.type;if(t!=='group'&&t!=='supergroup')return false;try{var m=await ctx.telegram.getChatMember(ctx.chat.id,uid);return m.status==='administrator'||m.status==='creator';}catch(_){return false;}}
function getStrike(uid){var n=Date.now(),s=strikes.get(uid);if(!s||n-s.since>86400000){s={count:0,since:n};strikes.set(uid,s);}return s;}
async function applyStrike(ctx,uid,reason){var s=getStrike(uid);try{await ctx.deleteMessage();}catch(_){}var mem=ctx.message&&ctx.message.from;var tag=mem&&mem.username?'@'+mem.username:mem&&mem.first_name||'user';var why=reason?' ('+reason+')':'';s.count++;if(s.count>=3){s.count=0;try{await ctx.telegram.restrictChatMember(ctx.chat.id,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+86400});}catch(_){}var m3=await ctx.reply('\u26A0\uFE0F '+tag+' muted 24h \u2014 3 strikes'+why+'.');autoDel(ctx.chat.id,m3.message_id,60000);}else{var mw=await ctx.reply('\u26A0\uFE0F '+tag+' warning '+s.count+'/3'+why);autoDel(ctx.chat.id,mw.message_id,45000);}}
async function checkSpam(ctx,uid){var n=Date.now(),t=spamTracker.get(uid)||{c:0,s:n};if(n-t.s>60000)t={c:0,s:n};t.c++;spamTracker.set(uid,t);if(t.c>5){try{await ctx.telegram.restrictChatMember(ctx.chat.id,uid,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+300});}catch(_){}var m=await ctx.reply('Muted 5 min for spam.');autoDel(ctx.chat.id,m.message_id,15000);return true;}return false;}
var FUD=['rug','rugpull','scam','ponzi','honeypot','fuck','bitch','bastard','asshole','cunt','exit scam','dev ran','abandoned'];
function hasFud(t){var l=t.toLowerCase();return FUD.some(function(w){return l.includes(w);});}
var NOT_LIVE=['$Mpc hasn\u2019t launched yet. CA coming soon.','Not yet. Stay ready.','CA drops soon. Hold tight.'];
var CTO_REPLIES=['$Mpc is a CTO. Original dev gone. Community owns and runs this completely. No dev to rug.','CTO project. Dev walked away. Community stepped up and owns $Mpc now. That is the strength.','No dev here. $Mpc is 100% community-owned. Original dev left. Community drives this forward.'];
function sysPrompt(){
  return 'You are the community bot for $Mpc, a BNB Smart Chain (BSC) meme token.\nToken: $Mpc | Chain: BNB Smart Chain (BSC)\nSupply: N/A | Max Wallet: N/A\nTax: 0% buy / 0% sell\nContract: RENOUNCED | LP: LOCKED\nDEV: CTO. Original dev gone. Community owns $Mpc completely. Say this clearly when asked.'+(TWITTER?'\nTwitter: '+TWITTER:'')+'\nNarrative: '+"Mubarak PFP ☪️\nWhere Middle Eastern legend meets pixel-powered meme energy.\nBorn from culture, rising with community, and blessed with barakah."+'\nPersonality: High energy, exciting, bullish. Match community energy. Enthusiastic but genuine.\nRULES: 2-4 lines max. Natural and professional. Never share TG group link. Never repeat reply. If hype/casual/no question: reply IGNORE exactly.';
}
async function ask(msg){var r=await groq.chat.completions.create({model:'llama-3.3-70b-versatile',temperature:1.0,max_tokens:160,messages:[{role:'system',content:sysPrompt()},{role:'user',content:msg}]});return r.choices[0].message.content.trim();}
async function smartAsk(msg){var r=await ask(msg);if(lastReplies.includes(r))r=await ask(msg+' Give a completely different response.');lastReplies.push(r);if(lastReplies.length>12)lastReplies.shift();return r;}
var SIL_ANG=['2-3 lines. Why hold $Mpc right now.','2-3 lines. $Mpc fundamentals: renounced, LP locked.','2-3 lines. Being early to $Mpc.','2-3 lines. $Mpc community is building.','2-3 lines. The move in $Mpc is still early.'];
var silIdx=0;
async function fireSilence(){if(!groupChatId)return resetSil();try{var p=SIL_ANG[silIdx%SIL_ANG.length];silIdx++;var cap=await smartAsk(p);if(cap&&cap!=='IGNORE')await sendImg(groupChatId,cap,{});}catch(_){}resetSil();}
function resetSil(){if(silTimer)clearTimeout(silTimer);if(SIL_DELAY===0||SIL_DELAY==='0')return;silTimer=setTimeout(fireSilence,parseInt(SIL_DELAY));}
async function doShoutout(){if(!groupChatId||!SHOUTOUT_ON)return;try{var admins=await bot.telegram.getChatAdministrators(groupChatId);var humans=admins.filter(function(a){return!a.user.is_bot;});var names=humans.map(function(a){return a.user.username?'@'+a.user.username:a.user.first_name;});if(!names.length)return schedShout();var ppt='1-2 warm lines. Shoutout to admins keeping $Mpc alive: '+names.join(', ')+'. Sound genuine. Tag them.';var msg=await smartAsk(ppt);if(msg&&msg!=='IGNORE'){var sm=await bot.telegram.sendMessage(groupChatId,msg);setTimeout(function(){try{bot.telegram.deleteMessage(groupChatId,sm.message_id);}catch(_){}},7200000);}}catch(_){}schedShout();}
function schedShout(){if(shoutTimer)clearTimeout(shoutTimer);if(!SHOUTOUT_ON)return;var slots=[21600000,43200000,61200000,75600000];var now=Date.now()%86400000;var next=slots.find(function(t){return t>now;});var wait=next!==undefined?next-now:86400000-now+slots[0];wait+=Math.floor(Math.random()*1800000);shoutTimer=setTimeout(doShoutout,wait);}
bot.command('shoutout',async function(ctx){var admin=await isAdmin(ctx,ctx.from.id);if(!admin)return;var arg=(ctx.message.text||'').split(' ')[1]||'';if(arg==='on'){SHOUTOUT_ON=true;schedShout();return ctx.reply('\u2705 Admin shoutouts enabled. Fires 2-4x daily.');}if(arg==='off'){SHOUTOUT_ON=false;if(shoutTimer)clearTimeout(shoutTimer);return ctx.reply('\u274C Admin shoutouts disabled.');}if(arg==='now'){await doShoutout();return;}return ctx.reply('Usage: /shoutout on / off / now');});
bot.command('ca',async function(ctx){if(!caUnlocked)return ctx.reply(NOT_LIVE[Math.floor(Math.random()*NOT_LIVE.length)]);await sendImg(ctx.chat.id,'$Mpc Contract Address',{});return ctx.reply('<code>'+CA+'</code>',{parse_mode:'HTML'});});
bot.command('x',async function(ctx){return sendImg(ctx.chat.id,'Follow $Mpc on X',{reply_markup:{inline_keyboard:[[{text:'Follow on X',url:TWITTER}]]}});});
bot.command('twitter',async function(ctx){return sendImg(ctx.chat.id,'Follow $Mpc on X',{reply_markup:{inline_keyboard:[[{text:'Follow on X',url:TWITTER}]]}});});
bot.command('socials',function(ctx){return ctx.reply('<a href=\'https://dexscreener.com/bsc/0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'>Chart</a> | <a href=\'https://pancakeswap.finance/swap?outputCurrency=0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'>PancakeSwap</a>'+(TWITTER?' | <a href=\''+TWITTER+'\'>Twitter</a>':'')+(WEBSITE?' | <a href=\''+WEBSITE+'\'>Website</a>':''),{parse_mode:'HTML',disable_web_page_preview:true});});
bot.command('links',function(ctx){return ctx.reply('<a href=\'https://dexscreener.com/bsc/0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'>Chart</a> | <a href=\'https://pancakeswap.finance/swap?outputCurrency=0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'>PancakeSwap</a>'+(TWITTER?' | <a href=\''+TWITTER+'\'>Twitter</a>':'')+(WEBSITE?' | <a href=\''+WEBSITE+'\'>Website</a>':''),{parse_mode:'HTML',disable_web_page_preview:true});});
bot.command('info',function(ctx){return ctx.reply('<b>$Mpc</b> \u2014 BNB Smart Chain (BSC)\n\nSupply: N/A\nMax Wallet: N/A\nTax: 0% buy / 0% sell\nContract: RENOUNCED\nLP: LOCKED'+(TWITTER?'\nTwitter: '+TWITTER:''),{parse_mode:'HTML',disable_web_page_preview:true});});
bot.command('revealca',async function(ctx){var t=ctx.chat&&ctx.chat.type;if(t==='private'){caUnlocked=true;saveState();return ctx.reply('CA is now REVEALED.');}var a=await isAdmin(ctx,ctx.from.id);if(!a)return;caUnlocked=true;saveState();var m=await ctx.reply('CA is now live.');autoDel(ctx.chat.id,m.message_id,10000);});
bot.command('hideca',async function(ctx){var t=ctx.chat&&ctx.chat.type;if(t==='private'){caUnlocked=false;saveState();return ctx.reply('CA hidden.');}var a=await isAdmin(ctx,ctx.from.id);if(!a)return;caUnlocked=false;saveState();var m=await ctx.reply('CA is now hidden.');autoDel(ctx.chat.id,m.message_id,10000);});
bot.on('new_chat_members',async function(ctx){if(ctx.message.new_chat_members.some(function(m){return m.is_bot;}))return;try{await ctx.deleteMessage();}catch(_){}for(var i=0;i<ctx.message.new_chat_members.length;i++){var mem=ctx.message.new_chat_members[i];var h=mem.username?'@'+mem.username:mem.first_name;var opts=[h+' joined $Mpc.\nRENOUNCED \u2022 LP LOCKED \u2022 0%/0% tax\n'+(caUnlocked?CA:'CA coming soon.'),'Welcome, '+h+'. $Mpc \u2022 BNB Smart Chain (BSC)\n'+(caUnlocked?'CA: '+CA:'Launch incoming.')];var msg=opts[Math.floor(Math.random()*opts.length)];var s=await ctx.reply(msg);autoDel(ctx.chat.id,s.message_id,60000);}});
var chatHistory=[];
function addHistory(t){chatHistory.push(t);if(chatHistory.length>8)chatHistory.shift();}
function isPromoSpam(text){var t=text.toLowerCase();var pw=['dm me','dm:','t.me/','join our','join now','pump call','100x','1000x','send me','legitimate','long-term promo','promotion','signal','call group','whale','airdrop only','giveaway','free token'];return pw.some(function(w){return t.includes(w);});}
bot.on('message',async function(ctx){
  var msg=ctx.message;if(!msg||!ctx.from)return;
  var uid=ctx.from.id,isPrivate=ctx.chat.type==='private';
  var text=(msg.text||msg.caption||'').trim();
  if(!isPrivate&&groupChatId!==ctx.chat.id){groupChatId=ctx.chat.id;saveState();}
  if(!isPrivate)resetSil();
  var admin=await isAdmin(ctx,uid);
  if(!isPrivate){
    var isFwd=msg.forward_from||msg.forward_sender_name||msg.forward_from_chat||msg.forward_from_message_id;
    if(isFwd&&!admin){try{await ctx.deleteMessage();}catch(_){}var wf=await ctx.reply('\u26A0\uFE0F No forwarded messages.');autoDel(ctx.chat.id,wf.message_id,8000);return;}
    if(text&&msg.entities){var mens=msg.entities.filter(function(e){return e.type==='mention';});if(mens.length>0&&!admin){try{await ctx.deleteMessage();}catch(_){}var wm=await ctx.reply('\u26A0\uFE0F No external mentions.');autoDel(ctx.chat.id,wm.message_id,8000);return;}}
    if(text&&isPromoSpam(text)&&!admin){try{await ctx.deleteMessage();}catch(_){}var wps=await ctx.reply('\u26A0\uFE0F Promotional content removed.');autoDel(ctx.chat.id,wps.message_id,8000);return;}
    if(text&&hasFud(text)&&!admin)return applyStrike(ctx,uid,'no FUD');
    if(text&&!admin){var sp=await checkSpam(ctx,uid);if(sp)return;}
  }
  if(admin&&!isPrivate){
    if(!text)return;var lower=text.toLowerCase();
    var caWa=['ca','contract address','contract','token address'];
    if(caWa.some(function(w){return lower===w||lower.includes(w);})){if(!caUnlocked)return ctx.reply(NOT_LIVE[Math.floor(Math.random()*NOT_LIVE.length)]);await sendImg(ctx.chat.id,'$Mpc Contract Address',{});return ctx.reply('<code>'+CA+'</code>',{parse_mode:'HTML'});}
    if(lower==='x'||lower==='twitter')return sendImg(ctx.chat.id,'Follow $Mpc on X',{reply_markup:{inline_keyboard:[[{text:'Follow on X',url:TWITTER}]]}});
    if(lower==='socials'||lower==='links')return ctx.reply('<a href=\'https://dexscreener.com/bsc/0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'> Chart</a> | <a href=\'https://pancakeswap.finance/swap?outputCurrency=0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'> PancakeSwap</a>'+(TWITTER?' | <a href=\''+TWITTER+'\'>Twitter</a>':''),{parse_mode:'HTML',disable_web_page_preview:true});
    return;
  }
  if(!text)return;var lower2=text.toLowerCase();addHistory(text);
  if(lower2.includes('dev')||lower2.includes('cto')||lower2.includes('who run')||lower2.includes('who own')){if(IS_CTO)return ctx.reply(CTO_REPLIES[Math.floor(Math.random()*CTO_REPLIES.length)]);try{var dr=await smartAsk(chatHistory.join('\n'));if(dr&&dr!=='IGNORE')return ctx.reply(dr);}catch(_){}return;}
  var caWords=['ca','contract address','token address','where is the ca','give ca','show ca','drop ca','contract'];
  if(caWords.some(function(w){return lower2===w||lower2.includes(w);})){if(!caUnlocked)return ctx.reply(NOT_LIVE[Math.floor(Math.random()*NOT_LIVE.length)]);await sendImg(ctx.chat.id,'$Mpc Contract Address',{});return ctx.reply('<code>'+CA+'</code>',{parse_mode:'HTML'});}
  if(lower2==='x'||lower2==='twitter'||lower2.includes('follow on'))return sendImg(ctx.chat.id,'Follow $Mpc on X',{reply_markup:{inline_keyboard:[[{text:'Follow on X',url:TWITTER}]]}});
  if(lower2==='socials'||lower2==='links')return ctx.reply('<a href=\'https://dexscreener.com/bsc/0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'> Chart</a> | <a href=\'https://pancakeswap.finance/swap?outputCurrency=0x5794FF15f6bd01Eaa25DB48353886810467B0D1D\'> PancakeSwap</a>'+(TWITTER?' | <a href=\''+TWITTER+'\'>Twitter</a>':''),{parse_mode:'HTML',disable_web_page_preview:true});
  if(isPrivate){try{var gr=await smartAsk(chatHistory.join('\n'));if(gr&&gr!=='IGNORE')return ctx.reply(gr);}catch(_){}return;}
  if(RESPONSE_MODE==='focused'){if(text.indexOf('?')===-1)return;try{var gr2=await smartAsk(chatHistory.join('\n'));if(gr2&&gr2!=='IGNORE')return ctx.reply(gr2);}catch(_){}return;}
  var tkLow=TICKER.toLowerCase().replace('$','');if(text.indexOf('?')!==-1||lower2.includes(tkLow)){try{var gr3=await smartAsk(chatHistory.join('\n'));if(gr3&&gr3!=='IGNORE')return ctx.reply(gr3);}catch(_){}}
});
app.post('/webhook',function(req,res){bot.handleUpdate(req.body,res);});
app.get('/',function(req,res){res.end('OK');});
app.get('/health',function(req,res){res.end('OK');});
async function regWH(){if(!WEBHOOK_URL)return;var url=WEBHOOK_URL+'/webhook';for(var i=0;i<5;i++){try{if(await bot.telegram.setWebhook(url)){console.log('Webhook:',url);return;}}catch(e){console.log('WH '+(i+1)+':',e.message);}await new Promise(function(r){setTimeout(r,3000);});}}
process.on('uncaughtException',function(e){console.error(e.message);});
process.on('unhandledRejection',function(e){console.error(e&&e.message);});
app.listen(PORT,async function(){console.log('$Mpc bot port '+PORT);try{await new Promise(function(r){setTimeout(r,2000);});}catch(_){}try{await regWH();}catch(e){console.log(e.message);}if(parseInt(SIL_DELAY||'0')>0)try{resetSil();}catch(_){}try{schedShout();}catch(_){}setInterval(function(){if(WEBHOOK_URL)try{fetch(WEBHOOK_URL+'/health').catch(function(){});}catch(_){}},4*60*1000);console.log('$Mpc bot live');});