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

// ── Task 4: maps & collision ────────────────────────────────────────────
const REAL_MAPS = ['meadow', 'pebble'];

test('maps parse with consistent widths', () => {
  for (const id of REAL_MAPS) {
    const rows = SPK.MAPS[id].rows;
    const m = SPK.parseMap(id);
    assert.equal(m.h, rows.length);
    for (const r of rows) assert.equal(r.length, m.w, `${id} row width`);
    const starts = m.entities.filter((e) => e.kind === (id === 'meadow' ? '@' : 'U'));
    assert.equal(starts.length, 1, `${id} has one start`);
  }
  assert.equal(SPK.parseMap('meadow').w, 48);
  assert.equal(SPK.parseMap('meadow').h, 32);
  assert.equal(SPK.parseMap('pebble').w, 30);
  assert.equal(SPK.parseMap('pebble').h, 20);
});

test('entity ids are stable and unique', () => {
  const ids = new Set();
  for (const id of REAL_MAPS) {
    for (const e of SPK.parseMap(id).entities) {
      assert.equal(e.id, `${id}:${e.kind}:${e.tx},${e.ty}`);
      assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
      ids.add(e.id);
    }
  }
});

test('every door has a matching return door', () => {
  const doors = [];
  for (const id of REAL_MAPS) for (const e of SPK.parseMap(id).entities) if (e.kind === 'D' || e.kind === 'U') doors.push(e.id);
  assert.ok(doors.length >= 2);
  for (const d of doors) {
    const link = SPK.DOORS[d];
    assert.ok(link, `door ${d} has a link`);
    assert.ok(doors.includes(link.at), `${d} -> ${link.at} exists`);
    assert.equal(SPK.DOORS[link.at].at, d, `${link.at} links back to ${d}`);
  }
});

test('moveAndSlide blocks walls and slides', () => {
  SPK.MAPS.t5 = { rows: ['#####', '#...#', '#.#.#', '#...#', '#####'] };
  const m = SPK.parseMap('t5');
  const T = SPK.TILE;
  const ctx = { broken: [], powers: {} };
  // in tile (1,1), push right into nothing solid, then down-right into the centre rock (2,2)
  const start = { x: 1.5 * T, y: 1.5 * T, r: T * 0.35 };
  const a = SPK.moveAndSlide(m, start, T, 0, ctx);
  assert.ok(a.x > start.x && a.y === start.y, 'free move right');
  // from (1,1) push diagonally into the corner wall at top-left: x blocked, y blocked
  const b = SPK.moveAndSlide(m, start, -T, -T, ctx);
  assert.ok(b.x >= T + start.r - 1e-6 && b.y >= T + start.r - 1e-6, 'stopped by walls');
  assert.ok(b.hit.length > 0);
  // slide: push left (into wall) and down (free) at the same time -> only y changes
  const c = SPK.moveAndSlide(m, start, -T, T * 0.4, ctx);
  assert.ok(Math.abs(c.x - (T + start.r)) < 1e-6 && c.y > start.y, 'slides along the wall');
});

test('cracked boulder solid until broken', () => {
  const m = SPK.parseMap('meadow');
  const b = m.entities.find((e) => e.kind === 'B');
  assert.ok(b, 'meadow has a cracked boulder');
  assert.equal(SPK.isSolid(m, b.tx, b.ty, { broken: [], powers: {} }), true);
  assert.equal(SPK.isSolid(m, b.tx, b.ty, { broken: [b.id], powers: {} }), false);
  assert.equal(SPK.isSolid(m, -1, 0, { broken: [], powers: {} }), true, 'out of bounds is solid');
});

function flood(m, sx, sy, passBoulders) {
  const seen = new Uint8Array(m.w * m.h);
  const q = [[sx, sy]];
  seen[sy * m.w + sx] = 1;
  const ctx = { broken: passBoulders ? m.entities.filter((e) => e.kind === 'B').map((e) => e.id) : [], powers: {} };
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || seen[ny * m.w + nx]) continue;
      if (SPK.isSolid(m, nx, ny, ctx)) continue;
      seen[ny * m.w + nx] = 1;
      q.push([nx, ny]);
    }
  }
  return (e) => !!seen[e.ty * m.w + e.tx];
}

test('every chest, heart spot, campfire and the pedestal is reachable', () => {
  const KEY = ['C', 'H', 'F', 'P', 'D', 'U'];
  const meadow = SPK.parseMap('meadow');
  const start = meadow.entities.find((e) => e.kind === '@');
  const withB = flood(meadow, start.tx, start.ty, true);
  const withoutB = flood(meadow, start.tx, start.ty, false);
  const blocked = [];
  for (const e of meadow.entities.filter((e) => KEY.includes(e.kind))) {
    assert.ok(withB(e), `${e.id} reachable once boulders are broken`);
    if (!withoutB(e)) blocked.push(e.id);
  }
  assert.equal(blocked.length, 1, `exactly one thing hides behind the boulder: ${blocked}`);
  assert.ok(blocked[0].includes(':C:'), 'and it is a chest');
  const pebble = SPK.parseMap('pebble');
  const u = pebble.entities.find((e) => e.kind === 'U');
  const r = flood(pebble, u.tx, u.ty, false);
  for (const e of pebble.entities.filter((e) => KEY.includes(e.kind))) assert.ok(r(e), `${e.id} reachable`);
});

test('content counts match the design', () => {
  const count = (id, k) => SPK.parseMap(id).entities.filter((e) => e.kind === k).length;
  assert.equal(count('meadow', 'F'), 3);
  assert.equal(count('meadow', 'C'), 8);
  assert.equal(count('meadow', 'H'), 3);
  assert.equal(count('meadow', 'S'), 6);
  assert.equal(count('meadow', 'M'), 2);
  assert.equal(count('meadow', 'B'), 1);
  assert.equal(count('pebble', 'F'), 1);
  assert.equal(count('pebble', 'C'), 3);
  assert.equal(count('pebble', 'P'), 1);
  assert.equal(count('pebble', 'S') + count('pebble', 'M'), 4);
});

test('createGame starts at the meadow start tile, waking at the home campfire', () => {
  const g = SPK.createGame('easy');
  const m = SPK.parseMap('meadow');
  const s = m.entities.find((e) => e.kind === '@');
  assert.equal(g.x, (s.tx + 0.5) * SPK.TILE);
  assert.equal(g.y, (s.ty + 0.5) * SPK.TILE);
  assert.equal(g.wakeCampfire, SPK.HOME_FIRE);
  assert.ok(m.entities.some((e) => e.id === SPK.HOME_FIRE && e.kind === 'F'));
});

test('coming through a door you step straight out of it', () => {
  assert.deepEqual({ ...SPK.doorArrival('pebble:U:1,10') }, { map: 'pebble', tx: 2, ty: 10 });
  assert.deepEqual({ ...SPK.doorArrival('meadow:D:24,5') }, { map: 'meadow', tx: 24, ty: 6 });
});

// ── Task 5: combat ──────────────────────────────────────────────────────
const T = SPK.TILE;
const foe = (kind, tx, ty) => ({ kind, x: tx * T, y: ty * T, hp: SPK.ENEMIES[kind].hp });

test('pickTarget picks the nearest enemy in the cone', () => {
  const a = foe('slime', 3, 0), b = foe('slime', 5, 0), behind = foe('slime', -1, 0);
  assert.equal(SPK.pickTarget(0, 0, 0, [b, behind, a], 7 * T, 120), a);
});

test('pickTarget is null when enemies are only behind or out of range', () => {
  assert.equal(SPK.pickTarget(0, 0, 0, [foe('slime', -2, 0), foe('slime', 9, 0)], 7 * T, 120), null);
  const dead = foe('slime', 2, 0); dead.hp = 0;
  assert.equal(SPK.pickTarget(0, 0, 0, [dead], 7 * T, 120), null);
});

test('fanAngles spreads bolts evenly around the aim', () => {
  const d = Math.PI / 180;
  const f = SPK.fanAngles(0, 5, 50);
  [-25, -12.5, 0, 12.5, 25].forEach((deg, i) => assert.ok(near(f[i], deg * d, 1e-9), `${i}: ${f[i]}`));
  assert.deepEqual(Array.from(SPK.fanAngles(1, 1, 50)), [1]);
});

test('big slime splits into 2 minis on pop', () => {
  const e = foe('slimeBig', 4, 4);
  let r = SPK.damageEnemy(e, 3);
  assert.equal(r.popped, false);
  assert.equal(r.spawn.length, 0);
  r = SPK.damageEnemy(e, 1);
  assert.equal(r.popped, true);
  assert.equal(r.spawn.length, 2);
  assert.ok(r.spawn.every((s) => s.kind === 'slimeMini'));
  assert.equal(SPK.damageEnemy(foe('slime', 0, 0), 5).spawn.length, 0);
});

test('enemyHit caps damage at half a heart on easy', () => {
  assert.equal(SPK.enemyHit({ difficulty: 'easy' }, 2), 1);
  assert.equal(SPK.enemyHit({ difficulty: 'normal' }, 2), 2);
  assert.equal(SPK.enemyHit({ difficulty: 'normal' }, 0), 1);
});

test('enemy stats match the design', () => {
  assert.equal(SPK.ENEMIES.slime.hp, 2);
  assert.equal(SPK.ENEMIES.slimeBig.hp, 4);
  assert.equal(SPK.ENEMIES.slimeMini.hp, 1);
  assert.equal(SPK.ENEMIES.mushroom.hp, 3);
  assert.equal(SPK.ENEMIES.mushroom.spore.every, 2.2);
});

// ── Task 6: hearts, sleepy, campfires, Mighty Horn ──────────────────────
test('hurt then immune for 1.2s', () => {
  const g = SPK.createGame('normal');
  assert.equal(SPK.hurt(g, 1, 1000), 'ok');
  assert.equal(g.hp, 7);
  assert.equal(SPK.hurt(g, 1, 2100), 'immune');
  assert.equal(g.hp, 7);
  assert.equal(SPK.hurt(g, 2, 2201), 'ok');
  assert.equal(g.hp, 5);
});

test('hurt to zero gives sleepy; wake keeps progress, refills hp, moves to the wake fire', () => {
  const g = SPK.createGame('normal');
  g.gems = 17; g.powers.mighty = true; g.chests.push('meadow:C:8,8'); g.map = 'pebble'; g.x = 99; g.y = 99;
  g.campfires.push('pebble:F:5,10'); g.wakeCampfire = 'pebble:F:5,10';
  g.hp = 1;
  assert.equal(SPK.hurt(g, 2, 5000), 'sleepy');
  assert.equal(g.mode, 'sleepy');
  assert.equal(g.hp, 0);
  SPK.wake(g);
  assert.equal(g.mode, 'play');
  assert.equal(g.hp, g.hpMax);
  assert.equal(g.gems, 17);
  assert.equal(g.powers.mighty, true);
  assert.deepEqual(Array.from(g.chests), ['meadow:C:8,8']);
  assert.equal(g.map, 'pebble');
  const tx = Math.floor(g.x / SPK.TILE), ty = Math.floor(g.y / SPK.TILE);
  assert.ok(Math.abs(tx - 5) + Math.abs(ty - 10) === 1, `woke next to the fire, at ${tx},${ty}`);
  assert.equal(SPK.isSolid(SPK.parseMap('pebble'), tx, ty, { broken: [], powers: {} }), false);
});

test('lighting a campfire sets the wake point and heals', () => {
  const g = SPK.createGame('easy');
  g.hp = 3;
  assert.equal(SPK.lightCampfire(g, 'meadow:F:38,10'), true);
  assert.equal(g.wakeCampfire, 'meadow:F:38,10');
  assert.equal(g.hp, 12);
  assert.equal(SPK.lightCampfire(g, 'meadow:F:38,10'), false);
  assert.equal(g.campfires.length, 1);
});

test('hpMaxFor counts complete hearts only', () => {
  const g = SPK.createGame('normal');
  g.heartPieces = ['a', 'b', 'c'];
  assert.equal(SPK.hpMaxFor(g), 8);
  g.heartPieces.push('d');
  assert.equal(SPK.hpMaxFor(g), 10);
});

test('bonking a cracked boulder needs Mighty Horn and 0.6s on the same boulder', () => {
  const g = SPK.createGame('normal');
  assert.equal(SPK.bonkTick(g, 'meadow:B:7,27', 1), false, 'no mighty, no break');
  g.powers.mighty = true;
  assert.equal(SPK.bonkTick(g, 'meadow:B:7,27', 0.3), false);
  assert.equal(SPK.bonkTick(g, 'meadow:B:9,9', 0.3), false, 'switching boulders resets');
  assert.equal(SPK.bonkTick(g, 'meadow:B:9,9', 0.3), true);
  assert.equal(SPK.bonkTick(g, null, 0.1), false, 'not pushing resets');
});

// ── Task 7: power-ups ───────────────────────────────────────────────────
test('star burst lasts 15s and a second one refreshes it', () => {
  const g = SPK.createGame('normal');
  SPK.grantPowerup(g, 'starBurst', 0);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 14999)), ['starBurst']);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 15001)), []);
  SPK.grantPowerup(g, 'starBurst', 10000);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 24000)), ['starBurst']);
});

test('swirl ends when all 6 orbs are used, even before 30s', () => {
  const g = SPK.createGame('normal');
  SPK.grantPowerup(g, 'swirl', 0);
  assert.equal(g.fx.swirl.orbs, 6);
  for (let i = 0; i < 5; i++) SPK.swirlHit(g, 0);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 1000)), ['swirl']);
  SPK.swirlHit(g, 0);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 1000)), []);
  SPK.grantPowerup(g, 'swirl', 2000);
  assert.equal(g.fx.swirl.orbs, 6, 'a new one brings all the orbs back');
  assert.deepEqual(Array.from(SPK.activePowerups(g, 31999)), ['swirl']);
  assert.deepEqual(Array.from(SPK.activePowerups(g, 32001)), []);
});

test('swirl orb positions shrink as orbs are used', () => {
  const g = SPK.createGame('normal');
  SPK.grantPowerup(g, 'swirl', 0);
  assert.equal(SPK.swirlOrbPositions(g, 500).length, 6);
  SPK.swirlHit(g, 0); SPK.swirlHit(g, 0);
  const pos = SPK.swirlOrbPositions(g, 500);
  assert.equal(pos.length, 4);
  for (const p of pos) assert.ok(near(Math.hypot(p.x - g.x, p.y - g.y), 1.4 * SPK.TILE, 1e-6));
});

test('star burst makes magic fire 5 bolts', () => {
  const g = SPK.createGame('normal');
  assert.equal(SPK.fireMagic(g, 0, 0).length, 1);
  SPK.grantPowerup(g, 'starBurst', 0);
  const a = SPK.fireMagic(g, 0, 100);
  assert.equal(a.length, 5);
  assert.ok(near(a[2], 0));
  assert.equal(SPK.fireMagic(g, 0, 16000).length, 1, 'back to one when it runs out');
});

export { SPK, near };
