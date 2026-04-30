#!/usr/bin/env bun
// scripts/prep-bathymetry.js
//
// Downloads ETOPO 2022 60-arc-second bedrock elevation grid from NOAA NCEI
// (cached locally — re-runs are free), parses via h5wasm (the same NetCDF-4
// /HDF5 parser we use for Slab2 grids), downsamples 30× to 720×360, applies
// a sqrt depth curve to emphasize trench/abyssal contrast, encodes as 8-bit
// grayscale PNG (~50–100 KB) → data/bathymetry.png.
//
// Run when refreshing source data: bun run prep-bathymetry

import { writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { ready, FS, File } from 'h5wasm';
import { PNG } from 'pngjs';

await ready;

const ETOPO_URL = 'https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc';
const CACHE_DIR = 'data/.cache';
const CACHE_PATH = `${CACHE_DIR}/etopo_2022_60s.nc`;

// Downsample stride: 30× brings 21600×10800 → 720×360.
const STRIDE = 30;
const OUT_W = 720;
const OUT_H = 360;

// Depth normalization. ETOPO elevations are in meters; values < 0 are below
// sea level (ocean). Clamp depth to [0, MAX_DEPTH_M] and apply sqrt curve so
// trenches (~7000-11000m) read as distinctly darker than abyssal plain (~4000-5000m).
const MAX_DEPTH_M = 11000;
const LAND_SENTINEL = 255;   // sea-level white (lerp returns shallowOceanColor under land — but mask=land won't sample anyway)

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync('data', { recursive: true });

// Step 1 — download (cached)
if (!existsSync(CACHE_PATH) || statSync(CACHE_PATH).size < 1_000_000) {
    console.log(`Downloading ETOPO 2022 60s from NOAA NCEI...`);
    console.log(`  ${ETOPO_URL}`);
    console.log(`  This is ~466 MB; takes a few minutes on a typical home connection.`);
    const r = await fetch(ETOPO_URL);
    if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
    const buf = await r.arrayBuffer();
    writeFileSync(CACHE_PATH, new Uint8Array(buf));
    console.log(`  Cached to ${CACHE_PATH} (${(buf.byteLength / 1024 / 1024).toFixed(0)} MB)`);
} else {
    console.log(`Using cached ETOPO at ${CACHE_PATH} (${(statSync(CACHE_PATH).size / 1024 / 1024).toFixed(0)} MB)`);
}

// Step 2 — parse with h5wasm
console.log(`Parsing NetCDF-4...`);
const fileBuf = await Bun.file(CACHE_PATH).arrayBuffer();
FS.writeFile('/etopo.nc', new Uint8Array(fileBuf));
const f = new File('/etopo.nc', 'r');
console.log(`  variables:`, f.keys());

// Find the elevation variable (ETOPO sometimes uses 'z', sometimes 'Band1')
const varNames = f.keys();
let elevVar = null;
for (const candidate of ['z', 'Band1', 'elevation']) {
    if (varNames.includes(candidate)) { elevVar = candidate; break; }
}
if (!elevVar) {
    // Fall back to the first non-dimension variable
    for (const k of varNames) {
        if (!['lat', 'lon', 'x', 'y', 'time'].includes(k)) { elevVar = k; break; }
    }
}
if (!elevVar) throw new Error(`Couldn't find elevation variable. Available: ${varNames}`);
console.log(`  using variable: ${elevVar}`);

const elevDS = f.get(elevVar);
const z = elevDS.value;          // Float32Array, length nLat * nLon
const shape = elevDS.shape;       // [nLat, nLon]
const [nLat, nLon] = shape;
console.log(`  elevation grid: ${nLat} × ${nLon} = ${z.length.toLocaleString()} cells`);

// Step 3 — downsample by stride decimation
console.log(`Downsampling to ${OUT_W} × ${OUT_H} (stride ${STRIDE})...`);
const pixels = new Uint8Array(OUT_W * OUT_H);
let minDepth = Infinity, maxDepth = -Infinity, landCount = 0, oceanCount = 0;

for (let oy = 0; oy < OUT_H; oy++) {
    for (let ox = 0; ox < OUT_W; ox++) {
        // Source cell: nearest-neighbor stride sample
        const sy = Math.min(nLat - 1, oy * STRIDE);
        const sx = Math.min(nLon - 1, ox * STRIDE);
        const elev = z[sy * nLon + sx];

        let pixel;
        if (elev >= 0 || isNaN(elev)) {
            pixel = LAND_SENTINEL;
            landCount++;
        } else {
            const depth = Math.min(MAX_DEPTH_M, -elev);
            const norm = Math.sqrt(depth / MAX_DEPTH_M);   // 0 = sea level, 1 = max depth
            // Encode so 255 = brightest = sea level, 0 = darkest = max depth.
            pixel = Math.round((1 - norm) * 255);
            if (depth < minDepth) minDepth = depth;
            if (depth > maxDepth) maxDepth = depth;
            oceanCount++;
        }
        pixels[oy * OUT_W + ox] = pixel;
    }
}

console.log(`  ${oceanCount.toLocaleString()} ocean cells, ${landCount.toLocaleString()} land cells`);
console.log(`  ocean depth range: ${minDepth.toFixed(0)} m .. ${maxDepth.toFixed(0)} m`);

f.close();
FS.unlink('/etopo.nc');

// Step 4 — encode as 8-bit grayscale PNG
console.log(`Encoding PNG...`);
const png = new PNG({
    width: OUT_W,
    height: OUT_H,
    colorType: 0,       // 0 = grayscale
    bitDepth: 8,
    inputColorType: 0,
    inputHasAlpha: false,
});
// pngjs's data buffer is RGBA-shaped even for grayscale input; using
// PNG.adjustGamma / PNG.sync.write with explicit grayscale encoding.
// Easier: use PNG.sync.write with a synthetic RGBA buffer.
const rgba = Buffer.alloc(OUT_W * OUT_H * 4);
for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    rgba[i * 4]     = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
}
png.data = rgba;

const outPath = resolve('data/bathymetry.png');
const pngBuf = PNG.sync.write(png, { colorType: 0 });   // colorType: 0 → grayscale on output
writeFileSync(outPath, pngBuf);

console.log(`\nWrote data/bathymetry.png (${(pngBuf.length / 1024).toFixed(1)} KB)`);
