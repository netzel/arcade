// End-to-end smoke test + screenshots at phone / iPad / desktop sizes.
//   npm run screens         (builds first; uses your installed Chrome)
// Screenshots land in screenshots/ (gitignored). Exits non-zero on failure.
//
// Two passes:
//   1. "fresh"  — games as configured (saves off): every launch starts fresh.
//   2. "saves"  — saves forced ON for the test only, to keep the save/load
//                 path covered for future games that opt in.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 4601; // test server; dev server uses 4600
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: 'phone-portrait', width: 390, height: 844, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true, savesPass: true },
  { name: 'ipad-portrait', width: 820, height: 1180, mobile: true, savesPass: true },
  { name: 'ipad-landscape', width: 1180, height: 820, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

// Test-only: flip every game's `saves` flag on as config.js assigns ARCADE_CONFIG.
const FORCE_SAVES = () => {
  Object.defineProperty(window, 'ARCADE_CONFIG', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      (v.games || []).forEach((g) => { g.saves = true; });
      Object.defineProperty(window, 'ARCADE_CONFIG', { value: v, writable: true, configurable: true });
    },
  });
};

const failures = [];
function check(cond, msg) { if (!cond) { failures.push(msg); console.log(`   ✗ ${msg}`); } else console.log(`   ✓ ${msg}`); }

async function openContext(browser, vp, { forceSaves = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 2,
  });
  if (forceSaves) await ctx.addInitScript(FORCE_SAVES);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const tag = forceSaves ? `${vp.name}-saves` : vp.name;
  const t = {
    ctx, page, errors,
    shot: (n) => page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) }),
    frame: () => page.frameLocator('#game-frame'),
    gameFrame: () => page.frames().find((f) => f.url().includes('/games/')),
    async home() {
      await page.goto(BASE + '/');
      await page.waitForFunction(() => document.body.dataset.screen);
      if (await page.locator('#players').isVisible()) {
        await t.shot('01-players');
        await page.locator('.player-btn').first().click();
      }
      await page.locator('#home').waitFor();
      await page.waitForTimeout(400);
    },
    async launch(cardIndex) {
      await page.locator('.game-card').nth(cardIndex).locator('.btn-primary').first().click();
      await t.loaded();
    },
    async loaded() {
      await page.locator('#loading.done').waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      if (await page.locator('#rotate-hint').isVisible()) {
        await t.shot('rotate-hint');
        await page.locator('#rotate-dismiss').click();
      }
    },
    menu: () => page.locator('#menu-fab').click(),
    tileNames: () => page.locator('.tile-grid .tile').allInnerTexts(),
  };
  return t;
}

async function freshPass(browser, vp) {
  const t = await openContext(browser, vp);
  const { page } = t;
  await t.home();
  await t.shot('02-home');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `home has no sideways scroll (overflow ${overflow}px)`);

  // Midnight Walk: play, check layout + pause
  await t.launch(0);
  await t.shot('03-midnight-title');
  await t.frame().locator('#b-start').click();
  await page.waitForTimeout(1500);
  await t.shot('04-midnight-playing');
  const fit = await t.gameFrame().evaluate(() => {
    const r = document.getElementById('gc').getBoundingClientRect();
    return { bottom: r.bottom, right: r.right, vh: innerHeight, vw: innerWidth };
  });
  check(fit.bottom <= fit.vh + 1 && fit.right <= fit.vw + 1, `midnight canvas fits on screen (${Math.round(fit.right)}x${Math.round(fit.bottom)} in ${fit.vw}x${fit.vh})`);

  await t.menu();
  await page.waitForTimeout(400);
  await t.shot('05-pause-menu');
  const names = (await t.tileNames()).join(' | ').replace(/\n/g, ' ');
  check(!/Save|Load/.test(names), `pause menu has no Save/Load for a no-saves game (${names})`);
  const t1 = await t.gameFrame().evaluate(() => performance.now());
  await page.waitForTimeout(400);
  const t2 = await t.gameFrame().evaluate(() => performance.now());
  check(t1 === t2, 'game clock is frozen while the menu is open');

  // Leave mid-game, come back: should be a fresh game with no Continue
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.waitForTimeout(400);
  const card0 = await page.locator('.game-card').nth(0).innerText();
  check(!/Continue|Saves/.test(card0), 'home card shows only Play after leaving mid-game');
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sga:saves:')));
  check(stored.length === 0, `nothing saved to the device (${stored.join(', ') || 'none'})`);
  await t.launch(0);
  check(await t.frame().locator('#ov-menu').isVisible(), 'returning starts a fresh game (title screen)');
  check(!(await t.frame().locator('#ov-resume').isVisible()), 'no "Welcome back" screen');

  // Refresh while in a game also starts fresh
  await page.reload();
  await t.loaded();
  check(await t.frame().locator('#ov-menu').isVisible(), 'refreshing the page starts a fresh game');

  // Switch to Unicorn Meadow from the menu
  await t.menu();
  await page.getByRole('button', { name: /Other Games/ }).click();
  await t.shot('06-switch');
  await page.locator('.switch-item').first().click();
  await t.loaded();
  await page.waitForTimeout(700);
  await t.shot('07-meadow-title');
  await t.frame().locator('#playBtn').click({ force: true }); // it pulses forever
  await page.waitForTimeout(1500);
  await t.shot('08-meadow-playing');

  // Start over
  await t.menu();
  await page.getByRole('button', { name: /Start Over/ }).click();
  await t.shot('09-confirm');
  await page.getByRole('button', { name: 'Start over' }).click();
  await t.loaded();
  check(await t.frame().locator('#titleScreen').isVisible(), 'start over reloads the game fresh');

  // Switch player from the in-game menu lands on the picker (and stays there)
  await t.menu();
  await page.getByRole('button', { name: /Switch Player/ }).click();
  await page.waitForTimeout(500);
  check(await page.locator('#players').isVisible(), 'Switch Player shows the player picker');
  await page.locator('.player-btn').nth(1).click();
  await page.locator('#home').waitFor();
  check(/Alana/.test(await page.locator('#player-chip').innerText()), 'picking another player switches the header chip');

  check(t.errors.length === 0, `no page errors${t.errors.length ? ': ' + t.errors.join(' | ') : ''}`);
  await t.ctx.close();
}

async function unicornPass(browser, vp) {
  const t = await openContext(browser, vp);
  const { page } = t;
  await t.home();
  await t.launch(2);
  await t.shot('12-fotu-title');
  const g = () => t.gameFrame();
  const fill = await g().evaluate(() => {
    const r = document.getElementById('c').getBoundingClientRect();
    return r.width === innerWidth && r.height === innerHeight;
  });
  check(fill, 'flight: canvas fills the screen');
  // Real finger taps on phone/iPad sizes, mouse clicks on desktop
  const tap = (x, y) => (vp.mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tapEl = async (loc) => { const b = await loc.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
  const fotu = () => g().evaluate(() => ({ state: window.__fotu.state, flaps: window.__fotu.flaps }));
  await tap(vp.width / 2, vp.height * 0.4);
  await page.waitForTimeout(100);
  let s = await fotu();
  check(s.state === 'play' && s.flaps === 1, `flight: one ${vp.mobile ? 'tap' : 'click'} starts the game with exactly one flap (${s.state}, ${s.flaps} flaps)`);
  // Keep flapping for a bit so there is something to see
  let live = 1;
  for (let i = 0; i < 8; i++) {
    if ((await fotu()).state !== 'play') break;   // bumped a cloud early: fine
    await tap(vp.width / 2, vp.height / 2); live++;
    await page.waitForTimeout(280);
  }
  s = await fotu();
  check(s.flaps === live, `flight: every tap flaps once (${s.flaps}/${live})`);
  await t.shot('13-fotu-playing');
  // Stop tapping: the unicorn floats down and the run ends
  await page.waitForFunction(() => {
    const f = [...document.querySelectorAll('iframe')][0];
    return f && f.contentWindow.__fotu && f.contentWindow.__fotu.state === 'over';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await t.shot('14-fotu-over');
  const card = await g().evaluate(() => {
    const r = document.querySelector('#over .card').getBoundingClientRect();
    return { ok: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, h: Math.round(r.height), vh: innerHeight };
  });
  check(card.ok, `flight: game-over card fits on screen (${card.h}px in ${card.vh}px)`);
  await tapEl(t.frame().locator('#again'));
  await page.waitForTimeout(100);
  check((await fotu()).state === 'ready', 'flight: Fly again goes straight back to ready');
  await tap(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(100);
  check((await fotu()).state === 'play', 'flight: tapping again starts the next run');
  check(t.errors.length === 0, `no page errors${t.errors.length ? ': ' + t.errors.join(' | ') : ''}`);
  await t.ctx.close();
}

async function mazePass(browser, vp) {
  const t = await openContext(browser, vp);
  const { page } = t;
  await t.home();
  await t.launch(3);
  await page.waitForTimeout(500);
  await t.shot('15-maze-title');
  const g = () => t.gameFrame();
  const mz = () => g().evaluate(() => ({ ...window.__maze, uni: window.__maze.uni }));
  const tap = (x, y) => (vp.mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tapEl = async (loc) => { const b = await loc.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };

  // Pick a food on the title screen
  await tapEl(t.frame().locator('#foodBtn'));
  await page.waitForTimeout(400);
  await tapEl(t.frame().locator('.food[data-food="sushi"]'));
  await t.shot('15b-maze-food');
  const fp = await g().evaluate(() => {
    const r = document.getElementById('foodCard').getBoundingClientRect();
    return { ok: r.top >= -1 && r.bottom <= innerHeight + 1, h: Math.round(r.height), vh: innerHeight };
  });
  check(fp.ok, `maze: food picker fits on screen (${fp.h}px in ${fp.vh}px)`);
  await tapEl(t.frame().locator('#foodDone'));
  await page.waitForTimeout(400);
  check((await mz()).food === 'sushi' && (await mz()).state === 'title', 'maze: picking sushi works and stays on the title screen');

  await tapEl(t.frame().locator('#play'));
  await page.waitForTimeout(300);
  let m = await mz();
  check(m.state === 'play' && m.level === 1 && m.hearts === 3, `maze: Play starts level 1 with 3 hearts (${m.state})`);
  const start = m.uni;
  // Kids tap toward where they want to go, often at a slant. A tap that mostly
  // points at a wall must still move the unicorn along the open way nearest to it.
  {
    const dirs = await g().evaluate(() => window.__maze._openDirs());
    const at = await g().evaluate(() => window.__maze._uniScreen());
    const V = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
    // Start corner: down (bottom wall) is blocked; pair it with an open sideways way
    const side = dirs.includes('L') ? 'L' : null;
    const main = side ? 'D' : 'R';
    const perp = side || 'U';
    const tx = at.x + V[main][0] * 45 + V[perp][0] * 15, ty = at.y + V[main][1] * 45 + V[perp][1] * 15;
    await tap(tx, ty);
    await page.waitForTimeout(600);
    const after = (await mz()).uni;
    check(after.x !== start.x || after.y !== start.y,
      `maze: a slanted tap toward a wall (${main}, open: ${dirs.join('')}) still moves the unicorn (${start.x},${start.y} -> ${after.x.toFixed(1)},${after.y.toFixed(1)})`);
  }
  // Tap above, then left of the unicorn: the start corner always opens one of those ways
  await tap(vp.width * 0.97, vp.height * 0.08);
  await page.waitForTimeout(700);
  await tap(vp.width * 0.03, vp.height * 0.97);
  await page.waitForTimeout(700);
  m = await mz();
  check(m.uni.x !== start.x || m.uni.y !== start.y, `maze: tapping moves the unicorn (${start.x},${start.y} -> ${m.uni.x.toFixed(1)},${m.uni.y.toFixed(1)})`);
  // The taps above can walk the unicorn right out of an easy maze; start the level fresh
  await g().evaluate(() => window.__maze._restart());
  await page.waitForTimeout(6000);   // let a couple of ghosts out for the screenshot
  await t.shot('16-maze-playing');
  const fits = await g().evaluate(() => {
    const c = document.getElementById('c').getBoundingClientRect();
    return c.width === innerWidth && c.height === innerHeight;
  });
  check(fits, 'maze: canvas fills the screen');

  // If the wandering unicorn bumped into a present, open it and carry on
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      const st = (await mz()).state;
      if (st === 'present') {
        await tapEl(t.frame().locator('#presentBox')); await page.waitForTimeout(400);
        await tapEl(t.frame().locator('#prizeOk')); await page.waitForTimeout(400);
      } else if (st === 'place') {
        const c = await g().evaluate(() => window.__maze._cellScreen(0, 0));
        await tap(c.x, c.y); await page.waitForTimeout(300);
      } else return;
    }
  };
  await settle();

  // Ghost bumps cost a heart; three bumps -> try again
  const h0 = (await mz()).hearts;   // a present may have added one
  await g().evaluate(() => window.__maze._hit());
  check((await mz()).hearts === h0 - 1, `maze: a ghost bump costs one heart (${h0} -> ${(await mz()).hearts}, state ${(await mz()).state})`);
  await g().evaluate(() => { for (let i = 0; i < 6 && window.__maze.hearts > 0; i++) window.__maze._hit(); });
  await t.frame().locator('#lost:not(.hidden)').waitFor({ timeout: 3000 });
  await page.waitForTimeout(500);
  await t.shot('17-maze-lost');
  await tapEl(t.frame().locator('#retry'));
  await page.waitForTimeout(300);
  m = await mz();
  check(m.state === 'play' && m.hearts === 3 && m.level === 1, 'maze: Try again restarts the level with full hearts');

  // Rainbow Power: grab one, then a ghost that touches the unicorn gets booped (no heart lost)
  check((await mz()).powers >= 2, 'maze: level has rainbow powers to grab');
  await page.waitForTimeout(3000);
  await g().evaluate(() => window.__maze._power());
  await page.waitForTimeout(150);
  check((await mz()).power > 0, 'maze: grabbing a rainbow power turns it on');
  await t.shot('17b-maze-power');
  await g().evaluate(() => window.__maze._ghostOnUnicorn());
  await page.waitForTimeout(300);
  m = await mz();
  check(m.boops === 1 && m.hearts === 3, `maze: powered-up unicorn boops a ghost instead of losing a heart (boops ${m.boops}, hearts ${m.hearts})`);

  // Presents in the maze: a treasure you place, and a helper
  check((await mz()).presents >= 2, 'maze: level has presents to find');
  await g().evaluate(() => window.__maze._present('deco'));
  await t.frame().locator('#presentPop:not(.hidden)').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  await tapEl(t.frame().locator('#presentBox'));
  await page.waitForTimeout(500);
  await t.shot('17c-maze-present');
  await tapEl(t.frame().locator('#prizeOk'));
  await page.waitForTimeout(400);
  check((await mz()).state === 'place', 'maze: a treasure asks where to put it');
  const spot = await g().evaluate(() => window.__maze._cellScreen(0, 1));
  await tap(spot.x, spot.y);
  await page.waitForTimeout(300);
  m = await mz();
  check(m.state === 'play' && m.decorations === 1, `maze: tapping the maze puts the treasure there (${m.state}, ${m.decorations})`);
  await t.shot('17d-maze-placed');
  const heartsBefore = m.hearts;
  await g().evaluate(() => window.__maze._present('heart'));
  await t.frame().locator('#presentPop:not(.hidden)').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  await tapEl(t.frame().locator('#presentBox'));
  await page.waitForTimeout(400);
  await tapEl(t.frame().locator('#prizeOk'));
  await page.waitForTimeout(300);
  m = await mz();
  check(m.state === 'play' && m.hearts === heartsBefore + 1, `maze: a heart present adds a heart (${heartsBefore} -> ${m.hearts})`);

  // Escape -> present -> pick a unicorn -> level 2 in that colour
  await g().evaluate(() => window.__maze._toExit());
  await t.frame().locator('#surprise:not(.hidden)').waitFor({ timeout: 5000 });
  await page.waitForTimeout(600);
  await t.shot('18-maze-gift');
  await tapEl(t.frame().locator('#gift'));
  await page.waitForTimeout(500);
  await t.shot('19-maze-picker');
  const pick = await g().evaluate(() => {
    const r = document.getElementById('picker').getBoundingClientRect();
    return { ok: r.top >= -1 && r.bottom <= innerHeight + 1, h: Math.round(r.height), vh: innerHeight, n: document.querySelectorAll('.swatch').length };
  });
  check(pick.ok && pick.n === 11, `maze: unicorn picker shows 11 colours and fits (${pick.h}px in ${pick.vh}px)`);
  await tapEl(t.frame().locator('.swatch[data-skin="black"]'));
  await page.waitForTimeout(2600);
  m = await mz();
  check(m.state === 'play' && m.level === 2 && m.skin === 'black', `maze: picking a colour starts level 2 as that unicorn (${m.level}, ${m.skin})`);
  await t.shot('20-maze-level2');
  check(t.errors.length === 0, `no page errors${t.errors.length ? ': ' + t.errors.join(' | ') : ''}`);
  await t.ctx.close();
}

async function savesPass(browser, vp) {
  const t = await openContext(browser, vp, { forceSaves: true });
  const { page } = t;
  await t.home();
  await t.launch(0);
  await t.frame().locator('#b-start').click();
  await page.waitForTimeout(1500);
  await t.menu();
  await page.getByRole('button', { name: /Save/ }).first().click();
  await t.shot('10-save-slots');
  await page.locator('.slot-main').first().click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sga:saves:')));
  check(saved.length > 0, `save written (${saved.join(', ')})`);
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.waitForTimeout(400);
  await t.shot('11-home-continue');
  check(/Continue/.test(await page.locator('.game-card').nth(0).innerText()), 'home shows Continue when saves are on');

  await t.launch(0);
  check(await t.frame().locator('#ov-resume').isVisible(), 'Continue restores the run');
  await t.menu();
  await page.getByRole('button', { name: /Load/ }).first().click();
  await page.locator('.slot-main:not([disabled])').first().click();
  await page.getByRole('button', { name: 'Load it' }).click();
  await t.loaded();
  check(await t.frame().locator('#ov-resume').isVisible(), 'loading Save 1 restores the run');

  // Meadow (WebGL) thumbnail
  await t.menu();
  await page.getByRole('button', { name: /Other Games/ }).click();
  await page.locator('.switch-item').first().click();
  await t.loaded();
  await t.frame().locator('#playBtn').click({ force: true });
  await page.waitForTimeout(1500);
  await t.menu();
  await page.getByRole('button', { name: /Save/ }).first().click();
  await page.locator('.slot-main').first().click();
  await page.waitForTimeout(300);
  const thumb = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('unicorn-meadow'));
    return k ? (JSON.parse(localStorage.getItem(k)).slots[0] || {}).thumb : null;
  });
  check(!!thumb && thumb.length > 2000, `meadow save has a real thumbnail (${thumb ? thumb.length : 0} chars)`);

  check(t.errors.length === 0, `no page errors${t.errors.length ? ': ' + t.errors.join(' | ') : ''}`);
  await t.ctx.close();
}

await fs.mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

try {
  for (const vp of VIEWPORTS) {
    console.log(`\n▶ ${vp.name} (${vp.width}x${vp.height})`);
    await freshPass(browser, vp);
    console.log('  ↳ Flight of the Unicorn');
    await unicornPass(browser, vp);
    console.log("  ↳ Cece's Unicorn Maze");
    await mazePass(browser, vp);
    if (vp.savesPass) {
      console.log('  ↳ with saves turned on');
      await savesPass(browser, vp);
    }
  }
} catch (e) {
  failures.push(`crashed: ${e.message.split('\n')[0]}`);
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
console.log(`Screenshots: ${OUT}`);
process.exit(failures.length ? 1 : 0);
