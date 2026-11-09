# Super Games Arcade

Homemade games, one arcade. Live at **https://supergamesarcade.vercel.app**.

Built for phones and iPads first; it also works on a computer. Every game gets a pause menu with
**Start Over, Other Games, Sound, Full Screen, and Switch Player**. Games that turn saving on also get **Save, Load, and Continue**.

## Quick start

```bash
npm install          # only installs Playwright, which the screenshot tests use
npm run dev          # builds, then serves at http://localhost:4600
```

`npm run dev` also prints a `http://192.168.x.x:4600` address. Open it on an iPad or phone on the same Wi-Fi to test on the real device.

| Command | What it does |
|---|---|
| `npm run dev` | Build and serve locally on port 4600 (change it with `PORT` in `.env`) |
| `npm run build` | Build the site into `dist/` (Vercel runs this) |
| `npm test` | Unit tests (save storage, build helpers) |
| `npm run screens` | Full end-to-end run at phone, iPad, and desktop sizes. Saves screenshots to `screenshots/` and needs Chrome installed |

## Adding a new game

1. Drop the `.html` file into `games/`.
2. Add an entry to `games/games.json` so it gets a nice card. This step is optional: without it the game still shows up, just with a default look. Leave out the `//` comments; they are only here to explain each field.

```json
{
  "id": "dragon-dash",                    // used in the URL and for saves; don't change it later
  "file": "dragon_dash_v2.html",          // the file in games/
  "title": "Dragon Dash",
  "tagline": "Fly through the clouds!",
  "emoji": "🐉",
  "colors": ["#f97316", "#7c3aed"],       // card gradient
  "orientation": "landscape",             // landscape | portrait | any (phones get a "turn sideways" hint)
  "controls": "Tap to flap",              // shown in the pause menu
  "background": "#000000",                // color around the game
  "menuButton": "top-left",               // where the ⏸ button sits: top-left | top-right | bottom-left | bottom-right
  "saves": false,                         // true = Save/Load/Continue for this game; false (default) = always starts fresh
  "startOver": true                       // false hides in-game Start Over (for long adventures; ✨ New on the home card still works)
}
```

3. Commit and push. Vercel redeploys automatically.

**Updating a game:** replace the file (or point `"file"` at the new version) and keep the same `"id"`, so saves carry over.

## How saving works

Every game runs inside the arcade with a small helper script (`public/arcade-bridge.js`) added automatically at build time. It lets the arcade **pause any game** (freezing the animation and the clock) and **mute it**, whether or not saving is on. The game doesn't have to do anything for this to work.

Saving is **off by default** and turned on per game with `"saves": true` in `games.json`. With it off (Midnight Walk and Unicorn Meadow are set to off), every visit starts a fresh game, nothing is stored, and the menu has no Save or Load buttons.

When a game has saves turned on:

- **Continue:** the arcade saves where you are every 20 seconds and whenever you leave the game, switch apps, or lock the iPad.
- **Save slots:** each player gets 3 save slots per game.
- Saves are kept in the browser on that device (`localStorage`). They don't sync between devices. Clearing Safari's website data erases them.

A game can only save and load if it tells the arcade **how to describe its progress**. Midnight Walk and Unicorn Meadow already include this code (the `SUPER GAMES ARCADE` blocks near the end of each file), so setting `"saves": true` is all they would need. If a game has `"saves": true` but doesn't include the code, it still plays, but its Save and Load buttons are greyed out.

### Paste this into Claude when you make a new game

> At the end of the game's script, add support for the Super Games Arcade save system. If `window.ArcadeBridge` exists, call `ArcadeBridge.register({ version: 1, getState, setState })`.
> `getState()` returns a plain JSON object with everything needed to resume the current run (score, lives, level, positions, etc.). It returns `null` when there's nothing worth saving, such as on the title screen or after game over.
> `setState(state)` restores that object and shows a "Welcome back! Keep going?" screen instead of starting immediately. Throw an error if the state looks invalid.
> If the game randomizes something at startup that must match the save (like the level layout), read it early with `ArcadeBridge.peekRestore(1)`.
> Don't use `localStorage` for saves; the arcade handles that. Inside the arcade, the page's `<html>` element has the class `in-arcade`, so hide any full-screen button of the game's own with `html.in-arcade #myFullscreenBtn { display:none }`.

## Settings (`.env`)

Copy `.env.example` to `.env` for local builds. For the live site, add the same keys in **Vercel → Project → Settings → Environment Variables**, then redeploy.

| Key | Purpose |
|---|---|
| `PUBLIC_SITE_NAME` | Name shown in the header, the browser tab, and the home-screen icon |
| `PUBLIC_PLAYERS` | Player profiles, e.g. `Cece:🦄,Alana:🌈`. Leave it empty to turn profiles off. **Anyone who visits the site can see these names.** |
| `PUBLIC_ENABLE_VERCEL_ANALYTICS` | `true` to load Vercel Web Analytics (also enable it in the dashboard) |
| `PORT` | Local dev server port (default 4600) |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` / `VERCEL_TOKEN` | Only needed to deploy from your own machine with `npx vercel` |

Everything starting with `PUBLIC_` ends up in the website itself, so never put secrets in those keys.

## Put it on the home screen (iPad / iPhone)

In Safari, tap **Share → Add to Home Screen**. It opens full-screen like an app, with no browser bars.

## Project layout

```
games/              your game files + games.json (card info)
public/             the arcade itself (index.html, app.js, styles.css, saves.js, arcade-bridge.js, icons)
scripts/build.mjs   builds dist/: copies public/, injects the bridge into each game, writes config.js
scripts/serve.mjs   local server
scripts/screens.mjs end-to-end check + screenshots
tests/              unit tests (node --test)
```
