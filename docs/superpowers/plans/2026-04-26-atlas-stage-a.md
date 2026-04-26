# Vector Atlas — Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the photographic globe (`world.jpg`) with a vector-rendered atlas: dark-ocean sphere, slightly-lighter continent fills, ice-tinted Antarctica, and PB2002 plate boundaries styled by type, plus a live-tuning panel for the new visual layer.

**Architecture:** Two new modules — `src/atlas.js` (geometry construction from bundled GeoJSON) and `src/atlasTuning.js` (lil-gui panel + persistence). A one-time `scripts/prep-atlas-data.js` fetches + simplifies + writes the three GeoJSON files into `data/`; those files are committed and bundled into the JS at build time via Bun's `with { type: 'json' }` import. Polygons triangulated with `earcut`, projected to sphere via the existing `geoToVec3` helper.

**Tech Stack:** three.js 0.184, lil-gui, Bun, vanilla ES modules. New runtime dep: `earcut`. New build-time dep: none (the prep script uses Bun's built-in `fetch`).

**Reference spec:** `docs/superpowers/specs/2026-04-26-atlas-stage-a-design.md`

**Testing note:** No automated test framework. Each task ends with a **manual visual verification** step served via `bun run dev` (which launches `dev.js`, the project's `Bun.serve`-based dev server). Treat verification as the gate before committing.

---

## File Structure

| File | Status | Purpose |
|------|--------|---------|
| `package.json` | modify | Add `earcut` dep. Add `prep-data` script. |
| `scripts/prep-atlas-data.js` | create | One-off Bun script: fetch + simplify the 3 GeoJSON sources, write to `data/`. Idempotent — re-runnable. |
| `data/ne_110m_land.geojson` | create | Natural Earth land MultiPolygons, simplified to 2-decimal precision, with the Antarctica polygon removed. |
| `data/ne_110m_antarctica.geojson` | create | Antarctica polygon only, simplified. |
| `data/pb2002_boundaries.geojson` | create | PB2002 plate boundary LineStrings, simplified. `properties.Type` preserved for type-based coloring. |
| `src/atlas.js` | create | `loadAtlas({ scene, radius, atlasTuning })` builds land + antarctica meshes + boundary line groups. Returns refs for live tuning. |
| `src/atlasTuning.js` | create | `atlasTuning` state + lil-gui panel + localStorage + reset. Mirrors the structure of `src/tuning.js`. |
| `src/scene.js` | modify | Drop `TextureLoader` import + `world.jpg` load + crust texture mapping. Replace crust material with `MeshBasicMaterial({ color, side })`. |
| `src/main.js` | modify | Construct atlas tuning panel; call `loadAtlas(...)` after `createScene(...)`. |
| `img/world.jpg` | delete | No longer used. |

---

## Task 1: Vendor data + earcut dep

**Files:**
- Modify: `package.json`
- Create: `scripts/prep-atlas-data.js`
- Create: `data/ne_110m_land.geojson`, `data/ne_110m_antarctica.geojson`, `data/pb2002_boundaries.geojson`

- [ ] **Step 1: Add `earcut` dependency**

```bash
cd /Users/mattbaker/Development/earthquake
bun add earcut
```

Expected: `package.json` "dependencies" gains `earcut` (current version is `2.x` family, ~12KB minified, MIT). `bun.lock` updated.

- [ ] **Step 2: Create `scripts/prep-atlas-data.js`**

```javascript
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
```

- [ ] **Step 3: Add `prep-data` script to `package.json`**

In the `"scripts"` block, add the `prep-data` line. The full `"scripts"` block should look like:

```json
"scripts": {
    "dev": "bun run dev.js",
    "build": "rm -rf dist && bun build ./index.html --outdir=dist --minify && cp -R img dist/img",
    "prep-data": "bun run scripts/prep-atlas-data.js"
},
```

- [ ] **Step 4: Run the prep script**

```bash
bun run prep-data
```

Expected output (counts may vary slightly with future Natural Earth updates):

```
Fetching 3 source files...
  land: 127 features
  countries: 258 features
  boundaries: 229 features
Wrote 3 files to data/.
  ne_110m_land.geojson: 126 features
  ne_110m_antarctica.geojson: 1 feature
  pb2002_boundaries.geojson: 229 features
```

The `land` feature count drops by 1 after Antarctica is filtered.

- [ ] **Step 5: Spot-check the data**

```bash
ls -la data/
wc -c data/*.geojson
```

Expected: 3 files. Combined size in the 60–250 KB range. Confirm none is 0 bytes.

```bash
# Confirm boundaries have a Type property we can color by
jq '.features[0].properties' data/pb2002_boundaries.geojson
```

Expected: an object containing a `Type` field with a 2–3-letter code (e.g., `"OSR"`, `"SUB"`, `"OTF"`).

If `jq` isn't installed:

```bash
bun -e 'const f = await Bun.file("data/pb2002_boundaries.geojson").json(); console.log(JSON.stringify(f.features[0].properties))'
```

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock scripts/prep-atlas-data.js data/
git commit -m "Add atlas data prep script + bundled GeoJSON sources"
```

---

## Task 2: `src/atlasTuning.js` — lil-gui panel

**Files:**
- Create: `src/atlasTuning.js`

- [ ] **Step 1: Create `src/atlasTuning.js`**

```javascript
// src/atlasTuning.js — atlas styling state + lil-gui panel + persistence.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-atlas-tuning';

const defaults = {
    // Colors
    oceanColor:      '#0a1428',
    landColor:       '#1a2238',
    antarcticaColor: '#2a3548',
    ridgeColor:      '#d840ff', // OSR, CRB
    subColor:        '#6020c0', // OCB, CCB, SUB
    transformColor:  '#f0c060', // OTF, CTF
    otherColor:      '#ffffff',
    otherAlpha:      0.18,
    // Geometry
    boundaryWidth:   1.0,
    // Visibility
    showLand:        true,
    showBoundaries:  true,
};

function loadStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

const stored = loadStored();
export const atlasTuning = {};
for (const k in defaults) atlasTuning[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : defaults[k];

function save() {
    try {
        const snap = {};
        for (const k in defaults) snap[k] = atlasTuning[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
}

const colorListeners = [];
const visibilityListeners = [];

export function onAtlasColorChange(cb)      { colorListeners.push(cb); }
export function onAtlasVisibilityChange(cb) { visibilityListeners.push(cb); }

function fireColors()     { colorListeners.forEach((cb) => cb(atlasTuning)); }
function fireVisibility() { visibilityListeners.forEach((cb) => cb(atlasTuning)); }

export function buildAtlasGui() {
    const gui = new GUI({ width: 300, title: 'Atlas' });
    gui.domElement.style.marginTop = '8px';

    const allControllers = [];
    const bindColor = (ctl) => { ctl.onChange(() => { save(); fireColors(); }); allControllers.push(ctl); return ctl; };
    const bindVis   = (ctl) => { ctl.onChange(() => { save(); fireVisibility(); }); allControllers.push(ctl); return ctl; };

    const fColors = gui.addFolder('Colors');
    bindColor(fColors.addColor(atlasTuning, 'oceanColor'));
    bindColor(fColors.addColor(atlasTuning, 'landColor'));
    bindColor(fColors.addColor(atlasTuning, 'antarcticaColor'));
    bindColor(fColors.addColor(atlasTuning, 'ridgeColor'));
    bindColor(fColors.addColor(atlasTuning, 'subColor'));
    bindColor(fColors.addColor(atlasTuning, 'transformColor'));
    bindColor(fColors.addColor(atlasTuning, 'otherColor'));
    bindColor(fColors.add(atlasTuning, 'otherAlpha', 0, 1, 0.01));

    const fGeom = gui.addFolder('Geometry');
    bindColor(fGeom.add(atlasTuning, 'boundaryWidth', 0, 3, 0.05));

    const fVis = gui.addFolder('Visibility');
    bindVis(fVis.add(atlasTuning, 'showLand'));
    bindVis(fVis.add(atlasTuning, 'showBoundaries'));

    gui.add({
        reset: () => {
            for (const k in defaults) atlasTuning[k] = defaults[k];
            save();
            allControllers.forEach((c) => c.updateDisplay());
            fireColors();
            fireVisibility();
        },
    }, 'reset').name('Reset atlas');
}
```

Notes:
- `onAtlasColorChange` cb receives the live `atlasTuning` object; consumers re-read whatever they need.
- `boundaryWidth` is grouped with colors for `fireColors` because it currently maps to alpha (per spec — actual linewidth is GPU-clamped). Keeping it as a color-cb gives one less listener type.
- The panel sits below the existing markers panel via the `marginTop: 8px` style; lil-gui defaults to `position: fixed; top: 0; right: 0`. Both panels stack on the right edge.

- [ ] **Step 2: Verify the file parses**

```bash
bun build src/atlasTuning.js --target=browser --outdir=/tmp/eqtest 2>&1 | tail -5
```

Expected: a successful build line (e.g., `Bundled 1 module ...`). No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add src/atlasTuning.js
git commit -m "Add src/atlasTuning.js: atlas state + lil-gui panel + persistence"
```

---

## Task 3: `src/atlas.js` — land + antarctica meshes

This task creates the atlas module and renders the two solid-color land meshes. Plate boundaries come in Task 4.

**Files:**
- Create: `src/atlas.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/atlas.js`**

```javascript
// src/atlas.js — vector atlas (continents, antarctica, plate boundaries) on the globe.
import {
    Mesh,
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    DoubleSide,
    Color,
} from 'three';
import earcut from 'earcut';
import { geoToVec3 } from './feed.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';

import landJson from '../data/ne_110m_land.geojson' with { type: 'json' };
import antarcticaJson from '../data/ne_110m_antarctica.geojson' with { type: 'json' };
// (PB2002 import is added in Task 4)

const LAND_RADIUS_FACTOR = 1.0005;

// ---- Polygon → triangulated sphere mesh ----

function buildPolygonGeometry(featureCollection, radiusKm) {
    // Each feature is a Polygon or MultiPolygon. Earcut each polygon's rings,
    // project lat/lng to sphere, accumulate into one BufferGeometry.
    const positions = []; // flat [x,y,z, x,y,z, ...]
    const indices  = [];

    for (const feature of featureCollection.features) {
        const g = feature.geometry;
        const polygons = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];

        for (const polygon of polygons) {
            // polygon = [outerRing, ...holes], each ring = [[lng, lat], ...]
            const flat = [];
            const holeIndices = [];
            for (let r = 0; r < polygon.length; r++) {
                if (r > 0) holeIndices.push(flat.length / 2);
                for (const [lng, lat] of polygon[r]) {
                    flat.push(lng, lat);
                }
            }
            const triangles = earcut(flat, holeIndices, 2);

            const baseVertex = positions.length / 3;
            for (let i = 0; i < flat.length; i += 2) {
                const v = geoToVec3(flat[i + 1], flat[i], 0); // (lat, lng, depth=0)
                v.normalize().multiplyScalar(radiusKm);
                positions.push(v.x, v.y, v.z);
            }
            for (const ti of triangles) indices.push(baseVertex + ti);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

// ---- Public entry ----

export function loadAtlas({ scene, radius }) {
    const landRadius = radius * LAND_RADIUS_FACTOR;

    const landGeo       = buildPolygonGeometry(landJson, landRadius);
    const antarcticaGeo = buildPolygonGeometry(antarcticaJson, landRadius);

    const landMat = new MeshBasicMaterial({
        color: new Color(atlasTuning.landColor),
        side: DoubleSide,
    });
    const antarcticaMat = new MeshBasicMaterial({
        color: new Color(atlasTuning.antarcticaColor),
        side: DoubleSide,
    });

    const land       = new Mesh(landGeo, landMat);
    const antarctica = new Mesh(antarcticaGeo, antarcticaMat);
    land.renderOrder       = 1;
    antarctica.renderOrder = 1;
    scene.add(land);
    scene.add(antarctica);

    onAtlasColorChange((t) => {
        landMat.color.set(t.landColor);
        antarcticaMat.color.set(t.antarcticaColor);
    });
    onAtlasVisibilityChange((t) => {
        land.visible       = t.showLand;
        antarctica.visible = t.showLand;
    });

    return { land, antarctica, boundaryGroups: [] };
}
```

Notes:
- `geoToVec3` from `feed.js` returns a vector at `EARTH_RADIUS - depth`; we override magnitude with `.normalize().multiplyScalar(radius)` so the land sits at exactly `radius * 1.0005` regardless of `feed.js`'s depth handling.
- `BufferGeometry.computeVertexNormals` is fine for `MeshBasicMaterial` (which ignores normals) but lets future material swaps work without rebuilding.

- [ ] **Step 2: Update `src/main.js` to construct atlas tuning + call `loadAtlas`**

Open `src/main.js`. The current top imports look like:

```javascript
import { Clock } from 'three';
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';
import { showDetail, hideDetail } from './detail.js';
```

Add two new imports:

```javascript
import { buildAtlasGui } from './atlasTuning.js';
import { loadAtlas } from './atlas.js';
```

Just after the existing `buildGui();` line, add:

```javascript
buildAtlasGui();
```

`CRUST_RADIUS` is already a named export of `src/scene.js`. Add it to the existing `createScene` import:

```javascript
import { createScene, CRUST_RADIUS } from './scene.js';
```

Then after `buildAtlasGui();` add:

```javascript
loadAtlas({ scene, radius: CRUST_RADIUS });
```

Final relevant slice should look like:

```javascript
const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();
buildAtlasGui();
loadAtlas({ scene, radius: CRUST_RADIUS });
```

- [ ] **Step 3: Verify**

The dev server should already be running (`bun run dev`). If it's not:

```bash
bun run dev > /tmp/eqdev/server.log 2>&1 &
sleep 3
cat /tmp/eqdev/server.log | head -3
```

Expected: a "Dev server: http://localhost:3000/" line.

```bash
curl -s -o /dev/null -w "atlas=%{http_code}\n" http://localhost:3000/src/atlas.js
curl -s -o /dev/null -w "atlasTuning=%{http_code}\n" http://localhost:3000/src/atlasTuning.js
```

Expected: both 200.

User will visually verify in the browser:
- A dark-blue continent fill is visible on top of the existing photographic world (the ocean photo is still there from `world.jpg` until Task 5).
- Antarctica is visibly tinted lighter than the rest of the land.
- A second lil-gui panel ("Atlas") appears below the existing one.
- Color pickers in the Atlas panel update the continent fill colors live.
- `showLand` toggle hides both land + antarctica meshes.

Note: the photo globe is still showing through. We're layering on top temporarily. Task 5 removes the photo.

- [ ] **Step 4: Commit**

```bash
git add src/atlas.js src/main.js
git commit -m "Add src/atlas.js: continent + antarctica fills triangulated on sphere"
```

---

## Task 4: Plate boundary lines

Adds the PB2002 boundaries to `atlas.js`. Boundaries are grouped by type, each group is a `LineSegments` with its own material so colors / alphas are independently tunable.

**Files:**
- Modify: `src/atlas.js`

- [ ] **Step 1: Add the PB2002 import + the type→palette mapping**

At the top of `src/atlas.js`, just after the existing geojson imports, add:

```javascript
import boundariesJson from '../data/pb2002_boundaries.geojson' with { type: 'json' };
```

Just under the existing `LAND_RADIUS_FACTOR` constant, add:

```javascript
const BOUNDARY_RADIUS_FACTOR = 1.001;

// PB2002 type code → which tuning palette key + extra alpha multiplier
const BOUNDARY_GROUPS = [
    { key: 'ridge',     types: ['OSR', 'CRB'],            colorKey: 'ridgeColor',     alphaMult: 1.0 },
    { key: 'transform', types: ['OTF', 'CTF'],            colorKey: 'transformColor', alphaMult: 1.0 },
    { key: 'sub',       types: ['SUB'],                   colorKey: 'subColor',       alphaMult: 1.4 },
    { key: 'conv',      types: ['OCB', 'CCB'],            colorKey: 'subColor',       alphaMult: 1.0 },
    // any feature whose Type is none of the above falls into 'other'
];
const KNOWN_TYPES = new Set(BOUNDARY_GROUPS.flatMap((g) => g.types));
```

- [ ] **Step 2: Add the line-builder helper**

Add the following function inside `src/atlas.js`, alongside `buildPolygonGeometry`:

```javascript
import { LineSegments, LineBasicMaterial } from 'three';
// (Replace the existing top-level three import to include these two,
//  or add them as a separate `import { LineSegments, LineBasicMaterial } from 'three';`
//  if you prefer keeping additions append-only.)

function buildLineGeometry(features, radiusKm) {
    const positions = []; // flat segment pairs

    for (const feature of features) {
        const coords = feature.geometry.coordinates; // [[lng, lat], ...]
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng0, lat0] = coords[i];
            const [lng1, lat1] = coords[i + 1];
            const a = geoToVec3(lat0, lng0, 0).normalize().multiplyScalar(radiusKm);
            const b = geoToVec3(lat1, lng1, 0).normalize().multiplyScalar(radiusKm);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    return geo;
}
```

If you went with the merged-import approach, the top of `src/atlas.js` should now import:

```javascript
import {
    Mesh,
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    LineSegments,
    LineBasicMaterial,
    DoubleSide,
    Color,
} from 'three';
```

- [ ] **Step 3: Build and add boundary groups inside `loadAtlas`**

Replace the body of `loadAtlas({ scene, radius })` (the function from Task 3) with:

```javascript
export function loadAtlas({ scene, radius }) {
    const landRadius     = radius * LAND_RADIUS_FACTOR;
    const boundaryRadius = radius * BOUNDARY_RADIUS_FACTOR;

    // ----- Land + Antarctica (Task 3) -----
    const landGeo       = buildPolygonGeometry(landJson, landRadius);
    const antarcticaGeo = buildPolygonGeometry(antarcticaJson, landRadius);
    const landMat       = new MeshBasicMaterial({ color: new Color(atlasTuning.landColor),       side: DoubleSide });
    const antarcticaMat = new MeshBasicMaterial({ color: new Color(atlasTuning.antarcticaColor), side: DoubleSide });
    const land          = new Mesh(landGeo, landMat);
    const antarctica    = new Mesh(antarcticaGeo, antarcticaMat);
    land.renderOrder = 1;
    antarctica.renderOrder = 1;
    scene.add(land);
    scene.add(antarctica);

    // ----- Plate boundaries (this task) -----
    // Bucket features by group
    const otherFeatures = [];
    const groupedFeatures = Object.fromEntries(BOUNDARY_GROUPS.map((g) => [g.key, []]));
    for (const f of boundariesJson.features) {
        const t = (f.properties && f.properties.Type) || '';
        const grp = BOUNDARY_GROUPS.find((g) => g.types.includes(t));
        if (grp) groupedFeatures[grp.key].push(f);
        else otherFeatures.push(f);
    }

    const boundaryGroups = [];
    for (const g of BOUNDARY_GROUPS) {
        const geo = buildLineGeometry(groupedFeatures[g.key], boundaryRadius);
        const mat = new LineBasicMaterial({
            color: new Color(atlasTuning[g.colorKey]),
            transparent: true,
            opacity: Math.min(1, atlasTuning.boundaryWidth * g.alphaMult),
        });
        const lines = new LineSegments(geo, mat);
        lines.renderOrder = 2;
        scene.add(lines);
        boundaryGroups.push({ key: g.key, colorKey: g.colorKey, alphaMult: g.alphaMult, material: mat, mesh: lines });
    }
    // 'other' bucket
    const otherGeo = buildLineGeometry(otherFeatures, boundaryRadius);
    const otherMat = new LineBasicMaterial({
        color: new Color(atlasTuning.otherColor),
        transparent: true,
        opacity: atlasTuning.otherAlpha * atlasTuning.boundaryWidth,
    });
    const otherLines = new LineSegments(otherGeo, otherMat);
    otherLines.renderOrder = 2;
    scene.add(otherLines);
    boundaryGroups.push({ key: 'other', colorKey: 'otherColor', alphaMult: 1.0, material: otherMat, mesh: otherLines, isOther: true });

    // ----- Live tuning -----
    onAtlasColorChange((t) => {
        landMat.color.set(t.landColor);
        antarcticaMat.color.set(t.antarcticaColor);
        for (const g of boundaryGroups) {
            g.material.color.set(t[g.colorKey]);
            const baseAlpha = g.isOther ? t.otherAlpha : 1.0;
            g.material.opacity = Math.min(1, baseAlpha * t.boundaryWidth * g.alphaMult);
        }
    });
    onAtlasVisibilityChange((t) => {
        land.visible       = t.showLand;
        antarctica.visible = t.showLand;
        for (const g of boundaryGroups) g.mesh.visible = t.showBoundaries;
    });

    return { land, antarctica, boundaryGroups };
}
```

- [ ] **Step 4: Verify**

Dev server still running. Re-curl to confirm bundle picks up the change (Bun HMR auto-rebuilds):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/src/atlas.js
```

Expected: 200.

User will visually verify in browser:
- Plate boundary lines are drawn over the globe.
- Magenta (default `#d840ff`) along Mid-Atlantic Ridge, East Pacific Rise.
- Deep purple (`#6020c0`) along the Pacific Ring of Fire, with subduction trenches subtly bolder than convergent boundaries.
- Pale gold (`#f0c060`) along major transforms (San Andreas, Anatolian, Macquarie).
- `showBoundaries` toggle hides the boundary layer; `boundaryWidth` slider visibly thickens (via opacity) all groups.
- Color pickers update each line group live.
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/atlas.js
git commit -m "Add PB2002 plate boundary line groups, palette-coded by type"
```

---

## Task 5: Drop `world.jpg` and switch crust to flat color

**Files:**
- Modify: `src/scene.js`
- Delete: `img/world.jpg`

- [ ] **Step 1: Update `src/scene.js`**

The current `src/scene.js` (after the upgrade) imports a TextureLoader. Replace the entire file with:

```javascript
// src/scene.js — Scene, Camera, Renderer, plain-color crust globe.
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Object3D,
    SphereGeometry,
    MeshBasicMaterial,
    Mesh,
    DoubleSide,
    Color,
} from 'three';
import { atlasTuning, onAtlasColorChange } from './atlasTuning.js';

export const CRUST_RADIUS = 6367;

export function createScene(container) {
    const scene = new Scene();

    const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(-4100, 4100, 0);
    camera.lookAt(CRUST_RADIUS, CRUST_RADIUS + 200, 0);

    const camGroup = new Object3D();
    camGroup.add(camera);
    scene.add(camGroup);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const crustMat = new MeshBasicMaterial({ color: new Color(atlasTuning.oceanColor), side: DoubleSide });
    const crust = new Mesh(new SphereGeometry(CRUST_RADIUS, 32, 32), crustMat);
    scene.add(crust);

    onAtlasColorChange((t) => {
        crustMat.color.set(t.oceanColor);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, camGroup, renderer, crust };
}
```

Notes:
- `TextureLoader`, `ClampToEdgeWrapping`, `LinearFilter`, `SRGBColorSpace` imports are gone.
- The crust is now a plain dark-ocean sphere; atlas paints continents on top.
- The ocean color is live-tunable from the atlas panel.

- [ ] **Step 2: Delete the photo texture**

```bash
rm img/world.jpg
```

(There may be other unused images in `img/` — `cloud.png`, `core.jpg`, etc. Don't touch them; out of scope.)

- [ ] **Step 3: Verify the build script doesn't choke on the missing file**

The `package.json` build script copies `img/` wholesale:

```bash
bun run build 2>&1 | tail -10
```

Expected: a clean build. The `cp -R img dist/img` step still copies whatever's left in `img/` (no `world.jpg`).

- [ ] **Step 4: Verify visually**

Dev server is running. User reloads:

- The photo globe is gone.
- The sphere is dark blue (`#0a1428`).
- Continents in slightly-lighter `#1a2238`, Antarctica `#2a3548`.
- Plate boundaries on top.
- Quake markers + rings still on top of everything.
- `oceanColor` picker in the Atlas panel updates the sphere color live.
- Network tab: no request for `world.jpg`.

- [ ] **Step 5: Commit**

```bash
git add src/scene.js img/world.jpg
git commit -m "Drop world.jpg; crust becomes flat-colored sphere driven by atlas tuning"
```

(Note: `git add img/world.jpg` after `rm` stages the deletion.)

---

## Task 6: Production build + final design checklist

**Files:**
- (none modified; this is the verification gate before merging)

- [ ] **Step 1: Production build**

```bash
bun run build 2>&1 | tail -10
ls -la dist/
```

Expected:
- `dist/index.html`, `dist/index-*.js`, `dist/index-*.css`, `dist/img/` (without `world.jpg`).
- The bundled JS is now larger by roughly the GeoJSON sizes (~190 KB raw, gzipped much smaller).

- [ ] **Step 2: Smoke-test the dist/ build**

```bash
cd dist && python3 -m http.server 8765 > /tmp/dist-srv.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "html=%{http_code}\n" http://localhost:8765/
pkill -f "http.server 8765" 2>/dev/null
cd ..
```

Expected: `html=200`. (Visual verification in browser is the user's job; load `http://localhost:8765/` and confirm the same atlas + markers appear as in dev.)

- [ ] **Step 3: Run the full design checklist**

Walk these in `bun run dev`:

- [ ] All marker behavior unchanged: blobs pulse + warp, rings expand, click → detail panel.
- [ ] Loading overlay still shakes + fades.
- [ ] Drag rotates; arrow keys orbit; markers stay clickable.
- [ ] No console errors.
- [ ] Network tab: no request for `world.jpg`.
- [ ] Sphere is dark blue (`#0a1428`).
- [ ] Continents fill slightly lighter (`#1a2238`); Antarctica icier (`#2a3548`).
- [ ] PB2002 plate boundaries render globally:
  - [ ] Magenta along Mid-Atlantic Ridge / East Pacific Rise (divergent).
  - [ ] Deep purple along Pacific Ring of Fire arcs (subduction).
  - [ ] Pale gold along major transforms (San Andreas, Anatolian).
- [ ] Atlas folder in lil-gui shows all controls; color changes propagate live.
- [ ] `showLand` / `showBoundaries` toggles work.
- [ ] localStorage persists atlas tuning across reload (key `eq-atlas-tuning`).
- [ ] Reset atlas restores the documented default values.
- [ ] `bun run build` produces a `dist/` that loads under any static server.

- [ ] **Step 4: Final commit (if any tweaks were made)**

```bash
git add -A
git status   # confirm only intended changes
git commit -m "Stage A complete: vector atlas with PB2002 plate boundaries"
```

If nothing needed tweaking, skip this commit.

---

## Done

Stage A is complete. The next stage (Stage B) adds Slab2 contours + MORVEL plate motion arrows. Do that as a fresh brainstorm/spec/plan cycle once Stage A merges.

Suggest the user run `/ultrareview` against the branch for a multi-agent review, or merge to master if satisfied.
