import * as THREE from 'three';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const SUPABASE_URL='https://damzsqtlbnfsqmqsezlt.supabase.co';
const SUPABASE_KEY='sb_publishable_HCMgJ__io6RHvOveihSTeQ_dtyVc9OX';
const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=(s)=>document.querySelector(s);
const state={session:null,classes:[],characters:[],gender:'male',selected:null,game:null,questKills:0};
const screens=['launcher','creator','gameScreen'];
function show(id){screens.forEach(x=>$('#'+x).classList.toggle('hidden',x!==id));}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2300);}

async function init(){
  const {data:{session}}=await db.auth.getSession(); state.session=session;
  if(!session){$('#accountState').textContent='NON AUTENTICATO';$('#loginGate').classList.remove('hidden');return;}
  $('#accountState').textContent=(session.user.email||'ACCOUNT VX').toUpperCase();
  const [{data:classes,error:ce},{data:chars,error:ue}]=await Promise.all([
    db.from('vx_game_classes').select('*').order('sort_order'),
    db.from('vx_game_characters').select('*').order('created_at')
  ]);
  if(ce||ue){$('#accountState').textContent='ERRORE DATI';console.error(ce||ue);return;}
  state.classes=classes||[];state.characters=chars||[];
  $('#characterPanel').classList.remove('hidden');renderCharacters();prepareCreator();
}
function renderCharacters(){
  const wrap=$('#characterList');
  if(!state.characters.length){wrap.innerHTML='<p style="color:#aaa;font-size:13px">Nessun personaggio. Creane uno per entrare nella Frontiera.</p>';return;}
  wrap.innerHTML=state.characters.map(c=>{
    const cl=state.classes.find(x=>x.code===c.class_code);
    return `<article class="character-card" data-id="${c.id}"><div><h3>${esc(c.name)}</h3><p>${esc(cl?.name||c.class_code)} · ${c.gender==='male'?'UOMO':'DONNA'}</p></div><div class="level">${c.level}</div><button class="primary-btn play">GIOCA</button></article>`;
  }).join('');
  wrap.querySelectorAll('.play').forEach(b=>b.onclick=(e)=>{const c=state.characters.find(x=>x.id===e.currentTarget.parentElement.dataset.id);startGame(c);});
}
function prepareCreator(){
  $('#classSelect').innerHTML=state.classes.map(c=>`<option value="${c.code}">${esc(c.name)}</option>`).join('');
  updateCreatorClass();
}
function updateCreatorClass(){
  const c=state.classes.find(x=>x.code===$('#classSelect').value)||state.classes[0]; if(!c)return;
  $('#classTitle').textContent=c.name.toUpperCase();$('#classDescription').textContent=c.description;$('#classSigil').textContent=c.name.split(' ').map(x=>x[0]).join('').slice(0,2);
  const map=[['FORZA','str'],['VITALITÀ','vit'],['DESTREZZA','dex'],['INTELLIGENZA','int'],['DIFESA','physical_def'],['MOBILITÀ','move']];
  $('#statBars').innerHTML=map.map(([n,k])=>{const v=Number(c.base_stats?.[k]||0);return `<div class="stat"><b>${n}</b><div class="stat-track"><i style="width:${Math.min(100,v)}%"></i></div><span>${v}</span></div>`}).join('');
}
$('#newCharacterBtn').onclick=()=>{show('creator');updateCreatorClass();};$('#creatorBack').onclick=()=>show('launcher');$('#classSelect').onchange=updateCreatorClass;
document.querySelectorAll('[data-gender]').forEach(b=>b.onclick=()=>{state.gender=b.dataset.gender;document.querySelectorAll('[data-gender]').forEach(x=>x.classList.toggle('active',x===b));});
$('#creatorForm').onsubmit=async(e)=>{e.preventDefault();$('#creatorError').textContent='';const name=$('#characterName').value.trim();const cls=$('#classSelect').value;
  const {data,error}=await db.rpc('vx_game_create_character',{p_name:name,p_class_code:cls,p_gender:state.gender});
  if(error){$('#creatorError').textContent=error.message;return;}
  state.characters.push(data);renderCharacters();show('launcher');$('#characterName').value='';
};
$('#exitGame').onclick=()=>{state.game?.destroy();state.game=null;show('launcher');};

class VXGame{
  constructor(character){this.c=character;this.ws=null;this.world=null;this.player=null;this.mobMeshes=new Map();this.otherPlayers=new Map();this.keys=new Set();this.input={x:0,z:0};this.seq=0;this.lastSend=0;this.running=true;this.maxHp=this.classHp(character.class_code);this.maxMp=this.classMp(character.class_code);this.hp=character.current_hp||this.maxHp;this.mp=character.current_mp||this.maxMp;this.level=character.level;this.gold=character.gold;this.gamepadIndex=null;this.gamepadPrev=[];this.gamepadActive=false;this.cameraYaw=0;this.cameraPitch=.56;this.lockedTargetId=null;this.lastFrame=performance.now();this.init3D();this.bindControls();this.connect();this.updateHUD();this.animate();}
  classHp(c){return ({warrior:180,sura:145,assassin:120,shaman:125,dark_knight:200}[c]||120)+((this.c.level||1)-1)*12;}
  classMp(c){return ({warrior:70,sura:140,assassin:90,shaman:180,dark_knight:90}[c]||100)+((this.c.level||1)-1)*8;}
  init3D(){const canvas=$('#gameCanvas');this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));this.renderer.setSize(innerWidth,innerHeight);this.renderer.shadowMap.enabled=true;this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x111820);this.scene.fog=new THREE.FogExp2(0x111820,.018);this.camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,400);this.camera.position.set(0,8,11);
    this.scene.add(new THREE.HemisphereLight(0x91b4c6,0x1c1512,2.0));const sun=new THREE.DirectionalLight(0xffd1a1,2.4);sun.position.set(-20,35,-15);sun.castShadow=true;this.scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(180,180,20,20),new THREE.MeshStandardMaterial({color:0x283026,roughness:.95}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;this.scene.add(ground);
    const ring=new THREE.Mesh(new THREE.RingGeometry(10,10.35,64),new THREE.MeshBasicMaterial({color:0x4f6e60,transparent:true,opacity:.45,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;this.scene.add(ring);
    for(let i=0;i<55;i++){const g=i%3===0?new THREE.ConeGeometry(.65,2.8,6):new THREE.DodecahedronGeometry(.35+Math.random()*.45,0);const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:i%3===0?0x243d2b:0x3c403a,roughness:1}));const a=Math.random()*Math.PI*2,r=16+Math.random()*67;m.position.set(Math.cos(a)*r,i%3===0?1.35:.2,Math.sin(a)*r);m.rotation.y=Math.random()*6;m.castShadow=true;this.scene.add(m);}
    const gate=new THREE.Group();for(const x of[-3.4,3.4]){const p=new THREE.Mesh(new THREE.BoxGeometry(1.3,7,1.3),new THREE.MeshStandardMaterial({color:0x38332d,roughness:.9}));p.position.set(x,3.5,-17);gate.add(p)}const beam=new THREE.Mesh(new THREE.BoxGeometry(8,1.1,1.5),new THREE.MeshStandardMaterial({color:0x4a332d}));beam.position.set(0,7,-17);gate.add(beam);this.scene.add(gate);
    this.player=this.makePlayer(this.c.class_code,true);this.player.position.set(this.c.pos_x||0,.9,this.c.pos_z||0);this.scene.add(this.player);window.addEventListener('resize',this.resize=()=>{this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight)});
  }
  makePlayer(cls,self=false){const color={warrior:0x8f3529,sura:0x1c9086,assassin:0x5d427e,shaman:0xd3c08b,dark_knight:0x3b2226}[cls]||0x888888;const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.48,1.15,5,9),new THREE.MeshStandardMaterial({color,metalness:.45,roughness:.45}));body.castShadow=true;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.34,12,10),new THREE.MeshStandardMaterial({color:0xa67c63}));head.position.y=1.02;head.castShadow=true;g.add(head);const blade=new THREE.Mesh(new THREE.BoxGeometry(.11,1.65,.11),new THREE.MeshStandardMaterial({color:cls==='sura'?0x58e1d5:0xc6c0ad,emissive:cls==='sura'?0x174f49:0x241411,emissiveIntensity:1.2,metalness:.85}));blade.position.set(.65,.05,0);blade.rotation.z=-.28;g.add(blade);if(self){const aura=new THREE.Mesh(new THREE.RingGeometry(.62,.72,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.68,side:THREE.DoubleSide}));aura.rotation.x=-Math.PI/2;aura.position.y=-.88;g.add(aura)}return g;}
  makeMob(m){const group=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.45,.75,4,8),new THREE.MeshStandardMaterial({color:m.is_boss?0x8c2b22:0x4e5547,roughness:.8}));body.castShadow=true;group.add(body);const eyes=new THREE.Mesh(new THREE.BoxGeometry(.38,.07,.05),new THREE.MeshBasicMaterial({color:0xff5d38}));eyes.position.set(0,.45,.43);group.add(eyes);group.userData=m;return group;}
  bindControls(){this.keyDown=e=>{if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))this.keys.add(e.code);if(e.code==='Space'){e.preventDefault();this.attack()}};this.keyUp=e=>this.keys.delete(e.code);addEventListener('keydown',this.keyDown);addEventListener('keyup',this.keyUp);
    $('#attackBtn').ontouchstart=$('#attackBtn').onmousedown=e=>{e.preventDefault();this.attack()};$('#skill1').onclick=()=>this.attack('skill1');$('#skill2').onclick=()=>this.attack('skill2');
    const joy=$('#joystick'),stick=$('#stick');let pid=null;const calc=e=>{const r=joy.getBoundingClientRect(),x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2),max=r.width*.34,len=Math.hypot(x,y)||1,k=Math.min(1,max/len),px=x*k,py=y*k;stick.style.transform=`translate(${px}px,${py}px)`;this.input.x=px/max;this.input.z=py/max;};joy.onpointerdown=e=>{pid=e.pointerId;joy.setPointerCapture(pid);calc(e)};joy.onpointermove=e=>{if(e.pointerId===pid)calc(e)};joy.onpointerup=joy.onpointercancel=e=>{if(e.pointerId===pid){pid=null;this.input.x=this.input.z=0;stick.style.transform=''}};
    this.gamepadConnected=e=>this.activateGamepad(e.gamepad?.index,e.gamepad);
    this.gamepadDisconnected=e=>{if(e.gamepad?.index===this.gamepadIndex)this.deactivateGamepad()};
    addEventListener('gamepadconnected',this.gamepadConnected);addEventListener('gamepaddisconnected',this.gamepadDisconnected);
    this.scanGamepads();
  }
  friendlyPadName(gp){const id=String(gp?.id||'Controller');if(/dual|playstation|sony|wireless controller/i.test(id))return 'PLAYSTATION';if(/xbox|xinput/i.test(id))return 'XBOX';return 'CONTROLLER';}
  activateGamepad(index,gp){if(index==null)return;const changed=this.gamepadIndex!==index||!this.gamepadActive;this.gamepadIndex=index;this.gamepadActive=true;document.body.classList.add('gamepad-active');const el=$('#controllerState');if(el){el.textContent=`${this.friendlyPadName(gp)} COLLEGATO`;el.classList.add('online')}if(changed)toast(`${this.friendlyPadName(gp)} collegato`);}
  deactivateGamepad(){if(!this.gamepadActive&&this.gamepadIndex==null)return;this.gamepadIndex=null;this.gamepadActive=false;this.gamepadPrev=[];document.body.classList.remove('gamepad-active');const el=$('#controllerState');if(el){el.textContent='PAD NON COLLEGATO';el.classList.remove('online')}toast('Controller scollegato · controlli touch attivi');}
  scanGamepads(){const pads=navigator.getGamepads?.()||[];if(this.gamepadIndex!=null&&pads[this.gamepadIndex]){this.activateGamepad(this.gamepadIndex,pads[this.gamepadIndex]);return pads[this.gamepadIndex]}for(const gp of pads){if(gp){this.activateGamepad(gp.index,gp);return gp}}if(this.gamepadActive)this.deactivateGamepad();return null;}
  deadzone(v,d=.16){v=Number(v)||0;const a=Math.abs(v);if(a<=d)return 0;return Math.sign(v)*Math.min(1,(a-d)/(1-d));}
  buttonEdge(gp,index){const now=!!gp.buttons?.[index]?.pressed,prev=!!this.gamepadPrev[index];this.gamepadPrev[index]=now;return now&&!prev;}
  pollGamepad(dt){const gp=this.scanGamepads();if(!gp)return{x:0,z:0};
    const lx=this.deadzone(gp.axes?.[0]),ly=this.deadzone(gp.axes?.[1]),rx=this.deadzone(gp.axes?.[2]),ry=this.deadzone(gp.axes?.[3]);
    this.cameraYaw-=rx*2.25*dt;this.cameraPitch=clamp(this.cameraPitch-ry*1.35*dt,.22,1.02);
    if(this.buttonEdge(gp,0)||this.buttonEdge(gp,2))this.attack('basic');
    if(this.buttonEdge(gp,4))this.attack('skill1');
    if(this.buttonEdge(gp,5)||this.buttonEdge(gp,3))this.attack('skill2');
    if(this.buttonEdge(gp,10))this.toggleLockTarget();
    if(this.buttonEdge(gp,1))this.clearLockedTarget();
    if(this.buttonEdge(gp,14))this.cycleTarget(-1);
    if(this.buttonEdge(gp,15))this.cycleTarget(1);
    return{x:lx,z:ly};
  }
  clearLockedTarget(){if(this.lockedTargetId){this.lockedTargetId=null;this.showTarget(null);toast('Bersaglio sbloccato')}}
  toggleLockTarget(){if(this.lockedTargetId){this.clearLockedTarget();return}const mob=this.nearestMob(18);if(!mob){toast('Nessun bersaglio da agganciare');return}this.lockedTargetId=mob.userData.id;this.showTarget(mob.userData);toast(`Agganciato: ${mob.userData.name}`);}
  cycleTarget(dir=1){const mobs=[...this.mobMeshes.values()].filter(m=>m.visible&&m.userData.hp>0).sort((a,b)=>Math.hypot(a.position.x-this.player.position.x,a.position.z-this.player.position.z)-Math.hypot(b.position.x-this.player.position.x,b.position.z-this.player.position.z));if(!mobs.length)return;let i=mobs.findIndex(m=>m.userData.id===this.lockedTargetId);i=i<0?0:(i+dir+mobs.length)%mobs.length;this.lockedTargetId=mobs[i].userData.id;this.showTarget(mobs[i].userData);}

  async connect(){const protocol=location.protocol==='https:'?'wss:':'ws:';this.ws=new WebSocket(`${protocol}//${location.host}/game/ws?room=imperial_outskirts`);this.ws.onopen=()=>{this.ws.send(JSON.stringify({type:'auth',token:state.session.access_token,characterId:this.c.id}));};this.ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return}this.onMessage(msg)};this.ws.onclose=()=>{$('#serverState').textContent='OFFLINE';$('#serverState').classList.remove('online');if(this.running)setTimeout(()=>this.connect(),1800)};}
  onMessage(m){if(m.type==='ready'){$('#serverState').textContent='SERVER ONLINE';$('#serverState').classList.add('online');this.applyPlayer(m.player);this.syncWorld(m.world);toast('Entrato nella Frontiera Imperiale');}
    if(m.type==='world')this.syncWorld(m.world);
    if(m.type==='player_state'&&m.id===this.c.id)this.applyPlayer(m);
    if(m.type==='players')this.syncPlayers(m.players||[]);
    if(m.type==='hit'){if(m.attacker===this.c.id)toast(`-${m.damage} HP · ${m.targetName}`);if(m.target===this.c.id){this.hp=m.hp;this.updateHUD();toast(`Hai subito ${m.damage} danni`)}this.updateTargetFromMessage(m);}
    if(m.type==='mob_dead'){if(m.killer===this.c.id){toast(`+${m.xp} XP · +${m.gold} oro`);if(m.mobCode==='rift_wolf'){state.questKills=Math.min(3,state.questKills+1);$('#questProgress').textContent=`${state.questKills} / 3`;if(state.questKills===3)toast('MISSIONE COMPLETATA: Prima Sangue');}}this.level=m.level??this.level;this.gold=m.playerGold??this.gold;this.updateHUD();this.syncWorld(m.world);}
    if(m.type==='error')toast(m.message||'Errore server');}
  applyPlayer(p){if(Number.isFinite(p.x))this.player.position.x=p.x;if(Number.isFinite(p.z))this.player.position.z=p.z;if(Number.isFinite(p.hp))this.hp=p.hp;if(Number.isFinite(p.level))this.level=p.level;if(Number.isFinite(p.gold))this.gold=p.gold;this.updateHUD();}
  syncWorld(world){this.world=world||this.world;if(!this.world)return;const seen=new Set();for(const m of this.world.mobs||[]){seen.add(m.id);let mesh=this.mobMeshes.get(m.id);if(!mesh){mesh=this.makeMob(m);this.mobMeshes.set(m.id,mesh);this.scene.add(mesh)}mesh.userData={...m};mesh.position.set(m.x,.75,m.z);mesh.visible=!m.deadUntil||m.deadUntil<Date.now();}
    for(const [id,mesh] of this.mobMeshes)if(!seen.has(id)){this.scene.remove(mesh);this.mobMeshes.delete(id)}const locked=this.lockedTargetId&&this.mobMeshes.get(this.lockedTargetId);if(this.lockedTargetId&&(!locked||!locked.visible||locked.userData.hp<=0))this.clearLockedTarget();}
  syncPlayers(players){const seen=new Set();for(const p of players){if(p.characterId===this.c.id)continue;seen.add(p.characterId);let mesh=this.otherPlayers.get(p.characterId);if(!mesh){mesh=this.makePlayer(p.classCode,false);this.otherPlayers.set(p.characterId,mesh);this.scene.add(mesh)}mesh.position.lerp(new THREE.Vector3(p.x,.9,p.z),.55)}for(const [id,m] of this.otherPlayers)if(!seen.has(id)){this.scene.remove(m);this.otherPlayers.delete(id)}}
  updateTargetFromMessage(m){const mob=[...this.mobMeshes.values()].find(x=>x.userData.id===m.mobId);if(!mob)return;mob.userData.hp=m.mobHp;this.showTarget(mob.userData);}
  showTarget(t){if(!t){$('#targetPanel').classList.add('hidden');return}$('#targetPanel').classList.remove('hidden');$('#targetName').textContent=t.name;$('#targetHpFill').style.width=`${Math.max(0,100*(t.hp/t.maxHp))}%`;}
  nearestMob(max=3.4){let best=null,d=max;for(const m of this.mobMeshes.values()){if(!m.visible||m.userData.hp<=0)continue;const dd=Math.hypot(m.position.x-this.player.position.x,m.position.z-this.player.position.z);if(dd<d){best=m;d=dd}}return best;}
  attack(kind='basic'){const max=kind==='skill2'?4.5:3.1;let mob=this.lockedTargetId?this.mobMeshes.get(this.lockedTargetId):null;if(mob&&(!mob.visible||mob.userData.hp<=0||Math.hypot(mob.position.x-this.player.position.x,mob.position.z-this.player.position.z)>max))mob=null;if(!mob)mob=this.nearestMob(max);if(!mob){toast('Nessun bersaglio a portata');return}this.showTarget(mob.userData);this.player.lookAt(mob.position.x,this.player.position.y,mob.position.z);if(this.ws?.readyState===1)this.ws.send(JSON.stringify({type:'attack',targetId:mob.userData.id,kind,seq:++this.seq}));}
  computeInput(dt){let x=this.input.x,z=this.input.z;if(this.keys.has('KeyW')||this.keys.has('ArrowUp'))z-=1;if(this.keys.has('KeyS')||this.keys.has('ArrowDown'))z+=1;if(this.keys.has('KeyA')||this.keys.has('ArrowLeft'))x-=1;if(this.keys.has('KeyD')||this.keys.has('ArrowRight'))x+=1;const gp=this.pollGamepad(dt);x+=gp.x;z+=gp.z;const l=Math.hypot(x,z);if(l>1){x/=l;z/=l}const c=Math.cos(this.cameraYaw),s=Math.sin(this.cameraYaw);return{x:x*c+z*s,z:-x*s+z*c};}
  animate=()=>{if(!this.running)return;requestAnimationFrame(this.animate);const now=performance.now(),dt=Math.min(.05,Math.max(.001,(now-this.lastFrame)/1000));this.lastFrame=now;const inp=this.computeInput(dt);if((Math.abs(inp.x)>.02||Math.abs(inp.z)>.02)&&now-this.lastSend>70&&this.ws?.readyState===1){this.lastSend=now;this.ws.send(JSON.stringify({type:'move',dx:inp.x,dz:inp.z,seq:++this.seq}));}
    if(Math.hypot(inp.x,inp.z)>.04){const desired=new THREE.Vector3(inp.x,0,inp.z);this.player.rotation.y=Math.atan2(desired.x,desired.z);}
    const distance=11.8,horizontal=Math.cos(this.cameraPitch)*distance,height=Math.sin(this.cameraPitch)*distance;const cp=new THREE.Vector3(this.player.position.x+Math.sin(this.cameraYaw)*horizontal,this.player.position.y+height,this.player.position.z+Math.cos(this.cameraYaw)*horizontal);this.camera.position.lerp(cp,.12);let lookX=this.player.position.x,lookZ=this.player.position.z;const locked=this.lockedTargetId&&this.mobMeshes.get(this.lockedTargetId);if(locked?.visible){lookX=THREE.MathUtils.lerp(lookX,locked.position.x,.28);lookZ=THREE.MathUtils.lerp(lookZ,locked.position.z,.28);this.showTarget(locked.userData)}this.camera.lookAt(lookX,1,lookZ);this.renderer.render(this.scene,this.camera);};
  updateHUD(){const hp=Math.max(0,Math.min(1,this.hp/this.maxHp)),mp=Math.max(0,Math.min(1,this.mp/this.maxMp));$('#hudName').textContent=this.c.name;$('#hudInitial').textContent=this.c.name[0]?.toUpperCase()||'V';$('#hudLevel').textContent=`Lv. ${this.level}`;$('#hpFill').style.width=`${hp*100}%`;$('#mpFill').style.width=`${mp*100}%`;$('#hpText').textContent=`${Math.round(this.hp)} / ${this.maxHp}`;$('#mpText').textContent=`${Math.round(this.mp)} / ${this.maxMp}`;$('#goldText').textContent=Number(this.gold||0).toLocaleString('it-IT');}
  destroy(){this.running=false;try{this.ws?.close(1000,'exit')}catch{}removeEventListener('keydown',this.keyDown);removeEventListener('keyup',this.keyUp);removeEventListener('resize',this.resize);removeEventListener('gamepadconnected',this.gamepadConnected);removeEventListener('gamepaddisconnected',this.gamepadDisconnected);document.body.classList.remove('gamepad-active');const el=$('#controllerState');if(el){el.textContent='PAD NON COLLEGATO';el.classList.remove('online')}this.renderer.dispose();}
}
async function startGame(c){state.selected=c;show('gameScreen');state.game=new VXGame(c);}
init();
