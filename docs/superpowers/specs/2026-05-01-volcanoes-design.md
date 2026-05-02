# Holocene Volcanoes Layer

**Date:** 2026-05-01
**Status:** Spec ready for implementation

## Goal

Add ~1,500 Holocene-active volcanoes (Smithsonian Global Volcanism Program) as a clickable layer on the globe. Renders each as a small triangle icon at the volcano's lat/lng. Click opens the existing detail panel with volcano-specific fields (name, region, type, last eruption, elevation). Visually complements the slab + earthquake layers — the Pacific Ring of Fire becomes a continuous chain of volcanoes co-located with the subduction zones we already render.

This is the next deferred Stage C item from the post-faults roadmap, after the focal-mechanism beach balls work was tried and reverted.

## Source

**Dataset:** Smithsonian Global Volcanism Program (GVP) — "Volcanoes of the World" database. Holocene subset.

**Filter:** Only volcanoes with Holocene-era activity (last ~11,700 years). The Smithsonian dataset has a "Last Known Eruption" column with year + epoch tags; filter to entries where the epoch is "Holocene" or the year is non-empty (any historical eruption qualifies).

**Source URL:** Smithsonian distributes the data as Excel/CSV downloads from `https://volcano.si.edu`. The exact stable download URL needs to be probed at implementation time — Smithsonian periodically restructures their export pages. Backup option: community GitHub mirrors of the Holocene catalog (search "smithsonian volcanoes geojson"); use whichever has the most recent commit and a permissive license.

**License:** Smithsonian Institution. Free academic / educational / non-commercial use with attribution. Citation in `data/LICENSE`, `README.md`, and the in-app `#data-credits` footer.

## Prep

New `scripts/prep-volcanoes.js`:

1. **Cache check.** If `data/.cache/volcanoes_raw.csv` (or `.xlsx`, depending on Smithsonian's offered format) exists, skip download. Otherwise fetch from Smithsonian (or fallback mirror) and write to cache.
2. **Parse.** CSV via small inline parser (no new dep — the format is simple). If Smithsonian only offers Excel, use a small dev-only parser like `xlsx` (`bun add -d xlsx`).
3. **Filter** to Holocene-era entries. Drop Pleistocene-only and uncertain.
4. **Trim** to per-volcano fields: `id` (Smithsonian Volcano Number), `name`, `region`, `lat`, `lng`, `elevation_m`, `type` (Stratovolcano / Shield / Caldera / etc.), `last_eruption` (year as integer or "Holocene" string).
5. **Round** lat/lng to 2 decimals (consistent with PB2002 / GAF prep).
6. **Output** GeoJSON FeatureCollection at `data/volcanoes_holocene.geojson`. Each feature: `{ type: 'Feature', properties: {...trimmed fields}, geometry: { type: 'Point', coordinates: [lng, lat] } }`. Estimated size 80–150 KB for ~1,500 features.

`bun run prep-volcanoes` runs the script. Cache survives between runs.

## Architecture

```
scripts/prep-volcanoes.js                      (new, one-shot at refresh)
  fetches Smithsonian GVP Holocene catalog (cached)
  parses, filters, trims, writes GeoJSON

data/volcanoes_holocene.geojson                (committed, ~100 KB)
  FeatureCollection of Point features

src/volcanoes.js                               (new — sibling of markers.js)
  loadVolcanoes({ scene, radius })
    reads data/volcanoes_holocene.geojson (Bun JSON import)
    builds one Points BufferGeometry with positions for all volcanoes
    creates a shared CanvasTexture of a triangle icon (drawn once at module init)
    constructs Points + PointsMaterial (vertexColors:false, sizeAttenuation:false,
                                          map:texture, transparent:true)
    pts.userData.volcanoes = [...] // parallel array of feature property dicts
    pts.userData._kind = 'volcano-points'
    adds to crust
    onTuningChange callback → live update color/size/visibility
  exports: { points, volcanoes, getFeatureAt(index) }

src/tuning.js                                  (modified)
  defaults adds: showVolcanoes (true), volcanoColor ('#ff5533'), volcanoSize (12)
  buildGui adds a "Volcanoes" folder with 3 controls

src/main.js                                    (modified)
  imports loadVolcanoes; calls it after loadAtlas

src/controls.js                                (modified)
  raycast includes the volcanoes Points mesh
  on hit, intersection.index → look up feature → onSelect(...)

src/detail.js                                  (modified)
  branch on userData._kind === 'volcano' to render volcano-appropriate fields
  (name, region, type, last_eruption, elevation_m) instead of earthquake fields
```

## Render details

**Single Points mesh, 1,500 vertices, 1 draw call.** A `THREE.Points` with a `PointsMaterial` is the right primitive here — much cheaper than 1,500 individual Sprites, and Three.js's raycaster supports Points natively.

**Triangle icon texture.** Generated once at module init via canvas:

```js
function createTriangleTexture(sizePx = 64) {
    const c = document.createElement('canvas');
    c.width = c.height = sizePx;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(sizePx / 2, sizePx * 0.15);
    ctx.lineTo(sizePx * 0.15, sizePx * 0.85);
    ctx.lineTo(sizePx * 0.85, sizePx * 0.85);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';   // white in the texture; tinted by material.color at render time
    ctx.fill();
    const tex = new CanvasTexture(c);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    return tex;
}
```

The texture is white; `PointsMaterial.color` tints it at render time so a single texture serves any color choice without re-rasterization.

**Material:**

```js
new PointsMaterial({
    map: triangleTexture,
    color: tuning.volcanoColor,
    size: tuning.volcanoSize,
    sizeAttenuation: false,    // pixel-size, ignores distance — readable when zoomed out
    transparent: true,
    depthWrite: false,
    alphaTest: 0.5,            // discards the texture's transparent pixels cleanly
});
```

**Geometry:**

```js
const positions = new Float32Array(features.length * 3);
features.forEach((f, i) => {
    const v = geoToVec3(f.properties.lat, f.properties.lng, 0);
    positions[i*3]   = v.x;
    positions[i*3+1] = v.y;
    positions[i*3+2] = v.z;
});
const geo = new BufferGeometry();
geo.setAttribute('position', new BufferAttribute(positions, 3));
const pts = new Points(geo, mat);
pts.renderOrder = 1;
pts.userData = { _kind: 'volcano-points', volcanoes: features };
```

**Render order:** 1 (above plate boundaries / faults / slab surfaces, below the existing earthquake markers which sit on the planet surface but render later by default).

## Click → detail panel

`controls.js` change: include the volcanoes Points mesh in the raycast list. On hit, `intersection.index` gives the volcano position in our `features` array. Pass the matched feature's properties to the detail panel.

```js
// in controls.js (sketch — exact shape depends on existing pattern):
const intersects = raycaster.intersectObjects([...markers, volcanoesPoints], true);
for (const hit of intersects) {
    if (hit.object.userData?._kind === 'volcano-points') {
        const feature = hit.object.userData.volcanoes[hit.index];
        onSelect({ ...feature.properties, _kind: 'volcano' });
        return;
    }
    // existing 'blob' / 'focal' branches unchanged
}
```

`Raycaster.params.Points.threshold` needs setting to roughly match the on-screen icon size. At our planet-scale (radius ~6367 km) and a 12-pixel icon at typical viewing distance, ~25 km is a starting threshold. Tune at smoke-test.

`detail.js` change: when `userData._kind === 'volcano'`, render volcano-specific fields:
- **Name** → `feature.properties.name`
- **Region** → `feature.properties.region`
- **Type** → `feature.properties.type`
- **Last Eruption** → `feature.properties.last_eruption` (year or "Holocene")
- **Elevation** → `feature.properties.elevation_m + ' m'`

Existing detail-panel layout reused; only the field labels and values change. Same OSM map iframe centered on the volcano's lat/lng.

## GUI

`tuning.js` defaults gain three keys:

```js
showVolcanoes: true,
volcanoColor:  '#ff5533',
volcanoSize:   12,
```

New "Volcanoes" folder in the marker tuning panel:

```js
const fVolc = gui.addFolder('Volcanoes');
bind(fVolc.add(tuning, 'showVolcanoes'));
bind(fVolc.addColor(tuning, 'volcanoColor'));
bind(fVolc.add(tuning, 'volcanoSize', 4, 32, 1));
```

`onTuningChange` listener in `volcanoes.js` updates `pts.material.color`, `pts.material.size`, and `pts.visible` from these keys.

(Note: the lil-gui panel itself is provisional — debug/tuning scaffolding that will be replaced in a separate UI design pass. We add tunables here freely without worrying about end-user ergonomics.)

## Attribution

Three surfaces:
1. **`index.html` `#data-credits` footer.** Append "Volcanoes: [Smithsonian GVP](https://volcano.si.edu)".
2. **`README.md` Data Sources section.** New bullet with full citation: *Global Volcanism Program. (2024). [v. <version>]. Volcanoes of the World. Smithsonian Institution. https://volcano.si.edu — accessed at prep-time.*
3. **`data/LICENSE`.** New section for `volcanoes_holocene.geojson` documenting Smithsonian source + licensing terms (free academic/educational use with attribution).

## Out of scope

- **Currently-erupting status feed.** GVP's static export is the only data source; no live "what's erupting today" data.
- **VEI-based size scaling.** All icons same size for v1. Could add later as a magnitude-style proxy.
- **Eruption history timeline / animation.** Static positions only.
- **Per-type icon variants.** Stratovolcano, shield, caldera, etc. all render as the same triangle. Type info shows in the detail panel.
- **3D mini cone geometry.** We chose sprite-style icons (Points mesh).
- **Hover tooltips.** Click-to-detail only, same as earthquake markers.
- **Filtering by region or recent activity in the GUI.** Single global toggle.
- **Pre-built community mirror as primary source.** Smithsonian direct as primary; community mirror only if direct fails.

## Risks

- **Smithsonian export URL stability.** Their data publishing pages have restructured before. Cache mitigates re-runs; if first-run download fails, fall back to a community mirror (pin URL at implementation time).
- **CSV/Excel column-name shifts.** Smithsonian's column headers occasionally rename across versions ("Volcano Name" vs "Name", etc.). The parser should be tolerant — match column headers case-insensitively against a list of likely names.
- **Raycaster.Points.threshold tuning.** Default is 1 world unit (~1 km) — way too small for our icons. Need ~25 km at planet-scale + 12 px icon. Smoke-test will confirm.
- **Duplicate / aliased volcanoes in GVP.** Some volcano fields are subsidiary cones of larger systems. The Holocene filter usually strips these. Acceptable if a few extras slip through.
- **Triangle texture aliasing.** A 64×64 canvas-drawn triangle with `LinearFilter` looks fine at 8–24 px on-screen. If aliasing shows up at 4 px, bump the canvas to 128×128.
- **Click ambiguity at active arcs.** Volcanoes co-locate with earthquakes (Indonesia, Andes, Aleutians). If a volcano and earthquake blob overlap, the closest hit wins by default — usually the volcano if at the surface, the earthquake if it's deep. Acceptable v1 behavior.

## Testing

Manual verification:

1. **Prep.** `bun run prep-volcanoes` succeeds. First run downloads Smithsonian export to `data/.cache/`. Output: `data/volcanoes_holocene.geojson` ~80–150 KB, ~1,500 features. Sanity-check by counting features in known regions: Indonesia should have ~70+, Japan ~50+, Andes ~50+, Iceland ~20+.
2. **Build clean.** `bun run build` succeeds. JS bundle gains ~5 KB; data file inlines via `with { type: 'json' }` for ~100 KB total addition.
3. **Browser smoke test.**
   - Visible triangle icons clustered along Pacific Ring of Fire (Indonesia, Japan, Aleutians, Cascades, Andes).
   - Notable European volcanoes visible (Etna, Vesuvius, Iceland chain).
   - East African Rift volcanoes visible.
   - Click any volcano → detail panel opens with Name / Region / Type / Last Eruption / Elevation populated.
   - Toggle `showVolcanoes` off → icons disappear.
   - Color picker updates icon color live.
   - Size slider 4..32 works smoothly.
   - No console errors. No 1500-fold draw call counts (one Points mesh = one draw call).
4. **Co-occurrence check.** Andes / Cascadia / Tonga: visually verify volcanoes sit on the upper-plate side of the trench, just inland from the slab outcrop.

## Acceptance

- ~1,500 Holocene volcanoes render as a single Points mesh.
- Triangles are visible at globe scale and tunable for color + size.
- Click opens the detail panel with volcano-specific fields.
- Smithsonian GVP cited in `#data-credits` footer, README, and `data/LICENSE`.
- No new runtime dependencies (CanvasTexture + PointsMaterial are stock Three.js).
- Browser console clean.
