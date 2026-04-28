#!/usr/bin/env bun
// scripts/inspect-plate-motion.js — capture plate-motion arrows + flow.
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

await page.screenshot({ path: `${OUT}/plate-motion-default.png` });

const summary = await page.evaluate(() => {
    const d = window.__eqPlateMotion;
    if (!d) return { ok: false };
    return {
        ok: true,
        sampleCount: d.samples.length,
        rawSampleCount: d.rawSamples.length,
        firstSampleMagA: d.samples[0]?.vA.magnitude,
        firstSampleMagB: d.samples[0]?.vB.magnitude,
    };
});
console.log('summary:', JSON.stringify(summary));

// Drag camera up to see different boundary regions.
await page.mouse.move(600, 600);
await page.mouse.down();
await page.mouse.move(600, 200, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/plate-motion-tilted.png` });

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
