#!/usr/bin/env bun
// scripts/inspect.js — automated browser session against the dev server.
// Captures: console messages, JS errors, page errors, screenshot.
//
// Usage:  bun run scripts/inspect.js [shotName]    (defaults to "shot")

import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';
const SHOT = process.argv[2] || 'shot';
const OUT = `/tmp/eqdev/${SHOT}.png`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
});
page.on('requestfailed', (req) => {
    consoleLines.push(`[reqfail] ${req.url()} :: ${req.failure()?.errorText}`);
});

console.log('navigating to', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
// Wait extra for the USGS fetch + first paint
await page.waitForTimeout(3000);

await page.screenshot({ path: OUT, fullPage: false });

console.log('\n--- console output ---');
for (const line of consoleLines) console.log(line);
console.log(`\n--- screenshot saved ---`);
console.log(OUT);

await browser.close();
