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

test('a finger held perfectly still stays held while it is still on the screen', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  inp.down(1, L.magic.x, L.magic.y, 0, 'touch');
  inp.tick(10000, 1); // 10 s later, no move events, one finger still touching
  assert.equal(inp.held('magic'), true);
  assert.equal(inp.active(), 1);
});

test('watchdog releases touch fingers the screen says are gone', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const p = joyPoint(L);
  inp.down(1, p.x, p.y, 0, 'touch');
  inp.down(2, L.magic.x, L.magic.y, 100, 'touch');
  inp.tick(5000, 1); // iOS lost one pointerup: only one finger is really down
  assert.equal(inp.active(), 1);
  assert.equal(inp.lastReset, 'watchdog');
  inp.tick(5100, 0); // and now none
  assert.equal(inp.active(), 0);
});

test('watchdog never drops a brand-new touch before the screen reports it', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  inp.down(1, L.magic.x, L.magic.y, 1000, 'touch');
  inp.tick(1100, 0);
  assert.equal(inp.active(), 1);
});

test('mouse buttons held still are kept; a silent pointer with no touch info times out after 30s', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  inp.down(1, L.magic.x, L.magic.y, 0, 'mouse');
  inp.tick(10000, 0); // a touch laptop reporting 0 touches must not drop the mouse
  assert.equal(inp.held('magic'), true);
  inp.tick(30001, 0);
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
const REAL_MAPS = ['meadow', 'pebble', 'woods', 'grotto', 'bubble', 'lake', 'cloud', 'hills', 'ruins', 'hollow', 'throne'];

test('maps parse with consistent widths', () => {
  for (const id of REAL_MAPS) {
    const rows = SPK.MAPS[id].rows;
    const m = SPK.parseMap(id);
    assert.equal(m.h, rows.length);
    for (const r of rows) assert.equal(r.length, m.w, `${id} row width`);
    if (id === 'meadow') assert.equal(m.entities.filter((e) => e.kind === '@').length, 1, 'meadow has one start');
    if (m.cave) assert.equal(m.entities.filter((e) => e.kind === 'U').length, 1, `${id} has one way out`);
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
  for (const id of REAL_MAPS) for (const e of SPK.parseMap(id).entities) if (e.kind === 'D' || e.kind === 'U' || e.kind === '>') doors.push(e.id);
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
  const KEY = ['C', 'H', 'F', 'P', 'D', 'U', '>'];
  const meadow = SPK.parseMap('meadow');
  const start = meadow.entities.find((e) => e.kind === '@');
  const withB = flood(meadow, start.tx, start.ty, true);
  const withoutB = flood(meadow, start.tx, start.ty, false);
  const blocked = [];
  for (const e of meadow.entities.filter((e) => KEY.includes(e.kind))) {
    assert.ok(withB(e), `${e.id} reachable once boulders are broken`);
    if (!withoutB(e)) blocked.push(e.id);
  }
  assert.deepEqual(blocked.sort(), ['meadow:>:47,14', 'meadow:C:4,28'], `the secret chest and the way to the woods hide behind boulders: ${blocked}`);
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
  assert.equal(count('meadow', 'B'), 2);
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

// ── Task 8: chests, heart pieces, hints ─────────────────────────────────
test('every chest has contents and every contents entry is a real chest', () => {
  const chestIds = [];
  for (const id of REAL_MAPS) for (const e of SPK.parseMap(id).entities) if (e.kind === 'C') chestIds.push(e.id);
  for (const id of chestIds) assert.ok(SPK.CHESTS[id], `${id} has contents`);
  for (const id of Object.keys(SPK.CHESTS)) assert.ok(chestIds.includes(id), `${id} is on a map`);
  const kinds = Object.values(SPK.CHESTS).map((c) => Object.keys(c)[0]);
  const pu = Object.values(SPK.CHESTS).filter((c) => c.powerup).map((c) => c.powerup);
  for (const k of Object.keys(SPK.POWERUPS)) assert.ok(pu.includes(k), `some chest holds ${k}`);
  for (const k of pu) assert.ok(SPK.POWERUPS[k], `${k} is a real power-up`);
  assert.equal(SPK.CHESTS['pebble:C:15,16'].powerup, 'swirl');
});

test('openChest is once-only and adds gems', () => {
  const g = SPK.createGame('normal');
  const gemChest = Object.keys(SPK.CHESTS).find((id) => SPK.CHESTS[id].gems);
  const c = SPK.openChest(g, gemChest);
  assert.equal(c.gems, SPK.CHESTS[gemChest].gems);
  assert.equal(g.gems, c.gems);
  assert.equal(SPK.openChest(g, gemChest), null);
  assert.equal(g.gems, c.gems);
  assert.deepEqual(Array.from(g.chests), [gemChest]);
});

test('four heart pieces raise hpMax by one heart and fill it', () => {
  const g = SPK.createGame('normal');
  const spots = SPK.parseMap('meadow').entities.filter((e) => e.kind === 'H').map((e) => e.id);
  spots.forEach((id) => assert.equal(SPK.collectHeartPiece(g, id), true));
  assert.equal(SPK.collectHeartPiece(g, spots[0]), false, 'once only');
  assert.equal(g.hpMax, 8);
  const heartChest = Object.keys(SPK.CHESTS).find((id) => SPK.CHESTS[id].heartPiece);
  SPK.openChest(g, heartChest);
  assert.equal(g.heartPieces.length, 4);
  assert.equal(g.hpMax, 10);
  assert.equal(g.hp, 10);
});

test('nextGoal leads from the cave door to the pedestal to the boulder, then rests', () => {
  const g = SPK.createGame('easy');
  const tile = (goal) => goal && `${goal.map}:${goal.tx},${goal.ty}`;
  assert.equal(tile(SPK.nextGoal(g)), 'meadow:24,5');
  g.map = 'pebble';
  assert.equal(tile(SPK.nextGoal(g)), 'pebble:27,11');
  g.powers.mighty = true;
  assert.equal(tile(SPK.nextGoal(g)), 'pebble:1,10', 'head back out');
  g.map = 'meadow';
  assert.equal(tile(SPK.nextGoal(g)), 'meadow:7,27');
  g.broken.push('meadow:B:7,27');
  assert.equal(tile(SPK.nextGoal(g)), 'meadow:46,14', 'then the rock on the way to the woods');
});

test('the bunny says something different as you progress', () => {
  const g = SPK.createGame('easy');
  const a = SPK.critterHint(g).picture.join('');
  g.powers.mighty = true;
  const b = SPK.critterHint(g).picture.join('');
  g.broken.push('meadow:B:7,27');
  const c = SPK.critterHint(g).picture.join('');
  assert.ok(a !== b && b !== c && a !== c);
});

// ── Task 9: saves ───────────────────────────────────────────────────────
function playedGame() {
  const g = SPK.createGame('normal');
  g.powers.mighty = true;
  SPK.openChest(g, 'meadow:C:8,8');
  SPK.openChest(g, 'meadow:C:40,28');
  g.gems = 17;
  SPK.collectHeartPiece(g, 'meadow:H:3,3');
  SPK.lightCampfire(g, 'meadow:F:38,10');
  g.broken.push('meadow:B:7,27');
  g.map = 'pebble'; g.x = 10.5 * SPK.TILE; g.y = 9.5 * SPK.TILE; g.hp = 5;
  const m = SPK.parseMap('pebble');
  g.explored.pebble = new Uint8Array(m.w * m.h);
  [0, 7, 8, 9, 100, 599].forEach((i) => { g.explored.pebble[i] = 1; });
  g.mode = 'play';
  return g;
}

test('explored bits survive encode/decode', () => {
  const a = new Uint8Array(37); [0, 1, 8, 15, 36].forEach((i) => { a[i] = 1; });
  assert.deepEqual(Array.from(SPK.decodeBits(SPK.encodeBits(a), 37)), Array.from(a));
});

test('save round-trip keeps everything you found', () => {
  const g = playedGame();
  const save = JSON.parse(JSON.stringify(SPK.getSave(g)));
  const back = SPK.applySave(SPK.validateSave(save));
  assert.equal(back.mode, 'welcome');
  for (const k of ['difficulty', 'map', 'hp', 'hpMax', 'gems', 'wakeCampfire', 'bossBeaten']) assert.deepEqual(back[k], g[k], k);
  for (const k of ['chests', 'friends', 'heartPieces', 'campfires', 'broken']) assert.deepEqual(Array.from(back[k]), Array.from(g[k]), k);
  assert.equal(back.powers.mighty, true);
  assert.equal(back.x, g.x); assert.equal(back.y, g.y);
  assert.deepEqual(Array.from(back.explored.pebble), Array.from(g.explored.pebble));
});

test('a save made while sleepy wakes you at your campfire instead of breaking', () => {
  const g = playedGame();
  g.hp = 0; g.mode = 'sleepy';
  const save = JSON.parse(JSON.stringify(SPK.getSave(g)));
  const back = SPK.applySave(SPK.validateSave(save));
  assert.equal(back.hp, back.hpMax);
  assert.equal(back.map, 'meadow');
  assert.equal(back.gems, 17);
});

test('power-ups are not saved', () => {
  const g = playedGame();
  SPK.grantPowerup(g, 'starBurst', 0);
  assert.equal(JSON.stringify(SPK.getSave(g)).includes('starBurst'), false);
});

const bad = (mut) => { const s = JSON.parse(JSON.stringify(SPK.getSave(playedGame()))); mut(s); return s; };
test('validateSave rejects a wrong version', () => {
  assert.throws(() => SPK.validateSave(bad((s) => { s.v = 2; })), /bad save: v/);
});
test('a save from an older map layout still loads: you wake at your campfire', () => {
  // the map changed under the save: the spot is now a wall, or the map is gone
  for (const mut of [(s) => { s.x = 0; s.y = 0; }, (s) => { s.map = 'moon'; }]) {
    const back = SPK.applySave(SPK.validateSave(bad(mut)));
    const m = SPK.parseMap(back.map);
    assert.equal(SPK.isSolid(m, Math.floor(back.x / SPK.TILE), Math.floor(back.y / SPK.TILE), { broken: back.broken, powers: back.powers }), false);
    assert.equal(back.gems, 17, 'progress kept');
  }
});
test('a save whose campfire no longer exists wakes you at home', () => {
  const back = SPK.applySave(SPK.validateSave(bad((s) => { s.wakeCampfire = 'meadow:F:99,99'; s.hp = 0 + 5; })));
  assert.equal(back.wakeCampfire, SPK.HOME_FIRE);
  assert.equal(back.gems, 17);
});
test('validateSave still rejects a map name that is not a string', () => {
  assert.throws(() => SPK.validateSave(bad((s) => { s.map = 42; })), /bad save: map/);
});
test('validateSave rejects non-array chests', () => {
  assert.throws(() => SPK.validateSave(bad((s) => { s.chests = 'all of them'; })), /bad save: chests/);
});
test('validateSave rejects nonsense hearts and difficulty', () => {
  assert.throws(() => SPK.validateSave(bad((s) => { s.hp = 99; })), /bad save: hp/);
  assert.throws(() => SPK.validateSave(bad((s) => { s.difficulty = 'hard'; })), /bad save: difficulty/);
  assert.throws(() => SPK.validateSave(null), /bad save/);
});

test('save stays small', () => {
  const g = playedGame();
  for (const id of ['meadow', 'pebble']) { const m = SPK.parseMap(id); g.explored[id] = new Uint8Array(m.w * m.h).fill(1); }
  const n = JSON.stringify(SPK.getSave(g)).length;
  assert.ok(n < 4000, `save is ${n} chars`);
});

test('the horn is the strong close-up attack: one hit pops slimes and mushrooms', () => {
  const g = SPK.createGame('normal');
  assert.ok(SPK.hornDamage(g) >= SPK.ENEMIES.mushroom.hp);
  assert.ok(SPK.hornDamage(g) >= SPK.ENEMIES.slime.hp);
  assert.ok(SPK.hornDamage(g) > 1, 'stronger than a magic bolt');
  g.powers.mighty = true;
  assert.ok(SPK.hornDamage(g) >= SPK.ENEMIES.slimeBig.hp, 'Mighty Horn pops even big slimes');
});

test('a tap anywhere that is not a button walks you there (not just in the joystick area)', () => {
  const L = LAND();
  const inp = SPK.createInput(L);
  const spots = [{ x: 400, y: 20 }, { x: 700, y: 120 }, { x: 60, y: 30 }];
  for (const p of spots) {
    inp.down(1, p.x, p.y, 0);
    inp.up(1, p.x, p.y, 80);
    assert.deepEqual({ ...inp.consumeTap() }, p);
  }
  // but a drag up there is not a joystick and not a tap
  inp.down(2, 400, 20, 0); inp.move(2, 460, 20, 50); inp.up(2, 460, 20, 90);
  assert.equal(inp.consumeTap(), null);
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 });
});

export { SPK, near };

// ── Slice 2, Task 1: the woods ──────────────────────────────────────────
// Things on the woods pond island need Bubble Hooves.
const ISLAND = ['woods:C:26,24', 'woods:H:26,25'];

test('woods is 56x36 and its west exit links back to the meadow', () => {
  const m = SPK.parseMap('woods');
  assert.equal(m.w, 56); assert.equal(m.h, 36);
  assert.equal(SPK.DOORS['woods:>:0,14'].at, 'meadow:>:47,14');
  assert.equal(SPK.DOORS['meadow:>:47,14'].at, 'woods:>:0,14');
  assert.deepEqual({ ...SPK.doorArrival('meadow:>:47,14') }, { map: 'meadow', tx: 46, ty: 14 });
  assert.deepEqual({ ...SPK.doorArrival('woods:>:0,14') }, { map: 'woods', tx: 1, ty: 14 });
});

test('the woods are behind the east boulder, which needs Mighty Horn', () => {
  const m = SPK.parseMap('meadow');
  assert.equal(SPK.tileAt(m, 46, 14), 'B');
  assert.equal(SPK.tileAt(m, 47, 14), '>');
  assert.equal(SPK.isSolid(m, 47, 14, null), false, 'the exit itself is walkable');
});

test('everything in the woods is reachable (the island needs water)', () => {
  const m = SPK.parseMap('woods');
  const KEY = ['C', 'H', 'F', 'D', '*', '>'];
  const r = flood(m, 0, 14, true);
  for (const e of m.entities.filter((e) => KEY.includes(e.kind))) {
    if (ISLAND.includes(e.id)) assert.ok(!r(e), `${e.id} needs Bubble Hooves`);
    else assert.ok(r(e), `${e.id} reachable`);
  }
});

test('woods content counts', () => {
  const count = (k) => SPK.parseMap('woods').entities.filter((e) => e.kind === k).length;
  assert.deepEqual(['F', 'C', 'H', 'S', 'M', '*', 'D', 'B', 'L'].map(count), [2, 8, 1, 5, 6, 3, 2, 1, 1]);
});

test('exits include edge paths', () => {
  assert.ok(SPK.EXITS['>'] && SPK.EXITS.D && SPK.EXITS.U);
});

// ── Slice 2, Task 2: two caves, their powers, light, bats ───────────────
const WATER_ONLY = [...ISLAND, 'bubble:C:15,11', 'bubble:H:16,12', 'bubble:*:15,13'];
const CAVES = { grotto: [36, 24, 'grotto:U:1,12', 'woods:D:30,4'], bubble: [34, 22, 'bubble:U:32,11', 'woods:D:51,26'] };

test('the grotto and bubble cavern parse and link to their woods doors', () => {
  for (const [id, [w, h, exit, door]] of Object.entries(CAVES)) {
    const m = SPK.parseMap(id);
    assert.equal(m.w, w); assert.equal(m.h, h);
    assert.ok(m.cave, `${id} is a cave`);
    assert.equal(SPK.DOORS[door].at, exit);
    assert.equal(SPK.DOORS[exit].at, door);
  }
  assert.deepEqual({ ...SPK.doorArrival('woods:D:30,4') }, { map: 'woods', tx: 30, ty: 5 }, 'out of the grotto onto the broken boulder spot');
  assert.deepEqual({ ...SPK.doorArrival('woods:D:51,26') }, { map: 'woods', tx: 50, ty: 26 });
});

test('everything in each cave is reachable; island things need water, and are reachable with it', () => {
  const KEY = ['C', 'H', 'F', 'P', '*', 'U'];
  for (const [id, [, , exit]] of Object.entries(CAVES)) {
    const m = SPK.parseMap(id);
    const e0 = SPK.entity(exit);
    const dry = flood(m, e0.tx, e0.ty, true);
    for (const e of m.entities.filter((e) => KEY.includes(e.kind))) {
      if (WATER_ONLY.includes(e.id)) assert.ok(!dry(e), `${e.id} needs Bubble Hooves`);
      else assert.ok(dry(e), `${e.id} reachable`);
    }
  }
  // with bubble hooves, the water things are reachable
  for (const id of WATER_ONLY) {
    const mapId = id.split(':')[0];
    const m = SPK.parseMap(mapId);
    const start = mapId === 'woods' ? { tx: 0, ty: 14 } : SPK.entity(CAVES[mapId][2]);
    const seen = new Set([`${start.tx},${start.ty}`]); const q = [[start.tx, start.ty]];
    const ctx = { broken: m.entities.filter((e) => e.kind === 'B').map((e) => e.id), powers: { bubble: true } };
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (seen.has(k) || SPK.isSolid(m, x + dx, y + dy, ctx)) continue;
        seen.add(k); q.push([x + dx, y + dy]);
      }
    }
    const e = SPK.entity(id);
    assert.ok(seen.has(`${e.tx},${e.ty}`), `${id} reachable with Bubble Hooves`);
  }
});

test('each pedestal grants its power once', () => {
  assert.deepEqual(Object.values(SPK.PEDESTALS).map((p) => p.power).sort(), ['bubble', 'glow', 'hop', 'mighty']);
  for (const id of Object.keys(SPK.PEDESTALS)) assert.equal(SPK.entity(id).kind, 'P', `${id} is a pedestal`);
  const g = SPK.createGame('easy');
  const r = SPK.takePedestal(g, 'grotto:P:32,4');
  assert.ok(r && r.item && r.picture.length && r.text);
  assert.equal(g.powers.glow, true);
  assert.equal(SPK.takePedestal(g, 'grotto:P:32,4'), null, 'only once');
  assert.equal(SPK.takePedestal(g, 'pebble:P:27,11').power, 'mighty');
});

test('light: grotto is dim, bubble cavern is dark, Glow Horn lights both; outside is lit', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.lightRadius(g, SPK.parseMap('meadow')), null);
  assert.equal(SPK.lightRadius(g, SPK.parseMap('pebble')), null);
  assert.equal(SPK.lightRadius(g, SPK.parseMap('grotto')), 4.5);
  assert.equal(SPK.lightRadius(g, SPK.parseMap('bubble')), 2.2);
  g.powers.glow = true;
  assert.equal(SPK.lightRadius(g, SPK.parseMap('grotto')), 7);
  assert.equal(SPK.lightRadius(g, SPK.parseMap('bubble')), 7);
});

test('a save on water with bubble hooves keeps its spot', () => {
  const g = SPK.createGame('normal');
  g.powers.mighty = g.powers.bubble = true;
  g.map = 'woods'; g.x = 22.5 * SPK.TILE; g.y = 22.5 * SPK.TILE; g.mode = 'play';
  const s = SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g))));
  assert.deepEqual([s.map, s.x, s.y], ['woods', 22, 22]);
});

test('cave bats: one hit, quick dives', () => {
  const b = SPK.ENEMIES.bat;
  assert.equal(b.hp, 1);
  assert.ok(b.dive && b.dive.every > 1.5 && b.dive.dur < 1);
});

// ── Slice 2, Task 3: the way forward ────────────────────────────────────
const tileOf = (goal) => goal && `${goal.map}:${goal.tx},${goal.ty}`;

test('exitToward finds the door that leads toward another map', () => {
  assert.equal(SPK.exitToward('grotto', 'meadow'), 'grotto:U:1,12');
  assert.equal(SPK.exitToward('meadow', 'grotto'), 'meadow:>:47,14');
  assert.equal(SPK.exitToward('pebble', 'bubble'), 'pebble:U:1,10');
  assert.equal(SPK.exitToward('woods', 'bubble'), 'woods:D:51,26');
  assert.equal(SPK.exitToward('woods', 'woods'), null);
});

test('nextGoal walks the whole slice 2 chain, hopping maps through doors', () => {
  const g = SPK.createGame('easy');
  g.powers.mighty = true;
  g.broken.push('meadow:B:7,27');
  assert.equal(tileOf(SPK.nextGoal(g)), 'meadow:46,14');
  g.broken.push('meadow:B:46,14');
  assert.equal(tileOf(SPK.nextGoal(g)), 'meadow:47,14', 'walk on into the woods');
  g.map = 'woods';
  assert.equal(tileOf(SPK.nextGoal(g)), 'woods:30,5', 'the rock in front of the grotto');
  g.broken.push('woods:B:30,5');
  assert.equal(tileOf(SPK.nextGoal(g)), 'woods:30,4', 'into the grotto');
  g.map = 'grotto';
  assert.equal(tileOf(SPK.nextGoal(g)), 'grotto:32,4');
  g.powers.glow = true;
  assert.equal(tileOf(SPK.nextGoal(g)), 'grotto:1,12', 'back out');
  g.map = 'woods';
  assert.equal(tileOf(SPK.nextGoal(g)), 'woods:51,26', 'to the bubble cavern');
  g.map = 'bubble';
  assert.equal(tileOf(SPK.nextGoal(g)), 'bubble:3,3');
  g.powers.bubble = true;
  assert.equal(tileOf(SPK.nextGoal(g)), 'bubble:32,11');
  g.map = 'woods';
  assert.equal(tileOf(SPK.nextGoal(g)), 'woods:26,24', 'walk on water to the island');
  SPK.openChest(g, 'woods:C:26,24');
  assert.equal(tileOf(SPK.nextGoal(g)), 'woods:55,14', 'then east to the lake');
});

test('a slice-1 save still loads and points to the woods', () => {
  const g = SPK.createGame('normal');
  g.powers.mighty = true; g.broken.push('meadow:B:7,27'); SPK.openChest(g, 'meadow:C:4,28');
  g.mode = 'play';
  const loaded = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.equal(tileOf(SPK.nextGoal(loaded)), 'meadow:46,14');
});

test('the critters have a different picture hint at every stage', () => {
  assert.deepEqual([...SPK.CRITTERS.map((c) => c.map)].sort(), ['hills', 'lake', 'meadow', 'ruins', 'woods']);
  for (const c of SPK.CRITTERS) assert.ok(!SPK.isSolid(SPK.parseMap(c.map), c.tx, c.ty, null), `${c.emoji} stands on open ground`);
  const g = SPK.createGame('easy');
  const seen = new Set();
  const step = (f) => { f(); seen.add(SPK.critterHint(g).picture.join('')); };
  step(() => {});
  step(() => { g.powers.mighty = true; });
  step(() => { g.broken.push('meadow:B:7,27'); });
  step(() => { g.broken.push('meadow:B:46,14'); });
  step(() => { g.powers.glow = true; });
  step(() => { g.powers.bubble = true; });
  step(() => { SPK.openChest(g, 'woods:C:26,24'); });
  step(() => { g.powers.hop = true; });
  step(() => { SPK.openChest(g, 'hills:C:31,3'); });
  assert.equal(seen.size, 9);
});

// ── Slice 2, Task 4: power-ups and Big Sparkle ──────────────────────────
test('the new power-ups last as designed and a second one refreshes', () => {
  const want = { zoomy: 15, rainbow: 12, magnet: 20, mega: 10 };
  for (const [k, secs] of Object.entries(want)) {
    assert.equal(SPK.POWERUPS[k].secs, secs, k);
    const g = SPK.createGame('easy');
    SPK.grantPowerup(g, k, 0);
    assert.ok(SPK.hasPowerup(g, k, secs * 1000 - 1));
    assert.ok(!SPK.hasPowerup(g, k, secs * 1000 + 1));
    SPK.grantPowerup(g, k, 5000);
    assert.ok(SPK.hasPowerup(g, k, secs * 1000 + 4000), `${k} refreshed`);
  }
});

test('zoomy hooves: faster walking and a longer horn dash', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.speedMul(g, 0), 1);
  assert.equal(SPK.hornStats(g, 0).dist, 2.5);
  SPK.grantPowerup(g, 'zoomy', 0);
  assert.equal(SPK.speedMul(g, 100), 1.6);
  assert.equal(SPK.hornStats(g, 100).dist, 3.5);
});

test('mega horn: twice as big and pops anything in one hit', () => {
  const g = SPK.createGame('easy');
  const base = SPK.hornStats(g, 0);
  assert.equal(base.radius, 0.95);
  assert.equal(base.dmg, SPK.hornDamage(g));
  SPK.grantPowerup(g, 'mega', 0);
  const m = SPK.hornStats(g, 100);
  assert.equal(m.radius, 1.9);
  assert.ok(m.dmg >= SPK.ENEMIES.slimeBig.hp && m.dmg >= SPK.ENEMIES.mushroom.hp);
});

test('gem magnet reaches far', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.magnetRange(g, 0), 1.4);
  SPK.grantPowerup(g, 'magnet', 0);
  assert.equal(SPK.magnetRange(g, 100), 9);
});

test('big sparkle is a chest upgrade that makes bolts do 2', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.boltDamage(g), 1);
  const id = Object.keys(SPK.CHESTS).find((k) => SPK.CHESTS[k].upgrade === 'bigSparkle');
  assert.ok(id && id.startsWith('grotto:'), 'Big Sparkle waits in the grotto');
  SPK.openChest(g, id);
  assert.equal(g.powers.bigSparkle, true);
  assert.equal(SPK.boltDamage(g), 2);
});

// ── Slice 2, Task 5: Star Friends ───────────────────────────────────────
test('every star friend spot has a friend, and every friend has a spot', () => {
  const spots = [];
  for (const id of REAL_MAPS) for (const e of SPK.parseMap(id).entities) if (e.kind === '*') spots.push(e.id);
  assert.equal(spots.length, 12);
  for (const id of spots) assert.ok(SPK.FRIENDS[id] && SPK.FRIENDS[id].emoji && SPK.FRIENDS[id].name, `${id} has a friend`);
  for (const id of Object.keys(SPK.FRIENDS)) assert.ok(spots.includes(id), `${id} is on a map`);
  const meadow = SPK.parseMap('meadow');
  const start = meadow.entities.find((e) => e.kind === '@');
  const r = flood(meadow, start.tx, start.ty, false);
  for (const e of meadow.entities.filter((e) => e.kind === '*')) assert.ok(r(e), `${e.id} reachable from the start`);
});

test('meeting a friend happens once', () => {
  const g = SPK.createGame('easy');
  const id = Object.keys(SPK.FRIENDS)[0];
  const f = SPK.meetFriend(g, id);
  assert.ok(f && f.emoji);
  assert.equal(SPK.meetFriend(g, id), null);
  assert.equal(SPK.meetFriend(g, 'meadow:*:0,0'), null, 'not a friend');
  assert.equal(g.friends.length, 1);
});

test('the friends book lists every friend in a fixed order with found flags', () => {
  const g = SPK.createGame('easy');
  const ids = Object.keys(SPK.FRIENDS);
  SPK.meetFriend(g, ids[2]);
  const book = SPK.friendsBook(g);
  assert.equal(book.length, 12);
  assert.deepEqual(book.map((b) => b.found), [false, false, true, false, false, false, false, false, false, false, false, false]);
  assert.equal(book[2].emoji, SPK.FRIENDS[ids[2]].emoji);
});

test('friends survive a save', () => {
  const g = SPK.createGame('easy');
  SPK.meetFriend(g, 'woods:*:3,3');
  g.mode = 'play';
  const back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.deepEqual([...back.friends], ['woods:*:3,3']);
});

// ── Slice 2, Task 6: map screen and fast travel ─────────────────────────
test('every map has a picture for the map screen', () => {
  for (const id of REAL_MAPS) assert.ok(SPK.MAP_ICON[id], `${id} icon`);
});

test('mapMarks hides unexplored things and opened chests', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.mapMarks(g, 'meadow').length, 0, 'nothing explored yet');
  const m = SPK.parseMap('meadow');
  g.explored.meadow = new Uint8Array(m.w * m.h);
  const see = (id) => { const e = SPK.entity(id); g.explored.meadow[e.ty * m.w + e.tx] = 1; };
  see(SPK.HOME_FIRE); see('meadow:C:8,8'); see('meadow:D:24,5'); see('meadow:*:2,9');
  let marks = SPK.mapMarks(g, 'meadow');
  assert.deepEqual([...marks.map((k) => k.kind)].sort(), ['chest', 'door', 'fire', 'friend']);
  assert.equal(marks.find((k) => k.kind === 'fire').lit, false);
  SPK.lightCampfire(g, SPK.HOME_FIRE); SPK.openChest(g, 'meadow:C:8,8'); SPK.meetFriend(g, 'meadow:*:2,9');
  marks = SPK.mapMarks(g, 'meadow');
  assert.deepEqual([...marks.map((k) => k.kind)].sort(), ['door', 'fire']);
  assert.equal(marks.find((k) => k.kind === 'fire').lit, true);
  assert.equal(marks.find((k) => k.kind === 'door').to, 'pebble');
});

test('travelTargets lists only lit fires that still exist', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.travelTargets(g).length, 0);
  SPK.lightCampfire(g, SPK.HOME_FIRE);
  SPK.lightCampfire(g, 'woods:F:6,17');
  g.campfires.push('meadow:F:0,0');
  assert.deepEqual([...SPK.travelTargets(g)], [SPK.HOME_FIRE, 'woods:F:6,17']);
});

// ── Hint trail is a toggle (Jeremy: tapping it again should hide it) ────
test('the hint trail toggles on and off', () => {
  const easy = SPK.DIFF.easy, normal = SPK.DIFF.normal;
  const h = SPK.createHint(0);
  assert.equal(SPK.hintVisible(h, normal, 100), false);
  SPK.toggleHint(h, normal, 100);
  assert.equal(SPK.hintVisible(h, normal, 100), true);
  assert.equal(SPK.hintVisible(h, normal, 500), true, 'stays on until you turn it off');
  SPK.toggleHint(h, normal, 500);
  assert.equal(SPK.hintVisible(h, normal, 500), false, 'second tap hides it');
});

test('on easy the trail appears by itself, can be hidden, and comes back after the next discovery', () => {
  const easy = SPK.DIFF.easy;
  const h = SPK.createHint(0);
  assert.equal(SPK.hintVisible(h, easy, 10), false);
  assert.equal(SPK.hintVisible(h, easy, 50), true, 'after 45 s with nothing new');
  SPK.toggleHint(h, easy, 50);
  assert.equal(SPK.hintVisible(h, easy, 200), false, 'hidden stays hidden');
  SPK.hintDiscovery(h, 300);
  assert.equal(SPK.hintVisible(h, easy, 310), false);
  assert.equal(SPK.hintVisible(h, easy, 350), true, 'back 45 s after the next find');
});

test('a trail you turned on stays on through discoveries', () => {
  const h = SPK.createHint(0);
  SPK.toggleHint(h, SPK.DIFF.normal, 10);
  SPK.hintDiscovery(h, 20);
  assert.equal(SPK.hintVisible(h, SPK.DIFF.normal, 30), true);
});

// ── Slice 2 final review fixes ─────────────────────────────────────────
test('once the way to the woods is open, the trail no longer drags you back to the optional secret rock', () => {
  const g = SPK.createGame('easy');
  g.powers.mighty = true;
  g.broken.push('meadow:B:46,14', 'woods:B:30,5');
  g.map = 'grotto';
  assert.equal(SPK.stage(g).key, 'glow');
  assert.equal(tileOf(SPK.nextGoal(g)), 'grotto:32,4');
});

// ── Slice 3, Task 1: Crystal Lake, Cloud Cave, gaps and Cloud Hop, frogs ─
// Flood fill that knows about water (bubble) and gaps (hop).
function reach(mapId, sx, sy, powers) {
  const m = SPK.parseMap(mapId);
  const ctx = { broken: m.entities.filter((e) => e.kind === 'B').map((e) => e.id), powers };
  const seen = new Set([`${sx},${sy}`]); const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let n = SPK.isSolid(m, x + dx, y + dy, ctx) ? null : { tx: x + dx, ty: y + dy };
      if (!n && powers.hop) n = SPK.hopLanding(m, x, y, dx, dy, ctx);
      if (!n || seen.has(`${n.tx},${n.ty}`)) continue;
      seen.add(`${n.tx},${n.ty}`); q.push([n.tx, n.ty]);
    }
  }
  return (id) => { const e = SPK.entity(id); return seen.has(`${e.tx},${e.ty}`); };
}
const keyThings = (mapId) => SPK.parseMap(mapId).entities.filter((e) => 'CHFP*DU>LW'.includes(e.kind) && e.kind !== 'L').map((e) => e.id);

test('crystal lake is east of the woods; only its islands need Bubble Hooves', () => {
  const m = SPK.parseMap('lake');
  assert.equal(m.w, 52); assert.equal(m.h, 34);
  assert.equal(SPK.DOORS['woods:>:55,14'].at, 'lake:>:0,16');
  assert.equal(SPK.DOORS['lake:>:0,16'].at, 'woods:>:55,14');
  assert.equal(SPK.DOORS['lake:D:28,16'].at, 'cloud:U:1,10');
  assert.deepEqual({ ...SPK.doorArrival('lake:>:0,16') }, { map: 'lake', tx: 1, ty: 16 });
  assert.deepEqual({ ...SPK.doorArrival('woods:>:55,14') }, { map: 'woods', tx: 54, ty: 14 });
  assert.deepEqual({ ...SPK.doorArrival('lake:D:28,16') }, { map: 'lake', tx: 28, ty: 17 });
  const ISLANDS = ['lake:C:25,19', 'lake:C:22,23', 'lake:*:35,11', 'lake:D:28,16'];
  const dry = reach('lake', 1, 16, {}), wet = reach('lake', 1, 16, { bubble: true });
  for (const id of keyThings('lake')) {
    if (ISLANDS.includes(id)) assert.ok(!dry(id) && wet(id), `${id} needs Bubble Hooves`);
    else assert.ok(dry(id), `${id} reachable from the shore`);
  }
  assert.ok(reach('woods', 0, 14, {})('woods:>:55,14'), 'the woods path leads east to the lake');
});

test('cloud cave: the pedestal is reachable on foot; the room past the cloud gap needs Cloud Hop', () => {
  const m = SPK.parseMap('cloud');
  assert.equal(m.w, 34); assert.equal(m.h, 22);
  assert.ok(m.cave && !m.dark, 'a bright cave');
  assert.equal(SPK.DOORS['cloud:U:1,10'].at, 'lake:D:28,16');
  const HOP_ROOM = ['cloud:C:28,17', 'cloud:H:31,18', 'cloud:*:29,12'];
  const walk = reach('cloud', 1, 10, { bubble: true }), hop = reach('cloud', 1, 10, { bubble: true, hop: true });
  for (const id of keyThings('cloud')) {
    if (HOP_ROOM.includes(id)) assert.ok(!walk(id) && hop(id), `${id} needs Cloud Hop`);
    else assert.ok(walk(id), `${id} reachable on foot`);
  }
  assert.equal(SPK.PEDESTALS['cloud:P:30,3'].power, 'hop');
});

test('hopLanding hops 1-3 gap tiles to open ground, and refuses blocked or too-wide gaps', () => {
  SPK.MAPS.thop = { rows: [
    '############',
    '#.vv.......#',
    '#.vvvv.....#',
    '#.vvT......#',
    '#..........#',
    '#.v........#',
    '############'] };
  const m = SPK.parseMap('thop');
  assert.deepEqual({ ...SPK.hopLanding(m, 1, 1, 1, 0, null) }, { tx: 4, ty: 1 });
  assert.equal(SPK.hopLanding(m, 1, 2, 1, 0, null), null, 'four gap tiles is too far');
  assert.equal(SPK.hopLanding(m, 1, 3, 1, 0, null), null, 'a tree on the far side');
  assert.equal(SPK.hopLanding(m, 1, 4, 1, 0, null), null, 'no gap in the way');
  assert.deepEqual({ ...SPK.hopLanding(m, 3, 5, -1, 0, null) }, { tx: 1, ty: 5 }, 'hops either way');
  assert.equal(SPK.isSolid(m, 2, 1, null), true, 'you cannot walk into a gap');
  assert.equal(SPK.isSolid(m, 2, 1, { fly: true }), false, 'bees fly over gaps');
  delete SPK.MAPS.thop;
});

test('cloud hop: leaning into a gap for 0.25s hops, but only with the power', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.hopTick(g, 'thop:2,1', 1), false, 'no power, no hop');
  g.powers.hop = true;
  assert.equal(SPK.hopTick(g, 'thop:2,1', 0.1), false);
  assert.equal(SPK.hopTick(g, 'thop:2,1', 0.1), false);
  assert.equal(SPK.hopTick(g, 'thop:2,1', 0.06), true);
  assert.equal(SPK.hopTick(g, 'thop:2,1', 0.1), false, 'starts over after a hop');
  SPK.hopTick(g, null, 0.1);
  assert.equal(SPK.hopTick(g, 'thop:2,1', 0.2), false, 'letting go resets the lean');
});

test('splash frogs hop and spit slow water drops; bees and frogs never walk on water', () => {
  const f = SPK.ENEMIES.frog;
  assert.equal(f.hp, 2);
  assert.ok(f.spit.speed < SPK.ENEMIES.mushroom.spore.speed + 0.01 && f.spit.windup >= 0.5, 'slow and telegraphed');
  const m = SPK.parseMap('lake');
  assert.equal(SPK.isSolid(m, 20, 12, { powers: { bubble: true } }), false, 'you walk on water with Bubble Hooves');
  assert.equal(SPK.isSolid(m, 20, 12, { broken: [] }), true, 'enemies (no powers) do not');
  assert.equal(SPK.isSolid(m, 14, 16, null), false, 'lily pads are walkable');
});

test('a lake or cloud save loads back where you were, even standing on a lily pad', () => {
  const g = SPK.createGame('normal');
  g.map = 'lake'; g.x = 14.5 * 32; g.y = 16.5 * 32; g.mode = 'play';
  const back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.equal(back.map, 'lake'); assert.equal(back.x, 14.5 * 32);
});

// ── Slice 3, Task 2: Windy Hills, bees, Double Sparkle ──────────────────
test('windy hills: the bottom is open, every plateau above needs Cloud Hop', () => {
  const m = SPK.parseMap('hills');
  assert.equal(m.w, 50); assert.equal(m.h, 34);
  assert.deepEqual({ ...SPK.doorArrival('hills:>:25,33') }, { map: 'hills', tx: 25, ty: 32 });
  assert.deepEqual({ ...SPK.doorArrival('lake:>:26,0') }, { map: 'lake', tx: 26, ty: 1 });
  const LOWER = ['hills:>:25,33', 'hills:F:22,28', 'hills:C:40,30', 'hills:C:6,31'];
  const walk = reach('hills', 25, 32, { bubble: true }), hop = reach('hills', 25, 32, { bubble: true, hop: true });
  for (const id of keyThings('hills')) {
    if (LOWER.includes(id)) assert.ok(walk(id), `${id} reachable on foot`);
    else assert.ok(!walk(id) && hop(id), `${id} needs Cloud Hop`);
  }
  assert.equal(SPK.CHESTS['hills:C:31,3'].upgrade, 'doubleSparkle', 'Double Sparkle waits on the top plateau');
});

test('buzzy bees swoop with a wind-up before diving (2 hits)', () => {
  const b = SPK.ENEMIES.bee;
  assert.equal(b.hp, 2);
  assert.ok(b.dive.windup >= 0.5);
});

test('double sparkle fires two bolts, and seven with star burst', () => {
  const g = SPK.createGame('easy');
  assert.equal(SPK.fireMagic(g, 0, 0).length, 1);
  SPK.openChest(g, 'hills:C:31,3');
  assert.equal(g.powers.doubleSparkle, true);
  const two = [...SPK.fireMagic(g, 0, 0)];
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0] + two[1]) < 1e-9 && Math.abs(two[0]) > 0.05, 'side by side around the aim');
  SPK.grantPowerup(g, 'starBurst', 0);
  assert.equal(SPK.fireMagic(g, 0, 1).length, 7);
});

// ── Slice 3, Task 3: routing, hints, critters ───────────────────────────
test('nextGoal walks the slice 3 chain: lake, cloud cave, hills, then rests', () => {
  const g = SPK.createGame('easy');
  g.powers.mighty = g.powers.glow = g.powers.bubble = true;
  g.broken.push('meadow:B:7,27', 'meadow:B:46,14', 'woods:B:30,5');
  SPK.openChest(g, 'woods:C:26,24');
  g.map = 'meadow';
  assert.equal(tileOf(SPK.nextGoal(g)), 'meadow:47,14', 'from home, out through the woods');
  g.map = 'lake';
  assert.equal(SPK.stage(g).key, 'cloud');
  assert.equal(tileOf(SPK.nextGoal(g)), 'lake:28,16', 'the cave on the island');
  g.map = 'cloud';
  assert.equal(tileOf(SPK.nextGoal(g)), 'cloud:30,3');
  g.powers.hop = true;
  assert.equal(SPK.stage(g).key, 'hills');
  assert.equal(tileOf(SPK.nextGoal(g)), 'cloud:1,10', 'back out');
  g.map = 'lake';
  assert.equal(tileOf(SPK.nextGoal(g)), 'lake:26,0', 'north to the hills');
  g.map = 'hills';
  assert.equal(tileOf(SPK.nextGoal(g)), 'hills:31,3', 'the chest by the windmill');
  SPK.openChest(g, 'hills:C:31,3');
  assert.equal(SPK.stage(g).key, 'ruins', 'then on to the Moonlight Ruins');
});

test('a slice-2 save that finished the woods loads and points to the lake', () => {
  const g = SPK.createGame('normal');
  g.powers.mighty = g.powers.glow = g.powers.bubble = true;
  g.broken.push('meadow:B:7,27', 'meadow:B:46,14', 'woods:B:30,5');
  SPK.openChest(g, 'woods:C:26,24');
  g.map = 'woods'; g.x = 20.5 * 32; g.y = 14.5 * 32; g.mode = 'play';
  const loaded = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.equal(tileOf(SPK.nextGoal(loaded)), 'woods:55,14');
});

test('all twelve star friends and twelve heart pieces exist', () => {
  assert.equal(Object.keys(SPK.FRIENDS).length, 12);
  let hearts = 0;
  for (const id of REAL_MAPS) hearts += SPK.parseMap(id).entities.filter((e) => e.kind === 'H').length;
  hearts += Object.values(SPK.CHESTS).filter((c) => c.heartPiece).length;
  assert.equal(hearts, 12, 'twelve pieces: three whole extra hearts');
});

// ── Slice 3, Task 4: the Unicorn Closet ─────────────────────────────────
test('the closet sells three colors and three accessories at the planned prices', () => {
  const p = Object.fromEntries(SPK.CLOSET.map((i) => [i.id, [i.kind, i.price]]));
  assert.deepEqual(p, {
    mint: ['color', 30], galaxy: ['color', 60], rainbow: ['color', 100],
    crown: ['accessory', 25], cape: ['accessory', 45], horn: ['accessory', 70],
    rainbowCrown: ['accessory', null], // the boss's prize, never for sale
  });
  const m = SPK.parseMap('meadow');
  assert.equal(SPK.entity('meadow:W:10,17').kind, 'W', 'the wardrobe stands by the home campfire');
  assert.equal(SPK.isSolid(m, 10, 17, null), true, 'you bump into it to open it');
});

test('closetTap buys when you have the gems, then wears and takes off', () => {
  const g = SPK.createGame('easy');
  g.gems = 40;
  assert.equal(SPK.closetTap(g, 'galaxy'), 'poor');
  assert.equal(g.gems, 40, 'nothing spent');
  assert.equal(SPK.closetTap(g, 'mint'), 'bought');
  assert.equal(g.gems, 10);
  assert.deepEqual([...g.closet.owned], ['mint']);
  assert.equal(g.closet.wearing.color, 'mint', 'you wear it right away');
  assert.equal(SPK.closetTap(g, 'mint'), 'off');
  assert.equal(g.closet.wearing.color, null);
  assert.equal(SPK.closetTap(g, 'mint'), 'wear');
  assert.equal(g.gems, 10, 'wearing what you own is free');
  g.gems = 100;
  SPK.closetTap(g, 'crown'); SPK.closetTap(g, 'cape');
  assert.equal(g.closet.wearing.accessory, 'cape', 'one accessory at a time');
  assert.equal(g.closet.wearing.color, 'mint', 'colors and accessories are separate');
  assert.equal(SPK.closetTap(g, 'nope'), null);
});

test('switching difficulty in the closet keeps hearts sensible', () => {
  const g = SPK.createGame('normal');
  g.hp = 5;
  SPK.setDifficulty(g, 'easy');
  assert.equal(g.difficulty, 'easy');
  assert.equal(g.hpMax, 12);
  assert.equal(g.hp, 8, 'the same share of your hearts stays full (5/8 of 12, rounded)');
  SPK.setDifficulty(g, 'normal');
  assert.equal(g.hpMax, 8);
  assert.equal(g.hp, 5, 'switching back and forth is not a free heal');
  g.hp = 1; SPK.setDifficulty(g, 'easy'); SPK.setDifficulty(g, 'normal'); SPK.setDifficulty(g, 'easy'); SPK.setDifficulty(g, 'normal');
  assert.ok(g.hp <= 2, `round trips never heal (${g.hp})`);
  g.hp = 1; SPK.setDifficulty(g, 'normal');
  assert.ok(g.hp >= 1);
  assert.throws(() => SPK.setDifficulty(g, 'hard'));
  const back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave({ ...g, mode: 'play' })))));
  assert.equal(back.difficulty, 'normal', 'saved with the adventure');
});

test('a closet in a save loads back; wearing something you do not own is taken off', () => {
  const g = SPK.createGame('easy');
  g.gems = 200; SPK.closetTap(g, 'rainbow'); SPK.closetTap(g, 'horn'); g.mode = 'play';
  const back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.deepEqual([...back.closet.owned], ['rainbow', 'horn']);
  assert.equal(back.closet.wearing.color, 'rainbow');
  assert.equal(back.closet.wearing.accessory, 'horn');
  const s = JSON.parse(JSON.stringify(SPK.getSave(g)));
  s.closet = { owned: ['mint', 'unicornium'], wearing: { color: 'galaxy', accessory: 'crown' } };
  const odd = SPK.applySave(SPK.validateSave(s));
  assert.deepEqual([...odd.closet.owned], ['mint']);
  assert.equal(odd.closet.wearing.color, null);
  assert.equal(odd.closet.wearing.accessory, null);
});

// ── Slice 4, Task 1: the d-pad ──────────────────────────────────────────
test('a small d-pad sits bottom-left, clear of every button, on every screen', () => {
  for (const [w, h] of [[390, 844], [844, 390], [667, 375], [820, 1180], [1180, 820], [1440, 900]]) {
    const L = SPK.layoutControls(w, h);
    const d = L.dpad;
    assert.ok(d && d.r >= 50 && d.r <= 70, `${w}x${h} d-pad is small but thumb-sized`);
    assert.ok(d.x - d.r >= 0 && d.y + d.r <= h && d.x < w / 3 && d.y > h / 2, `${w}x${h} d-pad bottom-left and on screen`);
    for (const c of [L.horn, L.magic, L.map]) assert.ok(Math.hypot(c.x - d.x, c.y - d.y) > c.r + d.r, `${w}x${h} d-pad apart from buttons`);
  }
});

test('holding the d-pad walks in one of 8 directions; the middle does nothing', () => {
  const L = LAND(), d = L.dpad, inp = SPK.createInput(L);
  assert.equal(inp.down(1, d.x + d.r * 0.7, d.y, 0, 'touch'), 'dpad');
  let v = inp.moveVec();
  assert.ok(near(v.x, 1) && near(v.y, 0), `right ${JSON.stringify(v)}`);
  inp.move(1, d.x + d.r * 0.5, d.y - d.r * 0.45, 16); // up-right-ish
  v = inp.moveVec();
  assert.ok(near(v.x, Math.SQRT1_2) && near(v.y, -Math.SQRT1_2), `diagonal ${JSON.stringify(v)}`);
  inp.move(1, d.x - 2, d.y + 3, 32);
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 }, 'the middle is a rest spot');
  inp.move(1, d.x, d.y + d.r * 2, 48); // the thumb slides off the pad: still steering
  v = inp.moveVec();
  assert.ok(near(v.x, 0) && near(v.y, 1), `slid off, still down ${JSON.stringify(v)}`);
  assert.deepEqual({ ...inp.dpad() }, { x: 0, y: 1 });
  inp.up(1, d.x, d.y + d.r * 2, 60);
  assert.equal(inp.consumeTap(), null, 'letting go of the d-pad is never a tap-to-walk');
  assert.deepEqual({ ...inp.moveVec() }, { x: 0, y: 0 });
  assert.equal(inp.dpad(), null);
});

test('tapping the world and the floating joystick still work next to the d-pad', () => {
  const L = LAND(), inp = SPK.createInput(L);
  const p = { x: L.joyZone.x + L.joyZone.w * 0.7, y: L.joyZone.y + 20 };
  assert.equal(inp.down(1, p.x, p.y, 0), 'joy');
  inp.up(1, p.x, p.y, 100);
  assert.deepEqual({ ...inp.consumeTap() }, p, 'a quick tap still walks you there');
  assert.equal(inp.down(2, 600, 60, 200), 'tap');
  const d = L.dpad;
  inp.down(3, d.x - d.r * 0.8, d.y, 300, 'touch');
  inp.down(4, p.x, p.y, 310);
  inp.move(4, p.x, p.y + 60, 320);
  const v = inp.moveVec();
  assert.ok(near(v.x, -1) && near(v.y, 0), 'the d-pad wins over a second finger on the joystick');
});

// ── Slice 4, Task 2: Moonlight Ruins, Grumpcap's Hollow, the throne room ─
const ALL = { bubble: true, hop: true };
test('the ruins sit east of the hills and the lake; both ways in need Cloud Hop', () => {
  const m = SPK.parseMap('ruins');
  assert.equal(m.w, 54); assert.equal(m.h, 36); assert.equal(m.theme, 'ruins');
  assert.equal(SPK.DOORS['hills:>:49,4'].at, 'ruins:>:0,6');
  assert.equal(SPK.DOORS['lake:>:51,19'].at, 'ruins:>:0,28');
  assert.deepEqual({ ...SPK.doorArrival('ruins:>:0,6') }, { map: 'ruins', tx: 1, ty: 6 });
  assert.deepEqual({ ...SPK.doorArrival('ruins:>:0,28') }, { map: 'ruins', tx: 1, ty: 28 });
  assert.deepEqual({ ...SPK.doorArrival('hills:>:49,4') }, { map: 'hills', tx: 48, ty: 4 });
  assert.deepEqual({ ...SPK.doorArrival('lake:>:51,19') }, { map: 'lake', tx: 50, ty: 19 });
  assert.ok(reach('lake', 1, 16, {})('lake:>:51,19'), 'the lake path east is on foot...');
  assert.ok(!reach('ruins', 1, 28, { bubble: true })('ruins:F:23,17'), '...but the ledge it reaches needs a Cloud Hop');
  assert.ok(reach('ruins', 1, 28, ALL)('ruins:F:23,17'));
});

test('ruins: the hollow sits in a moat (Bubble Hooves), the kitty past a gap (Cloud Hop)', () => {
  const MOAT = ['ruins:D:45,6', 'ruins:C:42,10'], GAP = ['ruins:C:46,27', 'ruins:*:48,30', 'ruins:>:0,28'];
  const all = reach('ruins', 1, 6, ALL), noHop = reach('ruins', 1, 6, { bubble: true }), dry = reach('ruins', 1, 6, { hop: true });
  for (const id of keyThings('ruins')) {
    assert.ok(all(id), `${id} reachable with every power`);
    if (GAP.includes(id)) assert.ok(!noHop(id), `${id} needs Cloud Hop`);
    else if (MOAT.includes(id)) assert.ok(!dry(id), `${id} needs Bubble Hooves`);
    else assert.ok(noHop(id) && dry(id), `${id} reachable with either`);
  }
  assert.equal(SPK.DOORS['ruins:D:45,6'].at, 'hollow:U:1,13');
});

test("grumpcap's hollow: dark, a pool (bubble) and a ledge (hop), and the boss door past a campfire", () => {
  const m = SPK.parseMap('hollow');
  assert.equal(m.w, 42); assert.equal(m.h, 28); assert.ok(m.cave && m.dark === 'dark');
  assert.equal(SPK.DOORS['hollow:D:37,13'].at, 'throne:U:13,16');
  assert.deepEqual({ ...SPK.doorArrival('hollow:U:1,13') }, { map: 'hollow', tx: 2, ty: 13 });
  assert.deepEqual({ ...SPK.doorArrival('hollow:D:37,13') }, { map: 'hollow', tx: 36, ty: 13 });
  const POOL = ['hollow:H:9,23'], LEDGE = ['hollow:C:34,4', 'hollow:*:36,4'];
  const all = reach('hollow', 2, 13, ALL), noHop = reach('hollow', 2, 13, { bubble: true }), dry = reach('hollow', 2, 13, { hop: true });
  for (const id of keyThings('hollow')) {
    assert.ok(all(id), `${id} reachable`);
    if (LEDGE.includes(id)) assert.ok(!noHop(id), `${id} needs Cloud Hop`);
    else if (POOL.includes(id)) assert.ok(!dry(id), `${id} needs Bubble Hooves`);
    else assert.ok(noHop(id) && dry(id), `${id} reachable either way`);
  }
  const fire = SPK.entity('hollow:F:33,13'), door = SPK.entity('hollow:D:37,13');
  assert.ok(Math.hypot(fire.tx - door.tx, fire.ty - door.ty) <= 5, 'you wake right outside the boss room');
});

test('the throne room is one open arena with one way out', () => {
  const m = SPK.parseMap('throne');
  assert.equal(m.w, 26); assert.equal(m.h, 18); assert.ok(m.cave && !m.dark);
  assert.deepEqual({ ...SPK.doorArrival('throne:U:13,16') }, { map: 'throne', tx: 13, ty: 15 });
  const seen = new Set(['13,15']); const q = [[13, 15]];
  while (q.length) {
    const [a, b] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${a + dx},${b + dy}`;
      if (!seen.has(k) && !SPK.isSolid(m, a + dx, b + dy, null)) { seen.add(k); q.push([a + dx, b + dy]); }
    }
  }
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (!SPK.isSolid(m, x, y, null)) assert.ok(seen.has(`${x},${y}`), `open tile ${x},${y} reachable`);
  }
});

test('slice 4 treasures: chests, two friends, two heart pieces, campfires', () => {
  const count = (id, k) => SPK.parseMap(id).entities.filter((e) => e.kind === k).length;
  assert.equal(count('ruins', 'C'), 6); assert.equal(count('hollow', 'C'), 4);
  assert.equal(count('ruins', 'F'), 1); assert.equal(count('hollow', 'F'), 1);
  assert.equal(SPK.FRIENDS['ruins:*:48,30'].emoji, '🐱');
  assert.equal(SPK.FRIENDS['hollow:*:36,4'].emoji, '🐼');
  for (const id of ['ruins', 'hollow', 'throne']) assert.ok(SPK.MAP_ICON[id], `${id} has a map picture`);
  assert.ok(count('ruins', 'r') >= 2 && count('hollow', 'r') >= 2, 'rock beetles live in the ruins and the hollow');
});

test('rock beetles: magic does half on Normal (full on Easy); the horn flips them for full damage', () => {
  const b = SPK.ENEMIES.beetle;
  assert.equal(b.hp, 4); assert.ok(b.armored);
  const n = SPK.createGame('normal'), e = SPK.createGame('easy');
  const beetle = { kind: 'beetle', hp: 4 };
  assert.equal(SPK.hitDamage(n, beetle, 2, 'magic'), 1);
  assert.equal(SPK.hitDamage(e, beetle, 2, 'magic'), 2);
  assert.equal(SPK.hitDamage(n, beetle, 5, 'horn'), 5);
  assert.equal(SPK.hitDamage(n, { kind: 'beetle', hp: 4, flipped: 1.5 }, 2, 'magic'), 2, 'a flipped beetle takes full magic');
  assert.equal(SPK.hitDamage(n, { kind: 'slime', hp: 2 }, 2, 'magic'), 2, 'other enemies are not armored');
});

test('King Grumpcap: three phases by his hearts, a short shield after each hit, and his damage stays', () => {
  const g = SPK.createGame('normal');
  assert.equal(SPK.bossMax(g), 40);
  assert.equal(SPK.bossHpNow(g), 40);
  assert.equal(SPK.bossPhase(g), 1);
  assert.equal(SPK.bossHit(g, 2, 1000), 'hit');
  assert.equal(SPK.bossHpNow(g), 38);
  assert.equal(SPK.bossHit(g, 2, 1100), 'immune', 'a short shield after a hit');
  assert.equal(SPK.bossHit(g, 6, 1600), 'hit');
  assert.equal(SPK.bossHpNow(g), 32);
  g.bossHp = 26; assert.equal(SPK.bossPhase(g), 2, 'phase 2 at two thirds');
  g.bossHp = 13; assert.equal(SPK.bossPhase(g), 3);
  g.hp = 1; SPK.hurt(g, 2, 5000); SPK.wake(g);
  assert.equal(SPK.bossHpNow(g), 13, 'getting sleepy never heals him');
  g.bossHp = 4;
  assert.equal(SPK.bossHit(g, 99, 9000), 'beaten');
  assert.equal(g.bossBeaten, true);
  assert.equal(SPK.bossHit(g, 1, 9999), null, 'once happy, he stays happy');
  const easy = SPK.createGame('easy');
  assert.equal(SPK.bossMax(easy), 30);
  easy.bossHp = 7; assert.equal(SPK.bossPhase(easy), 2);
  easy.bossHp = 6; assert.equal(SPK.bossPhase(easy), 3, 'phase 3 is shorter on Easy');
});

test("the boss's hearts and the crown survive a save", () => {
  const g = SPK.createGame('normal'); g.mode = 'play';
  g.bossHp = 17;
  let back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.equal(SPK.bossHpNow(back), 17);
  const s = JSON.parse(JSON.stringify(SPK.getSave(g))); s.bossHp = 'lots';
  assert.equal(SPK.bossHpNow(SPK.applySave(SPK.validateSave(s))), 40, 'nonsense resets to full, never breaks the save');
  delete s.bossHp;
  assert.equal(SPK.bossHpNow(SPK.applySave(SPK.validateSave(s))), 40, 'older saves start him fresh');
  g.bossHp = 0; g.bossBeaten = true;
  assert.equal(SPK.takeCrown(g), true);
  assert.equal(SPK.takeCrown(g), false, 'once');
  assert.equal(g.closet.wearing.accessory, 'rainbowCrown', 'you put it on right away');
  back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.ok(back.bossBeaten && back.closet.owned.includes('rainbowCrown') && back.closet.wearing.accessory === 'rainbowCrown');
  assert.equal(SPK.takeCrown(SPK.createGame('easy')), false, 'only after the boss');
  const rich = SPK.createGame('easy'); rich.gems = 999;
  assert.equal(SPK.closetTap(rich, 'rainbowCrown'), 'poor', 'the crown is never for sale');
  assert.equal(rich.gems, 999);
});

test('nextGoal walks the slice 4 chain: ruins, the hollow campfire, the boss, then rests', () => {
  const g = SPK.createGame('easy');
  Object.assign(g.powers, { mighty: true, glow: true, bubble: true, hop: true });
  g.broken.push('meadow:B:7,27', 'meadow:B:46,14', 'woods:B:30,5');
  SPK.openChest(g, 'woods:C:26,24'); SPK.openChest(g, 'hills:C:31,3');
  g.map = 'hills';
  assert.equal(SPK.stage(g).key, 'ruins');
  assert.equal(tileOf(SPK.nextGoal(g)), 'hills:49,4', 'east off the top plateau');
  g.map = 'lake';
  assert.equal(tileOf(SPK.nextGoal(g)), 'lake:51,19', 'or east from the lake');
  g.map = 'ruins';
  assert.equal(tileOf(SPK.nextGoal(g)), 'ruins:45,6', 'the hollow in the moat');
  g.explored.hollow = new Uint8Array(42 * 28);
  assert.equal(SPK.stage(g).key, 'hollow');
  g.map = 'hollow';
  assert.equal(tileOf(SPK.nextGoal(g)), 'hollow:33,13', 'the campfire before the boss');
  SPK.lightCampfire(g, 'hollow:F:33,13');
  assert.equal(SPK.stage(g).key, 'boss');
  assert.equal(tileOf(SPK.nextGoal(g)), 'hollow:37,13');
  g.map = 'throne';
  assert.equal(tileOf(SPK.nextGoal(g)), 'throne:13,2');
  g.bossBeaten = true;
  assert.equal(SPK.stage(g).key, 'done');
  assert.equal(SPK.nextGoal(g), null);
});

test('the critters have a different hint for every new stage, and one lives in the ruins', () => {
  const g = SPK.createGame('easy');
  Object.assign(g.powers, { mighty: true, glow: true, bubble: true, hop: true });
  g.broken.push('meadow:B:7,27', 'meadow:B:46,14', 'woods:B:30,5');
  SPK.openChest(g, 'woods:C:26,24'); SPK.openChest(g, 'hills:C:31,3');
  const texts = new Set();
  const step = () => { const h = SPK.critterHint(g); assert.ok(h && h.picture.length >= 3 && h.text); texts.add(h.text); };
  step(); g.explored.hollow = new Uint8Array(1); step(); SPK.lightCampfire(g, 'hollow:F:33,13'); step(); g.bossBeaten = true; step();
  assert.equal(texts.size, 4);
  assert.ok(SPK.CRITTERS.some((c) => c.map === 'ruins'), 'a critter in the ruins');
});

test('a giant hit (Mega Horn) takes at most 6 of King Grumpcap\'s hearts, so the fight never ends in one bonk', () => {
  const g = SPK.createGame('normal');
  assert.equal(SPK.bossHit(g, 99, 0), 'hit');
  assert.equal(SPK.bossHpNow(g), 34);
});

// ── Slice 4 review fixes ────────────────────────────────────────────────
test('walking into the boss room lights the Hollow campfire as your wake-up spot (without a free heal)', () => {
  const g = SPK.createGame('normal'); g.hp = 3;
  SPK.reachBossRoom(g);
  assert.ok(g.campfires.includes('hollow:F:33,13'));
  assert.equal(g.wakeCampfire, 'hollow:F:33,13');
  assert.equal(g.hp, 3);
});

test('once King Grumpcap is happy, the hint says you did it, even if you skipped earlier steps', () => {
  const g = SPK.createGame('easy');
  g.bossBeaten = true;
  assert.equal(SPK.stage(g).key, 'done');
});

// ── Slice 4 polish: the small things ─────────────────────────────────────
test('a thumb resting in the middle of the d-pad leaves the joystick free', () => {
  const L = LAND(), d = L.dpad, inp = SPK.createInput(L);
  const p = { x: L.joyZone.x + L.joyZone.w * 0.7, y: L.joyZone.y + 20 };
  assert.equal(inp.down(1, d.x + 2, d.y - 2, 0, 'touch'), 'dpad');
  assert.equal(inp.down(2, p.x, p.y, 10, 'touch'), 'joy');
  inp.move(2, p.x, p.y + 60, 20);
  const v = inp.moveVec();
  assert.ok(v.y > 0.5 && near(v.x, 0), `the joystick steers ${JSON.stringify(v)}`);
  assert.equal(inp.dpad(), null);
});

test('the crown never lands inside a pillar or a wall', () => {
  const m = SPK.parseMap('throne'), T = SPK.TILE;
  for (const [tx, ty] of [[5, 5], [20, 12], [13, 2], [0, 0], [13, 9]]) {
    const at = SPK.openSpotNear(m, (tx + 0.5) * T, (ty + 0.5) * T, {});
    assert.ok(!SPK.isSolid(m, Math.floor(at.x / T), Math.floor(at.y / T), {}), `${tx},${ty} -> open floor`);
    assert.ok(Math.hypot(at.x - (tx + 0.5) * T, at.y - (ty + 0.5) * T) <= 3 * T, `${tx},${ty} stays close`);
  }
  assert.deepEqual({ ...SPK.openSpotNear(m, 13.5 * T, 9.2 * T, {}) }, { x: 13.5 * T, y: 9.2 * T }, 'an open spot stays put');
});

test('reloading in the middle of the fight starts you at the door, not next to him', () => {
  const g = SPK.createGame('normal'), T = SPK.TILE;
  g.map = 'throne'; g.x = 13.5 * T; g.y = 9.5 * T; g.bossHp = 20;
  let back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  const door = SPK.doorArrival('throne:U:13,16');
  assert.equal(back.map, 'throne');
  assert.deepEqual([back.x, back.y], [(door.tx + 0.5) * T, (door.ty + 0.5) * T]);
  assert.equal(SPK.bossHpNow(back), 20, 'his hearts stay where they were');
  g.bossBeaten = true; g.bossHp = 0;
  back = SPK.applySave(SPK.validateSave(JSON.parse(JSON.stringify(SPK.getSave(g)))));
  assert.deepEqual([back.x, back.y], [13.5 * T, 9.5 * T], 'once he is happy you load where you were');
});

test('a save with zero boss hearts but no win brings him back at full hearts', () => {
  const g = SPK.createGame('normal');
  g.bossHp = 0;
  assert.equal(SPK.bossHpNow(g), 40);
  const s = JSON.parse(JSON.stringify(SPK.getSave(g))); s.bossHp = 0;
  assert.equal(SPK.bossHpNow(SPK.applySave(SPK.validateSave(s))), 40);
  g.bossBeaten = true;
  assert.equal(SPK.bossHpNow(g), 0, 'beaten is still zero');
});

test('summoned slimes appear away from you, never on top of you or in a wall', () => {
  const m = SPK.parseMap('throne'), T = SPK.TILE;
  for (const [bx, by, px, py] of [[13.5, 7.5, 13.5, 8.6], [13.5, 7.5, 12.2, 7.5], [3.5, 3.5, 4.5, 4.5], [21.5, 13.5, 21.5, 12.4]]) {
    const spots = SPK.summonSpots(m, bx * T, by * T, px * T, py * T, {});
    assert.ok(spots.length >= 2 && spots.length <= 3, `${bx},${by}: ${spots.length} slimes`);
    for (const s of spots) {
      assert.ok(!SPK.isSolid(m, Math.floor(s.x / T), Math.floor(s.y / T), {}), 'open floor');
      assert.ok(Math.hypot(s.x - px * T, s.y - py * T) >= 2 * T, `at least 2 tiles from you (${bx},${by})`);
    }
  }
});
