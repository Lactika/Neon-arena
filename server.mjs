import {constrainPosition,wallContact,groundHeight,landingHeight,voteAt,shotWallDistance,HUB_ZONES} from './physics.js';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {readFile} from 'node:fs/promises';
import {randomUUID, randomInt} from 'node:crypto';
const rooms=new Map(), clients=new Map();
const weapons={smg:{name:'ПП «Воздушный Ткач»',price:0,damage:12,rate:80,range:30,spread:.03},shotgun:{name:'Дробовик «Кинетический Бластер»',price:0,damage:91,rate:700,range:15,spread:.15,pellets:7}};
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
const mapPhase=room=>room.phase==='lobby'?(room.mode==='hub'?'hub':'lobby'):room.map==='duct'?'duct':room.map==='station'?'station':room.map==='neoball'?'neoball':room.phase;
const ductSpawns=[[-4,-14],[4,14],[4,-14],[-4,14]];
const spawns=[[-18,-8],[18,8],[-18,8],[18,-8]];const RESPAWN={x:18,z:0};
const VOTE_DURATION=Number(process.env.VOTE_DURATION_MS)||10000;const LEGACY_VOTE_DURATION=15000;const QUEUE_DURATION=Number(process.env.QUEUE_DURATION_MS)||15000;const HUB_LIMIT=24;
const RESPAWN_DELAY=3000;
const hub={code:'HUB',mode:'hub',map:'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null,queues:Object.fromEntries(HUB_ZONES.map(z=>[z.id,{ends:0}]))};rooms.set('HUB',hub);
const voteCounts=room=>{let v={duct:0,colosseum:0,station:0};for(const p of room.players.values()){let id=room.mode==='voting'?p.vote:voteAt(p.x,p.z);if(id)v[id]++}return v};
const chooseMap=room=>{let v=voteCounts(room);return ['colosseum','duct','station'].reduce((a,b)=>v[b]>v[a]?b:a)};
const send=(ws,obj)=>{if(ws.readyState===1)ws.send(JSON.stringify(obj))};
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj)}
function state(room){return {type:'state',code:room.code,map:room.map,phase:room.phase,mode:room.mode||'private',ends:room.ends,epoch:room.epoch,countdown:room.countdown||0,sector:room.sector||0,votes:room.phase==='lobby'&&room.mode!=='hub'?voteCounts(room):null,queues:room.mode==='hub'?HUB_ZONES.map(z=>({id:z.id,capacity:z.capacity,mode:z.mode||'classic',count:[...room.players.values()].filter(p=>p.queue===z.id).length,ends:room.queues[z.id].ends})):null,neo:room.neo||null,players:[...room.players.values()].map(({ws,lastShot,lastMove,lastBounce,slideAt,lastKickWall,...p})=>p),results:room.results}}
function sync(room){broadcast(room,state(room))}
const NEO_DURATION=Number(process.env.NEO_DURATION_MS)||300000,NEO_RESET=Number(process.env.NEO_RESET_MS)||3000;
function neoSpawn(p,i){return {x:(i<2?-3:3),z:p.team==='A'?-55:55}}
function respawnPos(room,p){
 let list=[...room.players.values()],i=Math.max(0,list.indexOf(p));
 if(room.mode==='neoball')return neoSpawn(p,i);
 let s=(room.map==='duct'||room.map==='station'?ductSpawns:spawns)[i%4];
 return {x:s[0],z:s[1]};
}
function start(room){room.map=room.mode==='neoball'?'neoball':chooseMap(room);room.countdown=0;room.epoch++;room.phase='match';room.ends=Date.now()+(room.mode==='neoball'?NEO_DURATION:(Number(process.env.MATCH_DURATION_MS)||180000));room.results=null;if(room.mode==='neoball')room.neo={scores:{A:0,B:0},ball:{status:'center',holder:null,x:0,y:0,z:0},resetAt:0,overtime:false,winner:null};let i=0;for(const p of room.players.values()){if(room.mode==='neoball')p.team=i%2===0?'A':'B';else p.team=null;let pos=room.mode==='neoball'?neoSpawn(p,i):null,s=(room.map==='duct'||room.map==='station'?ductSpawns:spawns)[i];i++;Object.assign(p,{x:pos?pos.x:s[0],z:pos?pos.z:s[1],y:0,flip:0,seated:false,wallSliding:false,lastKickWall:null,hp:100,kills:0,deaths:0,ready:false,respawnAt:0,invulnerableUntil:Date.now()+3000});}broadcast(room,{type:'notice',text:room.mode==='neoball'?'NEO-BALL · МЯЧ В ЦЕНТРЕ':'БОЙ НАЧАЛСЯ!'});sync(room)}
function finish(room,winner=null){if(room.phase!=='match')return;room.phase='ending';room.ends=Date.now()+3000;for(const p of room.players.values())p.respawnAt=0;if(room.neo)room.neo.capture=null;if(room.neo)room.neo.winner=winner;let a=[...room.players.values()].sort((a,b)=>(room.neo&&winner?(b.team===winner)-(a.team===winner):0)||b.kills-a.kills||a.deaths-b.deaths);room.results=a.map((p,i)=>{let reward=80+p.kills*20+((room.neo?winner&&p.team===winner:i===0&&a.length>1)?100:0);p.coins+=reward;return {id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,reward,look:p.look,team:p.team}});sync(room)}
function dropNeoBall(room,p){if(room.neo?.ball.holder!==p.id)return;let y=landingHeight(p.x,p.z,p.y,0,'neoball')??0;room.neo.ball={status:'dropped',holder:null,x:p.x,y,z:p.z};room.neo.capture=null;broadcast(room,{type:'notice',text:'МЯЧ ПОТЕРЯН!'})}
function neoCheckClock(room,now=Date.now()){if(room.mode!=='neoball'||room.phase!=='match'||room.neo.overtime||now<room.ends)return;if(room.neo.scores.A===room.neo.scores.B){room.neo.overtime=true;room.ends=0;broadcast(room,{type:'notice',text:'ОВЕРТАЙМ · GOLDEN GOAL!'});sync(room)}else finish(room,room.neo.scores.A>room.neo.scores.B?'A':'B')}
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
function updateHubQueues(){for(const zone of HUB_ZONES){let members=[...hub.players.values()].filter(p=>p.queue===zone.id);if(members.length===zone.capacity){if(!hub.queues[zone.id].ends)hub.queues[zone.id].ends=Date.now()+QUEUE_DURATION}else hub.queues[zone.id].ends=0}}
function leave(c){let room=rooms.get(c.code);if(!room)return;let departing=room.players.get(c.id);if(departing)dropNeoBall(room,departing);room.players.delete(c.id);if(room.mode==='neoball'&&room.phase==='match'&&room.players.size){let alive=[...room.players.values()],teams=new Set(alive.map(p=>p.team));if(teams.size===1)finish(room,alive[0].team)}if(room.mode==='hub'){updateHubQueues();sync(room)}else if(!room.players.size)rooms.delete(room.code);else sync(room);c.code=null}
const server=http.createServer(async(req,res)=>{try{
 let path=req.url.split('?')[0];let file=/^\/assets\/[a-z0-9_]+\.glb$/.test(path)?path.slice(1):/^\/assets\/audio\/[a-z0-9_]+\.mp3$/.test(path)?path.slice(1):path==='/'||path==='/index.html'?'index.html':null;
 if(!file){res.writeHead(404);res.end('Not found');return}let data;try{data=await readFile(new URL('./'+file,import.meta.url))}catch(err){if(file.startsWith('assets/')&&err.code==='ENOENT'){let fallback=file.startsWith('assets/audio/')?file.slice('assets/audio/'.length):file.slice(7);try{data=await readFile(new URL('./'+fallback,import.meta.url))}catch(e){if(e.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}throw e}}else if(err.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}else throw err}
 let isAudio=file.endsWith('.mp3'),headers={'Content-Type':isAudio?'audio/mpeg':file.endsWith('.glb')?'model/gltf-binary':'text/html; charset=utf-8','Cache-Control':isAudio||file.endsWith('.glb')?'public, max-age=86400':'no-store'};
 if(isAudio){headers['Accept-Ranges']='bytes';let range=req.headers.range;if(range){let m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}let start=m[1]?Number(m[1]):Math.max(0,data.length-Number(m[2])),end=m[1]?(m[2]?Math.min(Number(m[2]),data.length-1):data.length-1):data.length-1;if(start>=data.length||end<start){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}headers['Content-Range']=`bytes ${start}-${end}/${data.length}`;headers['Content-Length']=end-start+1;res.writeHead(206,headers);res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));return}}
 headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data)
 }catch{res.writeHead(500);res.end('Build missing')}});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{let c={id:randomUUID(),ws,code:null};clients.set(ws,c);send(ws,{type:'hello',id:c.id,weapons,outfits,weaponSkins});ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m.type!=='string')return;
if(m.type==='join'){if(c.code)return;let code=String(m.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);let room;
 if(!code&&!m.private){room=hub;code='HUB'}else{if(!code){do{code=randomInt(10000,100000).toString()}while(rooms.has(code));room={code,mode:'private',map:'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null};rooms.set(code,room)}else{room=rooms.get(code);if(!room||room.mode==='hub'){send(ws,{type:'error',text:'Комната не найдена'});return}}}
 if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);
 if(room.players.size>=(room.mode==='hub'?HUB_LIMIT:4)||room.phase!=='lobby'||room.locked){send(ws,{type:'error',text:room.mode==='hub'?'Общее лобби заполнено':'Комната заполнена или матч уже начался'});return}
 let name=String(m.name||'Игрок').trim().slice(0,20)||'Игрок';
 let look={...(presets[m.look?.character]||presets.shadow),outfit:'default',weaponSkin:'default'};
 let offset=room.mode==='hub'?((room.players.size%5)-2)*.8:0;let p={id:c.id,ws,name,look,x:offset,z:-8,y:0,flip:0,angle:0,hp:100,kills:0,deaths:0,ready:false,seated:false,weapon:'smg',coins:10000,owned:['smg','shotgun'],ownedOutfits:['default'],ownedWeaponSkins:['default'],lastShot:0,lastMove:Date.now(),moveCredit:2,moveSeq:0,spawnRev:0,respawnAt:0,invulnerableUntil:0,queue:null,vote:null};room.players.set(c.id,p);c.code=code;send(ws,{type:'joined',code,id:c.id});sync(room);return}
let room=rooms.get(c.code),p=room?.players.get(c.id);if(!p)return;if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);if(room.mode==='neoball'&&room.phase==='match')neoCheckClock(room);
if(m.type==='mapvote'&&room.mode==='voting'&&room.phase==='lobby'){if(['duct','colosseum','station'].includes(m.map)){p.vote=m.map;sync(room)}return}
if(m.type==='sit'&&room.phase==='lobby'){
 let hx=0,hz=room.mode==='hub'?11.78:6.2;
 if(m.seated){
  if(Math.hypot(p.x-hx,p.z-hz)<=3.5){
   let taken=[...room.players.values()].some(o=>o.id!==p.id&&o.seated);
   if(taken){send(ws,{type:'error',text:'Пульт капитана уже занят'});return}
   p.seated=true;p.x=hx;p.z=hz;p.y=0;p.angle=Math.PI;p.queue=null;updateHubQueues();sync(room);
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
if(m.type==='wallbounce'){if(p.respawnAt)return;let now=Date.now(),normal=wallContact(p.x,p.z,mapPhase(room),p.y);if(m.epoch===room.epoch&&m.spawnRev===p.spawnRev&&normal&&p.y>.05&&now-(p.lastBounce||0)>140&&p.lastKickWall!==normal.id){p.lastBounce=now;p.lastKickWall=normal.id;p.wallSliding=false;broadcast(room,{type:'wallbounce',id:p.id,x:p.x,y:p.y,z:p.z,nx:normal.x,nz:normal.z})}return}
if(m.type==='weapon'&&p.owned.includes(m.weapon)){p.weapon=m.weapon;sync(room);return}
if(m.type==='buy'&&room.phase==='lobby'){let w=weapons[m.weapon];if(w&&w.price>0&&!p.owned.includes(m.weapon)&&p.coins>=w.price){p.coins-=w.price;p.owned.push(m.weapon);p.weapon=m.weapon;sync(room)}else send(ws,{type:'error',text:'Не хватает монет или оружие уже куплено'});return}
if(m.type==='outfit'){let id=String(m.id||'');if(p.ownedOutfits.includes(id)){p.look={...p.look,outfit:id};sync(room);return}let item=outfits[id];if(room.phase==='lobby'&&item&&p.coins>=item.price){p.coins-=item.price;p.ownedOutfits.push(id);p.look={...p.look,outfit:id};sync(room)}else send(ws,{type:'error',text:room.phase!=='lobby'?'Покупка доступна только в лобби':'Не хватает монет'});return}
if(m.type==='weapon_skin'){let id=String(m.id||'');if(p.ownedWeaponSkins.includes(id)){p.look={...p.look,weaponSkin:id};sync(room);return}let item=weaponSkins[id];if(room.phase==='lobby'&&item&&p.coins>=item.price){p.coins-=item.price;p.ownedWeaponSkins.push(id);p.look={...p.look,weaponSkin:id};sync(room)}else send(ws,{type:'error',text:room.phase!=='lobby'?'Покупка доступна только в лобби':'Не хватает монет'});return}
if(m.type==='move'){if(room.phase==='ending'||room.phase==='results'||p.respawnAt)return;if(Number.isInteger(m.epoch)&&m.epoch!==room.epoch)return;if(Number.isInteger(m.spawnRev)&&m.spawnRev!==p.spawnRev)return;let seq=Number.isSafeInteger(m.seq)?m.seq:p.moveSeq+1;if(seq<=p.moveSeq)return;p.moveSeq=seq;if(p.seated){p.angle=Number.isFinite(+m.angle)?+m.angle:p.angle;return}let x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z))return;let now=Date.now(),delta=Math.min(1,Math.max(0,(now-p.lastMove)/1000));p.lastMove=now;p.moveCredit=Math.min(10,(p.moveCredit||0)+delta*19);let dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz),max=p.moveCredit;if(d>max&&d>0){dx*=max/d;dz*=max/d}p.moveCredit=Math.max(0,p.moveCredit-Math.hypot(dx,dz));let oldY=p.y;p.y=Number.isFinite(+m.y)?Math.max(0,Math.min(8,+m.y)):0;let n=wallContact(p.x,p.z,mapPhase(room),p.y),mx=Number(m.ix)||0,mz=Number(m.iz)||0;let inputLength=Math.hypot(mx,mz);if(inputLength>1){mx/=inputLength;mz/=inputLength}p.wallSliding=!!(m.slide&&n&&groundHeight(p.x,p.z,p.y,mapPhase(room))===null&&p.y<=oldY+.04&&mx*n.x+mz*n.z<-.15);p.slideAt=now;if(groundHeight(p.x,p.z,p.y,mapPhase(room))!==null)p.lastKickWall=null;let constrained=constrainPosition(p.x+dx,p.z+dz,mapPhase(room),p.y);p.x=constrained.x;p.z=constrained.z;p.flip=Number.isFinite(+m.flip)?Math.max(0,Math.min(1,+m.flip)):0;p.angle=Number.isFinite(+m.angle)?+m.angle:0;if(room.mode==='neoball')neoUpdatePlayer(room,p);if(room.phase==='lobby'&&room.mode==='hub'){let zone=HUB_ZONES.find(z=>Math.hypot(p.x-z.x,p.z-z.z)<=z.radius);if(p.queue&&(!zone||p.queue!==zone.id))p.queue=null;if(!p.queue&&zone&&[...room.players.values()].filter(q=>q.queue===zone.id).length<zone.capacity)p.queue=zone.id;updateHubQueues()}else if(room.phase==='lobby'&&room.mode==='private'){let vote=voteAt(p.x,p.z);if(vote&&!room.countdown)room.countdown=now+LEGACY_VOTE_DURATION;if(vote!==p.vote){p.vote=vote;sync(room)}}return}
if(m.type==='shoot'&&room.phase==='match'){
 if(p.respawnAt)return;
 let w=weapons[p.weapon],now=Date.now();if(!w)return;let overclock=p.weapon==='smg'&&p.wallSliding&&now-p.slideAt<200,rate=overclock?w.rate*.75:w.rate;if(now-p.lastShot<rate)return;
 let aim=Number(m.angle),aimPitch=Number(m.pitch);if(!Number.isFinite(aim)||!Number.isFinite(aimPitch))return;p.lastShot=now;if(now<(p.invulnerableUntil||0)){p.invulnerableUntil=0;sync(room)}
 let airborne=groundHeight(p.x,p.z,p.y,mapPhase(room))===null,spread=p.weapon==='smg'?(overclock?.005:w.spread*(airborne?1.1:1)):w.spread*(airborne?1.8:1),hits=new Map();
 for(let pellet=0;pellet<(w.pellets||1);pellet++){
  let a=aim+(Math.random()-.5)*spread,pitch=Math.max(-1.15,Math.min(1.15,aimPitch+(Math.random()-.5)*spread)),cp=Math.cos(pitch),dx=Math.sin(a)*cp,dy=Math.sin(pitch),dz=-Math.cos(a)*cp,best=null,bestD=shotWallDistance(mapPhase(room),p.x,(p.y||0)+1.7,p.z,dx,dy,dz,w.range),headshot=false;
  for(let target of room.players.values()){
   if(target.id===p.id||target.respawnAt||(room.mode==='neoball'&&target.team===p.team)||now<(target.invulnerableUntil||0))continue;
   for(const part of [{height:1.62,radius:.33,head:true},{height:.95,radius:.63,head:false}]){
    let rx=target.x-p.x,ry=(target.y||0)+part.height-((p.y||0)+1.7),rz=target.z-p.z,along=rx*dx+ry*dy+rz*dz,side2=rx*rx+ry*ry+rz*rz-along*along,r=part.radius;
    if(along<=0||side2>r*r)continue;let entry=along-Math.sqrt(Math.max(0,r*r-side2));if(entry>0&&entry<w.range&&entry<bestD){best=target;bestD=entry;headshot=part.head}
   }
  }
  broadcast(room,{type:'shot',id:p.id,x:p.x,y:(p.y||0)+1.7,z:p.z,angle:a,pitch,range:bestD,weapon:p.weapon,weaponSkin:p.look?.weaponSkin||'default'});
  if(best){let base=p.weapon==='shotgun'?13:w.damage;let info=hits.get(best.id)||{target:best,damage:0,headshot:false};info.damage+=headshot?Math.round(base*1.5):base;info.headshot ||=headshot;hits.set(best.id,info)}
 }
 for(const {target:best,damage,headshot} of hits.values()){
  best.hp-=damage;broadcast(room,{type:'hit',shooter:p.id,target:best.id,x:best.x,y:(best.y||0)+(headshot?1.62:.95),z:best.z,damage,hp:Math.max(0,best.hp),headshot});
  if(best.hp<=0){p.kills++;best.deaths++;dropNeoBall(room,best);best.hp=0;best.respawnAt=now+RESPAWN_DELAY;best.wallSliding=false;best.lastKickWall=null;broadcast(room,{type:'death',target:best.id,x:best.x,y:best.y||0,z:best.z,respawnAt:best.respawnAt});broadcast(room,{type:'notice',text:`${p.name} ⚡ ${best.name}`})}
 }if(hits.size)sync(room);return
}
});ws.on('close',()=>{leave(c);clients.delete(ws)})});
function launchQueue(zone){let members=[...hub.players.values()].filter(p=>p.queue===zone.id);if(members.length!==zone.capacity){hub.queues[zone.id].ends=0;return}let code;do{code=randomInt(10000,100000).toString()}while(rooms.has(code));let room={code,mode:zone.mode==='neoball'?'neoball':'voting',locked:true,map:zone.mode==='neoball'?'neoball':'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:1,countdown:zone.mode==='neoball'?0:Date.now()+VOTE_DURATION,results:null};rooms.set(code,room);for(let [i,p] of members.entries()){hub.players.delete(p.id);p.queue=null;p.vote=null;p.seated=false;p.x=(i-1.5)*1.1;p.z=-7;p.y=0;p.flip=0;p.wallSliding=false;p.lastKickWall=null;p.respawnAt=0;p.moveCredit=2;p.lastMove=Date.now();room.players.set(p.id,p);let c=clients.get(p.ws);if(c)c.code=code;send(p.ws,{type:'joined',code,id:p.id,transfer:true})}hub.queues[zone.id].ends=0;updateHubQueues();sync(hub);if(room.mode==='neoball')start(room);else sync(room)}
function returnToHub(room){for(const p of room.players.values()){if(hub.players.size>=HUB_LIMIT){let c=clients.get(p.ws);if(c)c.code=null;send(p.ws,{type:'left'});continue}p.x=((hub.players.size%5)-2)*.8;p.z=-8;p.y=0;p.flip=0;p.hp=100;p.ready=false;p.seated=false;p.queue=null;p.vote=null;p.team=null;p.respawnAt=0;p.moveCredit=2;p.lastMove=Date.now();p.invulnerableUntil=0;hub.players.set(p.id,p);let c=clients.get(p.ws);if(c)c.code='HUB';send(p.ws,{type:'joined',code:'HUB',id:p.id,transfer:true})}rooms.delete(room.code);sync(hub)}
setInterval(()=>{
 let now=Date.now();
 updateHubQueues();
 for(const zone of HUB_ZONES)if(hub.queues[zone.id].ends&&now>=hub.queues[zone.id].ends)launchQueue(zone);
 for(const room of rooms.values()){
  if(room.phase==='match'){
   for(const pl of room.players.values()){
    if(pl.respawnAt&&now>=pl.respawnAt){
     pl.respawnAt=0;pl.hp=100;
     let pos=respawnPos(room,pl);
     pl.x=pos.x;pl.z=pos.z;pl.y=0;pl.flip=0;pl.wallSliding=false;pl.lastKickWall=null;
     pl.invulnerableUntil=now+3000;pl.spawnRev++;pl.moveCredit=2;
     send(pl.ws,{type:'respawn',x:pl.x,z:pl.z,spawnRev:pl.spawnRev,invulnerableUntil:pl.invulnerableUntil});
    }
   }
  }
  if(room.phase==='lobby'&&room.countdown&&now>=room.countdown)start(room);
  else if(room.phase==='match'&&room.mode==='neoball'){if(room.neo.resetAt&&now>=room.neo.resetAt){room.neo.resetAt=0;room.neo.ball={status:'center',holder:null,x:0,y:0,z:0};broadcast(room,{type:'notice',text:'МЯЧ В ЦЕНТРЕ!'})}neoCheckClock(room,now);if(room.phase==='match'&&room.neo.ball.holder){let holder=room.players.get(room.neo.ball.holder);if(holder)neoUpdatePlayer(room,holder)}if(room.phase==='match')sync(room)}
  else if(room.phase==='match'&&now>=room.ends)finish(room);
  else if(room.phase==='ending'&&now>=room.ends){room.phase='results';room.ends=now+15000;sync(room)}
  else if(room.phase==='results'&&now>=room.ends&&(room.mode==='voting'||room.mode==='neoball')){returnToHub(room)}
  else if(room.phase==='results'&&now>=room.ends){room.phase='lobby';room.epoch++;room.ends=0;room.countdown=0;room.results=null;for(const p of room.players.values()){p.x=0;p.z=-7;p.y=0;p.flip=0;p.hp=100;p.ready=false;p.seated=false;p.vote=null;p.respawnAt=0}sync(room)}
  else sync(room)
 }
},200);
const port = Number(process.env.PORT) || 3001;
server.listen(port,'0.0.0.0',()=>console.log(`Arena server on ${port}`));
