#!/usr/bin/env bun
// scripts/inspect-geo.js — view a specific lat/lng on the globe.
// Usage: bun run scripts/inspect-geo.js <lat> <lng> <name>
// Aims camera so that the surface point at (lat, lng) is centered.
import { chromium } from 'playwright';

const lat  = parseFloat(process.argv[2] ?? '-33');
const lng  = parseFloat(process.argv[3] ?? '-71');
const name = process.argv[4] ?? 'geo';
const URL = 'http://localhost:3000/';
const OUT = `/tmp/eqdev/${name}.png`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[err] ${err.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const result = await page.evaluate(({ lat, lng }) => {
    const dbg = window.__eqDebug;
    if (!dbg) return { ok: false, why: 'no __eqDebug' };
    const { camGroup, camera, geoToVec3 } = dbg;

    // Target world position on the sphere surface
    const target = geoToVec3(lat, lng, 0);
    // We want camera (at orig pos -4100,4100,0 inside camGroup) to point at this.
    // Camera vec from origin = camera.position. Apply camGroup.rotation -> camera world pos.
    // Easier: rotate camGroup so that target ends up "in front" of camera.
    // Default camera world pos (camGroup rotation 0) ≈ (-4100, 4100, 0). View direction looks
    // outward from origin toward (-4100,4100,0)? Actually camera lookAt is +x +y region.
    // We want target world position ≈ along view ray from camera. Easiest: set camGroup
    // rotation Euler so the vector from origin to target lines up with the original lookAt
    // direction.

    // Camera (in camGroup local space) sits at (-4100, 4100, 0). When camGroup is
    // unrotated, that's the camera's world position. Camera is INSIDE sphere; the
    // surface point on the same radial direction as camera is what's "in front" of
    // the camera (looking outward through the inner wall).
    //
    // To bring (lat, lng) into view: rotate camGroup so the camera's radial
    // direction matches target's radial direction.
    const cameraDir = camera.position.clone().normalize(); // ≈ (-0.707, +0.707, 0)
    const targetDir = target.clone().normalize();
    const Quaternion = camera.quaternion.constructor;
    const q = new Quaternion().setFromUnitVectors(cameraDir, targetDir);
    camGroup.quaternion.copy(q);
    camGroup.rotation.setFromQuaternion(q);

    return { ok: true, target: target.toArray(), cameraDir: cameraDir.toArray(), targetDir: targetDir.toArray() };
}, { lat, lng });

console.log('eval result:', result);

await page.waitForTimeout(800);
await page.screenshot({ path: OUT, fullPage: false });

console.log('\n--- console output ---');
for (const line of consoleLines) console.log(line);
console.log('saved', OUT);

await browser.close();
