#!/usr/bin/env bun
// scripts/inspect-volfluid.js — capture the volumetric magma fluid layer
// after a few seconds of sim, comparing default vs hot-spot-flooded states.
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
await page.waitForTimeout(2500);

await page.screenshot({ path: `${OUT}/volfluid-01-natural.png` });

await page.evaluate(() => {
    if (window.__eqVolDebug) {
        for (let i = 0; i < 8; i++) window.__eqVolDebug.spawnHotspot();
    }
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/volfluid-02-flooded.png` });

await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/volfluid-03-evolved.png` });

const state = await page.evaluate(() => ({
    hasDebug: !!window.__eqVolDebug,
    hotspots: window.__eqVolDebug ? window.__eqVolDebug.getHotspots().length : -1,
}));
console.log('state:', JSON.stringify(state));

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
