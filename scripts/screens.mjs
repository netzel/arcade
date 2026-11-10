// End-to-end smoke test + screenshots at phone / iPad / desktop sizes.
//   npm run screens         (builds first; uses your installed Chrome)
// Screenshots land in screenshots/ (gitignored). Exits non-zero on failure.
//
// Two passes:
//   1. "fresh"  — games as configured (saves off): every launch starts fresh.
//   2. "saves"  — saves forced ON for the test only, to keep the save/load
//                 path covered for future games that opt in.
import { chromium, webkit } from 'playwright';
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
    // Games are their own page now (no iframe): the page is the game.
    frame: () => page,
    gameFrame: () => page.mainFrame(),
    origin: 0,
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
    // Wait for a NEW game page (navigation or reload) with its menu mounted.
    async loaded() {
      const until = Date.now() + 20000;
      for (;;) {
        const o = await page.evaluate(() => (location.pathname.startsWith('/games/') && window.ArcadeBridge && document.getElementById('sga-chrome')
          && document.readyState === 'complete' ? performance.timeOrigin : 0)).catch(() => 0);
        if (o && o !== t.origin) { t.origin = o; break; }
        if (Date.now() > until) throw new Error('game page did not load');
        await page.waitForTimeout(100);
      }
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
  const fotu = () => g().evaluate(() => ({ state: window.__fotu.state, flaps: window.__fotu.flaps, toots: window.__fotu.toots, magic: window.__fotu.magic }));

  // Colors & Magic closet: with a big star jar, pick Glitter Toots
  await g().evaluate(() => window.__fotu._stars(1300));
  check(await t.frame().locator('#newBadge').isVisible(), 'flight: a NEW! badge shows when something is unlocked');
  await tapEl(t.frame().locator('#closetBtn'));
  await page.waitForTimeout(500);
  await t.shot('12b-fotu-closet');
  const closet = await g().evaluate(() => {
    const r = document.querySelector('#closet .card').getBoundingClientRect();
    return { ok: r.top >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, h: Math.round(r.height), vh: innerHeight,
      colors: document.querySelectorAll('#skins .skin').length, magic: document.querySelectorAll('#magics .skin').length,
      locked: document.querySelectorAll('#closet .skin.locked').length };
  });
  check(closet.ok, `flight: closet fits on screen (${closet.h}px in ${closet.vh}px)`);
  check(closet.colors === 10 && closet.magic === 7 && closet.locked === 2, `flight: closet shows 10 colors + 7 magic, 2 still locked at 1300 stars (${closet.colors}/${closet.magic}/${closet.locked})`);
  await t.frame().locator('#magics .skin[data-id="toots"]').scrollIntoViewIfNeeded();
  await tapEl(t.frame().locator('#magics .skin[data-id="toots"]'));
  await page.waitForTimeout(200);
  check((await fotu()).magic === 'toots', 'flight: picking Glitter Toots selects it');
  check((await fotu()).state === 'title', 'flight: tapping in the closet does not start the game');
  await tapEl(t.frame().locator('#closetDone'));
  await page.waitForTimeout(500);
  check(!(await t.frame().locator('#newBadge').isVisible()), 'flight: NEW! badge clears after visiting the closet');

  await tap(vp.width / 2, vp.height * 0.4);
  await page.waitForTimeout(100);
  let s = await fotu();
  check(s.state === 'play' && s.flaps === 1, `flight: one ${vp.mobile ? 'tap' : 'click'} starts the game with exactly one flap (${s.state}, ${s.flaps} flaps)`);
  check(s.toots === 1, `flight: Glitter Toots toots once per tap (${s.toots})`);
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
    return window.__fotu && window.__fotu.state === 'over';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await t.shot('14-fotu-over');
  const card = await g().evaluate(() => {
    const r = document.querySelector('#over .card').getBoundingClientRect();
    return { ok: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1, h: Math.round(r.height), vh: innerHeight };
  });
  check(card.ok, `flight: game-over card fits on screen (${card.h}px in ${card.vh}px)`);
  // Fly again only becomes tappable after 0.6 s of game time (slow test browsers can lag behind)
  await page.waitForFunction(() => document.getElementById('over').classList.contains('armed'), null, { timeout: 5000 });
  await tapEl(t.frame().locator('#again'));
  await page.waitForTimeout(100);
  check((await fotu()).state === 'ready', 'flight: Fly again goes straight back to ready');
  await tap(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(100);
  check((await fotu()).state === 'play', 'flight: tapping again starts the next run');

  // Difficulty: Easy gives 3 hearts and a bump doesn't end the run
  const lv = () => g().evaluate(() => ({ state: window.__fotu.state, level: window.__fotu.level, hearts: window.__fotu.hearts }));
  check((await lv()).level === 'normal', 'flight: Normal is the default level');
  await page.waitForFunction(() => {
    return window.__fotu && window.__fotu.state === 'over';
  }, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.waitForFunction(() => document.getElementById('over').classList.contains('armed'), null, { timeout: 5000 });
  await tapEl(t.frame().locator('#toTitle'));
  await page.waitForTimeout(500);
  await tapEl(t.frame().locator('#closetDone'));
  await page.waitForTimeout(500);
  await tapEl(t.frame().locator('.lvl[data-level="easy"]'));
  await page.waitForTimeout(200);
  let l = await lv();
  check(l.level === 'easy' && l.state === 'title', `flight: tapping Easy picks it without starting (${l.level}, ${l.state})`);
  await t.shot('12c-fotu-levels');
  const tb = await g().evaluate(() => { const r = document.querySelector('.title-bottom').getBoundingClientRect(); return { ok: r.bottom <= innerHeight + 1 && r.top >= 0, b: Math.round(r.bottom), vh: innerHeight }; });
  check(tb.ok, `flight: title controls fit on screen (${tb.b} in ${tb.vh})`);
  await tap(vp.width / 2, vp.height * 0.3);
  await page.waitForTimeout(100);
  l = await lv();
  check(l.state === 'play' && l.hearts === 3, `flight: Easy starts with 3 hearts (${l.state}, ${l.hearts})`);
  await g().evaluate(() => window.__fotu._hit());
  await page.waitForTimeout(100);
  l = await lv();
  check(l.state === 'play' && l.hearts === 2, `flight: on Easy a bump costs a heart and keeps flying (${l.state}, ${l.hearts})`);
  await t.shot('13b-fotu-easy-hearts');
  await page.reload();
  await t.loaded();
  check((await lv()).level === 'easy', 'flight: the picked level is remembered');

  // Taps must reach the game directly: no iframe, and the menu button's taps stay out of the game
  check(await page.evaluate(() => window.top === window && !document.querySelector('iframe')), 'flight: the game is the top-level page (no iframe)');
  const fab = await page.locator('#menu-fab').boundingBox();
  await tap(fab.x + fab.width / 2, fab.y + fab.height / 2);
  await page.waitForTimeout(400);
  check((await lv()).state === 'title' && await page.getByRole('button', { name: /Keep Playing/ }).isVisible(), 'flight: tapping ⏸ opens the menu without starting the game');
  await tapEl(page.getByRole('button', { name: /Keep Playing/ }));
  await page.waitForTimeout(400);
  check((await lv()).state === 'title', 'flight: Keep Playing closes the menu without starting the game');
  // Leave for the arcade, come back with Back, and taps still work
  await page.locator('#menu-fab').click();
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.goBack();
  await t.loaded().catch(() => {});      // a back/forward-cache restore keeps the old page
  await page.waitForTimeout(500);
  const keep = page.getByRole('button', { name: /Keep Playing/ });
  if (await keep.isVisible()) { await tapEl(keep); await page.waitForTimeout(400); }
  await tap(vp.width / 2, vp.height * 0.3);
  await page.waitForTimeout(150);
  check((await lv()).state === 'play', `flight: after Back to the game, a tap still flies (${(await lv()).state})`);
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

// iPhones and iPads sometimes refuse sound: Safari caps how many audio
// contexts a page may hold, and an interrupted/closed context can throw when
// a game makes a sound. A sound failure must never stop taps or the game loop.
const BREAK_AUDIO = (mode) => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (mode === 'ctor') {
    const Broken = function () { throw new Error('test: too many AudioContexts'); };
    window.AudioContext = Broken; window.webkitAudioContext = Broken;
  } else {
    for (const m of ['createOscillator', 'createGain', 'createBufferSource', 'createBiquadFilter']) {
      AC.prototype[m] = function () { throw new Error('test: audio context is closed'); };
    }
  }
};

async function brokenAudioPass(browser, vp, mode) {
  const t = await openContext(browser, vp);
  await t.ctx.addInitScript(BREAK_AUDIO, mode);
  const { page } = t;
  const tap = (x, y) => (vp.mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tapEl = async (loc) => { const b = await loc.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
  await t.home();

  await t.launch(2);
  const fotu = () => t.gameFrame().evaluate(() => ({ state: window.__fotu.state, flaps: window.__fotu.flaps, frames: window.__fotu.frames }));
  await tap(vp.width / 2, vp.height * 0.4);
  await page.waitForTimeout(150);
  await tap(vp.width / 2, vp.height * 0.4);
  await page.waitForTimeout(150);
  let s = await fotu();
  check(s.state === 'play' && s.flaps === 2, `no-sound(${mode}) flight: taps still start and flap (${s.state}, ${s.flaps} flaps)`);
  const f0 = s.frames;
  await page.waitForTimeout(500);
  s = await fotu();
  check(s.frames > f0, `no-sound(${mode}) flight: game keeps animating (${f0} -> ${s.frames} frames)`);

  await page.goto(BASE + '/');
  await page.locator('#home').waitFor();
  await t.launch(3);
  const mz = () => t.gameFrame().evaluate(() => ({ state: window.__maze.state, uni: window.__maze.uni, frames: window.__maze.frames }));
  await tapEl(t.frame().locator('#play'));
  await page.waitForTimeout(300);
  let m = await mz();
  check(m.state === 'play', `no-sound(${mode}) maze: Play starts the game (${m.state})`);
  await tap(vp.width * 0.97, vp.height * 0.08);
  await page.waitForTimeout(700);
  await tap(vp.width * 0.03, vp.height * 0.97);
  await page.waitForTimeout(700);
  const m2 = await mz();
  check(m2.uni.x !== m.uni.x || m2.uni.y !== m.uni.y, `no-sound(${mode}) maze: taps still move the unicorn`);
  check(m2.frames > m.frames, `no-sound(${mode}) maze: game keeps animating (${m.frames} -> ${m2.frames} frames)`);
  // Sparklehorn: title, difficulty, magic and the frame loop all work without sound
  await page.goto(BASE + '/');
  await page.locator('#home').waitFor();
  await t.launch(SPK_CARD);
  await tapEl(page.locator('#play')); await page.waitForTimeout(250);
  await tapEl(page.locator('#easy')); await page.waitForTimeout(250);
  await tap(vp.width * 0.3, vp.height * 0.5); await page.waitForTimeout(200);
  const L = await page.evaluate(() => window.__spk.layout());
  await tap(L.magic.x, L.magic.y); await page.waitForTimeout(200);
  const k0 = await page.evaluate(() => ({ mode: window.__spk.state.mode, bolts: window.__spk.bolts, frames: window.__spk.frames }));
  await page.waitForTimeout(400);
  const k1 = await page.evaluate(() => window.__spk.frames);
  check(k0.mode === 'play' && k0.bolts > 0, `no-sound(${mode}) sparkle: taps start the game and fire magic (${k0.mode}, ${k0.bolts} bolts)`);
  check(k1 > k0.frames, `no-sound(${mode}) sparkle: game keeps animating`);
  check(t.errors.length === 0, `no-sound(${mode}): no uncaught errors${t.errors.length ? ': ' + [...new Set(t.errors)].slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();
}

// Opening and closing the menu very quickly must never leave the game frozen.
async function pauseRacePass(browser, vp) {
  const t = await openContext(browser, vp);
  const { page } = t;
  await t.home();
  await t.launch(2);
  const stuck = await t.gameFrame().evaluate(async () => {
    window.ArcadeBridge.pause();
    window.ArcadeBridge.resume();
    await new Promise((r) => setTimeout(r, 400));
    return window.ArcadeBridge.isPaused();
  });
  check(!stuck, 'bridge: a pause cancelled within the same frame does not freeze the game');
  await t.ctx.close();
}

// ── Sparklehorn Adventure: taps must always work (spec §9) ────────────────
const SPK_CARD = 4;
async function sparklehornPass(browser, vp) {
  const webkitEngine = process.env.PW_ENGINE === 'webkit';
  const t = await openContext(browser, vp);
  const { page } = t;
  const tap = (x, y) => (vp.mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tapEl = async (loc) => { const b = await loc.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
  const spk = () => page.evaluate(() => {
    const s = window.__spk;
    return { mode: s.state.mode, map: s.state.map, x: s.state.x, y: s.state.y, bolts: s.bolts, frames: s.frames, errors: s.errors, inputs: s.inputs };
  });
  const layout = () => page.evaluate(() => window.__spk.layout());
  const tapMagic = async () => { const L = await layout(); await tap(L.magic.x, L.magic.y); await page.waitForTimeout(120); };
  const quiet = () => page.evaluate(() => { window.__spk._clearEnemies(); window.__spk._teleport('meadow', 24, 16); });
  const cdp = !webkitEngine && vp.mobile ? await page.context().newCDPSession(page) : null;
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

  await t.home();
  await t.launch(SPK_CARD);
  await t.shot('20-sparkle-title');

  // 1. First tap works
  await tapEl(page.locator('#play'));
  await page.waitForTimeout(300);
  await tapEl(page.locator('#easy'));
  await page.waitForTimeout(300);
  await tap(vp.width * 0.3, vp.height * 0.5); // skip the intro
  await page.waitForTimeout(200);
  check((await spk()).mode === 'play', `sparkle: one tap each on ▶, Easy and the intro starts the game (${(await spk()).mode})`);
  await quiet();

  // 3. Walking: a drag on the joystick (Chromium touch), a tap-to-walk (WebKit touch), arrow keys (desktop)
  let s0 = await spk();
  const L = await layout();
  const jx = L.joyZone.x + L.joyZone.w * 0.4, jy = L.joyZone.y + L.joyZone.h * 0.5;
  if (cdp) {
    await touch('touchStart', [{ x: jx, y: jy, id: 1 }]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: jx + i * 10, y: jy, id: 1 }]); await page.waitForTimeout(30); }
    await page.waitForTimeout(250);
  } else if (vp.mobile) {
    await tap(vp.width / 2 + 100, vp.height / 2);
    await page.waitForTimeout(600);
  } else {
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); await page.keyboard.up('ArrowRight');
  }
  let s1 = await spk();
  check(s1.x > s0.x + 10, `sparkle: walking moves the unicorn (${Math.round(s0.x)} -> ${Math.round(s1.x)})`);

  // 5. Multi-touch: still holding the joystick, tap Magic with a second finger
  if (cdp) {
    const b0 = s1.bolts, x0 = s1.x;
    await touch('touchStart', [{ x: jx + 60, y: jy, id: 1 }, { x: L.magic.x, y: L.magic.y, id: 2 }]);
    await page.waitForTimeout(80);
    await touch('touchEnd', [{ x: jx + 60, y: jy, id: 1 }]); // finger 2 lifts, finger 1 stays
    await page.waitForTimeout(250);
    const s2 = await spk();
    check(s2.bolts > b0 && s2.x > x0 + 5, `sparkle: walk + magic at the same time (bolts ${b0}->${s2.bolts}, moved ${Math.round(s2.x - x0)})`);
    check(s2.inputs.active === 1, `sparkle: lifting one finger leaves the other walking (${s2.inputs.active} active)`);
    // 6. No stuck input: blur while the joystick is held
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const sb = await spk();
    await page.waitForTimeout(300);
    const sc = await spk();
    check(sb.inputs.active === 0 && sb.inputs.lastReset === 'blur' && Math.abs(sc.x - sb.x) < 1, `sparkle: losing focus releases a held joystick (${sb.inputs.active} active, moved ${Math.round(sc.x - sb.x)})`);
    await touch('touchEnd', []);
    // Fingers held perfectly still (no move events) keep working: hold ✨ and the stick for 4 s
    await quiet();
    await touch('touchStart', [{ x: jx, y: jy, id: 3 }]);
    await touch('touchMove', [{ x: jx + 60, y: jy, id: 3 }]);
    await touch('touchStart', [{ x: jx + 60, y: jy, id: 3 }, { x: L.magic.x, y: L.magic.y, id: 4 }]);
    await page.waitForTimeout(3500);
    const h0 = await spk();
    await page.waitForTimeout(800);
    const h1 = await spk();
    await touch('touchEnd', []);
    check(h1.bolts > h0.bolts, `sparkle: holding ✨ still keeps firing after 4 s (${h0.bolts} -> ${h1.bolts})`);
    check(h1.x !== h0.x || h1.y !== h0.y || h1.inputs.active === 2, `sparkle: holding the stick still keeps walking after 4 s (${h1.inputs.active} fingers held)`);
    check(h1.inputs.active === 2, `sparkle: still-held fingers are not dropped (${h1.inputs.active} held)`);
  } else {
    if (vp.mobile) console.log('   – multi-touch check skipped on WebKit (no CDP); covered by the input unit tests');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const sb = await spk();
    await page.waitForTimeout(300);
    const sc = await spk();
    await page.keyboard.up('ArrowRight');
    check(Math.abs(sc.x - sb.x) < 1 && sb.inputs.lastReset === 'blur', `sparkle: losing focus stops a held key (moved ${Math.round(sc.x - sb.x)})`);
  }

  // 4. Magic fires
  let b = (await spk()).bolts;
  await tapMagic();
  check((await spk()).bolts > b, 'sparkle: tapping ✨ fires magic');
  await t.shot('21-sparkle-play');

  // 7. Rotation mid-play (phones and iPads)
  if (vp.mobile) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await page.waitForTimeout(500);
    if (await page.locator('#rotate-hint').isVisible()) await page.locator('#rotate-dismiss').click();
    const R = await layout();
    check(R.magic.x > vp.height / 2 && R.magic.y > vp.width / 2, 'sparkle: after rotating, ✨ sits in the bottom-right');
    b = (await spk()).bolts;
    await tap(R.magic.x, R.magic.y); await page.waitForTimeout(120);
    check((await spk()).bolts > b, 'sparkle: after rotating, ✨ still fires');
    await t.shot('22-sparkle-rotated');
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);
  }

  // 8 + 9. Pause menu: no Start Over, Save is there; taps work after Keep Playing
  await t.menu();
  await page.waitForTimeout(300);
  const tiles = (await t.tileNames()).join(' | ');
  check(!/Start Over/.test(tiles) && /Save/.test(tiles), `sparkle: menu has Save and no Start Over (${tiles.replace(/\n/g, ' ')})`);
  await page.getByRole('button', { name: /Keep Playing/ }).click();
  await page.waitForTimeout(300);
  b = (await spk()).bolts;
  await tapMagic();
  check((await spk()).bolts > b, 'sparkle: ✨ works after pause and Keep Playing');

  // 11. Continue restores where you were
  await page.evaluate(() => { window.__spk._clearEnemies(); window.__spk._teleport('pebble', 5, 11); });
  await t.menu();
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.waitForTimeout(400);
  check(/Continue/.test(await page.locator('.game-card').nth(SPK_CARD).innerText()), 'sparkle: home card offers Continue');
  await t.launch(SPK_CARD);
  check(await page.locator('#welcome').isVisible(), 'sparkle: Continue shows Welcome back');
  await tapEl(page.locator('#resume'));
  await page.waitForTimeout(300);
  let s = await spk();
  check(s.mode === 'play' && s.map === 'pebble', `sparkle: Continue puts you back in the cave (${s.mode}, ${s.map})`);

  // 10. Arcade → browser Back: taps still work, and the adventure is still there
  await t.menu();
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.waitForTimeout(300);
  await page.goBack();
  // A fresh (non-cached) Back reloads once more to pick up the Continue save: wait for where it lands.
  await page.waitForFunction(() => window.__spk && document.getElementById('sga-chrome') && ['welcome', 'play'].includes(window.__spk.state.mode), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  if (await page.locator('#rotate-hint').isVisible()) await page.locator('#rotate-dismiss').click();
  if (await page.locator('#welcome').isVisible()) await tapEl(page.locator('#resume'));
  await page.waitForTimeout(300);
  s = await spk();
  check(s.mode === 'play' && s.map === 'pebble', `sparkle: Back from the arcade returns to the adventure (${s.mode}, ${s.map})`);
  b = s.bolts;
  await tapMagic();
  check((await spk()).bolts > b, 'sparkle: ✨ works after Arcade → Back');

  // A reload (pull-to-refresh) mid-adventure must not lose it
  await page.reload();
  await page.waitForFunction(() => window.__spk && document.getElementById('sga-chrome') && ['welcome', 'play'].includes(window.__spk.state.mode), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (await page.locator('#rotate-hint').isVisible()) await page.locator('#rotate-dismiss').click();
  check(await page.locator('#welcome').isVisible(), 'sparkle: reloading the page comes back to Welcome back, not the title');
  await tapEl(page.locator('#resume'));
  await page.waitForTimeout(200);
  check((await spk()).map === 'pebble', 'sparkle: …and to the same place');

  // ✨ New from the home card really starts a new adventure
  await t.menu();
  await page.getByRole('button', { name: /Arcade/ }).click();
  await page.locator('#home').waitFor();
  await page.waitForTimeout(300);
  await page.locator('.game-card').nth(SPK_CARD).getByRole('button', { name: /New/ }).click();
  await page.getByRole('button', { name: 'Start new' }).click();
  await t.loaded();
  check(await page.locator('#play').isVisible(), 'sparkle: ✨ New opens the title screen for a fresh adventure');
  const kept = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('sga:saves:') && x.endsWith(':sparklehorn-adventure'));
    const rec = k ? JSON.parse(localStorage.getItem(k)) : null;
    return rec ? (rec.slots || []).some((sl) => sl && sl.state && sl.state.map === 'pebble') : false;
  });
  check(kept, 'sparkle: ✨ New tucks the old adventure into a save slot instead of losing it');
  await page.waitForTimeout(300);

  check(t.errors.length === 0, `sparkle: no page errors${t.errors.length ? ': ' + [...new Set(t.errors)].slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();

  // 2. Double-tap ▶: one difficulty screen, no errors
  const t2 = await openContext(browser, vp);
  const tap2 = (x, y) => (vp.mobile ? t2.page.touchscreen.tap(x, y) : t2.page.mouse.click(x, y));
  await t2.home();
  await t2.launch(SPK_CARD);
  const pb = await t2.page.locator('#play').boundingBox();
  await tap2(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await tap2(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await t2.page.waitForTimeout(400);
  const after = await t2.page.evaluate(() => ({ mode: window.__spk.state.mode, errors: window.__spk.errors, title: !document.getElementById('title').classList.contains('hidden') }));
  check(!after.title && ['choose', 'intro'].includes(after.mode) && after.errors === 0, `sparkle: double-tapping ▶ is safe (${after.mode})`);
  check(t2.errors.length === 0, 'sparkle: no page errors after a double-tap');
  await t2.ctx.close();
}

async function sparklehornBadSavePass(browser, vp) {
  const t = await openContext(browser, vp);
  const { page } = t;
  const tap = (x, y) => (vp.mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  await t.home();
  await page.evaluate(() => {
    const player = JSON.parse(localStorage.getItem('sga:settings') || '{}').player || '_';
    localStorage.setItem(`sga:saves:${player}:sparklehorn-adventure`, JSON.stringify({
      auto: { savedAt: new Date().toISOString(), version: 1, state: { v: 1, nonsense: true }, thumb: null }, slots: [null, null, null] }));
  });
  await page.reload();
  await page.locator('#home').waitFor();
  await t.launch(SPK_CARD);
  await page.waitForTimeout(500);
  check(await page.locator('#play').isVisible(), 'sparkle: a save that cannot be read shows the title, never a blank screen');
  const pb = await page.locator('#play').boundingBox();
  await tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.waitForTimeout(400);
  check(await page.locator('#easy').isVisible(), 'sparkle: …and ▶ works from there');
  await page.reload();
  await page.waitForFunction(() => window.__spk && document.getElementById('sga-chrome'));
  await page.waitForTimeout(1200);
  if (await page.locator('#rotate-hint').isVisible()) await page.locator('#rotate-dismiss').click();
  check(await page.locator('#play').isVisible(), 'sparkle: reloading with an unreadable save still shows the title');
  await t.ctx.close();
}

await fs.mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
// PW_ENGINE=webkit runs the same suite on WebKit (Safari's engine).
const browser = process.env.PW_ENGINE === 'webkit'
  ? await webkit.launch()
  : await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

try {
  console.log('\n▶ robustness');
  await pauseRacePass(browser, VIEWPORTS[0]);
  await brokenAudioPass(browser, VIEWPORTS[0], 'ctor');
  await brokenAudioPass(browser, VIEWPORTS[3], 'nodes');
  // ONLY_VP=desktop (or any viewport name) runs just that size.
  for (const vp of process.env.ONLY_ROBUST ? [] : VIEWPORTS.filter((v) => !process.env.ONLY_VP || v.name === process.env.ONLY_VP)) {
    console.log(`\n▶ ${vp.name} (${vp.width}x${vp.height})`);
    await freshPass(browser, vp);
    console.log('  ↳ Flight of the Unicorn');
    await unicornPass(browser, vp);
    console.log("  ↳ Cece's Unicorn Maze");
    await mazePass(browser, vp);
    console.log('  ↳ Sparklehorn Adventure');
    await sparklehornPass(browser, vp);
    if (vp.savesPass) await sparklehornBadSavePass(browser, vp);
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
