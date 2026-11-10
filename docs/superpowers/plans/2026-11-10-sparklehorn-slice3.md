# Sparklehorn Adventure — Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 3: Crystal Lake, Cloud Cave (Cloud Hop), Windy Hills, splash frogs and buzzy bees, Double Sparkle, three more Star Friends and heart pieces, and the Unicorn Closet.

**Architecture:** Same single file as Slices 1–2. `spk-core` gets maps, doors, the gap/hop rules, chest and friend data, stage routing, closet rules and difficulty switching. `spk-game` gets drawing, the hop animation, frog/bee AI, and the canvas-drawn closet screen. Tests go in `tests/sparklehorn.test.mjs` and `scripts/screens.mjs`.

**Tech Stack:** vanilla JS, Canvas 2D, Pointer Events, WebAudio, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-sparklehorn-adventure-design.md`: §3 world, §5 enemies, §6 powers and closet, §7 difficulty, §12 Slice 3, §14.

## Global Constraints

- Everything in Slice 1's and Slice 2's Global Constraints still holds: one file, no libraries, saves only through ArcadeBridge, Pointer Events with every §9 protection, no reading required, flashing under 3 Hz, commit and push to `main` after each task.
- **Save compatibility.** `v` stays 1. No existing entity id changes, except that the woods' east path gains `woods:>:55,14` (a new id). New data uses the existing `powers`, `chests`, `friends`, `heartPieces`, `campfires`, `closet` fields.
- **§14.3:** walking into a gap with Cloud Hop hops it automatically; tap-to-walk keeps pushing into a hop-able gap the way it does into a cracked rock.
- **Every overlay is canvas-drawn**, closes on ✖, M/Escape, blur and bridge pause, and ignores taps for 350 ms after opening.
- **The Closet is cosmetic only.** Prices: Mint 30, Galaxy 60, Rainbow 100, Flower Crown 25, Cape 45, Sparkly Horn 70.

## Decisions (my calls; rulings in the ledger)

1. **Crystal Lake** (52×34) is entered from a new east exit on the Woods' main path (`woods:>:55,14` ⇄ `lake:>:0,16`). Its shore is open; its islands need Bubble Hooves.
2. **Cloud Cave** (34×22) is behind a door on the lake's middle island (`lake:D:28,16` ⇄ `cloud:U:1,10`). It is lit (white clouds, no darkness). Cloud Hop is on its pedestal; a hop-only room behind a cloud gap holds a friend, a heart piece and a chest.
3. **Windy Hills** (50×34) is north of the lake (`lake:>:26,0` ⇄ `hills:>:25,33`). Two sky-gap bands and a middle split cut it into plateaus; Double Sparkle is in the top plateau's chest by the windmill.
4. **Gaps** are a new tile `v` (solid). With Cloud Hop, bumping a gap for 0.25 s, or a Horn Charge into it, hops straight across to the first open tile, up to 3 gap tiles wide.
5. **Frogs** (`f`): hop toward you, squish and spit a slow water drop (2 HP). **Bees** (`z`): swoop in a loose figure-8, shiver, then dive (2 HP). Bees fly over gaps and water. No enemy walks on water any more (Slice 2 review minor).
6. **Lily pads** `o` are walkable decoration on water near shores.
7. **Friends:** 🦆 Duck (lake island), 🐲 Baby Dragon (Cloud Cave), 🐑 Lamb (hills). **Heart pieces:** one each in lake, cloud, hills (10 of 12 total).
8. **Critters:** 🦦 otter at the lake camp, 🐐 goat at the hills camp. Stage chain continues: island → `cloud` (Cloud Cave pedestal) → `hills` (Double Sparkle chest) → done.
9. **The Closet** is a wardrobe tile `W` beside the home campfire (`meadow:W:10,17`). Walking into it opens a canvas closet screen: big buttons showing the unicorn in each color/accessory with a 💎 price; tap to buy (if you have the gems) or wear/take off. 🐣/🦄 switches difficulty (spec §14).
10. **Double Sparkle** fires 2 bolts (7 with Star Burst).

## Review Focus

1. **A Slice 2 save** (in the woods with Bubble Hooves) loads, and the trail points east to the lake. → Task 3 test.
2. **Hop into a gap whose far side is a tree/rock** must not hop or get stuck. → Task 1 test `hopLanding refuses a blocked far side`.
3. **Hop while a tap-walk is active** keeps walking toward the tap after landing; no hop lands in a gap or solid. → Task 1 e2e.
4. **Switching difficulty in the Closet** keeps hearts sane (never above max, never 0). → Task 4 test.
5. **A save made with a worn item that isn't owned** (hand-edited) loads with it taken off. → Task 4 test.

---

### Task 1: Crystal Lake, Cloud Cave, gaps and Cloud Hop, frogs
Core: maps `lake`, `cloud`; legend `ovWfz`; DOORS; `SPK.hopLanding(map, tx, ty, dx, dy, ctx) -> {tx,ty}|null`; `SPK.HOP_SECS = 0.25`; `SPK.hopTick(state, key, dt) -> bool`; pedestal `cloud:P:30,3` (power `hop`); `ENEMIES.frog`; isSolid `ctx.fly` (gaps/water passable). Game: tiles, hop animation, frogs, enemy collide ctx without powers.
Tests: maps parse; doors link; reachability (shore dry, islands need water, hop room needs hop); hopLanding cases; frog stats. Commit.

### Task 2: Windy Hills, bees, Double Sparkle
Core: map `hills`; `ENEMIES.bee`; `fireMagic` with `doubleSparkle`. Game: windmill landmark, bee AI/drawing, Double Sparkle reveal.
Tests: hills reachability by plateau; Double Sparkle bolt counts. Commit.

### Task 3: Routing, friends, hearts, map icons, music
Core: stages `cloud`, `hills`; HINTS; CRITTERS; FRIENDS (+3); CHESTS (+16); MAP_ICON. Game: songs, theme colors.
Tests: full chain; Slice 2 save points to the lake; critter hints distinct (9). Commit.

### Task 4: The Unicorn Closet
Core: `SPK.CLOSET`, `SPK.closetTap(state, id) -> 'bought'|'wear'|'off'|'poor'`, `SPK.setDifficulty(state, d)`, save sanitizing of `closet.wearing`. Game: wardrobe tile, closet screen, tinted unicorn sprites, accessories.
Tests: buy/wear/off/poor; difficulty switch hearts; hand-edited save sanitized. e2e: open closet, buy, close. Commit.

### Task 5: e2e and final review
e2e: lake → cloud → hop → hills; closet. Chrome + WebKit screens. Final whole-branch review, one fix pass.
