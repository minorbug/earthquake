#!/usr/bin/env bun
// scripts/prep-volcanoes.js
//
// Fetches the Smithsonian Global Volcanism Program "Volcanoes of the World"
// (VOTW) Holocene catalog. Smithsonian's direct CFM endpoints block scripted
// access (HTTP 403 even with a browser User-Agent), so we use the
// scottyhq/votw GitHub mirror — which simply checks in the same upstream
// CSV. The data carries Smithsonian's source terms (academic / educational
// / non-commercial use with attribution); the mirror's own GPL applies only
// to the Python notebook in that repo, not to the data itself.
//
// Output: data/volcanoes_holocene.geojson — a FeatureCollection of Point
// features for ~1,450 Holocene-active volcanoes with trimmed properties.
//
// Run when refreshing source data: bun run prep-volcanoes

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_URL = 'https://raw.githubusercontent.com/scottyhq/votw/master/votw.csv';
const CACHE_DIR  = 'data/.cache';
const CACHE_PATH = `${CACHE_DIR}/votw.csv`;

const round2 = (n) => Math.round(n * 100) / 100;

// Minimal CSV parser handling quoted fields with embedded commas/newlines
// and the standard "" escape for quotes inside quoted fields. Returns an
// array of rows (each row an array of strings).
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
            if (c === '"')                        { inQuotes = false; i++; continue; }
            cell += c; i++;
        } else {
            if (c === '"' && cell === '')         { inQuotes = true; i++; continue; }
            if (c === ',')                         { row.push(cell); cell = ''; i++; continue; }
            if (c === '\r' || c === '\n') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(cell); cell = '';
                if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
                row = [];
                i++;
                continue;
            }
            cell += c; i++;
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
    }
    return rows;
}

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync('data', { recursive: true });

// Step 1 — download (cached)
if (!existsSync(CACHE_PATH) || statSync(CACHE_PATH).size < 100_000) {
    console.log(`Downloading VOTW Holocene CSV from ${SOURCE_URL}...`);
    const r = await fetch(SOURCE_URL);
    if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
    const text = await r.text();
    writeFileSync(CACHE_PATH, text);
    console.log(`  Cached to ${CACHE_PATH} (${(text.length / 1024).toFixed(0)} KB)`);
} else {
    console.log(`Using cached CSV at ${CACHE_PATH} (${(statSync(CACHE_PATH).size / 1024).toFixed(0)} KB)`);
}

// Step 2 — parse
const text = await Bun.file(CACHE_PATH).text();
const rows = parseCsv(text);
const header = rows[0];
const colIdx = (name) => {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`Column not found: ${name}. Available: ${header.join(', ')}`);
    return i;
};

const idIdx       = colIdx('Volcano_Number');
const nameIdx     = colIdx('Volcano_Name');
const typeIdx     = colIdx('Primary_Volcano_Type');
const lastEruptIdx = colIdx('Last_Eruption_Year');
const countryIdx  = colIdx('Country');
const regionIdx   = colIdx('Region');
const subregionIdx = colIdx('Subregion');
const latIdx      = colIdx('Latitude');
const lngIdx      = colIdx('Longitude');
const elevIdx     = colIdx('Elevation');
const epochIdx    = colIdx('Geologic_Epoch');

console.log(`Parsing ${rows.length - 1} rows...`);

// Step 3 — filter + trim
const features = [];
let skippedNonHolocene = 0;
let skippedBadCoords = 0;

for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    const epoch = (row[epochIdx] || '').trim();
    if (epoch && !/holocene/i.test(epoch)) {
        skippedNonHolocene++;
        continue;
    }

    const lat = parseFloat(row[latIdx]);
    const lng = parseFloat(row[lngIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        skippedBadCoords++;
        continue;
    }

    const elev = parseFloat(row[elevIdx]);
    const lastEruptionRaw = (row[lastEruptIdx] || '').trim();
    // VOTW encodes BCE years as negatives (e.g., "-8300"). We pass through as integer.
    const lastEruption = lastEruptionRaw === '' ? null : parseInt(lastEruptionRaw, 10);

    features.push({
        type: 'Feature',
        properties: {
            id:            (row[idIdx] || '').trim(),
            name:          (row[nameIdx] || '').trim(),
            type:          (row[typeIdx] || '').trim(),
            country:       (row[countryIdx] || '').trim(),
            region:        (row[regionIdx] || '').trim(),
            subregion:     (row[subregionIdx] || '').trim(),
            elevation_m:   Number.isFinite(elev) ? Math.round(elev) : null,
            last_eruption: Number.isFinite(lastEruption) ? lastEruption : null,
        },
        geometry: {
            type: 'Point',
            coordinates: [round2(lng), round2(lat)],
        },
    });
}

console.log(`  Kept ${features.length} Holocene volcanoes`);
if (skippedNonHolocene > 0) console.log(`  Dropped ${skippedNonHolocene} non-Holocene rows`);
if (skippedBadCoords > 0)   console.log(`  Dropped ${skippedBadCoords} rows with invalid coordinates`);

// Step 4 — write
const out = { type: 'FeatureCollection', features };
const outPath = resolve('data/volcanoes_holocene.geojson');
writeFileSync(outPath, JSON.stringify(out));

const sizeKB = (statSync(outPath).size / 1024).toFixed(1);
console.log(`Wrote data/volcanoes_holocene.geojson (${sizeKB} KB)`);

// Quick coverage sanity check.
const byCountry = new Map();
for (const f of features) {
    const c = f.properties.country || '?';
    byCountry.set(c, (byCountry.get(c) || 0) + 1);
}
const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`  Top 5 by country: ${top.map(([c, n]) => `${c}=${n}`).join(', ')}`);
