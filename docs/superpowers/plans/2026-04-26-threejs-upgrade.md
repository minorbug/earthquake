# three.js Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from three.js r64 + globally-loaded vendored scripts to latest three.js as ES modules under Bun, while dropping every legacy dep (jQuery, jrumble, Howler, Modernizr, Detector.js, custom geospatial plugin, dat.GUI vendored).

**Architecture:** Bun is the package manager + dev server + bundler. Sources live in `src/`, each file with a single responsibility (`scene`, `feed`, `markers`, `tuning`, `controls`, `detail`, `main`). All cross-file communication is via `import` / `export`. `index.html` has one `<script type="module" src="./src/main.js">`. CSS handles fades + the rumble shake (replacing jQuery animations and jrumble). Output is identical to the post-blob-markers master.

**Tech Stack:** Bun, three (latest), lil-gui, vanilla ES modules, vanilla DOM. No test framework — verification is manual + visual at the dev server.

**Reference spec:** `docs/superpowers/specs/2026-04-26-threejs-upgrade-design.md`

**Testing note:** Same convention as the previous plan: each task ends with a visual verification step served via `bun ./index.html`. Treat verification as the gate before committing.

---

## File Structure

| File | Status | Purpose |
|------|--------|---------|
| `package.json` | create | Bun deps + scripts. |
| `bun.lockb` | create (binary, commit) | Deterministic install. |
| `tsconfig.json` | create (Bun default) | Editor JSDoc inference. Optional. |
| `.gitignore` | modify | Add `node_modules/`, `dist/`. |
| `index.html` | rewrite | Single ES-module entry; loading overlay; detail panel. |
| `css/earthquake.css` | modify | Add `@keyframes rumble`, `.rumble`, opacity-fade rules for `#detail` + `#loadingoverlay`. |
| `src/main.js` | create | Entry: WebGL probe, boot, render loop, wires modules. |
| `src/scene.js` | create | Scene + Camera + Renderer + lights + crust globe. |
| `src/feed.js` | create | USGS fetch + `geoToVec3(lat, lng, depth)` helper. |
| `src/markers.js` | create | Blob + ring shaders, `createBlobMarker`, `updateUniforms(time)`. Modern APIs, no r64 shims. |
| `src/tuning.js` | create | lil-gui panel + `tuning` state + localStorage + JSON export + reset. |
| `src/controls.js` | create | Mouse/touch rotation, arrow-key orbit, raycast click → onSelect. |
| `src/detail.js` | create | Show/hide detail panel + OSM iframe URL. |
| `js/*` (everything) | delete | Replaced by `src/*` and npm packages. |

`img/` (world.jpg, cloud.png, etc.) is kept. `404.html`, `humans.txt`, `crossdomain.xml`, `apple-touch-icon-precomposed.png`, `favicon.ico`, `robots.txt` are kept untouched.

---

## Task 1: Bun project init + dependencies

**Files:**
- Create: `package.json`, `bun.lockb`, `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Verify Bun is installed**

```bash
which bun && bun --version
```

Expected: a path and a version ≥ 1.1. If missing, install via `brew install oven-sh/bun/bun` (macOS) or see https://bun.sh.

- [ ] **Step 2: Initialize Bun project**

Run from project root (`/Users/mattbaker/Development/earthquake`):

```bash
bun init -y
```

Expected: prints created files. Look for `package.json`, `tsconfig.json`, `bun.lockb`, plus a default `index.ts` and `README.md` we will discard in the next step.

- [ ] **Step 3: Discard the auto-created entry files we don't need**

```bash
rm -f index.ts
```

(Do NOT delete `package.json` or `tsconfig.json`. The auto-generated `README.md` may or may not exist depending on Bun version; if it conflicts with the existing project README, leave the existing one — only delete the new entry stub.)

Verify the project's existing `README.md` is still intact:

```bash
head -3 README.md
```

Expected: existing project content (not a Bun template).

- [ ] **Step 4: Replace `package.json` `main` + add scripts**

Open `package.json`. It should look something like:

```json
{
  "name": "earthquake",
  "module": "index.ts",
  ...
}
```

Replace with this exact content (preserve any `"name"` Bun chose for you):

```json
{
  "name": "earthquake",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun ./index.html",
    "build": "bun build ./index.html --outdir=dist --minify"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 5: Install three and lil-gui**

```bash
bun add three lil-gui
bun add -d @types/three
```

Expected: `package.json` "dependencies" includes `three` and `lil-gui`; "devDependencies" includes `@types/three`. `node_modules/` directory appears, `bun.lockb` updated.

- [ ] **Step 6: Update .gitignore**

Append to `.gitignore`:

```
node_modules/
dist/
```

(Do NOT ignore `bun.lockb` — we commit it.)

- [ ] **Step 7: Confirm install integrity**

```bash
ls node_modules/three/build/three.module.js && ls node_modules/lil-gui/dist/lil-gui.esm.js
```

Both files should exist.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lockb tsconfig.json .gitignore
git commit -m "Bun project init + install three + lil-gui"
```

(`node_modules/` and `dist/` should NOT appear in the diff — gitignore should be working.)

---

## Task 2: Empty Bun-served shell

Switch `index.html` to a single ES-module entry, drop all the old `<script src>` tags, and add the CSS scaffolding (rumble keyframes, opacity fades). The page should boot under `bun ./index.html` and show the loading overlay text — no scene yet.

**Files:**
- Modify: `index.html`
- Modify: `css/earthquake.css`
- Create: `src/main.js`

- [ ] **Step 1: Rewrite `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Earthquake</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Raleway+Dots|Raleway:400,800">
    <link rel="stylesheet" href="./css/earthquake.css">
</head>
<body>
    <div id="loadingoverlay" class="show">
        <h1>Earthquake</h1>
        <h2>Inspired by the "Earthquake" exhibit at the California Academy of Sciences</h2>
        <h3 class="rumble">Getting latest earthquake data from USGS.gov...</h3>
    </div>
    <div id="header">
        <h1>Earthquake</h1>
        <h2>Inspired by the "Earthquake" exhibit at the California Academy of Sciences</h2>
        <h3>Created by <a href="http://twitter.com/nerdmattbaker" target="_blank">@NerdMattBaker</a> • <a href="https://github.com/minorbug/earthquake" target="_blank">View on GitHub</a></h3>
    </div>
    <div id="detail">
        <iframe id="detail-map" frameborder="0" scrolling="no"></iframe>
        <div id="detail-location"></div>
        <div id="detail-magnitude"></div>
        <div id="detail-depth"></div>
        <div id="detail-attrib">© OpenStreetMap contributors</div>
    </div>
    <div id="eqScene"></div>
    <script type="module" src="./src/main.js"></script>
</body>
</html>
```

Notes: All old `<script src>` tags (jquery, jrumble, three.js, three.geospatial.js, etc.) are gone. The detail panel's old `<div class="marker">` is gone — it's not used since we adopted the OSM iframe. The loading h3 already has the `rumble` class so it will shake as soon as CSS is loaded.

- [ ] **Step 2: Append fade + rumble CSS to `css/earthquake.css`**

Append at the end of the file:

```css
/* ===== Animation/visibility classes (replaces jQuery fade + jrumble) ===== */

@keyframes rumble {
    0%, 100% { transform: translate(0, 0) rotate(0); }
    25%      { transform: translate(1px, 0) rotate(0.5deg); }
    50%      { transform: translate(-1px, 0) rotate(-0.5deg); }
    75%      { transform: translate(0, 0) rotate(0.5deg); }
}
.rumble { animation: rumble 0.15s linear infinite; }

#loadingoverlay { opacity: 0; pointer-events: none; transition: opacity 0.4s ease; }
#loadingoverlay.show { opacity: 1; pointer-events: auto; }

#detail { opacity: 0; pointer-events: none; transition: opacity 0.4s ease; display: block; }
#detail.show { opacity: 1; pointer-events: auto; }
```

Then find the existing `#detail { display: none; ... }` rule near line 80 and **delete the `display: none;`** line — the new opacity rule replaces it.

After your edit, the existing `#detail { ... }` block should still have `position`, `bottom`, `right`, `width`, `height`, `word-wrap`, `background`, `color`, `box-shadow`, and `overflow` rules, just no `display: none`.

- [ ] **Step 3: Create `src/main.js` shell**

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
//
// This file will fill out across subsequent tasks. Right now it just proves the
// module entry boots and lets you confirm the loading overlay shakes via CSS.

console.log('Earthquake boot');
```

- [ ] **Step 4: Run dev server**

```bash
bun ./index.html
```

Bun will print a URL like `http://localhost:3000`. Open it.

Expected:
- Loading overlay text "Earthquake" + subtitle visible.
- The h3 ("Getting latest earthquake data from USGS.gov...") visibly shakes (CSS rumble).
- DevTools console prints `Earthquake boot`.
- DevTools Network tab shows requests for the bundled `src/main.js` and Bun's HMR client; **no requests for `js/three.js`, `jquery`, `dat.gui`, or any old vendor file**.
- No 404s, no console errors.

Stop the dev server (Ctrl-C) when satisfied.

- [ ] **Step 5: Commit**

```bash
git add index.html css/earthquake.css src/main.js
git commit -m "Switch to single ES-module entry under Bun; add CSS fade + rumble"
```

---

## Task 3: `src/scene.js` — globe renders

**Files:**
- Create: `src/scene.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/scene.js`**

```javascript
// src/scene.js — Scene, Camera, Renderer, lights, crust globe.
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    PointLight,
    Object3D,
    SphereGeometry,
    MeshPhongMaterial,
    Mesh,
    TextureLoader,
    ClampToEdgeWrapping,
    LinearFilter,
    DoubleSide,
    Color,
} from 'three';

export const CRUST_RADIUS = 6367;

export function createScene(container) {
    const scene = new Scene();

    const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(-4100, 4100, 0);
    camera.lookAt(CRUST_RADIUS, CRUST_RADIUS + 200, 0);

    const camGroup = new Object3D();
    camGroup.add(camera);
    scene.add(camGroup);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0x660000));
    const point = new PointLight(0xffffff, 3, 10000);
    point.position.set(0, 0, 0);
    scene.add(point);

    const tex = new TextureLoader().load('./img/world.jpg');
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;

    const crust = new Mesh(
        new SphereGeometry(CRUST_RADIUS, 32, 32),
        new MeshPhongMaterial({
            map: tex,
            side: DoubleSide,
            shininess: 100,
            specular: new Color('black'),
        }),
    );
    scene.add(crust);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, camGroup, renderer, crust };
}
```

Notes:
- `Projector` is gone — replaced by `vector.unproject(camera)` in `controls.js` later.
- `ImageUtils` → `TextureLoader`.
- `MeshPhongMaterial.ambient` is gone (modern three.js doesn't have it).
- `shading: SmoothShading` is gone (default).
- `antialiasing` typo fixed → `antialias`.

- [ ] **Step 2: Update `src/main.js`**

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { createScene } from './scene.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

console.log('Earthquake scene up');
```

- [ ] **Step 3: Run dev server**

```bash
bun ./index.html
```

Open the printed URL. Expected:
- Loading overlay still visible (still has `.show` class — feed task hasn't run yet).
- BEHIND the overlay: a dark earth globe rendered (you may need to dim the overlay or open a separate tab — the loading overlay covers the page).
- For now, since the loading overlay covers the screen, in DevTools toggle off the `.show` class on `#loadingoverlay` to see the globe behind it. The globe should appear with the world texture, faintly lit by ambient red + point light.
- No console errors.

(The overlay will get dismissed automatically by the feed task later. For now it stays.)

- [ ] **Step 4: Commit**

```bash
git add src/scene.js src/main.js
git commit -m "Add src/scene.js with modern three.js APIs; globe renders"
```

---

## Task 4: `src/tuning.js` — lil-gui panel

**Files:**
- Create: `src/tuning.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/tuning.js`**

```javascript
// src/tuning.js — lil-gui panel + tuning state + localStorage + JSON export + reset.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-marker-tuning';

const defaults = {
    // Blob
    radiusMin: 15,
    radiusMax: 180,
    deformAmpMin: 0.15,
    deformAmpMax: 0.45,
    pulseHzMin: 0.4,
    pulseHzMax: 1.6,
    // Rings
    maxReachMin: 3,
    maxReachMax: 8,
    cycleSec: 3.0,
    alphaExp: 1.5,
    thicknessFrac: 0.08,
    thicknessFalloff: 0.2,
    // Color
    emberHex: '#ffeebb',
    midHex: '#ff7733',
    cyanHex: '#22ccff',
    depthNormKm: 300,
    // Globals
    ringCount: 3,
    visible: true,
};

function loadStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

const stored = loadStored();
export const tuning = {};
for (const k in defaults) tuning[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : defaults[k];

function save() {
    try {
        const snap = {};
        for (const k in defaults) snap[k] = tuning[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
}

const ringCountListeners = [];
export function onRingCountChange(cb) { ringCountListeners.push(cb); }

function copyJson() {
    const snap = {};
    for (const k in defaults) snap[k] = tuning[k];
    const json = JSON.stringify(snap, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json);
    } else {
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }
    console.log('Tuning JSON copied:\n' + json);
}

export function buildGui() {
    const gui = new GUI({ width: 300 });
    const allControllers = [];

    const bind = (ctl) => { ctl.onChange(save); allControllers.push(ctl); return ctl; };

    const fBlob = gui.addFolder('Blob');
    bind(fBlob.add(tuning, 'radiusMin',     5,  200));
    bind(fBlob.add(tuning, 'radiusMax',    50,  400));
    bind(fBlob.add(tuning, 'deformAmpMin',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'deformAmpMax',  0,    1, 0.01));
    bind(fBlob.add(tuning, 'pulseHzMin',    0,    3, 0.05));
    bind(fBlob.add(tuning, 'pulseHzMax',    0,    5, 0.05));

    const fRings = gui.addFolder('Rings');
    bind(fRings.add(tuning, 'maxReachMin',     1,  20, 0.1));
    bind(fRings.add(tuning, 'maxReachMax',     1,  30, 0.1));
    bind(fRings.add(tuning, 'cycleSec',      0.5,   8, 0.1));
    bind(fRings.add(tuning, 'alphaExp',      0.5,   3, 0.05));
    bind(fRings.add(tuning, 'thicknessFrac', 0.02, 0.3, 0.005));
    bind(fRings.add(tuning, 'thicknessFalloff', 0,   1, 0.01));

    const fColor = gui.addFolder('Color');
    bind(fColor.addColor(tuning, 'emberHex'));
    bind(fColor.addColor(tuning, 'midHex'));
    bind(fColor.addColor(tuning, 'cyanHex'));
    bind(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));

    const fGlobals = gui.addFolder('Globals');
    const ringCtl = fGlobals.add(tuning, 'ringCount', 1, 6, 1);
    ringCtl.onChange((v) => { save(); ringCountListeners.forEach(cb => cb(v)); });
    allControllers.push(ringCtl);
    bind(fGlobals.add(tuning, 'visible'));
    fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
    fGlobals.add({
        reset: () => {
            const prevRingCount = tuning.ringCount;
            for (const k in defaults) tuning[k] = defaults[k];
            save();
            allControllers.forEach(c => c.updateDisplay());
            if (prevRingCount !== tuning.ringCount) ringCountListeners.forEach(cb => cb(tuning.ringCount));
        },
    }, 'reset').name('Reset to defaults');
}
```

Notes:
- `lil-gui` API is essentially identical to `dat.gui` (`add`, `addColor`, `addFolder`, `onChange`, `updateDisplay`).
- Folders are NOT auto-opened; lil-gui defaults to open. If you want closed by default add `.close()`.

- [ ] **Step 2: Update `src/main.js`**

Replace the file contents with:

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
```

- [ ] **Step 3: Run dev server + verify**

```bash
bun ./index.html
```

Expected:
- lil-gui panel docks top-right.
- Folders Blob / Rings / Color / Globals visible (open by default in lil-gui).
- All sliders movable.
- Color pickers open.
- "Reset to defaults" + "Copy as JSON" buttons present.
- Refresh page → slider values persist (localStorage).
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/tuning.js src/main.js
git commit -m "Add src/tuning.js with lil-gui panel + persistence"
```

---

## Task 5: `src/feed.js` — USGS fetch + geo helper

**Files:**
- Create: `src/feed.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/feed.js`**

```javascript
// src/feed.js — USGS GeoJSON fetch + lat/lng/depth → Vector3 helper.
import { Vector3 } from 'three';

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';
const TEXTURE_EDGE_LNG = -180.806168;

export const EARTH_RADIUS = 6367;

export async function loadEarthquakes() {
    const r = await fetch(FEED_URL);
    if (!r.ok) throw new Error('USGS feed HTTP ' + r.status);
    const data = await r.json();
    return data.features.map((f) => ({
        title: f.properties.place,
        magnitude: f.properties.mag,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depth: f.geometry.coordinates[2], // km
    }));
}

export function geoToVec3(lat, lng, depthKm = 0) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * Math.PI / 180;
    const r = EARTH_RADIUS - depthKm;
    return new Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
    );
}
```

- [ ] **Step 2: Update `src/main.js`** to fetch + log

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes } from './feed.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();

const loadingOverlay = document.getElementById('loadingoverlay');

(async function boot() {
    try {
        const eqs = await loadEarthquakes();
        console.log('Loaded', eqs.length, 'earthquakes', eqs[0]);
        loadingOverlay.classList.remove('show'); // CSS opacity transition fades it out
    } catch (e) {
        console.error('Earthquake fetch failed:', e);
    }
})();

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
```

- [ ] **Step 3: Verify**

`bun ./index.html`. Expected:
- Loading overlay fades out (CSS opacity transition) after the USGS fetch completes (typically 1-2 seconds).
- Console: `Loaded N earthquakes {title:..., magnitude:..., depth:..., lat:..., lng:...}`.
- Globe visible after overlay fades.
- Network tab: a request to `https://earthquake.usgs.gov/.../4.5_month.geojson` (no JSONP).
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/feed.js src/main.js
git commit -m "Add src/feed.js with fetch + geoToVec3; replace JSONP + custom plugin"
```

---

## Task 6: `src/markers.js` — blob + ring shaders, modern three APIs

This is the biggest task: full marker module ported to ES module form, with the r64 compat shims (setScalar, type:'v3', axis-angle quaternion) reverted to modern equivalents.

**Files:**
- Create: `src/markers.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/markers.js`**

```javascript
// src/markers.js — blob + ring shaders, marker factory, per-frame uniform update.
import {
    Object3D,
    Mesh,
    IcosahedronGeometry,
    PlaneGeometry,
    ShaderMaterial,
    Color,
    Vector3,
    Quaternion,
    DoubleSide,
    NormalBlending,
} from 'three';

import { tuning, onRingCountChange } from './tuning.js';

// ----- Color helpers -----
function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return { r: 1, g: 1, b: 1 };
    return {
        r: parseInt(m[1], 16) / 255,
        g: parseInt(m[2], 16) / 255,
        b: parseInt(m[3], 16) / 255,
    };
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(c1, c2, t) { return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) }; }

export function colorForDepth(depthKm) {
    const t = Math.max(0, Math.min(1, depthKm / tuning.depthNormKm));
    const ember = hexToRgb(tuning.emberHex);
    const mid   = hexToRgb(tuning.midHex);
    const cyan  = hexToRgb(tuning.cyanHex);
    return t < 0.5
        ? lerpRgb(ember, mid, t * 2)
        : lerpRgb(mid, cyan, (t - 0.5) * 2);
}

// ----- Shaders -----
const blobVert = /* glsl */`
    uniform float time;
    uniform float phaseSeed;
    uniform float deformAmp;
    uniform float pulseHz;
    varying vec3 vNormal;
    void main() {
        float ph = time * pulseHz + phaseSeed;
        float d = (sin(ph + 6.0 * position.x)
                 + sin(ph * 1.3 + 4.0 * position.y)
                 + sin(ph * 0.7 + 5.0 * position.z)) / 3.0;
        vec3 displaced = position + normal * deformAmp * d;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
`;

const blobFrag = /* glsl */`
    uniform vec3 color;
    varying vec3 vNormal;
    void main() {
        float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 1.5);
        vec3 c = color + vec3(rim) * 0.4;
        gl_FragColor = vec4(c, 1.0);
    }
`;

const ringVert = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const ringFrag = /* glsl */`
    uniform float time;
    uniform float phaseOffset;
    uniform float cycleSec;
    uniform float alphaExp;
    uniform float thicknessFrac;
    uniform float thicknessFalloff;
    uniform vec3  color;
    varying vec2 vUv;
    void main() {
        float t = mod(time + phaseOffset, cycleSec) / cycleSec;
        float r = length(vUv - vec2(0.5)) * 2.0;
        float thick = thicknessFrac * mix(1.0, thicknessFalloff, t);
        float band = 1.0 - smoothstep(0.0, thick, abs(r - t));
        float alpha = band * pow(1.0 - t, alphaExp);
        alpha *= mix(1.0, 0.6, t);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(color, alpha);
    }
`;

// ----- Factories -----
const allMarkers = [];
export function getAllMarkers() { return allMarkers; }

function makeBlobMaterial(magnitude, depth, phaseSeed) {
    const mNorm = Math.max(0, Math.min(1, (magnitude - 4.5) / 4.5));
    const c = colorForDepth(depth);
    return new ShaderMaterial({
        uniforms: {
            time:      { value: 0 },
            phaseSeed: { value: phaseSeed },
            deformAmp: { value: lerp(tuning.deformAmpMin, tuning.deformAmpMax, mNorm) },
            pulseHz:   { value: lerp(tuning.pulseHzMin, tuning.pulseHzMax, mNorm) },
            color:     { value: new Color(c.r, c.g, c.b) },
        },
        vertexShader: blobVert,
        fragmentShader: blobFrag,
    });
}

function makeRingMaterial(depth, phaseOffset) {
    const c = colorForDepth(depth);
    return new ShaderMaterial({
        uniforms: {
            time:             { value: 0 },
            phaseOffset:      { value: phaseOffset },
            cycleSec:         { value: tuning.cycleSec },
            alphaExp:         { value: tuning.alphaExp },
            thicknessFrac:    { value: tuning.thicknessFrac },
            thicknessFalloff: { value: tuning.thicknessFalloff },
            color:            { value: new Color(c.r, c.g, c.b) },
        },
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: NormalBlending,
        side: DoubleSide,
    });
}

function buildRingsForMarker(marker) {
    const oldRings = marker.userData._rings || [];
    for (const r of oldRings) marker.remove(r);

    const data = marker.userData;
    const count = tuning.ringCount | 0;
    const dNorm = Math.max(0, Math.min(1, data.depth / tuning.depthNormKm));
    const mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
    const blobRadius = lerp(tuning.radiusMin, tuning.radiusMax, mNorm);
    const maxRadius  = lerp(tuning.maxReachMin, tuning.maxReachMax, dNorm) * blobRadius;

    const rings = [];
    for (let i = 0; i < count; i++) {
        const phaseOff = (tuning.cycleSec * i) / count;
        const mat = makeRingMaterial(data.depth, phaseOff);
        const geo = new PlaneGeometry(2, 2, 1, 1);
        const ring = new Mesh(geo, mat);
        ring.scale.setScalar(maxRadius); // modern API
        ring.userData._kind = 'ring';
        marker.add(ring);
        rings.push(ring);
    }
    marker.userData._rings = rings;
}

function orientRingsToSurface(marker) {
    if (marker.position.lengthSq() < 1e-6) return;
    const normal = marker.position.clone().normalize();
    const quat = new Quaternion();
    quat.setFromUnitVectors(new Vector3(0, 0, 1), normal); // modern API
    for (const r of marker.userData._rings || []) r.quaternion.copy(quat);
}

export function createBlobMarker(data) {
    const marker = new Object3D();
    const phaseSeed = Math.random() * 6.28318;
    const mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
    const radius = lerp(tuning.radiusMin, tuning.radiusMax, mNorm);

    const blob = new Mesh(new IcosahedronGeometry(1, 2), makeBlobMaterial(data.magnitude, data.depth, phaseSeed));
    blob.scale.setScalar(radius);
    blob.userData = { ...data, _kind: 'blob' };
    marker.add(blob);

    marker.userData = {
        ...data,
        _phaseSeed: phaseSeed,
        _ringPhaseSeed: Math.random() * 1000,
        _blob: blob,
        _rings: [],
        _needsOrient: true,
    };

    buildRingsForMarker(marker);
    allMarkers.push(marker);
    return marker;
}

export function updateUniforms(time) {
    if (!allMarkers.length) return;
    for (const m of allMarkers) {
        m.visible = !!tuning.visible;

        if (m.userData._needsOrient && m.position.lengthSq() > 1e-6) {
            orientRingsToSurface(m);
            m.userData._needsOrient = false;
        }

        const blob = m.userData._blob;
        if (blob) {
            const u = blob.material.uniforms;
            const data = m.userData;
            const mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
            const radius = lerp(tuning.radiusMin, tuning.radiusMax, mNorm);
            u.time.value      = time;
            blob.scale.setScalar(radius);
            u.deformAmp.value = lerp(tuning.deformAmpMin, tuning.deformAmpMax, mNorm);
            u.pulseHz.value   = lerp(tuning.pulseHzMin, tuning.pulseHzMax, mNorm);
            const c = colorForDepth(data.depth);
            u.color.value.setRGB(c.r, c.g, c.b);
        }

        const rings = m.userData._rings || [];
        if (rings.length) {
            const data = m.userData;
            const mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
            const dNorm = Math.max(0, Math.min(1, data.depth / tuning.depthNormKm));
            const blobR = lerp(tuning.radiusMin, tuning.radiusMax, mNorm);
            const maxR  = lerp(tuning.maxReachMin, tuning.maxReachMax, dNorm) * blobR;
            const c = colorForDepth(data.depth);
            for (let k = 0; k < rings.length; k++) {
                const ring = rings[k];
                const ru = ring.material.uniforms;
                ru.time.value             = time;
                ru.cycleSec.value         = tuning.cycleSec;
                ru.alphaExp.value         = tuning.alphaExp;
                ru.thicknessFrac.value    = tuning.thicknessFrac;
                ru.thicknessFalloff.value = tuning.thicknessFalloff;
                ru.color.value.setRGB(c.r, c.g, c.b);
                ru.phaseOffset.value      = (data._ringPhaseSeed || 0) + (tuning.cycleSec * k) / rings.length;
                ring.scale.setScalar(maxR);
            }
        }
    }
}

// React to ringCount changes
onRingCountChange(() => {
    for (const m of allMarkers) {
        buildRingsForMarker(m);
        orientRingsToSurface(m);
    }
});
```

Notes:
- Uses modern `setScalar`, `setFromUnitVectors`, `Color` uniform — all r64 shims gone.
- Uniform `type` strings dropped (modern three.js infers from `value`).
- `NormalBlending` (chosen at end of last cycle) preserved.

- [ ] **Step 2: Update `src/main.js`** to add markers + drive uniform updates

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms } from './markers.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();

const loadingOverlay = document.getElementById('loadingoverlay');
const clock = new Clock();

(async function boot() {
    try {
        const eqs = await loadEarthquakes();
        for (const eq of eqs) {
            const marker = createBlobMarker(eq);
            marker.position.copy(geoToVec3(eq.lat, eq.lng, eq.depth));
            crust.add(marker);
        }
        loadingOverlay.classList.remove('show');
    } catch (e) {
        console.error('Earthquake fetch failed:', e);
    }
})();

function animate() {
    requestAnimationFrame(animate);
    scene.updateMatrixWorld();
    updateUniforms(clock.getElapsedTime());
    renderer.render(scene, camera);
}
animate();
```

- [ ] **Step 3: Verify**

`bun ./index.html`. Expected:
- After loading overlay fades, blob markers appear over the globe, pulsing/warping.
- Pulse rings around each blob, lying flat on the globe surface.
- Magnitude → size + pulse rate. Depth → cool color + ring reach.
- Sliders in lil-gui panel update markers live.
- ringCount slider rebuilds rings.
- Reset to defaults works.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/markers.js src/main.js
git commit -m "Add src/markers.js with modern three APIs; revert r64 compat shims"
```

---

## Task 7: `src/controls.js` — drag rotation + arrow keys + raycast

**Files:**
- Create: `src/controls.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/controls.js`**

```javascript
// src/controls.js — mouse/touch rotation, arrow-key orbit, raycast click selection.
import { Vector2, Vector3, Raycaster } from 'three';

export function attachControls({ camera, camGroup, markers, onSelect, onMiss }) {
    let targetRotationX = 0;
    let targetRotationY = 0;
    let targetCameraRotationY = 0;
    let mouseXOnDown = 0;
    let mouseYOnDown = 0;
    let targetRotationOnDownX = 0;
    let targetRotationOnDownY = 0;

    const halfX = () => window.innerWidth / 2;
    const halfY = () => window.innerHeight / 2;

    let pendingClick = null;

    function onMouseDown(e) {
        e.preventDefault();
        pendingClick = { x: e.clientX, y: e.clientY };
        mouseXOnDown = e.clientX - halfX();
        mouseYOnDown = e.clientY - halfY();
        targetRotationOnDownX = targetRotationX;
        targetRotationOnDownY = targetRotationY;
        document.addEventListener('mousemove', onMouseMove, false);
        document.addEventListener('mouseup', onMouseUp, false);
        document.addEventListener('mouseout', onMouseUp, false);
    }
    function onMouseMove(e) {
        const mx = e.clientX - halfX();
        const my = e.clientY - halfY();
        targetRotationX = targetRotationOnDownX + (mx - mouseXOnDown) * 0.02;
        targetRotationY = targetRotationOnDownY + (my - mouseYOnDown) * 0.02;
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove, false);
        document.removeEventListener('mouseup', onMouseUp, false);
        document.removeEventListener('mouseout', onMouseUp, false);
    }
    function onTouchStart(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            pendingClick = { x: e.touches[0].pageX, y: e.touches[0].pageY };
            mouseXOnDown = e.touches[0].pageX - halfX();
            mouseYOnDown = e.touches[0].pageY - halfY();
            targetRotationOnDownX = targetRotationX;
            targetRotationOnDownY = targetRotationY;
        }
    }
    function onTouchMove(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            const mx = e.touches[0].pageX - halfX();
            const my = e.touches[0].pageY - halfY();
            targetRotationX = targetRotationOnDownX + (mx - mouseXOnDown) * 0.05;
            targetRotationY = targetRotationOnDownY + (my - mouseYOnDown) * 0.05;
        }
    }
    function onKeyDown(e) {
        if (e.keyCode === 65 || e.keyCode === 37) targetCameraRotationY += 0.5; // A or ←
        else if (e.keyCode === 68 || e.keyCode === 39) targetCameraRotationY -= 0.5; // D or →
    }

    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('touchstart', onTouchStart, false);
    document.addEventListener('touchmove', onTouchMove, false);
    document.addEventListener('keydown', onKeyDown, false);

    const raycaster = new Raycaster();
    const ndc = new Vector2();

    function processClick() {
        if (!pendingClick) return;
        ndc.x = (pendingClick.x / window.innerWidth) * 2 - 1;
        ndc.y = -(pendingClick.y / window.innerHeight) * 2 + 1;
        pendingClick = null;
        raycaster.setFromCamera(ndc, camera);
        const intersects = raycaster.intersectObjects(markers, true);
        for (const hit of intersects) {
            const o = hit.object;
            if (o.userData && o.userData._kind === 'blob') {
                onSelect(o.parent);
                return;
            }
        }
        onMiss();
    }

    function update() {
        camGroup.rotation.x += (-targetRotationX - camGroup.rotation.x) * 0.05;
        camGroup.rotation.z += ( targetRotationY - camGroup.rotation.z) * 0.05;
        camGroup.rotation.y += ( targetCameraRotationY - camGroup.rotation.y) * 0.15;
        processClick();
    }

    return { update };
}
```

Notes:
- `THREE.Projector` + `unprojectVector` replaced by `Raycaster.setFromCamera(ndc, camera)`.
- The original code recorded the click in `mousedown` and processed it in the next render frame; this preserves that pattern.

- [ ] **Step 2: Update `src/main.js`** to wire controls

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();

const loadingOverlay = document.getElementById('loadingoverlay');
const clock = new Clock();

const controls = attachControls({
    camera,
    camGroup,
    markers: getAllMarkers(),
    onSelect: (marker) => { console.log('selected', marker.userData.title); },
    onMiss:   () => {},
});

(async function boot() {
    try {
        const eqs = await loadEarthquakes();
        for (const eq of eqs) {
            const marker = createBlobMarker(eq);
            marker.position.copy(geoToVec3(eq.lat, eq.lng, eq.depth));
            crust.add(marker);
        }
        loadingOverlay.classList.remove('show');
    } catch (e) {
        console.error('Earthquake fetch failed:', e);
    }
})();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    scene.updateMatrixWorld();
    updateUniforms(clock.getElapsedTime());
    renderer.render(scene, camera);
}
animate();
```

- [ ] **Step 3: Verify**

`bun ./index.html`. Expected:
- Click + drag rotates the globe smoothly.
- Arrow keys (or A/D) orbit the camera.
- Click on a blob → console logs `selected <place name>`.
- Click on empty space → no log.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/controls.js src/main.js
git commit -m "Add src/controls.js with Raycaster-based click selection"
```

---

## Task 8: `src/detail.js` — detail panel + OSM iframe

**Files:**
- Create: `src/detail.js`
- Modify: `src/main.js`

- [ ] **Step 1: Create `src/detail.js`**

```javascript
// src/detail.js — show/hide the detail panel + populate fields and OSM iframe.

const elPanel    = () => document.getElementById('detail');
const elLocation = () => document.getElementById('detail-location');
const elMag      = () => document.getElementById('detail-magnitude');
const elDepth    = () => document.getElementById('detail-depth');
const elMap      = () => document.getElementById('detail-map');

function osmEmbedUrl(lat, lng) {
    const d = 4; // bbox half-height in degrees (~regional view)
    const bbox = [lng - d * 2, lat - d, lng + d * 2, lat + d].join(',');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export function showDetail(data) {
    elLocation().textContent = data.title;
    elMag().innerHTML        = '<h1>Magnitude</h1>' + data.magnitude;
    elDepth().innerHTML      = '<h1>Depth</h1>' + Math.round(data.depth * 0.621371) + ' miles';
    elMap().src              = osmEmbedUrl(data.lat, data.lng);
    elPanel().classList.add('show');
}

export function hideDetail() {
    elPanel().classList.remove('show');
}
```

- [ ] **Step 2: Update `src/main.js`** to wire detail show/hide into controls

```javascript
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';
import { showDetail, hideDetail } from './detail.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer, crust } = createScene(eqScene);
buildGui();

const loadingOverlay = document.getElementById('loadingoverlay');
const clock = new Clock();

const controls = attachControls({
    camera,
    camGroup,
    markers: getAllMarkers(),
    onSelect: (marker) => showDetail(marker.userData),
    onMiss:   () => hideDetail(),
});

(async function boot() {
    try {
        const eqs = await loadEarthquakes();
        for (const eq of eqs) {
            const marker = createBlobMarker(eq);
            marker.position.copy(geoToVec3(eq.lat, eq.lng, eq.depth));
            crust.add(marker);
        }
        loadingOverlay.classList.remove('show');
    } catch (e) {
        console.error('Earthquake fetch failed:', e);
    }
})();

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    scene.updateMatrixWorld();
    updateUniforms(clock.getElapsedTime());
    renderer.render(scene, camera);
}
animate();
```

- [ ] **Step 3: Verify**

`bun ./index.html`. Expected:
- Click a blob → detail panel slides in (CSS opacity transition) bottom-right with location, magnitude, depth, OSM iframe map.
- Map shows the region around the quake (not Mexico for a Nevada quake) with the OSM marker pin at the correct lat/lng.
- Click an empty area of the globe → panel fades out.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/detail.js src/main.js
git commit -m "Add src/detail.js with OSM iframe + classList show/hide"
```

---

## Task 9: Delete legacy files

By this point everything renders via `src/`. Time to remove the dead `js/` files.

**Files:**
- Delete: `js/main.js`, `js/markers.js`, `js/tuning.js`, `js/three.js`, `js/three.geospatial.js`, `js/Detector.js`, `js/howler.js`, `js/jquery.jrumble.1.3.min.js`, `js/geojson.js`, `js/vendor/dat.gui.min.js`, `js/vendor/jquery-1.10.2.min.js`, `js/vendor/modernizr-2.6.2.min.js`

- [ ] **Step 1: Confirm none of these are referenced**

```bash
grep -rn --include='*.html' --include='*.js' --include='*.css' \
    -e 'js/main.js' -e 'js/markers.js' -e 'js/tuning.js' \
    -e 'js/three.js' -e 'js/three.geospatial.js' -e 'js/Detector.js' \
    -e 'js/howler.js' -e 'js/jquery.jrumble' -e 'js/geojson.js' \
    -e 'js/vendor/dat.gui' -e 'js/vendor/jquery' -e 'js/vendor/modernizr' \
    src/ index.html css/
```

Expected: no matches.

- [ ] **Step 2: Delete the files**

```bash
rm -rf js/
```

- [ ] **Step 3: Verify**

`bun ./index.html`. Expected:
- Page works identically: globe, blobs, rings, panel, click-to-detail.
- DevTools Network tab: no requests to anything under `js/`.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add -A js/
git commit -m "Delete js/ directory; replaced by src/ + npm packages"
```

(`git add -A js/` stages the deletions.)

---

## Task 10: Production build verification

**Files:**
- (none modified; this is a smoke test of the build script)

- [ ] **Step 1: Run production build**

```bash
bun run build
```

Expected:
- A `dist/` directory appears.
- Inside: at least an `index.html`, a bundled JS file, and any referenced assets.
- No errors.

- [ ] **Step 2: Serve `dist/` with a generic static server and open**

```bash
cd dist && python3 -m http.server 8765
```

Open `http://localhost:8765/`. Expected:
- Same behavior as `bun run dev`: globe, blobs, rings, click-to-detail, no console errors.
- Network tab shows requests for relative-path assets (no `localhost:3000` references).

Stop the server (Ctrl-C). `cd ..` back to project root.

- [ ] **Step 3: Confirm `dist/` is gitignored**

```bash
git status --short dist/
```

Expected: no output (dist is ignored).

- [ ] **Step 4: Final design checklist**

Run through these in `bun run dev` one more time:

- [ ] `bun run dev` opens to the rotating earth with quake markers, no console errors.
- [ ] Loading overlay shakes during USGS fetch, fades out when data arrives.
- [ ] Blob markers pulse + warp, sized + colored by magnitude / depth.
- [ ] Pulse rings lie flat on globe, expand outward, fade.
- [ ] lil-gui panel docks top-right; sliders update markers live; persists across reload; Reset works.
- [ ] Click a blob → detail panel shows location, magnitude, depth, OSM iframe.
- [ ] Click empty → panel fades out.
- [ ] Drag rotates the globe; arrow keys orbit camera.
- [ ] No requests to `js/three.js`, `js/howler.js`, `js/Detector.js`, `js/jquery.*`, `js/modernizr.*`, `js/three.geospatial.js`, `js/geojson.js`, `js/vendor/dat.gui.min.js`.
- [ ] `js/` directory does not exist on disk.
- [ ] `bun run build` produces a `dist/` that loads correctly under any static server.

- [ ] **Step 5: Final commit (if anything was tweaked during the checklist)**

```bash
git add -A
git status   # confirm only intended changes
git commit -m "three.js upgrade complete: latest three + Bun + ES modules + lil-gui"
```

If nothing needed tweaking, skip the commit.

---

## Done

Suggest the user run `/ultrareview` against the branch for a multi-agent review, or merge to master if satisfied.
