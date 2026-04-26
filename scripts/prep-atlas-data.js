#!/usr/bin/env bun
// scripts/prep-atlas-data.js
//
// Fetches Natural Earth land + admin-0 countries (for Antarctica) + PB2002
// plate boundaries, simplifies coordinates to 2-decimal precision, splits
// Antarctica from the land file, writes 3 GeoJSON files into data/.
//
// Run once when refreshing source data:  bun run prep-data

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCES = {
    land:      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson',
    countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    boundaries:'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
};

const round2 = (n) => Math.round(n * 100) / 100;

function roundCoords(c) {
    if (typeof c[0] === 'number') return [round2(c[0]), round2(c[1])];
    return c.map(roundCoords);
}

function roundGeometry(g) {
    if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map(roundGeometry) };
    return { ...g, coordinates: roundCoords(g.coordinates) };
}

function maxLat(g) {
    let max = -Infinity;
    function visit(c) {
        if (typeof c[0] === 'number') { if (c[1] > max) max = c[1]; return; }
        c.forEach(visit);
    }
    visit(g.coordinates);
    return max;
}

async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status} ${r.statusText}`);
    return r.json();
}

mkdirSync('data', { recursive: true });

console.log('Fetching 3 source files...');
const [land, countries, boundaries] = await Promise.all([
    fetchJson(SOURCES.land),
    fetchJson(SOURCES.countries),
    fetchJson(SOURCES.boundaries),
]);
console.log('  land:', land.features.length, 'features');
console.log('  countries:', countries.features.length, 'features');
console.log('  boundaries:', boundaries.features.length, 'features');

// Antarctica from countries
const antarcticaFeature = countries.features.find((f) => {
    const p = f.properties;
    return (p.SOVEREIGNT || p.sovereignt || p.NAME || p.name) === 'Antarctica';
});
if (!antarcticaFeature) throw new Error('Antarctica feature not found in admin_0_countries');

writeFileSync(resolve('data/ne_110m_antarctica.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        properties: { name: 'Antarctica' },
        geometry: roundGeometry(antarcticaFeature.geometry),
    }],
}));

// Land minus Antarctica (any feature whose max latitude is below -60° is the antarctic ring)
const landFiltered = {
    type: 'FeatureCollection',
    features: land.features
        .filter((f) => maxLat(f.geometry) >= -60)
        .map((f) => ({ type: 'Feature', properties: {}, geometry: roundGeometry(f.geometry) })),
};
writeFileSync(resolve('data/ne_110m_land.geojson'), JSON.stringify(landFiltered));

// PB2002 boundaries: pass through, round coords
const boundariesRounded = {
    type: 'FeatureCollection',
    features: boundaries.features.map((f) => ({
        type: 'Feature',
        properties: f.properties,
        geometry: roundGeometry(f.geometry),
    })),
};
writeFileSync(resolve('data/pb2002_boundaries.geojson'), JSON.stringify(boundariesRounded));

console.log('Wrote 3 files to data/.');
console.log('  ne_110m_land.geojson:', landFiltered.features.length, 'features');
console.log('  ne_110m_antarctica.geojson: 1 feature');
console.log('  pb2002_boundaries.geojson:', boundariesRounded.features.length, 'features');
