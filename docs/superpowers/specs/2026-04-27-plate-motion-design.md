# Plate Motion Vectors — Design

**Status:** landed on `feat/plate-motion`.

## Problem

The atlas already renders PB2002 plate boundaries as colored lines on
the inside of the crust. The lines tell you *where* tectonic activity
happens but say nothing about *what's happening there* — boundaries are
spreading, sliding, or converging, at very different rates, and that's
the underlying mechanism for most of the earthquakes we visualize. We
want a layer that makes the motion at each boundary explicit and
quantitative, using real published data.

## Locked decisions

1. **Boundary-centered visualization** — arrows live at boundary
   sample points (not in plate interiors). Pairs of arrows show
   relative motion across each boundary.
2. **Animated flow lines as a complementary ambient layer** — the
   existing boundary line geometry gets a shader that animates a moving
   dash pattern.
3. **Real PB2002 Euler-pole data**. Quantitative. Magnitude in mm/yr
   comes from `v = ω × r` on the sphere.
4. **Sqrt-compressed magnitude encoding with floor + ceiling.** Both
   arrow length and flow-line drift speed compress the ~3–150 mm/yr
   range so slow boundaries stay visible and fast ones don't dominate.

## Architecture

```
                          atlas.js                        plateMotion.js (NEW)
                  (boundary geometry + atlas mask)              (motion layer)
                              │                                       │
                              ├── crust shader / mask                 │
                              ├── boundary LineSegments ◄─────────────┤  flow shader
                              │   (existing geometry,                 │  replaces material
                              │    new shader material)               │
                              │                                       ├── arrow InstancedMesh
                              │                                       │   (~80 sample pts × 2 plates)
                              │                                       │
                              └── atlasTuning  ◄──────── atlasTuning extension
                                  (existing GUI panel + persistence)
```

`plateMotion.js` is the new module. It owns:
- the Euler-pole table loaded from `data/pb2002_poles.json`
- the velocity-computation helper `velocityAt(plateA, plateB, lat, lng)`
- the arrow `InstancedMesh` (geometry + material + per-instance attributes)
- the flow-line `ShaderMaterial` that replaces the current
  `LineBasicMaterial` on `atlas.boundaryGroups[*].mesh`

`atlas.js` exposes the boundary `LineSegments` so `plateMotion` can
swap their material; otherwise unchanged.

`atlasTuning.js` gains the new tuning state (defaults + GUI folder).
State persistence reuses the existing `eq-atlas-tuning` localStorage
key.

## Data

### Re-prep boundary segments

`scripts/prep-atlas-data.js` currently throws away `PlateA` / `PlateB`
attributes from `PB2002_steps.json`. Update it to keep them. New
output:

```
data/pb2002_steps_with_plates.geojson
```

The existing `data/pb2002_boundaries.geojson` stays untouched so
`atlas.js` keeps working without changes during the transition.
Once `plateMotion.js` is wired we can either:
- keep both files (atlas.js reads the simpler one, plateMotion.js
  reads the richer one), or
- migrate atlas.js to the richer file and delete the simpler one.

Default plan: keep both. Atlas doesn't need plate IDs and the simpler
file is smaller.

### Euler-pole table

```
data/pb2002_poles.json
```

Format:

```json
[
  {"a": "PA", "b": "NA", "lat": 50.0, "lng": -73.6, "rate": 0.749},
  {"a": "EU", "b": "NA", "lat": 62.4, "lng": 135.8, "rate": 0.214},
  ...
]
```

Where `lat`/`lng` is the rotation pole (in degrees) and `rate` is the
angular rate in degrees per million years. Roughly ~150 plate-pair
entries; ~5–10 KB JSON. Sourced from PB2002 supplementary tables (Bird,
2003).

The lookup is symmetric — `velocityAt('PA', 'NA', ...)` and
`velocityAt('NA', 'PA', ...)` return opposite-sign vectors. The table
stores one direction per pair; the helper handles the swap.

### Velocity computation

```js
function velocityAt(plateA, plateB, lat, lng) {
    const ω = poleVector(plateA, plateB);   // axis * rate, in rad/Myr, world-XYZ
    const r = unitSphere(lat, lng);          // unit position vector
    const v = cross(ω, r);                   // rad/Myr × unit = rad/Myr (tangent)
    // Scale to mm/yr at Earth radius
    const speed = length(v) * EARTH_R_KM * 1e6 / 1e6;  // km/Myr → mm/yr
    return { direction: normalize(v), magnitude: speed };
}
```

Earth radius constant: `EARTH_R_KM = 6371`. Result `magnitude` in
mm/yr; `direction` is a surface-tangent unit vector.

## Arrow rendering

### Sampling

Walk all boundary segments. Maintain a running arc-length accumulator;
emit a sample point each time accumulated arc-length crosses a
threshold (default 5° of arc ≈ 555 km). Reset the threshold per
boundary group so dense regions don't get oversampled at the boundary
between two groups.

Expected count: ~80 sample points globally. The exact value depends on
how PB2002 segments cluster but is in the right order of magnitude for
visual readability.

Per sample point we emit **two arrow instances** — one per adjacent
plate, each pointing in that plate's motion direction (so the pair
shows relative motion explicitly).

### Geometry

A single base mesh: a thin elongated cone with a cylindrical stem,
oriented along +X with origin at the tail. Constructed once.

Rendered as `InstancedMesh` so all ~160 arrows share the geometry +
material. Per-instance attributes:
- `instanceMatrix` — position on sphere + orientation to align +X
  with the velocity direction tangent + length scale
- `instanceColor` — boundary-class color (ridge violet / transform
  gold / sub purple / other white)

Arrows sit at radius `CRUST_RADIUS * 0.998` (~6353 km), inside the
crust shell where the camera lives. Render order set so they draw
after the boundary lines and the flow shader.

### Length mapping

```
const t = Math.sqrt(magnitude / MAX_MAG);   // MAX_MAG = 150 mm/yr
const L = lerp(minLen, maxLen, clamp(t, 0, 1));
```

Defaults:
- `MAX_MAG = 150` mm/yr (East Pacific Rise rate; ceiling)
- `minLen = 120` km (~1.1° of arc — visible but unobtrusive)
- `maxLen = 380` km (~3.4° of arc — readable, not dominating)

GUI exposes a single `arrowScale` multiplier on top of these.

## Flow-line rendering

### Shader replacement

`atlas.js`'s boundary-group materials change from `LineBasicMaterial`
to a `ShaderMaterial` constructed by `plateMotion.js`. Vertex shader
just passes through; fragment shader implements an animated
unidirectional dash pattern.

Per-vertex attributes added when the boundary geometry is built:
- `aArc` — cumulative arc-length along the boundary (used as the
  dash phase coordinate)
- `aFlowSpeed` — the `sqrt(magnitude)`-compressed drift rate at this
  vertex
- `aFlowSign` — ±1 indicating whether the flow direction is "with"
  the line tangent or "against" it (so divergent/convergent boundaries
  flow correctly even though they share the geometry)

### Dash logic

```glsl
float pattern = aArc - aFlowSpeed * uTime * uFlowSpeedScale;
float dash    = step(0.5, fract(pattern * uDashFrequency));
gl_FragColor  = vec4(uColor, dash * uOpacity);
```

`uFlowSpeedScale` is the GUI multiplier, `uDashFrequency` controls how
many dashes per unit arc length, `uOpacity` is the layer's overall
transparency.

For divergent/convergent boundaries the local motion is *across* the
boundary, not along it. Two options for visual treatment:
1. **Same shader, different arrow placement.** Flow lines drift along
   the boundary at a speed proportional to local relative-velocity
   magnitude *projected onto the line tangent* (small for purely
   perpendicular motion). Arrows alone carry the perpendicular
   component.
2. **Two shaders.** One for along-line flow (transforms), one for
   across-line flow (ridges/sub).

**Plan: option 1.** Simpler, one material, and the arrows already
carry the perpendicular signal. For pure ridges/sub the flow is
visually still (which reads correctly — there's no along-line motion
at a divergent boundary).

## GUI controls

New folder `Plate motion` in the existing atlas panel:

| Control | Default | Range | Effect |
|---|---|---|---|
| `plateMotionEnabled` | `true` | toggle | Master on/off |
| `arrowsEnabled` | `true` | toggle | Show/hide the arrow layer |
| `flowEnabled` | `true` | toggle | Show/hide the flow shader (falls back to flat-color line) |
| `arrowDensity` | `5.0` | 2–15° | Angular spacing between samples |
| `arrowScale` | `1.0` | 0–3 | Length multiplier |
| `flowSpeed` | `1.0` | 0–4 | Drift-rate multiplier |
| `flowOpacity` | `0.7` | 0–1 | Dash alpha |

Persisted via the existing `eq-atlas-tuning` localStorage key.

## Build flag

Same pattern as magma fluid:

```js
let plateMotion = null;
if (process.env.ENABLE_PLATE_MOTION !== 'false') {
    const { loadPlateMotion } = await import('./plateMotion.js');
    plateMotion = loadPlateMotion({ scene, radius: CRUST_RADIUS, atlas });
}
```

`package.json` gains `build:no-plate-motion`. The `index.html` `process`
stub already handles the dev case.

When the feature is off, the atlas's boundary lines render with their
existing `LineBasicMaterial` (no flow shader). Arrows aren't created.
`pb2002_poles.json` and `pb2002_steps_with_plates.geojson` aren't
imported, so they're tree-shaken from the bundle.

## Performance

- **Arrows.** Single `InstancedMesh` with ~160 instances. Negligible
  draw call cost. Per-frame update is zero (geometry is static; only
  the GUI live-tunes scale, which mutates `instanceMatrix`).
- **Flow shader.** Runs on the existing boundary `LineSegments`
  geometry — no extra geometry, just a fragment shader over the same
  pixels we already paint. Adds a `uTime` update per frame, which is
  trivial.
- **Velocity computation.** Done once at module init for ~160 arrow
  instances (80 sample points × 2 plates). ~3 floating-point cross
  products plus a few trig calls each. Sub-millisecond at startup.

Total expected impact: <1ms additional CPU at startup, <0.1ms per
frame.

## Out of scope (follow-ups)

- **Hover/click info.** Show plate names + mm/yr on hover. Needs a
  raycaster pass over the arrow `InstancedMesh`. Worthwhile but not in
  the first pass.
- **Animate the past.** Rewind to ancestral plate configurations.
  Would need geological reconstructions (GPlates etc.). Major build.
- **Absolute-frame motion.** Currently we visualize *relative* motion
  between adjacent plates. An absolute frame (HS3-NUVEL1A no-net-rotation,
  or hot-spot reference) would need extra data and a frame toggle.

## Files touched

```
NEW:
  src/plateMotion.js
  data/pb2002_steps_with_plates.geojson
  data/pb2002_poles.json
  docs/superpowers/specs/2026-04-27-plate-motion-design.md
  docs/superpowers/plans/2026-04-27-plate-motion.md      (next step)
MODIFIED:
  scripts/prep-atlas-data.js
  src/atlasTuning.js
  src/atlas.js                  (expose boundaryGroups for material swap)
  src/main.js                   (build-flag-gated dynamic import)
  package.json                  (add build:no-plate-motion script)
```

## Known unknowns / risks

1. **Plate-pair lookup gaps.** PB2002 has segments labelled with
   plate-pair codes that aren't in the published Euler table (rare,
   small plates). Plan: log a warning and skip those segments; arrow
   set is incomplete but not broken.
2. **Direction sign at transforms.** The cross-product gives a
   tangent vector, but its sign relative to the line tangent depends
   on plate ordering. We'll need to check empirically that the San
   Andreas (right-lateral) reads correctly and adjust the sign
   convention if needed.
3. **Antimeridian segments.** Boundary lines that cross the ±180°
   seam need careful handling so the arc-length attribute doesn't
   jump. Existing atlas code already deals with this for line
   rendering; we follow that precedent.
4. **PB2002 pole table sourcing.** The published table is in a PDF
   appendix. We'll either transcribe it (tedious but small) or find a
   community-maintained machine-readable copy. The spec doesn't depend
   on which.
