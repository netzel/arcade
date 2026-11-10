# Sparklehorn Adventure — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 2: Mushroom Woods, Glowshroom Grotto (Glow Horn), Bubble Cavern (Bubble Hooves), the other four power-ups, Big Sparkle, cave bats, the first seven Star Friends with a Friends Book, and a map screen with campfire fast travel.

**Architecture:** This builds on Slice 1's single file, `games/sparklehorn-adventure.html`.
- `spk-core` gets the new data and pure rules: maps, doors, pedestals, chests, friends, goal routing, power-up math, light radius and map-screen data.
- `spk-game` gets drawing, AI and the map-screen UI.
- Unit tests go in `tests/sparklehorn.test.mjs` and e2e checks in `scripts/screens.mjs`. Both follow Slice 1's patterns.

**Tech Stack:** vanilla JS, Canvas 2D, Pointer Events, WebAudio, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-sparklehorn-adventure-design.md`: §3 world, §4 bats, §6 power-ups, §8 map, §12 Slice 2, §14.

## Global Constraints

- Everything from Slice 1's Global Constraints still holds:
  - one file, no libraries;
  - progress only through ArcadeBridge;
  - Pointer Events only, with every §9 input protection;
  - no reading required;
  - flashing under 3 Hz;
  - commit and push to `main` after each task, with the attribution lines;
  - `npm test`, `npm run screens` and `PW_ENGINE=webkit npm run screens` must pass before the final push.
- **Save compatibility.** Existing Slice 1 saves (`v: 1`) must load unchanged. No entity id in `meadow` or `pebble` may change. New save data reuses the existing fields (`powers`, `friends`, `chests`, `heartPieces`, `broken`, `explored`), so `v` stays 1.
- **Gates must be passable on Easy without the horn button (§14.3).** Walking into cracked boulders bonks them. Dark caves are dim, never pitch black.
- **Every new overlay is drawn on the canvas.** Its taps go through the canvas `pointerdown` hit list, like the reveal card and 🔊. Every overlay closes on ✖, on the M or Escape key, and on bridge pause or blur, so input can never stay stranded.
- The file stays under about 400 KB (§14.4).

## Decisions (my calls; recorded as rulings in the ledger)

1. **Regions are separate maps joined by walk-through edge exits** (a new `>` tile), not one 96×64 map. Slice 1 already built the meadow as its own map. The fade when you walk off the edge reads as "the path continues." No teleport.
2. **The way into the Woods is a second cracked boulder on the meadow's east path** at `meadow:B:46,14`, with the exit at `meadow:>:47,14`. That answers Jeremy's question: the next area opens with the Mighty Horn. The hint trail orders it after the secret-chest boulder.
3. **Light.** The Grotto is *dim*: light radius 4.5 tiles, or 7 with Glow Horn. Bubble Cavern is *dark*: 2.2 tiles, or 7 with Glow Horn. Lit campfires and glowshrooms also give light. This is a soft gate, as the spec's order intends.
4. **Seven Star Friends this slice.**
   - Meadow: 🐞 and 🦋.
   - Woods: 🦉, 🦔 and 🐿️.
   - Grotto: 🐌.
   - Bubble Cavern: 🐢.
   - The Friends Book shows only the friends that exist so far, so no child hunts for one that isn't in the game yet.
5. **The 🗺️ button opens the map screen.** On Normal, the "show me the way" sparkle trail moves inside the map screen as a ✨ button, as spec §8 says. On Easy the trail still appears by itself.
6. **Big Sparkle** (bolts do 2 damage and are bigger) is in a Grotto chest. Double Sparkle waits for Slice 3.
7. **A second hint critter.** A 🦊 fox at the Woods camp gives the same staged picture hints as the bunny.

## Review Focus

1. **An old Slice 1 save** (on the meadow, or in Pebble Cave holding Mighty Horn) loads, and the trail then points at the east boulder. → Task 3 test `a slice-1 save still loads and points to the woods`.
2. **Opening the map screen while a finger is on the joystick,** then closing it. Nothing stays held. → Task 6 test `opening an overlay clears input` (game layer) and the e2e map test.
3. **Fast travel to a campfire in another map.** You land beside that fire with input reset. → Task 6 test `travelTargets lists only lit fires`, plus e2e.
4. **Standing on water when a save is made with Bubble Hooves.** `validateSave` must keep that spot, which is solid without the power. → Task 2 test `a save on water with bubble hooves keeps its spot`.
5. **Dark caves on a slow phone.** The light mask must not allocate per frame. → It reuses one offscreen canvas, resized only on `resize()`; reviewer to check.

---

### Task 1: The Woods and the way there

**Files:** modify `games/sparklehorn-adventure.html` (core and game); test `tests/sparklehorn.test.mjs`.

**Produces:**
- New tiles in `LEGEND`:
  - `>` edge exit: walkable, triggers like a door, drawn as path;
  - `*` star friend spot: an entity, floor underneath;
  - `g` glowshroom: decor, walkable;
  - `L` landmark: solid, drawn as a giant 🍄;
  - `a` bat spawn: an entity.
- `SPK.MAPS.woods`: 56×36, `theme: 'woods'`.
- `meadow` row 14 gets `B` at x 46 and `>` at x 47.
- `DOORS` gets `meadow:>:47,14` ⇄ `woods:>:0,14`.
- `SPK.EXITS = { '>': 1, D: 1, U: 1 }` is used by `doorArrival` and the game's door trigger.

**Steps:**
- [ ] Write the failing tests:
  - `REAL_MAPS` includes `woods`;
  - `woods is 56×36 and its west exit links back to the meadow`;
  - `the woods are behind the east boulder` (flood from meadow start: `>` is unreachable without breaking boulders, reachable with them);
  - `everything in the woods is reachable` (flood from `woods:>:0,14`, breaking boulders, without water; island things excluded and listed in `ISLAND`);
  - woods content counts: F 2, C 8, H 1, S 5, M 6, `*` 3, D 2, B 1, L 1.
- [ ] Run `npm test`. Expected: the new tests FAIL.
- [ ] Draw the woods map. It needs:
  - a winding path from the west exit;
  - a camp (F) near the entry, with the fox;
  - a rock outcrop to the north holding the Grotto door, with a cracked boulder in front of it;
  - a pond with an island (a chest and heart piece reachable only on water);
  - the Bubble Cavern door at the east;
  - a giant-mushroom landmark;
  - glowshrooms.
- [ ] Add the meadow's east boulder and exit, `DOORS`, and the parse and legend changes. Update the Slice 1 test "exactly one thing hides behind the boulder" to list the secret chest plus the woods exit.
- [ ] Game: the door trigger uses `SPK.EXITS`. Draw `>`, `g`, `L` and the woods theme (darker grass, deep-green trees). Woods music.
- [ ] Run `npm test`. Expected: PASS. Then commit "Sparklehorn: Mushroom Woods and the path east".

### Task 2: Two caves, their powers, light and bats

**Produces:**
- `SPK.MAPS.grotto` (36×24, `cave`, `dark: 'dim'`, theme `grotto`) and `SPK.MAPS.bubble` (34×22, `cave`, `dark: 'dark'`, theme `bubble`), with doors to the woods.
- `SPK.PEDESTALS = { id: { power, item, picture, text } }` for mighty, glow and bubble. `SPK.takePedestal(state, id)` returns the reveal or null.
- `SPK.lightRadius(state, map)` returns tiles, or null for lit maps.
- `ENEMIES.bat = { hp: 1, speed: 1.6, sense: 5, touch: 1, dive: { every: 2.4, speed: 5, dur: 0.45 } }`.

**Steps:**
- [ ] Failing tests:
  - both caves parse;
  - every door links back;
  - everything in each cave is reachable from its exit, except `ISLAND` entries that need water;
  - those are reachable with `powers.bubble`;
  - `takePedestal` grants the right power once only;
  - `lightRadius` values (decision 3);
  - `a save on water with bubble hooves keeps its spot`;
  - bat stats.
- [ ] Run. Expected: FAIL.
- [ ] Draw both maps and implement the core.
  - **Grotto:** a fire near the entry, 4 chests (one has Big Sparkle), a heart piece, the 🐌, bats and slimes, and the pedestal deep inside.
  - **Bubble Cavern:** pools, the pedestal reachable on foot, and an island chest, heart piece and 🐢 that need water.
- [ ] Game:
  - the pedestal touch uses `takePedestal`;
  - the light mask uses one reusable offscreen canvas, cut out with `destination-out` gradients at the player, lit fires and glowshrooms;
  - bat AI (figure-8 hover, wind-up, short dive) and bat drawing;
  - bubbles under your hooves on water;
  - cave themes.
- [ ] Run. Expected: PASS. Then commit "Sparklehorn: Glowshroom Grotto and Bubble Cavern".

### Task 3: The way forward — routing, hints, critters

**Produces:**
- `SPK.exitToward(fromMap, toMap)` returns the door id on `fromMap` along the shortest door path, or null.
- `SPK.nextGoal(state)` follows these stages: Pebble pedestal → secret boulder → east boulder → Grotto boulder → Grotto pedestal → Bubble pedestal → null. When the target is on another map, the goal is `exitToward`.
- `SPK.CRITTERS = [bunny, fox]`.
- `SPK.critterHint(state)` has one picture sentence per stage.

**Steps:**
- [ ] Failing tests:
  - `nextGoal walks the whole slice 2 chain` (with map hops);
  - `exitToward from grotto to meadow is the grotto exit`;
  - `a slice-1 save still loads and points to the woods`;
  - critter hints differ at every stage.
  - Keep the Slice 1 goal test passing by appending stages, not rewriting it.
- [ ] Implement. Draw every critter and its bubble.
- [ ] Run, then commit "Sparklehorn: hint trail and critters lead through the woods".

### Task 4: Power-ups and Big Sparkle

**Produces:**
- `POWERUPS` gains:
  - `zoomy` (15 s, ⚡);
  - `rainbow` (12 s, 🌈);
  - `magnet` (20 s, 🧲);
  - `mega` (10 s, 💥).
- `SPK.speedMul(state, now)` returns 1.6 with zoomy, else 1.
- `SPK.hornStats(state, now)` returns `{ dist, radius, dmg }`:
  - dist is 2.5 tiles, or 3.5 with zoomy;
  - radius is 0.95 tiles, or 1.9 with mega;
  - dmg comes from `hornDamage`, or 99 with mega.
- `SPK.magnetRange(state, now)` returns 1.4 tiles, or 9 with magnet.
- `SPK.boltDamage(state)` returns 2 with `powers.bigSparkle`, else 1.
- Chest contents may be `{ upgrade: 'bigSparkle' }`.

**Steps:**
- [ ] Failing tests:
  - each new power-up's timer and refresh;
  - the speed, horn, magnet and bolt functions;
  - `openChest` with an upgrade sets the power;
  - every power-up appears in at least one chest.
- [ ] Implement. In the game:
  - the rainbow trail is a ribbon of points that damages enemies, 1 per enemy per 0.5 s;
  - magnet pulls gems;
  - mega gives a bigger dash glow;
  - zoomy makes you faster and adds speed lines;
  - drops pick from all six power-ups;
  - a Big Sparkle reveal card.
- [ ] Run, then commit "Sparklehorn: four new power-ups and Big Sparkle".

### Task 5: Star Friends and the Friends Book data

**Produces:**
- `SPK.FRIENDS = { entityId: { emoji, name } }` with the 7 friends.
- `SPK.meetFriend(state, id)` returns the friend once, then null.
- `SPK.friendsBook(state)` returns `[{ emoji, found }]` in a fixed order.

**Steps:**
- [ ] Failing tests:
  - every `*` entity has a friend entry, and every entry is a real entity;
  - meeting is once-only;
  - the book lists all 7 with found flags;
  - friends survive a save round-trip.
- [ ] Implement. In the game, meeting a friend shows a reveal card (🦄❤️🦉🏠, "Owl is your friend!"). Found friends hop around the home campfire. Unfound friend spots show a faint sparkle only when you're near.
- [ ] Run, then commit "Sparklehorn: Star Friends".

### Task 6: Map screen, fast travel, Friends Book page

**Produces:**
- `SPK.MAP_ICON = { meadow: '🌼', woods: '🍄', pebble: '🪨', grotto: '💡', bubble: '🫧' }`.
- `SPK.mapMarks(state, mapId)` returns `[{ kind: 'fire' | 'door' | 'chest' | 'friend', tx, ty, id, lit }]`, including only explored tiles.
- `SPK.travelTargets(state)` returns the lit campfire ids.
- Game mode `mapview`, with a hit list for: place tabs, fires, ✖, ✨ (trail) and 📖 (book page).

**Steps:**
- [ ] Failing tests:
  - `mapMarks hides unexplored things`;
  - `travelTargets lists only lit fires`.
- [ ] Implement the core, then the game:
  - 🗺️ or M opens the map. Enemies and timers freeze while it's open.
  - The minimap is drawn from explored bits into one cached canvas per open.
  - Tapping a lit 🔥 fades you to beside that fire.
  - ✨ closes the map and runs the trail for 8 s.
  - 📖 shows the friends grid.
  - ✖, M, Escape, bridge pause or blur close it.
  - Opening and closing call `resetInput`.
  - Add the test hook `__spk.mapHits()`.
- [ ] Run, then commit "Sparklehorn: map screen, fast travel, Friends Book".

### Task 7: End-to-end and finish

**Steps:**
- [ ] Add to `sparklehornPass` in `scripts/screens.mjs`, at every viewport:
  - with Mighty Horn, walk east into the boulder (a held joystick touch) until `map === 'woods'`;
  - tap 🗺️: mode is `mapview`;
  - tap a fire from `mapHits()`: you're back on the meadow in `play`, with 0 active inputs;
  - tap 🗺️, then ✖: back in play, and the joystick walks;
  - teleport into the Grotto and Bubble Cavern: frames advance with 0 errors;
  - screenshot the woods, a dark cave and the map screen.
- [ ] Run the full suites on Chromium and WebKit. Fix anything that fails.
- [ ] Final whole-branch review on the most capable model, one fix pass, then commit and push.
