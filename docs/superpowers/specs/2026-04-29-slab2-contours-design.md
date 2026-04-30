# Slab2 Contour Ribbons

**Date:** 2026-04-29
**Status:** Spec ready for implementation

## Goal

Add a 3D depth-contour visualization of subducting slabs to the earthquake visualizer. Each subduction zone's slab is rendered as a stack of iso-depth contour ribbons (50/100/200/300/400/500/600/700 km), descending into the planet at the appropriate radius. Helps the viewer see *why* deep earthquakes cluster where they do — they trace the subducting slab.

This is the first deferred Stage B item from `docs/superpowers/specs/2026-04-26-atlas-stage-a-design.md`. Stage B's "plate motion arrows" item is dropped (per simplification series); Stage B's "bathymetry shading" is the next branch after this one.

## Source

**Dataset:** USGS Slab2 (Hayes et al., 2018). Comprehensive global model of subducting slab geometry, 27 zones, released by USGS as a data product.

**Release:** USGS ScienceBase. DOI: `10.5066/F7PV6JNV`. URL: https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467.

**License:** U.S. Government work — public domain. No legal attribution requirement, but the canonical citation is included for credit.

**Citations:**
- Hayes, G. P., Moore, G. L., Portner, D. E., Hearne, M., Flamme, H., Furtney, M., Smoczyk, G. M. (2018). "Slab2, a comprehensive subduction zone geometry model." *Science* 362(6410): 58–61. doi:10.1126/science.aat4723
- Hayes, G. (2018). "Slab2 — A Comprehensive Subduction Zone Geometry Model." USGS data release. doi:10.5066/F7PV6JNV

**File format used:** Per-zone `<zone>_contours.in` files. These are GMT-style multi-segment ASCII text:

```
> -Z<depth_km>           # segment header naming the depth value
<lon> <lat>              # one (lon, lat) point per line
<lon> <lat>
> -Z<next_depth>         # next segment
...
```

The release also contains depth grids (`.grd`, NetCDF), clipping masks (`.csv`), and discrete-node files for overturning slabs (`*_sup.csv`). For our purposes, the pre-computed `*_contours.in` files are sufficient — they already provide depth contours at standard intervals (typically 20 km steps) and avoid both shapefile tooling and marching-squares regeneration.

## Filter

Keep only the 8 chosen depths: **40, 100, 200, 300, 400, 500, 600, 700 km**. (Brainstorm picked 50 km for the shallow emphasis, but Slab2's contour files use 20 km intervals — 50 km isn't in the data; 40 km is the closest substitute.) Drop strike and dip contours. Drop depths outside this set.

Also during prep, split any segment crossing the antimeridian (where `|Δlon| > 180°` between consecutive points) into two segments. Tonga, Kermadec, and the Aleutians cross the dateline; without splitting, those segments draw as horizontal sweeps across the entire globe.

## Architecture

Two new modules + one prep script + one new data file. `src/atlas.js` is **not** modified — slab2 is a sibling layer with its own data, render path, and tuning.

```
scripts/prep-slab2.js                         (new, one-shot at refresh)
  fetches 27 *_contours.in files from USGS ScienceBase
  parses GMT segment format
  filters to 8 chosen depths
  splits antimeridian crossings
  rounds coords to 2 decimals
  emits data/slab2_contours.geojson

data/slab2_contours.geojson                   (committed; ~1–2 MB estimated)
  FeatureCollection of LineString features
  Each: { properties: { zone: 'alu', depth_km: 100 }, geometry: LineString }

src/slabColors.js                             (new — the Strategy registry)
  export const DEPTHS = [50, 100, 200, 300, 400, 500, 600, 700];
  export const colorStrategies = {
    viridis:        depthKm => THREE.Color,    // default — perceptually uniform purple→yellow
    markerExtended: depthKm => THREE.Color,    // ember/mid/cyan extended to indigo for 400-700km
    single:         depthKm => THREE.Color,    // one muted color, depth-agnostic
  };

src/slab2.js                                  (new — sibling of atlas.js)
  loadSlab2({ scene, radius })
    reads data/slab2_contours.geojson (Bun JSON import)
    groups features by `zone` (~27 groups)
    for each zone:
      builds LineGeometry combining all 8 depth contours,
        each contour positioned at radius * (1 - depth_km / EARTH_RADIUS_KM),
      builds per-vertex color buffer from the active strategy,
      calls LineGeometry.setColors(buffer)  ← NOT setAttribute('color', ...)
      builds LineMaterial with vertexColors: true, transparent: true,
      patches material via onBeforeCompile to inject a `uGlow` uniform,
      creates LineSegments2 with renderOrder = 1 (below plate boundaries),
      mesh.userData = { zone, isSlab: true, glowUniform },
      adds to scene; tracks in slabZones[zone]
  exports: {
    setColorStrategy(name)   // rewrites every zone's color buffer
    setVisible(zone, bool)   // toggles a single zone (no GUI surface yet)
    setGlow(zone, factor)    // updates the zone's glow uniform (0..1)
  }

src/atlasTuning.js                            (modified)
  defaults adds: showSlabs, slabWidth, slabOpacity, slabColorStrategy
  buildAtlasGui adds a "Slabs (Slab2)" folder

src/main.js                                   (modified)
  imports loadSlab2, calls it after loadAtlas
```

## Render details

**Per-vertex colors via `LineGeometry.setColors()`.** This is `LineGeometry`'s own API for fat lines — distinct from a normal BufferGeometry's `setAttribute('color', ...)`. The fat-line geometry expands each input vertex internally into instanced segment geometry, and `setColors([r,g,b,r,g,b,...])` is the right entry point. **Do not mix the two paths** — they don't agree on what counts as a vertex.

**Material with glow uniform via `onBeforeCompile`.** Standard `LineMaterial` constructor with `vertexColors: true`, `transparent: true`, plus an `onBeforeCompile` hook that:
1. Adds a `uGlow` uniform (default `value: 0.0`).
2. Patches the fragment shader's color output to multiply final color by `(1.0 + uGlow * 2.0)` (or similar — exact constant tunable).
3. Stores the uniform reference on `mesh.userData.glowUniform` so `setGlow(zone, factor)` can mutate it directly.

`onBeforeCompile` is preferred over subclassing `LineMaterial` because LineMaterial manages internal uniforms (resolution, dash params) that are easy to break in a subclass.

**Render order = 1**, same as the fault layer. Plate boundaries (renderOrder = 2) paint over slabs at intersections; markers and the rest sit at default 0.

**Geometry positioning.** Each (lon, lat) at depth `d` is mapped onto a sphere at radius `CRUST_RADIUS - d` (both in km). With `CRUST_RADIUS = 6367` (the existing constant from `scene.js`), the 40 km contour sits at radius `6327`, the 700 km contour at `5667`. The deep contours pass through the camera's orbital distance from origin (~5800 km) — but the camera orbits via `camGroup`, so the camera position and contour positions never collide; standard depth-buffer rendering handles ordering.

## Color strategies

**`viridis` (default).** Purple → blue → teal → green → yellow, perceptually uniform. Each of the 8 depths samples a fixed point on the colormap. Implemented as a hand-coded 8-entry lookup or via a small viridis hex-string table — no dependency needed.

**`markerExtended`.** Reuses the existing earthquake-marker palette (`tuning.emberHex`, `midHex`, `cyanHex`) for shallow contours (50, 100, 200, 300 km), then extends into indigo / near-black for the deep contours (400, 500, 600, 700 km). Visual continuity with the markers — same depth, similar hue family.

**`single`.** All 8 depths share one muted color (a tan/brown like `#7a5a3c`, similar to faults). Depth distinction comes only from the contour's radial position. Useful as a low-information-density fallback or for debugging the geometry without the color noise.

The registry exports `colorStrategies` keyed by strategy name. The active strategy is named in `atlasTuning.slabColorStrategy` ('viridis' default). The GUI dropdown is wired to `Object.keys(colorStrategies)`, so adding a new strategy (e.g., `synthwave` later) requires only one new entry in the registry — the dropdown auto-populates. (Synthwave note: this exact extensibility is the hook for the future neon/glow theme captured in the project memory.)

## GUI controls

New `defaults` keys in `src/atlasTuning.js`:

```js
showSlabs:          true,
slabWidth:          0.5,        // multiplier on boundaryWidth (matches faultWidth pattern)
slabOpacity:        0.6,
slabColorStrategy:  'viridis',
```

New "Slabs (Slab2)" GUI folder in `buildAtlasGui`, sitting between "Faults" and "Visibility":

```js
const fSlabs = gui.addFolder('Slabs (Slab2)');
bindVis  (fSlabs.add(atlasTuning, 'showSlabs'));
bindColor(fSlabs.add(atlasTuning, 'slabWidth',   0, 2, 0.05));
bindColor(fSlabs.add(atlasTuning, 'slabOpacity', 0, 1, 0.01));
bindColor(fSlabs.add(atlasTuning, 'slabColorStrategy', Object.keys(colorStrategies)));
```

The strategy dropdown uses lil-gui's `add(obj, prop, optionsArray)` form. Switching the dropdown calls `slabs.setColorStrategy(newName)` (wired through the existing `onAtlasColorChange` callback path).

## Attribution

USGS Slab2 is public domain — no legal requirement. Two surfaces still get a credit:

1. **`#data-credits` footer in `index.html`.** Add "Slabs: USGS Slab2" alongside the existing PB2002 and GEM credits.
2. **`README.md` Data Sources section.** Add a Slab2 bullet with both citations (paper + data release) and the public-domain note.

## Future-flex hooks (designed in, not consumed yet)

- **`setGlow(zone, factor)`** updates a per-mesh uniform. The glue layer for "click an earthquake → that earthquake's slab glows briefly" is a future task — it needs (a) earthquake-to-zone lookup, (b) a click handler, (c) a time-decay animator. None of those are in scope for this spec.
- **`colorStrategies` registry.** Synthwave, dark-mode, etc. become single entries here.

## Out of scope

- Click-to-glow interaction (designed-in via `setGlow` but no event wiring, no earthquake→zone lookup, no animator).
- Earthquake → slab association logic.
- Synthwave theme (memory-noted for later — see `~/.claude/projects/-Users-mattbaker-Development-earthquake/memory/future_synthwave_theme.md`).
- Strike / dip / thickness / uncertainty visualizations from the other Slab2 files.
- Surface-mesh rendering of full slab tops (we picked contour lines).
- Per-zone GUI toggle (the `setVisible(zone)` API exists but no UI surface).
- Per-strategy tunable parameters (each strategy is self-contained).
- Animated depth-peeling, fly-throughs, or interaction beyond click-to-glow.

## Risks & gotchas

- **`LineGeometry.setColors()` vs `setAttribute('color', ...)`** — fat-line geometry needs the dedicated `setColors()` API. Mixing the two will produce wrong-looking colors or runtime errors.
- **Antimeridian crossings** — handled in prep by splitting on `|Δlon| > 180°`. If skipped, Tonga / Kermadec / Aleutian segments draw as long horizontal lines across the whole globe.
- **Overturned slabs (`izu`, `ker`, `man`, `sol`).** Four zones have segments where slab dip > 90° — the slab folds back on itself. The `*_contours.in` files still produce depth contours that are valid as iso-surfaces, but rendering them as 2D rings on a sphere at varying radii visually shows the overturn correctly (multiple contours at the same lat/lng but different radii). If the visual is confusing, fallback is to drop the deep contours for those four zones (`> 400 km`) or render those zones from the discrete `_sup.csv` form. Decide after smoke test; v1 renders all of them.
- **Bundle size.** Adds ~1–2 MB inlined GeoJSON. Cumulative bundle goes from ~5.7 MB to ~7 MB minified. Spec'd as acceptable; matches the pattern set by GAF.
- **Render perf.** ~27 zones × ~thousands of segments each = manageable for `LineSegments2`. One draw call per zone. WebGL handles thousands of draw calls per frame; we add 27.
- **Depth-radius mapping with overturning zones.** A single (lat, lng) on an overturning slab maps to two depths (the slab top is on one side; the slab bottom on the other after the fold). The `*_contours.in` files trace one side; drawing the contour at its labeled depth is geometrically correct.
- **Camera position vs contour radii.** Camera orbits at ~5800 km from origin. The 700 km contour is at radius ~5667 km. Some deep contours are nearer the origin than the camera — that's fine; standard depth ordering handles it. Just don't accidentally clip them with a near plane (camera near = 1, far = 20000 in `scene.js`; both contour positions are well within range).

## Testing

This is data-bundle + render-layer work. Verification is largely manual:

1. **Prep step.** `bun run prep-slab2` (or whatever script we wire) succeeds, writes `data/slab2_contours.geojson`. Feature count is in the low thousands (~1.5–3k LineString features). Sanity-check: each of the 27 expected zones has at least one feature; each feature's `depth_km` is one of the 8 chosen depths.
2. **Build clean.** `bun run build` succeeds, bundle bumps to ~7 MB.
3. **Visual smoke test.** Open `bun run dev`, confirm:
   - Contours visible at major subduction zones: Cascadia (NW US), Tonga, Sumatra, Japan, Aleutians, Andes.
   - Color ramp readable — at the very least, shallow vs deep is distinguishable.
   - Strategy dropdown swaps colors live without re-render lag.
   - Width and opacity sliders respond live.
   - Plate boundary lines paint over slab contours at intersections.
   - No console errors, no z-fighting visible.
   - Antimeridian zones (Tonga, Aleutians) render as discrete arcs, not horizontal sweeps.
4. **localStorage compat.** Existing users without the four new keys load cleanly with defaults.

## Acceptance

- The 8-depth contour layer renders globally with no console errors.
- The strategy dropdown swaps colors at interactive frame rates.
- The GUI's Slabs folder has the 4 expected controls.
- Antimeridian-crossing zones don't draw spurious globe-wide segments.
- The CC-BY-SA-derived `data/gem_active_faults_trimmed.geojson` from the prior fault layer is unaffected.
- README and `#data-credits` footer cite Slab2.
