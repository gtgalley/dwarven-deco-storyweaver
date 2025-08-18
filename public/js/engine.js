// public/js/engine.js
// v0.3-lite — builds the entire UI at runtime so your index.html can stay tiny.
// Present tense; clear style; dice roll local; Live DM optional via makeWeaver().

import { makeWeaver } from './weaver.js';

/* ---------- tiny utilities ---------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const modFromScore = s => Math.floor((s - 10) / 2);
const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

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
    storyBeats: [],   // {text, rollInfo?}
    transcript: [],   // plain strings of beats for export
    character: {
      name: 'Eldan',
      STR: 12, DEX: 14, INT: 12, CHA: 10,
      HP: 14, Gold: 5,
      inventory: ['Torch', 'Canteen']
    },
    flags: {
      rumors: false,
      seals: [],            // 'Brass','Echo','Stone'
      bossReady: false,
      bossDealtWith: false
    }
  }
};

/* ---------- Weaver bridge ---------- */
const Weaver = makeWeaver(store,
  (msg)=>Engine.state.log.push(msg),
  (tag)=>{ const t = $('#engineTag'); if (t) t.textContent = tag; }
);

/* ---------- UI boot ---------- */
export function boot() {
  buildUI();
  hydrateFromStorage();
  bindHandlers();
  renderAll();
  // auto-begin if no beats yet
  if (Engine.state.storyBeats.length === 0) beginTale();
}

/* ---------- UI construction ---------- */
function buildUI() {
  const root = document.body;
  root.innerHTML = `
  <div id="app" class="app">
    <header class="topbar">
      <div class="brand">
        <strong>Dwarven Deco Storyweaver</strong>
        <span class="tag">Engine: <b id="engineTag">Local</b></span>
      </div>
      <div class="controls">
        <button id="btnEdit">Edit Character</button>
        <button id="btnAuto">Auto-generate</button>
        <button id="btnBegin">Begin Tale</button>
        <button id="btnEnd">End the Story</button>
        <button id="btnUndo">Undo</button>
        <button id="btnSave">Save</button>
        <button id="btnLoad">Load</button>
        <button id="btnExport">Export</button>
        <button id="btnLive">Live DM: Off</button>
        <button id="btnDMConfig">DM Config</button>
      </div>
    </header>

    <main class="main">
      <section class="story">
        <div id="storyScroll" class="story-scroll"></div>
        <div class="choices">
          <div id="choices"></div>
          <div class="free">
            <input id="freeText" type="text" placeholder="Write your own action (e.g., inspect the runes)"/>
            <button id="btnAct">Act</button>
          </div>
        </div>
      </section>

      <aside class="side">
        <div class="card">
          <h3>Character</h3>
          <div id="charPanel"></div>
        </div>
        <div class="card">
          <h3>Flags & Seals</h3>
          <div id="flagPanel"></div>
        </div>
        <div class="card">
          <h3>Session</h3>
          <div>Seed: <span id="seedVal"></span></div>
          <div>Turn: <span id="turnVal"></span></div>
          <div>Scene: <span id="sceneVal"></span></div>
        </div>
      </aside>
    </main>
  </div>

  <!-- Modals -->
  <div id="modalShade" class="shade hidden"></div>

  <div id="modalEdit" class="modal hidden">
    <h3>Edit Character</h3>
    <label>Name <input id="edName" /></label>
    <div class="grid2">
      <label>STR <input id="edSTR" type="number" min="6" max="18"/></label>
      <label>DEX <input id="edDEX" type="number" min="6" max="18"/></label>
      <label>INT <input id="edINT" type="number" min="6" max="18"/></label>
      <label>CHA <input id="edCHA" type="number" min="6" max="18"/></label>
      <label>HP  <input id="edHP"  type="number" min="4" max="30"/></label>
      <label>Gold<input id="edGold"type="number" min="0" max="999"/></label>
    </div>
    <label>Inventory (comma separated)
      <input id="edInv" />
    </label>
    <div class="modal-actions">
      <button id="btnEditSave">Save</button>
      <button id="btnEditCancel">Cancel</button>
    </div>
  </div>

  <div id="modalDM" class="modal hidden">
    <h3>DM Config</h3>
    <label>Endpoint
      <input id="dmEndpoint" placeholder="/dm-turn"/>
    </label>
    <div class="modal-actions">
      <button id="btnSaveDM">Save</button>
      <button id="btnCancelDM">Cancel</button>
    </div>
  </div>
  `;

  // minimal fallback CSS if your external stylesheet is empty
  const style = document.createElement('style');
  style.textContent = `
    body { margin:0; font: 15px system-ui, Segoe UI, Roboto, sans-serif; background:#0c0c0f; color:#e9e9ef; }
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#141419; border-bottom:1px solid #30303a;}
    .controls button { margin:4px; }
    .main { display:flex; gap:12px; padding:12px; }
    .story { flex: 1 1 70%; display:flex; flex-direction:column; gap:10px; }
    .story-scroll { background:#111118; border:1px solid #2b2b35; border-radius:8px; padding:14px; min-height:52vh; max-height:68vh; overflow:auto; }
    .story-scroll p { margin: 0 0 12px 0; line-height:1.45; }
    .choices { background:#111118; border:1px solid #2b2b35; border-radius:8px; padding:10px; }
    .choice-btn { display:block; width:100%; text-align:left; margin:6px 0; padding:10px; background:#1a1a22; border:1px solid #333343; border-radius:6px; cursor:pointer; }
    .choice-btn:hover { background:#232330; }
    .free { margin-top:8px; display:flex; gap:6px; }
    .free input { flex:1; padding:8px; border-radius:6px; border:1px solid #343444; background:#15151d; color:#ddd; }
    .side { flex: 1 1 30%; display:flex; flex-direction:column; gap:12px; }
    .card { background:#111118; border:1px solid #2b2b35; border-radius:8px; padding:12px; }
    .shade { position:fixed; inset:0; background:#0008; }
    .modal { position:fixed; top:10%; left:50%; transform:translateX(-50%); width:min(600px, 92vw); background:#15151d; border:1px solid #3a3a48; border-radius:10px; padding:16px; }
    .hidden { display:none; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:8px 0; }
    label { display:block; margin:6px 0; }
    input[type="text"], input[type="number"] { width:100%; padding:6px 8px; border-radius:6px; border:1px solid #36364a; background:#12121a; color:#eaeaf1; }
    .rollglyph { opacity:0.7; margin-left:4px; cursor:help; }
    .tag b { font-weight:700; }
  `;
  document.head.appendChild(style);

  // cache refs
  Engine.el.storyScroll = $('#storyScroll');
  Engine.el.choicesBox = document.querySelector('.choices');
  Engine.el.choiceList = document.getElementById('choices');
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
  Engine.el.freeText = $('#freeText');

  Engine.el.modalShade = $('#modalShade');
  Engine.el.modalEdit = $('#modalEdit');
  Engine.el.edName = $('#edName'); Engine.el.edSTR = $('#edSTR'); Engine.el.edDEX = $('#edDEX');
  Engine.el.edINT = $('#edINT'); Engine.el.edCHA = $('#edCHA'); Engine.el.edHP = $('#edHP'); Engine.el.edGold = $('#edGold'); Engine.el.edInv = $('#edInv');
  Engine.el.btnEditSave = $('#btnEditSave'); Engine.el.btnEditCancel = $('#btnEditCancel');

  Engine.el.modalDM = $('#modalDM'); Engine.el.dmEndpoint = $('#dmEndpoint');
  Engine.el.btnSaveDM = $('#btnSaveDM'); Engine.el.btnCancelDM = $('#btnCancelDM');
}

function hydrateFromStorage() {
  const saved = store.get('dds_state', null);
  if (saved) Engine.state = saved;
}

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
  Engine.el.btnDMConfig.onclick = () => { openModal(Engine.el.modalDM); Engine.el.dmEndpoint.value = Weaver.endpoint; };
  Engine.el.btnSaveDM.onclick = () => { Weaver.setEndpoint(Engine.el.dmEndpoint.value); closeModal(Engine.el.modalDM); toast('Endpoint saved'); };
  Engine.el.btnCancelDM.onclick = () => closeModal(Engine.el.modalDM);

  Engine.el.btnEditSave.onclick = saveEdit;
  Engine.el.btnEditCancel.onclick = () => closeModal(Engine.el.modalEdit);

  Engine.el.btnAct.onclick = () => freeTextAct();
  Engine.el.freeText.addEventListener('keydown', (e)=>{ if (e.key==='Enter') freeTextAct(); });
}

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
    Engine.el.storyScroll.appendChild(p);
  }
  Engine.el.storyScroll.scrollTop = Engine.el.storyScroll.scrollHeight;

  // choices will be re-rendered per-turn
}

/* ---------- Modals ---------- */
function openModal(m){ Engine.el.modalShade.classList.remove('hidden'); m.classList.remove('hidden'); }
function closeModal(m){ Engine.el.modalShade.classList.add('hidden'); m.classList.add('hidden'); }
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
  C.name = names[rnd(0,names.length-1)];
  C.STR = rnd(8,18); C.DEX = rnd(8,18); C.INT = rnd(8,18); C.CHA = rnd(8,18);
  C.HP = rnd(8,20); C.Gold = rnd(0,25);
  C.inventory = ['Torch','Canteen','Oil Flask'].slice(0, rnd(1,3));
  renderAll();
}

/* ---------- Game flow ---------- */
function beginTale(){
  const S = Engine.state;
  S.turn = 0;
  S.scene = 'Halls';
  S.storyBeats = [];
  S.transcript = [];
  S.flags = { rumors: true, seals: [], bossReady: false, bossDealtWith: false };

  appendBeat("Torches breathe along brasswork and shadow. Rumors speak of an otherworldly tide — the Unfathomer — pooling beneath the city’s vaults. You stand at the threshold of the Halls, where echoing floors remember every step.");

  // ensure visible choices immediately
  const firstChoices = makeChoiceSet(S.scene);
  renderChoices(firstChoices);

  S.turn++;
  renderAll();
}

function endTale(){
  const S = Engine.state, C = S.character;
  const seals = S.flags.seals.join(', ') || 'none';
  const dealt = S.flags.bossDealtWith ? 'You face the Unfathomer, and the crisis is resolved.' : 'The Unfathomer still turns beneath the world.';
  const ep = `Epilogue — You carry ${C.Gold} gold and ${C.inventory.length} keepsakes. Seals gained: ${seals}. ${dealt} The city holds its breath, then exhales, and your name threads through quiet conversations.`;
  appendBeat(ep);
  renderChoices([]); // no more choices
  renderAll();
}

function undoTurn(){
  if (Engine.state.turn <= 1) return;
  // simple undo: pop last beat and choices; turn--
  Engine.state.storyBeats.pop();
  Engine.state.transcript.pop();
  Engine.state.turn = Math.max(0, Engine.state.turn - 1);
  renderChoices(makeChoiceSet(Engine.state.scene));
  renderAll();
}

/* ---------- Choices & actions ---------- */
function renderChoices(choices, maybeBoss){
  const list = Engine.el.choiceList;
  if (!list) return;
  list.innerHTML = '';

  const addBtn = (ch) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = ch.sentence;
    btn.onclick = () => resolveChoice(ch);
    list.appendChild(btn);
  };

  (choices || []).forEach(addBtn);
  if (maybeBoss) addBtn(maybeBoss);
}

function resolveChoice(choice){
  // Determine DC; do roll locally
  const S = Engine.state, C = S.character;
  const stat = choice.stat;
  const mod = modFromScore(C[stat]);
  const dc = clamp(10 + rnd(-1, +3), 8, 18);
  const r = rnd(1,20);
  const total = r + mod;
  const passed = (total >= dc);

  const payload = {
    action: choice.sentence.replace(/\s*\((STR|DEX|INT|CHA)\)\s*$/,'').trim(),
    source: 'choice',
    stat, dc, passed,
    game_state: snapshotState(),
    history: recentHistory()
  };

  Weaver.turn(payload, localTurn).then((resp)=>{
    applyTurnResult(resp, {r, mod, dc, total});
  });
}

function freeTextAct(){
  const text = (Engine.el.freeText.value || '').trim();
  if (!text) return;
  Engine.el.freeText.value = '';

  const stat = inferStat(text);
  const S = Engine.state, C = S.character;
  const mod = modFromScore(C[stat]);
  const dc = clamp(10 + rnd(-1, +3), 8, 18);
  const r = rnd(1,20);
  const total = r + mod;
  const passed = (total >= dc);

  const payload = {
    action: text,
    source: 'freeText',
    stat, dc, passed,
    game_state: snapshotState(),
    history: recentHistory()
  };

  Weaver.turn(payload, localTurn)
    .then((resp)=> applyTurnResult(resp, {r, mod, dc, total}))
    .catch(()=> {
      // absolute fallback: local narration if something unexpected happens
      const resp = localTurn(payload);
      applyTurnResult(resp, {r, mod, dc, total});
    });
}

function applyTurnResult(resp, roll){
  const S = Engine.state;

  // State patches
  if (resp.flags_patch) {
    Object.assign(S.flags, resp.flags_patch);
  }
  if (resp.inventory_delta) {
    const add = resp.inventory_delta.add||[], remove = resp.inventory_delta.remove||[];
    S.character.inventory = S.character.inventory.filter(x=>!remove.includes(x)).concat(add);
  }
  if (typeof resp.gold_delta === 'number') {
    S.character.Gold = Math.max(0, S.character.Gold + resp.gold_delta);
  }

  // Beat text + roll glyph
  appendBeat(resp.story_paragraph || '(silence)', `d20 ${roll.r} ${fmtMod(roll.mod)} vs DC ${roll.dc} ⇒ ${roll.total}`);

  // Next choices
  let maybeBoss = resp.maybe_boss_option || null;
  renderChoices(resp.next_choices || makeChoiceSet(S.scene), maybeBoss);
  
  let next = resp.next_choices && resp.next_choices.length ? resp.next_choices : makeChoiceSet(Engine.state.scene);
  renderChoices(next, maybeBoss);
  
  // scene stays or changes if response set it
  if (resp.scene) S.scene = resp.scene;

  // unlock gate if 2+ seals
  if (!S.flags.bossReady && S.flags.seals.length >= 2) S.flags.bossReady = true;

  S.turn++;
  renderAll();
}

/* ---------- Local fallback DM ---------- */
function localTurn(payload){
  const { action, passed, stat, game_state } = payload;
  const S = game_state;
  const name = S.character?.name || 'You';
  const seals = S.flags?.seals || [];
  const have = new Set(seals);

  // Chance to award a seal on success
  let awardSeal = null;
  if (passed && have.size < 3 && rnd(1,5) === 1) {
    const pool = ['Brass','Echo','Stone'].filter(x=>!have.has(x));
    if (pool.length) { awardSeal = pool[rnd(0,pool.length-1)]; }
  }

  const beat = makeBeatText({action, passed, stat, name, awardSeal});
  // Apply patches we promise in local path
  const flags_patch = {};
  if (awardSeal) flags_patch.seals = [...seals, awardSeal];

  const next_choices = makeChoiceSet(S.scene);
  let maybe_boss_option = null;
  const sealsCount = (awardSeal ? (seals.length+1) : seals.length);
  if ((S.flags?.bossReady || sealsCount >= 2)) {
    maybe_boss_option = { sentence: 'You confront the Unfathomer (CHA)', stat: 'CHA', scene: 'Depths' };
  }

  return {
    story_paragraph: beat,
    flags_patch,
    inventory_delta: { add: [], remove: [] },
    gold_delta: 0,
    next_choices,
    maybe_boss_option
  };
}

function makeBeatText({action, passed, stat, name, awardSeal}){
  const verbs = {
    STR: ['you force the way','you wrestle the obstacle','you brace and heave'],
    DEX: ['you move with quiet balance','you slip along blind angles','you work with careful hands'],
    INT: ['you reason through the pattern','you trace the hidden logic','you test a small hypothesis'],
    CHA: ['you speak with steady poise','you read the room and guide it','you put warm conviction to work']
  };
  const failNotes = {
    STR: 'Your grip bites and the metal sings; the hall hears too much.',
    DEX: 'A heel kisses grit; the torchlight notices.',
    INT: 'Two symbols argue; the truth steps back.',
    CHA: 'A word lands wrong; faces cool a measure.'
  };
  const successLine = `${verbs[stat][rnd(0, verbs[stat].length-1)]} and the moment tilts your way.`;
  const failLine = `${failNotes[stat]}`;
  const sealLine = awardSeal ? ` A faint sigil warms at your wrist — the Seal of ${awardSeal}.` : '';
  const rumorNudge = ` The city still whispers about the Unfathomer below; its tide is patient, not kind.`;

  if (passed) {
    return `${capitalize(action)}. ${successLine}${sealLine}${rumorNudge}`;
  } else {
    return `${capitalize(action)}. ${failLine}${rumorNudge}`;
  }
}

/* ---------- Choice generation ---------- */
function makeChoiceSet(scene){
  const sets = {
    Halls: [
      { sentence: 'You study the floor mosaics (INT)', stat: 'INT', scene: 'Halls' },
      { sentence: 'You slip between patrols (DEX)', stat: 'DEX', scene: 'Halls' },
      { sentence: 'You pry the rusted grate (STR)', stat: 'STR', scene: 'Halls' }
    ],
    Archives: [
      { sentence: 'You scan the index sigils (INT)', stat: 'INT', scene: 'Archives' },
      { sentence: 'You charm a wary scribe (CHA)', stat: 'CHA', scene: 'Archives' },
      { sentence: 'You reach a high ledge (DEX)', stat: 'DEX', scene: 'Archives' }
    ],
    Depths: [
      { sentence: 'You hold your ground (STR)', stat: 'STR', scene: 'Depths' },
      { sentence: 'You read the tide’s cadence (INT)', stat: 'INT', scene: 'Depths' },
      { sentence: 'You defy it with clear words (CHA)', stat: 'CHA', scene: 'Depths' }
    ]
  };
  const pool = sets[scene] || sets.Halls;
  // randomize a little
  return shuffle(pool).slice(0,3);
}

/* ---------- Helpers ---------- */
function appendBeat(text, rollInfo){
  Engine.state.storyBeats.push({text, rollInfo});
  Engine.state.transcript.push(text);
}

function snapshotState(){
  // Keep it tight to avoid huge payloads
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
  return T.slice(Math.max(0, T.length - 10)); // last 10 beats
}
function inferStat(text){
  const t = text.toLowerCase();
  if (/\b(push|lift|break|smash|force|hold|shove|drag)\b/.test(t)) return 'STR';
  if (/\b(sneak|hide|slip|dodge|climb|balance|steal|pick)\b/.test(t)) return 'DEX';
  if (/\b(look|inspect|study|analyze|read|recall|solve|decipher|investigate)\b/.test(t)) return 'INT';
  if (/\b(speak|persuade|charm|intimidate|perform|negotiate|parley)\b/.test(t)) return 'CHA';
  return 'INT';
}
function fmtMod(m){ return (m>=0?'+':'') + m; }
function capitalize(s){ return s ? s[0].toUpperCase()+s.slice(1) : s; }
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
