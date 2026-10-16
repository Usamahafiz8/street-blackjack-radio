// Mobile EMULATION check (Chrome pretending to be a phone). Not a substitute for real devices:
// it checks layout and the iPhone-specific UI logic (no software volume), and that play works.
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'D:\\radio\\docs\\results\\screens';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
for (const name of ['iPhone 13', 'Pixel 7']) {
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8088/');
  await page.waitForSelector('.station');
  await page.locator('#power').tap();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Playing live', null, { timeout: 15000 }).catch(() => {});
  const state = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    volumeSlider: !document.getElementById('volume-wrap').hidden,
    volumeNote: !document.getElementById('volume-note').hidden,
    stations: document.querySelectorAll('.station').length,
    horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    mediaSession: 'mediaSession' in navigator && !!navigator.mediaSession.metadata,
  }));
  await page.screenshot({ path: `${OUT}\\${name.replace(/\s/g, '-').toLowerCase()}.png` });
  await page.locator('#power').tap();
  results.push({ device: name, ...state });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
