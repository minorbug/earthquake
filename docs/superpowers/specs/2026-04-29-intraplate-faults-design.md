# Intraplate Faults Layer

**Date:** 2026-04-29
**Status:** Spec ready for implementation

## Goal

Add a global intraplate fault line layer to the visualizer so seismically active intraplate zones (New Madrid, the Apennines, Tibet, etc.) are visible alongside plate boundaries. Faults are visually subordinated — secondary structural context that doesn't compete with plate boundaries for attention.

## Source

**Dataset:** GEM Global Active Faults (GAF) — `GEMScienceTools/gem-global-active-faults` on GitHub. A community-maintained global compilation of active faults released as GeoJSON LineString features. Per-feature properties present in the source include `name`, `slip_type`, `net_slip_rate`, `catalog_id`, `catalog_name`, `average_dip`, `average_rake`, `dip_dir`, `lower_seis_depth`, `upper_seis_depth`. Many fields are sparse — different constituent regional datasets fill in different subsets.

**File:** `geojson/gem_active_faults.geojson` from the repo's `master` branch. ~12.3 MB raw. ~13,500 LineString features.

**License:** CC-BY-SA. Both attribution and share-alike are required. Citation per the README: Styron, R. & Pagani, M. "The GEM Global Active Faults Database." *Earthquake Spectra* 36(1_suppl), Oct. 2020, pp. 160–180. doi:10.1177/8755293020944182.

**Filter: exclude PB2002 catalog only.** GAF is already curated as "active fault traces of seismogenic concern" — the dataset itself IS the active-fault set. There is no reliable per-feature field for Holocene-vs-older filtering (`last_movement` is a calendar year and is sparse). However, GAF's README lists PB2002 (Bird 2003) as a constituent dataset — meaning GAF includes plate-boundary lines that we already render directly from `data/pb2002_steps_with_plates.geojson`. To avoid double-drawing plate boundaries, the prep step drops features whose `catalog_name` (case-insensitive) contains "PB2002". All other features pass through. Rely on visual subordination for density management.

## Architecture

The new layer follows the same pattern as the existing PB2002 plate-boundary lines in `src/atlas.js`:

1. **Prep step** — `scripts/prep-atlas-data.js` reads the raw GAF GeoJSON (committed alongside other raw inputs in `data/`), filters to Holocene-active features, and emits `data/gem_gaf_holocene.geojson` with a trimmed property bag. Re-runnable via `bun run prep-data`.
2. **Render step** — `src/atlas.js` imports the filtered GeoJSON, adds a fourth boundary group called `'fault'`, and reuses the existing `buildLineGeometry` + `LineSegments2 + LineMaterial` plumbing. Distinct visual parameters give the layer visual subordination.
3. **Tuning step** — `src/atlasTuning.js` adds four new keys and a `'Faults'` GUI folder so the layer can be toggled and styled independently of plate boundaries.

## Components

### Prep script (`scripts/prep-atlas-data.js`)

New section after the existing PB2002 processing. Reads the raw GAF GeoJSON, drops PB2002-derived features (avoids duplication with the plate-boundary layer), and emits a trimmed GeoJSON with smaller property bags. Pseudocode:

```
gafFeatures = readJson('data/gem_active_faults.geojson').features
nonPB2002   = gafFeatures.filter(f =>
                !((f.properties.catalog_name || '').toLowerCase().includes('pb2002')))
trimmed     = nonPB2002.map(f => ({
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    name:         f.properties.name         || '',
                    slip_type:    f.properties.slip_type    || '',
                    catalog_name: f.properties.catalog_name || '',
                },
             }))
writeJson('data/gem_active_faults_trimmed.geojson',
          { type: 'FeatureCollection', features: trimmed })
```

The trimmer drops `average_dip`, `average_rake`, the slip-rate tuples, and the seis-depth fields. Keeps `name`, `slip_type`, `catalog_name` against possible future use (e.g., a "Faults colored by slip type" toggle, or a regional filter). Output should be ~30–50% the size of the raw source.

### Atlas integration (`src/atlas.js`)

Add `'fault'` to the boundary group list. The existing `BOUNDARY_GROUPS` array already drives the per-class rendering, but the fault group has different defaults than the plate-boundary classes, so it's cleanest to handle it as a sibling group rather than a fifth `BOUNDARY_GROUPS` entry. Concrete approach:

- Import the new GeoJSON: `import faultsJson from '../data/gem_active_faults_trimmed.geojson' with { type: 'json' };`
- Build line geometry for all fault features via the existing `buildLineGeometry(faultsJson.features, boundaryRadius)` helper.
- Construct a `LineMaterial` with:
  - `color: new Color(atlasTuning.faultColor)`
  - `linewidth: Math.max(0.05, atlasTuning.faultWidth * atlasTuning.boundaryWidth)`
  - `transparent: true`
  - `opacity: atlasTuning.faultOpacity`
  - `worldUnits: false`
  - `dashed: false`
- Wrap the geometry + material in a `LineSegments2`.
- Set `renderOrder = 1` (one less than plate boundaries' `renderOrder = 2`) so plate boundaries paint over faults at intersections.
- Push the result into `boundaryGroups` so the existing resize listener picks up its `LineMaterial.resolution`.

The `applyColors` callback gets three new lines that update the fault material's color, linewidth, and opacity from `atlasTuning`. `applyVisibility` (currently inline in the `onAtlasVisibilityChange` registration) gets one new line to toggle `faultMesh.visible` based on `atlasTuning.showFaults`.

### Tuning controls (`src/atlasTuning.js`)

Four new keys in `defaults`:

```js
    showFaults:    true,
    faultColor:    '#7a5a3c',
    faultWidth:    0.5,    // multiplier on boundaryWidth
    faultOpacity:  0.4,
```

New `'Faults'` GUI folder in `buildAtlasGui`, placed between the existing `'Geometry'` and `'Visibility'` folders:

```js
    const fFaults = gui.addFolder('Faults');
    bindVis  (fFaults.add(atlasTuning, 'showFaults'));
    bindColor(fFaults.addColor(atlasTuning, 'faultColor'));
    bindColor(fFaults.add(atlasTuning, 'faultWidth',   0, 2, 0.05));
    bindColor(fFaults.add(atlasTuning, 'faultOpacity', 0, 1, 0.01));
```

The reset handler picks up the new defaults automatically since it iterates over `defaults`.

### Attribution

Per the GEM license, the layer requires source attribution. Two surfaces:

1. **In-app credit.** Add `Faults: GEM Global Active Faults` to the existing detail-panel attribution area (mirroring the OSM credit at `index.html:26`).
2. **README.md.** Add a "Data sources" section listing PB2002 and GEM GAF with their respective citations and license terms.

## Data flow

```
data/gem_active_faults.geojson    ──prep-atlas-data.js──▶  data/gem_active_faults_trimmed.geojson
(raw, committed)                                            (trimmed, committed)

data/gem_active_faults_trimmed.geojson  ──Bun JSON import──▶  src/atlas.js (loadAtlas)

src/atlas.js                            ──LineSegments2──▶   scene
                                                                  │
src/atlasTuning.js (showFaults/faultColor/...)  ──listeners──▶  live update
```

## Default visual treatment

Decided values, settable from the GUI but reasonable starting points:
- **Color:** `#7a5a3c` — a desaturated warm brown that reads on both ocean (`#0a1428`) and land (`#3e5d8a`) without colliding with the plate-boundary palette (purple ridges, orange transforms, violet subduction).
- **Linewidth:** half the boundary width by default. Tied to `boundaryWidth` so fault lines scale together with plate boundaries when the global slider moves.
- **Opacity:** 0.4 vs. plate boundaries' 0.95. Faults appear as background context.
- **Render order:** below plate boundaries so intersections clearly belong to plate boundaries.

## Out of scope

- **Fault-type color classification.** `slip_type` is dropped from the render pipeline (still preserved in the trimmed GeoJSON in case a future iteration wants it). All faults use a single color.
- **Hover/click interaction.** No raycasting against fault lines, no detail popup.
- **Data-side filtering.** All ~13,500 GAF features are rendered; visual subordination (low opacity, thin lines) carries the density. No GUI to filter by region, slip rate, or fault type.
- **Dynamic re-fetch.** The raw GAF GeoJSON is committed at one point in time. Updating to a newer GAF release means re-downloading the source and re-running `bun run prep-data`.
- **USGS Quaternary Fault and Fold Database.** Decided against this for now (the brainstorming session picked GAF for global coverage). May revisit later if denser US coverage is needed.

## Testing

This is a static-data + render-layer change. Verification is manual:

1. **Prep step succeeds:** `bun run prep-data` produces `data/gem_active_faults_trimmed.geojson`. Feature count should be slightly less than the raw count (a few hundred PB2002 features dropped). Small deviations from the expected ~13k–13.5k are OK if upstream GAF was updated.
2. **Build clean:** `bun run build` succeeds with the new GeoJSON imported. Bundle size grows to ~12 MB; not a regression.
3. **Visual smoke test:**
   - Faults appear on the map in dense regions (Tibet, Anatolia, the Apennines, Japan).
   - The New Madrid fault zone in the central US is visible.
   - Plate boundary lines (purple/orange/violet) clearly render on top of fault lines at intersections.
   - The "Faults" GUI folder appears between "Geometry" and "Visibility" with four controls.
   - Toggling `showFaults` hides/shows the fault layer cleanly.
   - Adjusting `faultColor`, `faultWidth`, `faultOpacity` updates live.
   - Adjusting the global `boundaryWidth` slider scales fault thickness proportionally (because `faultWidth` is a multiplier).
4. **Localstorage compatibility:** Existing users with stored `eq-atlas-tuning` blobs that don't yet contain the four new keys still load cleanly (the existing load loop falls back to `defaults` for missing keys).

## Risks

- **License compliance — share-alike.** GAF is CC-BY-SA. Attribution alone isn't enough; derivative works must be released under the same license. The fault GeoJSON committed to this repo is a "share-alike" derivative. Practical implication: this codebase, or at minimum the `data/gem_active_faults_trimmed.geojson` file, should be redistributable under CC-BY-SA. If a future change wants to relicense or close-source, GAF would need to be removed.
- **Bundle size.** ~10 MB of trimmed GeoJSON gets baked into the JS bundle (Bun's `with { type: 'json' }` import inlines the data). Bundle goes from ~1.6 MB to ~12 MB. Acceptable for a globe visualizer that already loads tile imagery, but worth tracking — `dev.js` HMR may slow.
- **Render perf.** ~13,500 polylines, each with multiple coords, = potentially ~100k segments going through one `LineSegments2`. WebGL handles this fine, but it's the largest line-segment payload in the scene.
- **Visual crowding.** Tibet, Iran, the Aegean, Japan are extremely fault-dense. Mitigation: the subordinated render (low opacity, thin lines, muted color) handles this. If smoke test shows it still reads as a mess, the next iteration could introduce a slip-rate threshold (parsing the `net_slip_rate` tuple) or hide non-`Petersen et al. 2014` US-only data; out of scope here.
