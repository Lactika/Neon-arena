// Collision dimensions correspond to the arena GLB scaled x2 horizontally.
export const ARENA_RX=25.5, ARENA_RZ=20.1;
const covers=[[-11.6,0,2.0],[11.6,0,2.0],[0,-10.8,1.8],[0,10.8,1.8],[-5.4,-7,1.6],[5.4,7,1.6],[-5.4,7,1.6],[5.4,-7,1.6]];
// Positions, half-widths and heights of climbable cyberpunk structures.
export const VERTICAL_BLOCKS=[{x:-13,z:-7,hx:.8,hz:.8,h:2.4},{x:-10.5,z:-8.2,hx:.7,hz:.7,h:3.2},{x:13,z:7,hx:.8,hz:.8,h:2.4},{x:10.5,z:8.2,hx:.7,hz:.7,h:3.2},{x:0,z:14,hx:2.0,hz:.55,h:2.7},{x:0,z:-14,hx:2.0,hz:.55,h:2.7}];
// Sector 9: two lanes between the outer boundary and inner concrete partitions.
export const DUCT_BLOCKS=[{x:-11.8,z:-14,hx:1.4,hz:2,h:.85},{x:11.8,z:-14,hx:1.4,hz:2,h:.85},{x:-11.8,z:14,hx:1.4,hz:2,h:.85},{x:11.8,z:14,hx:1.4,hz:2,h:.85},{x:-9,z:0,hx:.3,hz:11,h:8.2},{x:9,z:0,hx:.3,hz:11,h:8.2},{x:-5.5,z:-6,hx:1,hz:1,h:1.4},{x:5.5,z:6,hx:1,hz:1,h:1.4},{x:-6.5,z:3,hx:1,hz:1,h:2.6},{x:6.5,z:-3,hx:1,hz:1,h:2.6},{x:0,z:0,hx:8.6,hz:1.05,h:4.2,bottom:3.85},{x:0,z:-8,hx:6,hz:.65,h:3.6,bottom:3.3},{x:0,z:8,hx:6,hz:.65,h:3.6,bottom:3.3}];
const blocksFor=phase=>phase==='duct'?DUCT_BLOCKS:VERTICAL_BLOCKS;
export function groundHeight(x,z,y,phase){if(phase!=='lobby')for(const b of blocksFor(phase))if(Math.abs(x-b.x)<=b.hx&&Math.abs(z-b.z)<=b.hz&&Math.abs(y-b.h)<.07)return b.h;return y<=.001?0:null}
export function landingHeight(x,z,from,to,phase){let top=0;if(phase!=='lobby')for(const b of blocksFor(phase))if(Math.abs(x-b.x)<=b.hx&&Math.abs(z-b.z)<=b.hz&&from>=b.h-.001&&to<=b.h&&b.h>top)top=b.h;return to<=top?top:null}
export function constrainPosition(x,z,phase,y=0){
 if(phase==='lobby'){
  x=Math.max(-8.25,Math.min(8.25,x));z=Math.max(-8.25,Math.min(8.25,z));
 }else{
  if(phase==='duct'){x=Math.max(-14.5,Math.min(14.5,x));z=Math.max(-17.5,Math.min(17.5,z))}else{let d=Math.hypot(x/ARENA_RX,z/ARENA_RZ);if(d>1){x/=d;z/=d}}
  for(const b of blocksFor(phase)){if(y>=b.h-.02||(b.bottom&&y+1.7<=b.bottom))continue;let dx=x-b.x,dz=z-b.z,ex=b.hx+.32,ez=b.hz+.32;if(Math.abs(dx)<ex&&Math.abs(dz)<ez){if(ex-Math.abs(dx)<ez-Math.abs(dz))x=b.x+(dx>=0?ex:-ex);else z=b.z+(dz>=0?ez:-ez)}}
  if(phase!=='duct'&&y<1.4)for(let [cx,cz,r] of covers){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d<r){if(d<.001){dx=r;dz=0;d=r}x=cx+dx*r/d;z=cz+dz*r/d}}
 }
 return {x,z};
}
export function wallContact(x,z,phase,y=0){
 if(phase==='lobby'){
  const dx=8.25-Math.abs(x),dz=8.25-Math.abs(z);if(Math.min(dx,dz)>.38)return null;
  return dx<dz?{x:-Math.sign(x),z:0}:{x:0,z:-Math.sign(z)};
 }
 for(const b of blocksFor(phase)){if(y>=b.h-.02||(b.bottom&&y+1.7<=b.bottom))continue;let dx=x-b.x,dz=z-b.z,ex=b.hx+.32,ez=b.hz+.32;if(Math.abs(dx)<=ex+.35&&Math.abs(dz)<=ez+.35){let diffX=Math.abs(Math.abs(dx)-ex),diffZ=Math.abs(Math.abs(dz)-ez);if(diffX<.35&&diffX<=diffZ)return {x:Math.sign(dx)||1,z:0};if(diffZ<.35)return {x:0,z:Math.sign(dz)||1}}}
 if(phase==='duct'){let dx=14.5-Math.abs(x),dz=17.5-Math.abs(z);if(Math.min(dx,dz)>.38)return null;return dx<dz?{x:-Math.sign(x),z:0}:{x:0,z:-Math.sign(z)}}
 if(y<1.4){for(let [cx,cz,r] of covers){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d>.0001&&Math.abs(d-r)<=.35)return {x:dx/d,z:dz/d}}}
 const q=Math.hypot(x/ARENA_RX,z/ARENA_RZ);if(q===0)return null;
 const nx=x/(ARENA_RX*ARENA_RX),nz=z/(ARENA_RZ*ARENA_RZ),n=Math.hypot(nx,nz);
 // Euclidean approximation to distance from the ellipse boundary.
 const distance=(1-q)*q/(n||1);if(distance>.45)return null;
 return {x:-nx/n,z:-nz/n};
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

export function wallSlideVelocity(vy,normal,inputX,inputZ,limit=1.8){return normal&&vy<0&&(inputX*normal.x+inputZ*normal.z)<-.15?Math.max(vy,-limit):vy}
