// Super Games Arcade: the in-game menu.
// Injected into every game page by scripts/build.mjs. Games run as their own
// top-level page, never in an iframe: iOS (especially home-screen apps) can
// stop delivering touches to iframes until the page is reloaded, so the only
// thing between a finger and a game is now the game itself.
//
// The menu lives in a shadow root so its styles and the game's never mix, and
// its taps are stopped at the shadow host so a game's own tap handlers never
// see them.
import { readSaves, writeSave, deleteSave, getSlot, readSettings, writeSettings } from './saves.js';
import { h, safeStorage, createSheet, tile, createToast, slotLabel, slotRow, setRestore, gameUrl } from './ui.js';

const CONFIG = window.ARCADE_CONFIG || { siteName: 'Super Games Arcade', players: [], games: [] };
const GAMES = CONFIG.games || [];
const PLAYERS = CONFIG.players || [];
const AUTOSAVE_MS = 20000;
const B = window.ArcadeBridge;
const storage = safeStorage();
let settings = readSettings(storage);

const file = decodeURIComponent(location.pathname.split('/').pop() || '');
const game = GAMES.find((g) => g.path.split('/').pop() === file) || null;

function currentPlayer() { return PLAYERS.find((p) => p.id === settings.player) || null; }
function playerId() { return currentPlayer()?.id || '_'; }

if (!game || !B) {
  // Not an arcade game page (or opened oddly): leave the page alone.
} else if (PLAYERS.length && !currentPlayer()) {
  location.replace('/');            // pick who's playing first
} else {
  start();
}

function start() {
  document.title = `${game.title} · ${CONFIG.siteName}`;
  if (!document.querySelector('link[href*="family=Fredoka"]')) {
    document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap' }));
  }

  // ── Mount the menu in a shadow root ────────────────────────────────────
  const host = h('div', { id: 'sga-chrome' });
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  const fab = h('button', { class: 'menu-fab', id: 'menu-fab', type: 'button', 'aria-label': 'Pause and open menu', 'data-pos': game.menuButton || 'top-left' },
    h('span', { 'aria-hidden': 'true' }, '⏸'));
  const card = h('div', { class: 'sheet-card', id: 'sheet-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' });
  const sheetEl = h('div', { class: 'sheet', id: 'sheet', hidden: true }, card);
  const rotateText = h('p', { class: 'rotate-text' });
  const rotate = h('div', { class: 'rotate-hint', id: 'rotate-hint', hidden: true },
    h('div', { class: 'rotate-card' },
      h('div', { class: 'rotate-icon', 'aria-hidden': 'true' }, '📱'), rotateText,
      h('button', { class: 'btn', type: 'button', id: 'rotate-dismiss', onclick: dismissRotate }, 'Play this way')));
  const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  root.append(
    h('link', { rel: 'stylesheet', href: `/styles.css${CONFIG.buildId ? `?b=${CONFIG.buildId}` : ''}` }),
    h('style', null, `
      :host { font-family: var(--font); color: var(--ink); line-height: normal; font-weight: 500;
        -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; }
      .menu-fab, .sheet, .rotate-hint { pointer-events: auto; touch-action: manipulation; }
      .sheet-card { touch-action: pan-y; }
    `),
    fab, sheetEl, rotate, toastEl);
  document.body.append(host);
  // Taps, clicks and keys aimed at the menu stop here: the game never sees them.
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'keypress']) {
    host.addEventListener(t, (e) => e.stopPropagation());
  }

  const toast = createToast(toastEl);
  let canSave = false;
  let wantedRestore = false;
  const sheet = createSheet({
    sheet: sheetEl, card,
    onOpen: () => B.pause(),
    onClose: () => { B.resume(); try { window.focus(); } catch { /* ignore */ } },
    dismissable: (v) => ['pause', 'switch', 'save', 'load'].includes(v),
  });

  // ── Sound ──────────────────────────────────────────────────────────────
  const isMuted = () => !!settings.muted;
  function setMuted(m) { settings = writeSettings(storage, { muted: !!m }); B.setMuted(!!m); }
  B.setMuted(isMuted());

  // ── Bridge events ──────────────────────────────────────────────────────
  B.on((type, data) => {
    if (type === 'boot') wantedRestore = !!data.hadRestore;
    else if (type === 'register') {
      canSave = !!data.canSave;
      if (wantedRestore) {
        if (data.restored) toast('Welcome back! 🌟');
        else if (data.restoreFailed) toast("Couldn't open that save 😕 Starting fresh.");
        else if (!data.canSave) toast("This game can't load saves yet.");
        wantedRestore = false;
      }
      if (sheet.view === 'pause') pauseView();
    } else if (type === 'menu') toggleMenu();
  });

  // ── Saving ─────────────────────────────────────────────────────────────
  function autosave() {
    if (!game.saves || !canSave) return;
    let snap;
    try { snap = B.getState(); } catch (e) { console.error('[arcade] getState failed', e); return; }
    if (!snap || !snap.supported) return;
    if (snap.state == null) { deleteSave(storage, playerId(), game.id, 'auto'); return; }
    writeSave(storage, playerId(), game.id, 'auto', { state: snap.state, version: snap.version, thumb: B.thumbnail() });
    B.refreshThumb?.();
  }
  setInterval(() => { if (!sheet.view && !document.hidden) autosave(); }, AUTOSAVE_MS);
  setTimeout(() => B.refreshThumb?.(), 1500);

  // Leaving the page: keep their spot, then go.
  function leave(url) { autosave(); location.href = url; }
  function launch(g, entry) { setRestore(g.id, entry || null); leave(gameUrl(g, CONFIG.buildId)); }

  // ── Menu ───────────────────────────────────────────────────────────────
  function openMenu() { pauseView(); }
  function toggleMenu() { if (sheet.view) sheet.close(); else openMenu(); }
  fab.addEventListener('click', openMenu);

  function canFullscreen() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return !standalone && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    try {
      if (isFullscreen()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => toast("Full screen isn't available here."));
    } catch { toast("Full screen isn't available here."); }
  }
  document.addEventListener('fullscreenchange', () => { if (sheet.view === 'pause') pauseView(); });

  function pauseView() {
    const player = currentPlayer();
    const savesOn = !!game.saves;
    const saveOk = savesOn && canSave;
    const subParts = [];
    if (player) subParts.push(`${player.emoji} ${player.name}`);
    if (game.controls) subParts.push(game.controls);
    const tiles = [
      tile('▶', 'Keep Playing', sheet.close, { wide: true, primary: true, autofocus: true }),
      savesOn ? tile('💾', 'Save', saveView, { disabled: !saveOk }) : null,
      savesOn ? tile('📂', 'Load', loadView, { disabled: !saveOk }) : null,
      game.startOver === false ? null : tile('🔄', 'Start Over', () => sheet.confirm({
        emoji: '🔄', title: 'Start over?',
        message: savesOn ? 'This game starts from the beginning. Your saved games stay safe.' : 'This game starts again from the beginning.',
        yes: 'Start over', danger: true, back: pauseView,
        onYes: () => { deleteSave(storage, playerId(), game.id, 'auto'); setRestore(game.id, null); canSave = false; location.reload(); },
      })),
      tile('🎮', 'Other Games', switchView, { disabled: GAMES.length < 2 }),
      tile(isMuted() ? '🔇' : '🔊', isMuted() ? 'Sound Off' : 'Sound On', () => { setMuted(!isMuted()); pauseView(); }),
      tile('🏠', 'Arcade', () => leave('/')),
    ];
    if (canFullscreen()) tiles.push(tile(isFullscreen() ? '🗗' : '⛶', isFullscreen() ? 'Exit Full Screen' : 'Full Screen', () => { toggleFullscreen(); sheet.close(); }));
    if (PLAYERS.length > 1) tiles.push(tile('👋', 'Switch Player', () => leave('/#/players')));
    sheet.open('pause', [
      sheet.head({ emoji: game.emoji, title: game.title, sub: subParts.join(' · ') }),
      h('div', { class: 'tile-grid' }, tiles.filter(Boolean)),
      savesOn && !saveOk ? h('p', { class: 'sheet-note' }, "This game doesn't support saving yet.") : null,
    ]);
  }

  function saveView() {
    const saves = readSaves(storage, playerId(), game.id);
    const rows = saves.slots.map((entry, i) => slotRow(game, i, entry, {
      emptyLabel: 'Empty — tap to save here',
      onPick: () => {
        if (!entry) return doSave(i);
        sheet.confirm({
          emoji: '💾', title: `Replace ${slotLabel(i)}?`, message: `The game saved earlier will be replaced with this one.`,
          yes: 'Replace it', back: saveView, onYes: () => doSave(i),
        });
      },
    }));
    sheet.open('save', [sheet.head({ emoji: '💾', title: 'Save your game', sub: 'Pick a spot', back: pauseView }), h('div', { class: 'slot-list' }, rows)]);
  }

  function doSave(slot) {
    let snap = null;
    try { snap = B.getState(); } catch (e) { console.error('[arcade] getState failed', e); }
    if (!snap || !snap.supported) { toast("Couldn't save this game 😕"); pauseView(); return; }
    if (snap.state == null) { toast('Start playing first, then save! 🎮'); pauseView(); return; }
    const res = writeSave(storage, playerId(), game.id, slot, { state: snap.state, version: snap.version, thumb: B.thumbnail() });
    if (res.ok) toast(`Saved to ${slotLabel(slot)}! ⭐`);
    else toast(res.reason === 'storage-full' ? 'This device is out of space for saves 😕' : "Couldn't save 😕");
    pauseView();
  }

  function loadView() {
    const saves = readSaves(storage, playerId(), game.id);
    const pick = (slot, entry) => () => sheet.confirm({
      emoji: '📂', title: `Load ${slotLabel(slot)}?`, message: "Anything you haven't saved in this game will be lost.",
      yes: 'Load it', back: loadView, onYes: () => { setRestore(game.id, entry); location.reload(); },
    });
    const del = (slot) => () => sheet.confirm({
      emoji: '🗑️', title: `Delete ${slotLabel(slot)}?`, message: 'This save will be gone for good.',
      yes: 'Delete', danger: true, back: loadView,
      onYes: () => { deleteSave(storage, playerId(), game.id, slot); toast('Save deleted'); loadView(); },
    });
    const rows = saves.slots.map((entry, i) => slotRow(game, i, entry, {
      emptyLabel: 'Empty', pickDisabled: !entry, onPick: entry ? pick(i, entry) : null, onDelete: entry ? del(i) : null,
    }));
    sheet.open('load', [
      sheet.head({ emoji: '📂', title: 'Load a game', back: pauseView }),
      h('div', { class: 'slot-list' }, rows),
      saves.slots.some(Boolean) ? null : h('p', { class: 'sheet-note' }, 'No saves yet. Use 💾 Save while you play!'),
    ]);
  }

  function switchView() {
    const others = GAMES.filter((g) => g.id !== game.id);
    sheet.open('switch', [
      sheet.head({ emoji: '🎮', title: 'Play something else', sub: game.saves ? 'Your spot in this game is saved.' : null, back: pauseView }),
      h('div', { class: 'switch-list' }, others.map((g) => h('button', {
        class: 'switch-item', type: 'button', vars: { '--c1': g.colors[0], '--c2': g.colors[1] },
        onclick: () => launch(g, g.saves ? getSlot(storage, playerId(), g.id, 'auto') : null),
      }, h('span', { class: 'switch-emoji', 'aria-hidden': 'true' }, g.emoji), h('span', null, g.title)))),
    ]);
  }

  // ── Rotate hint ────────────────────────────────────────────────────────
  const ROT_KEY = `sga:rotate-ok:${game.id}`;
  function rotateDismissed() { try { return sessionStorage.getItem(ROT_KEY) === '1'; } catch { return false; } }
  function dismissRotate() { try { sessionStorage.setItem(ROT_KEY, '1'); } catch { /* ignore */ } updateRotateHint(); }
  function updateRotateHint() {
    const want = game.orientation;
    const w = window.innerWidth, ht = window.innerHeight;
    const wrong = (want === 'landscape' && ht > w) || (want === 'portrait' && w > ht);
    rotateText.textContent = want === 'landscape' ? 'Turn your device sideways for a bigger game!' : 'Turn your device up tall for this game!';
    rotate.hidden = !(Math.min(w, ht) < 600 && wrong && !rotateDismissed());
  }
  window.addEventListener('resize', updateRotateHint);
  window.addEventListener('orientationchange', () => setTimeout(updateRotateHint, 200));
  updateRotateHint();

  // ── Leaving / coming back ──────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => { if (document.hidden) { autosave(); if (!sheet.view) openMenu(); } });
  window.addEventListener('pagehide', autosave);
  // Back/forward cache: the page can come back exactly as it was left.
  window.addEventListener('pageshow', (e) => { if (e.persisted) { settings = readSettings(storage); B.setMuted(isMuted()); } });
}
