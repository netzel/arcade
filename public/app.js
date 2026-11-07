// Super Games Arcade — shell.
// Home screen, player profiles, and the in-game menu (save, load, restart,
// switch game, sound, full screen). Games run in a same-origin <iframe> and are
// controlled through window.ArcadeBridge (see arcade-bridge.js).

import {
  SLOT_COUNT, readSaves, writeSave, deleteSave, getSlot, timeAgo, readSettings, writeSettings,
} from './saves.js';

const CONFIG = window.ARCADE_CONFIG || { siteName: 'Super Games Arcade', players: [], games: [] };
const GAMES = CONFIG.games || [];
const PLAYERS = CONFIG.players || [];
const RESTORE_KEY = 'sga:restore';
const AUTOSAVE_MS = 20000;
const LOAD_TIMEOUT_MS = 20000;

let storage;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = memoryStorage(); }
let settings = readSettings(storage);

const $ = (id) => document.getElementById(id);
const els = {
  home: $('home'), players: $('players'), play: $('play'),
  grid: $('game-grid'), playerChip: $('player-chip'), homeSound: $('home-sound'), playerList: $('player-list'),
  frame: $('game-frame'), stage: $('stage'), loading: $('loading'), loadingEmoji: $('loading-emoji'),
  loadingText: $('loading-text'), loadingActions: $('loading-actions'),
  fab: $('menu-fab'), sheet: $('sheet'), sheetCard: $('sheet-card'), toast: $('toast'),
  rotate: $('rotate-hint'), rotateText: $('rotate-text'),
};

/** Current game session (null on the home screen). */
let session = null;
let autosaveTimer = null;
let loadTimer = null;
let sheetView = null;   // name of the open menu view
let lastFocus = null;

// ── Tiny DOM helper ─────────────────────────────────────────────────────
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// ── Players ─────────────────────────────────────────────────────────────
function currentPlayer() {
  if (!PLAYERS.length) return null;
  return PLAYERS.find((p) => p.id === settings.player) || null;
}
function playerId() { return currentPlayer()?.id || '_'; }

function renderPlayerChip() {
  const p = currentPlayer();
  els.playerChip.hidden = !PLAYERS.length;
  if (!p) return;
  els.playerChip.replaceChildren(h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, p.emoji), h('span', { class: 'chip-name' }, p.name));
  els.playerChip.setAttribute('aria-label', `Playing as ${p.name}. Tap to switch player.`);
}

function showPlayerPicker() {
  const me = currentPlayer();
  els.playerList.replaceChildren(...PLAYERS.map((p, i) => h('button', {
    class: `player-btn${me && me.id === p.id ? ' current' : ''}`, type: 'button', style: { animationDelay: `${i * 60}ms` },
    onclick: () => {
      settings = writeSettings(storage, { player: p.id });
      goHome();
      toast(`Hi ${p.name}! ${p.emoji}`);
    },
  }, h('span', { class: 'player-emoji', 'aria-hidden': 'true' }, p.emoji), h('span', { class: 'player-name' }, p.name))));
  showScreen('players');
  els.playerList.querySelector('button')?.focus({ preventScroll: true });
}

// ── Sound ───────────────────────────────────────────────────────────────
function isMuted() { return !!settings.muted; }
function setMuted(m) {
  settings = writeSettings(storage, { muted: !!m });
  bridge()?.setMuted(!!m);
  renderSoundButtons();
}
function renderSoundButtons() {
  els.homeSound.textContent = isMuted() ? '🔇' : '🔊';
  els.homeSound.setAttribute('aria-label', isMuted() ? 'Sound is off. Turn sound on.' : 'Sound is on. Turn sound off.');
}

// ── Screens & routing ──────────────────────────────────────────────────
function showScreen(name) {
  for (const s of ['home', 'players', 'play']) els[s].hidden = s !== name;
  document.body.dataset.screen = name;
}

function gameById(id) { return GAMES.find((g) => g.id === id) || null; }

/** Launch intent for the next #/play route: { mode: 'new' | 'continue' | 'slot', slot }. */
let pendingLaunch = null;

function playGame(id, mode = 'new', slot = null) {
  pendingLaunch = { id, mode, slot };
  const target = `#/play/${encodeURIComponent(id)}`;
  if (location.hash === target) route(); else location.hash = target;
}

function goHome() {
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else route();
}

function route() {
  const m = location.hash.match(/^#\/play\/([^/?#]+)/);
  const game = m ? gameById(decodeURIComponent(m[1])) : null;

  if (game) {
    if (PLAYERS.length && !currentPlayer()) { pendingLaunch = null; location.replace('#/'); return; }
    const launch = pendingLaunch && pendingLaunch.id === game.id ? pendingLaunch : null;
    pendingLaunch = null;
    // Refresh / deep link with no explicit intent: pick up where they left off.
    const mode = launch ? launch.mode : (getSlot(storage, playerId(), game.id, 'auto') ? 'continue' : 'new');
    startSession(game, mode, launch?.slot ?? null);
    return;
  }

  if (session) endSession();
  closeSheet();
  if (PLAYERS.length && !currentPlayer()) { showPlayerPicker(); return; }
  renderHome();
  showScreen('home');
}

// ── Home screen ────────────────────────────────────────────────────────
function renderHome() {
  renderPlayerChip();
  renderSoundButtons();
  if (!GAMES.length) {
    els.grid.replaceChildren(h('p', { class: 'empty-state' }, 'No games yet! Add an .html game to the games folder. 🎮'));
    return;
  }
  els.grid.replaceChildren(...GAMES.map((g, i) => gameCard(g, i)));
}

function gameCard(g, i) {
  const saves = readSaves(storage, playerId(), g.id);
  const auto = saves.auto;
  const hasSlots = saves.slots.some(Boolean);
  const primary = () => playGame(g.id, auto ? 'continue' : 'new');

  const art = h('button', {
    class: 'game-art', type: 'button', vars: { '--c1': g.colors[0], '--c2': g.colors[1] },
    'aria-label': `${auto ? 'Continue' : 'Play'} ${g.title}`, onclick: primary,
  },
  auto?.thumb ? h('img', { src: auto.thumb, alt: '' }) : h('span', { class: 'art-emoji', 'aria-hidden': 'true' }, g.emoji),
  auto ? h('span', { class: 'art-badge' }, `Saved ${timeAgo(auto.savedAt)}`) : null,
  h('span', { class: 'art-play', 'aria-hidden': 'true' }, '▶'));

  const actions = [];
  if (auto) {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: primary }, '▶ Continue'));
    actions.push(h('button', {
      class: 'btn', type: 'button',
      onclick: () => confirmView({
        emoji: '✨', title: 'Start a new game?', message: `Your other saved games stay safe.`,
        yes: 'Start new', onYes: () => { closeSheet(); playGame(g.id, 'new'); },
      }),
    }, '✨ New'));
  } else {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: primary }, '▶ Play'));
  }
  if (hasSlots) {
    actions.push(h('button', { class: 'btn', type: 'button', onclick: () => loadView(g, { fromHome: true }) }, '📂 Saves'));
  }

  return h('article', { class: 'game-card', style: { animationDelay: `${i * 70}ms` } },
    art,
    h('div', { class: 'game-body' },
      h('h2', { class: 'game-title' }, g.title),
      g.tagline ? h('p', { class: 'game-tagline' }, g.tagline) : null,
      h('div', { class: 'game-actions' }, actions)));
}

// ── Game session ───────────────────────────────────────────────────────
function bridge() {
  try { return els.frame.contentWindow?.ArcadeBridge || null; } catch { return null; }
}

function startSession(game, mode, slot) {
  if (session) endSession({ keepScreen: true });
  closeSheet();

  let restore = null;
  if (mode === 'continue') restore = getSlot(storage, playerId(), game.id, 'auto');
  else if (mode === 'slot') restore = getSlot(storage, playerId(), game.id, slot);
  try {
    if (restore) sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ gameId: game.id, version: restore.version, state: restore.state }));
    else sessionStorage.removeItem(RESTORE_KEY);
  } catch { restore = null; }

  session = { game, canSave: false, loaded: false, wantedRestore: !!restore, slotLabel: slotLabel(mode === 'slot' ? slot : 'auto') };
  document.title = `${game.title} · ${CONFIG.siteName}`;
  showScreen('play');
  els.stage.style.setProperty('--game-bg', game.background);
  els.loading.style.setProperty('--c1', game.colors[0]);
  els.loading.style.setProperty('--c2', game.colors[1]);
  els.loadingEmoji.textContent = game.emoji;
  els.loadingText.textContent = restore ? `Loading your game…` : `Loading ${game.title}…`;
  els.loadingActions.hidden = true;
  els.loading.classList.remove('done');
  els.fab.dataset.pos = game.menuButton || 'top-left';
  els.frame.title = game.title;

  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (session && !session.loaded) {
      els.loadingText.textContent = 'Hmm, this game is taking a long time to load.';
      els.loadingActions.hidden = false;
    }
  }, LOAD_TIMEOUT_MS);

  els.frame.src = `${game.path}?b=${CONFIG.buildId || ''}`;
  updateRotateHint();
}

els.frame.addEventListener('load', () => {
  if (!session || els.frame.src === 'about:blank' || els.frame.getAttribute('src') === 'about:blank') return;
  session.loaded = true;
  clearTimeout(loadTimer);
  els.loading.classList.add('done');
  bridge()?.setMuted(isMuted());
  focusGame();
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => { if (!sheetView && !document.hidden) autosave(); }, AUTOSAVE_MS);
  // Prime a thumbnail so the first autosave has a picture.
  setTimeout(() => bridge()?.refreshThumb?.(), 1500);
});

function endSession({ keepScreen = false } = {}) {
  if (!session) return;
  autosave();
  clearInterval(autosaveTimer);
  clearTimeout(loadTimer);
  session = null;
  els.frame.src = 'about:blank';
  els.rotate.hidden = true;
  document.title = CONFIG.siteName;
  if (!keepScreen) showScreen('home');
}

function focusGame() {
  try { els.frame.contentWindow?.focus(); } catch { /* ignore */ }
}

/** Called by the bridge inside the game frame. */
window.ArcadeShell = {
  bridgeEvent(type, data, source) {
    // Ignore events from a game page that is being unloaded/replaced.
    if (!session || source !== els.frame.contentWindow) return;
    if (type === 'register') {
      session.canSave = !!data.canSave;
      if (session.wantedRestore) {
        if (data.restored) toast('Welcome back! 🌟');
        else if (data.restoreFailed) toast("Couldn't open that save 😕 Starting fresh.");
        else if (!data.canSave) toast("This game can't load saves yet.");
        session.wantedRestore = false;
      }
      if (sheetView === 'pause') pauseView(); // refresh Save/Load buttons
    } else if (type === 'menu') {
      toggleMenu();
    }
  },
};

/** Write the Continue slot. Clears it if the game says there's nothing to keep. */
function autosave() {
  if (!session || !session.loaded || !session.canSave) return;
  const b = bridge();
  if (!b) return;
  let snap;
  try { snap = b.getState(); } catch (e) { console.error('[arcade] getState failed', e); return; }
  if (!snap || !snap.supported) return;
  if (snap.state == null) { deleteSave(storage, playerId(), session.game.id, 'auto'); return; }
  writeSave(storage, playerId(), session.game.id, 'auto', { state: snap.state, version: snap.version, thumb: b.thumbnail() });
  b.refreshThumb?.();
}

function onHidden() {
  if (!session) return;
  autosave();
  if (!sheetView) openMenu();
}

// ── Sheet (menu) plumbing ──────────────────────────────────────────────
function openSheet(view, content) {
  if (!sheetView) lastFocus = document.activeElement;
  sheetView = view;
  els.sheetCard.replaceChildren(...content.filter(Boolean));
  els.sheet.hidden = false;
  if (session) bridge()?.pause();
  const first = els.sheetCard.querySelector('[data-autofocus]') || els.sheetCard.querySelector('button:not(:disabled)');
  first?.focus({ preventScroll: true });
}

function closeSheet() {
  if (!sheetView) return;
  sheetView = null;
  els.sheet.hidden = true;
  els.sheetCard.replaceChildren();
  if (session) { bridge()?.resume(); focusGame(); }
  else lastFocus?.focus?.({ preventScroll: true });
}

function openMenu() { if (session) pauseView(); }
function toggleMenu() { if (sheetView) closeSheet(); else openMenu(); }

function sheetHead({ emoji, title, sub, back }) {
  return h('div', { class: 'sheet-head' },
    emoji ? h('span', { class: 'head-emoji', 'aria-hidden': 'true' }, emoji) : null,
    h('div', { style: { flex: '1', minWidth: '0' } },
      h('h2', { class: 'sheet-title', id: 'sheet-title' }, title),
      sub ? h('p', { class: 'sheet-sub' }, sub) : null),
    back ? h('button', { class: 'btn btn-small sheet-back', type: 'button', onclick: back }, '← Back') : null);
}

function tile(icon, label, onclick, opts = {}) {
  return h('button', {
    class: `tile${opts.wide ? ' tile-wide' : ''}${opts.primary ? ' tile-primary' : ''}`,
    type: 'button', onclick, disabled: opts.disabled, 'aria-label': opts.aria, 'data-autofocus': opts.autofocus,
  }, h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('span', null, label));
}

// ── Pause menu ─────────────────────────────────────────────────────────
function canFullscreen() {
  const d = document;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return !standalone && !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}
function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function toggleFullscreen() {
  const d = document, el = d.documentElement;
  try {
    if (isFullscreen()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => toast("Full screen isn't available here."));
  } catch { toast("Full screen isn't available here."); }
}

function pauseView() {
  const g = session.game;
  const player = currentPlayer();
  const saveOk = session.canSave;
  const subParts = [];
  if (player) subParts.push(`${player.emoji} ${player.name}`);
  if (g.controls) subParts.push(g.controls);

  const tiles = [
    tile('▶', 'Keep Playing', closeSheet, { wide: true, primary: true, autofocus: true }),
    tile('💾', 'Save', () => saveView(), { disabled: !saveOk }),
    tile('📂', 'Load', () => loadView(g), { disabled: !saveOk }),
    tile('🔄', 'Start Over', () => confirmView({
      emoji: '🔄', title: 'Start over?', message: 'This game starts from the beginning. Your saved games stay safe.',
      yes: 'Start over', danger: true, back: pauseView,
      onYes: () => { closeSheet(); deleteSave(storage, playerId(), g.id, 'auto'); session.canSave = false; startSession(g, 'new'); },
    })),
    tile('🎮', 'Other Games', switchView, { disabled: GAMES.length < 2 }),
    tile(isMuted() ? '🔇' : '🔊', isMuted() ? 'Sound Off' : 'Sound On', () => { setMuted(!isMuted()); pauseView(); }),
    tile('🏠', 'Arcade', () => { closeSheet(); goHome(); }),
  ];
  if (canFullscreen()) tiles.push(tile(isFullscreen() ? '🗗' : '⛶', isFullscreen() ? 'Exit Full Screen' : 'Full Screen', () => { toggleFullscreen(); closeSheet(); }));
  if (PLAYERS.length > 1) tiles.push(tile('👋', 'Switch Player', () => { closeSheet(); location.hash = '#/'; showPlayerPicker(); }));

  openSheet('pause', [
    sheetHead({ emoji: g.emoji, title: g.title, sub: subParts.join(' · ') }),
    h('div', { class: 'tile-grid' }, tiles),
    saveOk ? null : h('p', { class: 'sheet-note' }, "This game doesn't support saving yet."),
  ]);
}

function slotLabel(slot) { return slot === 'auto' ? 'Where you left off' : `Save ${slot + 1}`; }

function slotRow(game, slot, entry, { onPick, onDelete, emptyLabel, pickDisabled }) {
  const thumb = h('span', { class: 'slot-thumb', vars: { '--c1': game.colors[0], '--c2': game.colors[1] }, 'aria-hidden': 'true' },
    entry?.thumb ? h('img', { src: entry.thumb, alt: '' }) : (entry ? game.emoji : '＋'));
  const label = slotLabel(slot);
  return h('div', { class: 'slot' },
    h('button', { class: 'slot-main', type: 'button', onclick: onPick, disabled: pickDisabled },
      thumb,
      h('span', { class: 'slot-text' },
        h('span', { class: 'slot-name' }, label),
        h('span', { class: 'slot-when' }, entry ? `Saved ${timeAgo(entry.savedAt)}` : emptyLabel))),
    entry && onDelete ? h('button', { class: 'slot-del', type: 'button', 'aria-label': `Delete ${label}`, onclick: onDelete }, '🗑️') : null);
}

// ── Save ───────────────────────────────────────────────────────────────
function saveView() {
  const g = session.game;
  const saves = readSaves(storage, playerId(), g.id);
  const rows = saves.slots.map((entry, i) => slotRow(g, i, entry, {
    emptyLabel: 'Empty — tap to save here',
    onPick: () => {
      if (!entry) return doSave(i);
      confirmView({
        emoji: '💾', title: `Replace ${slotLabel(i)}?`, message: `The game saved ${timeAgo(entry.savedAt)} will be replaced with this one.`,
        yes: 'Replace it', back: saveView, onYes: () => doSave(i),
      });
    },
  }));
  openSheet('save', [
    sheetHead({ emoji: '💾', title: 'Save your game', sub: 'Pick a spot', back: pauseView }),
    h('div', { class: 'slot-list' }, rows),
  ]);
}

function doSave(slot) {
  const b = bridge();
  let snap = null;
  try { snap = b?.getState(); } catch (e) { console.error('[arcade] getState failed', e); }
  if (!snap || !snap.supported) { toast("Couldn't save this game 😕"); pauseView(); return; }
  if (snap.state == null) { toast('Start playing first, then save! 🎮'); pauseView(); return; }
  const res = writeSave(storage, playerId(), session.game.id, slot, { state: snap.state, version: snap.version, thumb: b.thumbnail() });
  if (res.ok) toast(`Saved to ${slotLabel(slot)}! ⭐`);
  else toast(res.reason === 'storage-full' ? 'This device is out of space for saves 😕' : "Couldn't save 😕");
  pauseView();
}

// ── Load ───────────────────────────────────────────────────────────────
function loadView(game, { fromHome = false } = {}) {
  const saves = readSaves(storage, playerId(), game.id);
  const pick = (slot, entry) => () => {
    const go = () => { closeSheet(); playGame(game.id, slot === 'auto' ? 'continue' : 'slot', slot === 'auto' ? null : slot); };
    if (fromHome) return go();
    confirmView({
      emoji: '📂', title: `Load ${slotLabel(slot)}?`, message: "Anything you haven't saved in this game will be lost.",
      yes: 'Load it', back: () => loadView(game), onYes: go,
    });
  };
  const del = (slot, entry) => () => confirmView({
    emoji: '🗑️', title: `Delete ${slotLabel(slot)}?`, message: `This save from ${timeAgo(entry.savedAt)} will be gone for good.`,
    yes: 'Delete', danger: true, back: () => loadView(game, { fromHome }),
    onYes: () => {
      deleteSave(storage, playerId(), game.id, slot);
      toast('Save deleted');
      if (!session) renderHome();
      loadView(game, { fromHome });
    },
  });

  const rows = [];
  // While playing, the "where you left off" slot is the game they're in, so only offer it from home.
  if (fromHome && saves.auto) rows.push(slotRow(game, 'auto', saves.auto, { onPick: pick('auto', saves.auto), onDelete: del('auto', saves.auto) }));
  saves.slots.forEach((entry, i) => rows.push(slotRow(game, i, entry, {
    emptyLabel: 'Empty', pickDisabled: !entry, onPick: entry ? pick(i, entry) : null, onDelete: entry ? del(i, entry) : null,
  })));
  const anything = saves.slots.some(Boolean) || (fromHome && saves.auto);

  openSheet('load', [
    sheetHead({ emoji: '📂', title: fromHome ? game.title : 'Load a game', sub: fromHome ? 'Pick a save to play' : null, back: fromHome ? closeSheet : pauseView }),
    h('div', { class: 'slot-list' }, rows),
    anything ? null : h('p', { class: 'sheet-note' }, 'No saves yet. Use 💾 Save while you play!'),
  ]);
}

// ── Switch game ────────────────────────────────────────────────────────
function switchView() {
  const others = GAMES.filter((g) => g.id !== session.game.id);
  openSheet('switch', [
    sheetHead({ emoji: '🎮', title: 'Play something else', sub: 'Your spot in this game is saved.', back: pauseView }),
    h('div', { class: 'switch-list' }, others.map((g) => h('button', {
      class: 'switch-item', type: 'button', vars: { '--c1': g.colors[0], '--c2': g.colors[1] },
      onclick: () => {
        closeSheet();
        const auto = getSlot(storage, playerId(), g.id, 'auto');
        playGame(g.id, auto ? 'continue' : 'new');
      },
    }, h('span', { class: 'switch-emoji', 'aria-hidden': 'true' }, g.emoji), h('span', null, g.title)))),
  ]);
}

// ── Confirm dialog ─────────────────────────────────────────────────────
function confirmView({ emoji, title, message, yes = 'Yes', no = 'No, go back', danger = false, onYes, back }) {
  const cancel = back || closeSheet;
  openSheet('confirm', [
    sheetHead({ emoji, title }),
    message ? h('p', { class: 'sheet-msg' }, message) : null,
    h('div', { class: 'confirm-actions' },
      h('button', { class: 'btn', type: 'button', onclick: cancel, 'data-autofocus': true }, no),
      h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: onYes }, yes)),
  ]);
}

// ── Rotate hint ────────────────────────────────────────────────────────
const dismissedRotate = new Set();
function updateRotateHint() {
  if (!session) { els.rotate.hidden = true; return; }
  const want = session.game.orientation;
  const w = window.innerWidth, hgt = window.innerHeight;
  const isPhone = Math.min(w, hgt) < 600;
  const wrong = (want === 'landscape' && hgt > w) || (want === 'portrait' && w > hgt);
  const show = isPhone && wrong && !dismissedRotate.has(session.game.id);
  els.rotateText.textContent = want === 'landscape' ? 'Turn your device sideways for a bigger game!' : 'Turn your device up tall for this game!';
  els.rotate.hidden = !show;
}
$('rotate-dismiss').addEventListener('click', () => {
  if (session) dismissedRotate.add(session.game.id);
  updateRotateHint();
  focusGame();
});

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ── Global events ──────────────────────────────────────────────────────
els.fab.addEventListener('click', openMenu);
els.playerChip.addEventListener('click', showPlayerPicker);
els.homeSound.addEventListener('click', () => { setMuted(!isMuted()); toast(isMuted() ? 'Sound off 🔇' : 'Sound on 🔊'); });
$('loading-retry').addEventListener('click', () => { if (session) startSession(session.game, 'continue'); });
$('loading-home').addEventListener('click', goHome);
els.sheet.addEventListener('click', (e) => {
  if (e.target !== els.sheet) return;
  if (sheetView === 'pause' || sheetView === 'switch' || sheetView === 'save' || sheetView === 'load') closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (session) toggleMenu();
  else if (sheetView) closeSheet();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); });
window.addEventListener('pagehide', () => autosave());
window.addEventListener('resize', updateRotateHint);
window.addEventListener('orientationchange', () => setTimeout(updateRotateHint, 200));
window.addEventListener('hashchange', route);
// Keep the menu's Full Screen label honest when the user presses Esc/back.
document.addEventListener('fullscreenchange', () => { if (sheetView === 'pause') pauseView(); });

// ── Boot ───────────────────────────────────────────────────────────────
document.title = CONFIG.siteName;
$('site-name').textContent = CONFIG.siteName;
if (CONFIG.analytics) {
  window.va = window.va || function (...a) { (window.vaq = window.vaq || []).push(a); };
  document.head.append(h('script', { defer: true, src: '/_vercel/insights/script.js' }));
}
route();
