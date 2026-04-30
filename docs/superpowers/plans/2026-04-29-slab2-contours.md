# Slab2 Contour Ribbons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Slab2 depth-contour layer rendering 8 iso-depth contour ribbons (50/100/200/300/400/500/600/700 km) per subducting slab, with per-vertex colors driven by a swappable Strategy registry.

**Architecture:** A new prep script fetches per-zone Slab2 contour files from USGS ScienceBase, parses the GMT format, filters depths, splits antimeridian crossings, and emits a combined GeoJSON. A new `src/slab2.js` module loads the GeoJSON and builds one `LineSegments2` per zone with per-vertex colors via `LineGeometry.setColors()`. A new `src/slabColors.js` module exports a `colorStrategies` registry. `atlasTuning.js` gains 4 keys + a "Slabs" GUI folder. `main.js` calls `loadSlab2` after `loadAtlas`. `atlas.js` is **not** modified.

**Tech Stack:** Bun, Three.js (`LineSegments2 + LineMaterial` from `three/examples/jsm/lines/`), lil-gui, vanilla ES modules.

**Spec:** `docs/superpowers/specs/2026-04-29-slab2-contours-design.md`

**Branch:** Create `feat/slabs` off `master` before starting.

---

## File Structure

**Modified:**
- `src/atlasTuning.js` — adds `showSlabs`, `slabWidth`, `slabOpacity`, `slabColorStrategy` keys + "Slabs (Slab2)" GUI folder (Task 4).
- `src/main.js` — imports + calls `loadSlab2`, hooks the slab module to atlasTuning listeners (Task 4).
- `index.html` — `#data-credits` footer adds Slab2 credit (Task 5).
- `README.md` — adds Slab2 bullet to "Data Sources" section (Task 5).
- `package.json` — adds `prep-slab2` script (Task 1).

**Created:**
- `scripts/prep-slab2.js` — fetches Slab2 from USGS ScienceBase, parses GMT, filters, emits GeoJSON (Task 1).
- `data/slab2_contours.geojson` — output of the prep step. Committed. Estimated ~1–2 MB.
- `src/slabColors.js` — Strategy registry: `DEPTHS` constant + `colorStrategies` object (Task 2).
- `src/slab2.js` — `loadSlab2`, `setColorStrategy`, `setVisible`, `setGlow` (Task 3).

**Not modified:** `src/atlas.js`. The slab layer is a sibling, not a fifth boundary group.

---

## Task 1: Prep script + commit data file

**Files:**
- Create: `scripts/prep-slab2.js`
- Create: `data/slab2_contours.geojson` (output of running script)
- Modify: `package.json` (adds `prep-slab2` script)

- [ ] **Step 1: Write the prep script**

Create `scripts/prep-slab2.js`:

```js
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

// Depths we want to render. Drop everything else from the contour files.
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

// Extract the zone code from a contour filename like
// "alu_slab2_contours_02.23.18.in" → "alu".
function zoneCodeFromFilename(name) {
    const m = name.match(/^([a-z]{2,4})_slab2_contours/i);
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
```

- [ ] **Step 2: Add the script to `package.json`**

Modify `package.json`'s `scripts` block. Current contents:

```json
  "scripts": {
    "dev": "bun run dev.js",
    "build": "rm -rf dist && bun build ./index.html --outdir=dist --minify && cp -R img dist/img",
    "prep-data": "bun run scripts/prep-atlas-data.js"
  },
```

Replace with:

```json
  "scripts": {
    "dev": "bun run dev.js",
    "build": "rm -rf dist && bun build ./index.html --outdir=dist --minify && cp -R img dist/img",
    "prep-data": "bun run scripts/prep-atlas-data.js",
    "prep-slab2": "bun run scripts/prep-slab2.js"
  },
```

- [ ] **Step 3: Run the prep script**

```bash
bun run prep-slab2
```

Expected output: a `Fetching Slab2 children of parent ...` line, `Found 27 child items`, then per-zone log lines like `  alu: <N> segments across 8 depths`. Final line: `Wrote data/slab2_contours.geojson — <N> features from 27 zones (0 skipped).`

If the script errors or skips many zones, STOP. Possible issues:
- ScienceBase moved the URL pattern.
- The `_contours.in` filename regex doesn't match this Slab2 release (e.g., the date format changed).
- A zone has no contour file (overturning slabs use `_sup.csv` instead — those would be skipped, which is OK for v1).

If 1–4 zones are skipped (overturning slabs without contour files), proceed.
If 5+ zones are skipped, STOP and re-check the script regex against actual filenames.

- [ ] **Step 4: Sanity-check the output**

```bash
ls -lh data/slab2_contours.geojson
bun -e 'const j=JSON.parse(await Bun.file("data/slab2_contours.geojson").text()); console.log(j.features.length,"features"); const depths=new Set(j.features.map(f=>f.properties.depth_km)); console.log("depths:",[...depths].sort((a,b)=>a-b)); const zones=new Set(j.features.map(f=>f.properties.zone)); console.log("zones:",zones.size,[...zones].sort().join(","));'
```

Expected:
- File size ~700–900 KB.
- Feature count ~150–250 (170 typical for the current 27-zone Slab2 release with the 8-depth filter).
- `depths:` should print exactly `[ 40, 100, 200, 300, 400, 500, 600, 700 ]`.
- `zones:` should print 23–27 (some overturning zones may legitimately be skipped) with codes like `alu, cal, cas, cot, hal, hel, him, hin, izu, ker, kur, mak, man, mex, mue, pam, phi, png, puy, ryu, sam, sco, sol, sul, sum, van`.

If any depth is outside the expected set, STOP — the regex extracted depths incorrectly.
If feature count is outside 500–10,000, STOP — something's off.

- [ ] **Step 5: Commit**

```bash
git add scripts/prep-slab2.js package.json data/slab2_contours.geojson
git commit -m "$(cat <<'EOF'
slabs: prep script fetches Slab2 contours from USGS ScienceBase

Fetches all 27 per-zone children from the Slab2 release (DOI
10.5066/F7PV6JNV), pulls each zone's *_contours.in file, parses the
GMT multi-segment ASCII format, filters to the 8 chosen depths
(50/100/200/300/400/500/600/700 km), splits antimeridian crossings,
rounds coords to 2 decimals, and emits data/slab2_contours.geojson.

Output is committed (~1-2 MB). Raw Slab2 data is fetched on-demand
per prep run, never committed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Color strategies module

**Files:**
- Create: `src/slabColors.js`

- [ ] **Step 1: Write the strategy module**

Create `src/slabColors.js`:

```js
// src/slabColors.js — Slab2 color Strategy registry.
//
// Each strategy maps a depth-in-km to a THREE.Color. The active strategy
// is named in atlasTuning.slabColorStrategy and looked up by name from
// `colorStrategies`. Adding a new strategy = adding one entry to the
// registry; the GUI dropdown auto-populates from Object.keys(colorStrategies).
import { Color } from 'three';

// The 8 depth contours we render, in km. The depth values must be a subset
// of what's in data/slab2_contours.geojson (set by scripts/prep-slab2.js).
export const DEPTHS = [40, 100, 200, 300, 400, 500, 600, 700];

// ---- Strategy: viridis (default) -----------------------------------------
// 8-stop sample from the viridis colormap, perceptually uniform purple→yellow.
// Hex values picked to roughly match the canonical viridis at 8 evenly spaced
// positions in [0,1].
const VIRIDIS_STOPS = [
    '#440154', // 40 km (shallowest)
    '#482878',
    '#3e4a89',
    '#31688e',
    '#26828e',
    '#1f9e89',
    '#35b779',
    '#fde725', // 700 km (deepest)
];

function depthIndex(depthKm) {
    const i = DEPTHS.indexOf(depthKm);
    return i >= 0 ? i : 0;  // unknown depth → use shallowest color (defensive)
}

function viridis(depthKm) {
    return new Color(VIRIDIS_STOPS[depthIndex(depthKm)]);
}

// ---- Strategy: markerExtended -------------------------------------------
// Reuses the earthquake-marker palette for shallow contours (50, 100, 200,
// 300 km), then extends into deep indigos for 400-700. Visual continuity
// with the existing earthquake markers (which use ember/mid/cyan via
// tuning.emberHex/midHex/cyanHex).
const MARKER_EXTENDED_STOPS = [
    '#ffeebb', // 40  — ember (shallow)
    '#ff7733', // 100 — mid
    '#22ccff', // 200 — cyan
    '#3344aa', // 300 — deep blue
    '#221166', // 400
    '#11084a', // 500
    '#080530', // 600
    '#03021a', // 700 — near-black
];

function markerExtended(depthKm) {
    return new Color(MARKER_EXTENDED_STOPS[depthIndex(depthKm)]);
}

// ---- Strategy: single ---------------------------------------------------
// All depths share one muted color. Depth distinction comes only from
// the contour's radial position. Useful as a low-information-density
// fallback or for debugging.
function single(_depthKm) {
    return new Color('#7a5a3c');
}

// ---- Public registry -----------------------------------------------------
export const colorStrategies = {
    viridis,
    markerExtended,
    single,
};

// Resolve a strategy by name with safe fallback.
export function resolveStrategy(name) {
    return colorStrategies[name] || colorStrategies.viridis;
}
```

- [ ] **Step 2: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. The new module isn't imported anywhere yet (Task 3 imports it), so the bundle doesn't grow yet.

- [ ] **Step 3: Commit**

```bash
git add src/slabColors.js
git commit -m "$(cat <<'EOF'
slabs: color Strategy registry (viridis / markerExtended / single)

Creates src/slabColors.js exporting a registry of depth→Color
functions. viridis is the default (perceptually uniform purple→yellow,
8 stops covering the chosen depths). markerExtended reuses the
earthquake-marker palette for shallow depths and extends into deep
indigos. single is a flat color for low-density rendering / debugging.

DEPTHS constant lives here too. Adding a new strategy is one entry
in the colorStrategies object — the GUI dropdown will auto-pick it up
when wired in Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Slab2 render module

**Files:**
- Create: `src/slab2.js`

- [ ] **Step 1: Write the render module**

Create `src/slab2.js`:

```js
// src/slab2.js — USGS Slab2 depth-contour render layer.
//
// Builds one LineSegments2 per subduction zone, with all 8 depth contours
// combined inside the per-zone geometry. Per-vertex colors come from the
// active color strategy. A `uGlow` uniform on each material allows future
// click-to-glow per zone — not wired to interaction yet.
import { Color } from 'three';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import slabsJson from '../data/slab2_contours.geojson' with { type: 'json' };
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import { resolveStrategy } from './slabColors.js';

// Group features by zone code so we can build one mesh per zone.
function groupByZone(features) {
    const groups = new Map();
    for (const f of features) {
        const z = f.properties.zone;
        if (!groups.has(z)) groups.set(z, []);
        groups.get(z).push(f);
    }
    return groups;
}

// Convert (lon, lat, depthKm) → 3D position on a sphere of radius
// (CRUST_RADIUS - depthKm). Returns [x, y, z].
//
// Coordinate convention matches src/feed.js's geoToVec3 with depth=0,
// then radially shrinks. The phi/theta math is the same equirectangular
// projection used elsewhere in the codebase.
const TEXTURE_EDGE_LNG = -180.806168; // matches feed.js + atlas.js
const DEG = Math.PI / 180;
function geoToVec3Depth(lat, lng, depthKm, crustRadius) {
    const r = crustRadius - depthKm;
    const phi = (90 - lat) * DEG;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * DEG;
    const sp = Math.sin(phi);
    return [r * sp * Math.cos(theta), r * Math.cos(phi), r * sp * Math.sin(theta)];
}

// Build one zone mesh. Combines all features for the zone into one
// LineGeometry. Each feature is a LineString; we expand it into adjacent
// vertex pairs (segment endpoints) since LineSegments2 expects segment data.
function buildZoneMesh(zone, features, strategy, crustRadius) {
    const positions = [];   // flat [x,y,z, x,y,z, ...] in segment order
    const colors = [];      // flat [r,g,b, r,g,b, ...] one per *original* vertex
    for (const f of features) {
        const depthKm = f.properties.depth_km;
        const colorObj = strategy(depthKm);
        const coords = f.geometry.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const [lon0, lat0] = coords[i];
            const [lon1, lat1] = coords[i + 1];
            const a = geoToVec3Depth(lat0, lon0, depthKm, crustRadius);
            const b = geoToVec3Depth(lat1, lon1, depthKm, crustRadius);
            positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
            // Two vertices per segment, both same color (whole contour is one depth)
            colors.push(colorObj.r, colorObj.g, colorObj.b, colorObj.r, colorObj.g, colorObj.b);
        }
    }

    const geo = new LineGeometry();
    geo.setPositions(new Float32Array(positions));
    // IMPORTANT: LineGeometry has its own setColors() API for fat lines.
    // Do NOT use setAttribute('color', ...) — they're different paths.
    geo.setColors(new Float32Array(colors));

    const mat = new LineMaterial({
        vertexColors: true,
        transparent: true,
        opacity: atlasTuning.slabOpacity,
        linewidth: Math.max(0.05, atlasTuning.slabWidth * atlasTuning.boundaryWidth),
        worldUnits: false,
        dashed: false,
    });
    mat.resolution.set(window.innerWidth, window.innerHeight);

    // Future click-to-glow hook: each mesh exposes a uGlowRef on userData.
    // The shader-side wiring (uniform injection via onBeforeCompile + a
    // fragment-shader patch that brightens output by uGlow) is deferred
    // until the click-to-glow handler is implemented — that task can pin
    // the regex against the live three.js LineMaterial source instead of
    // guessing here. For now setGlow(zone, factor) just stores the value;
    // visual effect will appear when the future task wires the shader.
    const uGlowRef = { value: 0.0 };

    const mesh = new LineSegments2(geo, mat);
    mesh.renderOrder = 1;
    mesh.userData = { zone, isSlab: true, uGlowRef };
    mesh.visible = atlasTuning.showSlabs;
    return mesh;
}

export function loadSlab2({ scene, radius }) {
    const grouped = groupByZone(slabsJson.features);
    const slabZones = new Map();   // zone → mesh
    let strategy = resolveStrategy(atlasTuning.slabColorStrategy);

    for (const [zone, features] of grouped) {
        const mesh = buildZoneMesh(zone, features, strategy, radius);
        scene.add(mesh);
        slabZones.set(zone, mesh);
    }

    // Resize handler — keep LineMaterial.resolution in sync with viewport.
    function updateResolution() {
        const w = window.innerWidth, h = window.innerHeight;
        for (const mesh of slabZones.values()) {
            mesh.material.resolution.set(w, h);
        }
    }
    window.addEventListener('resize', updateResolution);

    // Apply per-color-change updates from atlasTuning.
    function applyColors(t) {
        const next = resolveStrategy(t.slabColorStrategy);
        const strategyChanged = next !== strategy;
        strategy = next;
        for (const [zone, mesh] of slabZones) {
            mesh.material.opacity = Math.min(1, t.slabOpacity);
            mesh.material.linewidth = Math.max(0.05, t.slabWidth * t.boundaryWidth);
            if (strategyChanged) {
                // Rebuild the color buffer for this zone.
                const features = grouped.get(zone);
                const colors = [];
                for (const f of features) {
                    const c = strategy(f.properties.depth_km);
                    const segCount = f.geometry.coordinates.length - 1;
                    for (let i = 0; i < segCount; i++) {
                        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
                    }
                }
                mesh.geometry.setColors(new Float32Array(colors));
            }
        }
    }
    onAtlasColorChange(applyColors);

    // Apply visibility updates.
    onAtlasVisibilityChange((t) => {
        for (const mesh of slabZones.values()) {
            mesh.visible = t.showSlabs;
        }
    });

    return {
        // Future-flex hooks (not consumed in v1, but designed in).
        setColorStrategy: (name) => {
            atlasTuning.slabColorStrategy = name;
            applyColors(atlasTuning);
        },
        setVisible: (zone, bool) => {
            const m = slabZones.get(zone);
            if (m) m.visible = bool;
        },
        setGlow: (zone, factor) => {
            const m = slabZones.get(zone);
            if (m) m.userData.uGlowRef.value = factor;
        },
        zones: slabZones,
    };
}
```

- [ ] **Step 2: Build-check (the module exists but isn't called yet)**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. The module is created but isn't imported by `main.js` yet — Task 4 wires it. Bundle stays the same size.

The module DOES reference `atlasTuning.slabOpacity`, `atlasTuning.slabWidth`, `atlasTuning.showSlabs`, `atlasTuning.slabColorStrategy` keys that don't exist yet in `atlasTuning.js` — but those are read at function-call time inside `loadSlab2`, which isn't invoked yet. Build is static; the missing keys don't cause a build-time error.

- [ ] **Step 3: Commit**

```bash
git add src/slab2.js
git commit -m "$(cat <<'EOF'
slabs: render module — loadSlab2 + per-zone meshes + glow uniform

Creates src/slab2.js with:
- loadSlab2({scene, radius}) builds 27 LineSegments2 zone meshes from
  data/slab2_contours.geojson. Each mesh combines all 8 depth contours
  for that zone with per-vertex colors via LineGeometry.setColors().
  Coordinates flatten to (lon, lat, depth) → sphere position at radius
  CRUST_RADIUS - depth.
- mesh.userData.uGlowRef exposes the future glow uniform reference;
  setGlow(zone, factor) mutates it. Shader-side wiring (onBeforeCompile +
  fragment patch) is deferred to the click-to-glow handler task — that
  way the regex can be pinned against live three.js source instead of
  guessed here. setGlow is a stub for now.
- atlasTuning listeners drive opacity, width, color-strategy swap.
- Returns { setColorStrategy, setVisible, setGlow, zones } for future
  click-to-glow plumbing (not wired yet — atlas is sibling layer, GUI
  wiring lands in Task 4).

Module imports atlasTuning keys (slabOpacity, slabWidth, showSlabs,
slabColorStrategy) that don't exist until Task 4. Build still passes
because those reads happen at call time, not import time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: atlasTuning + GUI + main.js wiring (slabs go live)

**Files:**
- Modify: `src/atlasTuning.js`
- Modify: `src/main.js`

- [ ] **Step 1: Add four keys + GUI folder to `src/atlasTuning.js`**

In `src/atlasTuning.js`'s `defaults` object, locate the existing Faults block:

```js
    // Faults (GEM Global Active Faults)
    showFaults:    true,
    faultColor:    '#7a5a3c',
    faultWidth:    0.5,    // multiplier on boundaryWidth
    faultOpacity:  0.4,
```

Add a new Slabs block immediately after it:

```js
    // Slabs (USGS Slab2 depth contours)
    showSlabs:          true,
    slabWidth:          0.5,    // multiplier on boundaryWidth
    slabOpacity:        0.6,
    slabColorStrategy:  'viridis',
```

In `buildAtlasGui`, locate the existing `fFaults` folder block:

```js
    const fFaults = gui.addFolder('Faults');
    bindVis  (fFaults.add(atlasTuning, 'showFaults'));
    bindColor(fFaults.addColor(atlasTuning, 'faultColor'));
    bindColor(fFaults.add(atlasTuning, 'faultWidth',   0, 2, 0.05));
    bindColor(fFaults.add(atlasTuning, 'faultOpacity', 0, 1, 0.01));
```

Add a new Slabs folder immediately after it:

```js
    const fSlabs = gui.addFolder('Slabs (Slab2)');
    bindVis  (fSlabs.add(atlasTuning, 'showSlabs'));
    bindColor(fSlabs.add(atlasTuning, 'slabWidth',   0, 2, 0.05));
    bindColor(fSlabs.add(atlasTuning, 'slabOpacity', 0, 1, 0.01));
    bindColor(fSlabs.add(atlasTuning, 'slabColorStrategy', ['viridis', 'markerExtended', 'single']));
```

Note: the strategy dropdown lists strategy names statically as the third arg to `add()`. This doesn't auto-populate from the registry (lil-gui doesn't support reactive options arrays cleanly), but the list matches the registry's keys. If a future strategy is added, both `src/slabColors.js` and this list need updating — keep them in sync.

- [ ] **Step 2: Wire `loadSlab2` into `src/main.js`**

In `src/main.js`, locate the existing imports (the block ending with `import { loadAtlas } from './atlas.js';`).

Add after the `loadAtlas` import:

```js
import { loadSlab2 } from './slab2.js';
```

Then locate the existing `loadAtlas` call:

```js
const atlas = loadAtlas({ scene, radius: CRUST_RADIUS });
const crust = atlas.crust;
```

Add after it:

```js
const slabs = loadSlab2({ scene, radius: CRUST_RADIUS });
```

(`slabs` is captured for future click-to-glow wiring; for v1 it's not consumed elsewhere in main.js, but the GUI listeners inside `slab2.js` keep the layer live.)

- [ ] **Step 3: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. Bundle size jumps to ~7 MB minified (the GeoJSON inlined). Module count goes from 22 to 24 (`slab2.js` + `slabColors.js` + LineGeometry/LineSegments2/LineMaterial all already counted... actually 23-24 depending on what's already bundled). Just confirm no errors / warnings about missing modules.

- [ ] **Step 4: Commit**

```bash
git add src/atlasTuning.js src/main.js
git commit -m "$(cat <<'EOF'
slabs: atlasTuning keys + Slabs GUI folder + main.js wiring

Adds showSlabs/slabWidth/slabOpacity/slabColorStrategy defaults,
constructs a "Slabs (Slab2)" GUI folder between Faults and Visibility
with 4 controllers (toggle / width / opacity / strategy dropdown),
and calls loadSlab2 from main.js immediately after loadAtlas.

After this commit the slab layer renders. Bundle size grows by
~1-2 MB to inline data/slab2_contours.geojson.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Attribution

**Files:**
- Modify: `index.html`
- Modify: `README.md`

- [ ] **Step 1: Update `#data-credits` in `index.html`**

Locate the existing `<div id="data-credits">` block:

```html
    <div id="data-credits">
        Plate boundaries: PB2002 (Bird, 2003).
        Faults: <a href="https://github.com/GEMScienceTools/gem-global-active-faults" target="_blank" rel="noopener">GEM Global Active Faults</a> (Styron &amp; Pagani, 2020) — CC-BY-SA.
    </div>
```

Replace with:

```html
    <div id="data-credits">
        Plate boundaries: PB2002 (Bird, 2003).
        Faults: <a href="https://github.com/GEMScienceTools/gem-global-active-faults" target="_blank" rel="noopener">GEM Global Active Faults</a> (Styron &amp; Pagani, 2020) — CC-BY-SA.
        Slabs: <a href="https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467" target="_blank" rel="noopener">USGS Slab2</a> (Hayes et al., 2018) — public domain.
    </div>
```

- [ ] **Step 2: Add a Slab2 bullet to `README.md`'s Data Sources section**

Locate the existing Data Sources block in `README.md`. The block contains four bullets (Plate boundaries, Active faults, Land + countries, Earthquake feed). Insert a new bullet between the existing "Active faults" bullet and the "Land + countries" bullet:

```markdown
- **Subducting slabs:** USGS Slab2 (Hayes, G. P. et al. 2018. "Slab2, a comprehensive subduction zone geometry model." *Science* 362(6410): 160–180. doi:10.1126/science.aat4723; data release doi:10.5066/F7PV6JNV). Sourced from [USGS ScienceBase](https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467). License: U.S. Government work, public domain.
```

- [ ] **Step 3: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add index.html README.md
git commit -m "$(cat <<'EOF'
slabs: attribution for USGS Slab2

Adds Slab2 credit to the #data-credits footer with link to ScienceBase
and Hayes et al. 2018 citation. Adds README Data Sources bullet noting
both the paper DOI and the data-release DOI, with public-domain license
note. Slab2 is a U.S. Government work — no legal attribution requirement,
but credit is included for transparency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verification

**Files:** None modified — confirms the cumulative result.

- [ ] **Step 1: Production build**

```bash
bun run build
ls -lh dist/
```

Expected: `dist/` contains `index.html`, `index-*.js` (~6.5–7.5 MB), `index-*.css` (~18 KB), and `img/`. Build completes without warnings.

- [ ] **Step 2: Bundle reference checks**

```bash
grep -o "Slab2\|sciencebase\|aat4723" dist/index.html | head -3
grep -c "USGS\|Slab2" dist/index.html
```

Expected: at least 2-3 matches in `dist/index.html` (from the credit footer). The minified JS won't be searchable for these strings — the Slab2 DATA is inlined as numeric arrays, not as readable text.

- [ ] **Step 3: Manual browser smoke test**

```bash
bun run dev
```

Open `http://localhost:3000/` in a browser. Required scenarios — must pass before this branch is shippable:

- **Contours visible at major subduction zones.** Orbit toward NW US (Cascadia), Tonga / Kermadec, Sumatra, Japan, Aleutians, the Andes (South America). Each should show curved colored ribbons descending into the planet.
- **Color ramp readable.** Shallow contours (50 km, near the surface) and deep contours (700 km, well below the surface) are visually distinct under the default `viridis` strategy.
- **Antimeridian zones look correct.** Tonga, Kermadec, and the Aleutians don't draw spurious globe-wide horizontal sweeps — segments are properly split.
- **Plate boundaries paint over slabs.** At intersections (e.g., the Tonga trench), purple/orange/violet plate-boundary lines should be the dominant visual, with slab contours visible underneath.
- **Faults still render.** No regression — the existing fault layer is unaffected.
- **GUI: Slabs folder present.** Atlas panel (top-left) shows folders Colors, Geometry, Faults, **Slabs (Slab2)**, Visibility. Slabs folder has 4 controls.
- **Show/hide:** toggling `showSlabs` cleanly hides and reveals the slab layer.
- **Width / opacity:** the two sliders update the layer live.
- **Strategy swap.** Drag through the strategy dropdown — the slab layer recolors live with no visible re-render lag (color buffer rewrite per zone is fast at this data size). The `markerExtended` strategy should make shallow slabs warm (ember/orange) and deep slabs cool (indigo). The `single` strategy should flatten everything to a brown.
- **boundaryWidth interaction.** The global `boundaryWidth` slider scales slab linewidth proportionally (because `slabWidth` is a multiplier).
- **Reset.** "Reset atlas" returns all four slab keys to defaults (`true`, `0.5`, `0.6`, `'viridis'`).
- **Console clean.** No errors or warnings in browser devtools.
- **Credit footer visible.** Bottom-left shows three credits (plate boundaries / faults / slabs). The Slab2 link is clickable.
- **Pointer-events fix from prior branch holds.** Orbit-drag near the bottom-left corner (where the credits are) doesn't hiccup.

Stop the dev server.

- [ ] **Step 4: localStorage compatibility check**

In the browser console (with the dev server running):

```js
localStorage.clear();
location.reload();
```

After reload: Slabs panel still shows defaults, slabs render at the default viridis ramp. Then refresh again to confirm stored state from the previous session merges cleanly with defaults.

- [ ] **Step 5: Branch summary commit (only if any fixes applied)**

If verification surfaced no issues, skip. If something needs fixing (color hex tweak, GUI placement, console warning), fix inline and commit:

```bash
git add -A
git commit -m "slabs: fix-up after final smoke test"
```

---

## Self-review notes

- **Spec coverage:** Source/citations/license → Task 1+5. Filter (8 depths + antimeridian) → Task 1. Per-zone meshes (Approach C) → Task 3. Strategy registry → Task 2. Per-vertex colors via setColors() → Task 3. Glow uniform via onBeforeCompile → Task 3. GUI controls → Task 4. Attribution → Task 5. Manual checks → Task 6.
- **Placeholder scan:** No TBDs. Every Edit shows literal old/new content. Citations include DOIs. URLs are concrete (validated against ScienceBase API during plan-writing).
- **Type/symbol consistency:** `colorStrategies` registry keys (`viridis`, `markerExtended`, `single`) match the GUI dropdown options in Task 4. `setColorStrategy`, `setVisible`, `setGlow` exported from `slab2.js` match what the docs/spec promise. `slabWidth`/`slabOpacity`/`showSlabs`/`slabColorStrategy` named consistently across atlasTuning.js (Task 4) and slab2.js (Task 3).
- **Task ordering safety:** Task 1 produces the data file before Task 3 imports it. Task 2 produces `slabColors.js` before Task 3 imports it. Task 3 references atlasTuning keys that don't exist until Task 4 — safe because reads are runtime, not build-time. Task 4 finally calls `loadSlab2`, making the layer live. Task 5 is decoration; Task 6 verifies. No task leaves the build broken.
- **Bundle-size accuracy:** Estimated 1–2 MB GeoJSON. Actual size only known after Task 1's prep run. Spec's risk section calls this out; Task 6 confirms the cumulative bundle.
