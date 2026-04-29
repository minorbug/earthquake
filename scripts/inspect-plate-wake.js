#!/usr/bin/env bun
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const lines = [];
page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => lines.push(`[err] ${e.message}`));

await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
// Disable magma fluid + core so the wakes are unambiguously visible
await page.evaluate(() => {
    const cur = JSON.parse(localStorage.getItem('eq-atlas-tuning') || '{}');
    Object.assign(cur, {
        fluidEnabled: false,
        coreEnabled: false,
        coreIntensity: 0,
        boundaryWidth: 4,
    });
    localStorage.setItem('eq-atlas-tuning', JSON.stringify(cur));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

await page.screenshot({ path: '/tmp/eqdev/wake-t0.png' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/eqdev/wake-t2.png' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/eqdev/wake-t4.png' });

console.log('--- console ---');
for (const l of lines) console.log(l);
await browser.close();
