# Vector Atlas — Stage A Design

Replace the photographic globe (`img/world.jpg`) with a vector-rendered atlas: dark-ocean sphere, slightly-lighter continent fills, ice-tinted Antarctica, and PB2002 plate boundaries styled by type. This is the first of three stages in the broader tectonic-visualization roadmap; Stages B and C add 3D slab contours / plate-motion arrows / focal mechanisms / volcanoes on top of this base.

## Goals

- Replace the photographic Earth texture with a vector-rendered atlas that lets future tectonic data layers breathe.
- Make plate boundaries visible globally, color-coded by boundary type.
- Establish a dark color palette distinct from the existing ember→cyan marker palette so the atlas recedes and the live quake markers stay foreground.
- Add live styling controls (lil-gui) so the look can be dialed in.

## Non-Goals

- Slab2 contour ribbons (Stage B).
- Plate motion arrows (Stage B).
- Focal-mechanism beach balls, volcanoes, historical Mw 8+ markers, GSRM strain heatmap (Stage C).
- Postprocessing / bloom on boundary lines (Stage C polish).
- Bathymetry shading on the ocean (Stage B+ if at all).
- Replacing the OSM iframe in the click-to-detail panel.
- Mobile / touch optimization beyond what already works.

## Visual Design

### Palette

| Surface | Hex | Role |
|---------|-----|------|
| Ocean (sphere) | `#0a1428` | Dark, recedes to background |
| Land | `#1a2238` | Slightly lighter than ocean |
| Antarctica | `#2a3548` | Slight ice tint, lighter than land |
| Boundary: divergent (OSR, CRB) | `#d840ff` | Magenta — mid-ocean ridges, continental rifts |
| Boundary: convergent (OCB, CCB, SUB) | `#6020c0` | Deep purple — subduction zones |
| Boundary: transform (OTF, CTF) | `#f0c060` | Pale gold — strike-slip |
| Boundary: other / diffuse | `#ffffff` @ α 0.18 | Faint white |

The magenta / purple / gold trio is intentionally outside the ember (`#ffeebb`) → mid (`#ff7733`) → cyan (`#22ccff`) marker palette so live earthquakes always read as the foreground signal.

### Geometry stack (radial layering)

```
radius * 1.0010   plate boundary lines  (LineSegments)
radius * 1.0005   land + antarctica fills (Mesh, triangulated polygons)
radius * 1.0000   ocean sphere (the existing crust mesh, color-only)
```

Markers (blob + rings) continue to live at the standard radius via the existing `geoToVec3` placement; they will visually sit *on top* of the atlas thanks to the small radial offsets above.

## Architecture

### New module: `src/atlas.js`

Single entry point: `loadAtlas({ scene, radius, tuning, onAtlasReady })`.

Responsibilities:
- Import the three bundled GeoJSON files.
- Build the **land mesh**: triangulate each MultiPolygon ring with `earcut`, project vertices onto the sphere surface at `radius * 1.0005` via the existing `geoToVec3` (lat/lng/depth=0). Single `Mesh` with `MeshBasicMaterial({ color: tuning.landColor, side: DoubleSide })`. Add to `scene`.
- Build the **antarctica mesh**: same pipeline, separate mesh with its own `MeshBasicMaterial({ color: tuning.antarcticaColor })`.
- Build the **boundary lines**: parse PB2002 LineStrings, group features by `properties.Type`, build one `LineSegments` per group. Each LineString contributes pairs of consecutive vertices projected to `radius * 1.001`. Color each group from the corresponding tuning value. Use `LineBasicMaterial` (line width is GPU-clamped to 1px on most platforms — that's fine for v1).
- Return `{ land, antarctica, boundaryGroups }` so callers (specifically the live tuning panel) can mutate colors / visibility without rebuilding geometry.

### Modify `src/scene.js`

- Remove `TextureLoader`, `ClampToEdgeWrapping`, `LinearFilter`, `SRGBColorSpace`, `world.jpg` import (already removed in the upgrade), and the texture loading block.
- Replace the crust `Mesh`'s `MeshBasicMaterial({ map: tex, side: DoubleSide })` with `MeshBasicMaterial({ color: tuning.oceanColor, side: DoubleSide })`.
- The crust is now a flat-colored sphere; everything else paints on top.

### Modify `src/main.js`

- After `createScene()`, call `loadAtlas({ scene, radius: CRUST_RADIUS, tuning: atlasTuning })`.
- Wire the live-tuning callbacks (see below) so color changes propagate.

### New: `src/atlasTuning.js`

Mirrors the structure of the existing `src/tuning.js` (lil-gui panel + persistence) but for atlas styling. Exports a separate `atlasTuning` object and `onAtlasChange(cb)` callback. Two storage keys keeps marker tuning and atlas tuning independently resettable.

Alternative considered: extend the existing `src/tuning.js` with an "Atlas" folder. **Rejected** because it couples two unrelated concerns (markers and atlas) into one module and one localStorage blob; resetting one without the other becomes awkward.

### Modify `src/tuning.js`

No structural change — the existing `tuning.js` continues to own marker-related state. The `buildGui()` function now also builds the atlas folder by importing from `atlasTuning.js`. Or each module exposes its own `buildGui()` and `main.js` calls both.

**Decision**: each module exposes its own `buildGui()`. `main.js` calls both. lil-gui's `new GUI()` constructor produces independent panel instances; we'll either dock both top-right (stacked) or pass `{ container: document.body }` to the second so they don't overlap. Stacking via `marginTop` on the second panel's `.lil-gui` root is the simplest layout.

## Data Pipeline

Three GeoJSON files bundled in `data/`. All bundled into the JS at build time via Bun's `with { type: 'json' }` import assertion.

| File | Source | Raw | Simplified | Format |
|------|--------|-----|------------|--------|
| `data/ne_110m_land.geojson` | Natural Earth `ne_110m_land` (`https://www.naturalearthdata.com/downloads/110m-physical/110m-land/`) | ~110 KB | ~80 KB after rounding coords to 2 decimals | FeatureCollection of MultiPolygons |
| `data/ne_110m_antarctica.geojson` | Filter `ne_110m_admin_0_countries` for `sovereignt == "Antarctica"` | ~120 KB raw | ~30 KB | Single Polygon |
| `data/pb2002_boundaries.geojson` | Hugo Ahlenius mirror of Bird (2003) at `https://github.com/fraxen/tectonicplates/raw/master/GeoJSON/PB2002_boundaries.json` | ~150 KB | ~80 KB | FeatureCollection of LineStrings, `properties.Type` ∈ {OSR, OTF, OCB, CTF, CCB, SUB, CRB, ...} |

**Simplification**: round all coordinate values to 2 decimal places (~1.1 km accuracy at the equator, finer near the poles). At the rendered scale (a globe in a browser viewport), 2 decimals is indistinguishable from full precision. Done once, offline, with a tiny script — output committed to repo.

**Attribution**:
- Natural Earth: public-domain dedication (no attribution required, but courtesy).
- PB2002: Bird (2003), public-domain-equivalent. Cite *Bird, P. (2003), Geochem. Geophys. Geosyst., 4(3), 1027*.
- Add to a `Data sources` section in the existing footer (`#header h3`) in a follow-up styling pass — not blocking for Stage A.

## Boundary Type Mapping

PB2002's `properties.Type` field is a 2–3 letter code. Mapping to our palette:

| PB2002 code | Meaning | Palette |
|-------------|---------|---------|
| `OSR` | Oceanic Spreading Ridge | divergent (magenta) |
| `CRB` | Continental Rift Boundary | divergent (magenta) |
| `OTF` | Oceanic Transform Fault | transform (gold) |
| `CTF` | Continental Transform Fault | transform (gold) |
| `OCB` | Oceanic Convergent Boundary | convergent (purple) |
| `CCB` | Continental Convergent Boundary | convergent (purple) |
| `SUB` | Subduction zone | convergent (purple), 1.4× alpha boost (no actual linewidth in v1; see Implementation Notes) |
| _anything else_ | catchall | other (faint white @ 0.18 alpha) |

`SUB` distinction is implemented by giving subduction lines their own `LineSegments` group with `material.opacity` boosted by 1.4× relative to other convergent lines. Real linewidth differentiation requires `Line2` from three.js addons; deferred (see Implementation Notes).

## Live Tuning Panel

New "Atlas" panel via `src/atlasTuning.js`. Folders:

```
Colors
  oceanColor       color  #0a1428
  landColor        color  #1a2238
  antarcticaColor  color  #2a3548
  ridgeColor       color  #d840ff
  subColor         color  #6020c0
  transformColor   color  #f0c060
  otherColor       color  #ffffff
  otherAlpha       slider 0..1 step 0.01    default 0.18
Geometry
  boundaryWidth    slider 0..3 step 0.05    default 1.0   (relative line width multiplier)
Visibility
  showLand         toggle                    default true
  showBoundaries   toggle                    default true
```

Two callback hooks:
- `onAtlasColorChange(cb)` — fires when any color or alpha changes; cb receives the latest `atlasTuning` snapshot. `atlas.js` updates `material.color.setStyle()` per affected mesh.
- `onAtlasVisibilityChange(cb)` — fires when toggles flip; cb sets `mesh.visible`.

Persistence under localStorage key `eq-atlas-tuning`. Reset button restores defaults from the same `defaults` object pattern used in `src/tuning.js`.

## Implementation Notes

### Polygon triangulation

`earcut` (npm package, ~12KB minified, MIT) takes a flat array of 2D coords plus hole-start indices. For sphere rendering, we triangulate the polygon in 2D (lat/lng) and then project each vertex to 3D via `geoToVec3`. This works for all continents at this scale because no continent crosses a singularity (polygons that cross the antimeridian are split in Natural Earth).

For each MultiPolygon Feature in `ne_110m_land`:
- For each Polygon (rings = [outer, hole1, hole2, ...]):
  - Flatten to `[lng0, lat0, lng1, lat1, ...]`.
  - `earcut(flat, holeIndices, 2)` → triangle indices.
  - Build `BufferGeometry` with positions = projected `Vector3` per vertex, `setIndex(...)` to triangle indices.
- Merge all polygon geometries into one BufferGeometry (`BufferGeometryUtils.mergeGeometries`) for one draw call.

### Line geometry

Each LineString → pairs of consecutive vertices projected to sphere. All lines for one type group merged into one `BufferGeometry`, rendered as `LineSegments` with `LineBasicMaterial`. One `LineSegments` per type group (so colors are independently controllable).

`LineBasicMaterial.linewidth` is **ignored on most WebGL implementations** (clamped to 1px). The `boundaryWidth` tuning value will:
- Scale the alpha for v1 (thicker visual weight via opacity, until we want to invest in `Line2` from `three/addons/lines/`).
- Optionally use `Line2` + `LineMaterial` from three.js addons in a polish pass — this gives real linewidth at the cost of an extra ~10KB. Defer to Stage C or after.

### Antarctica filtering

Don't include Antarctica's polygon in `ne_110m_land.geojson`. Pre-strip it offline via the simplification script: filter `ne_110m_admin_0_countries.geojson` for `sovereignt == "Antarctica"`, save as the separate antarctica file. The land file becomes "everything else."

### Asset bundling

Bun bundles JSON imports into the JS output natively via `with { type: 'json' }`. No special build configuration. The three GeoJSON files (~190KB total simplified) end up in the bundled `index-*.js` and serve over gzip in production.

## Testing / Completion Checklist

Manual visual verification at `bun run dev` (the new dev server from the upgrade).

### Behavior parity with master

- [ ] All marker behavior unchanged: blobs pulse + warp, rings expand, click → detail panel.
- [ ] Loading overlay still appears, shakes, fades.
- [ ] Drag rotates; arrow keys orbit; markers stay clickable.
- [ ] No console errors.

### New behavior

- [ ] Network tab: no requests for `world.jpg`.
- [ ] Sphere is dark blue (`#0a1428`).
- [ ] Continents fill in slightly-lighter blue (`#1a2238`).
- [ ] Antarctica is visibly distinct from other landmasses (lighter / icier).
- [ ] PB2002 plate boundaries render globally:
  - [ ] Magenta along the Mid-Atlantic Ridge, East Pacific Rise (divergent).
  - [ ] Deep purple along the Pacific Ring of Fire arcs (subduction).
  - [ ] Pale gold along major transforms (San Andreas, Anatolian, etc.).
- [ ] Atlas folder in lil-gui shows all controls; color changes propagate live to the meshes.
- [ ] `showLand` / `showBoundaries` toggles hide/show their layers without errors.
- [ ] localStorage persists atlas tuning across reload (key `eq-atlas-tuning`).
- [ ] Reset to defaults restores the documented values.
- [ ] `bun run build` produces a `dist/` that loads correctly under any static server. The bundled JS is larger by roughly the simplified GeoJSON sizes (~190KB pre-gzip).

## Open Questions

None — proceeding to implementation plan.
