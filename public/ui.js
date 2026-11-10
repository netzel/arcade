// Super Games Arcade: UI pieces shared by the home screen (app.js) and the
// in-game menu (play.js): DOM helper, sheet (menus & dialogs), toast, save rows.
import { timeAgo } from './saves.js';

export function h(tag, attrs, ...children) {
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

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

export function safeStorage() {
  try { const s = window.localStorage; s.getItem('x'); return s; } catch { return memoryStorage(); }
}

/**
 * A modal sheet. `sheet` is the backdrop element, `card` the dialog inside it.
 * onOpen/onClose let the caller pause and resume a game.
 */
export function createSheet({ sheet, card, onOpen, onClose, dismissable = () => true }) {
  let view = null;
  let lastFocus = null;
  const api = {
    get view() { return view; },
    open(name, content) {
      if (!view) lastFocus = document.activeElement;
      const wasOpen = !!view;
      view = name;
      card.replaceChildren(...content.filter(Boolean));
      sheet.hidden = false;
      if (!wasOpen) onOpen?.();
      const first = card.querySelector('[data-autofocus]') || card.querySelector('button:not(:disabled)');
      first?.focus({ preventScroll: true });
    },
    close() {
      if (!view) return;
      view = null;
      sheet.hidden = true;
      card.replaceChildren();
      onClose?.();
      lastFocus?.focus?.({ preventScroll: true });
    },
    head({ emoji, title, sub, back }) {
      return h('div', { class: 'sheet-head' },
        emoji ? h('span', { class: 'head-emoji', 'aria-hidden': 'true' }, emoji) : null,
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('h2', { class: 'sheet-title', id: 'sheet-title' }, title),
          sub ? h('p', { class: 'sheet-sub' }, sub) : null),
        back ? h('button', { class: 'btn btn-small sheet-back', type: 'button', onclick: back }, '← Back') : null);
    },
    confirm({ emoji, title, message, yes = 'Yes', no = 'No, go back', danger = false, onYes, back }) {
      api.open('confirm', [
        api.head({ emoji, title }),
        message ? h('p', { class: 'sheet-msg' }, message) : null,
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn', type: 'button', onclick: back || api.close, 'data-autofocus': true }, no),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: onYes }, yes)),
      ]);
    },
  };
  sheet.addEventListener('click', (e) => { if (e.target === sheet && view && dismissable(view)) api.close(); });
  return api;
}

export function tile(icon, label, onclick, opts = {}) {
  return h('button', {
    class: `tile${opts.wide ? ' tile-wide' : ''}${opts.primary ? ' tile-primary' : ''}`,
    type: 'button', onclick, disabled: opts.disabled, 'aria-label': opts.aria, 'data-autofocus': opts.autofocus,
  }, h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('span', null, label));
}

export function createToast(el) {
  let timer = null;
  return (msg) => {
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 2600);
  };
}

export function slotLabel(slot) { return slot === 'auto' ? 'Where you left off' : `Save ${slot + 1}`; }

export function slotRow(game, slot, entry, { onPick, onDelete, emptyLabel, pickDisabled }) {
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

/** Hands a save to the game page: the bridge reads it as the page boots. */
export const RESTORE_KEY = 'sga:restore';
export function setRestore(gameId, entry) {
  try {
    if (entry) sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ gameId, version: entry.version, state: entry.state }));
    else sessionStorage.removeItem(RESTORE_KEY);
    return true;
  } catch { return false; }
}

/**
 * "✨ New" from the home card: the next load of this game page should start
 * fresh instead of picking up the Continue save (long adventures continue
 * automatically after a reload or Back otherwise; see play.js).
 */
const freshKey = (gameId) => `sga:fresh:${gameId}`;
export function markFresh(gameId) { try { sessionStorage.setItem(freshKey(gameId), '1'); } catch { /* ignore */ } }
export function takeFresh(gameId) {
  try { const v = sessionStorage.getItem(freshKey(gameId)) === '1'; sessionStorage.removeItem(freshKey(gameId)); return v; } catch { return false; }
}

/** URL of a game page (cache-busted per build). */
export function gameUrl(game, buildId) { return `/${game.path.replace(/^\//, '')}${buildId ? `?b=${buildId}` : ''}`; }
