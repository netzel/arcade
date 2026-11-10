# Sparklehorn Adventure — design

A single-player, open-world unicorn adventure for the Super Games Arcade. Players explore a bright world above ground, go down into caves, find treasure and magic powers, and pop grumpy mushrooms and slimes with sparkle magic and a unicorn-horn charge.

Status: design, not yet built. "Jeremy:" marks his decisions. "My call:" marks decisions he delegated (he said "you decide the rest").

---

## 1. Who it's for and why

- **Players:** Jeremy's daughters.
  - Cece is 6 and reads well.
  - Alana is 4 and can't read on her own.
  - They play on iPhone (home-screen app), iPad and desktop, through supergamesarcade.vercel.app.
- **Why:** the arcade has short, single-mechanic games (Flight, Maze, Meadow, Midnight Walk). This is the first "big" game, a place to wander around and come back to over many sessions.
- **Success (Jeremy):** "enough challenge to make it engaging, but not hard per se, and enough things to explore and find in the world that make it have a sense of wonder, but also the sense of enjoyment of plopping some mushrooms or slimes out of existence."
- **Success (my call):**
  - Alana can play alone without anyone reading to her.
  - Cece wants to go back to find the last hidden things.
  - Nobody ever says "it's not working" about taps.

### Goals
1. **Open world (Jeremy).** A large overworld you move through freely, plus caves to enter. Treasure and magic powers are hidden around both.
2. **Ranged and melee combat (Jeremy).** Sparkle magic bolts and a unicorn-horn charge.
3. **Short-term power-ups (Jeremy).** Examples he gave: 5 bolts at once instead of 1; a swirling magic shell around the unicorn that hurts enemies and disappears orb by orb as it's used.
4. **Permanent upgrades (Jeremy):** "if it makes sense." It does; see §6.
5. **Landscape first, portrait still playable (Jeremy).**
6. **Taps always work on the deployed site, on every platform (Jeremy).** This is a hard requirement with its own section (§9).

### Non-goals
- Multiplayer or playing together. Jeremy explicitly scoped this to single player.
- Cloud saves. Saves stay in the device's browser, the same as the rest of the arcade (see the cloud-saves-deferred memory).
- Procedurally generated worlds. The world is hand-made so secrets are placed on purpose (my call).
- 3D. The game is a top-down 2D canvas.

### Anti-goals (failure even if it "works")
- A tap or drag that does nothing.
- Anything a 4-year-old needs to read to make progress.
- Losing progress, or a "Game Over" screen that sends you back to the start.
- Anything scary: no dark-horror caves, no blood, no "dying." Enemies pop into sparkles, and the player gets "sleepy" and wakes up at a campfire.
- Difficulty spikes that need an adult to get past.

---

## 2. How it's built (my call; matches existing arcade games)

- **One self-contained HTML file:** `games/sparklehorn-adventure.html`.
  - No libraries, no CDN and no build step of its own.
  - All art is drawn in code: shapes, gradients and emoji, like Flight and the Maze.
  - World maps are hand-authored ASCII grids inside the file.
  - If the file passes ~250 KB, it may be split into `games/sparklehorn/*.js` modules loaded by the HTML page. That's the builder's call; the arcade build only injects scripts into the HTML.
- **Rendering:** a single 2D `<canvas>`.
  - Draws only visible tiles.
  - Each map's static tile layer is pre-rendered to offscreen chunk canvases.
  - Target is 60 fps on an iPhone 12-class phone.
- **Registered in `games/games.json`:**
  ```json
  { "id": "sparklehorn-adventure", "file": "sparklehorn-adventure.html",
    "title": "Sparklehorn Adventure", "tagline": "Explore, find magic powers, and pop grumpy mushrooms!",
    "emoji": "🦄", "colors": ["#34d399", "#8b5cf6"], "orientation": "landscape",
    "controls": "Drag to walk • 🦄 horn • ✨ magic", "background": "#1e293b",
    "menuButton": "top-right", "saves": true }
  ```
  - `orientation: "landscape"`. On a phone held upright, the arcade shows its existing dismissible "Turn your device sideways for a bigger game!" card with a **Play this way** button (`public/play.js` `updateRotateHint`). That is "landscape first, portrait playable."
  - `menuButton: top-right`, because hearts and the gem count sit top-left.
- **Arcade integration:** the same contract as the other games.
  - `ArcadeBridge.register({version:1,getState,setState})`.
  - `ArcadeBridge.peekRestore(1)` at boot.
  - `html.in-arcade` is present.
  - The bridge already handles pause and mute.
  - The game must not use its own `localStorage` for progress; the arcade's autosave and slots handle it. The one exception is the difficulty choice per player (see §7), which matches how Flight stores `store.level`.

---

## 3. The world

**Size and layout (my call).**
- **Overworld:** about 96×64 tiles, at 32 px base tile size, scaled.
- **Five regions** blend into each other.
- **Locked areas** are gated by permanent powers. This is "open world with soft gates": you can go anywhere you have the power for, in any order where possible.

| Region | Feel | Main enemies | Gate to enter / fully explore |
|---|---|---|---|
| **Sunny Meadow** (start) | flowers, home campfire, friendly critters | slimes | none |
| **Mushroom Woods** | tall trees, glowing mushrooms, winding paths | mushrooms, slimes | none, but **cracked boulders** hide shortcuts (Mighty Horn) |
| **Crystal Lake** | water, lily pads, islands | splash-frogs | **water** (Bubble Hooves) |
| **Windy Hills** | cliffs, flowers, windmills | bees, slimes | **ledges/gaps** (Cloud Hop) |
| **Moonlight Ruins** | old stones, statues, the final cave | all, tougher | reached via the lake **and** hills |

**Caves (my call): 5 interior maps**, each roughly 30×20 to 40×30 tiles. They're entered through cave mouths on the overworld.
1. **Pebble Cave** (Meadow). A short tutorial cave that holds **Mighty Horn**.
2. **Glowshroom Grotto** (Woods), behind a cracked boulder. Holds **Glow Horn**. The cave itself is dimly lit but playable.
3. **Bubble Cavern** (Woods/Lake edge). Holds **Bubble Hooves**.
4. **Cloud Cave** (Lake island). Holds **Cloud Hop**.
5. **Grumpcap's Hollow** (Ruins). The final cave and boss (§5). Its deep parts are **dark** and need Glow Horn.

**Intended order:** Pebble → Grotto → Bubble → Cloud → Hollow. Soft gates make that the natural path, but explorers will find shortcuts. That's fine as long as every gate can be passed once its power is found.

**Things to find (the "wonder" layer):**
- **Treasure chests.** About 40 in total, all hand-placed. Gems inside, sometimes a heart piece or power-up.
- **Heart pieces.** Twelve are hidden: four pieces make one extra max heart, so finding all twelve gives +3 hearts.
- **Star Friends.** Twelve little critters, each in a hidden spot: an owl, a hedgehog, a firefly, a baby dragon, a bunny and so on. Touch one and it joins your **Friends Book**, a page of pictures, so it needs no reading. When found, friends wander around the home campfire, so progress is something you can see.
- **Secrets.**
  - paths through bushes;
  - walls that look solid but aren't (shown with a tiny shimmer);
  - a chest behind a waterfall;
  - a ring of flowers that rains gems when you walk around it.
- **Landmarks.** Each region has a big recognizable landmark (a giant flower, a rainbow bridge, a crystal tree), so kids can navigate without a map.
- **Map screen (my call).**
  - Opened from a 🗺️ button on the HUD.
  - Shows visited areas only, and the player's position.
  - Icons mark campfires, cave mouths found, and sparkles where unopened chests have been *seen*.

**Campfires.** About 8 across the overworld and in caves. Touching one:
- lights it;
- fully heals you;
- sets it as your wake-up point.

**Fast travel (my call):** in the map screen, tap any lit campfire to jump there. This keeps backtracking from getting tedious for little kids.

---

## 4. Controls and combat

### Actions
- **Walk.** Eight-direction analog movement.
- **🦄 Horn Charge (melee).** A quick dash about 2.5 tiles in the facing direction.
  - Damages everything it passes through.
  - Gives brief invulnerability during the dash.
  - Cooldown about 0.5 s.
  - With **Mighty Horn**, it also breaks cracked boulders and does more damage.
- **✨ Sparkle Magic (ranged).** Fires a bolt.
  - **Aim assist:** the bolt auto-aims at the nearest enemy within about 7 tiles in a ~120° cone in front of you. If there's no enemy, it goes straight ahead.
  - Holding the button auto-repeats, about 3 shots per second.
  - It never "runs out." No mana: simpler for kids (my call).

### Input (my call)
- **Touch, landscape.**
  - **Left ~55% of the screen is a floating joystick.** Touch anywhere there and the joystick base appears under your finger; drag to walk.
  - **Two big round buttons, bottom-right.** 🦄 Horn (88 px) and ✨ Magic (100 px), arranged for the right thumb.
  - **A 🗺️ button** sits under the ⏸ menu button area. It must not overlap the arcade's ⏸ at top-right.
- **Touch, portrait.** The same layout scaled. Joystick zone is the bottom-left area; buttons are bottom-right; the world view is above them.
- **Tap-to-walk.** A quick tap in the joystick zone with no drag walks the unicorn toward that world point. This is mostly for Alana, and it's the same idea as Unicorn Meadow.
- **Keyboard.**
  - Arrows/WASD to walk.
  - Space or J for Horn.
  - K or F for Magic.
  - M for the map.
- **Gamepad:** not in scope.

### Easy-mode helper
The details are in §7. In short: **Auto-Magic** fires sparkle bolts automatically at nearby enemies, so Alana only has to walk, and the horn becomes a bonus button.

### Health and getting hurt
- **Hearts.**
  - Easy: 6 hearts.
  - Normal: 4 hearts.
  - Heart pieces add more.
- **Getting hit:**
  - lose half a heart, or one heart from tough enemies;
  - small knockback;
  - 1.2 s of blinking invulnerability.
- **Healing.** Enemies sometimes drop 💗. Campfires heal fully. A few bushes hold hearts.
- **At 0 hearts ("sleepy"):**
  - a gentle fade with a yawning unicorn;
  - you wake at your last lit campfire with full hearts;
  - **all items, gems and progress are kept**;
  - nearby enemies reset.
  - There's no lives counter and no game over.

---

## 5. Enemies and the boss

Enemies never chase into a campfire's safe ring, which is about 3 tiles (my call). All defeats are a *pop* into sparkles and confetti with a satisfying sound, and some drop gems or a 💗.

| Enemy | Where | Behavior | HP (bolts) |
|---|---|---|---|
| **Slime** (green/pink/blue) | everywhere | hops toward you slowly when near. Big slimes split into 2 minis | 1 (mini), 2, 4 (big) |
| **Grumpy Mushroom** | Woods, Ruins | wanders. When you're near, it stops, puffs a slow spore ball (dodgeable, telegraphed by a squish) | 3 |
| **Splash Frog** | Lake | hops between lily pads, spits a slow water drop | 2 |
| **Buzzy Bee** | Hills | swoops in a gentle arc, a short wind-up before diving | 2 |
| **Cave Bat** | caves | flutters in a figure-8, briefly dives | 1 |
| **Rock Beetle** | caves, Ruins | armored on top: magic does 1/2 damage, **Horn flips it** for full damage | 4 |

**Spawning (my call).**
- Each map has hand-placed spawn points with small groups of 2–5 enemies.
- Defeated groups respawn when you leave the area, or after a campfire wake-up.
- Enemies don't respawn while you're watching.
- About 25 enemies at most are active near the player at once, for performance.

**Boss: King Grumpcap (my call, since Jeremy left it to me).** One gentle boss at the end of Grumpcap's Hollow, and it's optional to come back to.
- **He's a giant grumpy mushroom with a crown.**
- **Three phases**, each telegraphed by color and a wiggle:
  1. He waddles and puffs spore rings.
  2. He summons 3 slimes.
  3. He bounces and makes shockwave rings you step out of.
- **His health shows as a row of big hearts**, not a number.
- **If you get sleepy,** you wake at the campfire right outside the boss room, and his damage *stays*. That keeps it from ever becoming a wall.
- **When he's beaten, he turns happy** (no defeat animation): he smiles and drops the **Rainbow Crown**. Then:
  - the world gets a rainbow sky;
  - all Star Friends gather at home;
  - a picture-only celebration plays.
  - You can keep playing afterwards to find whatever's left.

**Why include a boss for these ages:** it gives the adventure a clear, exciting ending, and the rules above make it hard to get stuck. If testing shows it's too much for Alana, Easy mode makes his spores slower and his phase 3 shorter.

---

## 6. Power-ups and upgrades

### Short-term power-ups (Jeremy's idea, my specific set)
- **Where they come from:** glowing orbs that drop from chests, some enemies and special flower patches.
- **How they show:** each one appears as a big icon with a shrinking ring timer at the top of the screen.
- **Stacking:** one of each type at a time, but different types stack. Picking up a duplicate refreshes it.

| Power-up | Effect | Ends |
|---|---|---|
| ✨ **Star Burst** | each Magic shot fires **5 bolts in a fan** | 15 s |
| 🔮 **Swirl Shield** | **6 magic orbs circle the unicorn**. Each orb that touches an enemy hurts it and **pops and disappears**, one by one | when all 6 are used, or 30 s |
| ⚡ **Zoomy Hooves** | 1.6× walk speed, and Horn Charge goes farther | 15 s |
| 🌈 **Rainbow Trail** | you leave a rainbow behind you that hurts enemies who touch it | 12 s |
| 🧲 **Gem Magnet** | gems fly to you from far away | 20 s |
| 💥 **Mega Horn** | Horn Charge is twice as big and pops everything in its path in one hit | 10 s |

### Permanent upgrades (my call)
These are found in chests and caves and are kept forever.

**Main powers.** Each is the prize at the end of its cave and gates part of the world (§3):
- 🪨 **Mighty Horn.** Breaks cracked boulders, and Horn damage goes up.
- 💡 **Glow Horn.** Lights a circle around you in dark caves.
- 🫧 **Bubble Hooves.** Walk on water as if on bubbles.
- ☁️ **Cloud Hop.** A Horn Charge near a ledge hops over gaps and cliffs.

**Magic upgrades.** Two are hidden in chests:
- **Big Sparkle:** bolts are bigger and do 2 damage.
- **Double Sparkle:** two bolts per shot.

**Heart pieces.** See §3.

**Getting a main power** is a big moment:
- the game pauses;
- the item spins up with a fanfare;
- a short picture demo plays (for example, a picture of the unicorn walking on water);
- for Cece, optional one-line text below it.

### Gems and the Unicorn Closet (my call)
Gems are spent in a **Closet** at the home campfire on unicorn colors and accessories:
- colors: Mint, Galaxy, Rainbow;
- accessories: a flower crown, a cape, a sparkly horn.

It mirrors Flight's Colors & Magic closet, which the girls already know. Prices should take a few sessions of exploring to reach. The closet is purely cosmetic.

---

## 7. Difficulty: Easy and Normal (my call)

Chosen when you start a new game, from two big picture buttons: 🐣 Easy and 🦄 Normal. It's remembered per player and can be changed in the closet area.

| | Easy (for Alana) | Normal (for Cece) |
|---|---|---|
| Starting hearts | 6 | 4 |
| Auto-Magic | **on**: fires at the nearest enemy in range about every 0.5 s | off: press ✨ |
| Enemy speed / attack rate | 70% | 100% |
| Enemy damage | always ½ heart | ½ or 1 |
| Hint sparkle trail (see §8) | appears after 45 s with no new discovery | only when 🗺️ hint is tapped |
| Boss | slower, shorter phase 3 | as designed |

There's no Hard mode in v1. Hard can be added later if Cece wants it, like Flight's levels.

---

## 8. Screens, readability and orientation

### The HUD
- **Top-left:** hearts, then 💎 gem count.
- **Top-center:** power-up timers.
- **Top-right:** ⏸ (the arcade's), and 🗺️ next to or below it.
- **Bottom:** the joystick zone and the 🦄 ✨ buttons.
- The HUD avoids the iPhone notch and home bar using `env(safe-area-inset-*)`.

### No reading required
Every piece of guidance is a picture: icons, arrows and pointing.
- **Talking characters** (friendly critters who give hints) speak in **picture bubbles**. Example: a bubble with 🪨➡️🦄💥 means "break the rock with your horn."
- **Text is optional.** A small line of text under each picture is there for Cece.
- **Read-aloud (my call, best-effort):** an 🔊 button on any bubble reads the text with `speechSynthesis`. If it isn't available, the button hides. It must never block or throw.
- **The hint sparkle trail:** a gentle trail of sparkles toward the nearest undiscovered "next step," meaning the next main power's cave. It's how a 4-year-old who's lost finds the way.

### Title and start flow
1. The title screen shows the unicorn and a big ▶ button.
2. Starting a new game asks for difficulty (§7) with picture buttons.
3. A 10-second picture intro: the unicorn wakes up at the home campfire, and a critter points at the cave.
4. Play.

**Continue** comes from the arcade's save system. `setState` shows a "Welcome back!" picture screen with ▶.

### Orientation (Jeremy: landscape first, portrait playable)
- **Camera zoom:** the scale keeps about **11 tiles visible vertically in landscape** and **about 9 tiles visible horizontally in portrait**. Portrait shows more above and below, landscape more to the sides.
- **Rotating:** if the device rotates mid-play, the game:
  - recalculates layout;
  - resets the joystick;
  - re-anchors the buttons;
  - keeps playing.
  - No reload, no pause.
- **The arcade's rotate hint** is a nudge, not a wall. "Play this way" dismisses it for the session, and the game must be fully playable underneath it.

---

## 9. Taps must always work (Jeremy's hard requirement)

The arcade has already fixed the two known root causes:
- audio exceptions that killed the input/frame loop;
- iOS iframes swallowing touches. Games now run as top-level pages.

This game must follow those patterns *and* add protections for the new things it does: multi-touch, a joystick, and held buttons.

**Required patterns:**
1. **One input system: Pointer Events on the canvas.**
   - Every touch, mouse and pen input goes through `pointerdown` / `pointermove` / `pointerup` / `pointercancel` on the game canvas.
   - Controls are drawn on the canvas and hit-tested in JS, not DOM buttons. This avoids iOS DOM quirks like double-tap zoom, 300 ms delay and focus issues, and it keeps one code path.
   - DOM is used only for overlays such as the title, the map and the closet. Those use `pointerup`, never `click`-only, and follow the same rules below.
2. **CSS on canvas and overlays:**
   - `touch-action: none`;
   - `user-select: none`;
   - `-webkit-user-select: none`;
   - `-webkit-touch-callout: none`.
   - Prevent the `contextmenu` event so a long-press shows no callout.
3. **Each finger is tracked by `pointerId`.**
   - The joystick owns one pointer; each button owns its own.
   - Walking and firing at the same time must work.
   - Use `setPointerCapture` on `pointerdown`.
4. **Stuck input is impossible.** All input state (joystick, held buttons) is cleared on:
   - `pointercancel`;
   - `lostpointercapture`;
   - `blur`;
   - `visibilitychange` to hidden;
   - `pagehide`;
   - orientation or resize changes;
   - the arcade pause.
   - A watchdog against iOS dropping `pointerup`: held touch pointers are checked against how many fingers the screen reports (`TouchEvent.touches`), and the extra ones are released. A finger held perfectly still sends no events, so silence alone never releases a touch. A pointer with no touch information times out after 30 s. (Changed after the final review: a 3-second silence rule cut off held buttons.)
5. **The frame loop can't die.**
   - `requestAnimationFrame(frame)` is the first line of `frame`.
   - Update and draw are wrapped in `try/catch`. Errors are counted and logged, never rethrown.
   - Matches Flight and the Maze after the fix.
6. **Audio is strictly best-effort.**
   - Every WebAudio call is inside `try/catch`.
   - The context is resumed on the first pointerdown when it's not `'running'`.
   - Input never waits on audio.
   - `speechSynthesis` follows the same rules.
7. **No dependency on the first tap "unlocking" anything** other than audio. The game is fully playable with sound broken.
8. **Debug and test hooks.**
   - `window.__spk` exposes `{ state, frames, player:{x,y,hp,map}, inputs, errors, powers, _teleport(), _give() }` for tests.
   - It supports the arcade's existing `?debug` tap panel.

**Required tests** (extend `scripts/screens.mjs`; run on Chromium **and** WebKit, `PW_ENGINE=webkit`, at all 5 viewports):
- **First tap works.** One real `touchscreen.tap` on ▶ from a fresh load starts the game.
- **Joystick moves the unicorn.**
- **Magic button fires** (bolt count goes up).
- **Multi-touch.** Hold the joystick and tap Magic at the same time; the unicorn moves *and* fires. Use CDP `Input.dispatchTouchEvent` in Chromium.
- **No stuck input.** Start a drag, fire `pointercancel` or `blur`; the unicorn stops.
- **Rotation mid-play.** Change the viewport from landscape to portrait; controls still work and the buttons are in the right corner.
- **Pause and resume** via ⏸, then taps still work.
- **Arcade → Back** (bfcache), then taps still work.
- **Broken audio.** The existing `brokenAudioPass` in both modes: taps still start and play the game.
- **Saves.** `getState` → `setState` round-trip restores map, position, powers, chests opened, gems and friends.
- **Orientation coverage.** Screenshot checks in landscape and portrait.
- **Post-deploy.** A live WebKit check against the Vercel URL (as with `live2.mjs`): iPhone and iPad emulation, first tap starts, walking and firing work.

**Honest limit:** emulation is not a physical iPhone. Before calling it done, Jeremy should do a one-minute check on his real phone from the home-screen app.

---

## 10. Saves

`saves: true`. `getState()` returns:

```
{ v:1, difficulty, map, x, y, facing, hp, maxHpPieces,
  gems, powers:{mighty,glow,bubble,hop,bigSparkle,doubleSparkle},
  chests:[ids opened], friends:[ids found], heartPieces:[ids found],
  campfires:[ids lit], wakeCampfire, bossBeaten, explored:<compressed fog bitmap per map>,
  closet:{owned:[...], wearing:{color, accessory}} }
```

**Rules:**
- Short-term power-ups and live enemies are **not** saved.
- `getState` returns `null` only on the title screen.
- `setState` validates and throws on bad data.
- Chest, friend, piece and campfire IDs are stable strings written into the map data, so later map edits don't break old saves.

**Closet:** stored in the save, so it's per save slot. That's simpler than Flight's separate store, and it fits "each adventure is yours."

**Note (my call):** `explored` fog is stored compactly, at 1 bit per tile per map, then base64-encoded. That keeps saves small; the arcade's localStorage budget is shared with thumbnails.

---

## 11. Sound and feel (my call)

- **Effects:** synthesized WebAudio blips in the same style as Flight.
  - *pop* (enemy), *sparkle* (bolt), *whoosh* (horn), *chime* (chest), *fanfare* (main power), a cozy crackle (campfire).
- **Music:** a soft looping melody per region (simple synth). It should be easy to tell apart from effects, and it respects the arcade mute.
- **Juice:**
  - screen shake (small and short);
  - hit-pause of about 40 ms on enemy pop;
  - confetti particles;
  - gems bounce out of chests;
  - the unicorn's mane bobs.
- **Accessibility:** no flashing faster than 3 Hz. Screen shake is minimal.

---

## 12. Build order (my call)

The world is large, so it ships in playable slices. Each slice is deployed and tested on the phone before the next.

1. **Slice 1, the core.**
   - Engine: camera, tiles, collision, pointer-input system with all §9 protections, HUD, Easy/Normal.
   - Sunny Meadow plus Pebble Cave (Mighty Horn).
   - Slimes and mushrooms; Horn and Magic.
   - Two power-ups: Star Burst and Swirl Shield, Jeremy's examples.
   - Campfires and sleepy wake-up.
   - Saves.
   - All §9 tests.
   - *This is the slice that proves taps work, so it ships first and gets checked on the real phone.*
2. **Slice 2.** Mushroom Woods, Glowshroom Grotto (Glow Horn), Bubble Cavern (Bubble Hooves), the rest of the power-ups, Star Friends and the Friends Book, the map screen and fast travel.
3. **Slice 3.** Crystal Lake, Windy Hills, Cloud Cave (Cloud Hop), frogs and bees, the Closet.
4. **Slice 4.** Moonlight Ruins, Grumpcap's Hollow, King Grumpcap, rock beetles, the ending celebration, a final pass on balance and secrets.

---

## 13. Left to the builder

- Exact art style within "bright, round, cute, code-drawn": tile palettes, unicorn sprite drawing, animation frames.
- Exact map layouts, secret placement and chest contents, within the counts and gates above.
- Tuning numbers: speeds, cooldowns, HP, ranges. The values above are starting points. Tune for "engaging, not hard."
- Code structure, and whether to split into modules (see §2).
- Hint-bubble picture vocabulary and critter characters.
- Music melodies.

---

## 14. Decisions settled after the builder review (all my calls)

1. **Progress must not be wiped by one tap.**
   - Today, the arcade's in-game **Start Over** deletes the autosave (`public/play.js:152`).
   - The arcade also deletes the autosave whenever `getState()` returns `null` (`play.js:107`).
   - **Fix (shared code, opt-in per game):** add `"startOver": false` to the game's `games.json` entry. `play.js` hides the Start Over tile for games with it.
     - A fresh adventure is still possible from the home card's **✨ New** button, which sits behind a confirm and is more of a grown-up path.
   - **In the game:** once an adventure exists, `getState()` never returns `null`. The game's own title screen isn't reachable while a save is loaded.
2. **Deploying.** Same as the rest of this project: commit and push to `main` after each coherent unit, which auto-deploys. It's one continuous plan through all four slices.
   - **After Slice 1:** run the live WebKit check, then ask Jeremy for a real-phone check. Keep going on Slice 2 meanwhile, and fix anything he reports first.
   - **Partial slices are fine on the live site** as long as what's there is playable. Slice 1 is a complete little adventure on its own.
3. **Alana can pass every gate on Easy without timing the horn.**
   - **Cracked boulders:** walking into one for about 0.6 s with Mighty Horn auto-bonks it. This applies in both modes, because it's simpler and kind.
   - **Cloud Hop:** walking off a hop-able ledge with Cloud Hop hops automatically, in both modes.
   - **Rock Beetles:** on Easy, magic does full damage to them.
   - **Result:** on Easy, no progress ever *requires* the horn button. The horn stays fun and stronger.
4. **Shared arcade code may change, but minimally, and the full existing suite must pass on Chromium and WebKit afterwards.**
   - **Bridge:** emit `pause` and `resume` events through the existing `ArcadeBridge.on(fn)` (`public/arcade-bridge.js` `emit`). The game clears all input on `pause`. Its other protections (blur, visibilitychange, watchdog) cover the rest anyway.
   - **No separate module files.** `scripts/build.mjs` only ships `games/*.html`, so the game stays one HTML file. If it grows past about 400 KB, flag it rather than changing the build.
   - **Difficulty lives only in the save.** It's chosen when a new adventure starts. The "remembered per player / change in closet area" wording in §7 is dropped: the difficulty can be changed from the Closet, and the change is saved with the adventure.
