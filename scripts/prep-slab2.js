#!/usr/bin/env bun
// scripts/prep-slab2.js
//
// Fetches USGS Slab2 (Hayes et al., 2018) per-zone depth contours from
// ScienceBase, parses the GMT multi-segment ASCII format, filters to the
// 8 chosen depths, splits antimeridian crossings, rounds coordinates,
// and emits data/slab2_contours.geojson.
//
// Run when refreshing source data:  bun run prep-slab2

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// USGS ScienceBase parent item ID for the Slab2 release.
// DOI: 10.5066/F7PV6JNV
const PARENT_ID = '5aa1b00ee4b0b1c392e86467';
const SB_BASE = 'https://www.sciencebase.gov/catalog';

// Depths we want to render (km). The spec specified [50, 100, 200, ..., 700]
// but Slab2 contour files use 20 km intervals — 50 km isn't in the data.
// Use 40 km as the shallow stand-in (closest available to 50). Final set:
// 8 depths, with shallow emphasis preserved.
const KEEP_DEPTHS = new Set([40, 100, 200, 300, 400, 500, 600, 700]);

const round2 = (n) => Math.round(n * 100) / 100;

async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.json();
}

async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.text();
}

// Extract the zone code from a contour filename. Handles both formats:
//   "alu_slab2_contours_02.23.18.in" → "alu"
//   "alu_slab2_dep_02.23.18_contours.in" → "alu"
function zoneCodeFromFilename(name) {
    const m = name.match(/^([a-z]{2,4})_slab2_/i);
    return m ? m[1].toLowerCase() : null;
}

// Parse a GMT multi-segment ASCII contour file. Format:
//
//   > -Z<depth_km>
//   <lon> <lat>
//   <lon> <lat>
//   ...
//   > -Z<next_depth>
//   ...
//
// Returns array of { depth_km: Number, coords: [[lon,lat], ...] } segments.
// Segments where depth_km isn't in KEEP_DEPTHS are dropped.
function parseGmtContours(text) {
    const segments = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('>')) {
            // Header. Look for -Z<num> token.
            const m = line.match(/-Z\s*(-?\d+(?:\.\d+)?)/);
            if (!m) { current = null; continue; }
            const depthRaw = parseFloat(m[1]);
            const depth_km = Math.abs(Math.round(depthRaw)); // Slab2 depths are negative; flip + round.
            if (KEEP_DEPTHS.has(depth_km)) {
                current = { depth_km, coords: [] };
                segments.push(current);
            } else {
                current = null;
            }
        } else if (current) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (Number.isFinite(lon) && Number.isFinite(lat)) {
                    current.coords.push([round2(lon), round2(lat)]);
                }
            }
        }
    }
    // Drop empty segments.
    return segments.filter((s) => s.coords.length >= 2);
}

// Split a coord array at antimeridian crossings (where consecutive
// longitudes jump by more than 180°). Returns an array of sub-coord-arrays.
function splitAntimeridian(coords) {
    if (coords.length < 2) return [coords];
    const out = [];
    let current = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        const [lon0] = coords[i - 1];
        const [lon1] = coords[i];
        if (Math.abs(lon1 - lon0) > 180) {
            // Jump: end current run, start a new one.
            if (current.length >= 2) out.push(current);
            current = [coords[i]];
        } else {
            current.push(coords[i]);
        }
    }
    if (current.length >= 2) out.push(current);
    return out;
}

mkdirSync('data', { recursive: true });

console.log(`Fetching Slab2 children of parent ${PARENT_ID}...`);
const childList = await fetchJson(`${SB_BASE}/items?parentId=${PARENT_ID}&format=json&max=50`);
console.log(`  Found ${childList.total} child items`);

const features = [];
let zonesProcessed = 0;
let zonesSkipped = 0;

for (const child of childList.items) {
    const detail = await fetchJson(`${SB_BASE}/item/${child.id}?format=json`);
    const contourFile = (detail.files || []).find((f) => /_contours.*\.in$/i.test(f.name));
    if (!contourFile) {
        console.warn(`  ${child.id} (${(child.title || '').slice(0, 60)}): no contour file, skipping`);
        zonesSkipped++;
        continue;
    }
    const zone = zoneCodeFromFilename(contourFile.name);
    if (!zone) {
        console.warn(`  ${contourFile.name}: couldn't extract zone code, skipping`);
        zonesSkipped++;
        continue;
    }
    const text = await fetchText(contourFile.url);
    const segments = parseGmtContours(text);
    let perZone = 0;
    for (const seg of segments) {
        const subCoords = splitAntimeridian(seg.coords);
        for (const sub of subCoords) {
            features.push({
                type: 'Feature',
                properties: { zone, depth_km: seg.depth_km },
                geometry: { type: 'LineString', coordinates: sub },
            });
            perZone++;
        }
    }
    console.log(`  ${zone}: ${perZone} segments across ${new Set(segments.map((s) => s.depth_km)).size} depths`);
    zonesProcessed++;
}

const out = { type: 'FeatureCollection', features };
writeFileSync(resolve('data/slab2_contours.geojson'), JSON.stringify(out));

console.log(`Wrote data/slab2_contours.geojson — ${features.length} features from ${zonesProcessed} zones (${zonesSkipped} skipped).`);
