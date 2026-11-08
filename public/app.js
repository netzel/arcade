// Super Games Arcade: home screen.
// Picks the player and the game. Each game opens as its own page (see
// play.js for the in-game menu): no iframe sits between a finger and a game.

import { readSaves, deleteSave, getSlot, readSettings, writeSettings } from './saves.js';
import { h, safeStorage, createSheet, createToast, slotRow, setRestore, gameUrl } from './ui.js';
import { timeAgo } from './saves.js';

const CONFIG = window.ARCADE_CONFIG || { siteName: 'Super Games Arcade', players: [], games: [] };
const GAMES = CONFIG.games || [];
const PLAYERS = CONFIG.players || [];

const storage = safeStorage();
let settings = readSettings(storage);

const $ = (id) => document.getElementById(id);
const els = {
  home: $('home'), players: $('players'),
  grid: $('game-grid'), playerChip: $('player-chip'), homeSound: $('home-sound'), playerList: $('player-list'),
  sheet: $('sheet'), sheetCard: $('sheet-card'), toast: $('toast'),
};
const toast = createToast(els.toast);
const sheet = createSheet({ sheet: els.sheet, card: els.sheetCard, dismissable: (v) => v === 'load' });

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
function renderSoundButtons() {
  els.homeSound.textContent = isMuted() ? '🔇' : '🔊';
  els.homeSound.setAttribute('aria-label', isMuted() ? 'Sound is off. Turn sound on.' : 'Sound is on. Turn sound off.');
}

// ── Screens & routing ──────────────────────────────────────────────────
function showScreen(name) {
  for (const s of ['home', 'players']) els[s].hidden = s !== name;
  document.body.dataset.screen = name;
}

function gameById(id) { return GAMES.find((g) => g.id === id) || null; }

/** Open a game page. mode: 'new' | 'continue' | 'slot'. */
function playGame(game, mode = 'new', slot = null) {
  let entry = null;
  if (game.saves && mode === 'continue') entry = getSlot(storage, playerId(), game.id, 'auto');
  else if (game.saves && mode === 'slot') entry = getSlot(storage, playerId(), game.id, slot);
  setRestore(game.id, entry);
  location.href = gameUrl(game, CONFIG.buildId);
}

function goHome() {
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else route();
}

function route() {
  sheet.close();
  // Old links (#/play/<id>) from when games ran inside the home page.
  const m = location.hash.match(/^#\/play\/([^/?#]+)/);
  const old = m ? gameById(decodeURIComponent(m[1])) : null;
  if (old) {
    const auto = old.saves && getSlot(storage, playerId(), old.id, 'auto');
    setRestore(old.id, auto || null);
    location.replace(gameUrl(old, CONFIG.buildId));
    return;
  }
  if (PLAYERS.length && (!currentPlayer() || location.hash === '#/players')) { showPlayerPicker(); return; }
  renderHome();
  showScreen('home');
}

// ── Home screen ────────────────────────────────────────────────────────
const SOON_CARD_UNDER = 4; // show the "more games coming" card while the arcade is small

function renderHome() {
  settings = readSettings(storage);
  renderPlayerChip();
  renderSoundButtons();
  const p = currentPlayer();
  $('greeting').replaceChildren(
    p ? `Hi ${p.name}! ` : 'Hi there! ',
    h('span', { class: 'wave', 'aria-hidden': 'true' }, '👋'),
    ' What do you want to play?',
  );
  if (!GAMES.length) {
    els.grid.replaceChildren(h('p', { class: 'empty-state' }, 'No games yet! Add an .html game to the games folder. 🎮'));
    return;
  }
  const cards = GAMES.map((g, i) => gameCard(g, i));
  if (GAMES.length < SOON_CARD_UNDER) {
    cards.push(h('div', { class: 'soon-card', style: { animationDelay: `${GAMES.length * 70}ms` } },
      h('span', { class: 'soon-emoji', 'aria-hidden': 'true' }, '🎁'),
      h('span', { class: 'soon-title' }, 'More games coming soon!'),
      h('p', { class: 'soon-text' }, 'New adventures are on the way ✨')));
  }
  els.grid.replaceChildren(...cards);
}

function gameCard(g, i) {
  // Games with saves turned off always start fresh: no Continue / Saves buttons.
  const saves = g.saves ? readSaves(storage, playerId(), g.id) : { auto: null, slots: [] };
  const auto = saves.auto;
  const hasSlots = saves.slots.some(Boolean);
  const primary = () => playGame(g, auto ? 'continue' : 'new');

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
      onclick: () => sheet.confirm({
        emoji: '✨', title: 'Start a new game?', message: 'Your other saved games stay safe.',
        yes: 'Start new', onYes: () => { sheet.close(); playGame(g, 'new'); },
      }),
    }, '✨ New'));
  } else {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: primary }, '▶ Play'));
  }
  if (hasSlots) actions.push(h('button', { class: 'btn', type: 'button', onclick: () => loadView(g) }, '📂 Saves'));

  return h('article', { class: 'game-card', style: { animationDelay: `${i * 70}ms` } },
    art,
    h('div', { class: 'game-body' },
      h('h2', { class: 'game-title' }, g.title),
      g.tagline ? h('p', { class: 'game-tagline' }, g.tagline) : null,
      h('div', { class: 'game-actions' }, actions)));
}

// ── Saves (from the home screen) ───────────────────────────────────────
function loadView(game) {
  const saves = readSaves(storage, playerId(), game.id);
  const pick = (slot) => () => { sheet.close(); playGame(game, slot === 'auto' ? 'continue' : 'slot', slot === 'auto' ? null : slot); };
  const del = (slot) => () => sheet.confirm({
    emoji: '🗑️', title: 'Delete this save?', message: 'It will be gone for good.',
    yes: 'Delete', danger: true, back: () => loadView(game),
    onYes: () => { deleteSave(storage, playerId(), game.id, slot); toast('Save deleted'); renderHome(); loadView(game); },
  });
  const rows = [];
  if (saves.auto) rows.push(slotRow(game, 'auto', saves.auto, { onPick: pick('auto'), onDelete: del('auto') }));
  saves.slots.forEach((entry, i) => rows.push(slotRow(game, i, entry, {
    emptyLabel: 'Empty', pickDisabled: !entry, onPick: entry ? pick(i) : null, onDelete: entry ? del(i) : null,
  })));
  sheet.open('load', [
    sheet.head({ emoji: '📂', title: game.title, sub: 'Pick a save to play', back: sheet.close }),
    h('div', { class: 'slot-list' }, rows),
    saves.slots.some(Boolean) || saves.auto ? null : h('p', { class: 'sheet-note' }, 'No saves yet. Use 💾 Save while you play!'),
  ]);
}

// ── Global events ──────────────────────────────────────────────────────
els.playerChip.addEventListener('click', showPlayerPicker);
els.homeSound.addEventListener('click', () => {
  settings = writeSettings(storage, { muted: !isMuted() });
  renderSoundButtons();
  toast(isMuted() ? 'Sound off 🔇' : 'Sound on 🔊');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.view) sheet.close(); });
window.addEventListener('hashchange', route);
// Coming back from a game with the Back button can restore this page from the
// back/forward cache: refresh the cards (Continue badges, player, sound).
window.addEventListener('pageshow', (e) => { if (e.persisted) route(); });

// ── Boot ───────────────────────────────────────────────────────────────
document.title = CONFIG.siteName;
$('site-name').textContent = CONFIG.siteName;
if (CONFIG.analytics) {
  window.va = window.va || function (...a) { (window.vaq = window.vaq || []).push(a); };
  document.head.append(h('script', { defer: true, src: '/_vercel/insights/script.js' }));
}
route();
