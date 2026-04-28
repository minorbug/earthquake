#!/usr/bin/env bun
import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[err] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
    const d = window.__eqVolDebug;
    if (!d) return { ok: false };
    return {
        ok: true,
        hotspotCount: d.getHotspots().length,
        hotspotSamples: d.getHotspots().slice(0, 4).map(h => ({ u: h.u.toFixed(3), v: h.v.toFixed(3), age: h.age.toFixed(2), life: h.lifetime.toFixed(2), int: h.intensity.toFixed(2) })),
        cfg: d.cfg,
        velUniforms: {
            buoyancy: d.sim.velMat.uniforms.buoyancy.value,
            damping: d.sim.velMat.uniforms.damping.value,
            hotspotBuoyancy: d.sim.velMat.uniforms.hotspotBuoyancy.value,
        },
        dyeUniforms: {
            decay: d.sim.dyeMat.uniforms.decay.value,
            injectStrength: d.sim.dyeMat.uniforms.injectStrength.value,
        },
    };
});
console.log(JSON.stringify(state, null, 2));

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
