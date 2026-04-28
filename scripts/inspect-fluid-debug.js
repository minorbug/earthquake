#!/usr/bin/env bun
// scripts/inspect-fluid-debug.js — debug-visualize the heightfield as colour
// (red=high, blue=low) on the undisplaced sphere, so we can see the actual
// simulation output without geometry distortion confusing the picture.
import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';
const OUT = '/tmp/eqdev';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[err] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const initInfo = await page.evaluate(() => {
    const d = window.__eqFluidDebug;
    if (!d) return { ok: false, reason: 'no __eqFluidDebug' };
    return { ok: true, materialKeys: Object.keys(d.material), kernelKeys: Object.keys(d.kernel) };
});
console.log('init:', JSON.stringify(initInfo));

await page.evaluate(() => {
    const d = window.__eqFluidDebug;
    if (!d) return;
    if (d.material.displacementScale) d.material.displacementScale.value = 0;
    if (d.material.debugHeight) d.material.debugHeight.value = 1.0;
    for (let i = 0; i < 4; i++) d.spawnHotspot();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/fluid-debug-heightmap.png` });

await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/fluid-debug-heightmap-later.png` });

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
