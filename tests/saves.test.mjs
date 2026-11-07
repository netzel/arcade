import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_COUNT, readSaves, writeSave, deleteSave, getSlot, saveKey, timeAgo, readSettings, writeSettings,
} from '../public/saves.js';

function fakeStorage({ quota = Infinity } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}

test('empty storage reads as no saves', () => {
  const r = readSaves(fakeStorage(), 'cece', 'g');
  assert.equal(r.auto, null);
  assert.equal(r.slots.length, SLOT_COUNT);
  assert.ok(r.slots.every((s) => s === null));
});

test('write, read, and delete slots per player', () => {
  const s = fakeStorage();
  const now = new Date('2026-11-07T12:00:00Z');
  assert.deepEqual(writeSave(s, 'cece', 'g', 1, { state: { lvl: 2 }, version: 1, thumb: 'data:x' }, now), { ok: true });
  assert.deepEqual(writeSave(s, 'cece', 'g', 'auto', { state: { lvl: 3 }, version: 1 }, now), { ok: true });
  assert.deepEqual(getSlot(s, 'cece', 'g', 1), { savedAt: now.toISOString(), version: 1, state: { lvl: 2 }, thumb: 'data:x' });
  assert.equal(getSlot(s, 'cece', 'g', 'auto').state.lvl, 3);
  assert.equal(getSlot(s, 'alana', 'g', 1), null, 'other player is separate');
  deleteSave(s, 'cece', 'g', 1);
  assert.equal(getSlot(s, 'cece', 'g', 1), null);
  deleteSave(s, 'cece', 'g', 'auto');
  assert.equal(s.m.has(saveKey('cece', 'g')), false, 'key removed when nothing left');
});

test('rejects bad slot numbers', () => {
  const s = fakeStorage();
  for (const bad of [-1, SLOT_COUNT, 1.5, '1', null]) {
    assert.equal(writeSave(s, 'p', 'g', bad, { state: 1 }).ok, false);
  }
});

test('corrupt JSON is treated as empty, not a crash', () => {
  const s = fakeStorage();
  s.setItem(saveKey('p', 'g'), '{nope');
  assert.equal(readSaves(s, 'p', 'g').auto, null);
  s.setItem(saveKey('p', 'g'), JSON.stringify({ auto: { junk: true }, slots: [{ savedAt: 'x', state: 1 }, 'bad'] }));
  const r = readSaves(s, 'p', 'g');
  assert.equal(r.auto, null);
  assert.equal(r.slots[0].state, 1);
  assert.equal(r.slots[1], null);
});

test('when storage is full, drops thumbnails and retries', () => {
  const s = fakeStorage({ quota: 400 });
  const big = 'data:' + 'x'.repeat(500);
  const res = writeSave(s, 'p', 'g', 0, { state: { a: 1 }, version: 1, thumb: big });
  assert.equal(res.ok, true);
  assert.equal(res.droppedThumbs, true);
  assert.equal(getSlot(s, 'p', 'g', 0).thumb, null);
  const tooBig = writeSave(s, 'p', 'g', 1, { state: 'y'.repeat(1000) });
  assert.deepEqual(tooBig, { ok: false, reason: 'storage-full' });
});

test('storage that throws (private mode) does not crash', () => {
  const s = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.equal(readSaves(s, 'p', 'g').auto, null);
  assert.deepEqual(readSettings(s), {});
  assert.deepEqual(writeSettings(s, { muted: true }), { muted: true });
});

test('settings merge', () => {
  const s = fakeStorage();
  writeSettings(s, { muted: true });
  writeSettings(s, { player: 'cece' });
  assert.deepEqual(readSettings(s), { muted: true, player: 'cece' });
});

test('timeAgo', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const ago = (ms) => timeAgo(new Date(now - ms).toISOString(), now);
  assert.equal(ago(10e3), 'just now');
  assert.equal(ago(5 * 60e3), '5 min ago');
  assert.equal(ago(60 * 60e3), '1 hour ago');
  assert.equal(ago(3 * 3600e3), '3 hours ago');
  assert.equal(ago(26 * 3600e3), 'yesterday');
  assert.equal(ago(3 * 86400e3), '3 days ago');
  assert.equal(timeAgo('garbage', now), '');
});
