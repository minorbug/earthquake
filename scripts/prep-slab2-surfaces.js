#!/usr/bin/env bun
// scripts/prep-slab2-surfaces.js
//
// Fetches USGS Slab2 (Hayes et al., 2018) per-zone *_dep.grd files from
// ScienceBase, parses them with h5wasm (Slab2 ships HDF5/NetCDF-4 grids,
// not classic NetCDF-3), downsamples 2× (0.1° resolution), constructs
// indexed triangle meshes with NaN/antimeridian clipping, and emits a
// single binary asset (data/slab2_surfaces.bin) + JSON manifest
// (data/slab2_surfaces.json).
//
// Run when refreshing source data: bun run prep-slab2-surfaces

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ready, FS, File } from 'h5wasm';

await ready;

// USGS ScienceBase parent item ID for the Slab2 release.
// DOI: 10.5066/F7PV6JNV
const PARENT_ID = '5aa1b00ee4b0b1c392e86467';
const SB_BASE = 'https://www.sciencebase.gov/catalog';

// Downsample stride. 1 = native 0.05°, 2 = 0.1°, etc.
const STRIDE = 2;

// Cap depth to 700 km — matches the contour layer's max and keeps
// supplementary deep folds (sup.csv) implicitly out of v1.
const MAX_DEPTH_KM = 700;

async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.json();
}

async function fetchBuffer(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.arrayBuffer();
}

// Extract zone code from a Slab2 filename like
// "alu_slab2_dep_02.23.18.grd" → "alu".
function zoneCodeFromFilename(name) {
    const m = name.match(/^([a-z]{2,4})_slab2_/i);
    return m ? m[1].toLowerCase() : null;
}

// Coordinate conversion matching src/feed.js / src/atlas.js / src/slab2.js.
const TEXTURE_EDGE_LNG = -180.806168;
const DEG = Math.PI / 180;
const CRUST_RADIUS_KM = 6367;
function geoToVec3Depth(lat, lng, depthKm) {
    const r = CRUST_RADIUS_KM - depthKm;
    const phi = (90 - lat) * DEG;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * DEG;
    const sp = Math.sin(phi);
    return [r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta)];
}

// Slab2 lons are 0..360. Normalize to -180..180 for our coordinate convention.
function normalizeLon(lng) {
    return lng > 180 ? lng - 360 : lng;
}

// Build an indexed triangle mesh from a single zone's depth grid.
// Returns { positions: Float32Array, depths: Float32Array, indices: Uint32Array, depthMin, depthMax }.
function buildZoneMesh(z, x, y, nLng, nLat) {
    // Vertex dedupe: (i, j) → vertex index in this zone's local buffer.
    const vertexMap = new Map();
    const positions = [];
    const depths = [];
    const indices = [];

    let depthMin = Infinity;
    let depthMax = -Infinity;

    function getOrAddVertex(i, j) {
        // i = lon idx (0..nLng-1), j = lat idx (0..nLat-1)
        const key = j * nLng + i;
        const cached = vertexMap.get(key);
        if (cached !== undefined) return cached;

        const rawDepth = z[j * nLng + i];   // negative km in Slab2 convention
        const depthKm = -rawDepth;          // positive depth
        const lng = normalizeLon(x[i]);
        const lat = y[j];
        const [vx, vy, vz] = geoToVec3Depth(lat, lng, depthKm);

        const idx = positions.length / 3;
        positions.push(vx, vy, vz);
        depths.push(depthKm);
        if (depthKm < depthMin) depthMin = depthKm;
        if (depthKm > depthMax) depthMax = depthKm;

        vertexMap.set(key, idx);
        return idx;
    }

    // Iterate cells with stride. Each cell is (i, j) → (i+S, j+S),
    // with corners at (i,j), (i+S,j), (i,j+S), (i+S,j+S).
    const S = STRIDE;
    for (let j = 0; j + S < nLat; j += S) {
        for (let i = 0; i + S < nLng; i += S) {
            const z00 = z[ j      * nLng +  i     ];
            const z10 = z[ j      * nLng + (i + S)];
            const z01 = z[(j + S) * nLng +  i     ];
            const z11 = z[(j + S) * nLng + (i + S)];

            // NaN clip: any corner outside the slab → skip cell.
            if (isNaN(z00) || isNaN(z10) || isNaN(z01) || isNaN(z11)) continue;

            // Depth cap (catches izu/ker/man/sol overturns past the upper sheet).
            if (-z00 > MAX_DEPTH_KM || -z10 > MAX_DEPTH_KM ||
                -z01 > MAX_DEPTH_KM || -z11 > MAX_DEPTH_KM) continue;

            // Antimeridian clip: check if any adjacent corner pair spans > 180° lon.
            const x0 = x[i], x1 = x[i + S];
            if (Math.abs(x1 - x0) > 180) continue;

            const a = getOrAddVertex(i,     j    );
            const b = getOrAddVertex(i + S, j    );
            const c = getOrAddVertex(i,     j + S);
            const d = getOrAddVertex(i + S, j + S);

            // Two triangles: (a, b, c) and (b, d, c).
            // Wind so the outward face (toward -depth, i.e., toward planet surface)
            // gets FrontSide. With FrontSide we want CCW from outside the planet.
            // Empirically: this winding gives correct outward face for the slab.
            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }

    return {
        positions: new Float32Array(positions),
        depths:    new Float32Array(depths),
        indices:   new Uint32Array(indices),
        depthMin, depthMax,
    };
}

mkdirSync('data', { recursive: true });

console.log(`Fetching Slab2 children of parent ${PARENT_ID}...`);
const childList = await fetchJson(`${SB_BASE}/items?parentId=${PARENT_ID}&format=json&max=50`);
console.log(`  Found ${childList.total} child items`);

const zones = [];
let totalVertices = 0;
let totalIndices = 0;
let zonesProcessed = 0;
let zonesSkipped = 0;

// Per-zone slices, accumulated. We concatenate to single global buffers below.
const allPositions = [];
const allDepths = [];
const allIndices = [];

for (const child of childList.items) {
    const detail = await fetchJson(`${SB_BASE}/item/${child.id}?format=json`);
    const grdFile = (detail.files || []).find((f) => /_slab2_dep_.*\.grd$/i.test(f.name));
    if (!grdFile) {
        console.warn(`  ${child.id}: no dep.grd file, skipping`);
        zonesSkipped++;
        continue;
    }
    const zone = zoneCodeFromFilename(grdFile.name);
    if (!zone) {
        console.warn(`  ${grdFile.name}: couldn't extract zone code, skipping`);
        zonesSkipped++;
        continue;
    }

    const buf = await fetchBuffer(grdFile.url);
    const tmpPath = `/${zone}.grd`;
    FS.writeFile(tmpPath, new Uint8Array(buf));
    const f = new File(tmpPath, 'r');
    const z = f.get('z').value;
    const x = f.get('x').value;
    const y = f.get('y').value;
    const nLng = x.length;
    const nLat = y.length;
    f.close();
    FS.unlink(tmpPath);

    const mesh = buildZoneMesh(z, x, y, nLng, nLat);

    const vCount = mesh.positions.length / 3;
    const iCount = mesh.indices.length;
    if (vCount === 0 || iCount === 0) {
        console.warn(`  ${zone}: built 0 vertices (all cells clipped?), skipping`);
        zonesSkipped++;
        continue;
    }

    zones.push({
        zone,
        vertexOffset: totalVertices,
        vertexCount: vCount,
        indexOffset: totalIndices,
        indexCount: iCount,
        depthMin: Math.round(mesh.depthMin * 10) / 10,
        depthMax: Math.round(mesh.depthMax * 10) / 10,
    });

    allPositions.push(mesh.positions);
    allDepths.push(mesh.depths);
    allIndices.push(mesh.indices);

    totalVertices += vCount;
    totalIndices  += iCount;
    zonesProcessed++;

    console.log(`  ${zone}: ${vCount} verts, ${iCount / 3} tris, depth ${mesh.depthMin.toFixed(0)}..${mesh.depthMax.toFixed(0)} km`);
}

// Concatenate into single global buffers.
const positionsBuf = new Float32Array(totalVertices * 3);
const depthsBuf    = new Float32Array(totalVertices);
const indicesBuf   = new Uint32Array(totalIndices);
let pOff = 0, dOff = 0, iOff = 0;
for (let k = 0; k < allPositions.length; k++) {
    positionsBuf.set(allPositions[k], pOff);
    depthsBuf.set(allDepths[k], dOff);
    indicesBuf.set(allIndices[k], iOff);
    pOff += allPositions[k].length;
    dOff += allDepths[k].length;
    iOff += allIndices[k].length;
}

// Pack into one binary file: positions, then depths, then indices.
const positionsBytes = positionsBuf.byteLength;
const depthsBytes    = depthsBuf.byteLength;
const indicesBytes   = indicesBuf.byteLength;
const totalBytes = positionsBytes + depthsBytes + indicesBytes;

const bin = new Uint8Array(totalBytes);
bin.set(new Uint8Array(positionsBuf.buffer), 0);
bin.set(new Uint8Array(depthsBuf.buffer),    positionsBytes);
bin.set(new Uint8Array(indicesBuf.buffer),   positionsBytes + depthsBytes);

writeFileSync(resolve('data/slab2_surfaces.bin'), bin);

const manifest = {
    format: 'slab2-surfaces-v1',
    stride: STRIDE,
    maxDepthKm: MAX_DEPTH_KM,
    crustRadiusKm: CRUST_RADIUS_KM,
    totalVertices,
    totalIndices,
    layout: {
        positions: { byteOffset: 0,                              byteLength: positionsBytes, type: 'Float32', count: totalVertices * 3 },
        depths:    { byteOffset: positionsBytes,                 byteLength: depthsBytes,    type: 'Float32', count: totalVertices     },
        indices:   { byteOffset: positionsBytes + depthsBytes,   byteLength: indicesBytes,   type: 'Uint32',  count: totalIndices      },
    },
    zones,
};
writeFileSync(resolve('data/slab2_surfaces.json'), JSON.stringify(manifest, null, 2));

console.log(`\nWrote data/slab2_surfaces.bin (${(totalBytes / 1024).toFixed(0)} KB) + .json`);
console.log(`  ${zonesProcessed} zones, ${zonesSkipped} skipped`);
console.log(`  ${totalVertices} vertices, ${totalIndices / 3} triangles`);
