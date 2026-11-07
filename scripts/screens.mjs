// End-to-end smoke test + screenshots at phone / iPad / desktop sizes.
//   npm run screens         (builds first; uses your installed Chrome)
// Screenshots land in screenshots/ (gitignored). Exits non-zero on failure.
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
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
  { name: 'ipad-portrait', width: 820, height: 1180, mobile: true },
  { name: 'ipad-landscape', width: 1180, height: 820, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

const failures = [];
function check(cond, msg) { if (!cond) { failures.push(msg); console.log(`   ✗ ${msg}`); } else console.log(`   ✓ ${msg}`); }

await fs.mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

try {
  for (const vp of VIEWPORTS) {
    console.log(`\n▶ ${vp.name} (${vp.width}x${vp.height})`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const shot = (n) => page.screenshot({ path: path.join(OUT, `${vp.name}-${n}.png`) });
    const frame = () => page.frameLocator('#game-frame');
    const gameFrame = () => page.frames().find((f) => f.url().includes('/games/'));

    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.body.dataset.screen);
    // Player picker (profiles are on when PUBLIC_PLAYERS is set)
    if (await page.locator('#players').isVisible()) {
      await shot('01-players');
      await page.locator('.player-btn').first().click();
    }
    await page.locator('#home').waitFor();
    await page.waitForTimeout(500);
    await shot('02-home');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `home has no sideways scroll (overflow ${overflow}px)`);

    // ── Midnight Walk ──
    await page.locator('.game-card').nth(0).locator('.btn-primary').click();
    await page.locator('#loading.done').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    if (await page.locator('#rotate-hint').isVisible()) {
      await shot('03-rotate-hint');
      await page.locator('#rotate-dismiss').click();
    }
    await shot('03-midnight-title');
    await frame().locator('#b-start').click();
    await page.waitForTimeout(1500);
    await shot('04-midnight-playing');
    const fit = await gameFrame().evaluate(() => {
      const r = document.getElementById('gc').getBoundingClientRect();
      return { bottom: r.bottom, right: r.right, vh: innerHeight, vw: innerWidth };
    });
    check(fit.bottom <= fit.vh + 1 && fit.right <= fit.vw + 1, `midnight canvas fits on screen (${Math.round(fit.right)}x${Math.round(fit.bottom)} in ${fit.vw}x${fit.vh})`);

    await page.locator('#menu-fab').click();
    await page.waitForTimeout(400);
    await shot('05-pause-menu');
    const t1 = await gameFrame().evaluate(() => performance.now());
    await page.waitForTimeout(400);
    const t2 = await gameFrame().evaluate(() => performance.now());
    check(t1 === t2, 'game clock is frozen while the menu is open');

    await page.getByRole('button', { name: /Save/ }).first().click();
    await shot('06-save-slots');
    await page.locator('.slot-main').first().click();
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sga:saves:')));
    check(saved.length > 0, `save written (${saved.join(', ')})`);
    await page.getByRole('button', { name: /Arcade/ }).click();
    await page.locator('#home').waitFor();
    await page.waitForTimeout(500);
    await shot('07-home-continue');
    check(await page.locator('.game-card').nth(0).getByText('Continue').count() > 0, 'home shows Continue after leaving a game');

    // Continue → resume overlay
    await page.locator('.game-card').nth(0).locator('.btn-primary').click();
    await page.locator('#loading.done').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    check(await frame().locator('#ov-resume').isVisible(), 'continue restores the run (Welcome back screen)');
    await shot('08-midnight-resumed');

    // Load from slot via menu
    await page.locator('#menu-fab').click();
    await page.getByRole('button', { name: /Load/ }).first().click();
    await shot('09-load-slots');
    await page.locator('.slot-main:not([disabled])').first().click();
    await page.getByRole('button', { name: 'Load it' }).click();
    await page.locator('#loading.done').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    check(await frame().locator('#ov-resume').isVisible(), 'loading Save 1 restores the run');

    // Switch to Unicorn Meadow from the menu
    await page.locator('#menu-fab').click();
    await page.getByRole('button', { name: /Other Games/ }).click();
    await shot('10-switch');
    await page.locator('.switch-item').first().click();
    await page.locator('#loading.done').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot('11-meadow-title');
    await frame().locator('#playBtn').click({ force: true }); // it pulses forever
    await page.waitForTimeout(1500);
    await shot('12-meadow-playing');
    await page.locator('#menu-fab').click();
    await page.getByRole('button', { name: /Save/ }).first().click();
    await page.locator('.slot-main').first().click();
    await page.waitForTimeout(300);
    const thumb = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes('unicorn-meadow'));
      return k ? (JSON.parse(localStorage.getItem(k)).slots[0] || {}).thumb : null;
    });
    check(!!thumb && thumb.length > 2000, `meadow save has a real thumbnail (${thumb ? thumb.length : 0} chars)`);

    // Start over
    await page.getByRole('button', { name: /Start Over/ }).click();
    await shot('13-confirm');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.locator('#loading.done').waitFor({ timeout: 20000 });
    check(await frame().locator('#titleScreen').isVisible(), 'start over reloads the game fresh');

    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
console.log(`Screenshots: ${OUT}`);
process.exit(failures.length ? 1 : 0);
