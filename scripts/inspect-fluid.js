#!/usr/bin/env bun
// scripts/inspect-fluid.js — capture the fluid magma core after a few
// seconds of simulation so hot spots have had a chance to fire.
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

// Force-spawn a few hot spots up front so we don't have to wait for the
// stochastic spawn rate to fire — proves the simulation is running.
await page.evaluate(() => {
    if (!window.__eqFluidDebug) {
        console.log('NO __eqFluidDebug — module didn\'t load');
        return;
    }
    for (let i = 0; i < 6; i++) window.__eqFluidDebug.spawnHotspot();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/fluid-01-active.png` });

await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/fluid-02-later.png` });

const state = await page.evaluate(() => ({
    hasDebug: !!window.__eqFluidDebug,
    hotspotCount: window.__eqFluidDebug ? window.__eqFluidDebug.getHotspots().length : -1,
}));
console.log('state:', JSON.stringify(state));

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
console.log('saved', `${OUT}/fluid-{01-active,02-later}.png`);
await browser.close();
