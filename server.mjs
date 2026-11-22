import {constrainPosition,wallContact,groundHeight,landingHeight,voteAt,shotWallDistance,shotWallHit,HUB_ZONES,DESTRUCTIBLE_PRESETS,CONTROL_POINT} from './physics.js';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {readFile,stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {randomUUID, randomInt} from 'node:crypto';
const rooms=new Map(), clients=new Map();
const weapons={smg:{name:'ПП «Воздушный Ткач»',price:0,damage:12,rate:80,range:30,spread:.03},shotgun:{name:'Дробовик «Кинетический Бластер»',price:0,damage:91,rate:700,range:15,spread:.15,pellets:7}};
const ROLE_DEFS={
 tank:{name:'ТАНК',maxHp:260,maxShield:160,shieldRegen:28,speed:6.6,skill1Name:'ЩИТ',skill1Cd:3200,skill2Name:'УДАР',skill2Cd:6000,ultName:'РАЗЛОМ'},
 dps:{name:'УРОН',maxHp:140,maxShield:0,shieldRegen:0,speed:8.2,skill1Name:'ГРАНАТА',skill1Cd:5500,skill2Name:'ОВЕРДРАЙВ',skill2Cd:8000,ultName:'ШКВАЛ'},
 support:{name:'ПОДДЕРЖКА',maxHp:150,maxShield:0,shieldRegen:0,speed:7.3,skill1Name:'БИО-ПУЛЬС',skill1Cd:6000,skill2Name:'БУСТ',skill2Cd:8000,ultName:'КУПОЛ'}
};
const HERO_DEFAULT_ROLES={shadow:'dps',viper:'dps',blitz:'dps',skye:'support',yoru:'tank',celeste:'support',noch:'tank',ari:'support',ben:'tank'};
const validRole=r=>r==='tank'||r==='dps'||r==='support'?r:'dps';
const liveBlocks=room=>room.destructibles?room.destructibles.filter(d=>d.hp>0):null;
function teamSynergies(room,team){
 if(!team)return [];
 let roles=new Set([...room.players.values()].filter(pl=>pl.team===team).map(pl=>pl.role||'dps'));
 let out=[];
 if(roles.has('tank')&&roles.has('dps'))out.push('tank_dps');
 if(roles.has('tank')&&roles.has('support'))out.push('tank_support');
 if(roles.has('dps')&&roles.has('support'))out.push('dps_support');
 return out;
}
const outfits={
 default:{name:'Базовый образ',price:0,desc:'Фирменный стиль выбранного героя'},
 cyber_gold:{name:'Золотой Кибер',price:200,desc:'Чёрно-золотая броня с янтарным неоном'},
 crimson_oni:{name:'Багровый Они',price:200,desc:'Тёмно-бордовый костюм с алым неоном'},
 arctic_white:{name:'Арктический Призрак',price:300,desc:'Бело-платиновая броня и ледяной свет'},
 emerald_phantom:{name:'Изумрудный Токсик',price:300,desc:'Графитовый костюм с изумрудным неоном'},
 obsidian_nova:{name:'Обсидиан Нова',price:400,desc:'Обсидиановая броня с крыльями и бирюзовым неоном'},
 royal_sakura:{name:'Неон Сакура',price:400,desc:'Индиго, розовая броня и светящийся ореол'}
};
const weaponSkins={
 default:{name:'Стандарт',price:0,desc:'Базовый неон оружия'},
 gold_rush:{name:'Золотой Импульс',price:200,desc:'Золотой корпус и янтарный луч'},
 crimson_fang:{name:'Алый Клык',price:200,desc:'Багровый корпус и алый луч'},
 cyber_ice:{name:'Ледяной Кристалл',price:300,desc:'Морозный бело-голубой бластер'},
 toxic_volt:{name:'Токсичный Вольт',price:300,desc:'Тёмный титан и неоново-зелёный луч'},
 astral_void:{name:'Астральная Бездна',price:400,desc:'Обсидиан и фиолетово-неоновый импульс'},
 hyper_prism:{name:'Гипер-Призма',price:400,desc:'Перламутровый корпус и яркий призма-луч'}
};
const presets={
 shadow:{character:'shadow',hair:0,clothes:0,eyes:0},
 viper:{character:'viper',hair:1,clothes:3,eyes:0},
 blitz:{character:'blitz',hair:3,clothes:1,eyes:0},
 skye:{character:'skye',hair:2,clothes:4,eyes:1},
 yoru:{character:'yoru',hair:4,clothes:5,eyes:1},
 celeste:{character:'celeste',hair:5,clothes:6,eyes:1},
 noch:{character:'noch',hair:6,clothes:7,eyes:0},
 ari:{character:'ari',hair:7,clothes:8,eyes:2},
 ben:{character:'ben',hair:8,clothes:9,eyes:3}
};
const mapPhase=room=>room.phase==='lobby'?(room.mode==='hub'?'hub':'lobby'):room.map==='duct'?'duct':room.map==='station'?'station':room.map==='neoball'?'neoball':room.map==='garden'?'garden':room.phase;
const ductSpawns=[[-4,-14],[4,14],[4,-14],[-4,14]];
const gardenSpawns=[[0,15.5],[-10,-4],[10,4],[-14.5,13.5],[14.5,-13.5]];
const spawns=[[-18,-8],[18,8],[-18,8],[18,-8]];const RESPAWN={x:18,z:0};
const VOTE_DURATION=Number(process.env.VOTE_DURATION_MS)||10000;const LEGACY_VOTE_DURATION=15000;const QUEUE_DURATION=Number(process.env.QUEUE_DURATION_MS)||8000;const HUB_LIMIT=24;
const RESPAWN_DELAY=5000;
const BOT_NAMES=['БОТ КАЙ','БОТ НЕО','БОТ ВЕГА','БОТ ЗЕРО','БОТ ЛУНА','БОТ РЭЙ'];
const BOT_HEROES=Object.keys(presets);
const BOT_OUTFITS=['default','cyber_gold','crimson_oni','arctic_white','emerald_phantom'];
const hub={code:'HUB',mode:'hub',map:'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null,queues:Object.fromEntries(HUB_ZONES.map(z=>[z.id,{ends:0}]))};rooms.set('HUB',hub);
const voteCounts=room=>{let v={duct:0,colosseum:0,station:0,garden:0};for(const p of room.players.values()){if(p.isBot)continue;let id=room.mode==='voting'?p.vote:voteAt(p.x,p.z);if(id)v[id]++}return v};
const chooseMap=room=>{let v=voteCounts(room);return ['colosseum','duct','station','garden'].reduce((a,b)=>v[b]>v[a]?b:a)};
const send=(ws,obj)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(obj))};
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj)}
function makeBot(room,slotIndex,forcedRole=null){
 let usedNames=new Set([...room.players.values()].map(p=>p.name));
 let name=BOT_NAMES.find(n=>!usedNames.has(n))||`БОТ ${slotIndex+1}`;
 let usedHeroes=new Set([...room.players.values()].map(p=>p.look?.character));
 let role=forcedRole||(['tank','dps','support'][slotIndex%3]);
 let roleHeroes=BOT_HEROES.filter(h=>HERO_DEFAULT_ROLES[h]===role);
 let availHeroes=roleHeroes.filter(h=>!usedHeroes.has(h));
 let pool=availHeroes.length?availHeroes:(roleHeroes.length?roleHeroes:BOT_HEROES);
 let heroKey=pool[randomInt(0,pool.length)];
 let outfit=BOT_OUTFITS[randomInt(0,BOT_OUTFITS.length)];
 let weapon=role==='dps'?(randomInt(0,10)<6?'smg':'shotgun'):role==='tank'?'shotgun':'smg';
 let rdef=ROLE_DEFS[role];
 return {
  id:'bot-'+randomUUID().slice(0,8),ws:null,isBot:true,name,
  look:{...presets[heroKey],outfit,weaponSkin:'default'},role,
  x:((slotIndex%4)-1.5)*1.4,z:-5.2,y:0,flip:0,angle:0,pitch:0,hp:rdef.maxHp,maxHp:rdef.maxHp,
  shield:rdef.maxShield,maxShield:rdef.maxShield,shieldActive:false,shieldUntil:0,shieldBrokenAt:0,
  ultCharge:0,skill1ReadyAt:0,skill2ReadyAt:0,teamUpReadyAt:0,stunUntil:0,healDebuffUntil:0,overdriveUntil:0,boostUntil:0,lastDamagedAt:0,
  eliminated:false,kills:0,deaths:0,
  ready:false,seated:false,weapon,coins:10000,owned:['smg','shotgun'],ownedOutfits:['default'],ownedWeaponSkins:['default'],
  lastShot:0,lastMove:Date.now(),moveCredit:10,moveSeq:0,spawnRev:0,respawnAt:0,invulnerableUntil:0,queue:null,vote:null,
  ai:{strafeDir:randomInt(0,2)?1:-1,strafeUntil:0,jumpAt:0,vy:0,wanderX:0,wanderZ:0,wanderUntil:0,stuckTicks:0,dashReadyAt:0}
 };
}
function fillRoomBots(room,targetCount){
 let slot=0;
 const roleOrder=['tank','dps','support'];
 while(room.players.size<targetCount){
  let bot=makeBot(room,slot,roleOrder[slot%3]);
  slot++;
  room.players.set(bot.id,bot);
 }
}
function state(room){
 let teamUps=null;
 if(room.phase==='match'&&room.mode==='neoball'){
  teamUps={A:teamSynergies(room,'A'),B:teamSynergies(room,'B')};
 }
 return {type:'state',now:Date.now(),code:room.code,map:room.map,phase:room.phase,mode:room.mode||'private',ends:room.ends,epoch:room.epoch,countdown:room.countdown||0,sector:room.sector||0,votes:room.phase==='lobby'&&room.mode!=='hub'?voteCounts(room):null,queues:room.mode==='hub'?HUB_ZONES.map(z=>({id:z.id,capacity:z.capacity,minPlayers:z.minPlayers||z.capacity,mode:z.mode||'classic',count:[...room.players.values()].filter(p=>p.queue===z.id).length,ends:room.queues[z.id].ends})):null,neo:room.neo||null,chaser:room.chaser||null,control:room.control||null,teamUps,destructibles:room.destructibles||null,sanctuaries:room.sanctuaries||null,players:[...room.players.values()].map(({ws,ai,botChoice,botPromptedZone,lastShot,lastMove,lastBounce,slideAt,lastKickWall,...p})=>p),results:room.results};
}
function sync(room){broadcast(room,state(room))}
const NEO_DURATION=Number(process.env.NEO_DURATION_MS)||300000,NEO_RESET=Number(process.env.NEO_RESET_MS)||3000;
function neoSpawn(p,i){return {x:(i<2?-3:3),z:p.team==='A'?-55:55}}
function controlSpawn(p,i){let a=(i%3)*(Math.PI*2/3);return {x:Math.sin(a)*16.5,z:Math.cos(a)*16.5}}
function respawnPos(room,p){
 let list=[...room.players.values()],i=Math.max(0,list.indexOf(p));
 if(room.mode==='neoball')return neoSpawn(p,i);
 if(room.mode==='control')return controlSpawn(p,i);
 if(room.map==='garden')return {x:gardenSpawns[i%gardenSpawns.length][0],z:gardenSpawns[i%gardenSpawns.length][1]};
 let s=(room.map==='duct'||room.map==='station'?ductSpawns:spawns)[i%4];
 return {x:s[0],z:s[1]};
}
function tryStartRoom(room){
 if(room.mode==='private'){
  let humans=[...room.players.values()].filter(p=>!p.isBot);
  if(humans.length===1&&!room.botConsent){
   room.countdown=0;
   if(!room.botPrompted){
    room.botPrompted=true;
    let cap=room.privateMode==='control'?3:4;
    send(humans[0].ws,{type:'bot_prompt',mode:room.privateMode||'private',capacity:cap,currentCount:1,botsToAdd:cap-1});
   }
   sync(room);return;
  }
 }
 start(room);
}
function start(room){
 if(room.mode==='private'){
  let humans=[...room.players.values()].filter(p=>!p.isBot);
  let target=room.privateMode==='control'?3:4;
  if(humans.length===1&&room.players.size<target)fillRoomBots(room,target);
  room.botConsent=false;room.botPrompted=false;
  if(room.privateMode==='control')room.mode='control';
 }
 room.map=room.mode==='neoball'?'neoball':room.mode==='chaser'?'garden':room.mode==='control'?(chooseMap(room)==='garden'?'colosseum':chooseMap(room)):chooseMap(room);
 room.countdown=0;room.epoch++;room.phase='match';
 room.ends=Date.now()+(room.mode==='neoball'?NEO_DURATION:room.mode==='chaser'?(Number(process.env.CHASER_DURATION_MS)||240000):room.mode==='control'?(Number(process.env.CONTROL_DURATION_MS)||240000):(Number(process.env.MATCH_DURATION_MS)||180000));
 room.results=null;room.chaser=null;room.control=null;room.sanctuaries=[];
 const presetsDest=DESTRUCTIBLE_PRESETS[room.map];
 room.destructibles=presetsDest?presetsDest.map(d=>({...d})):null;
 if(room.mode==='neoball')room.neo={scores:{A:0,B:0},ball:{status:'center',holder:null,x:0,y:0,z:0},resetAt:0,overtime:false,winner:null};
 if(room.mode==='control')room.control={ownerId:null,ownerName:null,contested:false,capturingId:null,capturingName:null,capture:0,progress:{},winnerId:null,point:CONTROL_POINT};
 let list=[...room.players.values()],chaserIdx=room.mode==='chaser'?randomInt(0,Math.max(1,list.length)):-1;
 let chaserPlayer=chaserIdx>=0?list[chaserIdx]:null;
 if(chaserPlayer)room.chaser={chaserId:chaserPlayer.id,chaserName:chaserPlayer.name,winner:null};
 // Ensure balanced roles for bots on team modes so Tank+DPS+Support synergies appear!
 if(room.mode==='neoball'){
  const teamRoles={A:new Set(),B:new Set()};
  for(let i=0;i<list.length;i++){
   let p=list[i];
   p.team=i%2===0?'A':'B';
   if(!p.isBot)teamRoles[p.team].add(p.role=validRole(p.role||HERO_DEFAULT_ROLES[p.look?.character]));
  }
  for(let p of list){
   if(!p.isBot)continue;
   let pick=['tank','dps','support'].find(r=>!teamRoles[p.team].has(r))||p.role||'dps';
   p.role=pick;teamRoles[p.team].add(pick);
  }
 }
 let survIdx=0;
 for(let i=0;i<list.length;i++){
  let p=list[i];
  if(room.mode==='neoball')p.team=i%2===0?'A':'B';
  else if(room.mode==='chaser')p.team=(i===chaserIdx?'chaser':'survivor');
  else p.team=null;
  if(room.mode==='control'&&room.control)room.control.progress[p.id]=0;
  p.role=validRole(p.role||HERO_DEFAULT_ROLES[p.look?.character]);
  let rdef=ROLE_DEFS[p.role];
  let pos=room.mode==='neoball'?neoSpawn(p,i):room.mode==='control'?controlSpawn(p,i):null;
  let s=room.map==='garden'?(room.mode==='chaser'?(i===chaserIdx?gardenSpawns[0]:gardenSpawns[1+(survIdx++%4)]):gardenSpawns[i%gardenSpawns.length]):(room.map==='duct'||room.map==='station'?ductSpawns:spawns)[i%4];
  let startHp=(room.mode==='chaser'&&p.team==='chaser')?800:rdef.maxHp;
  let startShield=(room.mode==='chaser'&&p.team==='chaser')?0:rdef.maxShield;
  Object.assign(p,{x:pos?pos.x:s[0],z:pos?pos.z:s[1],y:0,flip:0,seated:false,wallSliding:false,lastKickWall:null,hp:startHp,maxHp:startHp,shield:startShield,maxShield:startShield,shieldActive:false,shieldUntil:0,shieldBrokenAt:0,ultCharge:0,skill1ReadyAt:0,skill2ReadyAt:0,teamUpReadyAt:0,stunUntil:0,healDebuffUntil:0,overdriveUntil:0,boostUntil:0,lastDamagedAt:0,eliminated:false,kills:0,deaths:0,ready:false,respawnAt:0,invulnerableUntil:Date.now()+3000});
  if(p.ai)Object.assign(p.ai,{vy:0,stuckTicks:0,wanderUntil:0,strafeUntil:0,jumpAt:0,dashReadyAt:0});
 }
 if(chaserPlayer){
  for(const p of list)send(p.ws,{type:'chaser_assigned',chaserId:chaserPlayer.id,chaserName:chaserPlayer.name,isMe:p.id===chaserPlayer.id});
  broadcast(room,{type:'notice',text:`CHASER: ${chaserPlayer.name}`});
 }else{
  broadcast(room,{type:'notice',text:room.mode==='neoball'?'NEO-BALL · МЯЧ В ЦЕНТРЕ':room.mode==='control'?'ЗАХВАТ ТОЧКИ · КАЖДЫЙ ЗА СЕБЯ!':'БОЙ НАЧАЛСЯ!'});
 }
 sync(room);
}
function finish(room,winner=null){
 if(room.phase!=='match')return;
 room.phase='ending';room.ends=Date.now()+3000;
 for(const p of room.players.values()){p.respawnAt=0;p.shieldActive=false}
 if(room.neo){room.neo.capture=null;room.neo.winner=winner}
 if(room.chaser)room.chaser.winner=winner;
 if(room.control)room.control.winnerId=winner;
 let a=[...room.players.values()].sort((a,b)=>{
  if(room.neo&&winner)return ((b.team===winner)-(a.team===winner))||b.kills-a.kills||a.deaths-b.deaths;
  if(room.control){
   let pa=room.control.progress?.[a.id]||0,pb=room.control.progress?.[b.id]||0;
   if(pb!==pa)return pb-pa;
  }
  if(room.chaser&&winner){
   let aWin=winner==='chaser'?a.team==='chaser':a.team==='survivor';
   let bWin=winner==='chaser'?b.team==='chaser':b.team==='survivor';
   if(aWin!==bWin)return bWin-aWin;
   if(a.eliminated!==b.eliminated)return a.eliminated-b.eliminated;
  }
  return b.kills-a.kills||a.deaths-b.deaths;
 });
 room.results=a.map((p,i)=>{
  let won=room.neo?(winner&&p.team===winner):room.control?(winner?p.id===winner:(i===0&&a.length>1)):room.chaser?(winner==='chaser'?p.team==='chaser':p.team==='survivor'):(i===0&&a.length>1);
  let reward=80+p.kills*20+(won?100:0);p.coins+=reward;
  return {id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,reward,look:p.look,role:p.role,team:p.team,eliminated:!!p.eliminated,scorePct:room.control?Math.round(room.control.progress?.[p.id]||0):undefined};
 });
 sync(room);
}
function dropNeoBall(room,p){if(room.neo?.ball.holder!==p.id)return;let y=landingHeight(p.x,p.z,p.y,0,'neoball')??0;room.neo.ball={status:'dropped',holder:null,x:p.x,y,z:p.z};room.neo.capture=null;broadcast(room,{type:'notice',text:'МЯЧ ПОТЕРЯН!'})}
function neoCheckClock(room,now=Date.now()){if(room.mode!=='neoball'||room.phase!=='match'||now<room.ends)return;let s=room.neo.scores;finish(room,s.A>s.B?'A':s.B>s.A?'B':null)}
function neoUpdatePlayer(room,p){
 let neo=room.neo;if(!neo||room.phase!=='match'||p.respawnAt)return;neoCheckClock(room);if(room.phase!=='match'||neo.resetAt)return;
 let ball=neo.ball;
 if(!ball.holder&&Math.hypot(p.x-ball.x,p.z-ball.z)<1.25&&Math.abs(p.y-ball.y)<1.4){ball.holder=p.id;ball.status='carried';broadcast(room,{type:'notice',text:p.name+' ПОДОБРАЛ МЯЧ'});sync(room)}
 if(ball.holder!==p.id)return;
 ball.x=p.x;ball.y=p.y;ball.z=p.z;
 const goalZ=p.team==='A'?56:-56, inside=Math.hypot(p.x,p.z-goalZ)<2.6&&p.y<2.5;
 if(!inside){if(neo.capture){neo.capture=null;sync(room)}return}
 if(!neo.capture||neo.capture.playerId!==p.id){neo.capture={playerId:p.id,team:p.team,startedAt:Date.now(),duration:5000};sync(room);return}
 if(Date.now()-neo.capture.startedAt<neo.capture.duration)return;
 neo.capture=null;neo.scores[p.team]++;broadcast(room,{type:'notice',text:'ГОЛ! КОМАНДА '+p.team});
 if(neo.scores[p.team]>=5||neo.overtime){finish(room,p.team);return}
 neo.ball={status:'reset',holder:null,x:0,y:0,z:0};neo.resetAt=Date.now()+NEO_RESET;sync(room)
}
function updateHubQueues(){
 for(const zone of HUB_ZONES){
  let members=[...hub.players.values()].filter(p=>p.queue===zone.id);
  let minP=zone.minPlayers||zone.capacity;
  if(!members.length){hub.queues[zone.id].ends=0;continue}
  if(members.length>=minP){
   for(const m of members){
    if(m.botPromptedZone===zone.id||m.botChoice){m.botPromptedZone=null;m.botChoice=null;send(m.ws,{type:'bot_prompt_close'})}
   }
   if(!hub.queues[zone.id].ends)hub.queues[zone.id].ends=Date.now()+QUEUE_DURATION;
   else if(members.length>=zone.capacity&&hub.queues[zone.id].ends-Date.now()>3000)hub.queues[zone.id].ends=Date.now()+3000;
  }else{
   hub.queues[zone.id].ends=0;
   if(members.every(m=>m.botChoice==='accept')){launchQueue(zone);continue}
   let targetCount=(zone.mode==='chaser'||zone.mode==='control')?Math.max(minP,members.length):zone.capacity;
   for(const m of members){
    if(!m.botChoice&&m.botPromptedZone!==zone.id){
     m.botPromptedZone=zone.id;
     send(m.ws,{type:'bot_prompt',zoneId:zone.id,mode:zone.mode||'classic',capacity:zone.capacity,currentCount:members.length,botsToAdd:targetCount-members.length});
    }
   }
  }
 }
}
function leave(c){let room=rooms.get(c.code);if(!room)return;let departing=room.players.get(c.id);if(departing)dropNeoBall(room,departing);room.players.delete(c.id);let hasHumans=[...room.players.values()].some(p=>!p.isBot);if(room.mode!=='hub'&&!hasHumans){rooms.delete(room.code);c.code=null;return}if(room.mode==='neoball'&&room.phase==='match'&&room.players.size){let alive=[...room.players.values()],teams=new Set(alive.map(p=>p.team));if(teams.size===1)finish(room,alive[0].team)}if(room.mode==='control'&&room.phase==='match'&&room.players.size===1){let last=[...room.players.values()][0];finish(room,last.id)}if(room.mode==='chaser'&&room.phase==='match'&&departing){if(departing.team==='chaser')finish(room,'survivors');else if(![...room.players.values()].some(p=>p.team==='survivor'&&!p.eliminated))finish(room,'chaser')}if(room.mode==='hub'){updateHubQueues();sync(room)}else if(!room.players.size)rooms.delete(room.code);else sync(room);c.code=null}
let htmlCache={mtime:0,raw:null,gz:null};
async function loadHtmlCache(){
 let u=new URL('./index.html',import.meta.url),st=await stat(u);
 if(st.mtimeMs!==htmlCache.mtime||!htmlCache.raw){
  let raw=await readFile(u);
  htmlCache={mtime:st.mtimeMs,raw,gz:gzipSync(raw,{level:6})};
 }
 return htmlCache;
}
const server=http.createServer(async(req,res)=>{try{
 let path=(req.url||'/').split('?')[0];
 if(path==='/healthz'||path==='/ping'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:'ok');return}
 let file=/^\/assets\/[a-z0-9_]+\.glb$/.test(path)?path.slice(1):/^\/assets\/audio\/[a-z0-9_]+\.mp3$/.test(path)?path.slice(1):path==='/'||path==='/index.html'?'index.html':null;
 if(!file){res.writeHead(404);res.end('Not found');return}
 if(file==='index.html'){
  let c=await loadHtmlCache();
  let wantsGzip=/\bgzip\b/i.test(req.headers['accept-encoding']||'');
  let body=wantsGzip?c.gz:c.raw;
  let headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding','Content-Length':body.length};
  if(wantsGzip)headers['Content-Encoding']='gzip';
  res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:body);return;
 }
 let data;try{data=await readFile(new URL('./'+file,import.meta.url))}catch(err){if(file.startsWith('assets/')&&err.code==='ENOENT'){let fallback=file.startsWith('assets/audio/')?file.slice('assets/audio/'.length):file.slice(7);try{data=await readFile(new URL('./'+fallback,import.meta.url))}catch(e){if(e.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}throw e}}else if(err.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}else throw err}
 let isAudio=file.endsWith('.mp3'),headers={'Content-Type':isAudio?'audio/mpeg':file.endsWith('.glb')?'model/gltf-binary':'text/html; charset=utf-8','Cache-Control':isAudio||file.endsWith('.glb')?'public, max-age=86400':'no-store'};
 if(isAudio){headers['Accept-Ranges']='bytes';let range=req.headers.range;if(range){let m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}let start=m[1]?Number(m[1]):Math.max(0,data.length-Number(m[2])),end=m[1]?(m[2]?Math.min(Number(m[2]),data.length-1):data.length-1):data.length-1;if(start>=data.length||end<start){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}headers['Content-Range']=`bytes ${start}-${end}/${data.length}`;headers['Content-Length']=end-start+1;res.writeHead(206,headers);res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));return}}
 headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data)
 }catch{res.writeHead(500);res.end('Build missing')}});
function damageDestructible(room,block,dmg){
 if(!block||!room.destructibles)return false;
 let target=room.destructibles.find(d=>d.id===block.id&&d.hp>0);
 if(!target)return false;
 target.hp=Math.max(0,target.hp-Math.round(dmg));
 let destroyed=target.hp<=0;
 broadcast(room,{type:'destructible_hit',id:target.id,hp:target.hp,maxHp:target.maxHp,x:target.x,z:target.z,destroyed});
 if(destroyed)broadcast(room,{type:'notice',text:'💥 УКРЫТИЕ РАЗРУШЕНО!'});
 return true;
}
function applyHeal(room,healer,target,rawHeal,now){
 if(!target||target.respawnAt||target.eliminated||target.hp<=0)return 0;
 let mult=now<(target.healDebuffUntil||0)?0.80:1.0;
 if(target.team&&target.role==='tank'&&teamSynergies(room,target.team).includes('tank_support'))mult*=1.20;
 let before=target.hp;
 target.hp=Math.min(target.maxHp||100,target.hp+Math.round(rawHeal*mult));
 let actual=target.hp-before;
 if(actual>0){
  if(healer&&healer.id!==target.id)healer.ultCharge=Math.min(100,(healer.ultCharge||0)+Math.round(actual*0.35));
  broadcast(room,{type:'hit',shooter:healer?healer.id:target.id,target:target.id,x:target.x,y:(target.y||0)+1.25,z:target.z,damage:actual,hp:target.hp,heal:true});
 }
 return actual;
}
function applyDamage(room,attacker,target,rawDmg,now,headshot=false){
 if(!target||target.respawnAt||target.eliminated||now<(target.invulnerableUntil||0))return false;
 let dmg=Math.max(1,Math.round(rawDmg));
 if(attacker&&now<(attacker.boostUntil||0))dmg=Math.round(dmg*1.30);
 if(attacker&&attacker.role==='dps'&&attacker.team&&teamSynergies(room,attacker.team).includes('tank_dps'))dmg=Math.round(dmg*1.12);
 if(room.sanctuaries?.some(s=>s.team===target.team&&s.until>now&&Math.hypot(target.x-s.x,target.z-s.z)<=5.5))dmg=Math.max(1,Math.round(dmg*0.60));
 target.lastDamagedAt=now;
 if(target.shieldActive&&target.shield>0){
  let absorbed=Math.min(target.shield,dmg);
  target.shield-=absorbed;dmg-=absorbed;
  if(target.shield<=0){target.shield=0;target.shieldActive=false;target.shieldBrokenAt=now;broadcast(room,{type:'notice',text:`🛡 ${target.name}: ЩИТ РАЗБИТ!`})}
  if(dmg<=0){
   if(attacker)attacker.ultCharge=Math.min(100,(attacker.ultCharge||0)+Math.round(absorbed*0.18));
   broadcast(room,{type:'hit',shooter:attacker?.id||null,target:target.id,x:target.x,y:(target.y||0)+1.15,z:target.z,damage:absorbed,hp:target.hp,shieldHit:true});
   return true;
  }
 }
 if(attacker&&attacker.role==='dps')target.healDebuffUntil=Math.max(target.healDebuffUntil||0,now+3000);
 target.hp-=dmg;
 if(attacker)attacker.ultCharge=Math.min(100,(attacker.ultCharge||0)+Math.round(dmg*0.28));
 broadcast(room,{type:'hit',shooter:attacker?.id||null,target:target.id,x:target.x,y:(target.y||0)+(headshot?1.62:.95),z:target.z,damage:dmg,hp:Math.max(0,target.hp),headshot});
 if(target.hp<=0){
  if(attacker)attacker.kills++;
  target.deaths++;dropNeoBall(room,target);target.hp=0;target.shieldActive=false;target.wallSliding=false;target.lastKickWall=null;
  if(room.mode==='chaser'){
   target.eliminated=true;target.respawnAt=0;
   broadcast(room,{type:'death',target:target.id,x:target.x,y:target.y||0,z:target.z,respawnAt:0,eliminated:true});
   if(target.id===room.chaser?.chaserId){
    broadcast(room,{type:'notice',text:`ДУХ ${target.name} ПОВЕРЖЕН!`});
    finish(room,'survivors');
   }else{
    broadcast(room,{type:'notice',text:`${target.name} ПОЙМАН ДУХОМ!`});
    if(![...room.players.values()].some(pl=>pl.team==='survivor'&&!pl.eliminated))finish(room,'chaser');
   }
  }else{
   target.respawnAt=now+RESPAWN_DELAY;
   broadcast(room,{type:'death',target:target.id,x:target.x,y:target.y||0,z:target.z,respawnAt:target.respawnAt});
   broadcast(room,{type:'notice',text:`${attacker?attacker.name:'АРЕНА'} ⚡ ${target.name}`});
  }
 }
 return true;
}
function isFriendly(room,a,b){
 if(!a||!b)return false;
 if(room.mode==='neoball')return a.team&&a.team===b.team;
 if(room.mode==='chaser')return a.team==='survivor'&&b.team==='survivor';
 return false;
}
function fireWeapon(room,p,aim,aimPitch,now,extraSpread=0){
 let w=weapons[p.weapon];if(!w)return;
 if(now<(p.stunUntil||0))return;
 p.lastShot=now;if(now<(p.invulnerableUntil||0)){p.invulnerableUntil=0;sync(room)}
 let blocks=liveBlocks(room),phase=mapPhase(room);
 let airborne=groundHeight(p.x,p.z,p.y,phase,blocks)===null,overclock=(p.weapon==='smg'&&p.wallSliding&&now-p.slideAt<200)||now<(p.overdriveUntil||0);
 let spread=(p.weapon==='smg'?(overclock?.005:w.spread*(airborne?1.1:1)):w.spread*(airborne?1.8:1))+extraSpread;
 let hits=new Map(),healHits=new Map(),destChanged=false;
 for(let pellet=0;pellet<(w.pellets||1);pellet++){
  let a=aim+(Math.random()-.5)*spread,pitch=Math.max(-1.15,Math.min(1.15,aimPitch+(Math.random()-.5)*spread)),cp=Math.cos(pitch),dx=Math.sin(a)*cp,dy=Math.sin(pitch),dz=-Math.cos(a)*cp;
  let wallRes=shotWallHit(phase,p.x,(p.y||0)+1.7,p.z,dx,dy,dz,w.range,blocks);
  let best=null,bestD=wallRes.dist,headshot=false,bestFriendly=false;
  for(let target of room.players.values()){
   if(target.id===p.id||target.respawnAt||target.eliminated||now<(target.invulnerableUntil||0))continue;
   let ally=isFriendly(room,p,target);
   if(ally&&p.role!=='support')continue;
   for(const part of [{height:1.62,radius:.33,head:true},{height:.95,radius:.63,head:false}]){
    let rx=target.x-p.x,ry=(target.y||0)+part.height-((p.y||0)+1.7),rz=target.z-p.z,along=rx*dx+ry*dy+rz*dz,side2=rx*rx+ry*ry+rz*rz-along*along,r=part.radius;
    if(along<=0||side2>r*r)continue;let entry=along-Math.sqrt(Math.max(0,r*r-side2));if(entry>0&&entry<w.range&&entry<bestD){best=target;bestD=entry;headshot=part.head;bestFriendly=ally}
   }
  }
  broadcast(room,{type:'shot',id:p.id,x:p.x,y:(p.y||0)+1.7,z:p.z,angle:a,pitch,range:bestD,weapon:p.weapon,weaponSkin:p.look?.weaponSkin||'default',healBeam:bestFriendly});
  if(best){
   if(bestFriendly){
    let hinfo=healHits.get(best.id)||{target:best,heal:0};
    hinfo.heal+=(p.weapon==='shotgun'?5:20);
    healHits.set(best.id,hinfo);
   }else{
    let base=p.weapon==='shotgun'?13:w.damage;let info=hits.get(best.id)||{target:best,damage:0,headshot:false};
    info.damage+=headshot?Math.round(base*1.5):base;info.headshot ||=headshot;hits.set(best.id,info);
   }
  }else if(wallRes.block?.id){
   if(damageDestructible(room,wallRes.block,p.weapon==='shotgun'?8:16))destChanged=true;
  }
 }
 for(const {target,damage,headshot} of hits.values())applyDamage(room,p,target,damage,now,headshot);
 for(const {target,heal} of healHits.values())applyHeal(room,p,target,heal,now);
 if(hits.size||healHits.size||destChanged)sync(room);
}
function castSkill(room,p,slot,aim,aimPitch,now){
 if(room.phase!=='match'||p.respawnAt||p.eliminated||now<(p.stunUntil||0))return;
 if(room.mode==='chaser'&&p.team==='chaser')return;
 const role=p.role||'dps',rdef=ROLE_DEFS[role];
 const blocks=liveBlocks(room),phase=mapPhase(room);
 if(slot===1){
  if(now<(p.skill1ReadyAt||0))return;
  if(role==='tank'){
   if(p.shieldActive){
    p.shieldActive=false;p.skill1ReadyAt=now+1200;sync(room);return;
   }
   if(p.shield<=10||now<(p.shieldBrokenAt||0)+3000)return;
   p.shieldActive=true;p.shieldUntil=now+5000;p.skill1ReadyAt=now+1000;
   broadcast(room,{type:'ability_fx',kind:'shield_up',id:p.id,x:p.x,y:p.y||0,z:p.z,angle:aim});
   sync(room);return;
  }
  p.skill1ReadyAt=now+rdef.skill1Cd;
  if(role==='dps'){
   let cp=Math.cos(aimPitch),dx=Math.sin(aim)*cp,dy=Math.sin(aimPitch),dz=-Math.cos(aim)*cp;
   let wallRes=shotWallHit(phase,p.x,(p.y||0)+1.6,p.z,dx,dy,dz,22,blocks);
   let ex=p.x+dx*wallRes.dist,ey=Math.max(0,(p.y||0)+1.6+dy*wallRes.dist),ez=p.z+dz*wallRes.dist;
   // Also detonate on nearest enemy along ray
   for(const t of room.players.values()){
    if(t.id===p.id||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
    let rx=t.x-p.x,ry=(t.y||0)+1-((p.y||0)+1.6),rz=t.z-p.z,along=rx*dx+ry*dy+rz*dz;
    if(along>0&&along<wallRes.dist&&Math.hypot(rx-dx*along,ry-dy*along,rz-dz*along)<1.2){ex=t.x;ey=(t.y||0)+1;ez=t.z;break}
   }
   broadcast(room,{type:'ability_fx',kind:'grenade',id:p.id,sx:p.x,sy:(p.y||0)+1.5,sz:p.z,x:ex,y:ey,z:ez});
   for(const t of room.players.values()){
    if(t.id===p.id||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
    let d=Math.hypot(t.x-ex,t.z-ez,(t.y||0)+1-ey);
    if(d<=4.6)applyDamage(room,p,t,Math.round(68*(1-d/6.0)),now,false);
   }
   if(room.destructibles)for(const b of room.destructibles)if(b.hp>0&&Math.hypot(b.x-ex,b.z-ez)<=5.0)damageDestructible(room,b,135);
   sync(room);return;
  }
  if(role==='support'){
   broadcast(room,{type:'ability_fx',kind:'bio_pulse',id:p.id,x:p.x,y:p.y||0,z:p.z});
   for(const t of room.players.values()){
    if(t.respawnAt||t.eliminated)continue;
    if(t.id===p.id||isFriendly(room,p,t)){
     if(Math.hypot(t.x-p.x,t.z-p.z)<=7.5){t.healDebuffUntil=0;applyHeal(room,p,t,58,now)}
    }
   }
   sync(room);return;
  }
 }
 if(slot===2){
  if(now<(p.skill2ReadyAt||0))return;
  p.skill2ReadyAt=now+rdef.skill2Cd;
  if(role==='tank'){
   broadcast(room,{type:'ability_fx',kind:'slam',id:p.id,x:p.x,y:p.y||0,z:p.z,angle:aim});
   for(const t of room.players.values()){
    if(t.id===p.id||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
    let d=Math.hypot(t.x-p.x,t.z-p.z);
    if(d<=5.2&&Math.abs((t.y||0)-(p.y||0))<3){
     applyDamage(room,p,t,48,now,false);
     let nx=(t.x-p.x)/(d||1),nz=(t.z-p.z)/(d||1);
     let pushed=constrainPosition(t.x+nx*3.4,t.z+nz*3.4,phase,t.y||0,blocks);
     t.x=pushed.x;t.z=pushed.z;
    }
   }
   if(room.destructibles)for(const b of room.destructibles)if(b.hp>0&&Math.hypot(b.x-p.x,b.z-p.z)<=5.8)damageDestructible(room,b,120);
   sync(room);return;
  }
  if(role==='dps'){
   p.overdriveUntil=now+3600;
   broadcast(room,{type:'ability_fx',kind:'overdrive',id:p.id,x:p.x,y:p.y||0,z:p.z});
   sync(room);return;
  }
  if(role==='support'){
   let target=p,bestD=14;
   for(const t of room.players.values()){
    if(t.id===p.id||t.respawnAt||t.eliminated||!isFriendly(room,p,t))continue;
    let d=Math.hypot(t.x-p.x,t.z-p.z);
    if(d<bestD){bestD=d;target=t}
   }
   target.boostUntil=now+4200;
   broadcast(room,{type:'ability_fx',kind:'nano_boost',id:p.id,targetId:target.id,sx:p.x,sy:(p.y||0)+1.2,sz:p.z,x:target.x,y:(target.y||0)+1.2,z:target.z});
   broadcast(room,{type:'notice',text:`⚡ ${target.name}: УСИЛЕНИЕ +30%!`});
   sync(room);return;
  }
 }
}
function castUltimate(room,p,aim,aimPitch,now){
 if(room.phase!=='match'||p.respawnAt||p.eliminated||(p.ultCharge||0)<100||now<(p.stunUntil||0))return;
 if(room.mode==='chaser'&&p.team==='chaser')return;
 p.ultCharge=0;
 const role=p.role||'dps',blocks=liveBlocks(room),phase=mapPhase(room);
 if(role==='tank'){
  broadcast(room,{type:'ability_fx',kind:'ult_shatter',id:p.id,x:p.x,y:p.y||0,z:p.z,angle:aim});
  broadcast(room,{type:'notice',text:`💥 ${p.name}: ТЕКТОНИЧЕСКИЙ РАЗЛОМ!`});
  const fx=Math.sin(aim),fz=-Math.cos(aim);
  for(const t of room.players.values()){
   if(t.id===p.id||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
   let dx=t.x-p.x,dz=t.z-p.z,d=Math.hypot(dx,dz);
   if(d<=10.5&&(d<2.2||(dx*fx+dz*fz)/d>.38)){
    t.stunUntil=now+1700;
    applyDamage(room,p,t,105,now,false);
   }
  }
  if(room.destructibles)for(const b of room.destructibles)if(b.hp>0&&Math.hypot(b.x-p.x,b.z-p.z)<=10.5)damageDestructible(room,b,200);
 }else if(role==='dps'){
  broadcast(room,{type:'ability_fx',kind:'ult_barrage',id:p.id,x:p.x,y:(p.y||0)+1.5,z:p.z,angle:aim,pitch:aimPitch});
  broadcast(room,{type:'notice',text:`⚔ ${p.name}: ШКВАЛ КЛИНКОВ!`});
  for(let k=-3;k<=3;k++){
   let a=aim+k*.11,cp=Math.cos(aimPitch),dx=Math.sin(a)*cp,dy=Math.sin(aimPitch),dz=-Math.cos(a)*cp;
   let wallRes=shotWallHit(phase,p.x,(p.y||0)+1.5,p.z,dx,dy,dz,26,blocks);
   let best=null,bestD=wallRes.dist;
   for(const t of room.players.values()){
    if(t.id===p.id||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
    let rx=t.x-p.x,ry=(t.y||0)+1.1-((p.y||0)+1.5),rz=t.z-p.z,along=rx*dx+ry*dy+rz*dz;
    if(along>0&&along<bestD&&Math.hypot(rx-dx*along,ry-dy*along,rz-dz*along)<1.05){best=t;bestD=along}
   }
   broadcast(room,{type:'shot',id:p.id,x:p.x,y:(p.y||0)+1.5,z:p.z,angle:a,pitch:aimPitch,range:bestD,weapon:'blade',weaponSkin:'hyper_prism'});
   if(best)applyDamage(room,p,best,44,now,false);
   else if(wallRes.block?.id)damageDestructible(room,wallRes.block,65);
  }
 }else{
  room.sanctuaries=room.sanctuaries||[];
  room.sanctuaries.push({id:randomUUID().slice(0,6),team:p.team||p.id,ownerId:p.id,x:p.x,y:p.y||0,z:p.z,until:now+5500});
  broadcast(room,{type:'ability_fx',kind:'ult_sanctuary',id:p.id,team:p.team,x:p.x,y:p.y||0,z:p.z});
  broadcast(room,{type:'notice',text:`💚 ${p.name}: КУПОЛ БЕССМЕРТИЯ!`});
 }
 sync(room);
}
function castTeamUp(room,p,aim,now){
 if(room.phase!=='match'||p.respawnAt||p.eliminated||now<(p.stunUntil||0)||now<(p.teamUpReadyAt||0))return;
 const syns=teamSynergies(room,p.team);
 if(!syns.includes('tank_dps')&&!syns.includes('tank_support')&&!syns.includes('dps_support'))return;
 p.teamUpReadyAt=now+9000;
 if(syns.includes('tank_dps')){
  // Chain Lightning arc up to 3 enemies
  let origin={x:p.x,y:(p.y||0)+1.4,z:p.z};
  let chain=[],used=new Set();
  for(let hop=0;hop<3;hop++){
   let best=null,bd=hop===0?14:8;
   for(const t of room.players.values()){
    if(t.id===p.id||used.has(t.id)||t.respawnAt||t.eliminated||isFriendly(room,p,t))continue;
    let d=Math.hypot(t.x-origin.x,t.z-origin.z);
    if(d<bd){bd=d;best=t}
   }
   if(!best)break;
   used.add(best.id);
   chain.push({sx:origin.x,sy:origin.y,sz:origin.z,x:best.x,y:(best.y||0)+1.2,z:best.z});
   applyDamage(room,p,best,42,now,false);
   origin={x:best.x,y:(best.y||0)+1.2,z:best.z};
  }
  if(chain.length)broadcast(room,{type:'ability_fx',kind:'chain_lightning',id:p.id,chain});
  else broadcast(room,{type:'ability_fx',kind:'bio_pulse',id:p.id,x:p.x,y:p.y||0,z:p.z});
 }else{
  p.shield=Math.min(p.maxShield||0,(p.shield||0)+75);
  applyHeal(room,p,p,55,now);
  broadcast(room,{type:'ability_fx',kind:'bio_pulse',id:p.id,x:p.x,y:p.y||0,z:p.z});
 }
 sync(room);
}
function chaserSlash(room,p,aim,now,targetId=null){
 if(room.mode!=='chaser'||room.phase!=='match'||p.team!=='chaser'||p.eliminated||p.respawnAt)return;
 p.lastShot=now;
 if(now<(p.invulnerableUntil||0)){p.invulnerableUntil=0;sync(room)}
 broadcast(room,{type:'chaser_slash',id:p.id,x:p.x,y:p.y||0,z:p.z,angle:aim});
 const phase=mapPhase(room),fwdX=Math.sin(aim),fwdZ=-Math.cos(aim);
 const maxReach=targetId?4.4:3.6;
 let best=null,bestScore=Infinity;
 for(const target of room.players.values()){
  if(target.id===p.id||target.team!=='survivor'||target.eliminated||target.respawnAt||now<(target.invulnerableUntil||0))continue;
  if(targetId&&target.id!==targetId)continue;
  let dx=target.x-p.x,dz=target.z-p.z,horiz=Math.hypot(dx,dz);
  let dy=(target.y||0)+1.0-((p.y||0)+1.0),d3=Math.hypot(dx,dy,dz)||.001;
  if(horiz>maxReach||Math.abs((target.y||0)-(p.y||0))>2.8)continue;
  if(!targetId&&horiz>0.9){
   let dot=(dx*fwdX+dz*fwdZ)/horiz;
   if(dot<.42)continue;
  }
  let wallD=shotWallDistance(phase,p.x,(p.y||0)+1.3,p.z,dx/d3,dy/d3,dz/d3,d3,liveBlocks(room));
  if(wallD<d3-.45)continue;
  if(horiz<bestScore){bestScore=horiz;best=target}
 }
 if(!best&&targetId)return chaserSlash(room,p,aim,now,null);
 if(!best)return;
 let dmg=Math.max(100,best.hp||100);
 best.hp=0;best.eliminated=true;best.respawnAt=0;best.wallSliding=false;best.lastKickWall=null;
 p.kills++;best.deaths++;
 broadcast(room,{type:'hit',shooter:p.id,target:best.id,x:best.x,y:(best.y||0)+1.15,z:best.z,damage:dmg,hp:0,headshot:false});
 broadcast(room,{type:'death',target:best.id,x:best.x,y:best.y||0,z:best.z,respawnAt:0,eliminated:true});
 broadcast(room,{type:'notice',text:`${best.name} ПОЙМАН КОСОЙ!`});
 sync(room);
 if(![...room.players.values()].some(pl=>pl.team==='survivor'&&!pl.eliminated))finish(room,'chaser');
}
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{let c={id:randomUUID(),ws,code:null};clients.set(ws,c);send(ws,{type:'hello',id:c.id,weapons,outfits,weaponSkins,roleDefs:ROLE_DEFS});ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m.type!=='string')return;
if(m.type==='join'){if(c.code)return;let code=String(m.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);let room;
 if(!code&&!m.private){room=hub;code='HUB'}else{if(!code){do{code=randomInt(10000,100000).toString()}while(rooms.has(code));room={code,mode:'private',privateMode:m.roomMode==='control'?'control':'classic',map:'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null};rooms.set(code,room)}else{room=rooms.get(code);if(!room||room.mode==='hub'){send(ws,{type:'error',text:'Комната не найдена'});return}}}
 if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)tryStartRoom(room);
 if(room.players.size>=(room.mode==='hub'?HUB_LIMIT:4)||room.phase!=='lobby'||room.locked){send(ws,{type:'error',text:room.mode==='hub'?'Общее лобби заполнено':'Комната заполнена или матч уже начался'});return}
 let name=String(m.name||'Игрок').trim().slice(0,20)||'Игрок';
 let look={...(presets[m.look?.character]||presets.shadow),outfit:'default',weaponSkin:'default'};
 let role=validRole(m.look?.role||HERO_DEFAULT_ROLES[look.character]);
 let rdef=ROLE_DEFS[role];
 let offset=room.mode==='hub'?((room.players.size%5)-2)*.8:0;let p={id:c.id,ws,name,look,role,x:offset,z:-8,y:0,flip:0,angle:0,pitch:0,hp:rdef.maxHp,maxHp:rdef.maxHp,shield:rdef.maxShield,maxShield:rdef.maxShield,shieldActive:false,shieldUntil:0,shieldBrokenAt:0,ultCharge:0,skill1ReadyAt:0,skill2ReadyAt:0,teamUpReadyAt:0,stunUntil:0,healDebuffUntil:0,overdriveUntil:0,boostUntil:0,lastDamagedAt:0,eliminated:false,kills:0,deaths:0,ready:false,seated:false,weapon:'smg',coins:10000,owned:['smg','shotgun'],ownedOutfits:['default'],ownedWeaponSkins:['default'],lastShot:0,lastMove:Date.now(),moveCredit:2,moveSeq:0,spawnRev:0,respawnAt:0,invulnerableUntil:0,queue:null,vote:null,botChoice:null,botPromptedZone:null};room.players.set(c.id,p);c.code=code;send(ws,{type:'joined',code,id:c.id});sync(room);return}
let room=rooms.get(c.code),p=room?.players.get(c.id);if(!p)return;if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)tryStartRoom(room);if(room.mode==='neoball'&&room.phase==='match')neoCheckClock(room);
if(m.type==='role'&&room.phase==='lobby'){
 p.role=validRole(m.role);let rdef=ROLE_DEFS[p.role];
 p.hp=rdef.maxHp;p.maxHp=rdef.maxHp;p.shield=rdef.maxShield;p.maxShield=rdef.maxShield;
 sync(room);return;
}
if(m.type==='private_mode'&&room.mode==='private'&&room.phase==='lobby'){
 room.privateMode=m.mode==='control'?'control':'classic';
 broadcast(room,{type:'notice',text:room.privateMode==='control'?'РЕЖИМ: ЗАХВАТ ТОЧКИ':'РЕЖИМ: КЛАССИЧЕСКИЙ БОЙ'});
 sync(room);return;
}
if(m.type==='mapvote'&&room.mode==='voting'&&room.phase==='lobby'){if(['duct','colosseum','station','garden'].includes(m.map)){p.vote=m.map;sync(room)}return}
if(m.type==='bot_choice'&&room.phase==='lobby'){
 if(room.mode==='hub'){
  let zone=HUB_ZONES.find(z=>z.id===p.queue);if(!zone)return;
  p.botChoice=m.accept?'accept':'wait';
  updateHubQueues();sync(room);
 }else if(room.mode==='private'){
  room.botPrompted=false;
  if(m.accept){room.botConsent=true;start(room)}
  else{room.botConsent=false;room.countdown=0;p.vote=null;sync(room)}
 }
 return;
}
if(m.type==='sit'&&room.phase==='lobby'){
 let hx=0,hz=room.mode==='hub'?11.78:6.2;
 if(m.seated){
  if(Math.hypot(p.x-hx,p.z-hz)<=3.5){
   let taken=[...room.players.values()].some(o=>o.id!==p.id&&o.seated);
   if(taken){send(ws,{type:'error',text:'Пульт капитана уже занят'});return}
   p.seated=true;p.x=hx;p.z=hz;p.y=0;p.angle=Math.PI;p.queue=null;p.botChoice=null;if(p.botPromptedZone){p.botPromptedZone=null;send(p.ws,{type:'bot_prompt_close'})}updateHubQueues();sync(room);
  }
 }else if(p.seated){p.seated=false;p.z=hz-1.2;sync(room)}
 return;
}
if(m.type==='hyperdrive'&&room.phase==='lobby'){
 let hx=0,hz=room.mode==='hub'?11.78:6.2,now=Date.now();
 if(!p.seated&&Math.hypot(p.x-hx,p.z-hz)>3.5)return;
 if(now-(room.lastHyperdrive||0)<7500){send(ws,{type:'error',text:'Гипердвигатель перезаряжается'});return}
 room.lastHyperdrive=now;room.sector=((room.sector||0)+1)%4;
 broadcast(room,{type:'hyperdrive',by:p.name,sector:room.sector,duration:7200});
 sync(room);return;
}
if(m.type==='leave'){leave(c);send(ws,{type:'left'});return}
if(m.type==='wallbounce'){if(p.respawnAt||p.eliminated)return;let now=Date.now(),normal=wallContact(p.x,p.z,mapPhase(room),p.y,liveBlocks(room));if(m.epoch===room.epoch&&m.spawnRev===p.spawnRev&&normal&&p.y>.05&&now-(p.lastBounce||0)>140&&p.lastKickWall!==normal.id){p.lastBounce=now;p.lastKickWall=normal.id;p.wallSliding=false;broadcast(room,{type:'wallbounce',id:p.id,x:p.x,y:p.y,z:p.z,nx:normal.x,nz:normal.z})}return}
if(m.type==='weapon'&&p.owned.includes(m.weapon)){p.weapon=m.weapon;sync(room);return}
if(m.type==='buy'&&room.phase==='lobby'){let w=weapons[m.weapon];if(w&&w.price>0&&!p.owned.includes(m.weapon)&&p.coins>=w.price){p.coins-=w.price;p.owned.push(m.weapon);p.weapon=m.weapon;sync(room)}else send(ws,{type:'error',text:'Не хватает монет или оружие уже куплено'});return}
if(m.type==='outfit'){let id=String(m.id||'');if(p.ownedOutfits.includes(id)){p.look={...p.look,outfit:id};sync(room);return}let item=outfits[id];if(room.phase==='lobby'&&item&&p.coins>=item.price){p.coins-=item.price;p.ownedOutfits.push(id);p.look={...p.look,outfit:id};sync(room)}else send(ws,{type:'error',text:room.phase!=='lobby'?'Покупка доступна только в лобби':'Не хватает монет'});return}
if(m.type==='weapon_skin'){let id=String(m.id||'');if(p.ownedWeaponSkins.includes(id)){p.look={...p.look,weaponSkin:id};sync(room);return}let item=weaponSkins[id];if(room.phase==='lobby'&&item&&p.coins>=item.price){p.coins-=item.price;p.ownedWeaponSkins.push(id);p.look={...p.look,weaponSkin:id};sync(room)}else send(ws,{type:'error',text:room.phase!=='lobby'?'Покупка доступна только в лобби':'Не хватает монет'});return}
if(m.type==='move'){if(room.phase==='ending'||room.phase==='results'||p.respawnAt||p.eliminated)return;if(Number.isInteger(m.epoch)&&m.epoch!==room.epoch)return;if(Number.isInteger(m.spawnRev)&&m.spawnRev!==p.spawnRev)return;let seq=Number.isSafeInteger(m.seq)?m.seq:p.moveSeq+1;if(seq<=p.moveSeq)return;p.moveSeq=seq;if(p.seated){p.angle=Number.isFinite(+m.angle)?+m.angle:p.angle;return}let x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z))return;let now=Date.now();if(now<(p.stunUntil||0))return;let delta=Math.min(1,Math.max(0,(now-p.lastMove)/1000));p.lastMove=now;p.moveCredit=Math.min(12,(p.moveCredit||0)+delta*22);let dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz),max=p.moveCredit;if(d>max&&d>0){dx*=max/d;dz*=max/d}p.moveCredit=Math.max(0,p.moveCredit-Math.hypot(dx,dz));let blocks=liveBlocks(room);let oldY=p.y;p.y=Number.isFinite(+m.y)?Math.max(0,Math.min(8,+m.y)):0;let n=wallContact(p.x,p.z,mapPhase(room),p.y,blocks),mx=Number(m.ix)||0,mz=Number(m.iz)||0;let inputLength=Math.hypot(mx,mz);if(inputLength>1){mx/=inputLength;mz/=inputLength}p.wallSliding=!!(m.slide&&n&&groundHeight(p.x,p.z,p.y,mapPhase(room),blocks)===null&&p.y<=oldY+.04&&mx*n.x+mz*n.z<-.15);p.slideAt=now;if(groundHeight(p.x,p.z,p.y,mapPhase(room),blocks)!==null)p.lastKickWall=null;let constrained=constrainPosition(p.x+dx,p.z+dz,mapPhase(room),p.y,blocks);p.x=constrained.x;p.z=constrained.z;p.flip=Number.isFinite(+m.flip)?Math.max(0,Math.min(1,+m.flip)):0;p.angle=Number.isFinite(+m.angle)?+m.angle:0;p.pitch=Number.isFinite(+m.pitch)?Math.max(-1.15,Math.min(1.15,+m.pitch)):(p.pitch||0);if(room.mode==='neoball')neoUpdatePlayer(room,p);if(room.phase==='lobby'&&room.mode==='hub'){let zone=HUB_ZONES.find(z=>Math.hypot(p.x-z.x,p.z-z.z)<=z.radius);if(p.queue&&(!zone||p.queue!==zone.id)){p.queue=null;p.botChoice=null;if(p.botPromptedZone){p.botPromptedZone=null;send(p.ws,{type:'bot_prompt_close'})}}if(!p.queue&&zone&&[...room.players.values()].filter(q=>q.queue===zone.id).length<zone.capacity)p.queue=zone.id;updateHubQueues()}else if(room.phase==='lobby'&&room.mode==='private'){let vote=voteAt(p.x,p.z);if(vote&&!room.countdown&&!room.botPrompted)room.countdown=now+LEGACY_VOTE_DURATION;if(vote!==p.vote){p.vote=vote;sync(room)}}return}
if(m.type==='chaser_attack'&&room.phase==='match'){
 if(room.mode!=='chaser'||p.team!=='chaser'||p.respawnAt||p.eliminated)return;
 let now=Date.now();if(now-(p.lastShot||0)<520)return;
 let aim=Number.isFinite(+m.angle)?+m.angle:p.angle;
 let targetId=typeof m.targetId==='string'?m.targetId:null;
 chaserSlash(room,p,aim,now,targetId);return
}
if(m.type==='skill'&&room.phase==='match'){
 let slot=m.slot===2?2:1,aim=Number.isFinite(+m.angle)?+m.angle:p.angle,aimPitch=Number.isFinite(+m.pitch)?+m.pitch:(p.pitch||0);
 castSkill(room,p,slot,aim,aimPitch,Date.now());return
}
if(m.type==='ult'&&room.phase==='match'){
 let aim=Number.isFinite(+m.angle)?+m.angle:p.angle,aimPitch=Number.isFinite(+m.pitch)?+m.pitch:(p.pitch||0);
 castUltimate(room,p,aim,aimPitch,Date.now());return
}
if(m.type==='teamup'&&room.phase==='match'){
 let aim=Number.isFinite(+m.angle)?+m.angle:p.angle;
 castTeamUp(room,p,aim,Date.now());return
}
if(m.type==='shoot'&&room.phase==='match'){
 if(p.respawnAt||p.eliminated)return;
 if(room.mode==='chaser'&&p.team==='chaser')return;
 let w=weapons[p.weapon],now=Date.now();if(!w)return;let overclock=(p.weapon==='smg'&&p.wallSliding&&now-p.slideAt<200)||now<(p.overdriveUntil||0),rate=overclock?w.rate*.62:w.rate;if(now-p.lastShot<rate)return;
 let aim=Number(m.angle),aimPitch=Number(m.pitch);if(!Number.isFinite(aim)||!Number.isFinite(aimPitch))return;
 fireWeapon(room,p,aim,aimPitch,now,0);return
}
});ws.on('close',()=>{leave(c);clients.delete(ws)})});
function neoNavTarget(bx,bz,tx,tz){
 const gates=[{z:-38,x:11},{z:-19,x:-11},{z:19,x:11},{z:38,x:-11}];
 if(tz>bz+1){
  for(const g of gates)if(bz<g.z-1.2&&tz>g.z+1.2)return {x:g.x,z:g.z+2.2};
 }else if(tz<bz-1){
  for(let i=gates.length-1;i>=0;i--){let g=gates[i];if(bz>g.z+1.2&&tz<g.z-1.2)return {x:g.x,z:g.z-2.2}}
 }
 return {x:tx,z:tz};
}
function gardenNavTarget(bx,bz,tx,tz){
 const houses=[
  {cx:-10,cz:-4,minX:-13.6,maxX:-6.4,minZ:-7.6,maxZ:-0.4,doors:[[-10,-0.1],[-6.1,-4]]},
  {cx:10,cz:4,minX:6.4,maxX:13.6,minZ:0.4,maxZ:7.6,doors:[[10,0.1],[6.1,4]]}
 ];
 for(const h of houses){
  let bIn=bx>=h.minX&&bx<=h.maxX&&bz>=h.minZ&&bz<=h.maxZ;
  let tIn=tx>=h.minX&&tx<=h.maxX&&tz>=h.minZ&&tz<=h.maxZ;
  if(bIn!==tIn){
   let best=h.doors[0],bd=Infinity;
   for(const [dx,dz] of h.doors){let d=Math.hypot(dx-bx,dz-bz)+Math.hypot(tx-dx,tz-dz);if(d<bd){bd=d;best=[dx,dz]}}
   if(Math.hypot(bx-best[0],bz-best[1])>1.1)return {x:best[0],z:best[1]};
  }
 }
 return {x:tx,z:tz};
}
function tickBots(room,now,dt){
 if(room.phase!=='match'||room.mode==='hub')return;
 const phase=mapPhase(room);
 const allPlayers=[...room.players.values()];
 for(const bot of allPlayers){
  if(!bot.isBot||bot.respawnAt||bot.eliminated)continue;
  let ai=bot.ai||(bot.ai={strafeDir:1,strafeUntil:0,jumpAt:0,vy:0,wanderX:0,wanderZ:0,wanderUntil:0,stuckTicks:0});
  if(now<(bot.stunUntil||0))continue;
  if(now>ai.strafeUntil){ai.strafeDir=randomInt(0,2)?1:-1;ai.strafeUntil=now+1200+randomInt(0,1600)}
  const blocks=liveBlocks(room);
  if(bot.y>0||ai.vy!==0){
   let oldY=bot.y;ai.vy-=22*(ai.vy>0?1:2.3)*dt;
   let nextY=bot.y+ai.vy*dt,land=ai.vy<0?landingHeight(bot.x,bot.z,oldY,nextY,phase,blocks):null;
   if(land!==null){bot.y=land;ai.vy=0}else{bot.y=Math.max(0,nextY);if(bot.y===0)ai.vy=0}
  }
  let enemies=allPlayers.filter(o=>o.id!==bot.id&&!o.respawnAt&&!o.eliminated&&!isFriendly(room,bot,o));
  let allies=allPlayers.filter(o=>o.id!==bot.id&&!o.respawnAt&&!o.eliminated&&isFriendly(room,bot,o));
  let nearestEnemy=null,nearestDist=Infinity,visibleEnemy=null,visibleDist=Infinity;
  for(const e of enemies){
   let d=Math.hypot(e.x-bot.x,e.z-bot.z);
   if(d<nearestDist){nearestDist=d;nearestEnemy=e}
   let dy=(e.y||0)+1.2-(bot.y+1.7),d3=Math.hypot(e.x-bot.x,dy,e.z-bot.z)||1;
   let wallD=shotWallDistance(phase,bot.x,bot.y+1.7,bot.z,(e.x-bot.x)/d3,dy/d3,(e.z-bot.z)/d3,d3,blocks);
   if(wallD>=d3-.45&&d<visibleDist){visibleDist=d;visibleEnemy=e}
  }
  // Support looks for injured visible ally
  let healAlly=null,healAllyDist=Infinity;
  if(bot.role==='support'){
   for(const a of allies){
    if(a.hp>=a.maxHp*0.88)continue;
    let d=Math.hypot(a.x-bot.x,a.z-bot.z);
    let dy=(a.y||0)+1.1-(bot.y+1.7),d3=Math.hypot(a.x-bot.x,dy,a.z-bot.z)||1;
    let wallD=shotWallDistance(phase,bot.x,bot.y+1.7,bot.z,(a.x-bot.x)/d3,dy/d3,(a.z-bot.z)/d3,d3,blocks);
    if(wallD>=d3-.45&&d<healAllyDist){healAllyDist=d;healAlly=a}
   }
  }
  const role=bot.role||'dps',lowHp=bot.hp<(bot.maxHp||100)*0.34;
  let goalX=bot.x,goalZ=bot.z,speed=room.mode==='chaser'?(bot.team==='chaser'?5.9:5.4):(role==='dps'?5.6:role==='tank'?4.8:5.2);
  if(room.mode==='neoball'&&room.neo){
   let neo=room.neo,ball=neo.ball;
   if(ball.holder===bot.id){
    let nav=neoNavTarget(bot.x,bot.z,0,bot.team==='A'?56:-56);
    goalX=nav.x;goalZ=nav.z;
   }else if(!ball.holder&&!neo.resetAt){
    let nav=neoNavTarget(bot.x,bot.z,ball.x,ball.z);
    goalX=nav.x;goalZ=nav.z;
   }else if(ball.holder){
    let holder=room.players.get(ball.holder);
    if(holder&&holder.team!==bot.team){let nav=neoNavTarget(bot.x,bot.z,holder.x,holder.z);goalX=nav.x;goalZ=nav.z}
    else if(nearestEnemy){let nav=neoNavTarget(bot.x,bot.z,nearestEnemy.x,nearestEnemy.z);goalX=nav.x;goalZ=nav.z}
   }else if(nearestEnemy){
    let nav=neoNavTarget(bot.x,bot.z,nearestEnemy.x,nearestEnemy.z);goalX=nav.x;goalZ=nav.z;
   }
  }else if(room.mode==='chaser'){
   if(bot.team==='chaser'&&nearestEnemy){
    let nav=gardenNavTarget(bot.x,bot.z,nearestEnemy.x,nearestEnemy.z);goalX=nav.x;goalZ=nav.z;
   }else if(bot.team==='survivor'&&nearestEnemy){
    if(nearestDist<10.5){
     let awayA=Math.atan2(bot.x-nearestEnemy.x,bot.z-nearestEnemy.z)+ai.strafeDir*.55;
     goalX=bot.x+Math.sin(awayA)*8;goalZ=bot.z+Math.cos(awayA)*8;
    }else if(nearestDist>18){
     let nav=gardenNavTarget(bot.x,bot.z,nearestEnemy.x,nearestEnemy.z);goalX=nav.x;goalZ=nav.z;
    }else{
     let perpA=Math.atan2(nearestEnemy.z-bot.z,nearestEnemy.x-bot.x)+ai.strafeDir*Math.PI/2;
     goalX=bot.x+Math.cos(perpA)*5;goalZ=bot.z+Math.sin(perpA)*5;
    }
   }
  }else if(lowHp&&nearestEnemy&&visibleEnemy){
   // Seek nearest intact cover away from enemy
   let bestCover=null,bestScore=Infinity;
   for(const b of (room.destructibles||[])){
    if(b.hp<=0)continue;
    let db=Math.hypot(b.x-bot.x,b.z-bot.z),de=Math.hypot(b.x-nearestEnemy.x,b.z-nearestEnemy.z);
    if(db<16&&de>4){let sc=db-de*.35;if(sc<bestScore){bestScore=sc;bestCover=b}}
   }
   if(bestCover){
    let awayX=bestCover.x-nearestEnemy.x,awayZ=bestCover.z-nearestEnemy.z,al=Math.hypot(awayX,awayZ)||1;
    goalX=bestCover.x+(awayX/al)*1.9;goalZ=bestCover.z+(awayZ/al)*1.9;
   }else{
    let away=Math.atan2(bot.z-nearestEnemy.z,bot.x-nearestEnemy.x);
    goalX=bot.x+Math.cos(away)*6;goalZ=bot.z+Math.sin(away)*6;
   }
  }else if(room.mode==='control'&&room.control){
   let distPt=Math.hypot(bot.x-CONTROL_POINT.x,bot.z-CONTROL_POINT.z);
   let needPoint=room.control.ownerId!==bot.id||room.control.contested||distPt>CONTROL_POINT.radius*0.85;
   if(needPoint&&distPt>2.5){
    goalX=CONTROL_POINT.x+ai.strafeDir*2.2;goalZ=CONTROL_POINT.z+(ai.strafeDir>0?-1.5:1.5);
   }else if(healAlly&&healAllyDist>6){
    goalX=healAlly.x;goalZ=healAlly.z;
   }else if(visibleEnemy){
    let perp=Math.atan2(visibleEnemy.z-bot.z,visibleEnemy.x-bot.x)+ai.strafeDir*Math.PI/2;
    goalX=CONTROL_POINT.x+Math.cos(perp)*3.4;goalZ=CONTROL_POINT.z+Math.sin(perp)*3.4;
   }
  }else if(healAlly&&role==='support'&&healAllyDist>7){
   goalX=healAlly.x;goalZ=healAlly.z;
  }else if(nearestEnemy){
   let pref=role==='tank'?5.2:(bot.weapon==='shotgun'?6.5:11.5);
   if(visibleEnemy&&visibleDist<pref*1.15&&visibleDist>pref*.55){
    let perp=Math.atan2(visibleEnemy.z-bot.z,visibleEnemy.x-bot.x)+ai.strafeDir*Math.PI/2;
    goalX=bot.x+Math.cos(perp)*4;goalZ=bot.z+Math.sin(perp)*4;
   }else if(visibleEnemy&&visibleDist<=pref*.55){
    let away=Math.atan2(bot.z-visibleEnemy.z,bot.x-visibleEnemy.x);
    goalX=bot.x+Math.cos(away)*5;goalZ=bot.z+Math.sin(away)*5;
   }else{
    goalX=nearestEnemy.x;goalZ=nearestEnemy.z;
   }
  }else if(now>ai.wanderUntil){
   ai.wanderX=(randomInt(-14,15));ai.wanderZ=(randomInt(-14,15));ai.wanderUntil=now+3000;
   goalX=ai.wanderX;goalZ=ai.wanderZ;
  }
  let mdx=goalX-bot.x,mdz=goalZ-bot.z,md=Math.hypot(mdx,mdz);
  if(md>.25){
   let vx=(mdx/md)*speed,vz=(mdz/md)*speed;
   let c=constrainPosition(bot.x+vx*dt,bot.z+vz*dt,phase,bot.y,blocks);
   let moved=Math.hypot(c.x-bot.x,c.z-bot.z);
   if(moved<speed*dt*.28){
    ai.stuckTicks++;
    if(ai.stuckTicks>=2){
     ai.strafeDir*=-1;
     let sideX=(-mdz/md)*ai.strafeDir,sideZ=(mdx/md)*ai.strafeDir;
     c=constrainPosition(bot.x+sideX*speed*dt,bot.z+sideZ*speed*dt,phase,bot.y,blocks);
     if(groundHeight(bot.x,bot.z,bot.y,phase,blocks)!==null&&now>ai.jumpAt){ai.vy=9;ai.jumpAt=now+1300}
    }
   }else ai.stuckTicks=0;
   bot.x=c.x;bot.z=c.z;
  }
  if(room.mode==='neoball')neoUpdatePlayer(room,bot);
  if(room.phase!=='match')return;
  let primaryTarget=(healAlly&&(!visibleEnemy||healAlly.hp<healAlly.maxHp*0.65))?healAlly:(visibleEnemy||nearestEnemy);
  if(primaryTarget){
   let adx=primaryTarget.x-bot.x,ady=(primaryTarget.y||0)+1.2-(bot.y+1.7),adz=primaryTarget.z-bot.z;
   bot.angle=Math.atan2(adx,-adz);
   bot.pitch=Math.max(-1.1,Math.min(1.1,Math.atan2(ady,Math.hypot(adx,adz)||1)));
  }else if(md>.25){
   bot.angle=Math.atan2(mdx,-mdz);
   bot.pitch=0;
  }else{
   bot.pitch=0;
  }
  if(room.mode==='chaser'&&bot.team==='chaser'){
   if(visibleEnemy&&visibleDist<=3.2&&now-(bot.lastShot||0)>=680&&now>=(bot.invulnerableUntil||0)-1500&&now>=(visibleEnemy.invulnerableUntil||0)){
    chaserSlash(room,bot,bot.angle,now,visibleEnemy.id);
    if(room.phase!=='match')return;
   }
  }else{
   // Role-based smart skills & ultimates
   if((bot.ultCharge||0)>=100&&visibleEnemy&&visibleDist<14){
    if(role==='support'&&bot.hp<bot.maxHp*0.75)castUltimate(room,bot,bot.angle,bot.pitch,now);
    else if(role!=='support'&&visibleDist<10.5)castUltimate(room,bot,bot.angle,bot.pitch,now);
   }
   if(role==='tank'){
    if(!bot.shieldActive&&bot.shield>60&&visibleEnemy&&visibleDist<13&&(lowHp||now>=(bot.skill1ReadyAt||0)))castSkill(room,bot,1,bot.angle,bot.pitch,now);
    if(visibleEnemy&&visibleDist<4.8&&now>=(bot.skill2ReadyAt||0))castSkill(room,bot,2,bot.angle,bot.pitch,now);
   }else if(role==='dps'){
    if(visibleEnemy&&visibleDist<16&&now>=(bot.skill1ReadyAt||0))castSkill(room,bot,1,bot.angle,bot.pitch,now);
    if(visibleEnemy&&visibleDist<14&&now>=(bot.skill2ReadyAt||0))castSkill(room,bot,2,bot.angle,bot.pitch,now);
   }else if(role==='support'){
    if((bot.hp<bot.maxHp*0.65||healAlly)&&now>=(bot.skill1ReadyAt||0))castSkill(room,bot,1,bot.angle,bot.pitch,now);
    if(allies.length&&visibleEnemy&&now>=(bot.skill2ReadyAt||0))castSkill(room,bot,2,bot.angle,bot.pitch,now);
   }
   if(visibleEnemy&&visibleDist<13&&now>=(bot.teamUpReadyAt||0))castTeamUp(room,bot,bot.angle,now);
   if(room.phase!=='match')return;
   let w=weapons[bot.weapon],shootTarget=(healAlly&&role==='support'&&healAlly.hp<healAlly.maxHp*0.72)?healAlly:visibleEnemy;
   let shootDist=shootTarget===healAlly?healAllyDist:visibleDist;
   let botRate=(now<(bot.overdriveUntil||0)?0.65:1)*(bot.weapon==='smg'?230:1050);
   if(shootTarget&&w&&shootDist<w.range&&now-bot.lastShot>=botRate&&now>=(bot.invulnerableUntil||0)-1500&&now>=(shootTarget.invulnerableUntil||0)){
    let dx=shootTarget.x-bot.x,dy=(shootTarget.y||0)+1.2-(bot.y+1.7),dz=shootTarget.z-bot.z;
    let aim=Math.atan2(dx,-dz),horiz=Math.hypot(dx,dz)||1,aimPitch=Math.max(-1.1,Math.min(1.1,Math.atan2(dy,horiz)));
    fireWeapon(room,bot,aim,aimPitch,now,bot.weapon==='smg'?.095:.055);
    if(room.phase!=='match')return;
   }
  }
 }
}
function launchQueue(zone){let members=[...hub.players.values()].filter(p=>p.queue===zone.id);if(members.length<1||members.length>zone.capacity){hub.queues[zone.id].ends=0;return}let code;do{code=randomInt(10000,100000).toString()}while(rooms.has(code));let mode=zone.mode==='neoball'?'neoball':zone.mode==='chaser'?'chaser':zone.mode==='control'?'control':'voting';let room={code,mode,locked:true,map:mode==='neoball'?'neoball':mode==='chaser'?'garden':mode==='control'?'colosseum':'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:1,countdown:(mode==='neoball'||mode==='chaser'||mode==='control')?0:Date.now()+VOTE_DURATION,results:null};rooms.set(code,room);for(let [i,p] of members.entries()){hub.players.delete(p.id);p.queue=null;p.vote=null;p.botChoice=null;p.botPromptedZone=null;p.seated=false;p.x=(i-1.5)*1.1;p.z=-7;p.y=0;p.flip=0;p.wallSliding=false;p.lastKickWall=null;p.respawnAt=0;p.eliminated=false;p.moveCredit=2;p.lastMove=Date.now();room.players.set(p.id,p);let c=clients.get(p.ws);if(c)c.code=code;send(p.ws,{type:'joined',code,id:p.id,transfer:true})}let targetCount=zone.mode==='chaser'?Math.max(zone.minPlayers||3,members.length):zone.capacity;fillRoomBots(room,targetCount);hub.queues[zone.id].ends=0;updateHubQueues();sync(hub);if(mode==='neoball'||mode==='chaser'||mode==='control')start(room);else sync(room)}
function returnToHub(room){for(const p of room.players.values()){if(p.isBot)continue;if(hub.players.size>=HUB_LIMIT){let c=clients.get(p.ws);if(c)c.code=null;send(p.ws,{type:'left'});continue}let rdef=ROLE_DEFS[validRole(p.role)];p.x=((hub.players.size%5)-2)*.8;p.z=-8;p.y=0;p.flip=0;p.hp=rdef.maxHp;p.maxHp=rdef.maxHp;p.shield=rdef.maxShield;p.maxShield=rdef.maxShield;p.shieldActive=false;p.ultCharge=0;p.stunUntil=0;p.healDebuffUntil=0;p.overdriveUntil=0;p.boostUntil=0;p.eliminated=false;p.ready=false;p.seated=false;p.queue=null;p.vote=null;p.botChoice=null;p.botPromptedZone=null;p.team=null;p.respawnAt=0;p.moveCredit=2;p.lastMove=Date.now();p.invulnerableUntil=0;hub.players.set(p.id,p);let c=clients.get(p.ws);if(c)c.code='HUB';send(p.ws,{type:'joined',code:'HUB',id:p.id,transfer:true})}rooms.delete(room.code);sync(hub)}
let tickCount=0;
setInterval(()=>{
 let now=Date.now();tickCount++;
 updateHubQueues();
 for(const zone of HUB_ZONES)if(hub.queues[zone.id].ends&&now>=hub.queues[zone.id].ends)launchQueue(zone);
 for(const room of rooms.values()){
  if(room.phase==='match'){
   if(room.sanctuaries)room.sanctuaries=room.sanctuaries.filter(s=>s.until>now);
   for(const pl of room.players.values()){
    if(pl.respawnAt&&now>=pl.respawnAt){
     let rdef=ROLE_DEFS[validRole(pl.role)];
     pl.respawnAt=0;pl.hp=pl.maxHp||rdef.maxHp;pl.shield=pl.maxShield||rdef.maxShield;pl.shieldActive=false;pl.healDebuffUntil=0;pl.stunUntil=0;
     let pos=respawnPos(room,pl);
     pl.x=pos.x;pl.z=pos.z;pl.y=0;pl.flip=0;pl.wallSliding=false;pl.lastKickWall=null;
     pl.invulnerableUntil=now+3000;pl.spawnRev++;pl.moveCredit=2;
     send(pl.ws,{type:'respawn',x:pl.x,z:pl.z,spawnRev:pl.spawnRev,invulnerableUntil:pl.invulnerableUntil});
    }else if(!pl.respawnAt&&!pl.eliminated){
     if(tickCount%5===0)pl.ultCharge=Math.min(100,(pl.ultCharge||0)+1);
     // Support 2s out-of-combat passive regeneration
     if(pl.role==='support'&&now-(pl.lastDamagedAt||0)>=2000&&pl.hp<pl.maxHp){
      pl.hp=Math.min(pl.maxHp,pl.hp+2);
     }
     // Tank shield timer & passive recharge when lowered
     if(pl.shieldActive&&now>(pl.shieldUntil||0))pl.shieldActive=false;
     if(!pl.shieldActive&&pl.maxShield>0&&now>(pl.shieldBrokenAt||0)+2500&&pl.shield<pl.maxShield){
      pl.shield=Math.min(pl.maxShield,pl.shield+3);
     }
     // Sanctuary dome healing
     if(room.sanctuaries?.length&&tickCount%2===0){
      for(const s of room.sanctuaries){
       if(s.team===pl.team&&Math.hypot(pl.x-s.x,pl.z-s.z)<=5.5){
        let owner=room.players.get(s.ownerId)||pl;
        applyHeal(room,owner,pl,8,now);break;
       }
      }
     }
    }
   }
   // Control Point capture & Contested state tick (3-player FFA)
   if(room.mode==='control'&&room.control){
    let ctrl=room.control,inZone=[];
    for(const pl of room.players.values()){
     if(pl.respawnAt||pl.eliminated)continue;
     if(Math.hypot(pl.x-CONTROL_POINT.x,pl.z-CONTROL_POINT.z)<=CONTROL_POINT.radius)inZone.push(pl);
    }
    if(inZone.length>=2){
     ctrl.contested=true;
    }else{
     ctrl.contested=false;
     let cap=inZone[0]||null;
     if(cap&&ctrl.ownerId!==cap.id){
      if(ctrl.capturingId===cap.id||!ctrl.capturingId){
       ctrl.capturingId=cap.id;ctrl.capturingName=cap.name;
       ctrl.capture=Math.min(100,(ctrl.capture||0)+5.5);
       if(ctrl.capture>=100){
        ctrl.ownerId=cap.id;ctrl.ownerName=cap.name;ctrl.capturingId=null;ctrl.capturingName=null;ctrl.capture=0;
        broadcast(room,{type:'notice',text:`🚩 ТОЧКА ЗАХВАЧЕНА: ${cap.name}!`});
       }
      }else{
       ctrl.capture=Math.max(0,(ctrl.capture||0)-6);
       if(ctrl.capture<=0){ctrl.capturingId=cap.id;ctrl.capturingName=cap.name}
      }
     }else if(!cap&&(ctrl.capture||0)>0){
      ctrl.capture=Math.max(0,ctrl.capture-1.5);
      if(ctrl.capture<=0){ctrl.capturingId=null;ctrl.capturingName=null}
     }
    }
    if(ctrl.ownerId&&!ctrl.contested){
     let ownerAlive=room.players.has(ctrl.ownerId);
     if(ownerAlive){
      let ownerIn=inZone.some(pl=>pl.id===ctrl.ownerId);
      let mult=ownerIn?1.25:1.0;
      let nextPct=Math.min(100,(ctrl.progress[ctrl.ownerId]||0)+0.55*mult);
      ctrl.progress[ctrl.ownerId]=nextPct;
      if(nextPct>=100)finish(room,ctrl.ownerId);
     }
    }
   }
   tickBots(room,now,.1);
  }
  if(room.phase==='lobby'&&room.countdown&&now>=room.countdown)tryStartRoom(room);
  else if(room.phase==='match'&&room.mode==='neoball'){if(room.neo.resetAt&&now>=room.neo.resetAt){room.neo.resetAt=0;room.neo.ball={status:'center',holder:null,x:0,y:0,z:0};broadcast(room,{type:'notice',text:'МЯЧ В ЦЕНТРЕ!'})}neoCheckClock(room,now);if(room.phase==='match'&&room.neo.ball.holder){let holder=room.players.get(room.neo.ball.holder);if(holder)neoUpdatePlayer(room,holder)}if(room.phase==='match')sync(room)}
  else if(room.phase==='match'&&now>=room.ends){
   let win=room.mode==='chaser'?'survivors':null;
   if(room.mode==='control'&&room.control){
    let bestId=null,bestPct=-1;
    for(const pl of room.players.values()){
     let pct=room.control.progress?.[pl.id]||0;
     if(pct>bestPct){bestPct=pct;bestId=pl.id}
    }
    win=bestId;
   }
   finish(room,win);
  }
  else if(room.phase==='ending'&&now>=room.ends){room.phase='results';room.ends=now+15000;sync(room)}
  else if(room.phase==='results'&&now>=room.ends&&(room.mode==='voting'||room.mode==='neoball'||room.mode==='chaser'||room.mode==='control')){returnToHub(room)}
  else if(room.phase==='results'&&now>=room.ends){room.phase='lobby';room.epoch++;room.ends=0;room.countdown=0;room.results=null;room.botConsent=false;room.botPrompted=false;for(const [id,p] of [...room.players.entries()]){if(p.isBot){room.players.delete(id);continue}let rdef=ROLE_DEFS[validRole(p.role)];p.x=0;p.z=-7;p.y=0;p.flip=0;p.hp=rdef.maxHp;p.maxHp=rdef.maxHp;p.shield=rdef.maxShield;p.maxShield=rdef.maxShield;p.shieldActive=false;p.ultCharge=0;p.eliminated=false;p.ready=false;p.seated=false;p.vote=null;p.respawnAt=0}sync(room)}
  else if(room.phase==='match'||tickCount%2===0)sync(room)
 }
},100);
const port = Number(process.env.PORT) || 3001;
server.listen(port,'0.0.0.0',()=>{
 console.log(`Arena server on ${port}`);
 loadHtmlCache().catch(e=>console.error('Warmup error:',e));
});
