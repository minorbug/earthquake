# Slab2 Continuous Surface Meshes

**Date:** 2026-04-29
**Status:** Spec ready for implementation

## Goal

Render USGS Slab2 subducting slabs as continuous translucent surface meshes (one `Mesh` per zone), descending into the planet from the trench at the trench (depth 0) to ~700 km depth. Replaces the previously-considered wireframe-fence-of-connectors approach with a more credible "solid slab" visualization.

The existing 8-depth contour ring layer (Slab2 contours, shipped on master) is **kept as an opt-in overlay** — it can be re-enabled in the GUI to drape labeled depth rings on top of the surfaces, but defaults to OFF so the out-of-the-box look is the clean solid surfaces.

## Source

**Dataset:** Same USGS Slab2 release used for the contour layer.
- DOI: 10.5066/F7PV6JNV
- ScienceBase parent: https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467
- License: U.S. Government work — public domain.

**File format used:** Per-zone `*_dep.grd` (NetCDF-3 GMT format), one per ScienceBase child item. Each is a uniform 0.05° lat/lon grid of slab-top depth values, with NaN outside the slab boundary. ~120 KB per zone, ~3–5 MB total raw across 26 zones.

The NaN values act as the natural clip mask — no separate `_clp.csv` polygon parse needed.

## Filter & downsample

- Keep only cells where ALL 4 corners have non-NaN depth.
- Antimeridian: skip cells where any pair of grid-adjacent corners spans `|Δlon| > 180°`.
- Downsample to **0.1° (every 2nd cell)** during prep. Halves the mesh density vs native resolution while keeping the visual credible.
- Skip the supplementary discrete-node files (`*_sup.csv`) for v1. Four zones (izu/ker/man/sol) overturn at depth and have additional folded geometry encoded as point clouds in those files — out of scope here. The upper, single-valued portion in `_dep.grd` covers >90% of visible geometry.

## Architecture

Two new files + one binary asset + targeted edits to `atlasTuning.js`/`main.js`. `src/slab2.js` (the existing contour layer) is **not** modified — surfaces are a sibling layer.

```
scripts/prep-slab2-surfaces.js                   (new, one-shot at refresh)
  fetches per-zone *_dep.grd from ScienceBase
  parses NetCDF-3 with `netcdfjs` (Bun-side dev dep)
  downsamples to 0.1°
  emits indexed triangle meshes per zone (NaN/antimeridian clipping)
  writes data/slab2_surfaces.bin + data/slab2_surfaces.json (manifest)

data/slab2_surfaces.bin                          (committed, ~6 MB raw / ~2 MB gzipped)
  Concatenated Float32Array positions for all zones
  Concatenated Uint16Array indices per zone
  Per-vertex depth_km in a Float32Array (used to compute color at load)

data/slab2_surfaces.json                         (committed, small)
  [{ zone: 'alu', vOff: 0, vCount: 12345,
                  iOff: 0, iCount: 67890,
                  depthMin: 0, depthMax: 280 }, ...]

src/slabColors.js                                (extended)
  + continuousColorFromDepth(depthKm, strategyName) → THREE.Color
    Smoothly lerps between the named strategy's existing 8 stops
    based on (depthKm / 700). Reuses VIRIDIS_STOPS / MARKER_EXTENDED_STOPS
    arrays from the existing slabColors.js. Falls back to viridis on
    unknown strategy names.

src/slab2Surfaces.js                             (new — sibling of slab2.js)
  loadSlab2Surfaces({ scene, radius })
    fetches /data/slab2_surfaces.bin + .json
    for each zone:
      slices into BufferGeometry (positions + indices)
      builds per-vertex Color buffer via continuousColorFromDepth(...)
      Mesh with MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: atlasTuning.slabSurfaceOpacity,
        side: FrontSide,
        depthWrite: false,
      })
      mesh.renderOrder = 0
      mesh.userData = { zone, isSlabSurface: true, uGlowRef: { value: 0 } }
      adds to scene; tracks in surfaceZones[zone]
    onAtlasColorChange: rebuild color buffer (strategy swap), update opacity
    onAtlasVisibilityChange: toggle visibility based on showSlabSurfaces
  exports: { setColorStrategy, setOpacity, setVisible(zone, bool), setGlow, zones }

src/atlasTuning.js                               (modified)
  defaults adds: showSlabSurfaces: true, slabSurfaceOpacity: 0.3
  defaults changes: showSlabs: false (was true) — contour rings now opt-in
  buildAtlasGui: reorders the existing "Slabs (Slab2)" folder so surface
    controls come first; renames the showSlabs label to "showSlabRings"
    via .name() (storage key unchanged for localStorage compat).

src/main.js                                      (modified)
  imports loadSlab2Surfaces, calls it after loadSlab2.
```

## Mesh construction algorithm (offline)

For each zone:

```
1. Parse the NetCDF-3 grid → 2D array `depth[i][j]` with NaN outside.
2. Read the lat/lng axes from the NetCDF dimensions.
3. Initialize empty positions, indices, depths, vertexMap (i,j → index).
4. For (i, j) in (0..nLat-2, 0..nLng-2) stepping by 2 (downsample):
     corners = [(i,j), (i+1,j), (i,j+1), (i+1,j+1)]
     if any corner has NaN → skip
     if any adjacent corner pair has |Δlon| > 180° → skip
     for each corner not yet in vertexMap:
       compute (x,y,z) from geoToVec3Depth(lat, lng, depth, CRUST_RADIUS)
       push into positions, depths
       record index in vertexMap
     emit two triangles: (a,b,c) and (b,d,c)  // CCW from outward normal
5. Append zone's slice to the global buffers; record manifest entry.
```

Per-zone vertex counts at 0.1° downsample: typically 5k–30k. Total across 26 zones: ~700k–800k vertices. Indices use `Uint16` per zone (each zone is well under 65k vertices).

## Render details

**Material baseline:**
```js
new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: atlasTuning.slabSurfaceOpacity,    // default 0.3
    side: FrontSide,                            // not DoubleSide
    depthWrite: false,                          // critical for translucency
});
```

`FrontSide` rather than `DoubleSide`: the camera is always outside the planet, and rendering both faces of a curving sheet causes alpha doubling and a murkier look. Lower base opacity (0.3) compensates for the missing back-face contribution.

`depthWrite: false` is the critical line. Without it, a near surface segment can occlude both far segments of the same surface AND contour rings rendering at the same world position. With it set, transparent pixels don't write to the depth buffer; subsequent draws layer correctly.

**Render order:**
- Plate boundaries (renderOrder 2): top
- Contour rings (renderOrder 1, when enabled): middle
- Surfaces (renderOrder 0): bottom

**Per-vertex color:** computed at build time from `continuousColorFromDepth(depthKm, atlasTuning.slabColorStrategy)`. Strategy swap rewrites every zone's color attribute (cheap — `BufferAttribute.needsUpdate = true` after writing the new Float32Array).

**Future click-to-glow hook:** each mesh gets `userData.uGlowRef = { value: 0 }`, mirroring the contour layer's pattern. Shader-side wiring deferred to the future click-to-glow handler task.

## Color strategies (extension)

`src/slabColors.js` adds one helper:

```js
// Smooth interpolation between adjacent stops of a named strategy.
// Used by the surface layer; the contour layer keeps using the
// discrete per-stop mapping unchanged.
export function continuousColorFromDepth(depthKm, strategyName) {
    const stops = STOPS_BY_NAME[strategyName] || VIRIDIS_STOPS;
    const t = Math.max(0, Math.min(1, depthKm / 700)) * (stops.length - 1);
    const i = Math.floor(t);
    const frac = t - i;
    const a = new Color(stops[i]);
    const b = new Color(stops[Math.min(i + 1, stops.length - 1)]);
    return a.lerp(b, frac);
}

// Internal helper: stop arrays exported by name for the lerp helper.
const STOPS_BY_NAME = {
    viridis: VIRIDIS_STOPS,
    markerExtended: MARKER_EXTENDED_STOPS,
    single: ['#7a5a3c', '#7a5a3c'],   // flat — lerp is a no-op
};
```

Adding a future strategy (e.g., `synthwave`) means: define a new stops array, register it in `colorStrategies` AND `STOPS_BY_NAME` AND the GUI dropdown options array (3 places to keep in sync — same lock-step pattern the contour layer already requires).

## GUI controls

Two new keys in `atlasTuning.js`:

```js
// Surfaces (primary)
showSlabSurfaces:   true,
slabSurfaceOpacity: 0.3,
```

One existing default flips:

```js
showSlabs: false,   // was true; contour rings now opt-in overlay
```

The "Slabs (Slab2)" folder is reordered so surface controls come first:

```js
const fSlabs = gui.addFolder('Slabs (Slab2)');
// Surfaces (primary)
bindVis  (fSlabs.add(atlasTuning, 'showSlabSurfaces'));
bindColor(fSlabs.add(atlasTuning, 'slabSurfaceOpacity', 0, 1, 0.01));
// Shared color strategy (affects both surfaces and rings)
bindColor(fSlabs.add(atlasTuning, 'slabColorStrategy',
                     ['viridis', 'markerExtended', 'single']));
// Contour ring overlay (optional, default OFF)
bindVis  (fSlabs.add(atlasTuning, 'showSlabs').name('showSlabRings'));
bindColor(fSlabs.add(atlasTuning, 'slabWidth',   0, 2, 0.05));
bindColor(fSlabs.add(atlasTuning, 'slabOpacity', 0, 1, 0.01));
```

The `.name('showSlabRings')` is a GUI label only — storage key stays `showSlabs` for localStorage compatibility with users from the prior contour-layer ship.

## Wiring (`main.js`)

```js
import { loadSlab2 } from './slab2.js';
import { loadSlab2Surfaces } from './slab2Surfaces.js';
// ...
const slabs = loadSlab2({ scene, radius: CRUST_RADIUS });
const slabSurfaces = loadSlab2Surfaces({ scene, radius: CRUST_RADIUS });
```

Both layers coexist; they read independent keys from atlasTuning. The `slabs`/`slabSurfaces` consts are captured for future click-to-glow wiring.

## Data flow

```
USGS ScienceBase (per-zone *_dep.grd) ──prep-slab2-surfaces.js──▶  data/slab2_surfaces.bin
                                                                  data/slab2_surfaces.json
                                                                  (committed)

(browser startup) ──fetch──▶  slab2_surfaces.bin/json ──▶  src/slab2Surfaces.js
                                                              │
                                                              ▼
                                                         BufferGeometry + Mesh per zone

src/atlasTuning.js (showSlabSurfaces / slabSurfaceOpacity / slabColorStrategy)
                              │
                              ▼ listeners
                       live update of opacity / colors / visibility
```

## Attribution

Slab2 already cited in:
- `index.html` `#data-credits` footer (added with the contour layer).
- `README.md` "Data Sources" section.

Append one short paragraph to `data/LICENSE`'s existing Slab2 section noting the new `slab2_surfaces.bin` is also derived from the same release. No new in-app credit needed.

## Out of scope

- **Overturning slab supplementary nodes** (`*_sup.csv`). The deep folded portions of izu/ker/man/sol won't render; their slabs will appear truncated at ~400-500 km. Future v2 could add point sprites.
- **Per-zone GUI toggle.** `setVisible(zone, bool)` API exists but no GUI.
- **Wireframe-fence connectors.** Replaced entirely by surfaces.
- **Click-to-glow handler.** `uGlowRef` is exposed on `mesh.userData` for future wiring; click event handling, earthquake → zone lookup, and shader injection are out of scope.
- **Smooth/lit shading.** `MeshBasicMaterial` is unlit. Adding `MeshStandardMaterial` with normals + lighting would substantially change the look — defer.
- **Animated effects** (pulsing, fly-through, sweeping reveal).
- **Down/up-sampling beyond 0.1°.** Density is fixed at prep time. If users want denser/sparser meshes, that's a re-prep, not a runtime tuning.

## Risks & gotchas

- **Bundle delta.** ~6 MB raw / ~2 MB gzipped data file. Shipped as a separate static asset (`data/slab2_surfaces.bin`), fetched async on startup. JS bundle untouched.
- **Z-fighting between rings and surfaces.** Rings sit at exactly the radii where the surface is at that depth. If flicker appears, push rings outward by ~0.5 km radial offset. Defer to smoke test; only fix if observable.
- **Backface alpha doubling avoided** by `FrontSide`. Edge case: when looking at a slab edge-on, the visible cross-section may briefly disappear because the front face is grazing-perpendicular. Acceptable tradeoff; users orbit around so this is transient.
- **netcdfjs API.** `new NetCDFReader(buffer).getDataVariable('z')` returns a flat 1D array. Reshape with the dimension sizes from `.dimensions`. NetCDF-3 only, which is what GMT writes.
- **Existing contour layer's localStorage state.** Users with stored `showSlabs: true` will see both layers (rings on top of surfaces, more visually busy). Fresh users see surfaces only. Acceptable — they can toggle in the GUI.
- **Async fetch on startup.** The binary fetch happens after `loadSlab2Surfaces` is called. Surface meshes appear on the page slightly after the rest of the scene has rendered. The delay should be <500ms over a fast connection. If the user's bundle is being served from a slow origin, slabs may pop in noticeably.
- **Per-vertex Color allocation.** Building per-vertex colors at load time allocates one `Color` per vertex (~700k allocations). Strategy swap re-allocates. At this scale it's a sub-100ms cost — acceptable. Could be optimized later by caching `[r,g,b]` triplets directly without `THREE.Color` objects.

## Testing

Manual verification:

1. **Prep step.** `bun run prep-slab2-surfaces` succeeds. `data/slab2_surfaces.bin` is 4–8 MB raw. Manifest has 26 zone entries with reasonable vCount/iCount values.
2. **Build clean.** `bun run build` succeeds. JS bundle stays close to the existing 6.5 MB minified (the binary is a separate fetch).
3. **Visual smoke test.** `bun run dev`. Confirm:
   - Surfaces visible at major subduction zones: Cascadia (NW US), Tonga, Sumatra, Japan, Aleutians, Andes.
   - Color ramp readable — shallow purple/blue, deep yellow.
   - Translucent — you can see distant features through the slabs.
   - Plate boundaries paint over slab surfaces at intersections.
   - "Slabs (Slab2)" GUI folder shows: showSlabSurfaces, slabSurfaceOpacity, slabColorStrategy, showSlabRings, slabWidth, slabOpacity (in that order).
   - Toggling `showSlabSurfaces` cleanly hides/reveals surfaces.
   - Toggling `showSlabRings` adds depth contour rings on top of surfaces.
   - Strategy dropdown swap recolors both surfaces and rings (when visible) consistently.
   - Opacity slider is responsive and live.
   - No console errors, no Z-fighting visible.
4. **localStorage compat.** Fresh users (clear localStorage and reload): see surfaces only, rings hidden. Returning users with stored `showSlabs: true`: see both layers.
5. **Bundle size check.** `bun run build` and inspect `dist/`. JS bundle stays under 7 MB minified. Static binary is separate.

## Acceptance

- 26 surface meshes render at the expected subduction zones.
- Strategy swap works live and affects both layers consistently.
- `depthWrite: false` correctly handles transparency layering — no obvious z-fighting or wrong occlusion.
- Antimeridian zones (Tonga, Aleutians, Kermadec) don't draw spurious globe-spanning triangles.
- Existing contour ring layer remains functional as opt-in overlay.
- README and `data/LICENSE` reflect the new file.
- Browser console clean.
