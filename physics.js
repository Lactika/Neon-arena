// Shared approximate collision bounds for the supplied 1:1 GLB map.
export function constrainPosition(x,z,phase,y=0){
 if(phase==='lobby'){
  x=Math.max(-8.25,Math.min(8.25,x));z=Math.max(-8.25,Math.min(8.25,z));
  // The holographic table in the centre of the ship.
  let d=Math.hypot(x,z);if(d<1.75&&y<1.4){if(d<.001){x=0;z=1.75}else{x*=1.75/d;z*=1.75/d}}
 }else{
  const rx=12.3,rz=9.7;let d=Math.hypot(x/rx,z/rz);if(d>1){x/=d;z/=d}
  // Approximate circular footprints of the columns and crates on the arena floor.
  const covers=[[-5.8,0,1.15],[5.8,0,1.15],[0,-5.4,1.05],[0,5.4,1.05],[-2.7,-3.5,1.0],[2.7,3.5,1.0],[-2.7,3.5,1.0],[2.7,-3.5,1.0]];
  if(y<1.35)for(let [cx,cz,r] of covers){let dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d<r){if(d<.001){dx=r;dz=0;d=r}x=cx+dx*r/d;z=cz+dz*r/d}}
 }
 return {x,z};
}
