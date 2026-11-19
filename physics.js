// Collision dimensions correspond to the arena GLB scaled x2 horizontally.
export const ARENA_RX=25.5, ARENA_RZ=20.1;
const covers=[[-11.6,0,2.0],[11.6,0,2.0],[0,-10.8,1.8],[0,10.8,1.8],[-5.4,-7,1.6],[5.4,7,1.6],[-5.4,7,1.6],[5.4,-7,1.6]];
// Positions, half-widths and heights of climbable cyberpunk structures.
export const VERTICAL_BLOCKS=[{x:-13,z:-7,hx:.8,hz:.8,h:2.4},{x:-10.5,z:-8.2,hx:.7,hz:.7,h:3.2},{x:13,z:7,hx:.8,hz:.8,h:2.4},{x:10.5,z:8.2,hx:.7,hz:.7,h:3.2},{x:0,z:14,hx:2.0,hz:.55,h:2.7},{x:0,z:-14,hx:2.0,hz:.55,h:2.7}];
// Sector 9: two lanes between the outer boundary and inner concrete partitions.
export const DUCT_BLOCKS=[{x:-11.8,z:-14,hx:1.4,hz:2,h:.85},{x:11.8,z:-14,hx:1.4,hz:2,h:.85},{x:-11.8,z:14,hx:1.4,hz:2,h:.85},{x:11.8,z:14,hx:1.4,hz:2,h:.85},{x:-9,z:0,hx:.3,hz:11,h:8.2},{x:9,z:0,hx:.3,hz:11,h:8.2},{x:-5.5,z:-6,hx:1,hz:1,h:1.4},{x:5.5,z:6,hx:1,hz:1,h:1.4},{x:-6.5,z:3,hx:1,hz:1,h:2.6},{x:6.5,z:-3,hx:1,hz:1,h:2.6},{x:0,z:0,hx:8.6,hz:1.05,h:4.2,bottom:3.85},{x:0,z:-8,hx:6,hz:.65,h:3.6,bottom:3.3},{x:0,z:8,hx:6,hz:.65,h:3.6,bottom:3.3}];
export const STATION_BLOCKS=[{x:-6,z:0,hx:.6,hz:5.5,h:5},{x:6,z:0,hx:.6,hz:5.5,h:5},{x:0,z:0,hx:2,hz:2,h:1.6},{x:-10,z:-9,hx:1.4,hz:1.4,h:2.6},{x:10,z:9,hx:1.4,hz:1.4,h:2.6},{x:0,z:-11,hx:3,hz:.5,h:3},{x:0,z:11,hx:3,hz:.5,h:3}];
// Solid spawn-screen walls provide cover, while translucent crates stop movement but not bullets.
VERTICAL_BLOCKS.push({x:15.3,z:0,hx:.35,hz:2.4,h:3.2,spawnCover:true},{x:7,z:-3,hx:1.1,hz:1.1,h:2.1,glass:true});
DUCT_BLOCKS.push({x:4,z:11.6,hx:2.1,hz:.35,h:3.1,spawnCover:true},{x:2,z:-4,hx:1,hz:1,h:2.1,glass:true});
STATION_BLOCKS.push({x:4.5,z:11.8,hx:2,hz:.35,h:3.1,spawnCover:true},{x:-3,z:5,hx:1,hz:1,h:2.1,glass:true});
// Slab intersection: returns nearest solid geometry in the ray, with bridge undersides respected.
export function shotWallDistance(phase,ox,oy,oz,dx,dy,dz,maxDistance){
 let nearest=maxDistance;
 for(const b of blocksFor(phase)){
  if(b.glass)continue;
  let lo=0,hi=nearest;const bounds=[[ox,dx,b.x-b.hx,b.x+b.hx],[oy,dy,b.bottom||0,b.h],[oz,dz,b.z-b.hz,b.z+b.hz]];
  for(const [o,d,min,max] of bounds){if(Math.abs(d)<1e-9){if(o<min||o>max){hi=-1;break}}else{let t1=(min-o)/d,t2=(max-o)/d;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)break}}
  if(hi>=lo&&hi>=0&&lo<nearest)nearest=Math.max(0,lo);
 }
 // The Colosseum kit's circular props have approximate cylindrical collision volumes.
 if(phase!=='duct'&&phase!=='station'&&phase!=='neoball'&&phase!=='garden'&&phase!=='lobby')for(const [cx,cz,r] of covers){let px=ox-cx,pz=oz-cz,a=dx*dx+dz*dz,b=2*(px*dx+pz*dz),c=px*px+pz*pz-r*r,disc=b*b-4*a*c;if(a<1e-9||disc<0)continue;let lo=Math.max(0,(-b-Math.sqrt(disc))/(2*a)),hi=(-b+Math.sqrt(disc))/(2*a);if(Math.abs(dy)<1e-9){if(oy<0||oy>1.4)continue}else{let y1=(0-oy)/dy,y2=(1.4-oy)/dy;if(y1>y2)[y1,y2]=[y2,y1];lo=Math.max(lo,y1);hi=Math.min(hi,y2)}if(hi>=lo&&lo<nearest)nearest=lo}
 return nearest;
}
// Neo-ball: solid volumes are the single source of truth for rendered cover, ray hits and wall kicks.
export const NEO_BLOCKS = [
 // Alternating full-height bulkheads force a winding route, with generous openings.
 {x:-4,z:-38,hx:11,hz:.6,h:12,kind:'turn'},
 {x:4,z:-19,hx:11,hz:.6,h:12,kind:'turn'},
 {x:-4,z:19,hx:11,hz:.6,h:12,kind:'turn'},
 {x:4,z:38,hx:11,hz:.6,h:12,kind:'turn'},
 // Cover in each section leaves the central route and the turns open.
 ...[-52,-28,0,28,52].flatMap(z=>[
  {x:-10,z,hx:1.3,hz:1.3,h:2.3,kind:'crate'},
  {x:10,z,hx:1.3,hz:1.3,h:2.3,kind:'crate'}]),
 ...[-1,1].flatMap(side=>[
  {x:-3.5,z:side*62,hx:1.5,hz:.5,h:4.4,kind:'trailer'},
  {x:3.5,z:side*62,hx:1.5,hz:.5,h:4.4,kind:'trailer'},
  {x:-1.8,z:side*61,hx:.08,hz:.12,h:4.05,kind:'goalpost'},
  {x:1.8,z:side*61,hx:.08,hz:.12,h:4.05,kind:'goalpost'},
  {x:0,z:side*61,hx:1.8,hz:.12,bottom:3.97,h:4.13,kind:'goalpost'}])
];
// Garden & Two Houses ("Сад и два домика"): houses with walk-in doorways & roofs, jumpable trees, and flowerbeds.
export const GARDEN_BLOCKS = [
 // House 1 (-10, -4)
 {x:-10,z:-7.35,hx:3.6,hz:.3,h:3.4,kind:'house_wall'},
 {x:-12.5,z:-0.65,hx:1.1,hz:.3,h:3.4,kind:'house_wall'},
 {x:-7.5,z:-0.65,hx:1.1,hz:.3,h:3.4,kind:'house_wall'},
 {x:-13.35,z:-4,hx:.3,hz:3.4,h:3.4,kind:'house_wall'},
 {x:-6.65,z:-6.35,hx:.3,hz:1.05,h:3.4,kind:'house_wall'},
 {x:-6.65,z:-1.65,hx:.3,hz:1.05,h:3.4,kind:'house_wall'},
 {x:-10,z:-4,hx:3.8,hz:3.8,bottom:3.35,h:3.85,kind:'house_roof'},
 // House 2 (+10, +4)
 {x:10,z:7.35,hx:3.6,hz:.3,h:3.4,kind:'house_wall'},
 {x:7.5,z:0.65,hx:1.1,hz:.3,h:3.4,kind:'house_wall'},
 {x:12.5,z:0.65,hx:1.1,hz:.3,h:3.4,kind:'house_wall'},
 {x:13.35,z:4,hx:.3,hz:3.4,h:3.4,kind:'house_wall'},
 {x:6.65,z:1.65,hx:.3,hz:1.05,h:3.4,kind:'house_wall'},
 {x:6.65,z:6.35,hx:.3,hz:1.05,h:3.4,kind:'house_wall'},
 {x:10,z:4,hx:3.8,hz:3.8,bottom:3.35,h:3.85,kind:'house_roof'},
 // Climbable trees: trunk + lower jumpable canopy (h=2.45) + upper canopy (h=3.45)
 ...[[-5.2,6.2],[5.2,-6.2],[0,0],[-13.5,9.5],[13.5,-9.5]].flatMap(([tx,tz])=>[
  {x:tx,z:tz,hx:.42,hz:.42,h:2.8,kind:'trunk'},
  {x:tx,z:tz,hx:1.6,hz:1.6,bottom:2.05,h:2.45,kind:'canopy_low'},
  {x:tx,z:tz,hx:2.1,hz:2.1,bottom:3.05,h:3.45,kind:'canopy_top'}
 ]),
 // Raised flowerbeds & garden lawns (easy jump stepping stones)
 {x:-5.2,z:2.9,hx:1.25,hz:1.15,h:1.05,kind:'flowerbed'},
 {x:5.2,z:-2.9,hx:1.25,hz:1.15,h:1.05,kind:'flowerbed'},
 {x:0,z:-4.3,hx:1.6,hz:1.1,h:1.0,kind:'flowerbed'},
 {x:0,z:4.3,hx:1.6,hz:1.1,h:1.0,kind:'flowerbed'},
 {x:-3.2,z:-10.2,hx:2.0,hz:1.15,h:.95,kind:'flowerbed'},
 {x:3.2,z:10.2,hx:2.0,hz:1.15,h:.95,kind:'flowerbed'},
 {x:-14.5,z:-13.8,hx:1.8,hz:1.2,h:1.15,kind:'flowerbed'},
 {x:14.5,z:13.8,hx:1.8,hz:1.2,h:1.15,kind:'flowerbed'}
];
export const HUB_ZONES=[{id:'neo2',mode:'neoball',capacity:2,x:-8,z:-11,radius:2.3},{id:'chaser',mode:'chaser',capacity:5,minPlayers:3,x:0,z:-11,radius:2.35},{id:'neo4',mode:'neoball',capacity:4,x:8,z:-11,radius:2.3},{id:'duo',capacity:2,x:-8,z:3,radius:2.3},{id:'trio',capacity:3,x:0,z:3,radius:2.3},{id:'squad',capacity:4,x:8,z:3,radius:2.3}];
export const VOTE_ZONES=[{id:'duct',x:-6.6,z:0,radius:2.0},{id:'colosseum',x:-2.2,z:0,radius:2.0},{id:'station',x:2.2,z:0,radius:2.0},{id:'garden',x:6.6,z:0,radius:2.0}];
export function voteAt(x,z){return VOTE_ZONES.find(v=>Math.hypot(x-v.x,z-v.z)<=v.radius)?.id||null}
const blocksFor=phase=>phase==='duct'?DUCT_BLOCKS:phase==='station'?STATION_BLOCKS:phase==='neoball'?NEO_BLOCKS:phase==='garden'?GARDEN_BLOCKS:VERTICAL_BLOCKS;
export function groundHeight(x,z,y,phase){if(phase!=='lobby'&&phase!=='hub')for(const b of blocksFor(phase))if(Math.abs(x-b.x)<=b.hx&&Math.abs(z-b.z)<=b.hz&&Math.abs(y-b.h)<.07)return b.h;return y<=.001?0:null}
export function landingHeight(x,z,from,to,phase){let top=0;if(phase!=='lobby'&&phase!=='hub')for(const b of blocksFor(phase))if(Math.abs(x-b.x)<=b.hx&&Math.abs(z-b.z)<=b.hz&&from>=b.h-.001&&to<=b.h&&b.h>top)top=b.h;return to<=top?top:null}
export function constrainPosition(x,z,phase,y=0){
 if(phase==='lobby'||phase==='hub'){
  let edge=phase==='hub'?15.65:8.25;x=Math.max(-edge,Math.min(edge,x));z=Math.max(-edge,Math.min(edge,z));
 }else{
  if(phase==='duct'||phase==='station'||phase==='neoball'||phase==='garden'){let xEdge=phase==='garden'?18.5:14.5;x=Math.max(-xEdge,Math.min(xEdge,x));let zEdge=phase==='neoball'?70:phase==='garden'?18.5:17.5;z=Math.max(-zEdge,Math.min(zEdge,z))}else{let d=Math.hypot(x/ARENA_RX,z/ARENA_RZ);if(d>1){x/=d;z/=d}}
  for(const b of blocksFor(phase)){if(y>=b.h-.02||(b.bottom&&y+1.7<=b.bottom))continue;let dx=x-b.x,dz=z-b.z,ex=b.hx+.32,ez=b.hz+.32;if(Math.abs(dx)<ex&&Math.abs(dz)<ez){if(ex-Math.abs(dx)<ez-Math.abs(dz))x=b.x+(dx>=0?ex:-ex);else z=b.z+(dz>=0?ez:-ez)}}
  if(phase!=='duct'&&phase!=='station'&&phase!=='neoball'&&phase!=='garden'&&y<1.4)for(let [cx,cz,r] of covers){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d<r){if(d<.001){dx=r;dz=0;d=r}x=cx+dx*r/d;z=cz+dz*r/d}}
 }
 return {x,z};
}
export function wallContact(x,z,phase,y=0){
 if(phase==='lobby'||phase==='hub'){
  let edge=phase==='hub'?15.65:8.25;const dx=edge-Math.abs(x),dz=edge-Math.abs(z);if(Math.min(dx,dz)>.38)return null;
  return dx<dz?{x:-Math.sign(x),z:0,id:'lobby-x-'+Math.sign(x)}:{x:0,z:-Math.sign(z),id:'lobby-z-'+Math.sign(z)};
 }
 for(const [i,b] of blocksFor(phase).entries()){if(y>=b.h-.02||(b.bottom&&y+1.7<=b.bottom))continue;let dx=x-b.x,dz=z-b.z,ex=b.hx+.32,ez=b.hz+.32;if(Math.abs(dx)<=ex+.35&&Math.abs(dz)<=ez+.35){let diffX=Math.abs(Math.abs(dx)-ex),diffZ=Math.abs(Math.abs(dz)-ez);if(diffX<.35&&diffX<=diffZ)return {x:Math.sign(dx)||1,z:0,id:phase+'-block-'+i};if(diffZ<.35)return {x:0,z:Math.sign(dz)||1,id:phase+'-block-'+i}}}
 if(phase==='duct'||phase==='station'||phase==='neoball'||phase==='garden'){let xEdge=phase==='garden'?18.5:14.5,zEdge=phase==='neoball'?70:phase==='garden'?18.5:17.5;let dx=xEdge-Math.abs(x),dz=zEdge-Math.abs(z);if(Math.min(dx,dz)>.38)return null;return dx<dz?{x:-Math.sign(x),z:0,id:phase+'-x-'+Math.sign(x)}:{x:0,z:-Math.sign(z),id:phase+'-z-'+Math.sign(z)}}
 if(y<1.4){for(let [i,[cx,cz,r]] of covers.entries()){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d>.0001&&Math.abs(d-r)<=.35)return {x:dx/d,z:dz/d,id:'cover-'+i}}}
 const q=Math.hypot(x/ARENA_RX,z/ARENA_RZ);if(q===0)return null;
 const nx=x/(ARENA_RX*ARENA_RX),nz=z/(ARENA_RZ*ARENA_RZ),n=Math.hypot(nx,nz);
 // Euclidean approximation to distance from the ellipse boundary.
 const distance=(1-q)*q/(n||1);if(distance>.45)return null;
 return {x:-nx/n,z:-nz/n,id:'colosseum-rim'};
}

// Input timing is separate from collision detection so it can also be used on platforms.
export class JumpWindow {
 constructor(windowMs=130){this.windowMs=windowMs;this.reset()}
 reset(){this.lastGround=-Infinity;this.requested=-Infinity;this.consumed=false;this.held=false}
 ground(now,grounded){if(grounded){this.lastGround=now;this.consumed=false}}
 press(now){this.held=true;this.requested=now}
 release(){this.held=false}
 take(now){if(now-this.requested<=this.windowMs&&now-this.lastGround<=this.windowMs&&!this.consumed){this.requested=-Infinity;this.consumed=true;return true}return false}
 discard(){this.requested=-Infinity;this.consumed=true}
}

export function wallSlideVelocity(vy,normal,inputX,inputZ,limit=.3){return normal&&vy<0&&(inputX*normal.x+inputZ*normal.z)<-.15?Math.max(vy,-limit):vy}

// A surface cannot provide two consecutive kicks without landing or touching another surface.
export class WallKickLock {
 constructor(){this.last=null}
 canKick(wall){return !!wall&&wall.id!==this.last}
 kicked(wall){this.last=wall.id}
 land(){this.last=null}
}
