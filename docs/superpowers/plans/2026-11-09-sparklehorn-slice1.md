# Sparklehorn Adventure — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 1 of Sparklehorn Adventure: Sunny Meadow plus Pebble Cave (Mighty Horn), Horn and Magic combat, slimes and mushrooms, Star Burst and Swirl Shield, campfires with a sleepy wake-up, Easy and Normal, saves, and every tap-reliability protection and test from spec §9.

**Architecture:**
- One self-contained HTML file, `games/sparklehorn-adventure.html`, with two inline scripts.
  - `<script id="spk-core">` holds pure logic with no DOM: maps, collision, the input state machine, aiming, combat math and saves. It attaches to `globalThis.SPK`.
  - `<script id="spk-game">` holds the canvas, the DOM overlays, audio and the frame loop. It uses `SPK`.
- Node unit tests extract `spk-core` from the HTML and run it in `node:vm`. That makes the input state machine, the most important part, unit-testable.
- End-to-end checks go in `scripts/screens.mjs` and run on Chromium and WebKit.

**Tech Stack:** vanilla JS (ES2020), Canvas 2D, Pointer Events, WebAudio, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-sparklehorn-adventure-design.md`. Read §9 and §14 before any task.

**Later slices:** Slices 2–4 get their own plans once this engine has shipped and been checked on Jeremy's phone, because their details depend on what this slice teaches.

## Global Constraints

- Game id `sparklehorn-adventure`, file `games/sparklehorn-adventure.html`. It's one HTML file, with no libraries, no CDN and no extra files (spec §14.4).
- `games.json` entry, exactly:
  ```json
  {"id":"sparklehorn-adventure","file":"sparklehorn-adventure.html","title":"Sparklehorn Adventure","tagline":"Explore, find magic powers, and pop grumpy mushrooms!","emoji":"🦄","colors":["#34d399","#8b5cf6"],"orientation":"landscape","controls":"Drag to walk • 🦄 horn • ✨ magic","background":"#1e293b","menuButton":"top-right","saves":true,"startOver":false}
  ```
  It goes **last** in the array, which makes it home card index 4.
- No progress-relevant `localStorage`. All progress goes through `ArcadeBridge.register({version:1,getState,setState})`.
- Required patterns from spec §9:
  - Pointer Events only, on the canvas.
  - Controls are drawn on the canvas.
  - `touch-action:none`, plus the `user-select` and `-webkit-touch-callout` rules.
  - `contextmenu` is prevented.
  - `setPointerCapture`.
  - Input resets on `pointercancel`, `lostpointercapture`, `blur`, `visibilitychange` (hidden), `pagehide`, `resize`/`orientationchange` and the bridge `pause` event.
  - A 3000 ms held-pointer watchdog.
  - `requestAnimationFrame(frame)` is the first line of `frame`, and update and draw are wrapped in try/catch.
  - Every audio and `speechSynthesis` call is in try/catch.
- Health is counted in half-hearts.
  - Easy: 6 hearts, so `hpMax` 12. Normal: 4 hearts, `hpMax` 8.
  - 4 heart pieces add 1 heart.
- No text is needed to progress. Text is optional, under pictures.
- No flashing faster than 3 Hz.
- Commit and push after every task: `git add <scoped files>`. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QL27mwx7PJbbft54fg5oic
  ```
- Ports: dev 4600, test 4601.
- `npm test` and `npm run screens` must pass, plus `PW_ENGINE=webkit npm run screens` before the final push.

## Review Focus

1. **Second finger lifts while the first is still down.** Hold the joystick, tap Magic, release Magic. Walking must continue and nothing may stay held. → Task 3 test `release of one pointer leaves the other intact`.
2. **A finger that starts on a button and slides into the joystick zone.** It stays the button's pointer and must not become a joystick. → Task 3 test `pointer keeps its role for its lifetime`.
3. **Rotating while a finger is down.** The layout changes under a live pointer. Everything resets, and the next touch works with the new layout. → Task 3 test `relayout resets and next touch uses new zones`, and Task 11 e2e rotation.
4. **Corrupt or old-shaped save data.** `setState` must throw, never half-apply. The arcade then starts fresh. → Task 9 tests `validateSave rejects…`.
5. **Tapping ▶ on the title screen twice quickly, or tapping during the intro.** It must not start two loops or skip into a broken state. → Task 2 test `start is idempotent`, and the Task 11 e2e double-tap.

---

### Task 1: Arcade changes (`startOver:false`, bridge pause/resume events)

**Files:**
- Modify: `scripts/lib.mjs:118-137` (`normalize`)
- Modify: `public/play.js:148-153` (Start Over tile)
- Modify: `public/arcade-bridge.js` (`finishPause` / `resume`)
- Modify: `README.md` (document `startOver`)
- Test: `tests/lib.test.mjs`

**Interfaces:**
- Produces:
  - Normalized game entries gain `startOver: boolean`. It's `true` unless the entry has `startOver === false`.
  - The bridge emits `'pause'` once a pause actually takes effect, and `'resume'` on resume, through `ArcadeBridge.on(fn)`. `fn(type, data)`.

- [ ] **Step 1: Write the failing test** in `tests/lib.test.mjs`:
  ```js
  test('startOver is on unless a game turns it off', () => {
    const { games } = buildManifest([{ file: 'a.html' }, { file: 'b.html', startOver: false }, { file: 'c.html', startOver: 'no' }], ['a.html', 'b.html', 'c.html']);
    assert.deepEqual(games.map((g) => g.startOver), [true, false, true]);
  });
  ```
  Match the call shape used by the existing `saves are off unless…` test at line 72.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, `startOver` is undefined.
- [ ] **Step 3:** Implement the code changes.
  - **`normalize`:** add `startOver: entry.startOver !== false`.
  - **`play.js`:** build the Start Over tile only when `game.startOver !== false`.
  - **`arcade-bridge.js`:** call `emit('pause')` at the end of `finishPause` after `paused = true`, and `emit('resume')` at the end of `resume()` when it actually un-paused.
    - Check that `emit` replaying `latest` to late subscribers is harmless. A replayed `pause` only clears input.
  - **`README.md`:** add `"startOver": false` to the field list with the comment "hides in-game Start Over (for long adventures)".
- [ ] **Step 4:** Run `npm test` (expected PASS), then `npm run screens` (all existing checks pass).
- [ ] **Step 5:** Commit and push: `git add scripts/lib.mjs public/play.js public/arcade-bridge.js README.md tests/lib.test.mjs`, message "Arcade: per-game startOver flag, bridge pause/resume events".

---

### Task 2: Game skeleton, core-test harness, registration

**Files:**
- Create: `games/sparklehorn-adventure.html`
- Create: `tests/sparklehorn.test.mjs`
- Modify: `games/games.json` (append the entry from Global Constraints)

**Interfaces:**
- Produces, in `spk-core`:
  - `SPK.TILE = 32`
  - `SPK.DIFF`:
    ```
    {easy:{hp:12, autoMagic:true, autoMagicEvery:0.5, enemySpeed:0.7, enemyAtk:0.7, maxHit:1, hintAfter:45, beetleMagicFull:true},
     normal:{hp:8, autoMagic:false, enemySpeed:1, enemyAtk:1, maxHit:2, hintAfter:null, beetleMagicFull:false}}
    ```
  - `SPK.createGame(difficulty) -> state`, where `state` is
    ```
    {mode:'title'|'intro'|'play'|'sleepy'|'reveal'|'welcome', difficulty, map:'meadow', x, y, facing, hp, hpMax, gems:0, powers:{}, chests:[], friends:[], heartPieces:[], campfires:[], wakeCampfire:'home', bossBeaten:false, broken:[], explored:{}, closet:{owned:[],wearing:{}}, fx:{}}
    ```
- Produces, in the test file: `loadCore() -> SPK`. It reads the HTML, extracts `<script id="spk-core">…</script>` with a regex, and runs it with `vm.runInNewContext(src, ctx)`, where `ctx = { globalThis: ctx, Math, JSON, Uint8Array, btoa, atob }`.
- Produces, in `spk-game`:
  - `window.__spk = { get state(), frames, errors, inputs, _teleport(map,x,y), _give(power), _spawn(kind,x,y), _hurt(n) }`
  - `startGame(difficulty)`. It's idempotent: a second call while not in `'title'` is ignored.

- [ ] **Step 1: Write failing tests** in `tests/sparklehorn.test.mjs`:
  - `core loads and exposes TILE and DIFF`: `SPK.TILE === 32`, `SPK.DIFF.easy.hp === 12`, `SPK.DIFF.normal.hp === 8`.
  - `createGame sets hp from difficulty`: `createGame('easy').hp === 12 && .hpMax === 12`. Also `createGame('normal').mode === 'intro'`.
  - `createGame rejects unknown difficulty`: `assert.throws(() => SPK.createGame('hard'))`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, because the file doesn't exist.
- [ ] **Step 3:** Build the HTML skeleton.
  - **Page shell:** full-viewport canvas `#c` with the §9 CSS, and DOM overlays `#title` (big ▶) and `#diff` (🐣 Easy / 🦄 Normal picture buttons).
  - **Overlay listeners:** they use `pointerup`, with no `click`-only handlers.
  - **The loop:** `frame()` calls `requestAnimationFrame(frame)` first, then `try{update(dt);draw()}catch(e){errors++;console.error(e)}`. `dt` is clamped to ≤ 0.05 s.
  - **Resize:** sizes the canvas to `devicePixelRatio`.
  - **Camera scale:** `scale = landscape ? innerHeight/(11*TILE) : innerWidth/(9*TILE)`.
  - **Flow:** ▶ → difficulty → `startGame(d)`. The intro is a 10 s picture beat; any tap skips it. Then `mode='play'`.
  - **For now** it draws a flat green field and a placeholder unicorn circle.
  - **Register** `games.json`.
- [ ] **Step 4:** Run `npm test` (PASS). Run `npm run dev` and open the game; the title, difficulty and green field show.
- [ ] **Step 5:** Commit and push: `git add games/sparklehorn-adventure.html games/games.json tests/sparklehorn.test.mjs`, message "Sparklehorn: skeleton, core test harness, arcade entry".

---

### Task 3: Input state machine (core) and wiring

**Files:**
- Modify: `games/sparklehorn-adventure.html` (core: `layoutControls`, `createInput`; game: pointer wiring and control drawing)
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- `SPK.layoutControls(w, h) -> layout`, where `layout` is
  ```
  {portrait:bool, joyZone:{x,y,w,h}, horn:{x,y,r}, magic:{x,y,r}, map:{x,y,r}}
  ```
  - **Landscape:**
    - `joyZone = {x:0, y:h*0.25, w:w*0.55, h:h*0.75}`;
    - `magic` r 50, centered at `(w-80, h-80)`;
    - `horn` r 44 at `(w-190, h-60)`;
    - `map` r 26 at `(w-40, 104)`, below the arcade's ⏸ at top-right.
  - **Portrait:**
    - `joyZone = {x:0, y:h*0.55, w:w*0.6, h:h*0.45}`;
    - `magic` and `horn` stacked in the bottom-right, `magic (w-72, h-90)`, `horn (w-72, h-200)`;
    - the same `map`.
  - All of it is inset by safe-area values that the game layer passes as `layoutControls(w, h, inset={t,r,b,l})`.
- `SPK.createInput(layout)` returns an object with:
  - `down(id, x, y, t)`, `move(id, x, y, t)`, `up(id, x, y, t)`;
  - `cancel(id)`, `resetAll(reason)`, `relayout(layout)`, `tick(t)`;
  - `moveVec() -> {x,y}` (length ≤ 1);
  - `held(name) -> bool`, where name is `'horn'` or `'magic'`;
  - `consumePress(name) -> bool`, edge-triggered, for `'horn'`, `'magic'` and `'map'`;
  - `consumeTap() -> {x,y}|null`;
  - `active() -> number`;
  - `lastReset -> string`.
- **Rules:**
  - A pointer's role (`'joy'`, `'horn'`, `'magic'`, `'map'` or `'none'`) is decided at `down` and kept until `up`/`cancel`.
  - **Buttons:** a hit is within `r + 12` px slop. Buttons are checked before the joystick zone.
  - **Joystick:**
    - the base appears at the down point;
    - radius 60 px, deadzone 8 px;
    - only one joystick pointer at a time, and a second one in the zone gets role `'none'`.
  - **Tap:** a joy pointer released within 250 ms that moved less than 12 px produces `consumeTap()` at its down point.
  - **Watchdog:** `tick(t)` releases any pointer with no event for more than 3000 ms and sets `lastReset = 'watchdog'`.

- [ ] **Step 1: Write the failing tests.**
  - `joystick drag gives a direction`: `down(1,100,300,0); move(1,160,300,16)` gives `moveVec().x ≈ 1, y ≈ 0`.
  - `deadzone`: a 5 px drag gives `moveVec()` `{0,0}`.
  - `magic button press and hold`: a down inside `magic` gives `consumePress('magic') === true` once, then `false`; `held('magic')` is true until `up`.
  - `release of one pointer leaves the other intact`: joystick pointer 1 dragging; pointer 2 down then up on magic. Then `moveVec().x ≈ 1`, `held('magic') === false` and `active() === 1`.
  - `pointer keeps its role for its lifetime`: a down on `horn`, then a move into the joy zone. `moveVec()` stays `{0,0}` and `held('horn')` is true.
  - `tap in joy zone`: down/up at the same point within 100 ms gives `consumeTap()` `{x,y}`. A 300 ms hold gives `null`.
  - `cancel and resetAll clear everything`: after `resetAll('blur')`, `active() === 0`, `moveVec()` is `{0,0}`, no button is held, and `lastReset === 'blur'`.
  - `watchdog releases a silent pointer`: `down(1,…,0); tick(3001)` gives `active() === 0` and `lastReset === 'watchdog'`.
  - `relayout resets and next touch uses new zones`: with a landscape layout, joystick down. Then `relayout(portrait)` gives `active() === 0`, and a down at the new portrait `magic` center gives `consumePress('magic')`.
  - `layout: buttons don't overlap each other or the arcade menu corner`: for each of 390×844, 844×390, 820×1180, 1180×820 and 1440×900, the circles are disjoint, every circle is inside the screen, and no circle intersects the rect `{x:w-72, y:0, w:72, h:72}` (⏸).
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `layoutControls` and `createInput` in `spk-core` to the rules above.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Wire it up in `spk-game`.
  - **Canvas listeners:** `pointerdown` calls `setPointerCapture` then `input.down`. Also `pointermove`, `pointerup`, and `pointercancel`/`lostpointercapture` → `input.cancel(id)`.
  - **Coordinates:** CSS pixels from `clientX/Y`.
  - **Resets:** `blur`, `visibilitychange` (hidden), `pagehide` and `ArcadeBridge.on(type==='pause')` call `input.resetAll(reason)`. `resize`/`orientationchange` call `input.relayout(layoutControls(...))`.
  - **Also:** `contextmenu` is prevented. `input.tick(performance.now())` runs every frame.
  - **Draw** the joystick base and knob while active, and the three buttons with their emoji. Buttons look pressed while held.
  - **Exposure:** `__spk.inputs = { active, lastReset, move }`.
  - **Movement:** the unicorn placeholder moves at 4 tiles/s × `moveVec`. `consumeTap()` sets a walk-to target in world coordinates.
- [ ] **Step 6:** Run `npm run dev`. On a laptop with DevTools touch emulation, walking and firing (a log/flash for now) work together.
- [ ] **Step 7:** Commit and push: `git add games/sparklehorn-adventure.html tests/sparklehorn.test.mjs`, message "Sparklehorn: multi-touch input state machine + on-canvas controls".

---

### Task 4: Maps, collision, Sunny Meadow and Pebble Cave

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **Map data:** `SPK.MAPS = { meadow:{rows:[...]} , pebble:{rows:[...]} }`. Each row is a string; one character is one tile.
- **Legend** (`SPK.LEGEND`):
  - `.` grass, `,` flowers, `:` path, `T` tree (solid), `~` water (solid without bubble);
  - `#` rock wall (solid), `B` cracked boulder (solid until broken), `D` cave door, `U` exit door;
  - `F` campfire, `C` chest, `H` heart-piece spot, `S` slime spawn, `M` mushroom spawn;
  - `P` power pedestal, `@` player start, `=` cave floor.
- **Entity IDs:** entities get stable IDs `<map>:<kind>:<x>,<y>`, for example `meadow:C:12,30`.
  - Doors carry a target in `SPK.DOORS = {'meadow:D:40,20': {to:'pebble', at:'pebble:U:3,10'}}`, and the reverse entry.
- **Functions:**
  - `SPK.parseMap(id) -> {id, w, h, tiles:Uint8Array, entities:[{id,kind,tx,ty}]}`. Tile codes are indexes into `LEGEND` order.
  - `SPK.isSolid(map, tx, ty, ctx) -> bool`, where `ctx = {broken:Set, powers}`. Out of bounds counts as solid.
  - `SPK.moveAndSlide(map, body:{x,y,r}, dx, dy, ctx) -> {x, y, hit:[{tx,ty,code}]}`. It resolves the axes separately so the body slides along walls; `x`/`y` are in pixels.
- **Content (my call within spec §3):**
  - **Sunny Meadow:** 48×32 tiles. Slice 1's part of the 96×64 overworld; later slices extend it east and north, and Slice 2 widens it.
    - home campfire `F` near `@`;
    - 2 more campfires;
    - the Pebble Cave door `D`;
    - 1 cracked boulder `B` hiding a chest shortcut (needs Mighty Horn);
    - 8 chests (6 gems, 1 heart piece, 1 Star Burst orb);
    - 3 heart-piece spots `H`;
    - 6 slime groups and 2 mushroom groups.
  - **Pebble Cave:** 30×20 tiles.
    - entrance `U`;
    - 1 campfire;
    - 3 chests (one Swirl Shield orb);
    - 4 bat-free slime/mushroom groups;
    - the pedestal `P` at the far end holding Mighty Horn.
  - Every row in a map has the same length.

- [ ] **Step 1: Write failing tests.**
  - `maps parse with consistent widths`: for each map, every row length equals `w`, and there's exactly one `@` (meadow) or `U` (pebble).
  - `entity ids are stable and unique`.
  - `every door has a matching return door`.
  - `moveAndSlide blocks walls and slides`: on a hand-built 5×5 test map `['#####','#...#','#.#.#','#...#','#####']`, moving diagonally into the wall corner slides along one axis.
  - `cracked boulder solid until broken`: `isSolid` is true; with `ctx.broken.has(id)` it's false.
  - `every chest, heart spot, campfire and the pedestal is reachable from start` (flood fill):
    - meadow: from `@`, treating `B` as passable only for the one chest behind it;
    - pebble: from `U`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the parser and collision, and author both maps.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Render the maps.
  - **Chunks:** pre-render static tiles into 16×16-tile offscreen chunk canvases. Draw only chunks in view. Animated things (water shimmer, flowers sway) draw per frame on visible tiles only.
  - **Camera:** follows the player, clamped to map bounds.
  - **Doors:** walking onto `D`/`U` fades to the target door's tile, with a 0.4 s fade.
  - **Light:** the cave uses darker floor tiles plus a soft vignette. It is not dark-gated in Slice 1.
  - **Explored fog:** `state.explored[mapId]` is a `Uint8Array(w*h)`. Tiles within 6 tiles of the player are marked each 0.25 s.
  - **Hook:** `__spk._teleport(map,tx,ty)` works.
- [ ] **Step 6:** Run `npm run dev`. Walk around the meadow, enter the cave and return.
- [ ] **Step 7:** Commit and push, message "Sparklehorn: maps, collision, Sunny Meadow + Pebble Cave".

---

### Task 5: Combat: Horn, Magic, slimes, mushrooms

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **`SPK.pickTarget(px, py, facing, enemies, rangePx, coneDeg) -> enemy|null`.** Picks the nearest live enemy within range whose angle from `facing` (radians) is ≤ cone/2.
  - Magic uses `rangePx = 7*TILE` and `coneDeg = 120`.
- **`SPK.fanAngles(base, n, spreadDeg) -> number[]`.** `n` angles centered on `base`. With `n = 1`, it returns `[base]`.
- **`SPK.ENEMIES`:**
  - `slime: {hp:2, speed:1.2, sense:5, touch:1}`
  - `slimeBig: {hp:4, speed:1.0, sense:5, touch:1, splitInto:'slimeMini', splitN:2}`
  - `slimeMini: {hp:1, speed:1.6, sense:5, touch:1}`
  - `mushroom: {hp:3, speed:0.8, sense:6, touch:1, spore:{every:2.2, windup:0.6, speed:2.5, dmg:1}}`
  - Speeds are tiles/s; `touch` and `dmg` are half-hearts.
- **`SPK.damageEnemy(e, n) -> {popped:bool, spawn:[{kind,x,y}]}`.** It applies damage and returns minis for `splitInto`.
- **`SPK.enemyHit(state, raw) -> halfHearts`.** `min(raw, DIFF[d].maxHit)`, at least 1.
- **Horn:** a dash of 2.5 tiles over 0.18 s in `facing`.
  - Invulnerable during the dash.
  - Cooldown 0.5 s.
  - Damage 1, or 2 with `powers.mighty`.
  - Hits each enemy at most once per dash.
- **Magic:** each `consumePress('magic')`, or a repeat every 0.33 s while held, fires `1 × fanAngles(aim, starBurst?5:1, 50)` bolts.
  - Aim is `pickTarget`'s angle, or `facing` if there's no target.
  - Bolt speed 9 tiles/s, life 0.9 s, damage 1.
  - Bolts stop on solid tiles.
  - **Easy Auto-Magic:** the same fire, triggered every `autoMagicEvery` while a target exists in range.
- **Exposure:** `__spk.bolts` (count fired, cumulative) and `__spk.pops` (cumulative).

- [ ] **Step 1: Write failing tests.**
  - `pickTarget nearest in cone`: enemies at angle 0° distance 3 tiles, at 0° distance 5 and at 180° distance 1 give the 3-tile one.
  - `pickTarget null when only behind or out of range`.
  - `fanAngles(0,5,50)` gives `[-25°,-12.5°,0,12.5°,25°]` in radians, ±1e-9. `fanAngles(1,1,50)` gives `[1]`.
  - `big slime splits into 2 minis on pop`.
  - `enemyHit caps at half heart on easy`: `enemyHit({difficulty:'easy'},2) === 1` and `enemyHit({difficulty:'normal'},2) === 2`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the core functions.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Game layer.
  - **Spawn groups** from the `S`/`M` entities: 2–5 enemies each. At most 25 active within 14 tiles. A group respawns when its map is re-entered or after a sleepy wake-up, never on-screen.
  - **AI:** wander, then approach inside `sense`.
    - Enemy speed and spore rate are scaled by `DIFF.enemySpeed` and `enemyAtk`.
    - Enemies never enter a 3-tile ring around any campfire.
    - Mushrooms squish during the windup, then fire a slow spore ball.
  - **Pop:** confetti and sparkle particles, a 40 ms hit-pause, and a small shake (4 px, 120 ms). 30% drop gems (1–3) and 12% drop a 💗 (+2 half-hearts).
  - **Draw** slimes as bouncy blobs with eyes and mushrooms as grumpy caps. Both are code-drawn.
- [ ] **Step 6:** Run `npm run dev`. Pop things with the horn and with magic, on both difficulties.
- [ ] **Step 7:** Commit and push, message "Sparklehorn: horn charge, aim-assisted magic, slimes and mushrooms".

---

### Task 6: Health, sleepy wake-up, campfires, Mighty Horn and boulders

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **`SPK.hurt(state, halfHearts, now) -> 'ok'|'sleepy'|'immune'`.**
  - It ignores damage during `state.fx.invulnUntil`.
  - On a hit, it sets 1.2 s of invulnerability.
  - At 0 hp it sets `mode='sleepy'`.
- **`SPK.wake(state) -> void`.** Moves the player to `wakeCampfire`'s map and tile (one tile south of the fire), sets `hp=hpMax` and `mode='play'`, and **keeps everything else**.
- **`SPK.lightCampfire(state, id) -> bool`.** Adds the fire to `campfires` and sets `wakeCampfire=id` and `hp=hpMax`. Returns true if it was newly lit.
- **`SPK.hpMaxFor(state) -> number`.** `DIFF[d].hp + 2*floor(heartPieces.length/4)`.
- **`SPK.bonkTick(state, mapId, blockedBoulderId, dt) -> boolean`.** Accumulates time pushing against the same cracked boulder. With `powers.mighty`, it returns true once the total reaches ≥ 0.6 s, and the caller then adds the id to `state.broken`. Horn-dash contact with `mighty` breaks a boulder instantly.
  - `state.broken` is an array of boulder IDs, saved.
- **Pedestal:** touching `P` sets `powers.mighty = true` and `mode='reveal'`. The reveal is a 3 s spinning item with a fanfare, a picture card (🪨➡️🦄💥) and optional text "Mighty Horn! Bonk cracked rocks!". It continues on tap.

- [ ] **Step 1: Write failing tests.**
  - `hurt then immune for 1.2s`.
  - `hurt to zero gives sleepy; wake keeps gems/powers/chests, refills hp, moves to wake fire`.
  - `lighting a campfire sets wake point and heals`.
  - `hpMaxFor counts complete hearts only`: 3 pieces add 0, 4 pieces add 2.
  - `bonk needs mighty and 0.6s on the same boulder`: without `mighty` it never breaks. With `mighty`, 0.3 s + 0.3 s on the same boulder breaks it, and switching boulders resets the timer.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Game layer.
  - **HUD:** hearts top-left, drawn as half-hearts, with 💎 next to them.
  - **Hits:** knockback and a blink.
  - **Sleepy:** a 1.5 s fade with a yawning unicorn, then `wake`, and the map's enemy groups reset.
  - **Campfires:** drawn crackling, and lit ones glow.
  - **Boulders:** wobble while being bonked, then break into pebbles.
  - **Mighty Horn:** visibly glows the horn.
- [ ] **Step 6:** Run `npm run dev`. Get sleepy on purpose: progress is kept. Then get Mighty Horn and bonk the boulder by walking into it.
- [ ] **Step 7:** Commit and push, message "Sparklehorn: hearts, sleepy wake-up, campfires, Mighty Horn".

---

### Task 7: Power-ups: Star Burst and Swirl Shield

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **`SPK.POWERUPS`:**
  - `starBurst: {secs:15}`
  - `swirl: {secs:30, orbs:6, radius:1.4 /*tiles*/, spin:2.4 /*rad/s*/}`
- **`SPK.grantPowerup(state, kind, now)`.** Sets `state.fx[kind] = {until: now+secs*1000}`. For `swirl` it also sets `orbs: 6`. A duplicate refreshes it, and swirl orbs go back to 6.
- **`SPK.activePowerups(state, now) -> string[]`.** Lists the ones that haven't expired, and drops `swirl` when `orbs === 0`.
- **`SPK.swirlOrbPositions(state, now) -> [{x,y,i}]`.** Remaining orbs evenly spaced around the player.
- **`SPK.swirlHit(state, orbIndex)`.** Removes one orb. The game calls it when an orb overlaps an enemy, and that enemy takes 2 damage.
- **Orbs:** glowing pickups placed from chests, or as a 10% drop on enemy pop. In Slice 1 the drops are 50/50 Star Burst or Swirl.

- [ ] **Step 1: Write failing tests.**
  - `star burst lasts 15s and refreshes`.
  - `swirl ends when 6 orbs are used even before 30s`.
  - `orb positions shrink with orbs`: after 2 hits, `swirlOrbPositions` has length 4.
  - `star burst makes magic fire 5 bolts` (with `fanAngles` from Task 5, assert the count used by `fireMagic(state)`, which returns an angle array).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Also expose `SPK.fireMagic(state, aimAngle, now) -> number[]` and have Task 5's firing call it.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Game layer.
  - **Timers:** each active power-up shows top-center as a big icon with a shrinking ring.
  - **Swirl orbs** orbit and visibly pop one at a time on hit.
  - **Star Burst** bolts are rainbow-tinted.
- [ ] **Step 6:** Commit and push, message "Sparklehorn: Star Burst and Swirl Shield power-ups".

---

### Task 8: Chests, gems, heart pieces, picture hints, hint trail

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **`SPK.CHESTS`:** a map of chest id to contents.
  - Contents are `{gems:n}`, `{heartPiece:id}` or `{powerup:kind}`.
  - Every `C` entity in Task 4's maps has an entry; the test enforces it.
- **`SPK.openChest(state, id) -> contents|null`.** Returns `null` if the chest is already opened. Records the id in `state.chests` and applies the contents: gems are added, and heart pieces are pushed to `heartPieces` with `hpMax` recomputed.
- **`SPK.nextGoal(state) -> {map, tx, ty}|null`.** The cave door while `mighty` is missing and the player is in the meadow. The pedestal when in the cave. After `mighty`, the cracked boulder's tile. `null` after it's broken.
- **Hint bubbles:** a friendly bunny critter at home says, as a picture, `🦄➡️🕳️✨`, pointing at the cave. Optional text: "Something magic is in Pebble Cave!".
  - A 🔊 on the bubble calls `speechSynthesis.speak`, inside try/catch.
  - The 🔊 is hidden when `!('speechSynthesis' in window)`.
- **Hint trail:**
  - **Easy:** it shows when `hintAfter` seconds pass with no new chest, campfire, power or heart. A "discovery clock" resets on each.
  - **Normal:** it shows for 8 s after tapping 🗺️. Slice 1 has no map screen, so 🗺️ triggers the trail only.
  - **Drawing:** sparkles every 0.6 s along a straight line toward `nextGoal`, capped at 8 tiles shown.

- [ ] **Step 1: Write failing tests.**
  - `every chest entity has contents and vice versa`.
  - `openChest is once-only and applies gems`.
  - `four heart pieces raise hpMax by one heart`.
  - `nextGoal progression`: cave door, then pedestal (in the cave), then the boulder, then `null`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Game layer.
  - **Chests:** open on touch with a chime, and gems bounce out and fly to the counter.
  - **Heart spots `H`:** sparkling pickups that call the same heart-piece logic with their own id.
  - **The bubble** is drawn on the canvas above the critter when the player is within 3 tiles.
- [ ] **Step 6:** Commit and push, message "Sparklehorn: chests, heart pieces, picture hints, hint trail".

---

### Task 9: Saves

**Files:**
- Modify: `games/sparklehorn-adventure.html`
- Test: `tests/sparklehorn.test.mjs`

**Interfaces:**
- **`SPK.encodeBits(Uint8Array) -> string`** and **`SPK.decodeBits(string, length) -> Uint8Array`.** One bit per tile, then base64 via `btoa`/`atob`.
- **`SPK.getSave(state) -> object`.** Exactly the spec §10 shape plus `broken`:
  ```
  {v:1, difficulty, map, x, y, facing, hp, gems, powers, chests, friends, heartPieces, campfires, wakeCampfire, bossBeaten, broken, explored:{[mapId]:string}, closet}
  ```
  - `x` and `y` are tile coordinates (integers, rounded). Power-ups and enemies are excluded.
- **`SPK.validateSave(obj) -> obj`.** Throws `Error('bad save: <field>')` when:
  - `v !== 1`;
  - `difficulty` isn't easy or normal;
  - `map` is unknown;
  - `x`/`y` are out of bounds or on a solid tile;
  - any array field isn't an array of strings;
  - `hp` isn't an integer from 1 to `hpMax`.
- **`SPK.applySave(save) -> state`.** Returns a fresh state with `mode='welcome'`.
- **Game layer:**
  - `ArcadeBridge.register({version:1, getState, setState})`.
  - `getState()` returns `null` only while `mode==='title'`, and otherwise returns `getSave(state)` (spec §14.1).
  - `setState(s)` runs `validateSave`, then `applySave`, then shows the **Welcome back!** overlay: a picture of the unicorn and a big ▶ on `pointerup`.
  - At boot: if `ArcadeBridge.peekRestore(1)` holds data, skip the title.

- [ ] **Step 1: Write failing tests.**
  - `save round-trip`: play-ish state (mighty, 2 chests, gems 17, heart pieces, a lit fire, a broken boulder, explored bits) → `getSave` → `JSON` round-trip → `validateSave` → `applySave`. All fields match, explored bits are equal, and `mode === 'welcome'`.
  - `validateSave rejects wrong version`.
  - `validateSave rejects unknown map`.
  - `validateSave rejects position inside a wall`.
  - `validateSave rejects non-array chests`.
  - `save stays small`: the `JSON.stringify(getSave(fullyExplored))` length is under 4000 for Slice 1 maps.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Run `npm run dev`. Play, go to the Arcade, then Continue: you're back where you were with everything. The ⏸ menu has no Start Over and does have Save/Load.
- [ ] **Step 6:** Commit and push, message "Sparklehorn: saves via arcade bridge, Welcome back".

---

### Task 10: Sound, music, feel and art pass

**Files:**
- Modify: `games/sparklehorn-adventure.html`

**Interfaces:**
- **`sfx(name)`:** `name` is `'pop'|'sparkle'|'whoosh'|'chime'|'fanfare'|'crackle'|'hurt'|'yawn'`.
- **`music(region)`:** `region` is `'meadow'|'cave'`.
- Every audio function is wrapped in try/catch. The context is created lazily on the first `pointerdown`, and it's resumed whenever its state isn't `'running'`. The bridge already mutes it.

- [ ] **Step 1:** Implement the synthesized effects in Flight's style (read `games/flight-of-the-unicorn.html`'s `audio()`/`tone()` and mirror their guard pattern exactly). Add a soft per-region looping melody.
- [ ] **Step 2: Art pass.**
  - **Unicorn:** code-drawn, with 8-direction facing, a bobbing mane while walking, a dash stretch, and a horn glow with Mighty.
  - **Tiles:** palettes for the meadow and the cave.
  - **Particles:** confetti and sparkle.
  - **Flashing:** no element flashes faster than 3 Hz; the hurt blink runs at 2.5 Hz.
- [ ] **Step 3:** Run `npm test`, then run the game and check for 60 fps on the phone-landscape viewport. In DevTools Performance, frame time should be under 16 ms with 25 enemies.
- [ ] **Step 4:** Commit and push, message "Sparklehorn: sound, music, art and juice".

---

### Task 11: End-to-end tap-reliability suite (spec §9) and ship

**Files:**
- Modify: `scripts/screens.mjs` (new `sparklehornPass` plus a robustness addition)
- Create (scratch, not committed): a live check script in the session scratchpad

**Interfaces:**
- **Consumes:**
  - `window.__spk` from Task 2: `state.mode`, `state.x/y`, `frames`, `errors`, `inputs.active`, `inputs.lastReset`, `bolts`, `_teleport`, `_spawn`;
  - the layout from `SPK.layoutControls(innerWidth, innerHeight, inset)` evaluated in the page, to find button centers.
- **`sparklehornPass(browser, vp)`** runs at all 5 viewports, after `mazePass` in the main loop. The game is `t.launch(4)`.

- [ ] **Step 1: Write `sparklehornPass`.** Every item is a `check(...)` with a clear message.
  1. **First tap works.** One `tap` on `#title` ▶, then `tap` 🐣 Easy, then `tap` the canvas to skip the intro. Then `mode === 'play'`.
  2. **Double-tap ▶ is safe.** In a fresh context, tap ▶ twice within 50 ms; there's exactly one difficulty overlay, and no errors.
  3. **Joystick walks.**
     - Mobile: CDP `Input.dispatchTouchEvent` `touchStart` in the joy zone, a `touchMove` 50 px right over 300 ms, then hold. The player's x increases.
     - Desktop: hold `ArrowRight` 400 ms.
  4. **Magic fires.** Tap the `magic` center; `bolts` increases.
  5. **Multi-touch** (Chromium only, via CDP). Joystick held (touch id 1) plus a magic `touchStart`/`touchEnd` (id 2). The player moves *and* `bolts` increases; after id 2 ends, `inputs.active === 1`. On WebKit, skip it with a logged note. Playwright WebKit has no CDP, and the core unit test covers the logic.
  6. **No stuck input.** While the joystick is held, `page.evaluate(() => window.dispatchEvent(new Event('blur')))`. Then `inputs.active === 0`, `lastReset === 'blur'`, and the x position is unchanged 300 ms later.
  7. **Rotation mid-play** (mobile viewports). `page.setViewportSize` swapped to w↔h. The rotate hint shows in portrait for phones (dismiss it with `#rotate-dismiss`). Then the magic button at the *new* layout center fires (`bolts` increases), and its center is in the bottom-right quadrant.
  8. **Pause/resume.** `t.menu()`, then Keep Playing, then a magic tap fires.
  9. **Menu has no Start Over.** `t.tileNames()` doesn't include `Start Over`, but does include Save.
  10. **Arcade → Back.** The menu's Arcade tile, `page.goBack()`, `t.loaded()`-style wait or a bfcache check, then a magic tap fires.
  11. **Continue restores.** `_teleport('pebble',5,10)`, Arcade, then the home card's ▶ Continue gives the Welcome back overlay. Tap ▶; `state.map === 'pebble'`.
  12. **Screenshots** `sparkle-play` and `sparkle-cave`.
  13. `t.errors.length === 0`.
- [ ] **Step 2: Add Sparklehorn to `brokenAudioPass`.** Launch card 4, tap ▶ → Easy → skip, tap magic, and check `bolts` > 0 and `frames` increasing, in both `'ctor'` and `'nodes'` modes.
- [ ] **Step 3:** Run `npm test && npm run screens`. Expected: all checks pass, including the existing Flight and Maze checks.
- [ ] **Step 4:** Run with `PW_ENGINE=webkit npm run screens`. Expected: all pass, with the multi-touch check logged as skipped on WebKit.
- [ ] **Step 5:** Commit and push: `git add scripts/screens.mjs`, message "Sparklehorn: end-to-end tap reliability suite". Then wait for the deploy: poll `https://supergamesarcade.vercel.app/games/sparklehorn-adventure.html` until it returns 200.
- [ ] **Step 6: Live check.** Write a scratchpad script modeled on the session's `live2.mjs`: WebKit with `devices['iPhone 13 landscape']` and `devices['iPad (gen 7) landscape']`, against the live URL.
  - Fresh load, choose a player, then card "Sparklehorn" ▶ → ▶ → Easy → skip.
  - Touchscreen tap on magic: `bolts` > 0.
  - Touch-drag: the player moves.
  - No page errors.
  - Run it, and paste the output into the report.
- [ ] **Step 7: Report to Jeremy.** Say what shipped, how to test it, and ask for a one-minute check on his real iPhone from the home-screen app:
  - fully close and reopen the app;
  - play: walk, fire, horn, pause, Arcade, Continue.

---

## Self-review notes

**Spec coverage for Slice 1:**

| Spec | Covered by |
|---|---|
| §2 single file, registration | Task 2 |
| §3 meadow, Pebble Cave, campfires, chests, heart pieces | Tasks 4, 6, 8 |
| §4 controls, horn, magic, aim assist, tap-to-walk, keyboard | Tasks 3, 5 |
| §4 hearts, sleepy | Task 6 |
| §5 slime, mushroom | Task 5 |
| §6 Star Burst, Swirl, Mighty Horn | Tasks 6, 7 |
| §7 Easy, Normal | Tasks 2, 5, 6, 8 |
| §8 HUD, pictures, title, intro, welcome, orientation | Tasks 2, 3, 8, 9, 11 |
| §9 | Tasks 3, 11, plus the Global Constraints |
| §10 | Task 9 |
| §11 | Task 10 |
| §14 | Tasks 1, 6, 9 |

**Keyboard:** Task 3's wiring also maps:
- WASD/arrows to `moveVec`, as a separate key vector merged with the joystick;
- Space/J to the horn press;
- K/F to magic;
- M to the map/hint.
- Keys are cleared on `resetAll`.

**Deferred to later slices, per spec §12:** Friends Book, map screen and fast travel, other regions and caves, the remaining power-ups, the closet, the boss.
