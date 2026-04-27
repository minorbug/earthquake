#!/usr/bin/env bun
// scripts/inspect-pole.js — viewing south pole specifically
import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';
const SHOT = process.argv[2] || 'pole';
const OUT = `/tmp/eqdev/${SHOT}.png`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[err] ${err.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Drag globe to bring south pole into view (drag from center upward = rotate camera "down")
await page.mouse.move(600, 500);
await page.mouse.down();
await page.mouse.move(600, 100, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: false });
console.log('saved', OUT);

await browser.close();
