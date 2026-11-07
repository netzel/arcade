// One-off: render public/icons/icon.svg to the PNG sizes iOS/Android need.
// Run with: node scripts/make-icons.mjs   (needs the playwright dev dependency)
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const svg = await fs.readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const page = await browser.newPage();
for (const [size, name, inset] of [[180, 'apple-touch-icon.png', false], [192, 'icon-192.png', false], [512, 'icon-512.png', false]]) {
  await page.setViewportSize({ width: size, height: size });
  // apple-touch-icon must be square with no transparency (iOS rounds it itself)
  const body = svg.replace('rx="112"', name === 'apple-touch-icon.png' ? 'rx="0"' : 'rx="112"');
  await page.setContent(`<html><body style="margin:0;background:${inset ? '#160c33' : 'transparent'}">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: name !== 'apple-touch-icon.png' });
  console.log('wrote', name);
}
await browser.close();
