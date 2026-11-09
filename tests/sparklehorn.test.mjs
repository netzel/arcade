// Unit tests for Sparklehorn Adventure's pure logic (the <script id="spk-core">
// block inside games/sparklehorn-adventure.html), run in a bare VM context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = new URL('../games/sparklehorn-adventure.html', import.meta.url);

function loadCore() {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(/<script id="spk-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('spk-core script not found');
  const ctx = { Math, JSON, Uint8Array, btoa, atob, Error, Object, Array, Set, Map, Number, String };
  ctx.globalThis = ctx;
  vm.runInNewContext(m[1], ctx);
  return ctx.SPK;
}

const SPK = loadCore();
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── Task 2: skeleton ────────────────────────────────────────────────────
test('core loads and exposes TILE and DIFF', () => {
  assert.equal(SPK.TILE, 32);
  assert.equal(SPK.DIFF.easy.hp, 12);
  assert.equal(SPK.DIFF.normal.hp, 8);
});

test('createGame sets hp from difficulty', () => {
  const e = SPK.createGame('easy');
  assert.equal(e.hp, 12);
  assert.equal(e.hpMax, 12);
  assert.equal(SPK.createGame('normal').mode, 'intro');
  assert.deepEqual(Array.from(e.broken), []);
});

test('createGame rejects unknown difficulty', () => {
  assert.throws(() => SPK.createGame('hard'));
});

export { SPK, near };
