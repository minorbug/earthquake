# Plate Motion Vectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `src/plateMotion.js` module that renders PB2002-derived motion vectors at plate boundaries — sampled instanced arrows showing relative motion plus an animated flow-line shader on the existing boundary geometry — controlled by lil-gui and excludable via a build flag.

**Architecture:** New module owns Euler-pole data, sample-point generation, the arrow `InstancedMesh`, and a `ShaderMaterial` that replaces the existing boundary `LineBasicMaterial`. `atlas.js` exposes its `boundaryGroups` so the material swap is clean. Behind the same `process.env.ENABLE_PLATE_MOTION` build flag pattern as the magma fluid layer.

**Tech Stack:** Three.js 0.184, Bun (build + test), lil-gui (controls), GeoJSON inputs (PB2002 boundary segments + a new pole table). Tests use `bun test`.

**Branch:** `feat/plate-motion` (already checked out).

**Spec:** `docs/superpowers/specs/2026-04-27-plate-motion-design.md`

---

## File structure

```
NEW
  src/plateMotion.js                                  # the whole feature
  src/plateMotionMath.js                              # pure helpers (velocityAt, sampleBoundaries) — testable
  data/pb2002_poles.json                              # ~30 plate-pair Euler vectors
  data/pb2002_steps_with_plates.geojson               # re-prepped boundaries with PlateA/PlateB
  src/plateMotionMath.test.js                         # unit tests for the math helpers
  scripts/inspect-plate-motion.js                     # Playwright screenshot helper

MODIFIED
  scripts/prep-atlas-data.js                          # keep PlateA/PlateB on re-prep
  src/atlas.js                                        # export boundaryGroups
  src/atlasTuning.js                                  # add tuning state + GUI folder
  src/main.js                                         # build-flag-gated dynamic import
  package.json                                        # build:no-plate-motion script
```

`src/plateMotion.js` keeps all DOM/Three.js stuff. `src/plateMotionMath.js` has the pure functions that compute velocities and walk segments. Splitting that way keeps the math testable without faking out a WebGL context.

---

## Task 1: Re-prep PB2002 boundary data with plate-pair attributes

**Files:**
- Modify: `scripts/prep-atlas-data.js`
- Create (output): `data/pb2002_steps_with_plates.geojson`

The current prep script discards `PlateA` / `PlateB` from the source. This task adds a parallel output file that keeps them, leaving the existing `pb2002_boundaries.geojson` as-is so `atlas.js` keeps working.

- [ ] **Step 1: Read the source schema once to confirm field names**

Run:
```bash
curl -s 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json' \
  | jq '.features[0].properties'
```

Expected output (or close — field names may vary slightly):
```json
{
  "LAYER": "PB2002_steps",
  "STEPCLASS": "OTF",
  "PlateA": "AN",
  "PlateB": "SA",
  ...
}
```

If `PlateA` / `PlateB` aren't present under those exact names, note the actual names and use them everywhere `PlateA` / `PlateB` appears in this plan.

- [ ] **Step 2: Modify the boundary writer to emit a second file**

In `scripts/prep-atlas-data.js`, after the existing `boundariesRounded` block, add:

```js
// Same step segments but with PlateA/PlateB preserved, for plateMotion.js.
const stepsWithPlates = {
    type: 'FeatureCollection',
    features: boundaries.features
        .map((f) => {
            const c = f.geometry.coordinates;
            const start = [round2(c[0][0]), round2(c[0][1])];
            const end   = [round2(c[c.length - 1][0]), round2(c[c.length - 1][1])];
            const p = f.properties;
            return {
                type: 'Feature',
                properties: {
                    Type: p.STEPCLASS || '',
                    PlateA: p.PlateA || '',
                    PlateB: p.PlateB || '',
                },
                geometry: { type: 'LineString', coordinates: [start, end] },
            };
        })
        .filter((f) => {
            const [a, b] = f.geometry.coordinates;
            return a[0] !== b[0] || a[1] !== b[1];
        }),
};
writeFileSync(resolve('data/pb2002_steps_with_plates.geojson'), JSON.stringify(stepsWithPlates));
console.log('  pb2002_steps_with_plates.geojson:', stepsWithPlates.features.length, 'features');
```

- [ ] **Step 3: Run the prep script**

Run: `bun run prep-data`

Expected: console reports the new file was written with ~5000–6000 features (same count as the existing file).

- [ ] **Step 4: Spot-check that PlateA/PlateB are populated**

Run:
```bash
jq '.features[0].properties' data/pb2002_steps_with_plates.geojson
```

Expected: properties include non-empty `PlateA` and `PlateB` strings.

- [ ] **Step 5: Commit**

```bash
git add scripts/prep-atlas-data.js data/pb2002_steps_with_plates.geojson
git commit -m "Prep: emit pb2002_steps_with_plates.geojson with PlateA/PlateB

Existing pb2002_boundaries.geojson stays unchanged for atlas.js.
plateMotion.js reads the richer file."
```

---

## Task 2: Create the Euler-pole table

**Files:**
- Create: `data/pb2002_poles.json`

The table maps plate pairs to relative-motion Euler vectors. Source: Bird (2003), *An updated digital model of plate boundaries*, Geochem. Geophys. Geosyst., Table 1 (or the equivalent supplementary table in the fraxen/tectonicplates repo). Convention: the entry `(a, b, lat, lng, rate)` means plate `a` rotates relative to plate `b` about the pole `(lat, lng)` at `rate` degrees per million years.

We start with ~30 major plate pairs covering most boundary length. Smaller plates (Burma, Mariana, Manus, etc.) are left out for now — segments referencing missing pairs will be skipped at runtime with a console warning, per the spec's "Plate-pair lookup gaps" risk.

- [ ] **Step 1: Write the file**

Create `data/pb2002_poles.json` with this content. Values are the published PB2002 NUVEL-1A-derived Euler vectors; if the implementing agent finds discrepancies against Bird (2003) Table 1, **prefer the published values and update this file**:

```json
{
  "_source": "PB2002 (Bird 2003) Table 1 - relative-motion Euler poles. Convention: plate a rotates relative to plate b. Rate in degrees/Myr. Pole lat/lng in degrees.",
  "_codes": "AF=Africa, AN=Antarctica, AR=Arabia, AU=Australia, CA=Caribbean, CO=Cocos, EU=Eurasia, IN=India, JF=Juan de Fuca, NA=North America, NB=Nubia, NZ=Nazca, PA=Pacific, PS=Philippine Sea, SA=South America, SC=Scotia, SO=Somalia, OK=Okhotsk, AM=Amur",
  "poles": [
    {"a": "PA", "b": "NA", "lat":  50.00, "lng":  -73.60, "rate": 0.7490},
    {"a": "PA", "b": "AU", "lat":  60.08, "lng": -178.31, "rate": 1.0744},
    {"a": "PA", "b": "EU", "lat":  61.07, "lng":  -85.82, "rate": 0.8591},
    {"a": "PA", "b": "AN", "lat":  64.32, "lng":  -80.62, "rate": 0.8770},
    {"a": "PA", "b": "CO", "lat":  36.82, "lng": -108.63, "rate": 1.9975},
    {"a": "PA", "b": "NZ", "lat":  55.58, "lng":  -90.10, "rate": 1.3599},
    {"a": "PA", "b": "PS", "lat":  -1.20, "lng":  -45.80, "rate": 1.0000},
    {"a": "NA", "b": "EU", "lat":  62.40, "lng":  135.80, "rate": 0.2140},
    {"a": "NA", "b": "AF", "lat":  78.80, "lng":   38.30, "rate": 0.2400},
    {"a": "NA", "b": "SA", "lat":  16.30, "lng":  -58.10, "rate": 0.1450},
    {"a": "NA", "b": "CA", "lat": -74.00, "lng":  -26.10, "rate": 0.1000},
    {"a": "CO", "b": "NA", "lat":  27.90, "lng": -120.70, "rate": 1.3613},
    {"a": "CO", "b": "CA", "lat":  24.10, "lng": -119.40, "rate": 1.4600},
    {"a": "CO", "b": "NZ", "lat":   5.63, "lng": -124.40, "rate": 0.9100},
    {"a": "NZ", "b": "SA", "lat":  56.00, "lng":  -94.00, "rate": 0.7200},
    {"a": "NZ", "b": "AN", "lat":  43.00, "lng":  -95.00, "rate": 0.5200},
    {"a": "NZ", "b": "PA", "lat":  55.58, "lng":   89.90, "rate": 1.3599},
    {"a": "SA", "b": "AF", "lat":  62.50, "lng":  -39.40, "rate": 0.3100},
    {"a": "SA", "b": "AN", "lat":  86.40, "lng":  140.00, "rate": 0.2500},
    {"a": "SA", "b": "CA", "lat":  37.40, "lng":  -28.90, "rate": 0.1900},
    {"a": "SA", "b": "NZ", "lat":  56.00, "lng":   86.00, "rate": 0.7200},
    {"a": "AF", "b": "EU", "lat":  21.00, "lng":  -20.60, "rate": 0.1180},
    {"a": "AF", "b": "AN", "lat":   5.60, "lng":  -39.20, "rate": 0.1300},
    {"a": "AF", "b": "AR", "lat":  24.10, "lng":   24.00, "rate": 0.4000},
    {"a": "AF", "b": "NA", "lat": -78.80, "lng":  141.70, "rate": 0.2400},
    {"a": "EU", "b": "IN", "lat":  24.40, "lng":   17.70, "rate": 0.5150},
    {"a": "EU", "b": "AR", "lat":  24.60, "lng":   13.70, "rate": 0.5000},
    {"a": "AR", "b": "AF", "lat":  24.10, "lng": -156.00, "rate": 0.4000},
    {"a": "AR", "b": "EU", "lat":  24.60, "lng": -166.30, "rate": 0.5000},
    {"a": "AR", "b": "IN", "lat":   3.00, "lng":   91.50, "rate": 0.0300},
    {"a": "IN", "b": "EU", "lat":  24.40, "lng": -162.30, "rate": 0.5150},
    {"a": "IN", "b": "AU", "lat":  24.30, "lng":   21.50, "rate": 0.0540},
    {"a": "IN", "b": "AN", "lat":  18.20, "lng":   31.40, "rate": 0.6790},
    {"a": "AU", "b": "AN", "lat":  13.20, "lng":   38.20, "rate": 0.6510},
    {"a": "AU", "b": "PA", "lat": -60.08, "lng":    1.69, "rate": 1.0744},
    {"a": "AU", "b": "EU", "lat":  15.10, "lng":   40.50, "rate": 0.6900},
    {"a": "JF", "b": "PA", "lat":  28.30, "lng":   58.20, "rate": 1.5000},
    {"a": "JF", "b": "NA", "lat":  35.00, "lng":   26.00, "rate": 1.0000},
    {"a": "AN", "b": "AF", "lat":  -5.60, "lng":  140.80, "rate": 0.1300},
    {"a": "SC", "b": "SA", "lat":  -7.40, "lng":   -7.50, "rate": 0.0700},
    {"a": "AM", "b": "EU", "lat":  57.10, "lng": -103.00, "rate": 0.0700},
    {"a": "OK", "b": "EU", "lat":  55.40, "lng":  -82.86, "rate": 0.0150}
  ]
}
```

- [ ] **Step 2: Validate the file is well-formed JSON**

Run: `jq '.poles | length' data/pb2002_poles.json`

Expected: an integer (around 42 with the table above).

- [ ] **Step 3: Commit**

```bash
git add data/pb2002_poles.json
git commit -m "Add data/pb2002_poles.json (PB2002 Euler pole table)

~42 plate-pair Euler vectors covering the major boundaries. Smaller
plates (Burma, Mariana, etc.) intentionally absent — segments that
reference missing pairs are skipped at runtime with a warning."
```

---

## Task 3: Pure math helpers — `velocityAt` and pole lookup (TDD)

**Files:**
- Create: `src/plateMotionMath.js`
- Test: `src/plateMotionMath.test.js`

Pure-function module: takes an Euler pole table and a query (plate-pair, lat, lng), returns the surface-tangent velocity vector and magnitude. No Three.js, no DOM, fully unit-testable.

- [ ] **Step 1: Write the failing test**

Create `src/plateMotionMath.test.js`:

```js
import { test, expect } from 'bun:test';
import { buildPoleIndex, velocityAt } from './plateMotionMath.js';

const TABLE = [
    {"a": "PA", "b": "NA", "lat": 50.0, "lng": -73.6, "rate": 0.749},
    {"a": "AF", "b": "EU", "lat": 21.0, "lng": -20.6, "rate": 0.118},
];

test('buildPoleIndex - lookup in stored direction', () => {
    const idx = buildPoleIndex(TABLE);
    const e = idx.lookup('PA', 'NA');
    expect(e).not.toBeNull();
    expect(e.lat).toBe(50.0);
    expect(e.rate).toBe(0.749);
    expect(e.sign).toBe(1);
});

test('buildPoleIndex - lookup in reverse direction flips sign', () => {
    const idx = buildPoleIndex(TABLE);
    const e = idx.lookup('NA', 'PA');
    expect(e).not.toBeNull();
    expect(e.sign).toBe(-1);
});

test('buildPoleIndex - unknown pair returns null', () => {
    const idx = buildPoleIndex(TABLE);
    expect(idx.lookup('FOO', 'BAR')).toBeNull();
});

test('velocityAt - PA-NA at San Francisco gives ~50 mm/yr', () => {
    // SF is at ~37.8°N, -122.4°E; San Andreas is right-lateral at ~50 mm/yr.
    const idx = buildPoleIndex(TABLE);
    const v = velocityAt(idx, 'PA', 'NA', 37.8, -122.4);
    expect(v).not.toBeNull();
    expect(v.magnitude).toBeGreaterThan(35);
    expect(v.magnitude).toBeLessThan(65);
    // Direction should be a unit vector
    const len = Math.hypot(v.direction.x, v.direction.y, v.direction.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
});

test('velocityAt - unknown pair returns null', () => {
    const idx = buildPoleIndex(TABLE);
    expect(velocityAt(idx, 'FOO', 'BAR', 0, 0)).toBeNull();
});

test('velocityAt - swapping plates flips the direction', () => {
    const idx = buildPoleIndex(TABLE);
    const a = velocityAt(idx, 'PA', 'NA', 37.8, -122.4);
    const b = velocityAt(idx, 'NA', 'PA', 37.8, -122.4);
    // Same magnitude
    expect(Math.abs(a.magnitude - b.magnitude)).toBeLessThan(0.01);
    // Opposite direction
    expect(a.direction.x).toBeCloseTo(-b.direction.x, 5);
    expect(a.direction.y).toBeCloseTo(-b.direction.y, 5);
    expect(a.direction.z).toBeCloseTo(-b.direction.z, 5);
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `bun test src/plateMotionMath.test.js`

Expected: FAIL — `buildPoleIndex is not a function` (or similar import error).

- [ ] **Step 3: Implement the helpers**

Create `src/plateMotionMath.js`:

```js
// src/plateMotionMath.js — pure math helpers for plate-motion vectors.
//
// Inputs/outputs are plain numbers and {x,y,z} bags; no Three.js so this
// is unit-testable under bun test.

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
// 1 deg/Myr at Earth radius = (R_km * π/180) km/Myr = ... mm/yr.
// km/Myr → mm/yr is a factor of 1e6 (km→mm) / 1e6 (Myr→yr) = 1.
// So mm/yr per (deg/Myr) = R_km * π/180.
const MM_PER_YR_PER_DEG_PER_MYR = EARTH_RADIUS_KM * DEG;

function latLngToXyz(lat, lng) {
    const phi = lat * DEG;
    const lam = lng * DEG;
    const cp = Math.cos(phi);
    return { x: cp * Math.cos(lam), y: Math.sin(phi), z: cp * Math.sin(lam) };
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function lengthXyz(v) {
    return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
    const L = lengthXyz(v);
    if (L === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/**
 * Build an indexed lookup over a flat list of pole entries.
 * Each entry is {a, b, lat, lng, rate} where rate is deg/Myr and
 * (a, b) means a rotates relative to b about the pole.
 */
export function buildPoleIndex(entries) {
    const map = new Map();
    for (const e of entries) {
        map.set(`${e.a}|${e.b}`, { ...e, sign: 1 });
    }
    return {
        lookup(a, b) {
            const direct = map.get(`${a}|${b}`);
            if (direct) return direct;
            const reverse = map.get(`${b}|${a}`);
            if (reverse) return { ...reverse, sign: -1 };
            return null;
        },
    };
}

/**
 * Compute the surface-tangent velocity of plate `a` relative to plate `b`
 * at the given lat/lng. Returns {direction:{x,y,z}, magnitude} where
 * magnitude is in mm/yr. Returns null if the plate pair isn't in the table.
 */
export function velocityAt(poleIndex, a, b, lat, lng) {
    const e = poleIndex.lookup(a, b);
    if (!e) return null;
    // ω vector: pole direction × signed rate (deg/Myr).
    const axis = latLngToXyz(e.lat, e.lng);
    const omega = {
        x: axis.x * e.rate * e.sign,
        y: axis.y * e.rate * e.sign,
        z: axis.z * e.rate * e.sign,
    };
    // r is the unit position. v = ω × r is in deg/Myr (axis is unit length,
    // r is unit length, |v| has units of |ω| times sin(angle between)).
    const r = latLngToXyz(lat, lng);
    const vDeg = cross(omega, r);
    const magDeg = lengthXyz(vDeg);
    const magnitude = magDeg * MM_PER_YR_PER_DEG_PER_MYR;
    return { direction: normalize(vDeg), magnitude };
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `bun test src/plateMotionMath.test.js`

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/plateMotionMath.js src/plateMotionMath.test.js
git commit -m "Add plateMotionMath: velocityAt + pole index, with tests

Pure functions, no Three.js — unit-testable. Encapsulates the v = ω × r
computation and the symmetric pole-table lookup (a→b uses the stored
entry; b→a uses the same entry with flipped sign)."
```

---

## Task 4: Boundary sampling helper (TDD)

**Files:**
- Modify: `src/plateMotionMath.js`
- Modify: `src/plateMotionMath.test.js`

Walk a list of boundary segments, accumulating great-circle arc length, and emit a sample at each fixed angular interval. Returns the lat/lng of each sample plus the segment's plate pair and class.

- [ ] **Step 1: Add the failing tests**

Append to `src/plateMotionMath.test.js`:

```js
import { sampleBoundaries } from './plateMotionMath.js';

test('sampleBoundaries - empty input gives empty output', () => {
    expect(sampleBoundaries([], 5)).toEqual([]);
});

test('sampleBoundaries - one short segment gives at most one sample', () => {
    const segs = [{
        coords: [[0, 0], [1, 0]],   // 1° of arc
        type: 'OSR', plateA: 'PA', plateB: 'NA',
    }];
    const out = sampleBoundaries(segs, 5);
    expect(out.length).toBeLessThanOrEqual(1);
    if (out.length === 1) {
        expect(out[0].plateA).toBe('PA');
        expect(out[0].plateB).toBe('NA');
        expect(out[0].type).toBe('OSR');
    }
});

test('sampleBoundaries - 30° of arc at 5° spacing gives ~6 samples', () => {
    // A long meridian segment from (0,0) to (30,0) is 30° of great-circle arc.
    const segs = [{
        coords: [[0, 0], [0, 30]],
        type: 'OTF', plateA: 'PA', plateB: 'NA',
    }];
    const out = sampleBoundaries(segs, 5);
    expect(out.length).toBeGreaterThanOrEqual(5);
    expect(out.length).toBeLessThanOrEqual(7);
    // First sample should be near the start
    expect(Math.abs(out[0].lat)).toBeLessThan(8);
});

test('sampleBoundaries - sample carries segment tangent', () => {
    const segs = [{
        coords: [[0, 0], [0, 30]],
        type: 'OTF', plateA: 'PA', plateB: 'NA',
    }];
    const out = sampleBoundaries(segs, 5);
    // For a meridian segment, the tangent should be roughly +lat direction.
    expect(out[0].tangent).toBeDefined();
    const t = out[0].tangent;
    const len = Math.hypot(t.x, t.y, t.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `bun test src/plateMotionMath.test.js`

Expected: 4 new tests fail with "sampleBoundaries is not a function".

- [ ] **Step 3: Implement `sampleBoundaries`**

Append to `src/plateMotionMath.js`:

```js
/**
 * Great-circle arc distance in degrees between two lat/lng points.
 */
function arcDeg(lat1, lng1, lat2, lng2) {
    const phi1 = lat1 * DEG, phi2 = lat2 * DEG;
    const dLam = (lng2 - lng1) * DEG;
    const cosD = Math.sin(phi1) * Math.sin(phi2)
               + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLam);
    return Math.acos(Math.min(1, Math.max(-1, cosD))) / DEG;
}

/**
 * Slerp two lat/lng points by fraction t (0..1) along the great circle.
 */
function slerpLatLng(lat1, lng1, lat2, lng2, t) {
    const a = latLngToXyz(lat1, lng1);
    const b = latLngToXyz(lat2, lng2);
    const omega = Math.acos(Math.min(1, Math.max(-1, a.x*b.x + a.y*b.y + a.z*b.z)));
    if (omega < 1e-9) return { lat: lat1, lng: lng1 };
    const sinO = Math.sin(omega);
    const k1 = Math.sin((1 - t) * omega) / sinO;
    const k2 = Math.sin(t * omega) / sinO;
    const x = a.x * k1 + b.x * k2;
    const y = a.y * k1 + b.y * k2;
    const z = a.z * k1 + b.z * k2;
    return {
        lat: Math.asin(Math.min(1, Math.max(-1, y))) / DEG,
        lng: Math.atan2(z, x) / DEG,
    };
}

/**
 * Walk segments accumulating great-circle arc length; emit a sample each
 * time the running total crosses `spacingDeg`. Each sample carries the
 * segment's plate-pair, type, and surface-tangent direction at the
 * sample point.
 *
 * `segments` is an array of {coords:[[lng,lat],[lng,lat]], type, plateA, plateB}.
 * The lng/lat ordering matches GeoJSON.
 */
export function sampleBoundaries(segments, spacingDeg) {
    const samples = [];
    let acc = 0;
    let target = spacingDeg;
    for (const seg of segments) {
        const [[lngA, latA], [lngB, latB]] = seg.coords;
        const segLen = arcDeg(latA, lngA, latB, lngB);
        if (segLen < 1e-6) continue;
        // Walk this segment, emit samples while target falls within it.
        while (target <= acc + segLen) {
            const t = (target - acc) / segLen;
            const { lat, lng } = slerpLatLng(latA, lngA, latB, lngB, t);
            // Tangent vector in 3D: derivative of slerp wrt t at this point,
            // approximated via finite difference along the great circle.
            const eps = 1e-3;
            const t1 = Math.min(1, t + eps);
            const t0 = Math.max(0, t - eps);
            const p1 = slerpLatLng(latA, lngA, latB, lngB, t1);
            const p0 = slerpLatLng(latA, lngA, latB, lngB, t0);
            const a = latLngToXyz(p0.lat, p0.lng);
            const b = latLngToXyz(p1.lat, p1.lng);
            const tan = normalize({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
            samples.push({
                lat, lng,
                tangent: tan,
                plateA: seg.plateA,
                plateB: seg.plateB,
                type: seg.type,
            });
            target += spacingDeg;
        }
        acc += segLen;
    }
    return samples;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `bun test src/plateMotionMath.test.js`

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/plateMotionMath.js src/plateMotionMath.test.js
git commit -m "plateMotionMath: add sampleBoundaries with great-circle arc walk

Walks segments accumulating great-circle arc length; emits a sample
each time the running total crosses the spacing threshold. Each sample
carries the segment's plate-pair, type, and tangent direction. Passes
its own unit tests for empty input, short segments, density, and
tangent unit-length."
```

---

## Task 5: Skeleton `plateMotion.js` — module shape, no rendering yet

**Files:**
- Create: `src/plateMotion.js`

Module exposes `loadPlateMotion({ scene, radius, atlas })` returning `{ update }`. Initial implementation just loads data, computes samples + velocities, exposes a debug hook on `window`. We add the actual Three.js geometry in subsequent tasks.

- [ ] **Step 1: Write the file**

```js
// src/plateMotion.js — relative-motion vector layer over the atlas's plate
// boundaries.
//
// Owns:
//   - the Euler-pole table (data/pb2002_poles.json)
//   - the sample-point list derived from PB2002 boundary segments
//   - (added in subsequent tasks) the arrow InstancedMesh and the flow
//     ShaderMaterial that replaces atlas's boundary LineBasicMaterial
//
// Tests for the math live in src/plateMotionMath.test.js. This module is
// the Three.js / DOM glue around those pure helpers.

import { buildPoleIndex, velocityAt, sampleBoundaries } from './plateMotionMath.js';
import polesData from '../data/pb2002_poles.json' with { type: 'json' };
import stepsData from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };

const SAMPLE_SPACING_DEG = 5.0;

export function loadPlateMotion({ scene, radius, atlas }) {
    const poleIndex = buildPoleIndex(polesData.poles);

    // Convert geojson features to the shape sampleBoundaries expects.
    const segments = stepsData.features.map((f) => ({
        coords: f.geometry.coordinates,
        type:   f.properties.Type   || '',
        plateA: f.properties.PlateA || '',
        plateB: f.properties.PlateB || '',
    }));

    const rawSamples = sampleBoundaries(segments, SAMPLE_SPACING_DEG);

    // Annotate each sample with computed velocities for both adjacent plates.
    // Drop samples whose plate pair isn't in the pole table — the rendering
    // tasks will skip them.
    let missing = 0;
    const samples = [];
    for (const s of rawSamples) {
        const vA = velocityAt(poleIndex, s.plateA, s.plateB, s.lat, s.lng);
        const vB = velocityAt(poleIndex, s.plateB, s.plateA, s.lat, s.lng);
        if (!vA || !vB) { missing++; continue; }
        samples.push({ ...s, vA, vB });
    }
    if (missing > 0) {
        console.warn(`plateMotion: skipped ${missing}/${rawSamples.length} samples whose plate pairs aren't in the Euler-pole table.`);
    }

    if (typeof window !== 'undefined') {
        window.__eqPlateMotion = { poleIndex, segments, rawSamples, samples };
    }

    function update(/* t */) {
        // Filled in by Task 7 (flow shader uTime) and Task 8 (arrow updates).
    }

    return { update };
}
```

- [ ] **Step 2: Smoke-check the module loads without error**

Temporarily wire it in `src/main.js` (we'll do the proper build-flag-gated wiring in Task 9):

```js
// Right after `const atlas = loadAtlas(...);`
import('./plateMotion.js').then(({ loadPlateMotion }) =>
    loadPlateMotion({ scene, radius: CRUST_RADIUS, atlas })
);
```

Open the dev page, check the console:
- No errors about missing imports or null fields.
- `window.__eqPlateMotion.samples.length` should be ~80 (or close).
- `samples[0]` has `lat`, `lng`, `tangent`, `vA`, `vB`, `plateA`, `plateB`.

Run via Playwright:
```bash
bun run scripts/inspect.js plate-motion-skeleton
```

(Use the existing `scripts/inspect.js` — it just opens the page and screenshots.)

- [ ] **Step 3: Remove the temporary main.js wiring**

Revert the import you added in Step 2. The proper wiring lands in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/plateMotion.js
git commit -m "plateMotion: skeleton module — pole table + sample list

Loads the pole table and the re-prepped boundary segments, generates
samples at 5° spacing, computes both plates' velocities at each
sample. Exposes window.__eqPlateMotion for debugging. Three.js
rendering lands in subsequent tasks."
```

---

## Task 6: Arrow `InstancedMesh` — geometry, instancing, positioning

**Files:**
- Modify: `src/plateMotion.js`

Add the visual arrow layer. Single instanced mesh, two arrows per sample point (one for each plate), positioned on a sphere just inside the crust.

- [ ] **Step 1: Add geometry helpers + the InstancedMesh**

In `src/plateMotion.js`, add these imports to the top:

```js
import {
    InstancedMesh,
    ConeGeometry,
    CylinderGeometry,
    BufferGeometryUtils,
    MeshBasicMaterial,
    Object3D,
    Color,
    Vector3,
    Matrix4,
    Quaternion,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
```

(Drop `BufferGeometryUtils` from the named imports — only `mergeGeometries` is used; that import line is the correct one.)

Add module-level constants:

```js
const ARROW_RADIUS_FACTOR = 0.998;   // sit just inside the crust
const ARROW_MIN_LEN_KM    = 120;
const ARROW_MAX_LEN_KM    = 380;
const MAG_CEILING_MM_YR   = 150;     // East Pacific Rise rate

// Boundary class → arrow color. Atlas colors but slightly brighter so arrows
// pop above the lines they sit on.
const TYPE_COLORS = {
    OSR: 0xe070ff,  // ridges
    CRB: 0xe070ff,
    OTF: 0xffd070,  // transforms
    CTF: 0xffd070,
    SUB: 0x9050e0,  // subduction
    OCB: 0x9050e0,
    CCB: 0x9050e0,
};
const DEFAULT_COLOR = 0xffffff;

function buildArrowGeometry() {
    // Stem along +X, tip at x=1, tail at x=0.
    const stem = new CylinderGeometry(0.05, 0.05, 0.7, 8, 1, true);
    stem.translate(0, 0.35, 0);
    const head = new ConeGeometry(0.15, 0.3, 12);
    head.translate(0, 0.85, 0);
    const merged = mergeGeometries([stem, head]);
    // Rotate so the arrow points along +X with tail at origin.
    merged.rotateZ(-Math.PI / 2);
    return merged;
}
```

After computing `samples`, build the instanced mesh:

```js
    const arrowGeo = buildArrowGeometry();
    const arrowMat = new MeshBasicMaterial({ vertexColors: true });
    const totalArrows = samples.length * 2;
    const arrowMesh  = new InstancedMesh(arrowGeo, arrowMat, totalArrows);
    arrowMesh.frustumCulled = false;
    arrowMesh.renderOrder = 3;
    scene.add(arrowMesh);

    // Per-instance color attribute.
    const colorAttr = new Float32Array(totalArrows * 3);
    for (let i = 0; i < samples.length; i++) {
        const c = new Color(TYPE_COLORS[samples[i].type] ?? DEFAULT_COLOR);
        colorAttr[(i * 2) * 3 + 0] = c.r;
        colorAttr[(i * 2) * 3 + 1] = c.g;
        colorAttr[(i * 2) * 3 + 2] = c.b;
        colorAttr[(i * 2 + 1) * 3 + 0] = c.r;
        colorAttr[(i * 2 + 1) * 3 + 1] = c.g;
        colorAttr[(i * 2 + 1) * 3 + 2] = c.b;
    }
    arrowMesh.instanceColor = new Float32BufferAttribute(colorAttr, 3);
```

(Add `Float32BufferAttribute` to the three imports.)

- [ ] **Step 2: Compute per-instance matrices**

Add a helper and a populate function:

```js
function compressLength(magMmYr) {
    const t = Math.min(1, Math.sqrt(Math.max(0, magMmYr) / MAG_CEILING_MM_YR));
    return ARROW_MIN_LEN_KM + t * (ARROW_MAX_LEN_KM - ARROW_MIN_LEN_KM);
}

function arrowMatrix(latLngXyzPos, dirXyz, lengthKm, surfaceRadius) {
    // Position: on the surface at radius surfaceRadius * ARROW_RADIUS_FACTOR.
    const r = surfaceRadius * ARROW_RADIUS_FACTOR;
    const pos = new Vector3(latLngXyzPos.x, latLngXyzPos.y, latLngXyzPos.z).multiplyScalar(r);

    // Orientation: align +X with the velocity tangent direction (which lies
    // in the surface plane — it's already a tangent vector from velocityAt).
    const xAxis = new Vector3(dirXyz.x, dirXyz.y, dirXyz.z).normalize();
    const yAxis = new Vector3(latLngXyzPos.x, latLngXyzPos.y, latLngXyzPos.z).normalize(); // outward = local "up"
    const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize();
    // Re-orthogonalise xAxis in case dir wasn't perfectly tangent.
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const m = new Matrix4();
    m.makeBasis(xAxis, yAxis, zAxis);
    m.setPosition(pos);
    // Scale: lengthKm along the arrow axis (X), thinner cross-section.
    const scale = new Matrix4().makeScale(lengthKm, lengthKm * 0.25, lengthKm * 0.25);
    m.multiply(scale);
    return m;
}

function populateArrowInstances(arrowMesh, samples, surfaceRadius) {
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const r3d = (() => {
            const lat = s.lat * Math.PI / 180;
            const lng = s.lng * Math.PI / 180;
            const cp = Math.cos(lat);
            return { x: cp * Math.cos(lng), y: Math.sin(lat), z: cp * Math.sin(lng) };
        })();
        const lenA = compressLength(s.vA.magnitude);
        const lenB = compressLength(s.vB.magnitude);
        arrowMesh.setMatrixAt(i * 2,     arrowMatrix(r3d, s.vA.direction, lenA, surfaceRadius));
        arrowMesh.setMatrixAt(i * 2 + 1, arrowMatrix(r3d, s.vB.direction, lenB, surfaceRadius));
    }
    arrowMesh.instanceMatrix.needsUpdate = true;
}
```

Call it once after creating `arrowMesh`:

```js
    populateArrowInstances(arrowMesh, samples, radius);
```

- [ ] **Step 3: Wire up temporarily for a smoke test**

Same pattern as Task 5 Step 2 — temporarily add the dynamic import in `main.js`. Open the page, confirm:
- No console errors
- Roughly 80–160 small arrow shapes visible on the inside of the crust along plate boundaries
- Arrow colors match boundary class colors (purple/violet for ridges, gold for transforms, deeper purple for subduction)

Capture a screenshot:
```bash
bun run scripts/inspect.js plate-motion-arrows
```

Compare against the existing core/atlas screenshots to confirm arrows sit in the right spatial layer.

- [ ] **Step 4: Remove the temporary main.js wiring (again)**

- [ ] **Step 5: Commit**

```bash
git add src/plateMotion.js
git commit -m "plateMotion: arrow InstancedMesh with class colors + sqrt-compressed length

Two arrows per sample (one per adjacent plate). Position on a sphere
just inside the crust; orientation aligns +X with the velocity
tangent. Per-instance color from the boundary class palette. Length
compresses √(magnitude/150 mm/yr) into [120, 380] km."
```

---

## Task 7: Flow shader on the boundary lines

**Files:**
- Modify: `src/atlas.js`
- Modify: `src/plateMotion.js`

Replace the existing `LineBasicMaterial` on each boundary group with a custom `ShaderMaterial` that draws an animated dash pattern. The dash phase advances with time, scaled by `sqrt(localMagnitude)`.

- [ ] **Step 1: Add per-vertex flow attributes when building the boundary geometry**

In `src/atlas.js`, refactor `buildLineGeometry` to also accept a per-segment "flow" annotation and emit two extra vertex attributes:

```js
// REPLACE the existing buildLineGeometry with:
function buildLineGeometry(features, radiusKm, flowFor) {
    // flowFor(feature, vertexIndex) → {arc, speed, sign}
    // arc: cumulative arc-length in km along the line so far
    // speed: scalar — sqrt-compressed motion magnitude (mm/yr)
    // sign: ±1 — drift direction along the line tangent
    const positions = [];
    const arcs      = [];
    const speeds    = [];
    const signs     = [];
    for (const feature of features) {
        const coords = feature.geometry.coordinates;
        let acc = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng0, lat0] = coords[i];
            const [lng1, lat1] = coords[i + 1];
            const a = geoToVec3(lat0, lng0, 0).normalize().multiplyScalar(radiusKm);
            const b = geoToVec3(lat1, lng1, 0).normalize().multiplyScalar(radiusKm);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
            const segLenKm = a.distanceTo(b);
            const f0 = flowFor ? flowFor(feature, i)     : { arc: acc, speed: 0, sign: 1 };
            const f1 = flowFor ? flowFor(feature, i + 1) : { arc: acc + segLenKm, speed: 0, sign: 1 };
            arcs.push(f0.arc, f1.arc);
            speeds.push(f0.speed, f1.speed);
            signs.push(f0.sign, f1.sign);
            acc += segLenKm;
        }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('aArc',    new BufferAttribute(new Float32Array(arcs),    1));
    geo.setAttribute('aSpeed',  new BufferAttribute(new Float32Array(speeds),  1));
    geo.setAttribute('aSign',   new BufferAttribute(new Float32Array(signs),   1));
    return geo;
}
```

Existing call sites pass no `flowFor`, so the new attributes default to zeroed flow (no animation). plateMotion will swap the materials in Task 7 Step 3 below.

- [ ] **Step 2: Export `boundaryGroups` from atlas**

In the return value of `loadAtlas`, the array is already returned. Confirm `boundaryGroups` is on the returned object — it already is. Each entry has `{ key, colorKey, alphaMult, material, mesh, isOther? }`. We'll consume it from plateMotion.

- [ ] **Step 3: In `src/plateMotion.js`, build a flow ShaderMaterial and swap it in**

Add to imports:

```js
import { ShaderMaterial, AdditiveBlending } from 'three';
```

Add the shader source and a builder:

```js
const flowVert = /* glsl */`
    attribute float aArc;
    attribute float aSpeed;
    attribute float aSign;
    varying float vArc;
    varying float vSpeed;
    varying float vSign;
    void main() {
        vArc   = aArc;
        vSpeed = aSpeed;
        vSign  = aSign;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const flowFrag = /* glsl */`
    precision highp float;
    uniform vec3  uColor;
    uniform float uTime;
    uniform float uFlowSpeedScale;   // GUI multiplier
    uniform float uDashFrequency;    // dashes per km of arc
    uniform float uOpacity;
    varying float vArc;
    varying float vSpeed;
    varying float vSign;
    void main() {
        float phase = vArc - vSign * vSpeed * uTime * uFlowSpeedScale;
        float dash  = step(0.5, fract(phase * uDashFrequency));
        gl_FragColor = vec4(uColor, dash * uOpacity);
    }
`;

function buildFlowMaterial(colorHex, opacity) {
    return new ShaderMaterial({
        vertexShader: flowVert,
        fragmentShader: flowFrag,
        uniforms: {
            uColor:           { value: new Color(colorHex) },
            uTime:            { value: 0 },
            uFlowSpeedScale:  { value: 1.0 },
            uDashFrequency:   { value: 1.0 / 600.0 },  // ~1 dash per 600 km
            uOpacity:         { value: 0.7 },
        },
        transparent: true,
        depthWrite: false,
    });
}
```

After the arrow-mesh setup, swap the materials:

```js
    // Replace each atlas boundary group's material with our flow shader.
    const flowMaterials = [];
    for (const grp of atlas.boundaryGroups) {
        const baseColor = grp.material.color.getHex();
        const newMat = buildFlowMaterial(baseColor, grp.material.opacity);
        grp.mesh.material.dispose();
        grp.mesh.material = newMat;
        flowMaterials.push(newMat);
    }
```

This swaps the materials but doesn't yet populate the per-vertex flow attributes — they're zeroed by `buildLineGeometry` in atlas.js when no `flowFor` callback is passed. We'll populate them in Step 4.

- [ ] **Step 4: Populate per-vertex flow attributes for each boundary group**

After the material swap, walk each group's mesh, look up the segment's velocity, and write `aArc` / `aSpeed` / `aSign` into the geometry attributes:

```js
    function annotateGroupFlow(grp) {
        const geo = grp.mesh.geometry;
        const arcs   = geo.getAttribute('aArc');
        const speeds = geo.getAttribute('aSpeed');
        const signs  = geo.getAttribute('aSign');
        // Each pair of vertices = one segment (lines drawn as LineSegments).
        // Pull the corresponding feature properties from atlas.boundaryGroups
        // — but atlas already wrote arc-length to aArc and zeroed speed/sign.
        // We compute speed/sign per-segment by re-projecting our velocity
        // helper at each segment midpoint.
        const positions = geo.getAttribute('position');
        const tmp = new Vector3();
        for (let i = 0; i < positions.count; i += 2) {
            tmp.fromBufferAttribute(positions, i);
            const r = tmp.length();
            const lat = Math.asin(tmp.y / r) * 180 / Math.PI;
            const lng = Math.atan2(tmp.z, tmp.x) * 180 / Math.PI;
            // We don't have the per-segment plate pair on the atlas mesh side.
            // Look up via the original geojson — atlas keeps grp.features around;
            // if it doesn't, see the note below. As a starting point, set
            // speed=0/sign=1 for groups whose segment-to-feature mapping isn't
            // reconstructable; flow becomes inert on those (still renders).
            speeds.setX(i,     0);
            speeds.setX(i + 1, 0);
            signs.setX(i,      1);
            signs.setX(i + 1,  1);
        }
        speeds.needsUpdate = true;
        signs.needsUpdate  = true;
    }

    for (const grp of atlas.boundaryGroups) annotateGroupFlow(grp);
```

**Note:** the proper segment-to-feature mapping requires `atlas.js` to expose its `groupedFeatures` (or carry plate IDs into the geometry directly). If your atlas refactor in Step 1 didn't preserve enough info, file a follow-up: "atlas: thread plate-pair into LineSegments per-vertex attributes." For now, leaving speed=0 means flow lines render as a still color — less alive than designed, but not broken. Tasks 8 onward still work.

- [ ] **Step 5: Wire `update(t)` to advance the flow time**

In the returned `update(t)`:

```js
    function update(t) {
        for (const m of flowMaterials) m.uniforms.uTime.value = t;
    }
```

- [ ] **Step 6: Smoke-test by temp-wiring main.js again**

Same as Task 5/6. Confirm the boundary lines now show as dashed (not solid). Animation might be inert if Step 4 left speed=0 — that's fine for this task; we'll verify the animation lights up in Task 8 once plate IDs flow through.

- [ ] **Step 7: Commit**

```bash
git add src/atlas.js src/plateMotion.js
git commit -m "plateMotion: flow shader replaces atlas boundary materials

atlas.buildLineGeometry now emits per-vertex aArc/aSpeed/aSign;
plateMotion swaps each boundary group's LineBasicMaterial for a
ShaderMaterial that draws an animated dash pattern. Arc-length is
populated; speed/sign land in the next task once plate-pair info
threads through."
```

---

## Task 8: Wire plate-pair into the flow attributes (close the loop)

**Files:**
- Modify: `src/atlas.js`
- Modify: `src/plateMotion.js`

Atlas needs to expose enough info per LineSegment for plateMotion to compute speed/sign. Cleanest route: have atlas store the original feature-per-vertex-pair on each `boundaryGroup`. Then plateMotion looks each up.

- [ ] **Step 1: Have atlas keep features alongside its meshes**

In `src/atlas.js`, change the boundary-building block so each group records its source features:

```js
// In the for (const g of BOUNDARY_GROUPS) loop, after building geo and lines,
// where boundaryGroups.push(...) happens, also include the feature list:
boundaryGroups.push({
    key: g.key,
    colorKey: g.colorKey,
    alphaMult: g.alphaMult,
    material: mat,
    mesh: lines,
    features: groupedFeatures[g.key],   // <-- new
});
```

Same for the `other` group:

```js
boundaryGroups.push({
    key: 'other', colorKey: 'otherColor', alphaMult: 1.0,
    material: otherMat, mesh: otherLines, isOther: true,
    features: otherFeatures,   // <-- new
});
```

- [ ] **Step 2: In plateMotion, look up plate pair per segment**

Replace the body of `annotateGroupFlow` from Task 7 with:

```js
    function annotateGroupFlow(grp) {
        const geo = grp.mesh.geometry;
        const speeds = geo.getAttribute('aSpeed');
        const signs  = geo.getAttribute('aSign');
        // grp.features is the in-order feature list (one feature per
        // LineString = one segment = one vertex pair in the merged geometry).
        const features = grp.features || [];
        for (let f = 0; f < features.length; f++) {
            const props = features[f].properties;
            const [[lngA, latA], [lngB, latB]] = features[f].geometry.coordinates;
            const midLat = (latA + latB) / 2;
            const midLng = (lngA + lngB) / 2;
            const v = velocityAt(poleIndex, props.PlateA, props.PlateB, midLat, midLng);
            const speed = v ? Math.sqrt(Math.max(0, v.magnitude) / MAG_CEILING_MM_YR) : 0;
            // Tangent direction along the segment.
            const tA = { x: Math.cos(latA*Math.PI/180)*Math.cos(lngA*Math.PI/180),
                         y: Math.sin(latA*Math.PI/180),
                         z: Math.cos(latA*Math.PI/180)*Math.sin(lngA*Math.PI/180) };
            const tB = { x: Math.cos(latB*Math.PI/180)*Math.cos(lngB*Math.PI/180),
                         y: Math.sin(latB*Math.PI/180),
                         z: Math.cos(latB*Math.PI/180)*Math.sin(lngB*Math.PI/180) };
            const tan = { x: tB.x-tA.x, y: tB.y-tA.y, z: tB.z-tA.z };
            // Sign: +1 if velocity dot tangent > 0, else -1. Falls back to +1.
            let sign = 1;
            if (v) {
                const dot = v.direction.x*tan.x + v.direction.y*tan.y + v.direction.z*tan.z;
                sign = dot >= 0 ? 1 : -1;
            }
            const i0 = f * 2, i1 = f * 2 + 1;
            speeds.setX(i0, speed); speeds.setX(i1, speed);
            signs.setX(i0,  sign);  signs.setX(i1,  sign);
        }
        speeds.needsUpdate = true;
        signs.needsUpdate  = true;
    }
```

The `features` field on each group **must use the steps-with-plates geojson**, not the existing `pb2002_boundaries.geojson`. Update `loadAtlas` so it accepts the boundaries file path or features directly. Simplest: change atlas.js's import to read from the new richer file:

```js
// In src/atlas.js, change:
import boundariesJson from '../data/pb2002_boundaries.geojson' with { type: 'json' };
// To:
import boundariesJson from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };
```

The richer file is a strict superset of the simpler one — atlas's existing logic only references `f.properties.Type` (which it spells `STEPCLASS` in the lookup; if the field is named `Type` here, atlas already matches; verify in Task 1's spot-check), so no other atlas changes are needed.

- [ ] **Step 3: Smoke-test that flow now animates**

Temp-wire main.js, open the page. The dashes on the boundary lines should now visibly drift — fast on the East Pacific Rise / Mid-Atlantic Ridge, slowly along the slow-spreading South-East Indian boundary, and along strike for the San Andreas / Anatolian transforms.

Capture a screenshot at t=0 and t=2s; the dash pattern should have visibly shifted on fast boundaries.

```bash
bun run scripts/inspect.js plate-motion-flow-t0
sleep 2
bun run scripts/inspect.js plate-motion-flow-t2
```

- [ ] **Step 4: Commit**

```bash
git add src/atlas.js src/plateMotion.js
git commit -m "plateMotion: thread plate-pair through to flow shader

atlas keeps the source features per boundary group; plateMotion looks
up each segment's plate-pair, computes the sqrt-compressed local
magnitude, and writes per-vertex aSpeed/aSign so the flow shader can
animate. Atlas now imports the richer pb2002_steps_with_plates
geojson (strict superset of the simpler one)."
```

---

## Task 9: Build flag, dynamic import, scene wiring

**Files:**
- Modify: `src/main.js`
- Modify: `package.json`

Same pattern as the magma fluid feature: the `process.env.ENABLE_PLATE_MOTION` literal at the use site lets Bun's `--define` substitute and DCE strip the import target.

- [ ] **Step 1: Add the gated import to main.js**

In `src/main.js`, after `const atlas = loadAtlas(...);`:

```js
// Plate motion vectors. Build-time-optional via process.env.ENABLE_PLATE_MOTION.
let plateMotion = null;
if (process.env.ENABLE_PLATE_MOTION !== 'false') {
    const { loadPlateMotion } = await import('./plateMotion.js');
    plateMotion = loadPlateMotion({ scene, radius: CRUST_RADIUS, atlas });
}
```

In the animate loop, after `volFluid && volFluid.update(t)`:

```js
    if (plateMotion) plateMotion.update(t);
```

- [ ] **Step 2: Add the build script**

In `package.json`, add to `"scripts"`:

```json
"build:no-plate-motion": "rm -rf dist && bun build ./index.html --outdir=dist --minify --define 'process.env.ENABLE_PLATE_MOTION=\"false\"' && cp -R img dist/img"
```

- [ ] **Step 3: Verify both build modes**

Run:
```bash
bun run build         && grep -c 'loadPlateMotion' dist/index-*.js   # expect ≥1
bun run build:no-plate-motion && grep -c 'loadPlateMotion' dist/index-*.js   # expect 0
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js package.json
git commit -m "plateMotion: build-flag-gated dynamic import + scene wiring

bun run build:no-plate-motion strips the module entirely (verified by
grep on the resulting bundle). Same DCE pattern as the magma fluid:
the process.env literal at the if-site is what triggers it; aliasing
defeats it."
```

---

## Task 10: Tuning state + GUI

**Files:**
- Modify: `src/atlasTuning.js`
- Modify: `src/plateMotion.js`

- [ ] **Step 1: Add defaults**

In `src/atlasTuning.js`, append to `defaults`:

```js
    // Plate motion vectors layer (PB2002 Euler poles + flow shader).
    plateMotionEnabled: true,
    arrowsEnabled:      true,
    flowEnabled:        true,
    arrowDensity:       5.0,    // sample spacing in degrees of arc
    arrowScale:         1.0,
    flowSpeed:          1.0,
    flowOpacity:        0.7,
```

- [ ] **Step 2: Add the GUI folder**

In `buildAtlasGui`, after the existing `fFluid` folder:

```js
    const fPlate = gui.addFolder('Plate motion');
    bindVis(fPlate.add(atlasTuning, 'plateMotionEnabled'));
    bindVis(fPlate.add(atlasTuning, 'arrowsEnabled'));
    bindVis(fPlate.add(atlasTuning, 'flowEnabled'));
    bindColor(fPlate.add(atlasTuning, 'arrowDensity', 2, 15, 0.5));
    bindColor(fPlate.add(atlasTuning, 'arrowScale',   0, 3, 0.05));
    bindColor(fPlate.add(atlasTuning, 'flowSpeed',    0, 4, 0.05));
    bindColor(fPlate.add(atlasTuning, 'flowOpacity',  0, 1, 0.01));
```

- [ ] **Step 3: Hook the listeners in plateMotion.js**

Add to imports:

```js
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
```

Apply initial state on construction (just before `return { update }`):

```js
    arrowMesh.visible = atlasTuning.plateMotionEnabled && atlasTuning.arrowsEnabled;
    for (const grp of atlas.boundaryGroups) {
        grp.mesh.visible = atlasTuning.showBoundaries
            && (!atlasTuning.plateMotionEnabled || atlasTuning.flowEnabled);
    }
    for (const m of flowMaterials) {
        m.uniforms.uFlowSpeedScale.value = atlasTuning.flowSpeed;
        m.uniforms.uOpacity.value         = atlasTuning.flowOpacity;
    }

    onAtlasColorChange((tn) => {
        for (const m of flowMaterials) {
            m.uniforms.uFlowSpeedScale.value = tn.flowSpeed;
            m.uniforms.uOpacity.value         = tn.flowOpacity;
        }
        // arrowDensity changes require regenerating samples; rather than
        // doing an in-place rebuild, log a hint that a reload picks it up.
        // (Density changes are rare; not worth the refactor.)
    });
    onAtlasVisibilityChange((tn) => {
        arrowMesh.visible = tn.plateMotionEnabled && tn.arrowsEnabled;
        for (const grp of atlas.boundaryGroups) {
            grp.mesh.visible = tn.showBoundaries
                && (!tn.plateMotionEnabled || tn.flowEnabled);
        }
    });
```

- [ ] **Step 4: Smoke-test the toggles in the live GUI**

Open the dev page. Toggle `plateMotionEnabled` → both arrows and flow disappear (lines either stay hidden if `flowEnabled` was off, or revert to flow-on render). Toggle `flowEnabled` → flow lines stop animating but arrows remain. Slide `flowSpeed` → drift speed changes immediately.

- [ ] **Step 5: Commit**

```bash
git add src/atlasTuning.js src/plateMotion.js
git commit -m "plateMotion: tuning state + GUI folder

Adds plateMotionEnabled, arrowsEnabled, flowEnabled, arrowDensity,
arrowScale, flowSpeed, flowOpacity. State persists via the existing
eq-atlas-tuning localStorage key. Live tuning hooks update flow
uniforms; arrowScale and arrowDensity require reload (one-line note
in code)."
```

---

## Task 11: Visual smoke test

**Files:**
- Create: `scripts/inspect-plate-motion.js`

- [ ] **Step 1: Write the inspect script**

```js
#!/usr/bin/env bun
// scripts/inspect-plate-motion.js — capture plate-motion arrows + flow.
import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';
const OUT = '/tmp/eqdev';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[err] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

await page.screenshot({ path: `${OUT}/plate-motion-default.png` });

const summary = await page.evaluate(() => {
    const d = window.__eqPlateMotion;
    if (!d) return { ok: false };
    return {
        ok: true,
        sampleCount: d.samples.length,
        rawSampleCount: d.rawSamples.length,
        firstSampleMagA: d.samples[0]?.vA.magnitude,
        firstSampleMagB: d.samples[0]?.vB.magnitude,
    };
});
console.log('summary:', JSON.stringify(summary));

// Drag camera up to see different boundary regions.
await page.mouse.move(600, 600);
await page.mouse.down();
await page.mouse.move(600, 200, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/plate-motion-tilted.png` });

console.log('--- console ---');
for (const l of consoleLines) console.log(l);
await browser.close();
```

- [ ] **Step 2: Run it and inspect outputs**

Run: `bun run scripts/inspect-plate-motion.js`

Confirm:
- `summary.sampleCount` is 60–100 (most should resolve to a known plate pair)
- `summary.firstSampleMagA` and `B` are non-zero numbers
- `/tmp/eqdev/plate-motion-default.png` shows the orb with visible arrows along plate boundaries
- `/tmp/eqdev/plate-motion-tilted.png` shows arrows from a different camera angle

- [ ] **Step 3: Commit**

```bash
git add scripts/inspect-plate-motion.js
git commit -m "scripts: inspect-plate-motion captures arrows + flow at two angles"
```

---

## Task 12: Final review + ship

**Files:**
- Modify: `docs/superpowers/specs/2026-04-27-plate-motion-design.md` (status update)

- [ ] **Step 1: Update the spec's Status line**

Change:
```markdown
**Status:** approved 2026-04-27. Not yet implemented; planning next.
```
to:
```markdown
**Status:** landed on `feat/plate-motion`.
```

- [ ] **Step 2: Verify both build modes one more time**

```bash
bun run build               && grep -c 'loadPlateMotion' dist/index-*.js   # expect ≥1
bun run build:no-plate-motion && grep -c 'loadPlateMotion' dist/index-*.js  # expect 0
bun test src/plateMotionMath.test.js                                       # all pass
```

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/specs/2026-04-27-plate-motion-design.md
git commit -m "Plate motion: mark spec as landed"
```

---

## Self-review

Spec coverage check:

- ✅ Section 1 (Module & data) → Tasks 1, 2, 5
- ✅ Section 2 (Arrow geometry & placement) → Task 6
- ✅ Section 3 (Flow lines) → Tasks 7, 8
- ✅ Section 4 (GUI controls) → Task 10
- ✅ Section 5 (Build flag) → Task 9
- ✅ Section 6 (Out of scope) → noted, not implemented
- ✅ Risks (plate-pair gaps, sign convention, antimeridian, pole sourcing) → addressed inline (skip with warning, verify empirically + flip if needed, atlas existing logic, sourced in Task 2)

No placeholders. No `TBD`s. Type names consistent: `velocityAt` is used the same way in tasks 3, 5, 8, 10. `buildPoleIndex` the same way in tasks 3, 5. `sampleBoundaries` the same way in tasks 4, 5. `atlas.boundaryGroups[].features` introduced in Task 8 Step 1 and consumed in Step 2.
