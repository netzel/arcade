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
