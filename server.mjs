import {constrainPosition} from './physics.js';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {readFile} from 'node:fs/promises';
import {randomUUID, randomInt} from 'node:crypto';
const rooms=new Map(), clients=new Map();
const weapons={pistol:{name:'Пистолет',price:0,damage:24,rate:320,range:34},mp5:{name:'MP5',price:0,damage:12,rate:120,range:30},shotgun:{name:'Ружьё',price:0,damage:42,rate:850,range:13},rifle:{name:'Винтовка',price:0,damage:55,rate:900,range:50},rocket:{name:'Ракетный пистолет',price:900,damage:70,rate:1200,range:35},machine:{name:'Пулемёт',price:1800,damage:18,rate:110,range:35},minigun:{name:'Миниган',price:4000,damage:16,rate:75,range:30}};
const spawns=[[-18,-8],[18,8],[-18,8],[18,-8]];const RESPAWN={x:18,z:0};
const send=(ws,obj)=>{if(ws.readyState===1)ws.send(JSON.stringify(obj))};
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj)}
function state(room){return {type:'state',code:room.code,phase:room.phase,ends:room.ends,epoch:room.epoch,countdown:room.countdown||0,players:[...room.players.values()].map(({ws,lastShot,lastMove,...p})=>p),results:room.results}}
function sync(room){broadcast(room,state(room))}
function start(room){room.countdown=0;room.epoch++;room.phase='match';room.ends=Date.now()+(Number(process.env.MATCH_DURATION_MS)||180000);room.results=null;let i=0;for(const p of room.players.values()){const s=spawns[i++];Object.assign(p,{x:s[0],z:s[1],y:0,flip:0,hp:100,kills:0,deaths:0,ready:false,invulnerableUntil:Date.now()+3000});}broadcast(room,{type:'notice',text:'БОЙ НАЧАЛСЯ!'});sync(room)}
function finish(room){room.phase='results';room.ends=Date.now()+15000;let a=[...room.players.values()].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths);room.results=a.map((p,i)=>{let reward=80+p.kills*20+(i===0&&a.length>1?100:0);p.coins+=reward;return {id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,reward,look:p.look}});sync(room)}
function leave(c){let room=rooms.get(c.code);if(!room)return;room.players.delete(c.id);if(!room.players.size)rooms.delete(room.code);else {if(room.phase==='lobby'&&![...room.players.values()].some(p=>p.ready))room.countdown=0;sync(room)};c.code=null}
const server=http.createServer(async(req,res)=>{try{let path=req.url.split('?')[0];let file=path.startsWith('/assets/')&&/^\/assets\/[a-z0-9_]+\.glb$/.test(path)?path.slice(1):path==='/'||path==='/index.html'?'index.html':null;if(!file){res.writeHead(404);res.end('Not found');return}let data;try{data=await readFile(new URL('./'+file,import.meta.url))}catch(err){if(file.startsWith('assets/')&&err.code==='ENOENT')data=await readFile(new URL('./'+file.slice(7),import.meta.url));else throw err}res.writeHead(200,{'Content-Type':file.endsWith('.glb')?'model/gltf-binary':'text/html; charset=utf-8','Cache-Control':file.endsWith('.glb')?'public, max-age=86400':'no-store'});res.end(data)}catch{res.writeHead(500);res.end('Build missing')}});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{let c={id:randomUUID(),ws,code:null};clients.set(ws,c);send(ws,{type:'hello',id:c.id,weapons});ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m.type!=='string')return;
if(m.type==='join'){if(c.code)return;let code=String(m.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);if(!code){do{code=randomInt(10000,100000).toString()}while(rooms.has(code))}let room=rooms.get(code);if(!room){if(m.code){send(ws,{type:'error',text:'Комната не найдена'});return}room={code,players:new Map(),phase:'lobby',ends:0,epoch:0,countdown:0,results:null};rooms.set(code,room)}if(room.players.size>=4||room.phase!=='lobby'){send(ws,{type:'error',text:'Комната заполнена или матч уже начался'});return}let name=String(m.name||'Игрок').trim().slice(0,20)||'Игрок';let look={hair:Math.max(0,Math.min(3,+m.look?.hair||0)),clothes:Math.max(0,Math.min(3,+m.look?.clothes||0)),eyes:Math.max(0,Math.min(2,+m.look?.eyes||0))};let p={id:c.id,ws,name,look,x:0,z:-7,y:0,flip:0,angle:0,hp:100,kills:0,deaths:0,ready:false,weapon:'pistol',coins:10000,owned:['pistol','mp5','shotgun','rifle'],lastShot:0,lastMove:Date.now(),moveCredit:2,moveSeq:0,spawnRev:0,invulnerableUntil:0};room.players.set(c.id,p);c.code=code;send(ws,{type:'joined',code,id:c.id});sync(room);return}
let room=rooms.get(c.code),p=room?.players.get(c.id);if(!p)return;
if(m.type==='leave'){leave(c);send(ws,{type:'left'});return}
if(m.type==='weapon'&&p.owned.includes(m.weapon)){p.weapon=m.weapon;sync(room)}
if(m.type==='buy'&&room.phase==='lobby'){let w=weapons[m.weapon];if(w&&w.price>0&&!p.owned.includes(m.weapon)&&p.coins>=w.price){p.coins-=w.price;p.owned.push(m.weapon);p.weapon=m.weapon;sync(room)}else send(ws,{type:'error',text:'Не хватает монет или оружие уже куплено'})}
if(m.type==='move'){if(Number.isInteger(m.epoch)&&m.epoch!==room.epoch)return;if(Number.isInteger(m.spawnRev)&&m.spawnRev!==p.spawnRev)return;let seq=Number.isSafeInteger(m.seq)?m.seq:p.moveSeq+1;if(seq<=p.moveSeq)return;p.moveSeq=seq;let x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z))return;let now=Date.now(),delta=Math.min(1,Math.max(0,(now-p.lastMove)/1000));p.lastMove=now;p.moveCredit=Math.min(10,(p.moveCredit||0)+delta*19);let dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz),max=p.moveCredit;if(d>max&&d>0){dx*=max/d;dz*=max/d}p.moveCredit=Math.max(0,p.moveCredit-Math.hypot(dx,dz));p.y=Number.isFinite(+m.y)?Math.max(0,Math.min(5,+m.y)):0;let constrained=constrainPosition(p.x+dx,p.z+dz,room.phase,p.y);p.x=constrained.x;p.z=constrained.z;p.flip=Number.isFinite(+m.flip)?Math.max(0,Math.min(1,+m.flip)):0;p.angle=Number.isFinite(+m.angle)?+m.angle:0;if(room.phase==='lobby'){let ready=Math.hypot(p.x,p.z+4)<2.0;if(ready!==p.ready){p.ready=ready;sync(room)}if([...room.players.values()].some(v=>v.ready)){if(!room.countdown)room.countdown=Date.now()+(Number(process.env.COUNTDOWN_MS)||10000)}else room.countdown=0}return}
if(m.type==='shoot'&&room.phase==='match'){let w=weapons[p.weapon],now=Date.now();if(now-p.lastShot<w.rate)return;p.lastShot=now;let a=Number(m.angle);if(!Number.isFinite(a))return;let pitch=Math.max(-1.15,Math.min(1.15,Number(m.pitch)||0)),cp=Math.cos(pitch),dx=Math.sin(a)*cp,dy=Math.sin(pitch),dz=-Math.cos(a)*cp,best=null,bestD=Infinity,headshot=false;
// Two server-side hit spheres: head is smaller and deals 1.5× damage.
for(let target of room.players.values()){
 if(target.id===p.id||now<(target.invulnerableUntil||0))continue;
 for(const part of [{height:1.62,radius:.33,head:true},{height:.95,radius:.63,head:false}]){
  let rx=target.x-p.x,ry=(target.y||0)+part.height-((p.y||0)+1.7),rz=target.z-p.z;
  let along=rx*dx+ry*dy+rz*dz,side2=rx*rx+ry*ry+rz*rz-along*along,r=part.radius+(p.weapon==='shotgun'?.28:0);
  if(along<=0||side2>r*r)continue;let entry=along-Math.sqrt(Math.max(0,r*r-side2));
  if(entry>0&&entry<w.range&&entry<bestD){best=target;bestD=entry;headshot=part.head}
 }
}
broadcast(room,{type:'shot',id:p.id,x:p.x,y:(p.y||0)+1.7,z:p.z,angle:a,pitch,range:best?bestD:w.range,weapon:p.weapon});
if(best){let damage=headshot?Math.round(w.damage*1.5):w.damage;best.hp-=damage;broadcast(room,{type:'hit',shooter:p.id,target:best.id,x:best.x,y:(best.y||0)+(headshot?1.62:.95),z:best.z,damage,hp:Math.max(0,best.hp),headshot});
 if(best.hp<=0){p.kills++;best.deaths++;broadcast(room,{type:'death',target:best.id,x:best.x,y:best.y||0,z:best.z});best.hp=100;best.x=RESPAWN.x;best.z=RESPAWN.z;best.y=0;best.invulnerableUntil=now+3000;best.spawnRev++;best.moveCredit=2;send(best.ws,{type:'respawn',x:best.x,z:best.z,spawnRev:best.spawnRev,invulnerableUntil:best.invulnerableUntil});broadcast(room,{type:'notice',text:`${p.name} ⚡ ${best.name}`})}sync(room)}return}
});ws.on('close',()=>{leave(c);clients.delete(ws)})});
setInterval(()=>{for(const room of rooms.values()){if(room.phase==='lobby'&&room.countdown&&Date.now()>=room.countdown)start(room);else if(room.phase==='match'&&Date.now()>=room.ends)finish(room);else if(room.phase==='results'&&Date.now()>=room.ends){room.phase='lobby';room.epoch++;room.ends=0;room.results=null;for(const p of room.players.values()){p.x=0;p.z=-7;p.y=0;p.flip=0;p.hp=100;p.ready=false}sync(room)}else sync(room)}},250);
const port = Number(process.env.PORT) || 3001;
server.listen(port,'0.0.0.0',()=>console.log(`Arena server on ${port}`));
