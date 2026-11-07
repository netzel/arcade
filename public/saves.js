/*
 * Save storage for Super Games Arcade.
 *
 * Saves live in localStorage, one key per player+game:
 *   sga:saves:<player>:<gameId>  ->  { auto: Slot|null, slots: [Slot|null, ...] }
 * Slot = { savedAt: ISO string, version: any, state: any, thumb: dataURL|null }
 *
 * "auto" is the Continue slot the arcade writes by itself; "slots" are the
 * numbered saves the kids make on purpose.
 *
 * Every function takes the storage object so tests can pass a fake.
 */

export const SLOT_COUNT = 3;
const PREFIX = 'sga';

function emptyRecord() {
  return { auto: null, slots: new Array(SLOT_COUNT).fill(null) };
}

export function saveKey(player, gameId) {
  return `${PREFIX}:saves:${player || '_'}:${gameId}`;
}

function isSlot(s) {
  return !!s && typeof s === 'object' && typeof s.savedAt === 'string' && 'state' in s;
}

export function readSaves(storage, player, gameId) {
  const rec = emptyRecord();
  let raw = null;
  try { raw = storage.getItem(saveKey(player, gameId)); } catch { return rec; }
  if (!raw) return rec;
  try {
    const parsed = JSON.parse(raw);
    rec.auto = isSlot(parsed.auto) ? parsed.auto : null;
    if (Array.isArray(parsed.slots)) {
      for (let i = 0; i < SLOT_COUNT; i++) rec.slots[i] = isSlot(parsed.slots[i]) ? parsed.slots[i] : null;
    }
  } catch {
    // Corrupt JSON: treat as no saves rather than crashing the arcade.
  }
  return rec;
}

function persist(storage, player, gameId, rec) {
  const key = saveKey(player, gameId);
  const empty = !rec.auto && rec.slots.every((s) => !s);
  if (empty) { storage.removeItem(key); return; }
  storage.setItem(key, JSON.stringify(rec));
}

/**
 * Write a save. `slot` is 'auto' or a slot index (0-based).
 * Returns { ok: true } or { ok: false, reason }.
 * If storage is full, retries without thumbnails before giving up.
 */
export function writeSave(storage, player, gameId, slot, { state, version, thumb = null }, now = new Date()) {
  if (slot !== 'auto' && !(Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT)) {
    return { ok: false, reason: 'bad-slot' };
  }
  const rec = readSaves(storage, player, gameId);
  const entry = { savedAt: now.toISOString(), version, state, thumb };
  if (slot === 'auto') rec.auto = entry; else rec.slots[slot] = entry;
  try {
    persist(storage, player, gameId, rec);
    return { ok: true };
  } catch {
    // Probably QuotaExceededError. Drop all thumbnails for this game and retry.
    if (rec.auto) rec.auto.thumb = null;
    rec.slots.forEach((s) => { if (s) s.thumb = null; });
    try {
      persist(storage, player, gameId, rec);
      return { ok: true, droppedThumbs: true };
    } catch {
      return { ok: false, reason: 'storage-full' };
    }
  }
}

export function deleteSave(storage, player, gameId, slot) {
  const rec = readSaves(storage, player, gameId);
  if (slot === 'auto') rec.auto = null; else if (rec.slots[slot] !== undefined) rec.slots[slot] = null;
  try { persist(storage, player, gameId, rec); return { ok: true }; } catch { return { ok: false, reason: 'storage-error' }; }
}

export function getSlot(storage, player, gameId, slot) {
  const rec = readSaves(storage, player, gameId);
  return slot === 'auto' ? rec.auto : rec.slots[slot] || null;
}

/** "just now", "5 min ago", "yesterday", or a short date. */
export function timeAgo(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Settings (sound, current player, etc.) ─────────────────────────────
const SETTINGS_KEY = `${PREFIX}:settings`;

export function readSettings(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function writeSettings(storage, patch) {
  const next = { ...readSettings(storage), ...patch };
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
