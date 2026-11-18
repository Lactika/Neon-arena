import {constrainPosition,wallContact,groundHeight,voteAt,shotWallDistance} from './physics.js';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {readFile} from 'node:fs/promises';
import {randomUUID, randomInt} from 'node:crypto';
const rooms=new Map(), clients=new Map();
const weapons={smg:{name:'ПП «Воздушный Ткач»',price:0,damage:12,rate:80,range:30,spread:.03},shotgun:{name:'Дробовик «Кинетический Бластер»',price:0,damage:91,rate:700,range:15,spread:.15,pellets:7}};
const mapPhase=room=>room.phase==='lobby'?'lobby':room.map==='duct'?'duct':room.map==='station'?'station':room.phase;
const ductSpawns=[[-4,-14],[4,14],[4,-14],[-4,14]];
const spawns=[[-18,-8],[18,8],[-18,8],[18,-8]];const RESPAWN={x:18,z:0};
const VOTE_DURATION=Number(process.env.VOTE_DURATION_MS)||15000;
const voteCounts=room=>{let v={duct:0,colosseum:0,station:0};for(const p of room.players.values()){let id=voteAt(p.x,p.z);if(id)v[id]++}return v};
const chooseMap=room=>{let v=voteCounts(room);return ['colosseum','duct','station'].reduce((a,b)=>v[b]>v[a]?b:a)};
const send=(ws,obj)=>{if(ws.readyState===1)ws.send(JSON.stringify(obj))};
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj)}
function state(room){return {type:'state',code:room.code,map:room.map,phase:room.phase,ends:room.ends,epoch:room.epoch,countdown:room.countdown||0,votes:room.phase==='lobby'?voteCounts(room):null,players:[...room.players.values()].map(({ws,lastShot,lastMove,lastBounce,slideAt,lastKickWall,...p})=>p),results:room.results}}
function sync(room){broadcast(room,state(room))}
function start(room){room.map=chooseMap(room);room.countdown=0;room.epoch++;room.phase='match';room.ends=Date.now()+(Number(process.env.MATCH_DURATION_MS)||180000);room.results=null;let i=0;for(const p of room.players.values()){const s=(room.map==='duct'||room.map==='station'?ductSpawns:spawns)[i++];Object.assign(p,{x:s[0],z:s[1],y:0,flip:0,wallSliding:false,lastKickWall:null,hp:100,kills:0,deaths:0,ready:false,invulnerableUntil:Date.now()+3000});}broadcast(room,{type:'notice',text:'БОЙ НАЧАЛСЯ!'});sync(room)}
function finish(room){room.phase='results';room.ends=Date.now()+15000;let a=[...room.players.values()].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths);room.results=a.map((p,i)=>{let reward=80+p.kills*20+(i===0&&a.length>1?100:0);p.coins+=reward;return {id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,reward,look:p.look}});sync(room)}
function leave(c){let room=rooms.get(c.code);if(!room)return;room.players.delete(c.id);if(!room.players.size)rooms.delete(room.code);else {sync(room)};c.code=null}
const server=http.createServer(async(req,res)=>{try{
 let path=req.url.split('?')[0];let file=/^\/assets\/[a-z0-9_]+\.glb$/.test(path)?path.slice(1):/^\/assets\/audio\/[a-z0-9_]+\.mp3$/.test(path)?path.slice(1):path==='/'||path==='/index.html'?'index.html':null;
 if(!file){res.writeHead(404);res.end('Not found');return}let data;try{data=await readFile(new URL('./'+file,import.meta.url))}catch(err){if(file.startsWith('assets/')&&err.code==='ENOENT'){let fallback=file.startsWith('assets/audio/')?file.slice('assets/audio/'.length):file.slice(7);try{data=await readFile(new URL('./'+fallback,import.meta.url))}catch(e){if(e.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}throw e}}else if(err.code==='ENOENT'){res.writeHead(404);res.end('Not found');return}else throw err}
 let isAudio=file.endsWith('.mp3'),headers={'Content-Type':isAudio?'audio/mpeg':file.endsWith('.glb')?'model/gltf-binary':'text/html; charset=utf-8','Cache-Control':isAudio||file.endsWith('.glb')?'public, max-age=86400':'no-store'};
 if(isAudio){headers['Accept-Ranges']='bytes';let range=req.headers.range;if(range){let m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}let start=m[1]?Number(m[1]):Math.max(0,data.length-Number(m[2])),end=m[1]?(m[2]?Math.min(Number(m[2]),data.length-1):data.length-1):data.length-1;if(start>=data.length||end<start){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return}headers['Content-Range']=`bytes ${start}-${end}/${data.length}`;headers['Content-Length']=end-start+1;res.writeHead(206,headers);res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));return}}
 headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data)
 }catch{res.writeHead(500);res.end('Build missing')}});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{let c={id:randomUUID(),ws,code:null};clients.set(ws,c);send(ws,{type:'hello',id:c.id,weapons});ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m.type!=='string')return;
if(m.type==='join'){if(c.code)return;let code=String(m.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);if(!code){do{code=randomInt(10000,100000).toString()}while(rooms.has(code))}let room=rooms.get(code);if(!room){if(m.code){send(ws,{type:'error',text:'Комната не найдена'});return}room={code,map:'colosseum',players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null};rooms.set(code,room)}if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);if(room.players.size>=4||room.phase!=='lobby'){send(ws,{type:'error',text:'Комната заполнена или матч уже начался'});return}let name=String(m.name||'Игрок').trim().slice(0,20)||'Игрок';const presets={shadow:{character:'shadow',hair:0,clothes:0,eyes:0},viper:{character:'viper',hair:1,clothes:3,eyes:0},blitz:{character:'blitz',hair:3,clothes:1,eyes:0}};let look={...(presets[m.look?.character]||presets.shadow)};let quick=!!m.quickPlay&&!m.code;let p={id:c.id,ws,name,look,x:0,z:-7,y:0,flip:0,angle:0,hp:100,kills:0,deaths:0,ready:false,weapon:'smg',coins:10000,owned:['smg','shotgun'],lastShot:0,lastMove:Date.now(),moveCredit:2,moveSeq:0,spawnRev:0,invulnerableUntil:0};room.players.set(c.id,p);c.code=code;send(ws,{type:'joined',code,id:c.id});sync(room);return}
let room=rooms.get(c.code),p=room?.players.get(c.id);if(!p)return;if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);
if(m.type==='leave'){leave(c);send(ws,{type:'left'});return}
if(m.type==='wallbounce'){let now=Date.now(),normal=wallContact(p.x,p.z,mapPhase(room),p.y);if(m.epoch===room.epoch&&m.spawnRev===p.spawnRev&&normal&&p.y>.05&&now-(p.lastBounce||0)>140&&p.lastKickWall!==normal.id){p.lastBounce=now;p.lastKickWall=normal.id;p.wallSliding=false;broadcast(room,{type:'wallbounce',id:p.id,x:p.x,y:p.y,z:p.z,nx:normal.x,nz:normal.z})}return}
if(m.type==='weapon'&&p.owned.includes(m.weapon)){p.weapon=m.weapon;sync(room)}
if(m.type==='buy'&&room.phase==='lobby'){let w=weapons[m.weapon];if(w&&w.price>0&&!p.owned.includes(m.weapon)&&p.coins>=w.price){p.coins-=w.price;p.owned.push(m.weapon);p.weapon=m.weapon;sync(room)}else send(ws,{type:'error',text:'Не хватает монет или оружие уже куплено'})}
if(m.type==='move'){if(Number.isInteger(m.epoch)&&m.epoch!==room.epoch)return;if(Number.isInteger(m.spawnRev)&&m.spawnRev!==p.spawnRev)return;let seq=Number.isSafeInteger(m.seq)?m.seq:p.moveSeq+1;if(seq<=p.moveSeq)return;p.moveSeq=seq;let x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z))return;let now=Date.now(),delta=Math.min(1,Math.max(0,(now-p.lastMove)/1000));p.lastMove=now;p.moveCredit=Math.min(10,(p.moveCredit||0)+delta*19);let dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz),max=p.moveCredit;if(d>max&&d>0){dx*=max/d;dz*=max/d}p.moveCredit=Math.max(0,p.moveCredit-Math.hypot(dx,dz));let oldY=p.y;p.y=Number.isFinite(+m.y)?Math.max(0,Math.min(8,+m.y)):0;let n=wallContact(p.x,p.z,mapPhase(room),p.y),mx=Number(m.ix)||0,mz=Number(m.iz)||0;let inputLength=Math.hypot(mx,mz);if(inputLength>1){mx/=inputLength;mz/=inputLength}p.wallSliding=!!(m.slide&&n&&groundHeight(p.x,p.z,p.y,mapPhase(room))===null&&p.y<=oldY+.04&&mx*n.x+mz*n.z<-.15);p.slideAt=now;if(groundHeight(p.x,p.z,p.y,mapPhase(room))!==null)p.lastKickWall=null;let constrained=constrainPosition(p.x+dx,p.z+dz,mapPhase(room),p.y);p.x=constrained.x;p.z=constrained.z;p.flip=Number.isFinite(+m.flip)?Math.max(0,Math.min(1,+m.flip)):0;p.angle=Number.isFinite(+m.angle)?+m.angle:0;if(room.phase==='lobby'){let vote=voteAt(p.x,p.z);if(vote&&!room.countdown)room.countdown=now+VOTE_DURATION;if(vote!==p.vote){p.vote=vote;sync(room)}}return}
if(m.type==='shoot'&&room.phase==='match'){
 let w=weapons[p.weapon],now=Date.now();if(!w)return;let overclock=p.weapon==='smg'&&p.wallSliding&&now-p.slideAt<200,rate=overclock?w.rate*.75:w.rate;if(now-p.lastShot<rate)return;
 let aim=Number(m.angle),aimPitch=Number(m.pitch);if(!Number.isFinite(aim)||!Number.isFinite(aimPitch))return;p.lastShot=now;if(now<(p.invulnerableUntil||0)){p.invulnerableUntil=0;sync(room)}
 let airborne=groundHeight(p.x,p.z,p.y,mapPhase(room))===null,spread=p.weapon==='smg'?(overclock?.005:w.spread*(airborne?1.1:1)):w.spread*(airborne?1.8:1),hits=new Map();
 for(let pellet=0;pellet<(w.pellets||1);pellet++){
  let a=aim+(Math.random()-.5)*spread,pitch=Math.max(-1.15,Math.min(1.15,aimPitch+(Math.random()-.5)*spread)),cp=Math.cos(pitch),dx=Math.sin(a)*cp,dy=Math.sin(pitch),dz=-Math.cos(a)*cp,best=null,bestD=shotWallDistance(mapPhase(room),p.x,(p.y||0)+1.7,p.z,dx,dy,dz,w.range),headshot=false;
  for(let target of room.players.values()){
   if(target.id===p.id||now<(target.invulnerableUntil||0))continue;
   for(const part of [{height:1.62,radius:.33,head:true},{height:.95,radius:.63,head:false}]){
    let rx=target.x-p.x,ry=(target.y||0)+part.height-((p.y||0)+1.7),rz=target.z-p.z,along=rx*dx+ry*dy+rz*dz,side2=rx*rx+ry*ry+rz*rz-along*along,r=part.radius;
    if(along<=0||side2>r*r)continue;let entry=along-Math.sqrt(Math.max(0,r*r-side2));if(entry>0&&entry<w.range&&entry<bestD){best=target;bestD=entry;headshot=part.head}
   }
  }
  broadcast(room,{type:'shot',id:p.id,x:p.x,y:(p.y||0)+1.7,z:p.z,angle:a,pitch,range:bestD,weapon:p.weapon});
  if(best){let base=p.weapon==='shotgun'?13:w.damage;let info=hits.get(best.id)||{target:best,damage:0,headshot:false};info.damage+=headshot?Math.round(base*1.5):base;info.headshot ||=headshot;hits.set(best.id,info)}
 }
 for(const {target:best,damage,headshot} of hits.values()){
  best.hp-=damage;broadcast(room,{type:'hit',shooter:p.id,target:best.id,x:best.x,y:(best.y||0)+(headshot?1.62:.95),z:best.z,damage,hp:Math.max(0,best.hp),headshot});
  if(best.hp<=0){p.kills++;best.deaths++;broadcast(room,{type:'death',target:best.id,x:best.x,y:best.y||0,z:best.z});best.hp=100;best.x=room.map==='duct'||room.map==='station'?4:RESPAWN.x;best.z=room.map==='duct'||room.map==='station'?14:RESPAWN.z;best.y=0;best.lastKickWall=null;best.invulnerableUntil=now+3000;best.spawnRev++;best.moveCredit=2;send(best.ws,{type:'respawn',x:best.x,z:best.z,spawnRev:best.spawnRev,invulnerableUntil:best.invulnerableUntil});broadcast(room,{type:'notice',text:`${p.name} ⚡ ${best.name}`})}
 }if(hits.size)sync(room);return
}
});ws.on('close',()=>{leave(c);clients.delete(ws)})});
setInterval(()=>{for(const room of rooms.values()){if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);else if(room.phase==='match'&&Date.now()>=room.ends)finish(room);else if(room.phase==='results'&&Date.now()>=room.ends){room.phase='lobby';room.epoch++;room.ends=0;room.countdown=0;room.results=null;for(const p of room.players.values()){p.x=0;p.z=-7;p.y=0;p.flip=0;p.hp=100;p.ready=false;p.vote=null}sync(room)}else sync(room)}},250);
const port = Number(process.env.PORT) || 3001;
server.listen(port,'0.0.0.0',()=>console.log(`Arena server on ${port}`));
