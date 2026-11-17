// Collision dimensions correspond to the arena GLB scaled x2 horizontally.
export const ARENA_RX=25.5, ARENA_RZ=20.1;
export function constrainPosition(x,z,phase,y=0){
 if(phase==='lobby'){
  x=Math.max(-8.25,Math.min(8.25,x));z=Math.max(-8.25,Math.min(8.25,z));
 }else{
  let d=Math.hypot(x/ARENA_RX,z/ARENA_RZ);if(d>1){x/=d;z/=d}
  const covers=[[-11.6,0,2.0],[11.6,0,2.0],[0,-10.8,1.8],[0,10.8,1.8],[-5.4,-7,1.6],[5.4,7,1.6],[-5.4,7,1.6],[5.4,-7,1.6]];
  if(y<1.4)for(let [cx,cz,r] of covers){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d<r){if(d<.001){dx=r;dz=0;d=r}x=cx+dx*r/d;z=cz+dz*r/d}}
 }
 return {x,z};
}
export function wallContact(x,z,phase){
 if(phase==='lobby'){
  const dx=8.25-Math.abs(x),dz=8.25-Math.abs(z);if(Math.min(dx,dz)>.38)return null;
  return dx<dz?{x:-Math.sign(x),z:0}:{x:0,z:-Math.sign(z)};
 }
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
