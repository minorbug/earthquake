# Intraplate Faults Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global fault-line layer to the visualizer, sourced from GEM Global Active Faults. Renders as a visually subordinated fourth line group alongside plate boundaries, with its own GUI controls.

**Architecture:** The new layer plugs into the existing `src/atlas.js` line-rendering pipeline (`LineSegments2 + LineMaterial`, registered in `boundaryGroups`) as a sibling of the plate-boundary classes. Source data fetched at build-time-ish via `scripts/prep-atlas-data.js` (which already fetches PB2002 over the network), filtered to drop PB2002-derived features (avoid double-rendering), trimmed to a smaller property bag, written to `data/gem_active_faults_trimmed.geojson`. Output is committed; raw GAF is not. Tuning state lives in `atlasTuning.js` (four new keys, one GUI folder).

**Tech Stack:** Bun, Three.js, lil-gui, vanilla ES modules.

**Spec:** `docs/superpowers/specs/2026-04-29-intraplate-faults-design.md`

**Branch:** Create `feat/faults` off `master` before starting.

---

## File Structure

**Modified:**
- `scripts/prep-atlas-data.js` — fetches GAF, drops PB2002-catalog features, trims props, rounds coords, writes output (Task 1).
- `src/atlasTuning.js` — adds `showFaults`, `faultColor`, `faultWidth`, `faultOpacity` keys + "Faults" GUI folder (Task 2).
- `src/atlas.js` — imports the trimmed GeoJSON, builds a fourth LineSegments2 mesh, registers it in `boundaryGroups`, wires color/width/opacity from tuning (Task 3).
- `index.html` — adds GEM attribution near the existing OSM credit (Task 4).
- `README.md` — adds a "Data sources" section listing PB2002 and GEM GAF with citations and licenses (Task 4).

**Created:**
- `data/gem_active_faults_trimmed.geojson` — output of the prep step. Committed. ~6–10 MB.

**Not committed (fetched at prep-time):**
- The raw GAF GeoJSON from `GEMScienceTools/gem-global-active-faults`. Same pattern as PB2002 raw — `prep-atlas-data.js` fetches over HTTPS and writes the trimmed output.

---

## Task 1: Prep step — fetch + filter + trim GAF

**Files:**
- Modify: `scripts/prep-atlas-data.js`
- Create: `data/gem_active_faults_trimmed.geojson` (output of running the script)

- [ ] **Step 1: Add GAF to the SOURCES constant**

In `scripts/prep-atlas-data.js`, locate the `SOURCES` object near the top:

```js
const SOURCES = {
    land:      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson',
    countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    boundaries:'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json',
};
```

Replace it with:

```js
const SOURCES = {
    land:      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson',
    countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
    boundaries:'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json',
    faults:    'https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults.geojson',
};
```

- [ ] **Step 2: Add GAF to the parallel fetch + log line**

Replace this block:

```js
console.log('Fetching 3 source files...');
const [land, countries, boundaries] = await Promise.all([
    fetchJson(SOURCES.land),
    fetchJson(SOURCES.countries),
    fetchJson(SOURCES.boundaries),
]);
console.log('  land:', land.features.length, 'features');
console.log('  countries:', countries.features.length, 'features');
console.log('  boundaries:', boundaries.features.length, 'features');
```

with:

```js
console.log('Fetching 4 source files...');
const [land, countries, boundaries, faults] = await Promise.all([
    fetchJson(SOURCES.land),
    fetchJson(SOURCES.countries),
    fetchJson(SOURCES.boundaries),
    fetchJson(SOURCES.faults),
]);
console.log('  land:', land.features.length, 'features');
console.log('  countries:', countries.features.length, 'features');
console.log('  boundaries:', boundaries.features.length, 'features');
console.log('  faults:', faults.features.length, 'features');
```

- [ ] **Step 3: Add the GAF processing block**

After the `pb2002_steps_with_plates.geojson` writeFileSync (around line 152 — find the `writeFileSync(resolve('data/pb2002_steps_with_plates.geojson'), ...)` call), and before the final summary `console.log` block, insert:

```js

// GEM Global Active Faults: drop PB2002-derived features (already rendered
// directly from PB2002), trim properties, round coordinates to match the
// precision of the rest of our line data.
let gafDroppedPB2002 = 0;
const faultsTrimmed = {
    type: 'FeatureCollection',
    features: faults.features
        .filter((f) => {
            const cn = (f.properties.catalog_name || '').toLowerCase();
            if (cn.includes('pb2002')) { gafDroppedPB2002++; return false; }
            return true;
        })
        .map((f) => ({
            type: 'Feature',
            properties: {
                name:         f.properties.name         || '',
                slip_type:    f.properties.slip_type    || '',
                catalog_name: f.properties.catalog_name || '',
            },
            geometry: roundGeometry(f.geometry),
        })),
};
console.log(`  GAF: dropped ${gafDroppedPB2002} PB2002-derived feature(s)`);
writeFileSync(resolve('data/gem_active_faults_trimmed.geojson'), JSON.stringify(faultsTrimmed));
```

- [ ] **Step 4: Update the final summary log**

Replace this block:

```js
console.log('Wrote 4 files to data/.');
console.log('  ne_110m_land.geojson:', landFiltered.features.length, 'features');
console.log('  ne_110m_antarctica.geojson: 1 feature');
console.log('  pb2002_boundaries.geojson:', boundariesRounded.features.length, 'features');
console.log('  pb2002_steps_with_plates.geojson:', stepsWithPlates.features.length, 'features');
```

with:

```js
console.log('Wrote 5 files to data/.');
console.log('  ne_110m_land.geojson:', landFiltered.features.length, 'features');
console.log('  ne_110m_antarctica.geojson: 1 feature');
console.log('  pb2002_boundaries.geojson:', boundariesRounded.features.length, 'features');
console.log('  pb2002_steps_with_plates.geojson:', stepsWithPlates.features.length, 'features');
console.log('  gem_active_faults_trimmed.geojson:', faultsTrimmed.features.length, 'features');
```

- [ ] **Step 5: Run the prep step**

```bash
bun run prep-data
```

Expected output: a `Fetching 4 source files...` line, per-source feature counts (faults should be ≈ 13,500), a `GAF: dropped <N> PB2002-derived feature(s)` line (N likely 100–500 based on PB2002 step count), and `Wrote 5 files to data/.`.

If the GAF fetch fails or feature count is wildly off (< 5,000 or > 30,000), STOP and report — upstream may have moved or the URL is wrong.

- [ ] **Step 6: Sanity-check the output**

```bash
ls -lh data/gem_active_faults_trimmed.geojson
bun run -e 'console.log(JSON.parse(require("fs").readFileSync("data/gem_active_faults_trimmed.geojson")).features.length + " features")'
```

Expected: file size ~6–10 MB, feature count close to the count from Step 5 minus the dropped PB2002 features. The `bun run -e` line should print the feature count without errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/prep-atlas-data.js data/gem_active_faults_trimmed.geojson
git commit -m "$(cat <<'EOF'
faults: prep step fetches GEM Global Active Faults

Extends prep-atlas-data.js to fetch the GAF GeoJSON, drop features
whose catalog_name contains "pb2002" (avoid duplicate plate-boundary
lines — PB2002 is a constituent of GAF and we already render it
directly from data/pb2002_steps_with_plates.geojson), trim the
property bag down to {name, slip_type, catalog_name}, and round
coordinates to 2-decimal precision. Output: data/gem_active_faults_trimmed.geojson.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tuning state + GUI folder

**Files:**
- Modify: `src/atlasTuning.js`

- [ ] **Step 1: Add four new keys to `defaults`**

In `src/atlasTuning.js`, locate the `defaults` object. After the `// Visibility` block (which currently ends with `showBoundaries: true,`), add:

```js
    // Faults (GEM Global Active Faults)
    showFaults:    true,
    faultColor:    '#7a5a3c',
    faultWidth:    0.5,    // multiplier on boundaryWidth
    faultOpacity:  0.4,
```

The full Visibility + Faults section of `defaults` should now read:

```js
    // Visibility
    showLand:        true,
    showBoundaries:  true,
    // Faults (GEM Global Active Faults)
    showFaults:    true,
    faultColor:    '#7a5a3c',
    faultWidth:    0.5,    // multiplier on boundaryWidth
    faultOpacity:  0.4,
```

- [ ] **Step 2: Add the "Faults" GUI folder**

In `buildAtlasGui`, after the `fGeom` folder block (which currently ends with `bindColor(fGeom.add(atlasTuning, 'boundaryWidth', 0, 12, 0.1));`) and before the `fVis` folder block, insert:

```js
    const fFaults = gui.addFolder('Faults');
    bindVis  (fFaults.add(atlasTuning, 'showFaults'));
    bindColor(fFaults.addColor(atlasTuning, 'faultColor'));
    bindColor(fFaults.add(atlasTuning, 'faultWidth',   0, 2, 0.05));
    bindColor(fFaults.add(atlasTuning, 'faultOpacity', 0, 1, 0.01));
```

- [ ] **Step 3: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. The GUI now has a "Faults" folder but it doesn't drive any rendering yet — that's Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/atlasTuning.js
git commit -m "$(cat <<'EOF'
faults: atlasTuning keys + Faults GUI folder

Adds showFaults, faultColor, faultWidth, faultOpacity defaults and a
new "Faults" folder in the Atlas GUI panel between Geometry and
Visibility. faultWidth is a multiplier applied on top of boundaryWidth
so faults scale proportionally with the global boundary slider.

Rendering wired in next task; this commit alone changes only the
control surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Atlas rendering

**Files:**
- Modify: `src/atlas.js`

- [ ] **Step 1: Import the trimmed fault GeoJSON**

In `src/atlas.js`, locate the existing data imports near the top:

```js
import landJson from '../data/ne_110m_land.geojson' with { type: 'json' };
import antarcticaJson from '../data/ne_110m_antarctica.geojson' with { type: 'json' };
import boundariesJson from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };
```

After the `boundariesJson` import, add:

```js
import faultsJson from '../data/gem_active_faults_trimmed.geojson' with { type: 'json' };
```

- [ ] **Step 2: Build the fault line group inside `loadAtlas`**

Inside `loadAtlas`, after the `boundaryGroups.push({ key: 'other', ... })` line (the line that wraps the "other" boundary lines into the group), and before the `// Keep LineMaterial resolution in sync with viewport size.` comment block, insert:

```js
    // Faults (GEM Global Active Faults). Visually subordinated relative to
    // plate boundaries — single muted color, thinner, lower opacity, lower
    // renderOrder so plate boundaries paint over them at intersections.
    const faultGeo = buildLineGeometry(faultsJson.features, boundaryRadius);
    const faultMat = new LineMaterial({
        color: new Color(atlasTuning.faultColor),
        linewidth: Math.max(0.05, atlasTuning.faultWidth * atlasTuning.boundaryWidth),
        worldUnits: false,
        dashed: false,
        transparent: true,
        opacity: atlasTuning.faultOpacity,
    });
    faultMat.resolution.set(window.innerWidth, window.innerHeight);
    const faultMesh = new LineSegments2(faultGeo, faultMat);
    faultMesh.renderOrder = 1;
    faultMesh.visible = atlasTuning.showFaults;
    scene.add(faultMesh);
    boundaryGroups.push({ key: 'fault', material: faultMat, mesh: faultMesh, isFault: true });
```

- [ ] **Step 3: Wire fault tuning into `applyColors`**

Locate the `applyColors` function inside `loadAtlas`. The current loop iterates over `boundaryGroups` and updates each material's color/opacity/linewidth based on the group's `colorKey`/`isOther`/etc. The fault group is special — it has its own color/width/opacity keys, not derived from `boundaryWidth`/`otherAlpha`/etc. Add a fault-specific branch.

The current loop body looks like:

```js
        for (const g of boundaryGroups) {
            if (!g.material || !g.material.color) continue;   // guard: ShaderMaterial has no .color
            g.material.color.set(t[g.colorKey]);
            if (g.isOther) {
                g.material.opacity = Math.min(1, t.otherAlpha);
            }
            if ('linewidth' in g.material) {
                g.material.linewidth = Math.max(0.1, t.boundaryWidth);
            }
        }
```

Replace it with:

```js
        for (const g of boundaryGroups) {
            if (!g.material || !g.material.color) continue;   // guard: ShaderMaterial has no .color
            if (g.isFault) {
                g.material.color.set(t.faultColor);
                g.material.opacity   = Math.min(1, t.faultOpacity);
                g.material.linewidth = Math.max(0.05, t.faultWidth * t.boundaryWidth);
                continue;
            }
            g.material.color.set(t[g.colorKey]);
            if (g.isOther) {
                g.material.opacity = Math.min(1, t.otherAlpha);
            }
            if ('linewidth' in g.material) {
                g.material.linewidth = Math.max(0.1, t.boundaryWidth);
            }
        }
```

- [ ] **Step 4: Wire fault visibility into `onAtlasVisibilityChange`**

Locate the `onAtlasVisibilityChange((t) => { ... })` block inside `loadAtlas`. The current body is:

```js
    onAtlasVisibilityChange((t) => {
        applyColors(t); // showLand affects land/antarctica uniform colors
        for (const g of boundaryGroups) g.mesh.visible = t.showBoundaries;
    });
```

Replace it with:

```js
    onAtlasVisibilityChange((t) => {
        applyColors(t); // showLand affects land/antarctica uniform colors
        for (const g of boundaryGroups) {
            g.mesh.visible = g.isFault ? t.showFaults : t.showBoundaries;
        }
    });
```

- [ ] **Step 5: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. Bundle size will jump significantly (~12 MB total because the GeoJSON is inlined). 22 modules bundled (up from 21). No warnings.

- [ ] **Step 6: Commit**

```bash
git add src/atlas.js
git commit -m "$(cat <<'EOF'
faults: render GEM Active Faults as a subordinated line group

Adds the fault layer to atlas.js as a fourth LineSegments2 mesh,
registered in boundaryGroups with isFault: true. Distinct render
parameters from plate boundaries:
- color: atlasTuning.faultColor (#7a5a3c default)
- linewidth: faultWidth * boundaryWidth (0.5x by default)
- opacity: faultOpacity (0.4 default)
- renderOrder: 1 (below plate boundaries' 2)

applyColors and onAtlasVisibilityChange both branch on isFault to
read the fault-specific tuning keys instead of the plate-boundary
ones.

Bundle grows to ~12 MB because the trimmed GeoJSON is inlined.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Attribution

**Files:**
- Modify: `index.html`
- Modify: `README.md`

- [ ] **Step 1: Read current `index.html`**

Read the file to confirm the structure of the existing OSM attribution credit.

```bash
cat index.html
```

The relevant area is the detail panel around line 26: `<div id="detail-attrib">© OpenStreetMap contributors</div>`. The fault attribution should sit nearby and follow the same styling.

- [ ] **Step 2: Add a global attribution footer to `index.html`**

The detail panel attrib only shows when a marker is selected. Faults need an always-visible credit since they're rendered always. Locate the `<div id="eqScene"></div>` line and add a small credit element below it. The current structure:

```html
    <div id="eqScene"></div>
    <script type="module" src="./src/main.js"></script>
```

Replace with:

```html
    <div id="eqScene"></div>
    <div id="data-credits">
        Plate boundaries: PB2002 (Bird, 2003).
        Faults: <a href="https://github.com/GEMScienceTools/gem-global-active-faults" target="_blank" rel="noopener">GEM Global Active Faults</a> (Styron &amp; Pagani, 2020) — CC-BY-SA.
    </div>
    <script type="module" src="./src/main.js"></script>
```

- [ ] **Step 3: Style the credits element**

The project's CSS lives at `css/earthquake.css` (alongside `main.css` and `normalize.css`). Append the following rule to `css/earthquake.css`:

```css
#data-credits {
    position: fixed;
    bottom: 4px;
    left: 4px;
    font: 10px/1.3 ui-sans-serif, system-ui, sans-serif;
    color: rgba(255, 255, 255, 0.55);
    pointer-events: auto;
    z-index: 5;
    max-width: 60vw;
}
#data-credits a {
    color: rgba(180, 220, 255, 0.75);
    text-decoration: none;
}
#data-credits a:hover {
    text-decoration: underline;
}
```

- [ ] **Step 4: Update `README.md` with a Data Sources section**

Read the current README:

```bash
cat README.md
```

The existing README is older and may not have a clear "Data Sources" section. Append (or insert near the top, after any project-summary paragraph) a section like:

```markdown
## Data Sources

- **Plate boundaries:** PB2002 (Bird, P. 2003. "An updated digital model of plate boundaries." *Geochemistry, Geophysics, Geosystems* 4(3): 1027. doi:10.1029/2001GC000252). Sourced from [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates).
- **Active faults:** GEM Global Active Faults Database (Styron, R. & Pagani, M. 2020. "The GEM Global Active Faults Database." *Earthquake Spectra* 36(1_suppl): 160–180. doi:10.1177/8755293020944182). Sourced from [GEMScienceTools/gem-global-active-faults](https://github.com/GEMScienceTools/gem-global-active-faults). License: **CC-BY-SA 4.0** — derivatives (including this repository's `data/gem_active_faults_trimmed.geojson`) must be redistributed under the same license.
- **Land + countries:** Natural Earth public-domain vector data via [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector).
- **Earthquake feed:** USGS Earthquake Hazards Program real-time GeoJSON feed.
```

If the README already has any of those bullets in some other form, integrate without duplicating.

- [ ] **Step 5: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds. The new `<div id="data-credits">` is part of the static HTML; the CSS rule applies via the existing CSS bundle pipeline.

- [ ] **Step 6: Commit**

```bash
git add index.html css/earthquake.css README.md
git commit -m "$(cat <<'EOF'
faults: attribution for GEM GAF + PB2002

Adds a small always-visible credit footer (#data-credits) at the
bottom-left of the viewport with PB2002 and GEM GAF citations and a
link to the GAF repo. Updates README.md with a Data Sources section
listing all data dependencies and their licenses, including the
CC-BY-SA share-alike requirement for GAF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verification

**Files:** None modified — this task confirms the cumulative result.

- [ ] **Step 1: Production build**

```bash
bun run build
ls -lh dist/
```

Expected: `dist/` contains `index.html`, `index-*.js` (~12 MB), `index-*.css`, and `img/`. Build completes without warnings.

- [ ] **Step 2: Bundle sanity check**

```bash
grep -o "GEMScienceTools\|GEM Global Active\|gem_active_faults" dist/index.html | head -5
grep -c "PB2002" dist/index.html
```

Expected: the bundle's HTML references GEM Global Active Faults (from the credit footer) and PB2002. Don't worry about the JS bundle's grep — the GeoJSON content is inlined as data, not as readable text we can easily scan.

- [ ] **Step 3: Run dev server + browser smoke test**

```bash
bun run dev
```

Open `http://localhost:3000/` in a browser. Test these specific scenarios — the human implementer must do this manually, not the agent:

- **Faults render globally:** see fine brown lines in dense regions (Tibet, Anatolia/Turkey, Italy, the Aegean, Japan, the western US).
- **New Madrid is visible:** zoom/orbit toward central US (Arkansas/Tennessee/Missouri area). Should see fault traces in the Mississippi embayment region. This was the original motivating case.
- **Plate boundaries paint on top:** at intersections (e.g., the San Andreas fault zone), purple/orange/violet plate-boundary lines should be the dominant visual; fault lines visible underneath but not competing.
- **No double-render:** plate boundaries should not have a faded brown twin running alongside them. (If they do, the PB2002 catalog filter didn't catch the right `catalog_name` value — Step 5 of Task 1 would have logged the count of dropped features. Zero dropped indicates a filter miss.)
- **GUI panel:** Atlas panel (top-left) has folders Colors, Geometry, **Faults**, Visibility. Faults folder has 4 controls.
- **Show/hide:** toggling `showFaults` cleanly hides and reveals the fault layer.
- **Tuning:** dragging `faultColor`, `faultWidth`, `faultOpacity` updates live.
- **Boundary-width interaction:** dragging the `boundaryWidth` slider scales fault thickness proportionally (because `faultWidth` is a multiplier).
- **Reset:** clicking "Reset atlas" returns all four fault keys to their defaults (`#7a5a3c`, 0.5, 0.4, true).
- **Console clean:** no errors or warnings in browser devtools console.
- **Credit footer visible:** small text reads at bottom-left with PB2002 and GEM credits, the GEM link is clickable.

Stop the dev server.

- [ ] **Step 4: localStorage compatibility check**

In the browser console (with the dev server running), test:

```js
localStorage.clear();
location.reload();
```

After reload: Faults panel still shows defaults, faults render at default colors. Then reload again with stored state from a previous session (just refresh) — defaults are merged with any pre-existing keys correctly.

- [ ] **Step 5: Branch summary commit (only if any fixes applied)**

If verification surfaced no issues, skip. If it did (e.g., CSS positioning collision, color too dark on land, fault filter missed PB2002 features), fix inline and commit:

```bash
git add -A
git commit -m "faults: fix-up after final smoke test"
```

---

## Self-review notes

- **Spec coverage:** Every spec section maps to a task — Source/filter → Task 1, Components/atlas-rendering → Tasks 2 & 3, GUI → Task 2, Attribution → Task 4, Testing → Task 5.
- **Placeholder scan:** No TBDs. All Edit blocks show literal old/new content. All shell commands are exact. The `lh` flag for `ls -lh` is intentional. Filenames, URLs, citation strings are concrete.
- **Type/symbol consistency:** `faultColor`, `faultWidth`, `faultOpacity`, `showFaults` named consistently across atlasTuning.js (Task 2) and atlas.js (Task 3). The `isFault: true` marker on the boundaryGroups entry (Task 3 Step 2) is consumed in the same task's Steps 3 and 4.
- **Task ordering safety:** Task 1 produces the data file before Task 3 imports it. Task 2 adds the tuning keys before Task 3 reads them. Task 4 adds attribution after rendering works (so the visual smoke test can verify both at once in Task 5). No task leaves the build broken.
- **Bundle-size note:** The `with { type: 'json' }` import inlines the 6–10 MB GeoJSON. The risk section of the spec calls this out; it's expected, not a regression.
