// public/js/engine.js
// v0.4 — centered masthead; higher-contrast UI; two-choice structure; optional "Continue Story";
// softer sounds; HP/Gold/Items logic; death/last-stand flow; boss cooldown & win paths;
// success/fail beat glow; hover & click polish.

import { makeWeaver } from './weaver.js';

/* ---------- tiny utilities ---------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const modFromScore = s => Math.floor((s - 10) / 2);
const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const choice = arr => arr[rnd(0, arr.length-1)];

/* ---------- simple persistent store ---------- */
const store = {
  get(k, def){ try{ const v = localStorage.getItem(k); return v?JSON.parse(v):def; }catch{return def;} },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem(k); }catch{} }
};

/* ---------- engine state ---------- */
const Engine = {
  el: {}, // DOM refs
  state: {
    seed: rnd(1, 9_999_999),
    turn: 0,
    scene: 'Halls',
    log: [],
    storyBeats: [],   // {text, rollInfo?, tone?:'good'|'bad'|'neutral'}
    transcript: [],
    lastStandUsed: false,
    buffs: { nextDexBonus: 0 },
    character: {
      name: 'Eldan',
      STR: 12, DEX: 14, INT: 12, CHA: 10,
      HP: 14, Gold: 5,
      inventory: ['Torch', 'Canteen']
    },
    flags: {
      rumors: false,
      seals: [],             // 'Brass','Echo','Stone'
      bossReady: false,
      bossDealtWith: false,
      bossCooldown: 0        // turns remaining after a failed confrontation
    }
  }
};

/* ---------- Weaver bridge ---------- */
const Weaver = makeWeaver(
  store,
  (msg)=>Engine.state.log.push(msg),
  (tag)=>{ const t = $('#engineTag'); if (t) t.textContent = tag; }
);

/* ---------- Sound (procedural; no files) ---------- */
const Sound = (() => {
  let ctx, master, ui, amb, flames, onAmb = false;

  function init(){
    if (ctx) return;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    ui     = ctx.createGain(); ui.gain.value = 0.7; ui.connect(master);
    amb    = ctx.createGain(); amb.gain.value = 0.0; amb.connect(master);
    flames = ctx.createGain(); flames.gain.value = 0.0; flames.connect(master);

    // A low forge-like ambience (two slow oscillators + filtered noise)
    const o1=ctx.createOscillator(); o1.type='sine';     o1.frequency.value=110;
    const g1=ctx.createGain(); g1.gain.value=0.02; o1.connect(g1).connect(amb); o1.start();
    const o2=ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=165;
    const g2=ctx.createGain(); g2.gain.value=0.015; o2.connect(g2).connect(amb); o2.start();
    const l1=ctx.createOscillator(); const lg1=ctx.createGain(); l1.type='sine'; l1.frequency.value=0.08; lg1.gain.value=0.012; l1.connect(lg1).connect(g1.gain); l1.start();

    const noise=ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate);
    const data=noise.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*0.08;
    const ns=ctx.createBufferSource(); ns.buffer=noise; ns.loop=true;
    const nf=ctx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.value=600;
    const ng=ctx.createGain(); ng.gain.value=0.05; ns.connect(nf).connect(ng).connect(amb); ns.start();

    // Flames (for death/last-stand screen)
    const ns2=ctx.createBufferSource(); ns2.buffer=noise; ns2.loop=true;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1000; bp.Q.value=0.6;
    const fg=ctx.createGain(); fg.gain.value=0.0; ns2.connect(bp).connect(fg).connect(flames); ns2.start();
    // gentle swell/ebb
    const l2=ctx.createOscillator(); const lg2=ctx.createGain(); l2.type='sine'; l2.frequency.value=0.2; lg2.gain.value=0.3; l2.connect(lg2).connect(fg.gain); l2.start();
  }

  function toggleAmb(on=true){
    init(); onAmb=on; if(ctx.state==='suspended') ctx.resume();
    amb.gain.cancelScheduledValues(ctx.currentTime);
    amb.gain.linearRampToValueAtTime(on?0.35:0, ctx.currentTime+0.6);
    return onAmb;
  }
  function flamesOn(on=true){
    init(); if(ctx.state==='suspended') ctx.resume();
    flames.gain.cancelScheduledValues(ctx.currentTime);
    flames.gain.linearRampToValueAtTime(on?0.25:0, ctx.currentTime+0.4);
  }

  // Lower-pitched "wood thunk"
  function uiClick(){
    if(!ctx) return;
    const t=ctx.currentTime;
    const o=ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t+0.08);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.28, t+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=420;
    o.connect(lp).connect(g).connect(ui); o.start(t); o.stop(t+0.2);
  }

  // "Die cast" thunk-roll
  function dice(){
    if(!ctx) return; const t=ctx.currentTime;
    const o=ctx.createOscillator(); o.type='square';
    o.frequency.setValueAtTime(340,t);
    o.frequency.exponentialRampToValueAtTime(160,t+0.14);
    const g=ctx.createGain(); g.gain.value=0.0001;
    g.gain.exponentialRampToValueAtTime(0.35, t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.26);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=500;
    o.connect(lp).connect(g).connect(ui); o.start(t); o.stop(t+0.28);
  }

  // gentle hover chime
  function uiHover(){
    if(!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(990, t);
    o.frequency.exponentialRampToValueAtTime(660, t+0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
    o.connect(g).connect(ui); o.start(t); o.stop(t+0.14);
  }

  return { toggleAmb, flamesOn, uiClick, uiHover, dice, ensure:init };
})();

/* ---------- UI boot ---------- */
export function boot() {
  buildUI();
  hydrateFromStorage();
  bindHandlers();

  // errors to visible log
  window.addEventListener('error', e => { appendBeat(`[script error] ${e.message}`); renderAll(); });
  window.addEventListener('unhandledrejection', e => { appendBeat(`[promise error] ${e.reason}`); renderAll(); });

  // Default: audio ON after first gesture
  document.addEventListener('pointerdown', ()=>{ Sound.ensure(); Sound.toggleAmb(true); }, { once:true });

  renderAll();
  if (Engine.state.storyBeats.length === 0) beginTale();
}

/* ---------- UI construction ---------- */
function buildUI() {
  const root = document.body;
  root.innerHTML = `
  <div id="app" class="app">
    <!-- Deco overlay -->
    <div id="deco-chrome" aria-hidden="true" class="chrome">
      <svg width="100%" height="100%" preserveAspectRatio="none">
        <line x1="10%" y1="18" x2="90%" y2="18" stroke="#d5a84a" stroke-opacity=".55" stroke-width="3"/>
        <rect x="18" y="18" width="120" height="120" fill="none" stroke="#d5a84a" stroke-width="3"/>
        <rect x="calc(100% - 138)" y="18" width="120" height="120" fill="none" stroke="#d5a84a" stroke-width="3"/>
        <rect x="18" y="calc(100% - 138)" width="120" height="120" fill="none" stroke="#d5a84a" stroke-width="3"/>
        <rect x="calc(100% - 138)" y="calc(100% - 138)" width="120" height="120" fill="none" stroke="#d5a84a" stroke-width="3"/>
      </svg>
    </div>

    <!-- Masthead -->
    <header class="masthead">
      <h1 class="brand-title">Dwarven Deco Storyweaver</h1>
      <div class="toolbar cardish">
        <div class="controls">
          <button id="btnEdit" class="btn">Edit Character</button>
          <button id="btnAuto" class="btn">Auto-generate</button>
          <button id="btnBegin" class="btn">Begin Tale</button>
          <button id="btnEnd" class="btn">End the Story</button>
          <button id="btnUndo" class="btn">Undo</button>
          <button id="btnSave" class="btn">Save</button>
          <button id="btnLoad" class="btn">Load</button>
          <button id="btnExport" class="btn">Export</button>
          <button id="btnLive" class="btn">Live DM: Off</button>
          <button id="btnDMConfig" class="btn">DM Config</button>
          <span class="tag">Engine: <b id="engineTag">Local</b></span>
        </div>
      </div>
    </header>

    <main class="main">
      <section class="story">
        <div id="storyScroll" class="story-scroll"></div>

        <div class="choices cardish">
          <div id="choices"></div>
          <div class="free">
            <input id="freeText" type="text" placeholder="Write your own action (e.g., search the alcove, read the tablet)"/>
            <button id="btnAct" class="btn btn-act">ACT</button>
            <button id="btnContinue" class="btn btn-continue">Continue story</button>
          </div>
        </div>
      </section>

      <aside class="side">
        <div class="panel cardish">
          <h3>Character</h3>
          <div id="charPanel"></div>
        </div>
        <div class="panel cardish">
          <h3>Flags & Seals</h3>
          <div id="flagPanel"></div>
        </div>
        <div class="panel cardish">
          <h3>Session</h3>
          <div>Seed: <span id="seedVal"></span></div>
          <div>Turn: <span id="turnVal"></span></div>
          <div>Scene: <span id="sceneVal"></span></div>
        </div>
      </aside>
    </main>
  </div>

  <!-- Shade + Modals -->
  <div id="modalShade" class="shade hidden"></div>

  <div id="modalEdit" class="modal hidden">
    <div class="inner">
      <header><div>Edit Character</div><div class="closeX" id="xEdit">✕</div></header>
      <div class="content">
        <label>Name <input id="edName" /></label>
        <div class="grid2">
          <label>STR <input id="edSTR" type="number" min="6" max="18"/></label>
          <label>DEX <input id="edDEX" type="number" min="6" max="18"/></label>
          <label>INT <input id="edINT" type="number" min="6" max="18"/></label>
          <label>CHA <input id="edCHA" type="number" min="6" max="18"/></label>
          <label>HP  <input id="edHP"  type="number" min="4" max="30"/></label>
          <label>Gold<input id="edGold"type="number" min="0" max="999"/></label>
        </div>
        <label>Inventory (comma separated) <input id="edInv" /></label>
        <div class="modal-actions">
          <button id="btnEditSave" class="btn">Save</button>
          <button id="btnEditCancel" class="btn">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <div id="modalDM" class="modal hidden">
    <div class="inner">
      <header><div>DM Config</div><div class="closeX" id="xDM">✕</div></header>
      <div class="content">
        <label>Endpoint <input id="dmEndpoint" placeholder="/dm-turn"/></label>
        <div class="modal-actions">
          <button id="btnSaveDM" class="btn">Save</button>
          <button id="btnCancelDM" class="btn">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <div id="modalDeath" class="modal hidden">
    <div class="inner">
      <header><div>Fallen in the Halls</div><div class="closeX" id="xDeath">✕</div></header>
      <div class="content">
        <p>Your strength fails. Darkness presses close around the lamps.</p>
        <div id="deathOptions" class="btn-row"></div>
      </div>
    </div>
  </div>
  `;

  // cache refs
  Engine.el.storyScroll = $('#storyScroll');
  Engine.el.choicesBox  = $('.choices');
  Engine.el.choiceList  = $('#choices');

  Engine.el.charPanel = $('#charPanel');
  Engine.el.flagPanel = $('#flagPanel');

  Engine.el.seedVal = $('#seedVal');
  Engine.el.turnVal = $('#turnVal');
  Engine.el.sceneVal = $('#sceneVal');

  Engine.el.btnEdit = $('#btnEdit');
  Engine.el.btnAuto = $('#btnAuto');
  Engine.el.btnBegin = $('#btnBegin');
  Engine.el.btnEnd = $('#btnEnd');
  Engine.el.btnUndo = $('#btnUndo');
  Engine.el.btnSave = $('#btnSave');
  Engine.el.btnLoad = $('#btnLoad');
  Engine.el.btnExport = $('#btnExport');
  Engine.el.btnLive = $('#btnLive');
  Engine.el.btnDMConfig = $('#btnDMConfig');

  Engine.el.btnAct = $('#btnAct');
  Engine.el.btnContinue = $('#btnContinue');
  Engine.el.freeText = $('#freeText');

  Engine.el.modalShade = $('#modalShade');
  Engine.el.modalEdit = $('#modalEdit');
  Engine.el.edName = $('#edName'); Engine.el.edSTR = $('#edSTR'); Engine.el.edDEX = $('#edDEX');
  Engine.el.edINT = $('#edINT'); Engine.el.edCHA = $('#edCHA'); Engine.el.edHP = $('#edHP'); Engine.el.edGold = $('#edGold'); Engine.el.edInv = $('#edInv');
  Engine.el.btnEditSave = $('#btnEditSave'); Engine.el.btnEditCancel = $('#btnEditCancel'); Engine.el.xEdit = $('#xEdit');

  Engine.el.modalDM = $('#modalDM'); Engine.el.dmEndpoint = $('#dmEndpoint');
  Engine.el.btnSaveDM = $('#btnSaveDM'); Engine.el.btnCancelDM = $('#btnCancelDM'); Engine.el.xDM = $('#xDM');

  Engine.el.modalDeath = $('#modalDeath'); Engine.el.deathOptions = $('#deathOptions'); Engine.el.xDeath = $('#xDeath');
}

/* ---------- storage ---------- */
function hydrateFromStorage() {
  const saved = store.get('dds_state', null);
  if (saved) Engine.state = saved;
}

/* ---------- handlers ---------- */
function bindHandlers() {
  Engine.el.btnEdit.onclick = openEdit;
  Engine.el.btnAuto.onclick = autoGen;
  Engine.el.btnBegin.onclick = beginTale;
  Engine.el.btnEnd.onclick = endTale;
  Engine.el.btnUndo.onclick = undoTurn;
  Engine.el.btnSave.onclick = () => { store.set('dds_state', Engine.state); toast('Saved'); };
  Engine.el.btnLoad.onclick = () => { const s = store.get('dds_state', null); if (s) { Engine.state = s; renderAll(); toast('Loaded'); } };
  Engine.el.btnExport.onclick = exportTranscript;

  Engine.el.btnLive.onclick = () => {
    if (Weaver.mode === 'live'){ Weaver.setMode('local'); Engine.el.btnLive.textContent = 'Live DM: Off'; }
    else { Weaver.setMode('live'); Engine.el.btnLive.textContent = 'Live DM: On'; }
  };

  Engine.el.btnDMConfig.onclick = () => {
    try {
      Engine.el.dmEndpoint.value = Weaver.endpoint || '/dm-turn';
      openModal(Engine.el.modalDM);
    } catch (e) { appendBeat(`[DM Config] ${e.message}`); renderAll(); }
  };
  Engine.el.btnSaveDM.onclick   = () => { Weaver.setEndpoint(Engine.el.dmEndpoint.value.trim()); closeModal(Engine.el.modalDM); toast('Endpoint saved'); };
  Engine.el.btnCancelDM.onclick = () => closeModal(Engine.el.modalDM);
  Engine.el.xDM.onclick         = () => closeModal(Engine.el.modalDM);

  Engine.el.btnEditSave.onclick = saveEdit;
  Engine.el.btnEditCancel.onclick = () => closeModal(Engine.el.modalEdit);
  Engine.el.xEdit.onclick         = () => closeModal(Engine.el.modalEdit);

  Engine.el.btnAct.onclick = () => freeTextAct();
  Engine.el.freeText.addEventListener('keydown', (e)=>{ if (e.key==='Enter') freeTextAct(); });

  Engine.el.btnContinue.onclick = () => { Sound.uiClick(); continueStory(); };

  // Close modals
  if (!Engine._escWired) {
    Engine._escWired = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' &&
          Engine.el.modalShade &&
          !Engine.el.modalShade.classList.contains('hidden')) {
        const open = document.querySelector('.modal:not(.hidden)');
        if (open) closeModal(open);
      }
    });
  }
  if (Engine.el.modalShade && !Engine.el.modalShade._wired) {
    Engine.el.modalShade._wired = true;
    Engine.el.modalShade.onclick = () => {
      const open = document.querySelector('.modal:not(.hidden)');
      if (open) closeModal(open);
    };
  }
}

/* ---------- render ---------- */
function renderAll() {
  const s = Engine.state;
  Engine.el.seedVal.textContent = s.seed;
  Engine.el.turnVal.textContent = s.turn;
  Engine.el.sceneVal.textContent = s.scene;

  // character panel
  const C = s.character;
  Engine.el.charPanel.innerHTML = `
    <div><b>${escapeHTML(C.name)}</b></div>
    <div>STR ${C.STR} (${fmtMod(modFromScore(C.STR))}) — DEX ${C.DEX} (${fmtMod(modFromScore(C.DEX))})</div>
    <div>INT ${C.INT} (${fmtMod(modFromScore(C.INT))}) — CHA ${C.CHA} (${fmtMod(modFromScore(C.CHA))})</div>
    <div>HP ${C.HP} — Gold ${C.Gold}</div>
    <div>Bag: ${C.inventory.join(', ') || '—'}</div>
  `;

  // flag panel
  const F = s.flags;
  Engine.el.flagPanel.innerHTML = `
    <div>Rumors heard: ${F.rumors ? 'yes' : 'no'}</div>
    <div>Seals: ${F.seals.join(', ') || '—'}</div>
    <div>Gate ready: ${F.bossReady ? 'yes' : 'no'}</div>
    <div>Unfathomer dealt with: ${F.bossDealtWith ? 'yes' : 'no'}</div>
  `;

  // story area
  Engine.el.storyScroll.innerHTML = '';
  for (const beat of Engine.state.storyBeats) {
    const p = document.createElement('p');
    p.innerHTML = escapeHTML(beat.text);
    if (beat.rollInfo) {
      const g = document.createElement('span');
      g.className = 'rollglyph'; g.textContent = ' ⟡';
      g.title = beat.rollInfo;
      p.appendChild(g);
    }
    if (beat.tone) p.classList.add(beat.tone === 'good' ? 'beat-good' : beat.tone === 'bad' ? 'beat-bad' : 'beat-neutral');
    Engine.el.storyScroll.appendChild(p);
  }
  Engine.el.storyScroll.scrollTop = Engine.el.storyScroll.scrollHeight;

  // Hover chime for buttons (wire once)
  $$('.controls .btn, .choice-btn, .btn-act, .btn-continue').forEach(b => {
    if (!b._hoverWired) { b._hoverWired = true; b.addEventListener('mouseenter', () => Sound.uiHover()); }
    if (!b._pulseWired) { b._pulseWired = true; b.addEventListener('click', ()=>{ b.classList.add('pulse'); setTimeout(()=>b.classList.remove('pulse'), 180); }); }
  });
}

/* ---------- Modals ---------- */
function openModal(m){
  try {
    if (Engine.el.modalShade) Engine.el.modalShade.classList.remove('hidden');
    if (m) m.classList.remove('hidden');
  } catch (e) {
    appendBeat(`[modal error] ${e.message}`); renderAll();
  }
}
function closeModal(m){
  try {
    if (Engine.el.modalShade) Engine.el.modalShade.classList.add('hidden');
    if (m) m.classList.add('hidden');
  } catch (e) {
    appendBeat(`[modal error] ${e.message}`); renderAll();
  }
}
function toast(txt){
  const t = document.createElement('div');
  t.textContent = txt;
  Object.assign(t.style, {position:'fixed', bottom:'14px', left:'14px', background:'#1e1e28', color:'#fff', padding:'8px 10px', border:'1px solid #3a3a48', borderRadius:'6px', opacity:'0.96', zIndex:9999});
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 1200);
}

/* ---------- Character editing ---------- */
function openEdit(){
  const C = Engine.state.character;
  Engine.el.edName.value = C.name;
  Engine.el.edSTR.value = C.STR;
  Engine.el.edDEX.value = C.DEX;
  Engine.el.edINT.value = C.INT;
  Engine.el.edCHA.value = C.CHA;
  Engine.el.edHP.value = C.HP;
  Engine.el.edGold.value = C.Gold;
  Engine.el.edInv.value = C.inventory.join(', ');
  openModal(Engine.el.modalEdit);
}
function saveEdit(){
  const C = Engine.state.character;
  C.name = Engine.el.edName.value.trim() || C.name;
  C.STR = clamp(+Engine.el.edSTR.value||C.STR, 6, 18);
  C.DEX = clamp(+Engine.el.edDEX.value||C.DEX, 6, 18);
  C.INT = clamp(+Engine.el.edINT.value||C.INT, 6, 18);
  C.CHA = clamp(+Engine.el.edCHA.value||C.CHA, 6, 18);
  C.HP  = clamp(+Engine.el.edHP.value ||C.HP , 4, 30);
  C.Gold= clamp(+Engine.el.edGold.value||C.Gold, 0, 999);
  C.inventory = Engine.el.edInv.value.split(',').map(s=>s.trim()).filter(Boolean);
  closeModal(Engine.el.modalEdit);
  renderAll();
}
function autoGen(){
  const names = ['Eldan','Brassa','Keled','Varek','Moriah','Thrain','Ysolda','Kael'];
  const C = Engine.state.character;
  C.name = choice(names);
  C.STR = rnd(8,18); C.DEX = rnd(8,18); C.INT = rnd(8,18); C.CHA = rnd(8,18);
  C.HP = rnd(8,20); C.Gold = rnd(0,25);
  const pool = ['Torch','Canteen','Oil Flask','Bandage','Brass Key'];
  C.inventory = Array.from({length:rnd(1,3)}, ()=>choice(pool)).filter((v,i,self)=>self.indexOf(v)===i);
  renderAll();
}

/* ---------- Game flow ---------- */
function beginTale(){
  const S = Engine.state;
  S.turn = 0;
  S.scene = 'Halls';
  S.storyBeats = [];
  S.transcript = [];
  S.lastStandUsed = false;
  S.buffs = { nextDexBonus: 0 };
  S.flags = { rumors: true, seals: [], bossReady: false, bossDealtWith: false, bossCooldown: 0 };

  appendBeat(
    "Lanterns throw steady light across carved lintels and iron mosaics. Word passes of a slow, otherworldly tide called the Unfathomer, pooling in the buried cisterns. You wait at the mouth of the Halls, corridors opening like patient books.",
    null, 'neutral'
  );

  const firstChoices = makeChoiceSet(S.scene);
  renderChoices(firstChoices);
  if (Engine.el.choicesBox) Engine.el.choicesBox.style.display = 'block';
  S.turn++;
  renderAll();
}

function endTale(){
  const S = Engine.state, C = S.character;
  const seals = S.flags.seals.join(', ') || 'none';
  const dealt = S.flags.bossDealtWith ? 'The Unfathomer is answered. Its pressure eases from the bones of the city.' : 'The Unfathomer still turns beneath the streets.';
  const ep = `Epilogue — You carry ${C.Gold} gold and ${C.inventory.length} keepsakes. Seals gained: ${seals}. ${dealt} Quiet talk in ale-halls carries your name.`;
  appendBeat(ep, null, 'neutral');
  renderChoices([]); // no more choices
  renderAll();
}

function undoTurn(){
  if (Engine.state.turn <= 1) return;
  Engine.state.storyBeats.pop();
  Engine.state.transcript.pop();
  Engine.state.turn = Math.max(0, Engine.state.turn - 1);
  renderChoices(makeChoiceSet(Engine.state.scene));
  renderAll();
}

/* ---------- Choices & actions ---------- */
function renderChoices(choices, maybeBoss){
  const list = Engine.el.choiceList || Engine.el.choicesBox;
  if (!list) return;
  list.innerHTML = '';

  const addBtn = (ch) => {
    if (!ch || !ch.sentence) return;
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = ch.sentence;
    btn.onclick = () => {
      Sound.uiClick();
      if (ch.narrate) return doNarrate(ch);
      resolveChoice(ch);
    };
    btn.addEventListener('mouseenter', () => Sound.uiHover(), { once:false });
    list.appendChild(btn);
  };

  // Two stronger choices max
  (choices || []).slice(0,2).forEach(addBtn);
  if (maybeBoss) addBtn(maybeBoss);

  if (Engine.el.choicesBox) Engine.el.choicesBox.style.display = 'block';
}

function doNarrate(ch){
  const payload = {
    action: ch.sentence,
    source: 'narrate',
    stat: null, dc: null, passed: null,
    game_state: snapshotState(),
    history: recentHistory()
  };
  Promise.resolve(Weaver.turn(payload, localTurn))
    .then(resp => applyTurnResult(resp, null))
    .catch(()=>applyTurnResult(localTurn(payload), null));
}

function resolveChoice(choice){
  const S = Engine.state, C = S.character;

  const stat = choice.stat;
  if (!stat) return doNarrate(choice);

  // compute roll
  let mod = modFromScore(C[stat]);
  if (stat==='DEX' && S.buffs.nextDexBonus){ mod += S.buffs.nextDexBonus; S.buffs.nextDexBonus = 0; }
  const baseDC = 10 + rnd(-1, +3);
  const dc = clamp(baseDC, 8, 18);
  const r = rnd(1,20);
  const total = r + mod;
  const passed = (total >= dc);

  Sound.dice();

  const payload = {
    action: choice.sentence.replace(/\s*\((STR|DEX|INT|CHA)\)\s*$/,'').trim(),
    source: 'choice',
    stat, dc, passed,
    game_state: snapshotState(),
    history: recentHistory()
  };

  Promise.resolve(Weaver.turn(payload, localTurn))
    .then(resp => applyTurnResult(resp, { r, mod, dc, total, passed }))
    .catch(() => applyTurnResult(localTurn(payload), { r, mod, dc, total, passed }));
}

function freeTextAct(){
  const text = (Engine.el.freeText.value || '').trim();
  if (!text) return;
  Engine.el.freeText.value = '';

  // infer if this needs a roll
  const stat = inferStat(text);
  if (stat === 'NARRATE'){
    doNarrate({ sentence: text, narrate:true });
    return;
  }

  const S = Engine.state, C = S.character;
  let mod = modFromScore(C[stat]);
  if (stat==='DEX' && S.buffs.nextDexBonus){ mod += S.buffs.nextDexBonus; S.buffs.nextDexBonus = 0; }

  const dc = clamp(10 + rnd(-1,+3), 8, 18);
  const r = rnd(1,20);
  const total = r + mod;
  const passed = (total >= dc);

  Sound.uiClick(); Sound.dice();

  const payload = {
    action: text,
    source: 'freeText',
    stat, dc, passed,
    game_state: snapshotState(),
    history: recentHistory()
  };

  Promise.resolve(Weaver.turn(payload, localTurn))
    .then(resp => applyTurnResult(resp, { r, mod, dc, total, passed }))
    .catch(()=>applyTurnResult(localTurn(payload), { r, mod, dc, total, passed }));
}

function continueStory(){
  doNarrate({ sentence:'Continue', narrate:true });
}

function applyTurnResult(resp, roll){
  const S = Engine.state;
  const C = S.character;

  // --- State patches ---
  if (resp?.flags_patch) Object.assign(S.flags, resp.flags_patch);

  if (resp?.inventory_delta) {
    const add = resp.inventory_delta.add || [];
    const remove = resp.inventory_delta.remove || [];
    C.inventory = C.inventory.filter(x => !remove.includes(x)).concat(add.filter(x => !C.inventory.includes(x)));
  }
  if (typeof resp?.gold_delta === 'number') {
    C.Gold = Math.max(0, C.Gold + resp.gold_delta);
  }
  if (typeof resp?.hp_delta === 'number') {
    C.HP = Math.max(0, C.HP + resp.hp_delta);
  }

  if (resp?.buffs && typeof resp.buffs.nextDexBonus === 'number') {
    S.buffs.nextDexBonus = resp.buffs.nextDexBonus;
  }

  // --- Tone for beat highlight ---
  let tone = 'neutral';
  if (roll && typeof roll.passed === 'boolean') tone = roll.passed ? 'good' : 'bad';

  // --- Beat text + roll glyph ---
  const rollInfo = roll ? `d20 ${roll.r} ${fmtMod(roll.mod)} vs DC ${roll.dc} ⇒ ${roll.total}` : null;
  appendBeat(resp?.story_paragraph || '(silence)', rollInfo, tone);

  // --- Scene (optional) ---
  if (resp?.scene) S.scene = resp.scene;

  // --- Boss gate heuristic ---
  if (!S.flags.bossReady && S.flags.seals.length >= 2) S.flags.bossReady = true;
  if (S.flags.bossCooldown > 0) S.flags.bossCooldown--;

  // --- Next choices (single render) ---
  const maybeBoss = resp?.maybe_boss_option || null;
  const next = (resp?.next_choices && resp.next_choices.length)
    ? resp.next_choices
    : makeChoiceSet(S.scene);

  renderChoices(next, maybeBoss);

  S.turn++;
  renderAll();

  if (C.HP <= 0) showDeath();
}

/* ---------- Local fallback DM ---------- */
function localTurn(payload){
  const { action, passed, stat, source, game_state } = payload;
  const S = game_state;
  const name = S.character?.name || 'You';
  const seals = S.flags?.seals || [];
  const have = new Set(seals);

  // Award seals sometimes on success
  let awardSeal = null;
  if (passed && have.size < 3 && rnd(1,5) === 1) {
    const pool = ['Brass','Echo','Stone'].filter(x=>!have.has(x));
    if (pool.length) { awardSeal = choice(pool); }
  }

  // ITEM rewards occasionally on success during exploration
  const maybeLoot = (source==='narrate' && rnd(1,6)===1) ? choice(['Bandage','Oil Flask','Brass Key']) : null;

  // Simple HP consequences by stat bucket (with 0 included in range)
  const hpFailRanges = { STR:[0,3], DEX:[0,2], INT:[0,1], CHA:[0,1] };
  let hp_delta = 0, gold_delta = 0;
  if (typeof passed === 'boolean') {
    if (passed) {
      gold_delta = rnd(0,6);
    } else if (stat && hpFailRanges[stat]) {
      const [a,b]=hpFailRanges[stat]; hp_delta = -rnd(a,b);
    }
  }

  // Bandage/Oil simple effects (effects applied when used via modal; here we only award)
  const invAdd = []; if (maybeLoot) invAdd.push(maybeLoot);

  // Narrative
  const beat = craftBeat({ action, passed, stat, name, awardSeal, maybeLoot, source, scene:S.scene });

  // Boss offering: only when ready, no cooldown, and in Depths or when action hints at confrontation
  let maybe_boss_option = null;
  const sealsCount = (awardSeal ? (seals.length+1) : seals.length);
  const ready = (S.flags?.bossReady || sealsCount >= 2) && (S.flags?.bossCooldown||0)===0;
  if (ready && (S.scene==='Depths' || /confront|unfathomer/i.test(action||''))) {
    // Allow three routes; CHA easiest
    maybe_boss_option = { sentence: 'Confront the Unfathomer (CHA)', stat: 'CHA', scene: 'Depths' };
  }

  // If this was a direct confrontation and we rolled:
  let flags_patch = {};
  if (/confront.*unfathomer/i.test(action||'')) {
    if (typeof passed==='boolean') {
      if (passed) {
        flags_patch = { bossDealtWith:true };
      } else {
        flags_patch = { bossCooldown: 2 }; // must take two turns before attempting again
        hp_delta += -rnd(1,3);
      }
    }
  }

  // Scene drift for narration
  let nextScene = S.scene;
  if (source==='narrate') {
    if (S.scene==='Halls' && rnd(1,3)===1) nextScene = 'Archives';
    if (S.scene==='Archives' && rnd(1,3)===1) nextScene = 'Depths';
  }

  // Build next choices (two stronger ones)
  const next_choices = makeChoiceSet(nextScene);

  return {
    story_paragraph: beat,
    flags_patch,
    inventory_delta: { add: invAdd, remove: [] },
    gold_delta,
    hp_delta,
    buffs: {},                 // reserved (e.g., Oil → nextDexBonus; applied when used)
    scene: nextScene,
    next_choices,
    maybe_boss_option
  };
}

function craftBeat({action, passed, stat, name, awardSeal, maybeLoot, source, scene}){
  // More concrete, present-tense narration. Varies openings; avoids repetitive "You ..."
  const opens = [
    'Boots ring once on the tiles',
    'Lamplight searches the carvings',
    'Cold air moves along the arch',
    'Dust hangs in a quiet braid',
    'Stone answers with a low note'
  ];
  const open = choice(opens);

  if (source==='narrate' || !stat){
    const threads = {
      Halls: [
        `${open}. Benches and brasswork repeat like a measured chorus. A narrow door to the east bears scratches: recent, deliberate.`,
        `A worker’s alcove holds a ledger of deliveries. Several entries end with the same sigil — three nested waves.`,
        `Footprints braid and fade. One set trails a scent of lamp oil toward grates that breathe in and out with the city.`
      ],
      Archives: [
        `${open}. Stacks rise like organ pipes; notes in the margins argue with each other. A map of culverts is stitched with red thread.`,
        `Clerks have abandoned their stools in a hurry. A seal stamp lies on the floor, slick with wax, impressed with the word “ECHO”.`,
        `A chalk diagram shows a spiral into the cisterns. A second hand has underlined a single word: Unfathomer.`
      ],
      Depths: [
        `${open}. Water knocks against old pillars and returns in patient rhythm. The air smells like iron and rain.`,
        `The cistern rim glistens; faint shapes move below, as if something breathes through the stone.`,
        `Ropes and hooks sway, unattended. A lantern burns low, its flame bending toward the central pit.`
      ]
    };
    let base = choice(threads[scene] || threads.Halls);
    if (awardSeal) base += ` A sigil warms at your wrist — the Seal of ${awardSeal}.`;
    if (maybeLoot) base += ` Tucked behind a brace you find a ${maybeLoot}.`;
    if (scene!=='Depths') base += ` Rumors point downward; the cisterns hold the clearer answer.`;
    return base;
  }

  // Rolled beats (clear consequences, varied phrasing)
  const successBy = {
    STR: [
      `You lean into the task and the bar gives; a dull crack opens the way.`,
      `Bracing well, you shift the weight; the mechanism concedes a notch.`,
    ],
    DEX: [
      `Careful hands move cleanly; the catch slips without a sound.`,
      `You find the blind angle and pass through before the torch swings back.`
    ],
    INT: [
      `Symbols resolve; the pattern tells you where pressure has been and where it will be.`,
      `Two notes align in your head; the diagram yields a plain route.`
    ],
    CHA: [
      `Your words land steady; faces relax and a gatekeeper shares what they know.`,
      `You give them room to speak; a path appears in their explanation.`
    ]
  };
  const failBy = {
    STR: `The grate creaks under your weight and refuses; its rust smiles in defiance.`,
    DEX: `A shoe scuffs grit; light angles your way and a watcher tenses.`,
    INT: `Details won’t settle; two claims cancel and your guess goes wide.`,
    CHA: `Your tone misfires; expressions harden and the window closes for now.`
  };
  const tail = awardSeal ? ` A sigil warms at your wrist — the Seal of ${awardSeal}.` : '';

  if (passed) return `${choice(successBy[stat])}.${tail}`;
  return `${failBy[stat]}.`;
}

/* ---------- Choice generation (two strong choices + narrative) ---------- */
function makeChoiceSet(scene){
  const sets = {
    Halls: [
      { sentence: 'Study the floor mosaics for wear patterns (INT)', stat: 'INT' },
      { sentence: 'Slip past the patrol routes you marked earlier (DEX)', stat: 'DEX' },
      { sentence: 'Survey benches and lockers for signs of recent use', narrate: true }
    ],
    Archives: [
      { sentence: 'Crosscheck culvert maps and margin notes (INT)', stat: 'INT' },
      { sentence: 'Talk the clerk into showing restricted volumes (CHA)', stat: 'CHA' },
      { sentence: 'Walk the stacks; log each echo and draft', narrate: true }
    ],
    Depths: [
      { sentence: 'Hold your ground when the water swells (STR)', stat: 'STR' },
      { sentence: 'Read the cadence of the tide around the pillars (INT)', stat: 'INT' },
      { sentence: 'Watch the surface and mark where it bends toward the pit', narrate: true }
    ]
  };
  const pool = sets[scene] || sets.Halls;
  // choose two skill checks, keep the narrate option available via Continue button instead
  const checks = pool.filter(p=>p.stat);
  const two = shuffle(checks).slice(0,2);
  return two;
}

/* ---------- Death / Last Stand ---------- */
function showDeath(){
  const D = Engine.el.deathOptions;
  if (!D) return;
  D.innerHTML = '';

  // Flames ambience
  Sound.flamesOn(true);

  const bNew = document.createElement('button');
  bNew.className='btn'; bNew.textContent='New Run'; bNew.onclick=()=>{ Sound.uiClick(); closeModal(Engine.el.modalDeath); beginTale(); };
  D.appendChild(bNew);

  const bLoad = document.createElement('button');
  bLoad.className='btn'; bLoad.textContent='Load'; bLoad.onclick=()=>{ Sound.uiClick(); const s=store.get('dds_state',null); if(s){Engine.state=s; renderAll();} closeModal(Engine.el.modalDeath); };
  D.appendChild(bLoad);

  // Use items
  const C=Engine.state.character;
  if (C.inventory.includes('Bandage')){
    const bBand = document.createElement('button');
    bBand.className='btn'; bBand.textContent='Use Bandage (+2 HP)';
    bBand.onclick=()=>{ Sound.uiClick(); C.HP=Math.max(1,C.HP+2); C.inventory=C.inventory.filter(i=>i!=='Bandage'); Sound.flamesOn(false); closeModal(Engine.el.modalDeath); renderAll(); };
    D.appendChild(bBand);
  }

  if (!Engine.state.lastStandUsed){
    const bLS = document.createElement('button');
    bLS.className='btn'; bLS.textContent='Last Stand';
    bLS.onclick=()=>{ Sound.dice(); const r=rnd(1,20); if (r>=12){ Engine.state.character.HP=1; appendBeat('You find purchase on the very edge of the fall and breathe once, steady.', `d20 ${r} vs 12`, 'good'); } else { appendBeat('Strength leaves your hands; the dark accepts you.', `d20 ${r} vs 12`, 'bad'); } Engine.state.lastStandUsed=true; Sound.flamesOn(false); closeModal(Engine.el.modalDeath); renderAll(); if (Engine.state.character.HP<=0) showDeath(); };
    D.appendChild(bLS);
  }

  openModal(Engine.el.modalDeath);
}

/* ---------- Helpers ---------- */
function appendBeat(text, rollInfo, tone='neutral'){
  Engine.state.storyBeats.push({text, rollInfo, tone});
  Engine.state.transcript.push(text);
}

function snapshotState(){
  const S = Engine.state;
  return {
    character: S.character,
    flags: S.flags,
    scene: S.scene,
    turn: S.turn
  };
}
function recentHistory(){
  const T = Engine.state.transcript;
  return T.slice(Math.max(0, T.length - 10));
}
function inferStat(text){
  const t = text.toLowerCase();
  if (/\b(push|lift|break|smash|force|hold|shove|drag)\b/.test(t)) return 'STR';
  if (/\b(sneak|hide|slip|dodge|climb|balance|steal|pick)\b/.test(t)) return 'DEX';
  if (/\b(look|inspect|study|analyze|read|recall|solve|decipher|investigate)\b/.test(t)) return 'INT';
  if (/\b(speak|persuade|charm|intimidate|perform|negotiate|parley)\b/.test(t)) return 'CHA';
  // No clear action verb: treat as pure narration
  return 'NARRATE';
}
function fmtMod(m){ return (m>=0?'+':'') + m; }
function shuffle(a){ const b=[...a]; for (let i=b.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; } return b; }
function escapeHTML(s){ return s.replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Export transcript ---------- */
function exportTranscript(){
  const S = Engine.state;
  const html = `<!doctype html><meta charset="utf-8">
  <title>Story Transcript</title>
  <style>
    body{font:16px Georgia,serif; margin:32px; color:#222;}
    h1{font:700 22px system-ui,Segoe UI,Roboto,sans-serif}
    .meta{color:#555; margin-bottom:14px}
    p{line-height:1.55}
  </style>
  <h1>Dwarven Deco Storyweaver — Transcript</h1>
  <div class="meta">Engine: ${Weaver.mode==='live'?'Live':'Local'} · Seed ${S.seed} · Turns ${S.turn}</div>
  ${S.transcript.map(t=>`<p>${escapeHTML(t)}</p>`).join('')}
  `;
  const blob = new Blob([html], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'storyweaver_transcript.html';
  a.click();
  URL.revokeObjectURL(url);
}
