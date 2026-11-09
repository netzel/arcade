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

// ── Task 3: input ───────────────────────────────────────────────────────
const LAND = () => SPK.layoutControls(844, 390);
const PORT = () => SPK.layoutControls(390, 844);
const joyPoint = (L) => ({ x: L.joyZone.x + L.joyZone.w * 0.4, y: L.joyZone.y + L.joyZone.h * 0.5 });

test('joystick drag gives a direction', () => {
  const inp = SPK.createInput(LAND());
  const p = joyPoint(LAND());
  inp.down(1, p.x, p.y, 0);
  inp.move(1, p.x + 60, p.y, 16);
  const v = inp.moveVec();
  assert.ok(near(v.x, 1, 1e-3) && near(v.y, 0, 1e-3), JSON.stringify(v));
});

test('joystick deadzone ignores tiny drags', () => {
  const inp = SPK.createInput(LAND());
  const p = joyPoint(LAND());
  inp.down(1, p.x, p.y, 0);
  inp.move(1, p.x + 5, p.y, 16);
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 });
});

test('magic button press and hold', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  inp.down(2, L.magic.x, L.magic.y, 0);
  assert.equal(inp.consumePress('magic'), true);
  assert.equal(inp.consumePress('magic'), false);
  assert.equal(inp.held('magic'), true);
  inp.up(2, L.magic.x, L.magic.y, 50);
  assert.equal(inp.held('magic'), false);
});

test('release of one pointer leaves the other intact', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0);
  inp.move(1, p.x + 60, p.y, 16);
  inp.down(2, L.magic.x, L.magic.y, 20);
  inp.up(2, L.magic.x, L.magic.y, 60);
  assert.ok(near(inp.moveVec().x, 1, 1e-3));
  assert.equal(inp.held('magic'), false);
  assert.equal(inp.active(), 1);
});

test('pointer keeps its role for its lifetime', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(3, L.horn.x, L.horn.y, 0);
  inp.move(3, p.x, p.y, 30);
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 });
  assert.equal(inp.held('horn'), true);
});

test('only one joystick pointer at a time', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0);
  inp.move(1, p.x + 60, p.y, 16);
  inp.down(4, p.x, p.y + 20, 20);
  inp.move(4, p.x, p.y - 80, 40);
  assert.ok(near(inp.moveVec().x, 1, 1e-3));
});

test('tap in joy zone', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0);
  inp.up(1, p.x + 3, p.y, 100);
  assert.deepEqual({ ...inp.consumeTap() }, { x: p.x, y: p.y });
  assert.equal(inp.consumeTap(), null);
  inp.down(1, p.x, p.y, 1000);
  inp.up(1, p.x, p.y, 1300);
  assert.equal(inp.consumeTap(), null);
});

test('cancel and resetAll clear everything', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0);
  inp.move(1, p.x + 60, p.y, 16);
  inp.down(2, L.magic.x, L.magic.y, 20);
  inp.cancel(2);
  assert.equal(inp.held('magic'), false);
  inp.down(3, L.horn.x, L.horn.y, 30);
  inp.resetAll('blur');
  assert.equal(inp.active(), 0);
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 });
  assert.equal(inp.held('horn'), false);
  assert.equal(inp.held('magic'), false);
  assert.equal(inp.lastReset, 'blur');
});

test('watchdog releases a silent pointer', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0);
  inp.tick(2999);
  assert.equal(inp.active(), 1);
  inp.tick(3001);
  assert.equal(inp.active(), 0);
  assert.equal(inp.lastReset, 'watchdog');
});

test('relayout resets and next touch uses new zones', () => {
  const inp = SPK.createInput(LAND());
  const p = joyPoint(LAND());
  inp.down(1, p.x, p.y, 0);
  const P = PORT();
  inp.relayout(P);
  assert.equal(inp.active(), 0);
  inp.down(2, P.magic.x, P.magic.y, 10);
  assert.equal(inp.consumePress('magic'), true);
});

test('layout: buttons do not overlap each other or the arcade menu corner', () => {
  for (const [w, h] of [[390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 900]]) {
    const L = SPK.layoutControls(w, h);
    const cs = [L.horn, L.magic, L.map];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      assert.ok(c.x - c.r >= 0 && c.x + c.r <= w && c.y - c.r >= 0 && c.y + c.r <= h, `${w}x${h} circle ${i} on screen`);
      // ⏸ menu button lives in the top-right 72x72 corner
      const nx = Math.max(w - 72, Math.min(c.x, w)), ny = Math.max(0, Math.min(c.y, 72));
      assert.ok(Math.hypot(c.x - nx, c.y - ny) > c.r, `${w}x${h} circle ${i} clear of the menu`);
      for (let j = i + 1; j < cs.length; j++) assert.ok(Math.hypot(c.x - cs[j].x, c.y - cs[j].y) > c.r + cs[j].r, `${w}x${h} ${i}/${j} apart`);
    }
    assert.equal(L.portrait, h > w);
  }
});

export { SPK, near };
