#!/usr/bin/env bun
// scripts/inspect-fluid-zero.js — render the fluid core with displacement
// fully disabled, to confirm the underlying sphere geometry is correct.
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

// Force displacement to 0 — pure FBM sphere, no heightfield bumps.
await page.evaluate(() => {
    if (window.__eqFluidDebug) {
        window.__eqFluidDebug.material.displacementScale.value = 0;
    }
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/fluid-zero-displacement.png` });

// Also try a SMALL displacement so we can see if mild bumps look reasonable.
await page.evaluate(() => {
    if (window.__eqFluidDebug) {
        window.__eqFluidDebug.material.displacementScale.value = 80;
        for (let i = 0; i < 6; i++) window.__eqFluidDebug.spawnHotspot();
    }
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/fluid-mild-displacement.png` });

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
