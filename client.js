import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { constrainPosition, wallContact, wallSlideVelocity, JumpWindow, WallKickLock, ARENA_RX, ARENA_RZ, VERTICAL_BLOCKS, DUCT_BLOCKS, STATION_BLOCKS, NEO_BLOCKS, GARDEN_BLOCKS, VOTE_ZONES, HUB_ZONES, groundHeight, landingHeight, shotWallDistance } from './physics.js';
const $=s=>document.querySelector(s), menu=$('#menu'), hud=$('#hud');
function updateTelegramInsets(){
 const tg=window.Telegram?.WebApp;
 const isTg=!!(tg&&(tg.initData||(tg.platform&&tg.platform!=='unknown')));
 document.body.classList.toggle('in-tg',isTg);
 const topInset=Math.max(tg?.contentSafeAreaInset?.top||0,tg?.safeAreaInset?.top||0);
 if(isTg||topInset>0){
  document.body.style.setProperty('--hud-top',`${Math.max(isTg?48:10,topInset)}px`);
 }
}
function initTelegram(){
 const tg=window.Telegram?.WebApp;
 try{tg?.ready();tg?.expand();tg?.onEvent?.('safeAreaChanged',updateTelegramInsets);tg?.onEvent?.('contentSafeAreaChanged',updateTelegramInsets)}catch{}
 updateTelegramInsets();
 const user=tg?.initDataUnsafe?.user;
 if(user&&!$('#name').value)$('#name').value=user.username?'@'+user.username:user.first_name||'';
}
initTelegram();document.addEventListener('DOMContentLoaded',initTelegram);
let refreshPreview=()=>{};
const validHeroes=['shadow','viper','blitz','skye','yoru','celeste','noch','ari','ben'];
const heroLooks={
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
const heroDescriptions={
 shadow:'Скрытный боец в фиолетовой броне.',
 viper:'Розовый неон и золотая броня.',
 blitz:'Голубой импульс и быстрая атака.',
 skye:'Чёрные волосы и жёлтый кибер-костюм.',
 yoru:'Чёрные волосы и фиолетовая броня.',
 celeste:'Два хвостика и белое неоновое платье.',
 noch:'Чёрный хвостик, бородка и фиолетовый комбинезон.',
 ari:'Длинные коричневые волосы, зелёные глаза, белое худи и джинсы.',
 ben:'Короткая стрижка, голубая кофта и серые штаны.'
};
let look={...heroLooks.shadow,outfit:'default',weaponSkin:'default'};
for(const button of document.querySelectorAll('.hero-card'))button.addEventListener('click',()=>{let hero=button.dataset.hero;look={...heroLooks[hero],outfit:'default',weaponSkin:'default'};$('#selected-name').textContent=hero.toUpperCase();$('#selected-desc').textContent=heroDescriptions[hero];for(const el of document.querySelectorAll('.hero-card')){let active=el===button;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active))}refreshPreview()});
let roomMode='private',currentMap='colosseum';const worldPhase=()=>phase==='lobby'?(roomMode==='hub'?'hub':'lobby'):currentMap==='duct'?'duct':currentMap==='station'?'station':currentMap==='neoball'?'neoball':currentMap==='garden'?'garden':phase;
let currentSlide=false,lastWallNormal={x:0,z:0};
let hyperActive=false,hyperStart=0,hyperDuration=7200,hyperSector=0,hyperTargetSector=0,hyperSwitched=false,isSeated=false;
let serverClockOffset=0;const serverNow=()=>Date.now()+serverClockOffset;
let chaserSnapshot=null,chaserBannerUntil=0,chaserBannerMe=false,spectateId=null,matchEndsAt=0;
let ws,me,room=null,defs={},outfitDefs={},weaponSkinDefs={},shopTab='weapons',players=new Map(),connected=false,angle=0,pitch=0,zoom=false,keys={},joy={x:0,y:0},firing=false,lastSend=0,lastFire=0,noticeTimer=0,phase='lobby',audio=null,musicTimer=null,resultsOpen=false, jumpY=0,jumpV=0,impulseX=0,impulseZ=0,flipTime=0,lastWall=0,lastWallSlideFx=0, countdownEnd=0,endingAt=0,endingDigit=null,moveVX=0,moveVZ=0,walkCycle=0,landing=0,recoil=0,roomEpoch=0,moveSeq=0,flash=0,hitTime=0,lastDash=-10000,myRespawnUntil=0,wasServerDead=false;
const jumpWindow=new JumpWindow(130),wallLock=new WallKickLock();let jumpPointer=null,wallCarry=0;
function resetJump(){wallLock.land();wallCarry=0;currentSlide=false;jumpY=0;jumpV=0;jumpWindow.reset();jumpPointer=null}
function setGameGestures(enabled){document.documentElement.classList.toggle('in-game',enabled);try{let tg=window.Telegram?.WebApp;if(enabled)tg?.disableVerticalSwipes?.();else tg?.enableVerticalSwipes?.()}catch{}}
function clearPlayerSprites(o){scene.remove(o.mesh);if(o.healthSprite){scene.remove(o.healthSprite);o.healthSprite.material.map.dispose();o.healthSprite.material.dispose()}if(o.nameSprite){scene.remove(o.nameSprite);o.nameSprite.material.map.dispose();o.nameSprite.material.dispose()}}
function connect(){ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);ws.onopen=()=>{connected=true;$('#menumsg').textContent='Сервер подключён. Приветственный бонус: 10 000 монет!' };ws.onclose=()=>{connected=false;$('#menumsg').textContent='Нет связи с игровым сервером. Проверьте, что запущен Node.js сервер с WebSocket.';if(room){room=null;myRespawnUntil=0;wasServerDead=false;spectateId=null;chaserSnapshot=null;chaserBannerUntil=0;$('#chaser-banner').classList.add('hide');$('#spectator-hud').classList.add('hide');$('#respawn-overlay').classList.add('hide');$('#end-transition').classList.add('hide');roomMode='private';$('#map-vote-modal').classList.add('hide');setGameGestures(false);refreshWorld();menu.classList.remove('hide');hud.classList.add('hide');$('#shop').classList.add('hide');$('#results').classList.add('hide');$('#menumsg').textContent='Связь с сервером потеряна. Обновите страницу.';stopMusic();syncMusic()}};ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.type==='hello'){me=m.id;defs=m.weapons||{};outfitDefs=m.outfits||{};weaponSkinDefs=m.weaponSkins||{}}else if(m.type==='joined'){if(m.transfer){$('#shop').classList.add('hide');for(const o of players.values())clearPlayerSprites(o);players.clear();moveVX=moveVZ=impulseX=impulseZ=0;flipTime=0}myRespawnUntil=0;wasServerDead=false;spectateId=null;chaserSnapshot=null;chaserBannerUntil=0;$('#chaser-banner').classList.add('hide');$('#spectator-hud').classList.add('hide');$('#respawn-overlay').classList.add('hide');resetJump();room=m.code;syncMusic();setGameGestures(true);angle=Math.PI;pitch=0;refreshWorld();menu.classList.add('hide');hud.classList.remove('hide')}else if(m.type==='left'){myRespawnUntil=0;wasServerDead=false;spectateId=null;chaserSnapshot=null;chaserBannerUntil=0;$('#chaser-banner').classList.add('hide');$('#spectator-hud').classList.add('hide');$('#respawn-overlay').classList.add('hide');resetJump();$('#end-transition').classList.add('hide');room=null;roomMode='private';$('#map-vote-modal').classList.add('hide');setGameGestures(false);refreshWorld();menu.classList.remove('hide');hud.classList.add('hide');$('#shop').classList.add('hide');$('#results').classList.add('hide');stopMusic();syncMusic();for(let p of players.values())clearPlayerSprites(p);players.clear()}else if(m.type==='error'){$('#menumsg').textContent=m.text;showNotice(m.text)}else if(m.type==='notice')showNotice(m.text);else if(m.type==='chaser_assigned'){triggerChaserBanner(m)}else if(m.type==='respawn'){myRespawnUntil=0;wasServerDead=false;$('#respawn-overlay').classList.add('hide');let p=players.get(me);if(p){p.x=m.x;p.z=m.z;p.data.spawnRev=m.spawnRev;p.data.respawnAt=0;moveVX=0;moveVZ=0;resetJump();impulseX=0;impulseZ=0;p.mesh.position.set(m.x,0,m.z)}}else if(m.type==='wallbounce'){if(m.id!==me)wallSparks(m.x,m.y,m.z,m.nx,m.nz)}else if(m.type==='hyperdrive'){triggerHyperdrive(m.sector,m.duration,m.by)}else if(m.type==='shot')trace(m);else if(m.type==='hit')showHit(m);else if(m.type==='death')showDeath(m);else if(m.type==='state')applyState(m)}}connect();
async function fullscreen(){try{const tg=window.Telegram?.WebApp;if(tg?.requestFullscreen){tg.requestFullscreen();return}if(document.fullscreenElement){await document.exitFullscreen();return}if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();return}tg?.expand?.();showNotice('Разверните окно Telegram на весь экран')}catch{showNotice('Полный экран недоступен в этом браузере')}}$('#fullscreen').onclick=fullscreen;$('#fullscreen-menu').onclick=fullscreen;
function send(m){if(connected)ws.send(JSON.stringify(m))}function join(code,priv=false){if(!connected){$('#menumsg').textContent='Нет связи с игровым сервером. Проверьте, что запущен Node.js сервер с WebSocket.';return}send({type:'join',code,name:$('#name').value,look,private:priv});initAudio()}$('#create').onclick=()=>join('');$('#create-private').onclick=()=>join('',true);$('#join').onclick=()=>{const code=$('#code').value.trim();if(!code){$('#menumsg').textContent='Введите код комнаты';return}join(code)};$('#leave').onclick=()=>send({type:'leave'});$('#shopBtn').onclick=()=>{$('#shop').classList.remove('hide');renderShop();syncMusic()};$('#closeShop').onclick=()=>{$('#shop').classList.add('hide');syncMusic()};
for(const tabBtn of document.querySelectorAll('.shop-tab'))tabBtn.addEventListener('click',()=>{shopTab=tabBtn.dataset.tab;for(const b of document.querySelectorAll('.shop-tab'))b.classList.toggle('active',b===tabBtn);$('#items').dataset.signature='';renderShop()});
const scene=new THREE.Scene();scene.background=new THREE.Color(0x171834);scene.fog=new THREE.Fog(0x171834,45,115);const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,150);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;document.body.prepend(renderer.domElement);let hemi=new THREE.HemisphereLight(0xc9d7ff,0x27203d,.85);scene.add(hemi);let sun=new THREE.DirectionalLight(0xbcd7ff,.4);sun.position.set(10,25,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.camera.near=1;sun.shadow.camera.far=75;sun.shadow.bias=-.0004;sun.shadow.normalBias=.025;sun.shadow.radius=3;scene.add(sun);
const tealLight=new THREE.PointLight(0x6cc5d0,28,35,2);tealLight.position.set(-15,8,3);scene.add(tealLight);const purpleLight=new THREE.PointLight(0x9876bf,30,38,2);purpleLight.position.set(15,9,-5);scene.add(purpleLight);
const mat=(c,em=0)=>new THREE.MeshStandardMaterial({color:c,emissive:em,roughness:.68});function box(w,h,d,m,x,y,z){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);scene.add(o);return o}let stone=mat(0x82758e),floor=mat(0x534963);box(44,1,44,floor,0,-.5,0);for(let i=-20;i<=20;i+=4){box(.035,.02,42,mat(0x9b84ac),i,.01,0);box(42,.02,.035,mat(0x9b84ac),0,.012,i)}
for(let i=0;i<20;i++){let a=i*Math.PI*2/20,x=Math.sin(a)*25,z=Math.cos(a)*25;let pillar=new THREE.Mesh(new THREE.CylinderGeometry(.65,.8,9,8),stone);pillar.position.set(x,4.5,z);scene.add(pillar);let top=box(7,1,1.5,stone,x,9,z);top.rotation.y=a;let glow=box(.2,2,.2,mat(0x49dbf6,0x18728a),x*.91,3,z*.91);glow.rotation.y=a}for(let i=0;i<12;i++){let a=i*Math.PI*2/12;let ob=box(1.5,2,1.5,mat(0x625675),Math.sin(a)*21,1,Math.cos(a)*21);ob.rotation.y=a}
let neonCyan=mat(0x33dff4,0x10758a), neonPink=mat(0xf64bc4,0x821070), dark=mat(0x23263f), trim=mat(0xaca2c3);
for(let level=0;level<3;level++){let radius=26+level*2;let rail=new THREE.Mesh(new THREE.TorusGeometry(radius,.12,6,72),level%2?neonPink:neonCyan);rail.rotation.x=Math.PI/2;rail.position.y=3+level*2.6;scene.add(rail)}
for(let i=0;i<20;i++){let a=i*Math.PI*2/20;let x=Math.sin(a)*25,z=Math.cos(a)*25;let arch=new THREE.Mesh(new THREE.TorusGeometry(2.8,.25,6,16,Math.PI),trim);arch.position.set(x,7.4,z);arch.rotation.y=a;scene.add(arch);let light=box(.32,.32,.32,i%2?neonCyan:neonPink,x,10,z)}
for(let side of [-1,1]){box(40,.4,.6,dark,0,.2,side*19.5);box(40,.12,.15,neonPink,0,.44,side*19.5);box(.6,.4,40,dark,side*19.5,.2,0);box(.15,.12,40,neonCyan,side*19.5,.44,0)}
for(let i=-18;i<=18;i+=6){box(.07,.04,39,neonCyan,i,.035,0);box(39,.04,.07,neonPink,0,.04,i)}
for(let i=0;i<4;i++){
 let terrace=new THREE.Mesh(new THREE.RingGeometry(25+i*2,27+i*2,72),mat(i%2?0x34304d:0x413756));terrace.rotation.x=-Math.PI/2;terrace.position.y=1+i*1.7;scene.add(terrace);
}
const crowd=new THREE.InstancedMesh(new THREE.BoxGeometry(.22,.35,.18),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x221128,roughness:.9}),900);
const crowdDummy=new THREE.Object3D(),crowdColor=new THREE.Color();let seed=47;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
for(let i=0;i<900;i++){let a=rnd()*Math.PI*2,tier=Math.floor(rnd()*4),radius=25.5+tier*2+rnd()*1.5;crowdDummy.position.set(Math.sin(a)*radius,1.25+tier*1.7,Math.cos(a)*radius);crowdDummy.rotation.y=a;crowdDummy.scale.set(.6+rnd()*.7,.7+rnd()*.7,.7);crowdDummy.updateMatrix();crowd.setMatrixAt(i,crowdDummy.matrix);crowdColor.setHSL([.51,.78,.88,.12][Math.floor(rnd()*4)],.8,.52);crowd.setColorAt(i,crowdColor)}scene.add(crowd);
for(let i=0;i<12;i++){let a=i*Math.PI*2/12;let panel=box(1.3,3.0,.16,i%2?neonPink:neonCyan,Math.sin(a)*24,5.5,Math.cos(a)*24);panel.rotation.y=a;}
const fallbackWorld=new THREE.Group();for(const obj of [...scene.children])if(obj.isMesh||obj.isInstancedMesh)fallbackWorld.add(obj);scene.add(fallbackWorld);
let ring=new THREE.Mesh(new THREE.RingGeometry(2.6,3,64),new THREE.MeshBasicMaterial({color:0x57f5ed,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.06;ring.position.z=-4;scene.add(ring);let beacon=new THREE.Mesh(new THREE.CylinderGeometry(3,3,.04,48),new THREE.MeshBasicMaterial({color:0x43ffe5,transparent:true,opacity:.14}));beacon.position.y=.055;beacon.position.z=-4;scene.add(beacon);
const loader=new GLTFLoader();const kitModels={};let arenaWorld=null,lobbyWorld=null,crowdWorld=null,lowQuality=false;
const reflectionGenerator=new THREE.PMREMGenerator(renderer);const reflectionScene=new THREE.Scene();reflectionScene.background=new THREE.Color(0x111229);function reflectionPanel(color,x,y,z,w,h,ry=0){let panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));panel.position.set(x,y,z);panel.rotation.y=ry;reflectionScene.add(panel)}reflectionPanel(0x39cde0,-8,5,0,10,1,Math.PI/2);reflectionPanel(0xaa36ed,8,5,0,10,1,Math.PI/2);reflectionPanel(0x5a6992,0,9,0,12,3);reflectionPanel(0x3e4263,0,3,-9,12,2);const reflectionEnv=reflectionGenerator.fromScene(reflectionScene,.12).texture;reflectionGenerator.dispose();
const roughCanvas=document.createElement('canvas');roughCanvas.width=roughCanvas.height=128;const roughCtx=roughCanvas.getContext('2d'),roughData=roughCtx.createImageData(128,128);let roughSeed=9427;for(let y=0;y<128;y++)for(let x=0;x<128;x++){roughSeed=(roughSeed*16807)%2147483647;let grain=roughSeed/2147483647,brush=Math.sin(y*.65)*.055+Math.sin(x*.11+y*.19)*.025,v=Math.floor(170+grain*48+brush*255),i=(y*128+x)*4;roughData.data[i]=roughData.data[i+1]=roughData.data[i+2]=Math.max(0,Math.min(255,v));roughData.data[i+3]=255}roughCtx.putImageData(roughData,0,0);const roughMap=new THREE.CanvasTexture(roughCanvas);roughMap.wrapS=roughMap.wrapT=THREE.RepeatWrapping;roughMap.repeat.set(2,2);roughMap.colorSpace=THREE.NoColorSpace;
function ensureUV(mesh){let g=mesh.geometry;if(!g||g.attributes.uv||!g.attributes.position)return;g=g.clone();let p=g.attributes.position,n=g.attributes.normal,uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i),nx=n?Math.abs(n.getX(i)):0,ny=n?Math.abs(n.getY(i)):1,nz=n?Math.abs(n.getZ(i)):0;uv[2*i]=(nx>ny&&nx>nz?z:x)*.22;uv[2*i+1]=(ny>nx&&ny>nz?z:y)*.22}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));mesh.geometry=g}
const composer=new EffectComposer(renderer);composer.setPixelRatio(Math.min(devicePixelRatio,1));const basePass=new RenderPass(scene,camera);composer.addPass(basePass);
const ssr=new SSRPass({renderer,scene,camera,width:innerWidth,height:innerHeight,selects:[]});ssr.resolutionScale=.4;ssr.opacity=.22;ssr.maxDistance=12;ssr.thickness=.025;ssr.enabled=false;composer.addPass(ssr);
const ssao=new SSAOPass(scene,camera,innerWidth,innerHeight,16);ssao.kernelRadius=8;ssao.minDistance=.005;ssao.maxDistance=.12;ssao.enabled=false;composer.addPass(ssao);
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.22,.55,1.05);composer.addPass(bloom);
const grading=new ShaderPass({uniforms:{tDiffuse:{value:null},strength:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));vec3 shadow=vec3(.035,.012,.065)*(1.0-smoothstep(.05,.48,l));vec3 highlight=vec3(.005,.025,.035)*smoothstep(.18,.8,l);vec3 graded=(c.rgb-.18)*1.10+.18+shadow+highlight;graded=mix(vec3(dot(graded,vec3(.2126,.7152,.0722))),graded,1.09);float vig=1.0-.12*smoothstep(.20,.82,length(vUv-.5));gl_FragColor=vec4(mix(c.rgb,graded*vig,strength),c.a);}`});composer.addPass(grading);composer.addPass(new OutputPass());
const skyCanvas=document.createElement('canvas');skyCanvas.width=1024;skyCanvas.height=512;let skyCtx=skyCanvas.getContext('2d'),skyGradient=skyCtx.createLinearGradient(0,0,0,512);skyGradient.addColorStop(0,'#111731');skyGradient.addColorStop(.38,'#252653');skyGradient.addColorStop(.7,'#45436c');skyGradient.addColorStop(1,'#5c5474');skyCtx.fillStyle=skyGradient;skyCtx.fillRect(0,0,1024,512);
let cloudSeed=731;function skyRand(){cloudSeed=(cloudSeed*16807)%2147483647;return cloudSeed/2147483647}for(let i=0;i<55;i++){let x=skyRand()*1024,y=210+skyRand()*125,w=15+skyRand()*90;let cloud=skyCtx.createRadialGradient(x,y,0,x,y,w);cloud.addColorStop(0,'rgba(255,255,255,.28)');cloud.addColorStop(1,'rgba(255,255,255,0)');skyCtx.fillStyle=cloud;skyCtx.fillRect(x-w,y-w,w*2,w*2)}
const skyTex=new THREE.CanvasTexture(skyCanvas);skyTex.colorSpace=THREE.SRGBColorSpace;const arenaSky=new THREE.Mesh(new THREE.SphereGeometry(85,32,16),new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,depthWrite:false,fog:false}));arenaSky.renderOrder=-100;arenaSky.visible=false;scene.add(arenaSky);
function refreshWorld(){let isLobby=!room||phase==='lobby';bloom.strength=isLobby?.16:.12;grading.uniforms.strength.value=isLobby?0:.38;ssr.enabled=!isLobby&&!lowQuality;ssao.enabled=!isLobby&&!lowQuality;basePass.enabled=!ssr.enabled;renderer.shadowMap.enabled=!isLobby&&!lowQuality;tealLight.visible=purpleLight.visible=!isLobby;arenaSky.visible=!isLobby;hemi.intensity=isLobby?.85:.58;sun.intensity=isLobby?.4:.8;scene.fog.color.setHex(isLobby?0x090d22:0x353251);scene.fog.near=isLobby?50:80;scene.fog.far=isLobby?120:150;fallbackWorld.visible=isLobby?!lobbyWorld:(currentMap==='colosseum'&&!arenaWorld);if(typeof spaceExterior!=='undefined')spaceExterior.visible=isLobby;if(lobbyWorld){lobbyWorld.visible=isLobby;lobbyWorld.scale.set(room&&roomMode==='hub'?1.9:1,room&&roomMode==='hub'?1.65:1,room&&roomMode==='hub'?1.9:1)}hubPortalWorld.visible=isLobby&&!!room&&roomMode==='hub';votePadWorld.visible=isLobby&&!!room&&roomMode==='private';if(arenaWorld)arenaWorld.visible=!isLobby&&currentMap==='colosseum';verticalWorld.visible=!isLobby&&currentMap==='colosseum';ductWorld.visible=!isLobby&&currentMap==='duct';stationWorld.visible=!isLobby&&currentMap==='station';neoWorld.visible=!isLobby&&currentMap==='neoball';if(typeof gardenWorld!=='undefined')gardenWorld.visible=!isLobby&&currentMap==='garden';if(crowdWorld)crowdWorld.visible=!isLobby&&currentMap==='colosseum'&&!lowQuality;arenaSky.visible=!isLobby&&(currentMap==='colosseum'||currentMap==='garden');if(!isLobby&&(currentMap==='duct'||currentMap==='station'||currentMap==='neoball')){scene.fog.color.setHex(0x101622);scene.fog.near=25;scene.fog.far=85;hemi.intensity=1.6;sun.intensity=1.0}else if(!isLobby&&currentMap==='garden'){scene.fog.color.setHex(0x162634);scene.fog.near=32;scene.fog.far=92;hemi.intensity=1.45;sun.intensity=.95}}
function loadAsset(name){return loader.loadAsync('/assets/'+name+'.glb').then(g=>{g.scene.traverse(o=>{if(o.isMesh&&o.material){let m=o.material;let mn=m.name||o.name||'';if(m.emissive&&m.emissive.getHex()!==0)m.emissiveIntensity=(name==='colosseum_neon_arena'||name==='neon_crowd')?.85:1.5;if(m.isMeshStandardMaterial&&(/Armor|Metal|Bronze|Gold|Suit|Sand|Screen/i.test(mn))){ensureUV(o);m.roughnessMap=roughMap;m.envMap=reflectionEnv;m.envMapIntensity=.35;m.roughness=Math.max(.32,m.roughness);m.metalness=Math.max(.28,m.metalness);m.needsUpdate=true}if(name==='colosseum_neon_arena'){o.receiveShadow=true;o.castShadow=/Stone|Armor|Bronze/i.test(mn);if(/^(Sand|SandPatch|Bronze|ArmorIron)$/.test(mn))ssr.selects.push(o)}}});kitModels[name]=g.scene;return g.scene})}
const glassCoverMat=new THREE.MeshStandardMaterial({color:0x6caebc,transparent:true,opacity:.42,roughness:.35,metalness:.1,depthWrite:false,side:THREE.DoubleSide});
const verticalWorld=new THREE.Group();const concreteMat=new THREE.MeshStandardMaterial({color:0x35304e,roughness:.83,metalness:.12}),edgeMat=new THREE.MeshStandardMaterial({color:0x3fe2ee,emissive:0x126c83,emissiveIntensity:1.4});
for(let [i,b] of VERTICAL_BLOCKS.entries()){let body=new THREE.Mesh(new THREE.BoxGeometry(b.hx*2,b.h,b.hz*2),b.glass?glassCoverMat:concreteMat);body.position.set(b.x,b.h/2,b.z);body.castShadow=body.receiveShadow=true;verticalWorld.add(body);for(let side of [-1,1]){let stripe=new THREE.Mesh(new THREE.BoxGeometry(.05,b.h*.75,.05),edgeMat);stripe.position.set(b.x+side*(b.hx-.08),b.h*.5,b.z+b.hz+.012);verticalWorld.add(stripe)}let cap=new THREE.Mesh(new THREE.BoxGeometry(b.hx*2+.05,.06,b.hz*2+.05),edgeMat);cap.position.set(b.x,b.h+.03,b.z);verticalWorld.add(cap);if(b.glass)continue;let canv=document.createElement('canvas');canv.width=256;canv.height=128;let ctx=canv.getContext('2d');ctx.fillStyle='#242039';ctx.fillRect(0,0,256,128);ctx.strokeStyle=i%2?'#f458d9':'#38dcf3';ctx.lineWidth=6;ctx.strokeRect(5,5,246,118);ctx.font='bold 56px sans-serif';ctx.textAlign='center';ctx.fillStyle=i%2?'#ff72d9':'#56efff';ctx.fillText(i%2?'NEON':'BOUNCE',128,82);let tex=new THREE.CanvasTexture(canv);tex.colorSpace=THREE.SRGBColorSpace;let graf=new THREE.Mesh(new THREE.PlaneGeometry(b.hx*1.6,.7),new THREE.MeshBasicMaterial({map:tex}));graf.position.set(b.x,b.h*.6,b.z+b.hz+.015);verticalWorld.add(graf)}scene.add(verticalWorld);
const ductWorld=new THREE.Group();let gritCanvas=document.createElement('canvas');gritCanvas.width=gritCanvas.height=256;let grit=gritCanvas.getContext('2d'),image=grit.createImageData(256,256),gritSeed=1229;for(let y=0;y<256;y++)for(let x=0;x<256;x++){gritSeed=(gritSeed*16807)%2147483647;let n=gritSeed/2147483647,rust=(Math.sin(x*.04)+Math.sin(y*.018+x*.01)>1.1)?1:0,i=(y*256+x)*4,v=125+n*35;image.data[i]=v+rust*16;image.data[i+1]=v+rust*4;image.data[i+2]=v+5;image.data[i+3]=255}grit.putImageData(image,0,0);let gritTex=new THREE.CanvasTexture(gritCanvas);gritTex.wrapS=gritTex.wrapT=THREE.RepeatWrapping;gritTex.repeat.set(3,2);gritTex.colorSpace=THREE.SRGBColorSpace;
const ductConcrete=new THREE.MeshStandardMaterial({color:0xc1c9d0,map:gritTex,roughness:.88,metalness:.1}),ductMetal=new THREE.MeshStandardMaterial({color:0x242b37,roughness:.36,metalness:.7,envMap:reflectionEnv,envMapIntensity:.45}),ductFloorMat=new THREE.MeshStandardMaterial({color:0x45505d,metalness:.5,roughness:.28,envMap:reflectionEnv,envMapIntensity:.45}),ductPink=new THREE.MeshStandardMaterial({color:0xff3bba,emissive:0x9e0e60,emissiveIntensity:1.8}),ductTeal=new THREE.MeshStandardMaterial({color:0x37f1ed,emissive:0x0c8887,emissiveIntensity:1.7});
function ductBox(w,h,d,mat,x,y,z){let mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.receiveShadow=true;mesh.castShadow=h>.5;ductWorld.add(mesh);return mesh}
let ductFloor=ductBox(30,.3,36,ductFloorMat,0,-.15,0);ssr.selects.push(ductFloor);
for(let x=-14;x<=14;x+=2)ductBox(.018,.012,35,ductMetal,x,.012,0);for(let z=-17;z<=17;z+=2)ductBox(29,.012,.018,ductMetal,0,.013,z);
for(let side of [-1,1]){ductBox(.6,9.5,36,ductConcrete,side*15,4.75,0);for(let z of [-14,-7,0,7,14]){ductBox(.35,6.7,.12,side<0?ductPink:ductTeal,side*14.66,4,z);let point=new THREE.PointLight(side<0?0xff168c:0x13eeea,22,10,2);point.position.set(side*13.9,4,z);ductWorld.add(point)}for(let y of [2.0,6.2]){let pipe=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,35,10),ductMetal);pipe.rotation.x=Math.PI/2;pipe.position.set(side*14.4,y,0);ductWorld.add(pipe);let strip=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,35,8),side<0?ductPink:ductTeal);strip.rotation.x=Math.PI/2;strip.position.set(side*14.14,y,0);ductWorld.add(strip)}}
for(let side of [-1,1])ductBox(30,9.5,.6,ductConcrete,0,4.75,side*18);
for(let b of DUCT_BLOCKS){let bottom=b.bottom||0,mat=b.glass?glassCoverMat:b.bottom?ductMetal:ductConcrete;ductBox(b.hx*2,b.h-bottom,b.hz*2,mat,b.x,(b.h+bottom)/2,b.z);if(b.bottom){let line=ductBox(b.hx*2,.045,.05,ductTeal,b.x,b.h+.025,b.z-b.hz);let line2=ductBox(b.hx*2,.045,.05,ductPink,b.x,b.h+.025,b.z+b.hz);for(let x=-b.hx+.3;x<b.hx;x+=1)ductBox(.025,.025,b.hz*2,ductConcrete,b.x+x,b.h+.03,b.z)}}
for(let x of [-6,-3,0,3,6])for(let z of [-6,-3,0,3,6]){let puddle=ductBox(2.1,.015,1.0,ductFloorMat,x,.025,z);puddle.rotation.y=((x+z)%4)*.12;ssr.selects.push(puddle)}
for(let side of [-1,1]){ductBox(.06,.05,16,side<0?ductPink:ductTeal,side*7.2,.04,0);ductBox(14.4,.05,.06,side<0?ductPink:ductTeal,0,.04,side*8)}
let graffitiCanvas=document.createElement('canvas');graffitiCanvas.width=512;graffitiCanvas.height=256;let gctx=graffitiCanvas.getContext('2d');gctx.fillStyle='#222b35';gctx.fillRect(0,0,512,256);gctx.lineWidth=10;gctx.strokeStyle='#ff42bd';gctx.font='bold 90px sans-serif';gctx.strokeText('SECTOR 9',20,115);gctx.fillStyle='#60eff0';gctx.font='bold 46px sans-serif';gctx.fillText('CHRONO // DUCT',40,195);let graffTex=new THREE.CanvasTexture(graffitiCanvas);graffTex.colorSpace=THREE.SRGBColorSpace;for(let side of [-1,1]){let panel=new THREE.Mesh(new THREE.PlaneGeometry(6,3),new THREE.MeshBasicMaterial({map:graffTex,side:THREE.DoubleSide}));panel.position.set(0,4,side*17.67);if(side>0)panel.rotation.y=Math.PI;ductWorld.add(panel)}
for(let b of DUCT_BLOCKS.filter(b=>b.glass)){ductBox(b.hx*2,.07,.07,ductTeal,b.x,b.h+.04,b.z-b.hz);ductBox(b.hx*2,.07,.07,ductTeal,b.x,b.h+.04,b.z+b.hz)}
const ductFill=new THREE.PointLight(0x8399bd,65,32,2);ductFill.position.set(0,8,0);ductWorld.add(ductFill);scene.add(ductWorld);ductWorld.visible=false;
loadAsset('colosseum_neon_arena').then(o=>{o.scale.set(2,1,2);arenaWorld=o;scene.add(o);refreshWorld()}).catch(e=>console.error('Арена не загрузилась',e));
const stationWorld=new THREE.Group();
const stationMetal=new THREE.MeshStandardMaterial({color:0x3d4b5c,emissive:0x101b27,emissiveIntensity:.55,roughness:.43,metalness:.7,envMap:reflectionEnv}),stationWall=new THREE.MeshStandardMaterial({color:0x596a7b,emissive:0x172638,emissiveIntensity:.6,roughness:.7,metalness:.3}),stationGold=new THREE.MeshStandardMaterial({color:0xd8c076,emissive:0x765722,emissiveIntensity:.55}),stationBlue=new THREE.MeshStandardMaterial({color:0x75b8cc,emissive:0x236379,emissiveIntensity:.55});
function stationBox(w,h,d,material,x,y,z){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);o.position.set(x,y,z);o.castShadow=h>.5;o.receiveShadow=true;stationWorld.add(o);return o}
let stationFloor=stationBox(30,.3,36,stationMetal,0,-.15,0);ssr.selects.push(stationFloor);
for(let x=-14;x<=14;x+=2)stationBox(.025,.015,35,stationBlue,x,.01,0);for(let z=-16;z<=16;z+=4)stationBox(29,.018,.035,stationGold,0,.02,z);
for(let side of [-1,1]){stationBox(.8,9,36,stationWall,side*15,4.5,0);stationBox(30,9,.8,stationWall,0,4.5,side*18);for(let z of [-14,-7,0,7,14]){stationBox(.08,5,.35,stationGold,side*14.55,3.4,z);let light=new THREE.PointLight(0xffdb89,10,9,2);light.position.set(side*13.8,4,z);stationWorld.add(light)}stationBox(.15,.12,35,stationBlue,side*14.45,7.5,0)}
for(const b of STATION_BLOCKS){stationBox(b.hx*2,b.h,b.hz*2,b.glass?glassCoverMat:stationWall,b.x,b.h/2,b.z);stationBox(b.hx*2+.04,.06,b.hz*2+.04,stationGold,b.x,b.h+.03,b.z);for(let side of [-1,1])stationBox(.08,b.h*.8,.08,stationBlue,b.x+side*(b.hx-.08),b.h*.5,b.z+b.hz+.02)}
for(let side of [-1,1]){let c=document.createElement('canvas');c.width=512;c.height=256;let q=c.getContext('2d');q.fillStyle='#20293d';q.fillRect(0,0,512,256);q.strokeStyle='#ffdc42';q.lineWidth=8;q.strokeRect(7,7,498,242);q.fillStyle='#ffe65d';q.textAlign='center';q.font='bold 62px sans-serif';q.fillText('CYBER',256,104);q.font='bold 46px sans-serif';q.fillText('STATION // S4',256,180);let tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;let panel=new THREE.Mesh(new THREE.PlaneGeometry(6,3),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));panel.position.set(0,4,side*17.55);if(side>0)panel.rotation.y=Math.PI;stationWorld.add(panel)}
let stationFill=new THREE.PointLight(0xbacbff,70,35,2);stationFill.position.set(0,8,0);stationWorld.add(stationFill);scene.add(stationWorld);stationWorld.visible=false;

const neoWorld=new THREE.Group();
function embeddedNeoTexture(id,rx,ry){let img=document.getElementById(id),tex=new THREE.Texture(img);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(rx,ry);tex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());if(img.complete&&img.naturalWidth)tex.needsUpdate=true;else img.addEventListener('load',()=>{tex.needsUpdate=true},{once:true});return tex}
const neoCopperTex=embeddedNeoTexture('neo-metal-texture',5,6),neoDetailTex=embeddedNeoTexture('neo-metal-texture',1,1),neoGlassTex=embeddedNeoTexture('neo-teal-texture',2,2);
const neoFloor=new THREE.MeshStandardMaterial({color:0xb49678,map:neoCopperTex,roughness:.72,metalness:.55,emissive:0x261408,emissiveIntensity:.18}),neoWall=new THREE.MeshStandardMaterial({color:0x8d8272,map:neoDetailTex,roughness:.74,metalness:.46,emissive:0x49372b,emissiveIntensity:.65}),neoSteel=new THREE.MeshStandardMaterial({color:0x6c5b4a,map:neoDetailTex,roughness:.58,metalness:.7,emissive:0x38291c,emissiveIntensity:.55}),neoPipe=new THREE.MeshStandardMaterial({color:0x8b8172,roughness:.43,metalness:.72,envMap:reflectionEnv,envMapIntensity:.25}),neoReactor=new THREE.MeshStandardMaterial({color:0x84c6ad,map:neoGlassTex,roughness:.28,metalness:.4,emissive:0x246f58,emissiveIntensity:.48}),neoA=new THREE.MeshStandardMaterial({color:0x78d4d2,emissive:0x1a827b,emissiveIntensity:.65}),neoB=new THREE.MeshStandardMaterial({color:0xdba87a,emissive:0x7c461f,emissiveIntensity:.5});
function neoBox(w,h,d,mat,x,y,z){let mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.receiveShadow=true;mesh.castShadow=h>.7;neoWorld.add(mesh);return mesh}
neoBox(30,.3,140,neoFloor,0,-.15,0);
for(let side of [-1,1]){
 neoBox(.7,12,140,neoWall,side*15,6,0); neoBox(30,12,.7,neoWall,0,6,side*70);
 for(let z=-64;z<=64;z+=16){neoBox(.1,7,.3,neoA,side*14.6,5,z);let light=new THREE.PointLight(0x83cfb4,13,15,2);light.position.set(side*13.5,5,z);neoWorld.add(light)}
 for(let y of [8,10]){let tube=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,139,12),neoPipe);tube.rotation.x=Math.PI/2;tube.position.set(side*14.7,y,0);neoWorld.add(tube)}
}
for(let z=-64;z<=64;z+=8){neoBox(29,.025,.09,neoSteel,0,.02,z);for(let x of [-7,7])neoBox(5,.03,3.5,neoReactor,x,.03,z+3)}
for(const b of NEO_BLOCKS){let bottom=b.bottom||0, material=b.kind==='goalpost'?(b.z<0?neoA:neoB):b.kind==='trailer'?neoFloor:neoWall;
 neoBox(b.hx*2,b.h-bottom,b.hz*2,material,b.x,(b.h+bottom)/2,b.z);
 if(b.kind==='turn') {for(let x=b.x-b.hx+1;x<b.x+b.hx;x+=4)neoBox(.12,8,.08,neoSteel,x,6,b.z+b.hz+.05);for(let face of [-1,1]){neoBox(b.hx*2,.15,.08,neoA,b.x,8,b.z+face*(b.hz+.05));let edge=b.x<0?7.25:-7.25;neoBox(.3,9,.12,neoA,edge,5,b.z+face*(b.hz+.08));}}
 else neoBox(b.hx*2+.025,.055,.08,neoA,b.x,b.h+.03,b.z+b.hz);
}
for(let side of [-1,1]){let gate=new THREE.Mesh(new THREE.RingGeometry(2.25,2.5,48),new THREE.MeshBasicMaterial({color:side<0?0x6bd2ce:0xe6a672,side:THREE.DoubleSide}));gate.rotation.x=-Math.PI/2;gate.position.set(0,.075,side*56);neoWorld.add(gate)}
neoWorld.add(new THREE.AmbientLight(0xc9d9d3,.65));
let neoLight=new THREE.PointLight(0xb7ddca,110,36,2);neoLight.position.set(0,8,0);neoWorld.add(neoLight);scene.add(neoWorld);neoWorld.visible=false;
let fumbi=new THREE.Group(),fumbiBall=new THREE.Mesh(new THREE.SphereGeometry(.5,16,12),new THREE.MeshStandardMaterial({color:0xe5efad,emissive:0x6d9832,emissiveIntensity:1.1,roughness:.42}));fumbi.add(fumbiBall);for(let x of [-.19,.19]){let eye=new THREE.Mesh(new THREE.SphereGeometry(.065,8,6),new THREE.MeshBasicMaterial({color:0x253a39}));eye.position.set(x,.12,-.45);fumbi.add(eye)}let fumbiRing=new THREE.Mesh(new THREE.TorusGeometry(.56,.055,8,32),new THREE.MeshBasicMaterial({color:0x9ff7d5}));fumbiRing.rotation.x=Math.PI/2;fumbi.add(fumbiRing);neoWorld.add(fumbi);
// Sparkling energy ball marker above carrier
let markerCanvas=document.createElement('canvas');markerCanvas.width=128;markerCanvas.height=128;let mc=markerCanvas.getContext('2d');
let mg=mc.createRadialGradient(64,64,6,64,64,60);mg.addColorStop(0,'rgba(255,250,150,1)');mg.addColorStop(.45,'rgba(190,255,110,.75)');mg.addColorStop(1,'rgba(90,255,210,0)');mc.fillStyle=mg;mc.fillRect(0,0,128,128);
mc.fillStyle='#fff69c';mc.beginPath();mc.arc(64,64,26,0,Math.PI*2);mc.fill();mc.strokeStyle='#ffffff';mc.lineWidth=4;mc.stroke();
for(let [sx,sy,sr] of [[28,30,10],[98,34,8],[96,96,10],[32,94,7]]){mc.fillStyle='#ffffff';mc.beginPath();mc.moveTo(sx,sy-sr);mc.lineTo(sx+sr*.32,sy-sr*.32);mc.lineTo(sx+sr,sy);mc.lineTo(sx+sr*.32,sy+sr*.32);mc.lineTo(sx,sy+sr);mc.lineTo(sx-sr*.32,sy+sr*.32);mc.lineTo(sx-sr,sy);mc.lineTo(sx-sr*.32,sy-sr*.32);mc.closePath();mc.fill()}
let markerTex=new THREE.CanvasTexture(markerCanvas);markerTex.colorSpace=THREE.SRGBColorSpace;
let carrierMark=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTex,transparent:true,depthTest:false,depthWrite:false}));carrierMark.renderOrder=999;carrierMark.scale.set(1.15,1.15,1);neoWorld.add(carrierMark);carrierMark.visible=false;let neoSnapshot=null,lastNeoBounce=0;

// === GARDEN & TWO HOUSES ("Сад и два домика") ===
const gardenWorld=new THREE.Group();
const lawnCanvas=document.createElement('canvas');lawnCanvas.width=lawnCanvas.height=256;const lctx=lawnCanvas.getContext('2d');
lctx.fillStyle='#1d5a3e';lctx.fillRect(0,0,256,256);
for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16){
 lctx.fillStyle=((x/16+y/16)%2===0)?'#226847':'#1a5238';lctx.fillRect(x,y,16,16);
}
for(let i=0;i<360;i++){
 let gx=(i*73)%256,gy=(i*137)%256;
 lctx.fillStyle=i%5===0?'rgba(140,255,190,.24)':'rgba(42,140,92,.35)';
 lctx.fillRect(gx,gy,3,3);
}
const lawnTex=new THREE.CanvasTexture(lawnCanvas);lawnTex.colorSpace=THREE.SRGBColorSpace;lawnTex.wrapS=lawnTex.wrapT=THREE.RepeatWrapping;lawnTex.repeat.set(9,9);
const gardenGrassMat=new THREE.MeshStandardMaterial({color:0x6fe3a3,map:lawnTex,roughness:.88,metalness:.05});
const gardenPathMat=new THREE.MeshStandardMaterial({color:0x8a97ab,roughness:.82,metalness:.1});
const houseWallMat=new THREE.MeshStandardMaterial({color:0xede1ce,roughness:.76,metalness:.06});
const houseTimberMat=new THREE.MeshStandardMaterial({color:0x573b2c,roughness:.72,metalness:.08});
const houseRoofMat=new THREE.MeshStandardMaterial({color:0x3f2d5e,roughness:.62,metalness:.18});
const houseGlowMat=new THREE.MeshStandardMaterial({color:0xffe49c,emissive:0xffa947,emissiveIntensity:1.15,roughness:.3});
const barkMat=new THREE.MeshStandardMaterial({color:0x5c3c28,roughness:.88});
const leafLowMat=new THREE.MeshStandardMaterial({color:0x2fc77b,emissive:0x0c422a,emissiveIntensity:.35,roughness:.68});
const leafTopMat=new THREE.MeshStandardMaterial({color:0x4ff09d,emissive:0x13603a,emissiveIntensity:.42,roughness:.62});
const flowerBedMat=new THREE.MeshStandardMaterial({color:0x5d687d,roughness:.82});
const flowerColors=[0xff66b8,0x5ef7ff,0xffe85c,0xc97eff,0xff8e63];
function gardenBox(w,h,d,mat,x,y,z){let m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=h>.4;gardenWorld.add(m);return m}
// Main courtyard lawn + cross stone footpaths
gardenBox(39,.3,39,gardenGrassMat,0,-.15,0);
gardenBox(2.8,.04,37,gardenPathMat,0,.02,0);
gardenBox(37,.04,2.8,gardenPathMat,0,.02,0);
// Perimeter garden hedge & glowing border lanterns
for(let s of [-1,1]){
 gardenBox(38.4,2.6,.9,leafLowMat,0,1.3,s*19.1);
 gardenBox(.9,2.6,38.4,leafLowMat,s*19.1,1.3,0);
 for(let d=-15;d<=15;d+=7.5){
  gardenBox(.35,2.9,.35,houseTimberMat,d,1.45,s*18.6);
  gardenBox(.44,.44,.44,houseGlowMat,d,3.05,s*18.6);
  gardenBox(.35,2.9,.35,houseTimberMat,s*18.6,1.45,d);
  gardenBox(.44,.44,.44,houseGlowMat,s*18.6,3.05,d);
 }
}
// Build blocks from GARDEN_BLOCKS
for(const b of GARDEN_BLOCKS){
 let bottom=b.bottom||0;
 if(b.kind==='house_wall'){
  gardenBox(b.hx*2,b.h,b.hz*2,houseWallMat,b.x,b.h/2,b.z);
  gardenBox(b.hx*2+.06,.18,b.hz*2+.06,houseTimberMat,b.x,.1,b.z);
  gardenBox(b.hx*2+.06,.22,b.hz*2+.06,houseTimberMat,b.x,b.h-.11,b.z);
 }else if(b.kind==='house_roof'){
  gardenBox(b.hx*2,b.h-bottom,b.hz*2,houseRoofMat,b.x,(b.h+bottom)/2,b.z);
  gardenBox(b.hx*2+.2,.12,b.hz*2+.2,houseGlowMat,b.x,b.h+.05,b.z);
 }else if(b.kind==='trunk'){
  let tr=new THREE.Mesh(new THREE.CylinderGeometry(.38,.52,b.h,8),barkMat);tr.position.set(b.x,b.h/2,b.z);tr.castShadow=tr.receiveShadow=true;gardenWorld.add(tr);
 }else if(b.kind==='canopy_low'||b.kind==='canopy_top'){
  let matLeaf=b.kind==='canopy_low'?leafLowMat:leafTopMat;
  gardenBox(b.hx*2,b.h-bottom,b.hz*2,matLeaf,b.x,(b.h+bottom)/2,b.z);
  gardenBox(b.hx*2+.08,.07,b.hz*2+.08,new THREE.MeshStandardMaterial({color:0x7effcc,emissive:0x23a86b,emissiveIntensity:.7}),b.x,b.h+.035,b.z);
 }else if(b.kind==='flowerbed'){
  gardenBox(b.hx*2,b.h-.12,b.hz*2,flowerBedMat,b.x,(b.h-.12)/2,b.z);
  gardenBox(b.hx*2-.15,.14,b.hz*2-.15,gardenGrassMat,b.x,b.h-.06,b.z);
  let count=Math.max(4,Math.floor(b.hx*b.hz*2.5));
  for(let fi=0;fi<count;fi++){
   let fx=b.x+((fi*1.37)%(b.hx*1.5))-b.hx*.75,fz=b.z+((fi*1.91)%(b.hz*1.5))-b.hz*.75;
   gardenBox(.07,.24,.07,leafTopMat,fx,b.h+.12,fz);
   gardenBox(.22,.16,.22,new THREE.MeshStandardMaterial({color:flowerColors[fi%flowerColors.length],emissive:flowerColors[fi%flowerColors.length],emissiveIntensity:.55}),fx,b.h+.27,fz);
  }
 }
}
// Cottage decorative doorway frames, warm interior rugs & lanterns
for(const [hx,hz,doorS,doorE] of [[-10,-4,[0,3.35],[3.35,0]],[10,4,[0,-3.35],[-3.35,0]]]){
 gardenBox(4.2,.04,4.2,new THREE.MeshStandardMaterial({color:0xb54b62,roughness:.9}),hx,.025,hz);
 let hLight=new THREE.PointLight(0xffcf88,18,12,2);hLight.position.set(hx,2.6,hz);gardenWorld.add(hLight);
 gardenBox(.4,.32,.4,houseGlowMat,hx,3.2,hz);
 // Glowing doorway arches
 gardenBox(2.9,.18,.38,houseGlowMat,hx+doorS[0],2.75,hz+doorS[1]);
 gardenBox(.38,.18,2.9,houseGlowMat,hx+doorE[0],2.75,hz+doorE[1]);
}
// Scattered lawn flowers & clover clusters
for(let i=0;i<52;i++){
 let fx=((i*7.13)%32)-16,fz=((i*11.47)%32)-16;
 if(Math.abs(fx)<1.8||Math.abs(fz)<1.8)continue;
 if((Math.abs(fx+10)<4.2&&Math.abs(fz+4)<4.2)||(Math.abs(fx-10)<4.2&&Math.abs(fz-4)<4.2))continue;
 gardenBox(.06,.20,.06,leafTopMat,fx,.10,fz);
 gardenBox(.20,.14,.20,new THREE.MeshStandardMaterial({color:flowerColors[i%flowerColors.length],emissive:flowerColors[i%flowerColors.length],emissiveIntensity:.5}),fx,.22,fz);
}
// Floating twilight fireflies & petals in garden
const fireflyCount=90,fireflyPos=new Float32Array(fireflyCount*3),fireflyData=[];
for(let i=0;i<fireflyCount;i++){
 let bx=((i*9.7)%34)-17,by=.6+(i*1.3)%4.2,bz=((i*13.1)%34)-17;
 fireflyPos[i*3]=bx;fireflyPos[i*3+1]=by;fireflyPos[i*3+2]=bz;
 fireflyData.push({bx,by,bz,sp:.6+(i%5)*.22,ph:i*.7});
}
const fireflyGeo=new THREE.BufferGeometry();fireflyGeo.setAttribute('position',new THREE.BufferAttribute(fireflyPos,3));
const gardenFireflies=new THREE.Points(fireflyGeo,new THREE.PointsMaterial({color:0xb8ff9e,size:.19,transparent:true,opacity:.85,depthWrite:false,blending:THREE.AdditiveBlending}));
gardenWorld.add(gardenFireflies);
gardenWorld.add(new THREE.AmbientLight(0xaad9c6,.65));
scene.add(gardenWorld);gardenWorld.visible=false;

function drawSelfArrow(g,x,z,ang,pulse,color='#ffffff',glow='#74f7ff'){
 g.save();g.translate(x,z);g.rotate(ang);
 g.strokeStyle=glow;g.lineWidth=2;g.beginPath();g.arc(0,0,6.5+pulse*2.2,0,Math.PI*2);g.stroke();
 g.fillStyle=color;g.strokeStyle='#091324';g.lineWidth=1.5;
 g.beginPath();g.moveTo(0,-7);g.lineTo(5,5);g.lineTo(0,2.5);g.lineTo(-5,5);g.closePath();g.fill();g.stroke();
 g.restore();
}
function drawNeoMapLive(t){
 let can=$('#neo-minimap');if(!can)return;
 let g=can.getContext('2d');g.clearRect(0,0,150,150);g.fillStyle='#0c172b';g.fillRect(0,0,150,150);
 g.strokeStyle='#52677d';g.lineWidth=1.5;g.strokeRect(53,5,44,140);
 let pt=(x,z)=>[75+x/15*21,75+z/70*69];
 for(let b of NEO_BLOCKS.filter(b=>b.kind==='turn')){let [x,z]=pt(b.x,b.z);g.fillStyle='#9c856d';g.fillRect(x-b.hx/15*21,z-1.5,b.hx/15*42,3)}
 for(let side of [-1,1]){let [x,z]=pt(0,side*56);g.fillStyle=side<0?'#75dbf1':'#ff8ba8';g.fillRect(x-7,z-2.5,14,5)}
 let self=players.get(me),myTeam=self?.data?.team;
 for(let [id,o] of players){
  if(id===me||o.data?.respawnAt)continue;
  let px=o.mesh?.position?.x??o.x,pz=o.mesh?.position?.z??o.z,[x,z]=pt(px,pz);
  let ally=myTeam&&o.data?.team===myTeam;
  g.fillStyle=ally?'#46ff9f':'#ff4268';g.strokeStyle='#081224';g.lineWidth=1.5;
  g.beginPath();g.arc(x,z,4,0,Math.PI*2);g.fill();g.stroke();
 }
 let ball=neoSnapshot?.ball;
 if(ball&&ball.status!=='reset'){
  let holder=players.get(ball.holder);
  let bx=holder?(ball.holder===me?holder.x:(holder.mesh?.position?.x??holder.x)):ball.x;
  let bz=holder?(ball.holder===me?holder.z:(holder.mesh?.position?.z??holder.z)):ball.z;
  let [x,z]=pt(bx,bz);
  g.fillStyle='#fff48a';g.strokeStyle='#ffaa00';g.lineWidth=1.5;
  g.beginPath();g.arc(x,z,3.8,0,Math.PI*2);g.fill();g.stroke();
 }
 if(self&&!self.data?.respawnAt){
  let [sx,sz]=pt(self.x,self.z),pulse=.5+.5*Math.sin(t*.008);
  drawSelfArrow(g,sx,sz,angle,pulse,'#ffffff','#ffe96b');
 }
}
function drawClassicMapLive(t){
 let can=$('#classic-minimap');if(!can)return;
 let show=!!room&&phase==='match'&&roomMode!=='neoball';
 can.style.display=show?'block':'none';
 if(!show)return;
 let g=can.getContext('2d');g.clearRect(0,0,150,150);g.fillStyle=currentMap==='garden'?'#0b1e1b':'#0c172b';g.fillRect(0,0,150,150);
 let rangeX=currentMap==='colosseum'?26.5:currentMap==='garden'?19.5:15.5,rangeZ=currentMap==='colosseum'?21.5:currentMap==='garden'?19.5:18.5;
 let scale=Math.min(66/rangeX,66/rangeZ);
 let pt=(x,z)=>[75+x*scale,75+z*scale];
 g.strokeStyle=currentMap==='garden'?'#4eb888':'#5a789c';g.lineWidth=1.6;
 if(currentMap==='colosseum'){g.beginPath();g.ellipse(75,75,ARENA_RX*scale,ARENA_RZ*scale,0,0,Math.PI*2);g.stroke()}
 else if(currentMap==='garden'){g.strokeRect(75-18.5*scale,75-18.5*scale,37*scale,37*scale)}
 else{g.strokeRect(75-14.5*scale,75-17.5*scale,29*scale,35*scale)}
 let blocks=currentMap==='duct'?DUCT_BLOCKS:currentMap==='station'?STATION_BLOCKS:currentMap==='garden'?GARDEN_BLOCKS:VERTICAL_BLOCKS;
 for(let b of blocks){
  if(b.kind==='house_roof'||b.kind==='canopy_low'||b.kind==='canopy_top')continue;
  let [x,z]=pt(b.x,b.z);
  g.fillStyle=b.glass?'#4aa6bd88':b.kind==='house_wall'?'#d8c29d':b.kind==='trunk'?'#39c97d':b.kind==='flowerbed'?'#e473b8':'#7e8aa6';
  g.fillRect(x-b.hx*scale,z-b.hz*scale,b.hx*2*scale,b.hz*2*scale);
 }
 let pulse=.5+.5*Math.sin(t*.009);
 for(let [id,o] of players){
  if(id===me||o.data?.respawnAt||o.data?.eliminated)continue;
  let px=o.mesh?.position?.x??o.x,pz=o.mesh?.position?.z??o.z,[x,z]=pt(px,pz);
  if(roomMode==='chaser'&&o.data?.team==='chaser'){
   g.strokeStyle='rgba(216,74,255,.9)';g.lineWidth=2;
   g.beginPath();g.arc(x,z,6.8+pulse*2.6,0,Math.PI*2);g.stroke();
   g.fillStyle='#ff3eb8';g.strokeStyle='#ffffff';g.lineWidth=1.5;
   g.beginPath();g.arc(x,z,5.2,0,Math.PI*2);g.fill();g.stroke();
  }else{
   g.fillStyle=(roomMode==='chaser'&&o.data?.team==='survivor')?'#4dff9e':'#ff476c';
   g.strokeStyle='#081224';g.lineWidth=1.4;
   g.beginPath();g.arc(x,z,3.8,0,Math.PI*2);g.fill();g.stroke();
  }
 }
 let self=players.get(me);
 if(self&&!self.data?.respawnAt&&!self.data?.eliminated){
  let [sx,sz]=pt(self.x,self.z);
  drawSelfArrow(g,sx,sz,angle,pulse,'#ffffff',self.data?.team==='chaser'?'#ff52d9':'#5df2ff');
 }
}

const COSMIC_SECTORS=[
 {name:'СОЗВЕЗДИЕ АНДРОМЕДЫ',skyTop:'#040718',skyMid:'#132d63',skyBot:'#2d144d',nebA:'rgba(62,212,255,.36)',nebB:'rgba(148,74,255,.28)',planetA:'#d4c6ff',planetB:'#4467c4',planetC:'#13184a',ring:'rgba(148,224,255,.52)',moon:'#9eb6d9'},
 {name:'ТУМАННОСТЬ ОРИОНА',skyTop:'#120416',skyMid:'#4b143b',skyBot:'#1f0b2c',nebA:'rgba(255,94,172,.38)',nebB:'rgba(255,188,78,.24)',planetA:'#ffd8a8',planetB:'#c2437d',planetC:'#330d2b',ring:'rgba(255,194,142,.52)',moon:'#e4b8c8'},
 {name:'ПУЛЬСАР ВЕГА',skyTop:'#03121a',skyMid:'#0d4554',skyBot:'#081f38',nebA:'rgba(72,255,196,.34)',nebB:'rgba(58,158,255,.28)',planetA:'#b6ffea',planetB:'#1e8f8c',planetC:'#082738',ring:'rgba(130,255,222,.52)',moon:'#9ed6d4'},
 {name:'СИНГУЛЯРНОСТЬ IX',skyTop:'#080316',skyMid:'#2e145c',skyBot:'#140826',nebA:'rgba(208,92,255,.38)',nebB:'rgba(78,242,255,.26)',planetA:'#f4d2ff',planetB:'#6f38b8',planetC:'#1c0b3a',ring:'rgba(218,162,255,.54)',moon:'#c7b2ea'}
];
const spaceExterior=new THREE.Group();scene.add(spaceExterior);
let rs=933;function randSpace(){rs=(rs*16807)%2147483647;return rs/2147483647}
const skyDomeCanvas=document.createElement('canvas');skyDomeCanvas.width=1024;skyDomeCanvas.height=512;const sdc=skyDomeCanvas.getContext('2d');
const skyDomeTex=new THREE.CanvasTexture(skyDomeCanvas);skyDomeTex.colorSpace=THREE.SRGBColorSpace;
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(108,36,24),new THREE.MeshBasicMaterial({map:skyDomeTex,side:THREE.BackSide,depthWrite:false,fog:false}));
skyDome.renderOrder=-100;spaceExterior.add(skyDome);

const planetCanvas=document.createElement('canvas');planetCanvas.width=512;planetCanvas.height=256;const plc=planetCanvas.getContext('2d');
const planetTex=new THREE.CanvasTexture(planetCanvas);planetTex.colorSpace=THREE.SRGBColorSpace;
const spacePlanetGroup=new THREE.Group();spacePlanetGroup.position.set(26,12,64);spaceExterior.add(spacePlanetGroup);
const spacePlanet=new THREE.Mesh(new THREE.SphereGeometry(13.5,40,28),new THREE.MeshBasicMaterial({map:planetTex,fog:false}));
spacePlanetGroup.add(spacePlanet);
const planetGlowMat=new THREE.MeshBasicMaterial({color:0x7ed8ff,transparent:true,opacity:.14,side:THREE.BackSide,depthWrite:false,fog:false,blending:THREE.AdditiveBlending});
spacePlanetGroup.add(new THREE.Mesh(new THREE.SphereGeometry(15.2,32,20),planetGlowMat));
const planetRingMat=new THREE.MeshBasicMaterial({color:0x9ce2ff,transparent:true,opacity:.48,side:THREE.DoubleSide,depthWrite:false,fog:false});
const planetRing=new THREE.Mesh(new THREE.RingGeometry(17.5,28.5,64),planetRingMat);
planetRing.rotation.x=Math.PI/2.35;planetRing.rotation.y=-.24;spacePlanetGroup.add(planetRing);
const planetInnerRing=new THREE.Mesh(new THREE.RingGeometry(15.6,17.0,64),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false,fog:false}));
planetInnerRing.rotation.copy(planetRing.rotation);spacePlanetGroup.add(planetInnerRing);

const spaceMoonMat=new THREE.MeshStandardMaterial({color:0x9eb6d9,roughness:.85,metalness:.05,emissive:0x1b2844,emissiveIntensity:.45,fog:false});
const spaceMoon=new THREE.Mesh(new THREE.SphereGeometry(3.8,24,18),spaceMoonMat);spaceMoon.position.set(-25,18,52);spaceExterior.add(spaceMoon);
const sunFlare=new THREE.Mesh(new THREE.SphereGeometry(3.4,16,12),new THREE.MeshBasicMaterial({color:0xe8fbff,fog:false}));sunFlare.position.set(-40,24,-58);spaceExterior.add(sunFlare);
const sunHalo=new THREE.Mesh(new THREE.SphereGeometry(8.5,16,12),new THREE.MeshBasicMaterial({color:0x5ce8ff,transparent:true,opacity:.18,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));sunHalo.position.copy(sunFlare.position);spaceExterior.add(sunHalo);

// 3D volumetric starfield outside the ship
const STAR_COUNT=1600,starPos=new Float32Array(STAR_COUNT*3),starCol=new Float32Array(STAR_COUNT*3);
for(let i=0;i<STAR_COUNT;i++){
 let u=randSpace()*2-1,theta=randSpace()*Math.PI*2,rad=30+randSpace()*62,s=Math.sqrt(1-u*u);
 starPos[i*3]=Math.cos(theta)*s*rad;starPos[i*3+1]=u*rad;starPos[i*3+2]=Math.sin(theta)*s*rad;
 let tint=randSpace();
 starCol[i*3]=tint<.2?.68:tint>.85?1:.92;
 starCol[i*3+1]=tint<.2?.92:tint>.85?.84:.96;
 starCol[i*3+2]=1;
}
const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));starGeo.setAttribute('color',new THREE.BufferAttribute(starCol,3));
const starPoints=new THREE.Points(starGeo,new THREE.PointsMaterial({size:.48,vertexColors:true,transparent:true,opacity:.92,depthWrite:false,fog:false}));
spaceExterior.add(starPoints);

// Drifting 3D asteroids & patrolling escort ships
const asteroids=[],cruisers=[];
const astMat=new THREE.MeshStandardMaterial({color:0x4b556e,roughness:.9,metalness:.18,emissive:0x10182b,emissiveIntensity:.35,fog:false});
for(let i=0;i<18;i++){
 let a=(i/18)*Math.PI*2+randSpace()*.3,r=28+randSpace()*18,y=(randSpace()-.5)*22;
 let rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.45+randSpace()*1.1,0),astMat);
 rock.position.set(Math.sin(a)*r,y,Math.cos(a)*r);
 rock.rotation.set(randSpace()*3,randSpace()*3,randSpace()*3);
 rock.userData={baseA:a,r,y,speed:.018+randSpace()*.022,rx:(randSpace()-.5)*.6,ry:(randSpace()-.5)*.6};
 spaceExterior.add(rock);asteroids.push(rock);
}
for(const side of [-1,1]){
 let ship=new THREE.Group();
 let hullMat=new THREE.MeshStandardMaterial({color:0x8fa6c4,roughness:.35,metalness:.65,fog:false});
 let engineMat=new THREE.MeshBasicMaterial({color:0x4ef2ff,fog:false});
 let beaconMat=new THREE.MeshBasicMaterial({color:side>0?0x4ef2ff:0xff58c8,fog:false});
 let body=new THREE.Mesh(new THREE.BoxGeometry(1.1,.55,4.2),hullMat);ship.add(body);
 let wing=new THREE.Mesh(new THREE.BoxGeometry(3.4,.14,1.5),hullMat);wing.position.set(0,-.05,-.4);ship.add(wing);
 let bridge=new THREE.Mesh(new THREE.BoxGeometry(.6,.45,1.2),hullMat);bridge.position.set(0,.42,.2);ship.add(bridge);
 for(const ex of [-.32,.32]){let thr=new THREE.Mesh(new THREE.CylinderGeometry(.16,.22,.4,8),engineMat);thr.rotation.x=Math.PI/2;thr.position.set(ex,0,-2.2);ship.add(thr)}
 let beacon=new THREE.Mesh(new THREE.SphereGeometry(.14,8,8),beaconMat);beacon.position.set(0,.72,.2);ship.add(beacon);
 ship.position.set(side*36,6+side*3,-10);ship.userData={side,beacon};
 spaceExterior.add(ship);cruisers.push(ship);
}

// Hyperdrive warp tunnel (streaking stars + glowing warp rings)
const hyperGroup=new THREE.Group();hyperGroup.visible=false;spaceExterior.add(hyperGroup);
const STREAK_COUNT=320,streakPos=new Float32Array(STREAK_COUNT*6),streakCol=new Float32Array(STREAK_COUNT*6),streakData=[];
for(let i=0;i<STREAK_COUNT;i++){
 let a=randSpace()*Math.PI*2,r=17+randSpace()*28,z=(randSpace()-.5)*140;
 let x=Math.cos(a)*r,y=Math.sin(a)*r*.75+2;
 streakData.push({x,y,z,sp:65+randSpace()*65,len:4+randSpace()*12});
 let cyan=i%3!==0;
 for(let v=0;v<2;v++){streakCol[i*6+v*3]=cyan?.38:1;streakCol[i*6+v*3+1]=cyan?.95:.52;streakCol[i*6+v*3+2]=1}
}
const streakGeo=new THREE.BufferGeometry();streakGeo.setAttribute('position',new THREE.BufferAttribute(streakPos,3));streakGeo.setAttribute('color',new THREE.BufferAttribute(streakCol,3));
const streakLines=new THREE.LineSegments(streakGeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
hyperGroup.add(streakLines);
const warpRings=[];
for(let i=0;i<14;i++){
 let ringMat=new THREE.MeshBasicMaterial({color:i%2?0x4ef2ff:0xd46aff,transparent:true,opacity:.38,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
 let rMesh=new THREE.Mesh(new THREE.TorusGeometry(22,.22,8,48),ringMat);
 rMesh.position.set(0,3,(i/14)*130-45);
 hyperGroup.add(rMesh);warpRings.push(rMesh);
}

function paintCosmicSector(idx){
 const sec=COSMIC_SECTORS[idx%COSMIC_SECTORS.length];hyperSector=idx%COSMIC_SECTORS.length;
 let g=sdc.createLinearGradient(0,0,0,512);g.addColorStop(0,sec.skyTop);g.addColorStop(.5,sec.skyMid);g.addColorStop(1,sec.skyBot);
 sdc.fillStyle=g;sdc.fillRect(0,0,1024,512);
 for(let [cx,cy,r,col] of [[240,220,260,sec.nebA],[740,260,300,sec.nebB],[520,140,220,sec.nebA]]){
  let ng=sdc.createRadialGradient(cx,cy,10,cx,cy,r);ng.addColorStop(0,col);ng.addColorStop(1,'rgba(0,0,0,0)');
  sdc.fillStyle=ng;sdc.fillRect(cx-r,cy-r,r*2,r*2);
 }
 let p=91;function pr(){p=(p*16807)%2147483647;return p/2147483647}
 for(let i=0;i<900;i++){sdc.fillStyle=`rgba(235,248,255,${.25+pr()*.75})`;sdc.beginPath();sdc.arc(pr()*1024,pr()*512,pr()<.06?1.8:.7+pr()*.6,0,Math.PI*2);sdc.fill()}
 skyDomeTex.needsUpdate=true;
 let pg=plc.createLinearGradient(0,0,0,256);pg.addColorStop(0,sec.planetA);pg.addColorStop(.32,sec.planetB);pg.addColorStop(.62,sec.planetC);pg.addColorStop(.85,sec.planetB);pg.addColorStop(1,sec.planetA);
 plc.fillStyle=pg;plc.fillRect(0,0,512,256);
 for(let y=24;y<235;y+=18){plc.fillStyle=y%36===0?'rgba(255,255,255,.14)':'rgba(10,16,44,.18)';plc.fillRect(0,y,512,6)}
 planetTex.needsUpdate=true;
 planetRingMat.color.set(sec.ring);planetGlowMat.color.set(sec.planetA);spaceMoonMat.color.set(sec.moon);
}
paintCosmicSector(0);

function playHyperdriveSound(){
 if(!audio||muted)return;
 try{
  let t=audio.currentTime;
  tone(t,95,420,1.2,.14,'sawtooth');
  tone(t+.1,140,680,1.1,.08,'sine');
  soundNoise(t+1.0,4.2,900,.06,'bandpass');
  tone(t+1.15,240,62,.85,.22,'triangle');
  tone(t+5.6,520,880,.28,.07,'sine');
  tone(t+5.75,780,1180,.35,.06,'sine');
 }catch{}
}
function triggerHyperdrive(sector,duration=7200,by=''){
 hyperActive=true;hyperStart=performance.now();hyperDuration=duration;hyperTargetSector=sector||0;hyperSwitched=false;
 playHyperdriveSound();haptic('heavy');
 showNotice(by?`⚡ ${by}: ГИПЕРПРЫЖОК!`:'⚡ ЗАПУСК ГИПЕРДВИГАТЕЛЯ!');
}

lobbyWorld=new THREE.Group();
function lobbyBox(w,h,d,color,x,y,z,emissive=0){let m=emissive?mat(color,emissive):new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.25});let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);lobbyWorld.add(o);return o}
// High-detail starship bridge floor & perimeter bulkheads
let lobbyFloor=lobbyBox(18,.3,18,0xe3eef8,0,-.15,0);let floorMat=new THREE.MeshPhysicalMaterial({color:0xdce7f3,roughness:.28,metalness:.14,clearcoat:.55,clearcoatRoughness:.24});floorMat.envMap=reflectionEnv;floorMat.envMapIntensity=.28;lobbyFloor.material=floorMat;
for(let side of [-1,1]){lobbyBox(2.3,.03,17.4,0x1d2842,side*7.7,.01,0);lobbyBox(17.4,.03,1.8,0x1d2842,0,.01,side*7.9)}
lobbyBox(18,.3,18,0x162038,0,5.15,0);
for(let i=-6;i<=6;i+=3){lobbyBox(.04,.02,17,0x8ea7bf,i,.015,0);lobbyBox(17,.02,.04,0x8ea7bf,0,.016,i)}
// Luminous cyber bridge walkway to Captain's Helm
for(let side of [-1,1])lobbyBox(.09,.025,13.8,0x4ef2ff,side*1.1,.02,1.2,0x148aa6);
// Aft bulkhead wall (z = -8.9) with airlock blast doors
lobbyBox(18,5,.32,0x1f2b44,0,2.5,-8.9);
lobbyBox(4.2,3.6,.22,0x141c30,0,1.8,-8.72);
for(let side of [-1,1]){lobbyBox(1.85,3.3,.18,0x2b3b5a,side*.98,1.7,-8.65);lobbyBox(.08,3.2,.1,0x4ef2ff,side*2.15,1.7,-8.62,0x137d99)}
lobbyBox(4.2,.12,.16,0x4ef2ff,0,3.65,-8.62,0x137d99);

// Panoramic front bridge glass canopy (z = 8.7) — real translucent glass showing 3D cosmos outside
const bridgeGlassMat=new THREE.MeshPhysicalMaterial({color:0x7beeff,transparent:true,opacity:.13,roughness:.08,metalness:.2,depthWrite:false,side:THREE.DoubleSide,fog:false});
const windowPane=new THREE.Mesh(new THREE.PlaneGeometry(16.6,3.7),bridgeGlassMat);windowPane.rotation.y=Math.PI;windowPane.position.set(0,2.95,8.72);lobbyWorld.add(windowPane);
lobbyBox(17.6,1.15,.36,0x1a263e,0,.58,8.78);lobbyBox(17.6,.48,.36,0x1a263e,0,4.85,8.78);
lobbyBox(17.2,.1,.14,0x4ef2ff,0,1.18,8.62,0x16809c);lobbyBox(17.2,.08,.14,0x4ef2ff,0,4.58,8.62,0x16809c);
for(let x of [-8.4,-5.4,-2.7,0,2.7,5.4,8.4])lobbyBox(.16,3.7,.24,0x283854,x,2.9,8.66);

// Port & Starboard walls with wide observation glass + detailed engineering bays
const consoleLeds=[];
for(let side of [-1,1]){
 let pane=new THREE.Mesh(new THREE.PlaneGeometry(13.2,2.95),bridgeGlassMat);pane.rotation.y=side>0?-Math.PI/2:Math.PI/2;pane.position.set(side*8.68,2.95,0.6);lobbyWorld.add(pane);
 lobbyBox(.34,1.35,17.6,0x1b2740,side*8.8,0.68,0);lobbyBox(.34,.75,17.6,0x1b2740,side*8.8,4.72,0);
 lobbyBox(.34,5,3.2,0x1f2d47,side*8.8,2.5,-7.3);lobbyBox(.34,5,2.2,0x1f2d47,side*8.8,2.5,7.9);
 lobbyBox(.14,.08,13.6,0x4ef2ff,side*8.56,1.4,0.6,0x147b96);lobbyBox(.14,.08,13.6,0x4ef2ff,side*8.56,4.35,0.6,0x147b96);
 for(let z of [-5.8,-2.6,0.6,3.8,6.8])lobbyBox(.18,3.2,.2,0x2b3c58,side*8.58,2.88,z);
 // Engineering & Tactical Consoles along walls
 lobbyBox(1.0,.82,12.6,0x24334f,side*8.05,.41,0.5);lobbyBox(1.08,.1,12.7,0x8ea7c4,side*8.02,.86,0.5);
 for(let z=-4.5;z<=5.5;z+=2.5){
  lobbyBox(.62,.05,1.45,0x14223a,side*7.96,.94,z);
  let scr=lobbyBox(.06,.56,1.15,0x2ad8ff,side*8.25,1.34,z,0x107694);scr.rotation.z=side*.24;
  let led=lobbyBox(.12,.04,.24,z%2?0x4ef2ff:0xff55c8,side*7.85,.96,z,z%2?0x18a6c4:0xb81a88);consoleLeds.push(led);
 }
}
// Overhead starship ceiling ribs & glowing light conduits
for(let x of [-6,-3,0,3,6]){lobbyBox(.16,.14,17.4,0x2c3c58,x,4.96,0);lobbyBox(.07,.05,14.5,0x5ceeff,x,4.85,0,0x1686a3)}
for(let z of [-6,-2,2,6])lobbyBox(17.2,.14,.16,0x2c3c58,0,4.96,z);

// Captain's Helm Command Dais & Holographic Console (local x=0, z=6.2 -> world z=11.78 in hub)
const helmGroup=new THREE.Group();helmGroup.position.set(0,0,6.2);lobbyWorld.add(helmGroup);
const helmDais=new THREE.Mesh(new THREE.CylinderGeometry(1.72,1.92,.14,8),new THREE.MeshStandardMaterial({color:0x1b2740,roughness:.35,metalness:.55}));
helmDais.position.y=.07;helmGroup.add(helmDais);
const helmRing=new THREE.Mesh(new THREE.RingGeometry(1.72,1.88,32),new THREE.MeshBasicMaterial({color:0x4ef2ff,side:THREE.DoubleSide}));
helmRing.rotation.x=-Math.PI/2;helmRing.position.y=.145;helmGroup.add(helmRing);
// Captain's Command Chair (facing +Z toward panoramic viewport)
function helmPart(w,h,d,color,x,y,z,em=0){let m=em?mat(color,em):new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.45});let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);helmGroup.add(o);return o}
helmPart(.42,.36,.42,0x25344f,0,.32,-.1);
helmPart(.74,.14,.68,0x18233a,0,.54,-.05);
helmPart(.72,.86,.16,0x1e2c48,0,1.0,-.34);
helmPart(.46,.22,.14,0x4ef2ff,0,1.42,-.33,0x13809e);
for(const side of [-1,1]){helmPart(.11,.12,.6,0x2b3e60,side*.38,.72,-.05);helmPart(.06,.04,.52,0x4ef2ff,side*.38,.79,-.05,0x1586a3)}
// Curved Navigation Console Desk & Holographic Star Globe
helmPart(1.9,.84,.58,0x1d2944,0,.56,.88);
helmPart(2.0,.08,.66,0x7d98b8,0,1.0,.88);
let screenLeft=helmPart(.7,.42,.05,0x3deeff,-.52,1.22,.82,0x148aa8);screenLeft.rotation.x=.42;screenLeft.rotation.y=.22;
let screenRight=helmPart(.7,.42,.05,0x3deeff,.52,1.22,.82,0x148aa8);screenRight.rotation.x=.42;screenRight.rotation.y=-.22;
const hyperButtonMesh=helmPart(.30,.09,.24,0xff48c4,0,1.06,.78,0xc4188c);
const holoGlobeGroup=new THREE.Group();holoGlobeGroup.position.set(0,1.46,.95);helmGroup.add(holoGlobeGroup);
const holoGlobe=new THREE.Mesh(new THREE.IcosahedronGeometry(.22,1),new THREE.MeshBasicMaterial({color:0x5ef4ff,wireframe:true,transparent:true,opacity:.85}));
holoGlobeGroup.add(holoGlobe);
const holoOrbit=new THREE.Mesh(new THREE.TorusGeometry(.32,.015,6,32),new THREE.MeshBasicMaterial({color:0xff64d4,transparent:true,opacity:.8}));
holoOrbit.rotation.x=Math.PI/2.6;holoGlobeGroup.add(holoOrbit);
let hCan=document.createElement('canvas');hCan.width=512;hCan.height=128;let hx=hCan.getContext('2d');
hx.fillStyle='rgba(8,16,36,.92)';hx.beginPath();hx.roundRect(8,8,496,112,22);hx.fill();
hx.strokeStyle='#4ef2ff';hx.lineWidth=4;hx.stroke();
hx.fillStyle='#8ef4ff';hx.font='bold 36px sans-serif';hx.textAlign='center';hx.fillText('ПУЛЬТ КАПИТАНА',256,56);
hx.fillStyle='#ff8ce0';hx.font='bold 24px sans-serif';hx.fillText('ГИПЕРСКОРОСТЬ · СЕСТЬ',256,95);
let hTex=new THREE.CanvasTexture(hCan);hTex.colorSpace=THREE.SRGBColorSpace;
let helmLabel=new THREE.Sprite(new THREE.SpriteMaterial({map:hTex,transparent:true,depthWrite:false}));
helmLabel.position.set(0,2.25,.85);helmLabel.scale.set(2.3,.58,1);helmGroup.add(helmLabel);

let lastSpaceFrame=0;
function animateSpace(t){
 if(room&&phase!=='lobby')return;
 let now=t;
 let hyperPower=0;
 if(hyperActive){
  let elapsed=now-hyperStart;
  if(elapsed>=hyperDuration){
   hyperActive=false;hyperPower=0;
   if(!hyperSwitched){paintCosmicSector(hyperTargetSector);hyperSwitched=true}
   showNotice('✦ ПРИБЫТИЕ: '+COSMIC_SECTORS[hyperSector].name);
  }else{
   let frac=elapsed/hyperDuration;
   hyperPower=frac<.16?frac/.16:frac>.78?(1-frac)/.22:1;
   if(frac>.64&&!hyperSwitched){paintCosmicSector(hyperTargetSector);hyperSwitched=true}
  }
 }
 hyperGroup.visible=hyperPower>.02;
 if(hyperGroup.visible){
  let dtStep=Math.min(.05,Math.max(.008,(now-lastSpaceFrame)/1000||.016));
  let posArr=streakGeo.attributes.position.array;
  for(let i=0;i<STREAK_COUNT;i++){
   let d=streakData[i];
   d.z-=d.sp*(.4+hyperPower*1.8)*dtStep;
   if(d.z<-65)d.z=75;
   let len=d.len*(.3+hyperPower*2.2);
   posArr[i*6]=d.x;posArr[i*6+1]=d.y;posArr[i*6+2]=d.z;
   posArr[i*6+3]=d.x;posArr[i*6+4]=d.y;posArr[i*6+5]=d.z+len;
  }
  streakGeo.attributes.position.needsUpdate=true;
  streakLines.material.opacity=Math.min(.95,hyperPower*1.1);
  for(let r of warpRings){
   r.position.z-=(55+hyperPower*90)*dtStep;
   if(r.position.z<-48)r.position.z=82;
   r.material.opacity=.18*hyperPower;
  }
 }
 lastSpaceFrame=now;
 // Gentle real-time cosmos motion
 skyDome.rotation.y=now*.000015;
 starPoints.rotation.y=now*.00004;
 spacePlanet.rotation.y=now*.00008;
 spaceMoon.rotation.y=now*.00012;
 holoGlobe.rotation.y=now*.0012;holoOrbit.rotation.z=now*.0018;
 hyperButtonMesh.material.emissiveIntensity=hyperActive?1.5+.8*Math.sin(now*.02):(.65+.35*Math.sin(now*.004));
 for(let i=0;i<consoleLeds.length;i++)consoleLeds[i].material.emissiveIntensity=.45+.55*Math.sin(now*.004+i*1.1);
 for(let r of asteroids){
  let a=r.userData.baseA+now*r.userData.speed*.001;
  r.position.x=Math.sin(a)*r.userData.r;r.position.z=Math.cos(a)*r.userData.r;
  r.rotation.x+=.003*r.userData.rx;r.rotation.y+=.003*r.userData.ry;
 }
 for(let c of cruisers){
  let loop=((now*.0032*(c.userData.side>0?1:.85))%140)-70;
  c.position.z=c.userData.side>0?loop:-loop;
  c.rotation.y=c.userData.side>0?0:Math.PI;
  c.userData.beacon.visible=Math.sin(now*.008+c.userData.side)>0;
 }
 for(let pa of portalAnimators){
  let pulse=.5+.5*Math.sin(now*.003+pa.phase);
  pa.outerRing.rotation.z=now*.0008*pa.dir;
  pa.midRing.rotation.z=-now*.0014*pa.dir;
  pa.disc.rotation.z=now*.0005*pa.dir;
  pa.discMat.color.setHSL((pa.baseHue+now*.00009)%1,.88,.64);
  pa.beamMat.color.setHSL((pa.baseHue+.08+now*.00009)%1,.92,.62);
  pa.beamMat.opacity=.18+.11*pulse;
  pa.emblem.rotation.y=now*.0016;
  pa.emblem.rotation.x=Math.sin(now*.0012+pa.phase)*.28;
  pa.emblem.position.y=1.18+Math.sin(now*.0025+pa.phase)*.14;
  pa.sparks.rotation.y=now*.0012;
  pa.sparks.position.y=Math.sin(now*.002+pa.phase)*.18;
 }
}

// === MODERN IRIDESCENT MODE PORTALS ===
const portalAnimators=[];
const iridCanvas=document.createElement('canvas');iridCanvas.width=iridCanvas.height=256;const iridCtx=iridCanvas.getContext('2d');
let iridGrad=iridCtx.createRadialGradient(128,128,12,128,128,126);
iridGrad.addColorStop(0,'rgba(255,255,255,0.92)');
iridGrad.addColorStop(.32,'rgba(120,248,255,0.72)');
iridGrad.addColorStop(.64,'rgba(195,112,255,0.58)');
iridGrad.addColorStop(.86,'rgba(255,98,198,0.45)');
iridGrad.addColorStop(1,'rgba(80,220,255,0)');
iridCtx.fillStyle=iridGrad;iridCtx.fillRect(0,0,256,256);
for(let i=0;i<8;i++){
 iridCtx.save();iridCtx.translate(128,128);iridCtx.rotate(i*Math.PI/4);
 iridCtx.strokeStyle='rgba(255,255,255,0.22)';iridCtx.lineWidth=3;
 iridCtx.beginPath();iridCtx.arc(0,0,42+(i%3)*24,0,Math.PI*.65);iridCtx.stroke();
 iridCtx.restore();
}
const iridTex=new THREE.CanvasTexture(iridCanvas);iridTex.colorSpace=THREE.SRGBColorSpace;
const beamCanvas=document.createElement('canvas');beamCanvas.width=64;beamCanvas.height=128;const bctx=beamCanvas.getContext('2d');
let bGrad=bctx.createLinearGradient(0,128,0,0);
bGrad.addColorStop(0,'rgba(255,255,255,0.72)');
bGrad.addColorStop(.45,'rgba(170,240,255,0.24)');
bGrad.addColorStop(1,'rgba(170,240,255,0)');
bctx.fillStyle=bGrad;bctx.fillRect(0,0,64,128);
const beamTex=new THREE.CanvasTexture(beamCanvas);beamTex.colorSpace=THREE.SRGBColorSpace;

function buildModernPortal(parent, {x,z,radius,colorHex,colorCss,accentCss,title,subtitle,baseHue=.52,emblemKind='diamond',dir=1,labelY=2.65}){
 let g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
 // Iridescent shimmer floor pad
 let discMat=new THREE.MeshBasicMaterial({map:iridTex,color:colorHex,transparent:true,opacity:.68,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
 let disc=new THREE.Mesh(new THREE.CircleGeometry(radius*.95,48),discMat);disc.rotation.x=-Math.PI/2;disc.position.y=.045;g.add(disc);
 // Base metallic pedestal bezel
 let baseRim=new THREE.Mesh(new THREE.TorusGeometry(radius,.085,10,56),new THREE.MeshStandardMaterial({color:0x1b2744,roughness:.28,metalness:.85}));
 baseRim.rotation.x=Math.PI/2;baseRim.position.y=.05;g.add(baseRim);
 // Outer glowing segmented ring
 let outerRing=new THREE.Mesh(new THREE.RingGeometry(radius-.16,radius-.03,48,1,0,Math.PI*1.65),new THREE.MeshBasicMaterial({color:colorHex,side:THREE.DoubleSide,transparent:true,opacity:.92}));
 outerRing.rotation.x=-Math.PI/2;outerRing.position.y=.075;g.add(outerRing);
 // Inner counter-rotating ring
 let midRing=new THREE.Mesh(new THREE.RingGeometry(radius*.58,radius*.69,40,1,0,Math.PI*1.25),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,transparent:true,opacity:.78}));
 midRing.rotation.x=-Math.PI/2;midRing.position.y=.085;g.add(midRing);
 // Vertical holographic light curtain
 let beamMat=new THREE.MeshBasicMaterial({map:beamTex,color:colorHex,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
 let beam=new THREE.Mesh(new THREE.CylinderGeometry(radius*.94,radius*.96,2.15,40,1,true),beamMat);beam.position.y=1.1;g.add(beam);
 // Floating 3D emblem
 let emblemGeo=emblemKind==='sphere'?new THREE.IcosahedronGeometry(.34,1):emblemKind==='ghost'?new THREE.ConeGeometry(.34,.72,6):new THREE.OctahedronGeometry(.36,0);
 let emblem=new THREE.Mesh(emblemGeo,new THREE.MeshStandardMaterial({color:colorHex,emissive:colorHex,emissiveIntensity:1.15,roughness:.18,metalness:.55}));
 emblem.position.y=1.18;g.add(emblem);
 // Orbiting sparkle ring
 let sPos=new Float32Array(24*3);
 for(let i=0;i<24;i++){let a=i/24*Math.PI*2,r=radius*(.62+(i%3)*.13);sPos[i*3]=Math.cos(a)*r;sPos[i*3+1]=.25+(i%5)*.34;sPos[i*3+2]=Math.sin(a)*r}
 let sGeo=new THREE.BufferGeometry();sGeo.setAttribute('position',new THREE.BufferAttribute(sPos,3));
 let sparks=new THREE.Points(sGeo,new THREE.PointsMaterial({color:0xffffff,size:.12,transparent:true,opacity:.88,depthWrite:false,blending:THREE.AdditiveBlending}));
 g.add(sparks);
 // Modern glassmorphic floating label
 let can=document.createElement('canvas');can.width=576;can.height=176;let cx=can.getContext('2d');
 cx.clearRect(0,0,576,176);
 let bg=cx.createLinearGradient(0,0,576,176);bg.addColorStop(0,'rgba(11,19,42,.92)');bg.addColorStop(.5,'rgba(24,20,56,.92)');bg.addColorStop(1,'rgba(10,26,48,.92)');
 cx.fillStyle=bg;cx.beginPath();cx.roundRect(10,10,556,156,28);cx.fill();
 let border=cx.createLinearGradient(10,10,566,166);border.addColorStop(0,colorCss);border.addColorStop(.5,'#ffffff');border.addColorStop(1,accentCss);
 cx.strokeStyle=border;cx.lineWidth=6;cx.beginPath();cx.roundRect(10,10,556,156,28);cx.stroke();
 cx.textAlign='center';cx.fillStyle='#ffffff';cx.font='900 44px system-ui, sans-serif';
 cx.fillText(title,288,76);
 cx.fillStyle=accentCss;cx.font='bold 27px system-ui, sans-serif';
 cx.fillText(subtitle,288,128);
 let tex=new THREE.CanvasTexture(can);tex.colorSpace=THREE.SRGBColorSpace;
 let label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true}));
 label.position.set(0,labelY,0);label.scale.set(4.5,1.38,1);g.add(label);
 portalAnimators.push({outerRing,midRing,disc,discMat,beamMat,emblem,sparks,baseHue,dir,phase:x*.3+z*.2});
}

const votePadWorld=new THREE.Group();lobbyWorld.add(votePadWorld);const voteColors={duct:0x00dfea,colosseum:0xff3478,station:0xffdc35,garden:0x4eff9e};const voteNames={duct:'CHRONO-DUCT',colosseum:'NEO-ARENA',station:'CYBER-STATION',garden:'NEON GARDEN'};
const voteCss={duct:['#00dfea','#b5ffff'],colosseum:['#ff3478','#ffb5d4'],station:['#ffdc35','#fff3a6'],garden:['#4eff9e','#c5ffe2']};
for(const [idx,zone] of VOTE_ZONES.entries()){
 buildModernPortal(votePadWorld,{x:zone.x,z:zone.z,radius:zone.radius,colorHex:voteColors[zone.id],colorCss:voteCss[zone.id][0],accentCss:voteCss[zone.id][1],title:voteNames[zone.id],subtitle:'ВСТАНЬ ДЛЯ ГОЛОСА',baseHue:[.52,.92,.14,.38][idx%4],emblemKind:'diamond',dir:idx%2?1:-1,labelY:2.45});
}
const hubPortalWorld=new THREE.Group();
for(const [idx,zone] of HUB_ZONES.entries()){
 let isNeo=zone.mode==='neoball',isChaser=zone.mode==='chaser';
 let colorHex=isChaser?0xd65eff:isNeo?0x58f7b8:zone.capacity===2?0x4eeeff:zone.capacity===3?0xff76d2:0xffcb5c;
 let colorCss=isChaser?'#d65eff':isNeo?'#58f7b8':zone.capacity===2?'#4eeeff':zone.capacity===3?'#ff76d2':'#ffcb5c';
 let accentCss=isChaser?'#ff9ce9':isNeo?'#d6ff9e':zone.capacity===2?'#b6f9ff':zone.capacity===3?'#ffd2f1':'#fff0b5';
 let title=isChaser?'👻 CHASER · САД':isNeo?('⚽ NEO-BALL '+(zone.capacity===2?'1v1':'2v2')):`⚔ БОЙ ${zone.capacity} ИГРОКА`;
 let subtitle=isChaser?'3–5 ИГРОКОВ · ДУХ vs ВСЕ':'ВСТАНЬ В ПОРТАЛ';
 buildModernPortal(hubPortalWorld,{x:zone.x,z:zone.z,radius:zone.radius,colorHex,colorCss,accentCss,title,subtitle,baseHue:isChaser?.82:isNeo?.42:idx*.18,emblemKind:isChaser?'ghost':isNeo?'sphere':'diamond',dir:idx%2?1:-1,labelY:2.85});
}
function hubPoster(x,z,title,subtitle,color){let can=document.createElement('canvas');can.width=768;can.height=384;let c=can.getContext('2d');let g=c.createLinearGradient(0,0,768,384);g.addColorStop(0,'#192a47');g.addColorStop(1,'#302442');c.fillStyle=g;c.fillRect(0,0,768,384);c.strokeStyle=color;c.lineWidth=7;c.strokeRect(12,12,744,360);c.fillStyle=color;c.textAlign='center';c.font='bold 54px sans-serif';c.fillText(title,384,155);c.fillStyle='#c3d6e8';c.font='30px sans-serif';c.fillText(subtitle,384,226);c.font='24px sans-serif';c.fillText('СКОРО',384,304);let tex=new THREE.CanvasTexture(can);tex.colorSpace=THREE.SRGBColorSpace;let panel=new THREE.Mesh(new THREE.PlaneGeometry(4.4,2.2),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));panel.position.set(x,3.2,z);panel.rotation.y=x<0?Math.PI/2:-Math.PI/2;hubPortalWorld.add(panel)}
hubPoster(-15.8,-13.5,'РЕКЛАМА','МЕСТО ДЛЯ ПАРТНЁРОВ','#72cedd');hubPoster(15.8,-13.5,'ПОДДЕРЖАТЬ ИГРУ','ДОНАТ · ЗАГЛУШКА','#e5bd83');scene.add(hubPortalWorld);
scene.add(lobbyWorld);refreshWorld();
loadAsset('neon_crowd').then(o=>{o.scale.set(2,1,2);crowdWorld=o;scene.add(o);refreshWorld()}).catch(e=>console.error('Зрители не загрузились',e));
$('#quality').onclick=()=>{lowQuality=!lowQuality;$('#quality').textContent=lowQuality?'✦ Лёгкая':'✦ Высокая';composer.setPixelRatio(lowQuality?.65:Math.min(devicePixelRatio,1.15));refreshWorld()};

const heroBoxGeo=new THREE.BoxGeometry(1,1,1), heroMaterials=new Map();
function heroMaterial(color, glow=false){let key=color+':'+glow;if(!heroMaterials.has(key))heroMaterials.set(key,new THREE.MeshStandardMaterial({color,roughness:glow?.34:.56,metalness:glow?.24:.12,emissive:glow?color:0x000000,emissiveIntensity:glow?.38:0}));return heroMaterials.get(key)}
const heroPalettes={
 shadow:{hair:0x21172a,hairLight:0x49304b,hairDark:0x100f1d,suit:0x24203a,armor:0x4a225d,trim:0x9625d1,glow:0xe343ff,skin:0xf4c3a5,eye:0x643995},
 viper:{hair:0xe51a8e,hairLight:0xff65b6,hairDark:0xa50970,suit:0x192533,armor:0x323844,trim:0xe0a61d,glow:0x45d4f0,skin:0xffc5a9,eye:0x713998},
 blitz:{hair:0x117bd8,hairLight:0x48b6ff,hairDark:0x174395,suit:0x142c49,armor:0x245c92,trim:0x178ad2,glow:0x5de8ff,skin:0xf1c1a3,eye:0x1676c1},
 skye:{hair:0x141620,hairLight:0x2c3144,hairDark:0x090a10,suit:0x22242e,armor:0xebb91f,trim:0xffe44d,glow:0xfff06a,skin:0xfacbb1,eye:0x14151e},
 yoru:{hair:0x13141f,hairLight:0x2a2d42,hairDark:0x090a11,suit:0x1f1934,armor:0x602cb0,trim:0xa05eff,glow:0xc585ff,skin:0xf4c5aa,eye:0x13141c},
 celeste:{hair:0x13151e,hairLight:0x2b2f40,hairDark:0x090a0f,suit:0xeaf2fb,armor:0xffffff,trim:0x6adfff,glow:0xa6f4ff,skin:0xffd1b8,eye:0x13151e},
 noch:{hair:0x12131b,hairLight:0x272938,hairDark:0x08090e,suit:0x532d96,armor:0x6d3ec4,trim:0xa864ff,glow:0xd68fff,skin:0xf3c5a3,eye:0x151620},
 ari:{hair:0x6e3d22,hairLight:0x965734,hairDark:0x472514,suit:0xebf2fa,armor:0xffffff,trim:0x2ee69d,glow:0x63ffc6,skin:0xffceb4,eye:0x1fc463},
 ben:{hair:0x523421,hairLight:0x784d31,hairDark:0x331f13,suit:0x239af0,armor:0x42baff,trim:0x72e6ff,glow:0x8ff2ff,skin:0xf7c7ac,eye:0x1b4c7a}
};
const outfitPalettes={
 default:{swatch:'linear-gradient(135deg,#2b3556,#7084b8)'},
 cyber_gold:{suit:0x1a1c26,armor:0xd49b27,trim:0xffd24c,glow:0xffe066,swatch:'linear-gradient(135deg,#1a1c26,#ffd24c)'},
 crimson_oni:{suit:0x26121b,armor:0x9b1c36,trim:0xff3b5c,glow:0xff5a7a,swatch:'linear-gradient(135deg,#26121b,#ff3b5c)'},
 arctic_white:{suit:0xdbe7f3,armor:0xf4f8ff,trim:0x45d8ff,glow:0x7ef3ff,swatch:'linear-gradient(135deg,#f4f8ff,#45d8ff)'},
 emerald_phantom:{suit:0x12221d,armor:0x1b6d4f,trim:0x2de89a,glow:0x55ffb8,swatch:'linear-gradient(135deg,#12221d,#2de89a)'},
 obsidian_nova:{suit:0x0e0f18,armor:0x1e2038,trim:0x9d5cff,glow:0x3ef7ff,swatch:'linear-gradient(135deg,#1e2038,#3ef7ff)'},
 royal_sakura:{suit:0x1d1733,armor:0xd94b98,trim:0xffb3d9,glow:0xff66cc,swatch:'linear-gradient(135deg,#1d1733,#ff66cc)'}
};
const weaponSkinPalettes={
 default:{body:0x25283e,accent:0x565b7b,glow:0x48dfff,tracer:0x69faff,swatch:'linear-gradient(135deg,#25283e,#48dfff)'},
 gold_rush:{body:0x332814,accent:0xd9a126,glow:0xffd24d,tracer:0xffd24d,swatch:'linear-gradient(135deg,#332814,#ffd24d)'},
 crimson_fang:{body:0x2c1119,accent:0xa81c38,glow:0xff3b5c,tracer:0xff3b5c,swatch:'linear-gradient(135deg,#2c1119,#ff3b5c)'},
 cyber_ice:{body:0xd6ecfa,accent:0xffffff,glow:0x66f0ff,tracer:0x8cf7ff,swatch:'linear-gradient(135deg,#ffffff,#66f0ff)'},
 toxic_volt:{body:0x14221b,accent:0x256944,glow:0x49ff88,tracer:0x49ff88,swatch:'linear-gradient(135deg,#14221b,#49ff88)'},
 astral_void:{body:0x171229,accent:0x5c2da6,glow:0xc95cff,tracer:0xc95cff,swatch:'linear-gradient(135deg,#171229,#c95cff)'},
 hyper_prism:{body:0xeff5ff,accent:0xffd479,glow:0x5efcff,tracer:0x5efcff,swatch:'linear-gradient(135deg,#ff77d9,#5efcff)'}
};

function avatar(l, teamRole=null){
 const gunSkin=weaponSkinPalettes[l.weaponSkin]||weaponSkinPalettes.default;
 if(teamRole==='chaser'){
  const root=new THREE.Group();root.userData.isGhost=true;
  const cloakMat=new THREE.MeshStandardMaterial({color:0x0c0916,emissive:0x1b082e,emissiveIntensity:.65,roughness:.55,transparent:true,opacity:.94});
  const veilMat=new THREE.MeshBasicMaterial({color:0x7c2cff,transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.32,.56,1.72,18),cloakMat);body.position.y=1.08;body.castShadow=true;root.add(body);
  const veil=new THREE.Mesh(new THREE.CylinderGeometry(.38,.66,1.82,18,1,true),veilMat);veil.position.y=1.08;root.add(veil);
  const hood=new THREE.Mesh(new THREE.SphereGeometry(.35,16,12),cloakMat);hood.position.set(0,1.92,0);hood.scale.set(1,1.18,1);root.add(hood);
  // Iconic Spirited Away No-Face porcelain mask (facing -Z)
  const maskMat=new THREE.MeshStandardMaterial({color:0xf4f1eb,emissive:0x302440,emissiveIntensity:.35,roughness:.38});
  const mask=new THREE.Mesh(new THREE.SphereGeometry(.26,18,16),maskMat);mask.position.set(0,1.66,-.21);mask.scale.set(.92,1.32,.46);root.add(mask);
  const darkFeature=new THREE.MeshBasicMaterial({color:0x130e1c});
  const markMat=new THREE.MeshBasicMaterial({color:0x7634b8});
  const eyeGlowMat=new THREE.MeshBasicMaterial({color:0xff44c8});
  for(const side of [-1,1]){
   let hole=new THREE.Mesh(new THREE.BoxGeometry(.075,.048,.03),darkFeature);hole.position.set(side*.095,1.73,-.325);root.add(hole);
   let glint=new THREE.Mesh(new THREE.BoxGeometry(.026,.024,.035),eyeGlowMat);glint.position.set(side*.095,1.73,-.33);root.add(glint);
   let brow=new THREE.Mesh(new THREE.BoxGeometry(.06,.055,.025),markMat);brow.position.set(side*.095,1.83,-.318);root.add(brow);
   let cheek=new THREE.Mesh(new THREE.BoxGeometry(.045,.11,.025),markMat);cheek.position.set(side*.095,1.61,-.318);root.add(cheek);
  }
  let mouth=new THREE.Mesh(new THREE.BoxGeometry(.13,.032,.028),darkFeature);mouth.position.set(0,1.50,-.318);root.add(mouth);
  // Ghostly trailing tendrils + glowing Chaser highlight ring
  const wisps=new THREE.Group();root.add(wisps);root.userData.wisps=wisps;
  for(let i=0;i<6;i++){
   let a=i/6*Math.PI*2;
   let w=new THREE.Mesh(new THREE.ConeGeometry(.09,.45,6),veilMat);w.position.set(Math.cos(a)*.46,.32+(i%2)*.14,Math.sin(a)*.46);w.rotation.x=Math.PI;wisps.add(w);
  }
  let auraRing=new THREE.Mesh(new THREE.RingGeometry(.68,.95,32),new THREE.MeshBasicMaterial({color:0xff3ed6,side:THREE.DoubleSide,transparent:true,opacity:.88}));
  auraRing.rotation.x=-Math.PI/2;auraRing.position.y=.05;root.add(auraRing);
  let beaconCol=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,3.2,16,1,true),new THREE.MeshBasicMaterial({color:0xb83eff,transparent:true,opacity:.14,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
  beaconCol.position.y=1.6;root.add(beaconCol);
  root.userData.legs=[];root.userData.arms=[];return root;
 }
 const base=heroPalettes[l.character]||heroPalettes.shadow;
 const ov=(l.outfit&&l.outfit!=='default'&&outfitPalettes[l.outfit])||{};
 const hero={...base,...ov};
 const root=new THREE.Group();
 function box(parent,w,h,d,color,x,y,z,glow=false,rz=0){let m=new THREE.Mesh(heroBoxGeo,heroMaterial(color,glow));m.scale.set(w,h,d);m.position.set(x,y,z);m.rotation.z=rz;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
 function group(parent,x,y,z){let g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g}
 const skin=hero.skin, black=0x111526;
 box(root,.56,.55,.34,hero.suit,0,1.03,0);
 box(root,.50,.34,.035,hero.armor,0,1.11,-.19);
 box(root,.40,.065,.045,hero.trim,0,.90,-.205);
 box(root,.13,.09,.055,hero.glow,0,.91,-.23,true);
 box(root,.47,.08,.10,hero.trim,0,1.30,-.16);
 box(root,.27,.20,.08,hero.armor,0,1.18,.21);
 for(const side of [-1,1]){
  box(root,.055,.23,.035,hero.trim,side*.17,1.12,-.22);
  box(root,.06,.14,.03,hero.glow,side*.24,1.10,-.22,true);
 }
 if(l.character==='celeste'){
  // White flared cyber dress
  box(root,.66,.26,.44,hero.armor,0,.78,0);
  box(root,.72,.14,.48,hero.suit,0,.64,0);
  box(root,.73,.05,.49,hero.trim,0,.58,0,true);
  box(root,.20,.10,.05,hero.trim,0,.84,.23);
 }
 const isDefaultOutfit=!l.outfit||l.outfit==='default';
 const legMain=l.character==='celeste'?skin:(isDefaultOutfit&&l.character==='ari')?0x2d5b8e:(isDefaultOutfit&&l.character==='ben')?0x636e82:hero.suit;
 const legAccent=(isDefaultOutfit&&l.character==='ari')?0x22466e:(isDefaultOutfit&&l.character==='ben')?0x4d5668:hero.armor;
 const shoeColor=l.character==='celeste'?hero.armor:(isDefaultOutfit&&l.character==='ari')?0xeef4fb:(isDefaultOutfit&&l.character==='ben')?0x222736:black;
 const legs=[],arms=[];
 for(const side of [-1,1]){
  let leg=group(root,side*.17,.77,0);legs.push(leg);
  box(leg,.27,.42,.30,legMain,0,-.21,0);
  box(leg,.28,.19,.33,legAccent,0,-.29,-.015);
  box(leg,.22,.055,.34,hero.trim,0,-.32,-.02);
  box(leg,.30,.15,.43,shoeColor,0,-.67,-.045);
  box(leg,.30,.07,.42,hero.trim,0,-.68,-.05);
  box(leg,.24,.23,.30,l.character==='celeste'?hero.armor:legMain,0,-.50,0);
  let arm=group(root,side*.40,1.24,0);arms.push(arm);
  box(arm,.25,.40,.28,l.character==='celeste'?skin:hero.suit,0,-.20,0);
  box(arm,.32,.17,.35,hero.armor,0,-.025,0);
  box(arm,.29,.055,.36,hero.trim,0,-.08,-.01);
  box(arm,.27,.14,.31,hero.armor,0,-.33,0);
  box(arm,.23,.05,.32,hero.glow,0,-.35,-.01,true);
  box(arm,.21,.13,.26,skin,0,-.46,-.01);
 }
 let head=group(root,0,1.66,0);root.userData.head=head;
 box(head,.63,.54,.50,skin,0,.02,0);
 box(head,.12,.16,.30,skin,-.35,-.02,0);box(head,.12,.16,.30,skin,.35,-.02,0);
 for(const side of [-1,1]){
  box(head,.20,.20,.018,0xffffff,side*.155,.01,-.258);
  box(head,.115,.18,.025,hero.eye,side*.155,.005,-.273);
  box(head,.055,.145,.03,black,side*.155,.005,-.29);
  box(head,.045,.045,.035,0xffffff,side*.14,.06,-.311);
  box(head,.22,.055,.03,hero.hairDark,side*.155,.15,-.278,false,side*-.18);
 }
 box(head,.10,.027,.025,0x925761,0,-.16,-.259);
 box(head,.68,.18,.55,hero.hair,0,.30,.02);
 box(head,.68,.34,.13,hero.hairDark,0,.06,.27);
 box(head,.15,.32,.48,hero.hair,-.30,.16,.05);box(head,.15,.32,.48,hero.hair,.30,.16,.05);
 for(let i=0;i<5;i++){
  let x=(i-2)*.125;box(head,.14,.12+(i%2)*.055,.14,i%2?hero.hairLight:hero.hair,x,.20-(i%2)*.03,-.29,false,(i-2)*.08);
 }
 for(let x of [-.23,0,.23])for(let z of [-.18,.02,.20])box(head,.20,.095,.18,(x===0&&z===-.18)?hero.hairLight:hero.hair,x,.405,z);
 if(l.character==='viper'){
  for(let side of [-1,1]){box(head,.14,.25,.19,hero.hairDark,side*.25,.48,.03,false,-side*.20);box(head,.085,.14,.10,hero.hairLight,side*.25,.49,-.075)}
  box(root,.35,.10,.08,hero.trim,.08,1.28,-.24);box(root,.13,.38,.07,hero.trim,.24,1.05,.24,false,-.15);
 }else if(l.character==='shadow'){
  for(let i=0;i<3;i++)box(head,.14,.12,.18,hero.hairDark,(i-1)*.22,.43,.16,false,(i-1)*.25);
  box(root,.48,.39,.09,hero.armor,0,1.08,.235);box(root,.28,.22,.025,hero.glow,0,1.1,.29,true);
 }else if(l.character==='skye'){
  // Sleek side-parted bob hair with yellow/neon hair clip & cyber jacket collar
  box(head,.15,.46,.22,hero.hair,-.31,-.06,-.09,false,.08);
  box(head,.15,.42,.22,hero.hairLight,.31,-.04,-.09,false,-.08);
  box(head,.14,.06,.06,hero.glow,.23,.22,-.29,true,-.15);
  box(root,.56,.14,.38,hero.armor,0,1.29,.02);
  box(root,.48,.22,.07,hero.trim,0,1.05,.22);
 }else if(l.character==='yoru'){
  // Spiky black hair crest & violet jacket/scarf
  for(let i=0;i<4;i++)box(head,.13,.17,.17,i%2?hero.hairLight:hero.hairDark,(i-1.5)*.16,.46,.05,false,(i-1.5)*.22);
  box(root,.44,.12,.14,hero.trim,0,1.31,-.18);
  box(root,.32,.26,.08,hero.armor,0,1.12,.22);
  box(root,.16,.16,.03,hero.glow,0,1.12,.27,true);
 }else if(l.character==='celeste'){
  // Two iconic hanging black twin-tail pigtails + glowing hair ties
  for(const side of [-1,1]){
   box(head,.12,.11,.12,hero.trim,side*.39,.25,.05,true);
   box(head,.18,.34,.18,hero.hair,side*.46,.10,.06,false,side*-.18);
   box(head,.16,.38,.16,hero.hairDark,side*.51,-.22,.08,false,side*-.12);
   box(head,.11,.22,.12,hero.hairLight,side*.53,-.46,.10,false,side*-.08);
  }
 }else if(l.character==='noch'){
  // Long black ponytail + small neat goatee beard + purple jumpsuit straps/belt
  box(head,.15,.11,.11,hero.trim,0,.14,.34,true);
  box(head,.18,.28,.17,hero.hair,0,.06,.43);
  box(head,.15,.30,.15,hero.hairDark,0,-.20,.46);
  box(head,.11,.20,.12,hero.hairLight,0,-.40,.48);
  box(head,.10,.28,.14,hero.hairDark,-.29,-.02,-.16);
  box(head,.10,.28,.14,hero.hairDark,.29,-.02,-.16);
  box(head,.16,.08,.04,hero.hairDark,0,-.235,-.255);
  box(head,.18,.03,.035,hero.hairDark,0,-.13,-.262);
  box(head,.045,.10,.035,hero.hairDark,-.075,-.185,-.260);
  box(head,.045,.10,.035,hero.hairDark,.075,-.185,-.260);
  box(root,.09,.38,.04,hero.trim,-.14,1.12,-.20);
  box(root,.09,.38,.04,hero.trim,.14,1.12,-.20);
  box(root,.44,.10,.36,hero.armor,0,.86,0);
  box(root,.12,.08,.05,hero.glow,0,.86,-.20,true);
 }else if(l.character==='ari'){
  // Long flowing brown hair + white hoodie hood & pocket
  box(head,.68,.54,.15,hero.hairDark,0,-.18,.28);
  box(head,.56,.28,.12,hero.hair,0,-.46,.29);
  box(head,.14,.52,.20,hero.hair,-.31,-.10,-.06,false,.06);
  box(head,.14,.52,.20,hero.hairLight,.31,-.10,-.06,false,-.06);
  box(root,.52,.16,.18,hero.armor,0,1.32,.16);
  box(root,.46,.10,.14,hero.suit,0,1.27,.23);
  box(root,.36,.16,.04,hero.suit,0,.88,-.19);
  box(root,.035,.18,.03,hero.trim,-.06,1.18,-.20);
  box(root,.035,.18,.03,hero.trim,.06,1.18,-.20);
 }else if(l.character==='ben'){
  // Short textured haircut + blue sweater collar & cuff
  box(head,.26,.11,.28,hero.hairLight,-.14,.42,-.06,false,.08);
  box(head,.26,.10,.28,hero.hair,.14,.41,-.04,false,-.08);
  box(head,.18,.08,.14,hero.hairLight,.06,.31,-.27,false,-.14);
  box(root,.42,.08,.35,hero.trim,0,1.30,0);
  box(root,.58,.08,.36,hero.armor,0,.79,0);
 }else{
  for(let side of [-1,1])box(head,.21,.13,.30,hero.hairLight,side*.19,.37,-.05,false,side*.12);
  box(root,.50,.40,.07,hero.armor,0,.91,.22);box(root,.08,.35,.04,hero.trim,0,.94,.27);
 }
 // Outfit premium accents
 if(l.outfit==='obsidian_nova'){
  for(const side of [-1,1]){box(root,.06,.48,.24,hero.glow,side*.24,1.22,.28,true,side*.32);box(root,.05,.32,.18,hero.trim,side*.34,1.32,.34,true,side*.45)}
 }else if(l.outfit==='royal_sakura'){
  for(const side of [-1,1]){box(root,.16,.12,.38,hero.glow,side*.44,1.35,0,true,side*-.22)}
 }else if(l.outfit==='arctic_white'||l.outfit==='emerald_phantom'){
  box(head,.65,.07,.04,hero.glow,0,.02,-.265,true);
 }
 // Third-person weapon on right arm using equipped weaponSkin
 let gun=group(arms[1],0,-.32,-.30);
 box(gun,.21,.16,.52,gunSkin.body,0,0,-.08);box(gun,.22,.075,.30,gunSkin.accent,0,.10,-.08);
 box(gun,.09,.07,.34,gunSkin.glow,0,.035,-.18,true);box(gun,.15,.13,.08,gunSkin.accent,0,0,-.37);box(gun,.06,.06,.025,gunSkin.glow,0,0,-.42,true);
 // Neo-Ball / Chaser team highlight (ally = emerald green, enemy = crimson red)
 if(teamRole==='ally'||teamRole==='enemy'||teamRole==='survivor'){
  let tc=(teamRole==='ally'||teamRole==='survivor')?0x3dff9e:0xff3b5c;
  let ringMesh=new THREE.Mesh(new THREE.RingGeometry(.58,.78,28),new THREE.MeshBasicMaterial({color:tc,side:THREE.DoubleSide,transparent:true,opacity:.88}));
  ringMesh.rotation.x=-Math.PI/2;ringMesh.position.y=.05;root.add(ringMesh);
  if(teamRole!=='survivor')for(const side of [-1,1]){
   let pad=box(root,.13,.13,.13,tc,side*.44,1.42,0,true);
   pad.rotation.y=Math.PI/4;
  }
 }
 root.userData.legs=legs;root.userData.arms=arms;return root;
}

scene.add(camera);const viewGun=new THREE.Group();camera.add(viewGun);
const muzzleLight=new THREE.PointLight(0x9ff9ff,0,9,2);muzzleLight.position.set(.26,-.22,-1.12);camera.add(muzzleLight);
let muzzlePending=false,cameraPunch=0,cameraBack=0,shotBurst=0,lastShotEffect=0;
const shellGeo=new THREE.CylinderGeometry(.025,.025,.10,7),shellMat=new THREE.MeshStandardMaterial({color:0xcda44e,metalness:.75,roughness:.33,envMap:reflectionEnv,envMapIntensity:.5});const casings=[],smokes=[];
const smokeCanvas=document.createElement('canvas');smokeCanvas.width=smokeCanvas.height=64;let smokeCtx=smokeCanvas.getContext('2d'),smokeGrad=smokeCtx.createRadialGradient(32,32,1,32,32,32);smokeGrad.addColorStop(0,'rgba(200,220,230,.6)');smokeGrad.addColorStop(.4,'rgba(160,186,205,.20)');smokeGrad.addColorStop(1,'rgba(110,140,170,0)');smokeCtx.fillStyle=smokeGrad;smokeCtx.fillRect(0,0,64,64);let smokeTexture=new THREE.CanvasTexture(smokeCanvas);
function shotVisuals(t){camera.updateMatrixWorld(true);let casing=new THREE.Mesh(shellGeo,shellMat);casing.position.copy(camera.localToWorld(new THREE.Vector3(.30,-.22,-.72)));let velocity=new THREE.Vector3(1.7+Math.random()*.8,1.6+Math.random()*.7,.15+Math.random()*.7).applyQuaternion(camera.quaternion);scene.add(casing);casings.push({mesh:casing,velocity,life:2.5,phase:worldPhase()});if(casings.length>30){let old=casings.shift();scene.remove(old.mesh)}shotBurst=t-lastShotEffect<500?shotBurst+1:1;lastShotEffect=t;if(shotBurst>=2){let mat=new THREE.SpriteMaterial({map:smokeTexture,color:0xb8d5e4,transparent:true,opacity:.35,depthWrite:false});let sprite=new THREE.Sprite(mat);sprite.position.copy(camera.localToWorld(new THREE.Vector3(.28,-.21,-1.14)));sprite.scale.setScalar(.16);scene.add(sprite);smokes.push({mesh:sprite,velocity:new THREE.Vector3((Math.random()-.5)*.15,.35,-.22).applyQuaternion(camera.quaternion),life:.7});if(smokes.length>16){let old=smokes.shift();scene.remove(old.mesh);old.mesh.material.dispose()}}}
function updateShotEffects(dt){for(let i=casings.length-1;i>=0;i--){let c=casings[i];c.life-=dt;c.velocity.y-=15*dt;let o=c.mesh;o.position.addScaledVector(c.velocity,dt);o.rotation.x+=dt*11;o.rotation.z+=dt*8;if(o.position.y<.055){o.position.y=.055;if(c.velocity.y<-.5){c.velocity.y*=-.35;c.velocity.x*=.7;c.velocity.z*=.7}else{c.velocity.y=0;c.velocity.x*=Math.exp(-dt*8);c.velocity.z*=Math.exp(-dt*8)}}let corrected=constrainPosition(o.position.x,o.position.z,c.phase,o.position.y);if(Math.abs(corrected.x-o.position.x)>.001){o.position.x=corrected.x;c.velocity.x*=-.45}if(Math.abs(corrected.z-o.position.z)>.001){o.position.z=corrected.z;c.velocity.z*=-.45}if(c.life<=0){scene.remove(o);casings.splice(i,1)}}for(let i=smokes.length-1;i>=0;i--){let s=smokes[i];s.life-=dt;s.mesh.position.addScaledVector(s.velocity,dt);s.mesh.scale.addScalar(dt*.42);s.mesh.material.opacity=Math.max(0,s.life/.7)*.30;if(s.life<=0){scene.remove(s.mesh);s.mesh.material.dispose();smokes.splice(i,1)}}}
function gunPart(w,h,d,color,x,y,z,em=0){let o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color,em));o.position.set(x,y,z);viewGun.add(o);return o}
gunPart(.26,.20,.72,0x25283e,0,0,0);gunPart(.23,.10,.38,0x565b7b,0,.11,.02);gunPart(.15,.3,.16,0x272334,0,-.21,.17);gunPart(.18,.06,.42,0x48dfff,0,.015,-.10,0x126c84);gunPart(.22,.17,.20,0x242940,0,0,-.37);gunPart(.21,.25,.24,0xe8ad93,.02,-.28,.25);gunPart(.24,.2,.22,0x513baf,.02,-.39,.30);viewGun.position.set(.35,-.27,-.72);
const fallbackGunParts=viewGun.children.slice(0,5);let kitGun=null,requestedGun='',appliedGunKey='';
function applyGunSkinMaterials(skinId){
 let skin=weaponSkinPalettes[skinId]||weaponSkinPalettes.default;
 muzzleLight.color.setHex(skin.tracer);
 fallbackGunParts[0].material.color.setHex(skin.body);
 fallbackGunParts[1].material.color.setHex(skin.accent);
 fallbackGunParts[3].material.color.setHex(skin.glow);
 fallbackGunParts[3].material.emissive.setHex(skin.glow);
 fallbackGunParts[4].material.color.setHex(skin.body);
 if(!kitGun)return;
 kitGun.traverse(o=>{
  if(!o.isMesh||!o.material)return;
  if(!o.userData.clonedMat){o.material=o.material.clone();o.userData.origColor=o.material.color.clone();o.userData.origEmissive=o.material.emissive?o.material.emissive.clone():new THREE.Color(0);o.userData.clonedMat=true}
  let m=o.material;
  if(skinId==='default'){m.color.copy(o.userData.origColor);if(m.emissive)m.emissive.copy(o.userData.origEmissive);return}
  let mn=(m.name||o.name||'').toLowerCase();
  if(/glow|neon|light|energy|trim|emissive/.test(mn)||(o.userData.origEmissive&&o.userData.origEmissive.getHex()!==0)){
   m.color.setHex(skin.glow);if(m.emissive){m.emissive.setHex(skin.glow);m.emissiveIntensity=1.6}
  }else if(/accent|barrel|rail|scope|gold|silver/.test(mn)){
   m.color.setHex(skin.accent);
  }else{
   m.color.setHex(skin.body).lerp(new THREE.Color(skin.accent),.25);
  }
 });
}
function refreshGun(id, skinId='default'){
 let file=id==='shotgun'?'blaster_rifle':'blaster_smg';
 requestedGun=file;
 let key=file+'|'+skinId;
 if(kitModels[file]&&(!kitGun||kitGun.userData.file!==file)){
  if(kitGun)viewGun.remove(kitGun);
  for(const part of fallbackGunParts)part.visible=false;
  kitGun=kitModels[file].clone(true);kitGun.rotation.x=-Math.PI/2;kitGun.position.set(0,-.15,.10);kitGun.scale.setScalar(id==='shotgun'?1.25:1.05);kitGun.userData.file=file;viewGun.add(kitGun);
  appliedGunKey='';
 }
 if(appliedGunKey!==key){appliedGunKey=key;applyGunSkinMaterials(skinId)}
}
for(const file of ['blaster_smg','blaster_rifle'])loadAsset(file).then(()=>{if(requestedGun===file){let meData=players.get(me)?.data;refreshGun(meData?.weapon||'smg',meData?.look?.weaponSkin||'default')}}).catch(e=>console.error('Оружие не загрузилось',e));

let previewRenderer, previewScene, previewCamera, previewFigure;
try {
 previewRenderer=new THREE.WebGLRenderer({canvas:$('#avatar-preview'),antialias:true,alpha:true});
 previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); previewRenderer.setSize(180,180,false);
 previewScene=new THREE.Scene(); previewScene.add(new THREE.HemisphereLight(0xffffff,0x6470a9,2.2));
 let light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,5);previewScene.add(light);
 previewCamera=new THREE.PerspectiveCamera(38,1,.1,30);previewCamera.position.set(1.5,1.6,-3.1);previewCamera.lookAt(0,1.05,0);
 refreshPreview=()=>{if(previewFigure)previewScene.remove(previewFigure);previewFigure=avatar(look);previewScene.add(previewFigure);previewRenderer.render(previewScene,previewCamera)};
 refreshPreview();
} catch(e) { $('#avatar-preview').style.display='none'; console.warn('Предпросмотр недоступен',e); }
for(const button of document.querySelectorAll('.vote-buttons button'))button.addEventListener('click',()=>{send({type:'mapvote',map:button.dataset.map});try{window.Telegram?.WebApp?.HapticFeedback?.selectionChanged()}catch{}});
function renderNeoResults(m){let container=$('#team-results');container.replaceChildren();let n=m.neo,score=document.createElement('div');score.className='team-final-score';let left=document.createElement('span'),mid=document.createElement('span'),right=document.createElement('span');left.className='blue';right.className='pink';left.textContent='A';mid.textContent=`${n.scores.A} : ${n.scores.B}`;right.textContent='B';score.append(left,mid,right);let winner=document.createElement('div');winner.className='team-winner-label';winner.textContent=n.winner?'★ ПОБЕДИЛА КОМАНДА '+n.winner:'🤝 НИЧЬЯ · ИТОГИ МАТЧА';let rosters=document.createElement('div');rosters.className='team-rosters';for(let team of ['A','B']){let panel=document.createElement('section');panel.className='team-roster'+(n.winner===team?' won':'');let title=document.createElement('h3');title.textContent='КОМАНДА '+team+(n.winner===team?' · ПОБЕДА':'');panel.append(title);for(let p of m.results.filter(x=>x.team===team)){let row=document.createElement('div');row.className='team-player';let img=document.createElement('img'),hero=validHeroes.includes(p.look?.character)?p.look.character:'shadow';img.src=document.querySelector(`.hero-card[data-hero="${hero}"] img`).src;img.alt=hero.toUpperCase();let data=document.createElement('div'),name=document.createElement('div'),stats=document.createElement('div');name.className='team-player-name';name.textContent=p.name+(p.id===me?' · ВЫ':'');stats.className='team-player-detail';stats.textContent=`⚔ ${p.kills} · ☠ ${p.deaths} · +${p.reward} 🪙`;data.append(name,stats);row.append(img,data);panel.append(row)}rosters.append(panel)}container.append(score,winner,rosters)}

let lastMyVote=null;function applyState(m){if(m.now)serverClockOffset=m.now-Date.now();let previous=phase;roomMode=m.mode||'private';phase=m.phase;currentMap=['duct','station','neoball','garden'].includes(m.map)?m.map:'colosseum';refreshWorld();let phaseChanged=previous!==phase||roomEpoch!==(m.epoch||0);roomEpoch=m.epoch||0;countdownEnd=m.countdown||0;matchEndsAt=m.ends||0;endingAt=phase==='ending'?m.ends:0;$('#end-transition').classList.toggle('hide',phase!=='ending');if(phase!=='ending')endingDigit=null;if(previous!==phase){if(previous==='lobby'&&phase==='match'){let fade=$('#map-transition');fade.style.transition='none';fade.style.opacity='.85';requestAnimationFrame(()=>{requestAnimationFrame(()=>{fade.style.transition='opacity .45s ease';fade.style.opacity='0'})});showNotice('КАРТА: '+(currentMap==='duct'?'CHRONO-DUCT':currentMap==='station'?'CYBER-STATION':currentMap==='neoball'?'NEO-BALL':currentMap==='garden'?'NEON GARDEN':'NEO-ARENA'))}resetJump();impulseX=0;impulseZ=0;flipTime=0;moveVX=0;moveVZ=0;if(phase!=='match'){myRespawnUntil=0;wasServerDead=false;spectateId=null;$('#respawn-overlay').classList.add('hide');$('#spectator-hud').classList.add('hide');$('#chaser-banner').classList.add('hide')}}$('#phase').textContent=phase==='lobby'?' / ЛОББИ':phase==='match'?' / БОЙ':' / ИТОГИ';$('#room').textContent=m.code;$('#mapname').textContent=phase==='lobby'?(roomMode==='hub'?'ОБЩЕЕ ЛОББИ':roomMode==='voting'?'ВЫБОР КАРТЫ':'ЛИЧНАЯ КОМНАТА'):m.map==='duct'?'СЕКТОР-9':m.map==='station'?'СТАНЦИЯ':m.map==='neoball'?'NEO-BALL':m.map==='garden'?'САД И ДОМИКИ':'КОЛИЗЕЙ';$('#count').textContent=m.players.length;$('#capacity').textContent=roomMode==='hub'?'24':roomMode==='chaser'?'5':'4';
let myServer=m.players.find(x=>x.id===me),myTeam=myServer?.team||null;
chaserSnapshot=m.chaser||null;
let ids=new Set(m.players.map(p=>p.id));for(let [id,p] of players)if(!ids.has(id)){clearPlayerSprites(p);players.delete(id)}
for(let p of m.players){
 let teamRole=(roomMode==='neoball'&&phase==='match'&&p.id!==me&&myTeam)?(p.team===myTeam?'ally':'enemy'):(roomMode==='chaser'&&phase==='match')?(p.team==='chaser'?'chaser':'survivor'):null;
 let lookKey=[p.look?.character||'shadow',p.look?.outfit||'default',p.look?.weaponSkin||'default',teamRole||''].join('|');
 let o=players.get(p.id);
 if(!o){
  let mesh=avatar(p.look||{},teamRole);scene.add(mesh);o={mesh,x:p.x,z:p.z,lookKey,teamRole};
  if(p.id!==me){o.healthSprite=makeHealthBar(teamRole);scene.add(o.healthSprite);o.nameSprite=makeNameSprite(p.name,teamRole);scene.add(o.nameSprite)}
  players.set(p.id,o);
 }else if(o.lookKey!==lookKey){
  let pos=o.mesh.position.clone(),rotY=o.mesh.rotation.y;
  scene.remove(o.mesh);o.mesh=avatar(p.look||{},teamRole);o.mesh.position.copy(pos);o.mesh.rotation.y=rotY;scene.add(o.mesh);o.lookKey=lookKey;
  if(p.id!==me&&o.teamRole!==teamRole){
   o.teamRole=teamRole;
   if(o.healthSprite){scene.remove(o.healthSprite);o.healthSprite.material.map.dispose();o.healthSprite.material.dispose()}
   if(o.nameSprite){scene.remove(o.nameSprite);o.nameSprite.material.map.dispose();o.nameSprite.material.dispose()}
   o.healthSprite=makeHealthBar(teamRole);scene.add(o.healthSprite);o.lastHp=null;
   o.nameSprite=makeNameSprite(p.name,teamRole);scene.add(o.nameSprite);
  }
 }
 if(p.id===me&&o.data&&o.data.coins!==p.coins)playCoinSound();
 Object.assign(o,{data:p});
 if(o.healthSprite&&(o.lastHp!==p.hp||o.lastMaxHp!==(p.maxHp||100))){updateHealthBar(o.healthSprite,p.hp,o.teamRole,p.maxHp||100);o.lastHp=p.hp;o.lastMaxHp=p.maxHp||100}
 if(p.id!==me||phaseChanged){o.x=p.x;o.z=p.z}
 if(p.id===me){o.authX=p.x;o.authZ=p.z;o.ackSeq=p.moveSeq||0}
}
if(!hyperActive&&Number.isInteger(m.sector)&&m.sector!==hyperSector)paintCosmicSector(m.sector);
let self=players.get(me);if(!self)return;
isSeated=(phase==='lobby'&&!!self.data.seated);
if(isSeated){self.x=self.data.x;self.z=self.data.z;moveVX=0;moveVZ=0;impulseX=0;impulseZ=0}
let serverDead=phase==='match'&&!!self.data.respawnAt;
if(serverDead&&!wasServerDead){myRespawnUntil=performance.now()+Math.max(500,Math.min(5000,(self.data.respawnAt-serverNow())||5000));resetJump();moveVX=moveVZ=impulseX=impulseZ=0}
if(!serverDead&&wasServerDead){myRespawnUntil=0;$('#respawn-overlay').classList.add('hide')}
wasServerDead=serverDead;

$('#player-name').textContent=phase==='lobby'?self.data.name:(roomMode==='chaser'?(self.data.team==='chaser'?'👻 CHASER':'🛡 ВЫЖИВШИЙ'):'NEON ARENA');let board=$('#vote-board');board.style.display=phase==='lobby'&&roomMode==='private'?'block':'none';if(phase==='lobby'&&roomMode==='private'){let v=m.votes||{};board.innerHTML=`🗳 ВСТАНЬ НА КРУГ · МОЙ ВЫБОР: <b>${voteNames[self.data.vote]||'НЕТ'}</b><br><span style="color:#4beef3">CHRONO ${v.duct||0}</span> &nbsp; <span style="color:#ff6598">ARENA ${v.colosseum||0}</span> &nbsp; <span style="color:#ffe25b">STATION ${v.station||0}</span> &nbsp; <span style="color:#4eff9e">GARDEN ${v.garden||0}</span>`;if(self.data.vote&&self.data.vote!==lastMyVote){try{window.Telegram?.WebApp?.HapticFeedback?.selectionChanged()}catch{}}lastMyVote=self.data.vote||null}else lastMyVote=null;neoSnapshot=m.neo||null;let neoActive=roomMode==='neoball'&&phase==='match';document.body.classList.toggle('neo-active',neoActive);$('#neo-hud').style.display=neoActive?'block':'none';$('#center').style.display=neoActive?'none':'';if(neoActive){let n=m.neo,remaining=formatTime(Math.max(0,m.ends-serverNow()));$('#neo-score').innerHTML=`🔵 A ${n.scores.A} — ${n.scores.B} B 🩷  ·  ${remaining}<div style="font-size:9px;letter-spacing:2px;color:#a9d9e8">${'●'.repeat(n.scores.A)}${'○'.repeat(5-n.scores.A)} &nbsp; · &nbsp; ${'●'.repeat(n.scores.B)}${'○'.repeat(5-n.scores.B)}</div>`;let carrier=m.players.find(p=>p.id===n.ball.holder);$('#neo-carrier').textContent=n.resetAt?'Мяч появится через '+Math.max(0,Math.ceil((n.resetAt-serverNow())/1000))+'с':carrier?(carrier.id===me?'⚽ ВЫ НЕСЁТЕ МЯЧ!':'⚽ МЯЧ: '+carrier.name+(carrier.team===myTeam?' (СВОЙ)':' (ВРАГ)')):'⚽ МЯЧ НА ПОЛЕ';$('#neo-team-pill').innerHTML=`КОМАНДА <b>${self.data.team}</b> · <span style="color:#4dff9e">СВОИ</span> / <span style="color:#ff5478">ВРАГИ</span>`;if(phaseChanged)angle=self.data.team==='A'?Math.PI:0}let queues=$('#hub-queues');queues.style.display=phase==='lobby'&&roomMode==='hub'?'block':'none';if(roomMode==='hub'&&m.queues){queues.innerHTML=[m.queues.filter(q=>q.mode==='classic'),m.queues.filter(q=>q.mode!=='classic')].map(row=>row.map(q=>`${q.mode==='chaser'?'👻 CHASER':q.mode==='neoball'?'NEO '+(q.capacity===2?'1v1':'2v2'):q.capacity+' ИГР.'} ${q.count}/${q.capacity}${q.ends?' · '+Math.max(0,Math.ceil((q.ends-serverNow())/1000))+'с':''}`).join(' &nbsp;|&nbsp; ')).join('<br>')+'<br><span style="font-size:9.5px;color:#a8bfd1">CHASER И NEO-BALL ПОЗАДИ · ПУЛЬТ КАПИТАНА ВПЕРЕДИ</span>'}let voting=phase==='lobby'&&roomMode==='voting';$('#map-vote-modal').classList.toggle('hide',!voting);if(voting){$('#vote-clock').textContent=Math.max(0,Math.ceil((countdownEnd-serverNow())/1000));for(let button of document.querySelectorAll('.vote-buttons button')){button.classList.toggle('active',self.data.vote===button.dataset.map);button.querySelector('b').textContent=(m.votes||{})[button.dataset.map]||0}}refreshGun(self.data.weapon,self.data.look?.weaponSkin||'default');$('#hp').textContent=self.data.hp;$('#coins').textContent=self.data.coins;$('#score').textContent=m.players.map(p=>`${p.team==='chaser'?'👻 ':''}${p.name}${p.eliminated?' ☠':''}  ${p.kills} ⚔`).join('\n');$('#hint').textContent=phase==='lobby'?(roomMode==='hub'?(self.data.queue?'Ожидание игроков · свободные слоты заполнят боты':'Встань в портал для старта (с игроками или ботами)'):roomMode==='voting'?'Выбери карту в окне':'Встань на круг выбранной карты'):phase==='match'?(roomMode==='chaser'?(self.data.eliminated?'Режим наблюдателя':self.data.team==='chaser'?'👻 ОХОТНИК (400 HP) · Поймай всех!':'🛡 ВЫЖИВШИЙ · Одолейте духа или продержитесь!'):`${defs[self.data.weapon]?.name||''} · ${self.data.kills} убийств`):'';ring.visible=beacon.visible=false;$('#timer').textContent=phase==='lobby'?(roomMode==='hub'?'СОБЕРИ КОМАНДУ':countdownEnd?'ГОЛОСОВАНИЕ: '+Math.max(0,Math.ceil((countdownEnd-serverNow())/1000)):'ВЫБЕРИТЕ КАРТУ'):phase==='match'?formatTime(Math.max(0,m.ends-serverNow())):'ФИНИШ';if(!$('#shop').classList.contains('hide'))renderShop();if(phase==='results'){let result=$('#results');result.classList.remove('hide');$('#resultTimer').textContent=Math.max(0,Math.ceil((m.ends-serverNow())/1000));if(!resultsOpen){resultsOpen=true;$('.results-title').textContent=roomMode==='neoball'?'NEO-BALL · ИТОГИ':roomMode==='chaser'?(m.chaser?.winner==='chaser'?'👻 ПОБЕДИЛ CHASER!':'🛡 ПОБЕДИЛИ ВЫЖИВШИЕ!'):'ГЕРОИ АРЕНЫ';let podium=$('#podium'),teams=$('#team-results');teams.style.display=roomMode==='neoball'?'block':'none';podium.style.display=roomMode==='neoball'?'none':'';if(roomMode==='neoball')renderNeoResults(m);podium.replaceChildren();podium.classList.toggle('single',m.results.length===1);for(let [i,p] of m.results.entries()){let card=document.createElement('article');card.className='rank'+(i===0?' winner':'');card.style.setProperty('--delay',`${i*.12}s`);let portrait=document.createElement('div');portrait.className='portrait';let image=document.createElement('img');let hero=validHeroes.includes(p.look?.character)?p.look.character:'shadow';image.src=document.querySelector(`.hero-card[data-hero="${hero}"] img`).src;image.alt=hero.toUpperCase();portrait.append(image);let place=document.createElement('div');place.className='placement';place.textContent=`${i+1} МЕСТО ${i===0?'★':''}`;let info=document.createElement('div');info.className='rank-info';let name=document.createElement('h3');name.textContent=p.name+(p.id===me?' · ВЫ':'');let heroLabel=document.createElement('div');heroLabel.className='hero-label';heroLabel.textContent=(p.team==='chaser'?'👻 CHASER · ':p.team==='survivor'?'🛡 ВЫЖИВШИЙ · ':p.team?'КОМАНДА '+p.team+' · ':'')+hero.toUpperCase();let stats=document.createElement('div');stats.className='rank-stats';stats.textContent=`⚔ ${p.kills}  ·  ☠ ${p.deaths}  ·  +${p.reward} 🪙`;info.append(name,heroLabel,stats);card.append(portrait,place,info);podium.append(card)}startMusic()}}else{if(resultsOpen)stopMusic();resultsOpen=false;$('#results').classList.add('hide')}syncMusic()}

function renderShop(){
 let self=players.get(me)?.data;if(!self)return;
 $('#shop-balance').textContent='🪙 '+self.coins;
 let curOutfit=self.look?.outfit||'default',curSkin=self.look?.weaponSkin||'default';
 let signature=[shopTab,self.weapon,curOutfit,curSkin,self.coins,phase,(self.owned||[]).join(','),(self.ownedOutfits||[]).join(','),(self.ownedWeaponSkins||[]).join(',')].join('|');
 let container=$('#items');if(container.dataset.signature===signature)return;
 container.dataset.signature=signature;container.replaceChildren();
 if(shopTab==='weapons'){
  for(let [id,w] of Object.entries(defs)){
   let line=document.createElement('div');line.className='item';
   let txt=document.createElement('div');let title=document.createElement('strong');title.textContent=w.name;let d=document.createElement('div');d.className='small';d.textContent=`Урон ${w.damage} · ${w.price?w.price+' монет':'бесплатно'}`;txt.append(title,d);
   let b=document.createElement('button');let owned=self.owned.includes(id);
   b.textContent=self.weapon===id?'✓ Выбрано':owned?'Выбрать':'Купить';
   b.disabled=self.weapon===id||(!owned&&(phase!=='lobby'||self.coins<w.price));
   b.onclick=()=>send({type:owned?'weapon':'buy',weapon:id});
   line.append(txt,b);container.append(line);
  }
 }else if(shopTab==='outfits'){
  for(let [id,item] of Object.entries(outfitDefs)){
   let line=document.createElement('div');line.className='item';
   let left=document.createElement('div');left.className='item-left';
   let sw=document.createElement('span');sw.className='item-swatch';sw.style.background=outfitPalettes[id]?.swatch||'#354060';
   let txt=document.createElement('div');let title=document.createElement('strong');title.textContent=item.name;let d=document.createElement('div');d.className='small';d.textContent=`${item.desc} · ${item.price?item.price+' монет':'бесплатно'}`;txt.append(title,d);left.append(sw,txt);
   let b=document.createElement('button');let owned=(self.ownedOutfits||['default']).includes(id);let equipped=curOutfit===id;
   b.textContent=equipped?'✓ Надет':owned?'Надеть':`Купить ${item.price} 🪙`;
   b.disabled=equipped||(!owned&&(phase!=='lobby'||self.coins<item.price));
   b.onclick=()=>send({type:'outfit',id});
   line.append(left,b);container.append(line);
  }
 }else{
  for(let [id,item] of Object.entries(weaponSkinDefs)){
   let line=document.createElement('div');line.className='item';
   let left=document.createElement('div');left.className='item-left';
   let sw=document.createElement('span');sw.className='item-swatch';sw.style.background=weaponSkinPalettes[id]?.swatch||'#354060';
   let txt=document.createElement('div');let title=document.createElement('strong');title.textContent=item.name;let d=document.createElement('div');d.className='small';d.textContent=`${item.desc} · ${item.price?item.price+' монет':'бесплатно'}`;txt.append(title,d);left.append(sw,txt);
   let b=document.createElement('button');let owned=(self.ownedWeaponSkins||['default']).includes(id);let equipped=curSkin===id;
   b.textContent=equipped?'✓ Надет':owned?'Надеть':`Купить ${item.price} 🪙`;
   b.disabled=equipped||(!owned&&(phase!=='lobby'||self.coins<item.price));
   b.onclick=()=>send({type:'weapon_skin',id});
   line.append(left,b);container.append(line);
  }
 }
}

function showNotice(t){$('#notice').textContent=t;noticeTimer=2.4;if(audio&&!muted){try{let now=audio.currentTime;if(t.startsWith('ГОЛ!')){tone(now,520,680,.14,.05,'triangle');tone(now+.12,760,980,.20,.055,'sine');haptic('medium')}else if(t.includes('ПОДОБРАЛ МЯЧ'))tone(now,480,780,.13,.035,'sine');else if(t==='МЯЧ ПОТЕРЯН!')tone(now,540,210,.16,.035,'triangle')}catch{}}}function formatTime(ms){let s=Math.ceil(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}

function makeNameSprite(name, teamRole=null){
 let canvas=document.createElement('canvas');canvas.width=512;canvas.height=104;let c=canvas.getContext('2d');
 c.fillStyle=(teamRole==='ally'||teamRole==='survivor')?'rgba(10,36,28,.9)':teamRole==='chaser'?'rgba(42,8,48,.94)':teamRole==='enemy'?'rgba(42,10,20,.9)':'rgba(10,18,35,.88)';
 c.beginPath();c.roundRect(6,8,500,88,20);c.fill();
 c.strokeStyle=(teamRole==='ally'||teamRole==='survivor')?'#4dff9e':teamRole==='chaser'?'#ff44d8':teamRole==='enemy'?'#ff476c':'#6b9eb2';c.lineWidth=teamRole?5:3;c.stroke();
 c.font='bold 42px system-ui, sans-serif';c.textAlign='center';c.textBaseline='middle';
 c.fillStyle=(teamRole==='ally'||teamRole==='survivor')?'#b8ffda':teamRole==='chaser'?'#ffbef3':teamRole==='enemy'?'#ffc2ce':'#f1fbff';
 let label=teamRole==='ally'?'🛡 СВОЙ · '+name:teamRole==='survivor'?'🛡 '+name:teamRole==='chaser'?'👻 ОХОТНИК · '+name:teamRole==='enemy'?'⚔ ВРАГ · '+name:String(name);
 c.fillText(label.slice(0,22),256,52,475);
 let tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 let sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:teamRole!=='chaser'}));sprite.scale.set(teamRole==='chaser'?2.85:2.45,teamRole==='chaser'?.58:.5,1);if(teamRole==='chaser')sprite.renderOrder=990;return sprite;
}
function makeHealthBar(teamRole=null){let canvas=document.createElement('canvas');canvas.width=128;canvas.height=32;let tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;let material=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:teamRole!=='chaser',depthWrite:false});let sprite=new THREE.Sprite(material);sprite.scale.set(teamRole==='chaser'?1.6:1.25,teamRole==='chaser'?.38:.32,1);if(teamRole==='chaser')sprite.renderOrder=990;sprite.userData.canvas=canvas;sprite.userData.teamRole=teamRole;return sprite}
function updateHealthBar(sprite,hp,teamRole=sprite.userData.teamRole,maxHp=100){const canvas=sprite.userData.canvas,ctx=canvas.getContext('2d');ctx.clearRect(0,0,128,32);ctx.fillStyle='rgba(9,12,28,.85)';ctx.fillRect(2,8,124,15);ctx.fillStyle=(teamRole==='ally'||teamRole==='survivor')?'#4dff9e':teamRole==='chaser'?'#ff44d8':teamRole==='enemy'?'#ff476c':(hp>50?'#58ffdd':hp>25?'#ffe36c':'#ff4b8d');ctx.fillRect(5,11,118*Math.max(0,Math.min(1,hp/(maxHp||100))),9);ctx.strokeStyle=(teamRole==='ally'||teamRole==='survivor')?'#8affc0':teamRole==='chaser'?'#ffb3f0':teamRole==='enemy'?'#ff8ca3':'#b3ffff';ctx.lineWidth=2;ctx.strokeRect(2,8,124,15);sprite.material.map.needsUpdate=true}

const wallEffects=[];
function wallSparks(x,y,z,nx,nz){const count=18,pos=new Float32Array(count*3),col=new Float32Array(count*3),vel=[];for(let i=0;i<count;i++){pos[i*3]=x-nx*.28;pos[i*3+1]=y+1.0+(Math.random()-.5)*.45;pos[i*3+2]=z-nz*.28;let cyan=i%2===0;col[i*3]=cyan?.25:1;col[i*3+1]=cyan?1:.25;col[i*3+2]=1;vel.push([nx*(1+Math.random()*2)+(Math.random()-.5)*2,Math.random()*3-.5,nz*(1+Math.random()*2)+(Math.random()-.5)*2])}let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));let points=new THREE.Points(geo,new THREE.PointsMaterial({size:.14,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(points);wallEffects.push({points,vel,life:.38});if(wallEffects.length>12){let old=wallEffects.shift();scene.remove(old.points);old.points.geometry.dispose();old.points.material.dispose()}}
function updateWallSparks(dt){for(let i=wallEffects.length-1;i>=0;i--){let f=wallEffects[i];f.life-=dt;f.points.material.opacity=Math.max(0,f.life/.38);let a=f.points.geometry.attributes.position;for(let j=0;j<f.vel.length;j++){a.array[j*3]+=f.vel[j][0]*dt;a.array[j*3+1]+=f.vel[j][1]*dt;a.array[j*3+2]+=f.vel[j][2]*dt;f.vel[j][1]-=7*dt}a.needsUpdate=true;if(f.life<=0){scene.remove(f.points);f.points.geometry.dispose();f.points.material.dispose();wallEffects.splice(i,1)}}}
const neonTrails=[];let lastTrail=0,wallKick=0,lookDX=0,lookDY=0;
function makeTrail(mesh){if(!mesh||neonTrails.length>=10)return;let mat=new THREE.MeshBasicMaterial({color:Math.random()<.5?0x30f5ef:0xff42dc,transparent:true,opacity:.28,depthWrite:false,blending:THREE.AdditiveBlending});let ghost=new THREE.Group();mesh.updateWorldMatrix(true,true);mesh.traverse(o=>{if(!o.isMesh||!o.geometry)return;let visible=true;for(let p=o;p&&p!==mesh.parent;p=p.parent)if(!p.visible){visible=false;break}if(!visible)return;let part=new THREE.Mesh(o.geometry,mat);o.matrixWorld.decompose(part.position,part.quaternion,part.scale);ghost.add(part)});scene.add(ghost);neonTrails.push({ghost,mat,life:.24})}
function updateTrails(dt){for(let i=neonTrails.length-1;i>=0;i--){let x=neonTrails[i];x.life-=dt;x.mat.opacity=Math.max(0,x.life/.24)*.28;if(x.life<=0){scene.remove(x.ghost);x.mat.dispose();neonTrails.splice(i,1)}}}
const hitEffects=[],damageNumbers=[];
const damageProjection=new THREE.Vector3();
function removeDamageNumber(i){let n=damageNumbers[i];n.element.remove();damageNumbers.splice(i,1)}
function spawnDamageNumber(m){
 if(m.shooter!==me||!Number.isFinite(m.damage)||!Number.isFinite(m.x)||!Number.isFinite(m.y)||!Number.isFinite(m.z))return;
 while(damageNumbers.length>=36)removeDamageNumber(0);
 let element=document.createElement('span');element.className='damage-number'+(m.headshot?' headshot':'');element.textContent=(m.headshot?'✦ ':'')+Math.round(m.damage);$('#damage-layer').appendChild(element);
 let side=(Math.random()-.5)*.75,worldX=m.x+Math.cos(angle)*side,worldZ=m.z+Math.sin(angle)*side;
 damageNumbers.push({element,x:worldX,y:m.y+.38,z:worldZ,born:performance.now(),duration:1000});
}
function updateDamageNumbers(now){
 camera.updateMatrixWorld();
 for(let i=damageNumbers.length-1;i>=0;i--){let n=damageNumbers[i],age=Math.max(0,(now-n.born)/n.duration);if(age>=1||!room||phase!=='match'){removeDamageNumber(i);continue}
  damageProjection.set(n.x,n.y+age*1.15,n.z).project(camera);
  let x=(damageProjection.x*.5+.5)*innerWidth,y=(-damageProjection.y*.5+.5)*innerHeight;
  n.element.style.visibility=damageProjection.z>=-1&&damageProjection.z<=1&&Math.abs(damageProjection.x)<1.2&&Math.abs(damageProjection.y)<1.2?'visible':'hidden';
  n.element.style.opacity=String(1-age);let birth=Math.min(1,age/.14),scale=.65+.35*(1-Math.pow(1-birth,3));
  n.element.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%) scale(${scale})`;
 }
}
function showHit(m){const count=14,pos=new Float32Array(count*3),vel=[];for(let i=0;i<count;i++){pos[i*3]=m.x;pos[i*3+1]=m.y;pos[i*3+2]=m.z;vel.push([(Math.random()-.5)*5,Math.random()*4,(Math.random()-.5)*5])}let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));let material=new THREE.PointsMaterial({color:0x59ffff,size:.18,transparent:true,depthWrite:false});let points=new THREE.Points(geo,material);scene.add(points);hitEffects.push({points,vel,life:.65});spawnDamageNumber(m);if(m.shooter===me){if(m.headshot)showNotice('ПОПАДАНИЕ В ГОЛОВУ!');playHitSound(m.headshot);hitTime=.24;try{window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')}catch{}}}
function updateEffects(dt){for(let i=hitEffects.length-1;i>=0;i--){let fx=hitEffects[i];fx.life-=dt;fx.points.material.opacity=Math.max(0,fx.life/.65);let arr=fx.points.geometry.attributes.position;for(let j=0;j<fx.vel.length;j++){arr.array[j*3]+=fx.vel[j][0]*dt;arr.array[j*3+1]+=fx.vel[j][1]*dt;arr.array[j*3+2]+=fx.vel[j][2]*dt;fx.vel[j][1]-=7*dt}arr.needsUpdate=true;if(fx.life<=0){scene.remove(fx.points);fx.points.geometry.dispose();fx.points.material.dispose();hitEffects.splice(i,1)}}}
const deathEffects=[];
function showDeath(m){let o=players.get(m.target);if(o){if(m.eliminated){if(o.data)o.data.eliminated=true;o.hideUntil=0}else{o.hideUntil=performance.now()+5000;if(o.data)o.data.respawnAt=m.respawnAt||serverNow()+5000}}if(m.target===me){if(m.eliminated){myRespawnUntil=0;wasServerDead=false;if(o?.data)o.data.eliminated=true}else{myRespawnUntil=performance.now()+5000;wasServerDead=true}firing=false;resetJump();moveVX=moveVZ=impulseX=impulseZ=0}const count=55,arr=new Float32Array(count*3),vel=[];for(let i=0;i<count;i++){arr[i*3]=m.x+(Math.random()-.5)*.7;arr[i*3+1]=m.y+Math.random()*1.8;arr[i*3+2]=m.z+(Math.random()-.5)*.7;vel.push([(Math.random()-.5)*1.4,.5+Math.random()*1.5,(Math.random()-.5)*1.4])}let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(arr,3));let canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;let ctx=canvas.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(170,255,255,.9)');g.addColorStop(.3,'rgba(59,220,255,.5)');g.addColorStop(1,'rgba(165,20,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);let tex=new THREE.CanvasTexture(canvas);let material=new THREE.PointsMaterial({map:tex,color:0x84eaff,size:.75,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});let mesh=new THREE.Points(geo,material);scene.add(mesh);deathEffects.push({mesh,vel,life:1})}
function updateDeathEffects(dt){for(let i=deathEffects.length-1;i>=0;i--){let fx=deathEffects[i];fx.life-=dt;fx.mesh.material.opacity=Math.max(0,fx.life);let a=fx.mesh.geometry.attributes.position;for(let j=0;j<fx.vel.length;j++){a.array[j*3]+=fx.vel[j][0]*dt;a.array[j*3+1]+=fx.vel[j][1]*dt;a.array[j*3+2]+=fx.vel[j][2]*dt}a.needsUpdate=true;if(fx.life<=0){scene.remove(fx.mesh);fx.mesh.geometry.dispose();fx.mesh.material.map.dispose();fx.mesh.material.dispose();deathEffects.splice(i,1)}}}
let shotNoiseBuffer=null,audioMaster=null,muted=false;
function haptic(style){if(muted)return;try{window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style)}catch{}}
function initAudio(){try{if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();audioMaster=audio.createGain();audioMaster.gain.value=muted?0:.65;audioMaster.connect(audio.destination)}if(audio.state==='suspended')audio.resume().catch(()=>{});syncMusic()}catch{}}
window.addEventListener('pointerdown',initAudio,{once:true});window.addEventListener('keydown',initAudio,{once:true});
function toggleSound(){muted=!muted;if(audioMaster)audioMaster.gain.setTargetAtTime(muted?0:.65,audio.currentTime,.01);for(let btn of [$('#sound'),$('#sound-menu')]){btn.textContent=muted?'🔇':'🔊';btn.setAttribute('aria-label',muted?'Включить звук':'Выключить звук')}}$('#sound').onclick=toggleSound;$('#sound-menu').onclick=toggleSound;
document.addEventListener('pointerdown',e=>{let b=e.target.closest('button');if(!b||b.disabled||['fire','jump','dash','sound','sound-menu'].includes(b.id))return;haptic('light');if(audio&&!muted)try{tone(audio.currentTime,570,760,.055,.018,'sine')}catch{}},{passive:true});
function noiseBuffer(){if(!shotNoiseBuffer){shotNoiseBuffer=audio.createBuffer(1,Math.floor(audio.sampleRate*.3),audio.sampleRate);let data=shotNoiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1}return shotNoiseBuffer}
function soundNoise(now,duration,frequency,volume,type='bandpass',destination=audioMaster){let src=audio.createBufferSource();src.buffer=noiseBuffer();let filter=audio.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;let gain=audio.createGain();gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);src.connect(filter).connect(gain).connect(destination);src.start(now);src.stop(now+duration)}
function tone(now,freq,end,duration,volume,type='sine',destination=audioMaster){let osc=audio.createOscillator(),g=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,now);osc.frequency.exponentialRampToValueAtTime(end,now+duration);g.gain.setValueAtTime(volume,now);g.gain.exponentialRampToValueAtTime(.0001,now+duration);osc.connect(g).connect(destination);osc.start(now);osc.stop(now+duration)}
function playShot(id){if(!audio||muted)return;try{let now=audio.currentTime,roomy=phase==='lobby';soundNoise(now,.035,3900,.11,'highpass');tone(now,175,44,.14,.28);soundNoise(now,.13,id==='minigun'?1800:2500,.13,'lowpass');let echoes=roomy?[.09,.17,.27,.40]:[.12];for(let i=0;i<echoes.length;i++){let delay=echoes[i];soundNoise(now+delay,roomy?.11:.065,roomy?900:1500,(roomy?.047:.014)*Math.pow(.64,i),'lowpass')}}catch{}}
function playHitSound(headshot){if(!audio||muted)return;try{let t=audio.currentTime;if(headshot){soundNoise(t,.075,1350,.075,'bandpass');tone(t,850,390,.10,.075,'triangle');tone(t+.025,390,180,.075,.04,'sine')}else{tone(t,1450,900,.12,.085,'sine');tone(t,2450,1800,.075,.04,'sine')}}catch{}}
function playWallWhoosh(){if(!audio||muted)return;try{let t=audio.currentTime;soundNoise(t,.16,2100,.045,'bandpass');tone(t,500,160,.13,.022,'sine')}catch{}}
function playJumpSound(){if(!audio||muted)return;try{tone(audio.currentTime,200,340,.09,.025,'sine')}catch{}}
function playCoinSound(){if(!audio||muted)return;try{let t=audio.currentTime;tone(t,820,980,.075,.035,'sine');tone(t+.065,1200,1450,.11,.03,'sine')}catch{}}
function trace(m){let from=new THREE.Vector3(m.x,m.y||1.7,m.z);let cp=Math.cos(m.pitch||0);let to=from.clone().add(new THREE.Vector3(Math.sin(m.angle)*cp*m.range,Math.sin(m.pitch||0)*m.range,-Math.cos(m.angle)*cp*m.range));let skin=m.weaponSkin&&m.weaponSkin!=='default'?weaponSkinPalettes[m.weaponSkin]:null;let color=skin?skin.tracer:(m.weapon==='shotgun'?0xff6ddc:0x69faff);let line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([from,to]),new THREE.LineBasicMaterial({color}));scene.add(line);setTimeout(()=>{scene.remove(line);line.geometry.dispose();line.material.dispose()},130)}

const musicFiles={menu:'menu',shop:'menu',lobby:'lobby',match:'battle',results:'victory'};
let activeMusic=null,musicWanted='',musicToken=0;
function musicView(){if(!room)return 'menu';if(phase==='results')return 'results';if(!$('#shop').classList.contains('hide'))return 'shop';return phase==='match'?'match':'lobby'}
function stopMusic(){musicToken++;musicWanted='';if(activeMusic){let {source,gain}=activeMusic;activeMusic=null;let t=audio.currentTime;gain.gain.cancelScheduledValues(t);gain.gain.setValueAtTime(gain.gain.value,t);gain.gain.linearRampToValueAtTime(0,t+.55);try{source.stop(t+.6)}catch{}}}
async function syncMusic(){if(!audio)return;let key=musicFiles[musicView()];if(key===musicWanted)return;stopMusic();musicWanted=key;let token=++musicToken;try{let response=await fetch('/assets/audio/'+key+'.mp3');if(!response.ok)throw new Error('HTTP '+response.status);let data=await response.arrayBuffer();if(token!==musicToken)return;let buffer=await audio.decodeAudioData(data);if(token!==musicToken)return;let source=audio.createBufferSource(),gain=audio.createGain(),t=audio.currentTime;source.buffer=buffer;source.loop=true;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.30,t+.7);source.connect(gain).connect(audioMaster);activeMusic={source,gain,key};source.onended=()=>{source.disconnect();gain.disconnect()};source.start(t)}catch(e){if(token===musicToken){musicWanted='';console.warn('Музыка недоступна:',key,e)}}}
function startMusic(){syncMusic()}

function playChaserIntroSound(isMe){
 if(!audio||muted)return;
 try{
  let now=audio.currentTime;
  if(isMe){
   tone(now,110,55,.75,.14,'sawtooth');
   tone(now+.08,220,165,.55,.10,'triangle');
   tone(now+.28,330,196,.65,.08,'sine');
   soundNoise(now,.45,650,.06,'bandpass');
  }else{
   tone(now,293,146,.45,.08,'triangle');
   tone(now+.14,440,220,.45,.06,'sine');
  }
 }catch{}
}
function triggerChaserBanner(m){
 let b=$('#chaser-banner'),title=$('#chaser-banner-title'),sub=$('#chaser-banner-sub');
 chaserBannerMe=!!m.isMe;
 b.classList.toggle('survivor-mode',!m.isMe);
 if(m.isMe){
  title.textContent='YOU ARE A CHASER';
  sub.textContent='У вас 400 HP · Поймайте всех выживших!';
  haptic('heavy');
  try{
   if('speechSynthesis' in window&&!muted){
    window.speechSynthesis.cancel();
    let u=new SpeechSynthesisUtterance('You are a chaser');
    u.lang='en-US';u.pitch=.72;u.rate=.88;u.volume=.95;
    window.speechSynthesis.speak(u);
   }
  }catch{}
 }else{
  title.textContent='ОХОТНИК: '+String(m.chaserName||'CHASER').toUpperCase();
  sub.textContent='Спасайтесь в саду и домиках · Победите духа командой!';
  haptic('medium');
 }
 chaserBannerUntil=performance.now()+4800;
 initAudio();playChaserIntroSound(m.isMe);
}

function aimedAtAlly(){
 if((roomMode!=='neoball'&&roomMode!=='chaser')||phase!=='match')return false;
 let self=players.get(me);if(!self||!self.data?.team)return false;
 if(roomMode==='chaser'&&self.data.team==='chaser')return false;
 let cp=Math.cos(pitch),dx=Math.sin(angle)*cp,dy=Math.sin(pitch),dz=-Math.cos(angle)*cp;
 let maxR=defs[self.data.weapon]?.range||30;
 let bestD=shotWallDistance(worldPhase(),self.x,jumpY+1.7,self.z,dx,dy,dz,maxR),bestAlly=false;
 for(let [id,o] of players){
  if(id===me||o.data?.respawnAt||o.data?.eliminated)continue;
  let px=o.mesh.position.x,py=o.mesh.position.y,pz=o.mesh.position.z;
  for(const part of [{h:1.62,r:.42},{h:.95,r:.72}]){
   let rx=px-self.x,ry=py+part.h-(jumpY+1.7),rz=pz-self.z,along=rx*dx+ry*dy+rz*dz,side2=rx*rx+ry*ry+rz*rz-along*along;
   if(along<=0||side2>part.r*part.r)continue;
   let entry=along-Math.sqrt(Math.max(0,part.r*part.r-side2));
   if(entry>0&&entry<bestD){bestD=entry;bestAlly=(o.data.team===self.data.team)}
  }
 }
 return bestAlly;
}

function cycleSpectator(){
 let alive=[...players.entries()].filter(([id,o])=>id!==me&&!o.data?.eliminated&&!o.data?.respawnAt).map(([id])=>id);
 if(!alive.length){spectateId=null;return null}
 let idx=alive.indexOf(spectateId);
 spectateId=alive[(idx+1)%alive.length];
 return spectateId;
}
$('#spectator-next').onclick=()=>cycleSpectator();

function helmAction(){
 if(!room||phase!=='lobby')return;
 let p=players.get(me);if(!p)return;
 let hx=0,hz=roomMode==='hub'?11.78:6.2;
 if(isSeated)send({type:'hyperdrive'});
 else if(Math.hypot(p.x-hx,p.z-hz)<2.8)send({type:'sit',seated:true});
}
$('#btn-sit').onclick=()=>{initAudio();send({type:'sit',seated:true})};
$('#btn-hyper').onclick=()=>{initAudio();send({type:'hyperdrive'})};
$('#btn-stand').onclick=()=>send({type:'sit',seated:false});
window.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space'){e.preventDefault();if(!e.repeat){if(isSeated)send({type:'sit',seated:false});else jump()}}if(e.code==='ShiftLeft'&&!e.repeat)dash();if(e.code==='KeyE'&&!e.repeat){initAudio();helmAction()}if(e.code==='KeyF'&&!e.repeat){initAudio();fireOnce(performance.now())}});window.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='Space')releaseJump()});window.addEventListener('blur',()=>{keys={};releaseJump();jumpPointer=null});const lookpad=$('#lookpad');let lookPointer=null,lookX=0,lookY=0;lookpad.addEventListener('pointerdown',e=>{if(!room||lookPointer!==null)return;e.preventDefault();lookPointer=e.pointerId;lookX=e.clientX;lookY=e.clientY;lookpad.setPointerCapture(e.pointerId)});lookpad.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer)return;e.preventDefault();lookDX+=(e.clientX-lookX)*.005;lookDY+=(e.clientY-lookY)*.0045;lookX=e.clientX;lookY=e.clientY});lookpad.addEventListener('pointerup',e=>{if(e.pointerId===lookPointer)lookPointer=null});lookpad.addEventListener('pointercancel',e=>{if(e.pointerId===lookPointer)lookPointer=null});lookpad.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});renderer.domElement.addEventListener('wheel',e=>{zoom=e.deltaY<0});let pad=$('#joy'),stick=$('#stick');function updateJoy(e){let r=pad.getBoundingClientRect(),dx=(e.clientX-r.left-r.width/2)/(r.width/2),dy=(e.clientY-r.top-r.height/2)/(r.height/2),d=Math.max(1,Math.hypot(dx,dy));joy={x:dx/d,y:dy/d};stick.style.transform=`translate(calc(-50% + ${joy.x*30}px),calc(-50% + ${joy.y*30}px))`}pad.onpointerdown=e=>{pad.setPointerCapture(e.pointerId);updateJoy(e)};pad.onpointermove=e=>{if(pad.hasPointerCapture(e.pointerId))updateJoy(e)};pad.onpointerup=pad.onpointercancel=()=>{joy={x:0,y:0};stick.style.transform='translate(-50%,-50%)'};$('#fire').onpointerdown=e=>{e.preventDefault();firing=true;$('#fire').setPointerCapture(e.pointerId);initAudio();fireOnce(performance.now())};$('#fire').onpointerup=$('#fire').onpointercancel=()=>{firing=false};$('#zoom').onclick=()=>zoom=!zoom;$('#jump').onpointerdown=e=>{if(jumpPointer!==null)return;e.preventDefault();jumpPointer=e.pointerId;$('#jump').setPointerCapture(e.pointerId);jump()};$('#jump').onpointerup=$('#jump').onpointercancel=e=>{if(e.pointerId!==jumpPointer)return;jumpPointer=null;releaseJump()};$('#jump').onlostpointercapture=e=>{if(e.pointerId===jumpPointer){jumpPointer=null;releaseJump()}};$('#dash').onpointerdown=e=>{e.preventDefault();dash()};

function isMyDead(t=performance.now()){let p=players.get(me);return !!(p&&phase==='match'&&(p.data?.respawnAt||p.data?.eliminated||myRespawnUntil>t))}
function fireOnce(t){
 let p=players.get(me),w=p&&defs[p.data.weapon];if(!p||!w||phase!=='match'||isMyDead(t))return;
 if(aimedAtAlly()){if(t-lastFire>350){lastFire=t;showNotice('НЕЛЬЗЯ СТРЕЛЯТЬ ПО СВОЕЙ КОМАНДЕ!')}return}
 let overclock=p.data.weapon==='smg'&&currentSlide,rate=overclock?w.rate*.75:w.rate;if(t-lastFire<rate)return;send({type:'shoot',angle,pitch:Math.max(-1.1,Math.min(1.1,pitch+cameraPunch))});lastFire=t;
 if(!overclock){let power=p.data.weapon==='shotgun'?1.5:1;recoil=Math.min(.35,recoil+.14*power);cameraPunch=Math.min(.08,cameraPunch+.024*power);cameraBack=Math.min(.10,cameraBack+.035*power)}else{recoil=0;cameraPunch=0;cameraBack=0}
 if(p.data.weapon==='shotgun'&&groundHeight(p.x,p.z,jumpY,worldPhase())===null){let dx=Math.sin(angle),dz=-Math.cos(angle);impulseX-=dx*2.5;impulseZ-=dz*2.5;if(flipTime>0&&dx*lastWallNormal.x+dz*lastWallNormal.z>.25){impulseX+=lastWallNormal.x*4.5;impulseZ+=lastWallNormal.z*4.5}}
 muzzlePending=true;shotVisuals(t);playShot(p.data.weapon);haptic('medium')
}
function dash(){if(!room||phase==='results'||phase==='ending'||isMyDead()||performance.now()-lastDash<2200)return;lastDash=performance.now();let x=joy.x+(keys.KeyD?1:0)-(keys.KeyA?1:0),y=joy.y+(keys.KeyS?1:0)-(keys.KeyW?1:0);let d=Math.hypot(x,y);if(d<.15){x=0;y=-1;d=1}x/=d;y/=d;impulseX+=(Math.cos(angle)*x-Math.sin(angle)*y)*11;impulseZ+=(Math.sin(angle)*x+Math.cos(angle)*y)*11;showNotice('РЫВОК!')}function startGroundJump(){playJumpSound();haptic('light');jumpV=9;flipTime=0;landing=-.09;if(!jumpWindow.held)jumpV*=.4}
function releaseJump(){if(jumpWindow.held&&jumpV>0)jumpV*=.4;jumpWindow.release()}
function jump(){let p=players.get(me);if(!p||phase==='results'||phase==='ending'||isMyDead())return;let now=performance.now();jumpWindow.press(now);jumpWindow.ground(now,groundHeight(p.x,p.z,jumpY,worldPhase())!==null&&jumpV<=0);if(jumpWindow.take(now)){startGroundJump();return}let wall=wallContact(p.x,p.z,worldPhase(),jumpY);if(groundHeight(p.x,p.z,jumpY,worldPhase())===null&&now-lastWall>160&&wallLock.canKick(wall)){jumpWindow.discard();wallLock.kicked(wall);jumpV=10.5;lastWallNormal={x:wall.x,z:wall.z};impulseX=wall.x*13;impulseZ=wall.z*13;moveVX=wall.x*3;moveVZ=wall.z*3;wallCarry=1.2;flipTime=.7;wallKick=1;camera.fov=Math.min(100,camera.fov+7);camera.updateProjectionMatrix();lastWall=now;wallSparks(p.x,jumpY,p.z,wall.x,wall.z);send({type:'wallbounce',epoch:roomEpoch,spawnRev:p.data.spawnRev||0});haptic('medium');playWallWhoosh();showNotice('САЛЬТО ОТ СТЕНЫ!')}}
let bobBlend=0,gunSwayX=0,gunSwayY=0;
let last=performance.now();
let lastPreviewFrame=0;
function frame(t){
 requestAnimationFrame(frame);if(!room&&previewRenderer&&previewFigure&&t-lastPreviewFrame>65){lastPreviewFrame=t;previewFigure.rotation.y=Math.sin(t*.0006)*.38;previewRenderer.render(previewScene,previewCamera)}let dt=Math.min(.05,(t-last)/1000);last=t;
 if(phase==='ending'&&endingAt){let digit=Math.max(1,Math.min(3,Math.ceil((endingAt-Date.now())/1000)));if(digit!==endingDigit){endingDigit=digit;let el=$('#end-number');el.textContent=digit;el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse')}}
 let capture=phase==='match'&&roomMode==='neoball'&&neoSnapshot?.capture;let mine=capture&&capture.playerId===me;let captureUI=$('#capture-progress');captureUI.style.display=mine?'grid':'none';if(mine){let frac=Math.max(0,Math.min(1,(Date.now()-capture.startedAt)/capture.duration));$('#capture-fill').style.strokeDashoffset=String(226.2*(1-frac));$('#capture-seconds').textContent=String(Math.max(1,Math.ceil((capture.duration-(Date.now()-capture.startedAt))/1000)))}
 if(noticeTimer>0){noticeTimer-=dt;if(noticeTimer<=0)$('#notice').textContent=''}
 animateSpace(t);if(ductWorld.visible){ductPink.emissiveIntensity=.65+.12*Math.sin(t*.002);ductTeal.emissiveIntensity=.65+.12*Math.sin(t*.002+1.5)}if(gardenWorld.visible){let fArr=fireflyGeo.attributes.position.array;for(let i=0;i<fireflyCount;i++){let fd=fireflyData[i];fArr[i*3]=fd.bx+Math.sin(t*.0012*fd.sp+fd.ph)*.65;fArr[i*3+1]=fd.by+Math.sin(t*.0018*fd.sp+fd.ph)*.38;fArr[i*3+2]=fd.bz+Math.cos(t*.0011*fd.sp+fd.ph)*.65}fireflyGeo.attributes.position.needsUpdate=true}
 $('#chaser-banner').classList.toggle('hide',!(room&&phase==='match'&&t<chaserBannerUntil));
 if(room&&phase==='match'&&matchEndsAt){
  if(roomMode==='neoball'&&neoSnapshot){
   let n=neoSnapshot,rem=formatTime(Math.max(0,matchEndsAt-serverNow()));
   $('#neo-score').innerHTML=`🔵 A ${n.scores.A} — ${n.scores.B} B 🩷  ·  ${rem}<div style="font-size:9px;letter-spacing:2px;color:#a9d9e8">${'●'.repeat(n.scores.A)}${'○'.repeat(5-n.scores.A)} &nbsp; · &nbsp; ${'●'.repeat(n.scores.B)}${'○'.repeat(5-n.scores.B)}</div>`;
  }else{
   $('#timer').textContent=formatTime(Math.max(0,matchEndsAt-serverNow()));
  }
 }
 updateEffects(dt);updateDeathEffects(dt);updateShotEffects(dt);updateWallSparks(dt);updateTrails(dt);wallKick=Math.max(0,wallKick-dt*3.4);
 let hyperPower=0;
 if(hyperActive&&phase==='lobby'){
  let f=Math.max(0,Math.min(1,(t-hyperStart)/hyperDuration));
  hyperPower=f<.16?f/.16:f>.78?(1-f)/.22:1;
 }
 $('#speedtrail').style.opacity=Math.max(wallKick*.65,hyperPower*.58);let lookStep=1-Math.exp(-24*dt);let lookTurn=lookDX*lookStep,lookTilt=lookDY*lookStep;angle+=lookTurn;pitch=Math.max(-1.1,Math.min(1.1,pitch-lookTilt));let lookSwayFactor=1-Math.exp(-9*dt);gunSwayX+=(Math.max(-.09,Math.min(.09,-lookTurn/(dt||.016)*.025))-gunSwayX)*lookSwayFactor;gunSwayY+=(Math.max(-.07,Math.min(.07,lookTilt/(dt||.016)*.022))-gunSwayY)*lookSwayFactor;lookDX*=1-lookStep;lookDY*=1-lookStep;hitTime=Math.max(0,hitTime-dt);$('#hitmarker').style.opacity=hitTime>0?'1':'0';$('#dash').classList.toggle('cool',t-lastDash<2200);
 let p=players.get(me);
 let spectating=!!(room&&p&&roomMode==='chaser'&&phase==='match'&&p.data?.eliminated);
 let dead=isMyDead(t);
 let respOv=$('#respawn-overlay');
 if(dead&&!spectating){
  let remMs=myRespawnUntil>t?myRespawnUntil-t:Math.max(0,(p?.data?.respawnAt||0)-serverNow());
  remMs=Math.max(0,Math.min(5000,remMs));
  respOv.classList.remove('hide');
  $('#respawn-seconds').textContent=String(Math.max(1,Math.ceil(remMs/1000)));
  $('#respawn-bar-fill').style.width=(remMs/50)+'%';
 }else{
  respOv.classList.add('hide');
 }
 let shield=p&&phase==='match'&&!dead?Math.max(0,Math.ceil(((p.data.invulnerableUntil||0)-serverNow())/1000)):0;$('#protection').textContent=shield?'🛡 '+shield+'с · ДО ВЫСТРЕЛА':'';
 viewGun.visible=!!(room&&p&&phase!=='results'&&!dead&&!isSeated&&!spectating);
 $('#cross').style.display=(dead||isSeated||spectating)?'none':'';
 $('#joy').style.display=spectating?'none':'';
 $('#actions').style.display=spectating?'none':'';
 let specTarget=null;
 if(spectating){
  let candidate=players.get(spectateId);
  if(!candidate||spectateId===me||candidate.data?.eliminated||candidate.data?.respawnAt)cycleSpectator();
  specTarget=players.get(spectateId)||null;
  $('#spectator-hud').classList.remove('hide');
  $('#spectator-target').textContent=specTarget?`${specTarget.data?.team==='chaser'?'👻 ':''}${specTarget.data?.name||'Игрок'} (${specTarget.data?.hp||0} HP)`:'Ожидание завершения...';
 }else{
  $('#spectator-hud').classList.add('hide');
 }
 let helmControls=$('#helm-controls');
 if(room&&p&&phase==='lobby'&&!dead&&roomMode!=='voting'){
  let hx=0,hz=roomMode==='hub'?11.78:6.2;
  let nearHelm=Math.hypot(p.x-hx,p.z-hz)<2.8;
  helmControls.classList.toggle('hide',!(isSeated||nearHelm));
  $('#btn-sit').style.display=(!isSeated&&nearHelm)?'':'none';
  $('#btn-hyper').style.display=isSeated?'':'none';
  $('#btn-stand').style.display=isSeated?'':'none';
 }else{
  helmControls.classList.add('hide');
 }
 if(room&&p){
  let x=joy.x+(keys.KeyD?1:0)-(keys.KeyA?1:0),y=joy.y+(keys.KeyS?1:0)-(keys.KeyW?1:0);let d=Math.hypot(x,y);if(d>1){x/=d;y/=d}
  if(isSeated&&d>.45){send({type:'sit',seated:false});isSeated=false}
  if(!dead&&!isSeated&&phase!=='results'&&phase!=='ending'&&!(phase==='lobby'&&roomMode==='voting')){
   let grounded=groundHeight(p.x,p.z,jumpY,worldPhase())!==null&&jumpV<=0;jumpWindow.ground(t,grounded);
   if(grounded)wallLock.land();if(worldPhase()==='neoball'&&grounded&&t-lastNeoBounce>1200&&[[-10,-20],[10,20]].some(([bx,bz])=>Math.hypot(p.x-bx,p.z-bz)<1.05)){jumpV=10.8;jumpY=.04;grounded=false;lastNeoBounce=t;playJumpSound();haptic('light')}if(jumpWindow.take(t)){startGroundJump();grounded=false}
   let contact=wallContact(p.x,p.z,worldPhase(),jumpY),inputX=Math.cos(angle)*x-Math.sin(angle)*y,inputZ=Math.sin(angle)*x+Math.cos(angle)*y,isSliding=false;
   if(!grounded||jumpV>0){let oldV=jumpV,oldY=jumpY;jumpV-=22*(jumpV>0?1:2.3)*dt;let beforeSlide=jumpV;jumpV=wallSlideVelocity(jumpV,contact,inputX,inputZ);isSliding=!!(contact&&beforeSlide<-.3&&jumpV===-.3);if(isSliding&&t-lastWallSlideFx>350){lastWallSlideFx=t;wallSparks(p.x,jumpY,p.z,contact.x,contact.z)}let nextY=jumpY+jumpV*dt,land=jumpV<0?landingHeight(p.x,p.z,oldY,nextY,worldPhase()):null;jumpY=land===null?Math.max(0,nextY):land;if((worldPhase()==='duct'||worldPhase()==='station'||worldPhase()==='neoball'||worldPhase()==='garden')&&jumpY>7.8){jumpY=7.8;jumpV=Math.min(0,jumpV)}
    if(land!==null&&jumpV<0){landing=Math.min(.17,Math.abs(oldV)*.014);jumpV=0;grounded=true;wallLock.land();jumpWindow.ground(t,true);if(jumpWindow.take(t)){startGroundJump();grounded=false}}}
   currentSlide=isSliding;let weapon=p.data.weapon;$('#hint').dataset.overclock=weapon==='smg'&&isSliding?'1':'0';$('#cross').style.setProperty('--spread',weapon==='shotgun'?(grounded?'2.0':'2.7'):(isSliding?'1':grounded?'1.15':'1.25'));

   flipTime=Math.max(0,flipTime-dt);
   let targetVX=(Math.cos(angle)*x-Math.sin(angle)*y)*7.2,targetVZ=(Math.sin(angle)*x+Math.cos(angle)*y)*7.2;
   let response=1-Math.exp(-(jumpY>0?9:22)*dt);moveVX+=(targetVX-moveVX)*response;moveVZ+=(targetVZ-moveVZ)*response;
   let next=constrainPosition(p.x+(moveVX+impulseX)*dt,p.z+(moveVZ+impulseZ)*dt,worldPhase(),jumpY);p.x=next.x;p.z=next.z;
   wallCarry=Math.max(0,wallCarry-dt);let impulseDamping=wallCarry>0?1.7:3;impulseX*=Math.exp(-impulseDamping*dt);impulseZ*=Math.exp(-impulseDamping*dt);
   if(t-lastSend>50){send({type:'move',x:p.x,z:p.z,y:jumpY,flip:flipTime/.7,angle,slide:isSliding,ix:inputX,iz:inputZ,epoch:roomEpoch,spawnRev:p.data.spawnRev||0,seq:++moveSeq});lastSend=t}
   if(firing||keys.KeyF)fireOnce(t)
  }
  if(isSeated&&t-lastSend>80){send({type:'move',x:p.x,z:p.z,y:0,flip:0,angle,slide:false,ix:0,iz:0,epoch:roomEpoch,spawnRev:p.data.spawnRev||0,seq:++moveSeq});lastSend=t}
  if(!dead&&!isSeated&&phase!=='results'&&Math.hypot(x,y)<.01&&Math.hypot(moveVX,moveVZ)<.12&&p.ackSeq>=moveSeq-1&&Number.isFinite(p.authX)){let diff=Math.hypot(p.authX-p.x,p.authZ-p.z);if(diff>.35){let k=Math.min(1,dt*2);p.x+=(p.authX-p.x)*k;p.z+=(p.authZ-p.z)*k}}
  let speed=Math.hypot(moveVX,moveVZ);let bobTarget=jumpY<.04&&phase!=='results'&&!dead&&!isSeated?Math.min(1,speed/7.2):0;bobBlend+=(bobTarget-bobBlend)*(1-Math.exp(-7*dt));if(jumpY<.04&&!dead&&!isSeated)walkCycle+=dt*speed*1.8;
  landing*=Math.exp(-11*dt);recoil*=Math.exp(-11*dt);cameraPunch*=Math.exp(-12*dt);cameraBack*=Math.exp(-14*dt);
  for(let [id,o] of players){
   let seated=phase==='lobby'&&!!o.data?.seated;
   let yPos=seated?.36:(id===me?jumpY:(o.data.y||0));let beforeX=o.mesh.position.x,beforeZ=o.mesh.position.z;
   let ghostHover=o.mesh.userData.isGhost?(.16+Math.sin(t*.005)*.12):0;
   o.mesh.position.lerp(new THREE.Vector3(o.x,yPos+ghostHover,o.z),Math.min(1,dt*15));
   if(o.mesh.userData.wisps)o.mesh.userData.wisps.rotation.y=t*.0025;
   let anim=o.mesh.userData,vy=id===me?jumpV:(yPos-(anim.prevJumpY??yPos))/Math.max(dt,.001);let landed=(anim.prevJumpY??0)>.06&&yPos<=.06;if(landed)anim.squash=1;anim.squash=Math.max(0,(anim.squash||0)-dt*5);let stretch=yPos>.04&&vy>.7?Math.min(.16,vy*.022):0;let squash=anim.squash*.22;let sy=1+stretch-squash,sx=1-stretch*.36+squash*.55;o.mesh.scale.set(sx,sy,sx);anim.prevJumpY=yPos;
   o.mesh.rotation.y=id===me?angle:(o.data.angle||0);let f=id===me?flipTime/.7:(o.data.flip||0);o.mesh.rotation.x=f>0?(1-f)*Math.PI*2:0;
   let otherDead=!!o.data?.respawnAt||!!o.data?.eliminated||(o.hideUntil&&t<o.hideUntil);
   if(o.nameSprite){o.nameSprite.visible=(phase==='lobby'||(roomMode==='neoball'&&phase==='match')||(roomMode==='chaser'&&phase==='match'))&&!otherDead&&!(spectating&&id===spectateId);o.nameSprite.position.set(o.mesh.position.x,o.mesh.position.y+2.95,o.mesh.position.z)}
   if(o.healthSprite){o.healthSprite.visible=phase==='match'&&!otherDead&&!(spectating&&id===spectateId);o.healthSprite.position.set(o.mesh.position.x,o.mesh.position.y+2.60,o.mesh.position.z)}
   o.mesh.visible=(id!==me||phase==='results')&&!otherDead&&!(spectating&&id===spectateId);
   let moving=!seated&&Math.hypot(o.mesh.position.x-beforeX,o.mesh.position.z-beforeZ)>dt*.3;
   if(id!==me&&!otherDead&&f>0&&t-(o.mesh.userData.lastTrail||0)>85){o.mesh.userData.lastTrail=t;makeTrail(o.mesh)}let swing=seated?0:(yPos>.08?-.35:moving?Math.sin(t*.012)*.7:0);
   if(o.mesh.userData.kit){let k=o.mesh.userData.kit,j=k.userData.joints;k.rotation.z=moving?Math.sin(t*.012)*.04:0;k.position.y=yPos>.08?.04:moving?Math.abs(Math.sin(t*.012))*.04:0;if(j){j.leftLeg.rotation.x=seated?-1.25:-swing*.65;j.rightLeg.rotation.x=seated?-1.25:swing*.65;j.leftArm.rotation.x=seated?-.65:swing*.40;j.rightArm.rotation.x=seated?-.65:-swing*.25;j.head.rotation.z=moving?Math.sin(t*.008)*.025:0}}o.mesh.userData.legs.forEach((leg,i)=>{leg.rotation.x=seated?-1.25:(i?swing:-swing)});o.mesh.userData.arms.forEach((arm,i)=>{arm.rotation.x=seated?-.65:(i?-swing*.5:swing*.5)});
  }
  let allyAim=!dead&&aimedAtAlly();
  $('#cross').classList.toggle('ally',allyAim);
  $('#ally-aim').classList.toggle('hide',!allyAim);

  if(spectating&&specTarget){
   let tx=specTarget.mesh.position.x,ty=(specTarget.data?.y||0)+1.70,tz=specTarget.mesh.position.z,ta=specTarget.data?.angle||0;
   camera.position.set(tx,ty,tz);
   camera.lookAt(tx+Math.sin(ta),ty,tz-Math.cos(ta));
   camera.fov+=(72-camera.fov)*Math.min(1,dt*10);camera.updateProjectionMatrix();
  }else{
   const bobY=Math.sin(walkCycle*2)*.022*bobBlend,bobX=Math.sin(walkCycle)*.024*bobBlend;
   const camY=isSeated?1.88:(dead?1.15:1.70)+jumpY+bobY-landing;
   camera.position.set(p.x,camY,p.z);
   const cp=Math.cos(pitch);camera.lookAt(p.x+Math.sin(angle)*cp,camera.position.y+Math.sin(pitch),p.z-Math.cos(angle)*cp);camera.rotation.x+=cameraPunch;camera.translateX(bobX);camera.translateZ(cameraBack);
   if(wallKick>0){camera.translateX(Math.sin(t*.065)*wallKick*.035);camera.translateY(Math.cos(t*.055)*wallKick*.025)}
   if(hyperPower>0){
    let shake=.048*hyperPower;
    camera.translateX((Math.sin(t*.091)+Math.cos(t*.137))*shake*.5);
    camera.translateY((Math.cos(t*.083)+Math.sin(t*.121))*shake*.5);
    camera.rotation.z+=Math.sin(t*.075)*.012*hyperPower;
   }
   let targetFov=(zoom?37:70)+wallKick*10+hyperPower*17;camera.fov+=(targetFov-camera.fov)*Math.min(1,dt*12);camera.updateProjectionMatrix();
   viewGun.scale.setScalar(.68);viewGun.position.set((zoom?.14:.27)+gunSwayX+bobX*.4,-.24+gunSwayY+bobY*.45+landing*.4,-.8+recoil);viewGun.rotation.set(-recoil*1.2-gunSwayY*.35,recoil*.18-gunSwayX*.5,bobX*.55+recoil*.13);
  }
 }else{
  $('#cross').classList.remove('ally');$('#ally-aim').classList.add('hide');
  camera.fov=55;camera.updateProjectionMatrix();camera.position.set(Math.sin(t*.00015)*35,18,Math.cos(t*.00015)*35);camera.lookAt(0,0,0);
 }
 if(neoSnapshot&&roomMode==='neoball'&&phase==='match'){
  let ball=neoSnapshot.ball,holder=players.get(ball.holder);
  fumbi.visible=!ball.holder&&ball.status!=='reset';
  if(fumbi.visible){fumbi.position.set(ball.x,ball.y+.65+Math.sin(t*.004)*.08,ball.z);fumbi.rotation.y=t*.001}
  $('#neo-ball-badge').style.display=(ball.holder===me)?'flex':'none';
  if(holder&&ball.holder!==me){
   carrierMark.visible=true;
   let scPulse=1.1+.16*Math.sin(t*.008);
   carrierMark.scale.set(scPulse,scPulse,1);
   carrierMark.position.set(holder.mesh.position.x,(holder.data.y||0)+3.35,holder.mesh.position.z);
  }else{
   carrierMark.visible=false;
  }
  drawNeoMapLive(t);
 }else{
  fumbi.visible=false;carrierMark.visible=false;$('#neo-ball-badge').style.display='none';
 }
 drawClassicMapLive(t);
 updateDamageNumbers(t);let firedFrame=muzzlePending;muzzlePending=false;muzzleLight.intensity=firedFrame?18:0;$('#muzzleflash').style.opacity=firedFrame?'1':'0';composer.render();muzzleLight.intensity=0;
}
requestAnimationFrame(frame);window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)});
