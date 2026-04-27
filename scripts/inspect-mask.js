#!/usr/bin/env bun
// scripts/inspect-mask.js — extract the rasterized atlas mask canvas as PNG.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:3000/';
const OUT = '/tmp/eqdev/mask-extract.png';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const dataUrl = await page.evaluate(() => {
    const c = window.__eqAtlasMaskCanvas;
    return c ? c.toDataURL() : null;
});

if (!dataUrl) {
    console.error('window.__eqAtlasMaskCanvas not exposed');
    process.exit(1);
}

const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
writeFileSync(OUT, buf);
console.log('saved', OUT, '(' + buf.length + ' bytes)');

await browser.close();
