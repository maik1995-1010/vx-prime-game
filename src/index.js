import { DurableObject } from 'cloudflare:workers';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const starterMobs=()=>({mobs:[
  {id:'wolf-1',code:'rift_wolf',name:'Lupo della Frattura',level:1,maxHp:85,hp:85,x:8,z:5,xp:22,goldMin:4,goldMax:10,attack:9},
  {id:'wolf-2',code:'rift_wolf',name:'Lupo della Frattura',level:1,maxHp:85,hp:85,x:12,z:-4,xp:22,goldMin:4,goldMax:10,attack:9},
  {id:'wolf-3',code:'rift_wolf',name:'Lupo della Frattura',level:1,maxHp:85,hp:85,x:-9,z:6,xp:22,goldMin:4,goldMax:10,attack:9},
  {id:'boar-1',code:'ash_boar',name:'Cinghiale delle Ceneri',level:3,maxHp:150,hp:150,x:18,z:12,xp:38,goldMin:8,goldMax:18,attack:14},
  {id:'fallen-1',code:'fallen_scout',name:'Esploratore Caduto',level:5,maxHp:220,hp:220,x:-24,z:9,xp:58,goldMin:15,goldMax:30,attack:20},
  {id:'boss-1',code:'rift_guardian',name:'Guardiano della Frattura',level:12,maxHp:2600,hp:2600,x:0,z:55,xp:850,goldMin:180,goldMax:320,attack:58,isBoss:true}
]});

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/game/api/health') return json({ok:true,service:'vx-prime-game',version:'0.2.0'});
    if(url.pathname==='/game/ws'){
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response('Expected WebSocket',{status:426});
      const room=(url.searchParams.get('room')||'imperial_outskirts').replace(/[^a-z0-9_-]/gi,'').slice(0,64);
      const id=env.GAME_ROOMS.idFromName(room);return env.GAME_ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.world=starterMobs();this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));this.ctx.blockConcurrencyWhile(async()=>{this.world=(await this.ctx.storage.get('world'))||starterMobs();this.reviveDue();});}
  async fetch(){const pair=new WebSocketPair();const [client,server]=Object.values(pair);this.ctx.acceptWebSocket(server);server.serializeAttachment({authed:false,connectionId:crypto.randomUUID(),joinedAt:Date.now()});server.send(JSON.stringify({type:'hello',version:'0.2.0'}));return new Response(null,{status:101,webSocket:client});}
  async webSocketMessage(ws,data){let msg;try{msg=JSON.parse(typeof data==='string'?data:new TextDecoder().decode(data))}catch{return this.send(ws,{type:'error',message:'Messaggio non valido'})}let s=ws.deserializeAttachment()||{};
    if(!s.authed){if(msg.type!=='auth')return this.send(ws,{type:'error',message:'Autenticazione richiesta'});return this.authenticate(ws,msg,s)}
    if(msg.type==='move')return this.move(ws,msg,s);
    if(msg.type==='attack')return this.attack(ws,msg,s);
    if(msg.type==='sync')return this.sendReady(ws,s);
  }
  async authenticate(ws,msg,s){const token=String(msg.token||'');const characterId=String(msg.characterId||'');if(!token||!characterId)return this.send(ws,{type:'error',message:'Credenziali mancanti'});
    const u=await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:this.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}});if(!u.ok){this.send(ws,{type:'error',message:'Sessione vX non valida'});return ws.close(4001,'unauthorized')}const user=await u.json();
    const cr=await fetch(`${this.env.SUPABASE_URL}/rest/v1/vx_game_characters?id=eq.${encodeURIComponent(characterId)}&select=id,user_id,name,class_code,level,gold,map_code,pos_x,pos_z,current_hp,current_mp`,{headers:{apikey:this.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}});if(!cr.ok)return this.send(ws,{type:'error',message:'Impossibile caricare il personaggio'});const rows=await cr.json();const c=rows[0];if(!c||c.user_id!==user.id){this.send(ws,{type:'error',message:'Personaggio non autorizzato'});return ws.close(4003,'forbidden')}
    s={...s,authed:true,userId:user.id,characterId:c.id,name:c.name,classCode:c.class_code,level:c.level,gold:c.gold,x:Number(c.pos_x)||0,z:Number(c.pos_z)||0,hp:Number(c.current_hp)||100,mp:Number(c.current_mp)||100,lastMove:Date.now(),lastAttack:0,lastPersist:Date.now(),moveCount:0};ws.serializeAttachment(s);this.reviveDue();await this.sendReady(ws,s);this.broadcastPlayers();}
  async sendReady(ws,s){this.send(ws,{type:'ready',player:{id:s.characterId,name:s.name,classCode:s.classCode,x:s.x,z:s.z,hp:s.hp,mp:s.mp,level:s.level,gold:s.gold},world:this.publicWorld()});}
  async move(ws,msg,s){const now=Date.now(),dt=clamp((now-(s.lastMove||now))/1000,.02,.22);s.lastMove=now;let dx=Number(msg.dx)||0,dz=Number(msg.dz)||0;const len=Math.hypot(dx,dz);if(len>1){dx/=len;dz/=len}const speed=5.4;s.x=clamp(s.x+dx*speed*dt,-82,82);s.z=clamp(s.z+dz*speed*dt,-82,82);s.moveCount=(s.moveCount||0)+1;ws.serializeAttachment(s);this.send(ws,{type:'player_state',id:s.characterId,x:s.x,z:s.z,hp:s.hp,level:s.level,gold:s.gold});if(s.moveCount%2===0)this.broadcastPlayers();if(now-(s.lastPersist||0)>12000){s.lastPersist=now;ws.serializeAttachment(s);this.ctx.waitUntil(this.persist(s));}}
  async attack(ws,msg,s){const now=Date.now(),kind=['basic','skill1','skill2'].includes(msg.kind)?msg.kind:'basic';const cd=kind==='basic'?620:kind==='skill1'?1350:2600;if(now-(s.lastAttack||0)<cd)return;s.lastAttack=now;this.reviveDue();const mob=this.world.mobs.find(m=>m.id===msg.targetId);if(!mob||mob.hp<=0||mob.deadUntil>now)return;const range=kind==='skill2'?4.7:3.2,dist=Math.hypot(mob.x-s.x,mob.z-s.z);if(dist>range)return this.send(ws,{type:'error',message:'Bersaglio fuori portata'});
    const base={warrior:17,sura:15,assassin:16,shaman:12,dark_knight:18}[s.classCode]||14;const mult=kind==='skill1'?1.55:kind==='skill2'?2.05:1;const damage=Math.max(1,Math.floor((base+s.level*2.2)*mult));mob.hp=Math.max(0,mob.hp-damage);this.sendAll({type:'hit',attacker:s.characterId,mobId:mob.id,targetName:mob.name,damage,mobHp:mob.hp});
    if(mob.hp<=0){mob.deadUntil=now+(mob.isBoss?45000:12000);const gold=mob.goldMin+Math.floor(Math.random()*(mob.goldMax-mob.goldMin+1));const reward=await this.reward(s,mob.xp,gold);if(reward){s.level=reward.level;s.gold=reward.gold;ws.serializeAttachment(s)}await this.ctx.storage.put('world',this.world);this.sendAll({type:'mob_dead',mobId:mob.id,mobCode:mob.code,killer:s.characterId,xp:mob.xp,gold,level:s.level,playerGold:s.gold,world:this.publicWorld()});}
    else {const counter=Math.max(1,Math.floor(mob.attack-(s.classCode==='dark_knight'?5:s.classCode==='warrior'?3:0)));s.hp=Math.max(0,s.hp-counter);ws.serializeAttachment(s);this.send(ws,{type:'hit',attacker:mob.id,target:s.characterId,targetName:s.name,damage:counter,hp:s.hp});if(s.hp<=0){s.hp=this.spawnHp(s.classCode,s.level);s.x=0;s.z=0;ws.serializeAttachment(s);this.send(ws,{type:'player_state',id:s.characterId,x:0,z:0,hp:s.hp,level:s.level,gold:s.gold});}}
  }
  spawnHp(cls,level){return ({warrior:180,sura:145,assassin:120,shaman:125,dark_knight:200}[cls]||120)+(level-1)*12;}
  reviveDue(){const now=Date.now();let changed=false;for(const m of this.world.mobs){if(m.deadUntil&&m.deadUntil<=now){m.hp=m.maxHp;delete m.deadUntil;changed=true}}if(changed)this.ctx.waitUntil(this.ctx.storage.put('world',this.world));}
  publicWorld(){this.reviveDue();return {mobs:this.world.mobs.map(m=>({...m}))};}
  listPlayers(){return this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment()).filter(s=>s?.authed).map(s=>({characterId:s.characterId,name:s.name,classCode:s.classCode,x:s.x,z:s.z,level:s.level,hp:s.hp}));}
  broadcastPlayers(){this.sendAll({type:'players',players:this.listPlayers()});}
  send(ws,obj){try{ws.send(JSON.stringify(obj))}catch{}}
  sendAll(obj){const msg=JSON.stringify(obj);for(const ws of this.ctx.getWebSockets()){try{const s=ws.deserializeAttachment();if(s?.authed)ws.send(msg)}catch{}}}
  async reward(s,xp,gold){if(!this.env.SUPABASE_SECRET_KEY)return null;const r=await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/vx_game_server_award_reward`,{method:'POST',headers:{apikey:this.env.SUPABASE_SECRET_KEY,'content-type':'application/json'},body:JSON.stringify({p_character_id:s.characterId,p_xp:xp,p_gold:gold,p_event_type:'mob_kill'})});if(!r.ok){console.error('reward failed',r.status,await r.text());return null}return await r.json();}
  async persist(s){if(!this.env.SUPABASE_SECRET_KEY)return;const r=await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/vx_game_server_save_state`,{method:'POST',headers:{apikey:this.env.SUPABASE_SECRET_KEY,'content-type':'application/json'},body:JSON.stringify({p_character_id:s.characterId,p_map_code:'imperial_outskirts',p_x:s.x,p_y:0,p_z:s.z,p_rotation_y:0,p_hp:s.hp,p_mp:s.mp})});if(!r.ok)console.error('persist failed',r.status,await r.text());}
  async webSocketClose(ws){const s=ws.deserializeAttachment();if(s?.authed)await this.persist(s);this.broadcastPlayers();}
  async webSocketError(ws){const s=ws.deserializeAttachment();if(s?.authed)await this.persist(s);}
}
