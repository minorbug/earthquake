# Intraplate Faults Layer

**Date:** 2026-04-29
**Status:** Spec ready for implementation

## Goal

Add a global intraplate fault line layer to the visualizer so seismically active intraplate zones (New Madrid, the Apennines, Tibet, etc.) are visible alongside plate boundaries. Faults are visually subordinated — secondary structural context that doesn't compete with plate boundaries for attention.

## Source

**Dataset:** GEM Global Active Faults (GAF) — `GEMScienceTools/gem-global-active-faults` on GitHub. A community-maintained global compilation of active faults released as GeoJSON LineString features with attributes including `name`, `slip_type`, `last_movement`, and `slip_rate`.

**License:** CC-BY family (verify exact version against the GAF release used and comply with the attribution requirement).

**Filter criterion:** Keep only features with Holocene-era movement. Implementation should match the GAF schema's actual field name and value vocabulary (e.g., `last_movement` field, value containing "Holocene" — verify against the file when downloading). Drop everything else. The filter is baked into a pre-processed GeoJSON; not a runtime toggle.

## Architecture

The new layer follows the same pattern as the existing PB2002 plate-boundary lines in `src/atlas.js`:

1. **Prep step** — `scripts/prep-atlas-data.js` reads the raw GAF GeoJSON (committed alongside other raw inputs in `data/`), filters to Holocene-active features, and emits `data/gem_gaf_holocene.geojson` with a trimmed property bag. Re-runnable via `bun run prep-data`.
2. **Render step** — `src/atlas.js` imports the filtered GeoJSON, adds a fourth boundary group called `'fault'`, and reuses the existing `buildLineGeometry` + `LineSegments2 + LineMaterial` plumbing. Distinct visual parameters give the layer visual subordination.
3. **Tuning step** — `src/atlasTuning.js` adds four new keys and a `'Faults'` GUI folder so the layer can be toggled and styled independently of plate boundaries.

## Components

### Prep script (`scripts/prep-atlas-data.js`)

New section after the existing PB2002 processing. Reads the raw GAF GeoJSON, applies the Holocene filter, writes the trimmed output. Pseudocode:

```
gafFeatures = readJson('data/<raw-gaf-source>.geojson').features
holocene   = gafFeatures.filter(f => isHolocene(f.properties.last_movement))
trimmed    = holocene.map(f => ({
                geometry: f.geometry,
                properties: { name: f.properties.name, slip_type: f.properties.slip_type },
             }))
writeJson('data/gem_gaf_holocene.geojson', { type: 'FeatureCollection', features: trimmed })
```

`isHolocene` matches GAF's actual vocabulary — define it after inspecting the source. Be tolerant of capitalization and combined values like "Active Holocene" or "Late Pleistocene–Holocene".

### Atlas integration (`src/atlas.js`)

Add `'fault'` to the boundary group list. The existing `BOUNDARY_GROUPS` array already drives the per-class rendering, but the fault group has different defaults than the plate-boundary classes, so it's cleanest to handle it as a sibling group rather than a fifth `BOUNDARY_GROUPS` entry. Concrete approach:

- Import the new GeoJSON: `import faultsJson from '../data/gem_gaf_holocene.geojson' with { type: 'json' };`
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
raw GAF GeoJSON           ──prep-atlas-data.js──▶  data/gem_gaf_holocene.geojson
(committed in data/)                                (committed in data/)

data/gem_gaf_holocene.geojson  ──Bun JSON import──▶  src/atlas.js (loadAtlas)

src/atlas.js                   ──LineSegments2──▶   scene
                                                         │
src/atlasTuning.js (showFaults/faultColor/...)  ──listeners──▶ live update
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
- **Runtime filtering.** The Holocene filter is pre-baked into `data/gem_gaf_holocene.geojson`. No GUI control to switch between Holocene-only and all-faults at runtime.
- **Dynamic re-fetch.** The raw GAF GeoJSON is committed at one point in time. Updating to a newer GAF release means re-downloading the source and re-running `bun run prep-data`.
- **USGS Quaternary Fault and Fold Database.** Decided against this for now (the brainstorming session picked GAF for global coverage). May revisit later if denser US coverage is needed.

## Testing

This is a static-data + render-layer change. Verification is manual:

1. **Build clean:** `bun run build` succeeds with the new GeoJSON imported.
2. **Visual smoke test:**
   - Faults appear on the map in dense regions (Tibet, Anatolia, the Apennines, Japan).
   - The New Madrid fault zone in the central US is visible.
   - Plate boundary lines (purple/orange/violet) clearly render on top of fault lines at intersections.
   - The "Faults" GUI folder appears between "Geometry" and "Visibility" with four controls.
   - Toggling `showFaults` hides/shows the fault layer cleanly.
   - Adjusting `faultColor`, `faultWidth`, `faultOpacity` updates live.
   - Adjusting the global `boundaryWidth` slider scales fault thickness proportionally (because `faultWidth` is a multiplier).
3. **Localstorage compatibility:** Existing users with stored `eq-atlas-tuning` blobs that don't yet contain the four new keys still load cleanly (the existing load loop falls back to `defaults` for missing keys).

## Risks

- **GAF schema may change between releases.** The filter logic depends on `last_movement` field semantics. Mitigation: validate the filter output count after running the prep script (e.g., expect ~3,000–6,000 features after Holocene filter, vs. ~13,500 in the full set). If the count is wildly off, the filter logic needs adjustment.
- **License compliance.** The CC-BY family requires attribution and may have share-alike requirements depending on version. Mitigation: confirm the exact license version of the chosen GAF release before merging, and ensure the in-app + README attribution language matches the license's required wording.
- **Visual crowding even with Holocene filter.** Tibet, Iran, the Aegean are extremely fault-dense even after filtering. Mitigation: the subordinated render (low opacity, thin lines) handles this — but if it still reads as a mess, the next iteration could introduce a slip-rate threshold or a region-based filter. Out of scope here; revisit if smoke test reveals it.
