VX MMORPG WEB — BUILD 0.2
========================

CONTENUTO
- /public/game/index.html : launcher/creazione personaggio/gioco
- /public/game/game.js    : client 3D Web (Three.js) + Supabase Auth
- /public/game/game.css   : UI desktop + touch iPad/iPhone
- /src/index.js           : Cloudflare Worker + Durable Object WebSocket autoritativo
- /wrangler.jsonc         : config Static Assets + Durable Object SQLite
- /sql                    : note sul database già applicato

FUNZIONI DELLA BUILD
- Riusa il login vX PRIME Supabase esistente
- Fino a 4 personaggi per account
- 5 classi uomo/donna
- 10 dottrine con 9 skill ciascuna (90 skill totali)
- 40 oggetti iniziali/avanzati nel catalogo
- Creazione personaggio controllata dal database
- Mappa 3D "Frontiera Imperiale"
- Movimento WASD/frecce + joystick touch + controller Bluetooth via Gamepad API
- Controller: stick sinistro movimento, stick destro camera, A/Cross attacco, LB/L1 skill 1, RB/R1 skill 2, R3 lock-on, B/Circle sblocca
- Mob server-side con HP, distanza, cooldown e contrattacco
- XP/oro assegnati esclusivamente dal server
- Respawn mob
- Salvataggio posizione/HP lato server
- Multiplayer: altri player nella stessa stanza vengono sincronizzati
- Prima missione locale: 3 Lupi della Frattura

SICUREZZA
- Nel browser NON va inserita alcuna secret key.
- SUPABASE_PUBLISHABLE_KEY è pubblica ed è protetta dalle RLS.
- SUPABASE_SECRET_KEY deve essere impostata come Secret del Worker Cloudflare.
- Il client non ha UPDATE su vx_game_characters/vx_game_items.
- XP, oro e posizione persistente passano dal game server.

CLOUDFLARE SECRET NECESSARIA
SUPABASE_SECRET_KEY = una chiave Supabase sb_secret_...

Non scriverla nei file e non inviarla in chat: configurarla direttamente nei Secrets del Worker.

INTEGRAZIONE CON IL SITO ESISTENTE
Questa è la cartella GAME della build. Per mantenere la home vX attuale, i file /public/game/* devono essere aggiunti agli asset del Worker esistente e le route /game/ws + /game/api devono essere inserite nel Worker principale.

La build non sostituisce automaticamente la home corrente finché non viene fusa col pacchetto attuale del sito.


CONTROLLER BLUETOOTH
- L'abbinamento Bluetooth si fa nelle Impostazioni di iPad/iPhone/Android/PC, non nel sito.
- Il browser rileva il controller tramite Gamepad API.
- Quando il pad viene rilevato i controlli touch vengono nascosti automaticamente.
- Se il pad viene scollegato, joystick e pulsanti touch ricompaiono.
- Mapping standard:
  Stick sinistro = movimento
  Stick destro = telecamera
  A / Cross oppure X / Square = attacco base
  LB / L1 = Skill 1
  RB / R1 oppure Y / Triangle = Skill 2
  R3 = aggancia/sblocca bersaglio
  B / Circle = sblocca bersaglio
  D-pad sinistra/destra = cambia bersaglio

NOTA IPAD/SAFARI
- Alcuni controller vengono esposti alla pagina solo dopo aver premuto almeno un pulsante una volta.
- Aprire /game/, premere un tasto sul controller e il badge in alto a destra passerà a CONTROLLER COLLEGATO.
