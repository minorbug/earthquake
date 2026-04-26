# three.js Upgrade — Design

Migrate the project from three.js r64 (2014) to the latest release (~r170+), introduce Bun as the package manager / dev server / bundler, convert sources to ES modules, and drop a half-decade of accumulated legacy dependencies (jQuery, Howler.js, Detector.js, Modernizr, jrumble, custom three.geospatial.js plugin, dat.GUI vendored).

## Goals

- Run on a current, supported three.js so future visual work (post-processing, instancing, modern shaders) is unblocked.
- Replace the r64 compat shims accumulated in this session with idiomatic modern API calls.
- Adopt a real dev workflow with `bun ./index.html` + hot reload + production builds.
- Remove ~6,000 lines of unused / legacy vendored code.

## Non-Goals

- New visual features. The output should look identical to the post-blob-markers master.
- Mobile / responsive polish.
- Any test framework. Verification stays manual + visual.
- Replacing the detail panel's OSM iframe with a richer map widget (separate follow-up).

## Tooling: Bun

Bun (zig-based) is npm + node + esbuild + nodemon collapsed into a single binary. Used for: dependency management, dev server with HMR, production bundling.

### Setup commands (one-time)

```bash
brew install oven-sh/bun/bun
bun init -y                          # creates package.json + bun.lockb + tsconfig.json + .gitignore entries
bun add three lil-gui                # runtime deps
bun add -d @types/three              # editor hints; optional
```

### Daily workflow

```bash
bun run dev      # alias for: bun ./index.html
bun run build    # alias for: bun build ./index.html --outdir=dist --minify
```

### Files added to repo

| File | Status | Notes |
|------|--------|-------|
| `package.json` | commit | Deps + scripts |
| `bun.lockb` | commit | Binary lockfile, deterministic installs |
| `tsconfig.json` | commit | Bun default; editor JSDoc inference. Can delete if not desired. |
| `node_modules/` | gitignore | ~30MB, instant install via hardlinks |
| `dist/` | gitignore | Production build output |

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "bun ./index.html",
    "build": "bun build ./index.html --outdir=dist --minify"
  }
}
```

## File Layout

Drop the flat `js/` directory; introduce `src/` with module boundaries scaled to single responsibilities.

```
src/
  main.js       Entry. WebGL check, boot, render loop, wires modules.
  scene.js      Scene + Camera + WebGLRenderer + lights + crust globe mesh.
  controls.js   Mouse/touch rotation, keyboard orbit, raycast click → marker selection.
  feed.js       USGS GeoJSON fetch + lat/lng/depth → Vector3 helper.
  markers.js    Blob + ring shaders, createBlobMarker, per-frame uniform update.
  tuning.js     lil-gui panel, tuning state object, localStorage, JSON export, reset.
  detail.js     Detail panel show/hide, OSM iframe URL builder.
```

`index.html` becomes:

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
    <div id="loadingoverlay">
      <h1>Earthquake</h1>
      <h2>Inspired by the "Earthquake" exhibit at the California Academy of Sciences</h2>
      <h3>Getting latest earthquake data from USGS.gov...</h3>
    </div>
    <div id="header">...</div>
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

Bun reads the `<script type="module">` tag, bundles its import graph, and serves it. No `<script src>` for vendor libs anymore.

## Files Deleted

| File | Reason |
|------|--------|
| `js/three.js` | Replaced by `three` npm import |
| `js/three.geospatial.js` | Replaced by `geoToVec3` helper in `src/feed.js` |
| `js/Detector.js` | Replaced by 4-line WebGL check in `src/main.js` |
| `js/howler.js` | Never used in the codebase |
| `js/jquery.jrumble.1.3.min.js` | Replaced by 6 lines of CSS keyframes |
| `js/vendor/jquery-1.10.2.min.js` | Replaced by vanilla DOM (8 call sites) |
| `js/vendor/modernizr-2.6.2.min.js` | Never referenced from code |
| `js/vendor/dat.gui.min.js` | Replaced by `lil-gui` npm import (drop-in API) |
| `js/geojson.js` | Replaced by `fetch` + `.geojson` endpoint in `src/feed.js` |
| `js/main.js`, `js/markers.js`, `js/tuning.js` | Moved to `src/` and converted to ES modules |

## three.js API Migrations

| Old (r64)                                   | New                                                                 | Where |
|---------------------------------------------|---------------------------------------------------------------------|-------|
| `THREE.Projector` + `unprojectVector(v, c)` | `vector.unproject(camera)`                                          | `controls.js` raycast |
| `THREE.ImageUtils.loadTexture(url)`         | `new THREE.TextureLoader().load(url)`                               | `scene.js` (world.jpg) |
| `MeshPhongMaterial({ ambient: 0xffffff })`  | drop `ambient`; tune `color`/`emissive` if needed                   | `scene.js` crust |
| `MeshPhongMaterial({ shading: SmoothShading })` | drop (default smooth); use `flatShading: true` for flat        | `scene.js` crust |
| `geometry.applyMatrix(m)`                   | `geometry.applyMatrix4(m)`                                          | not currently used |
| ShaderMaterial uniform `type` strings       | type strings ignored — modern infers from value. Keep `value:` only | `markers.js` |
| ShaderMaterial color uniform                | revert `type:'v3'` workaround back to `{ value: new Color(...) }`   | `markers.js` |
| `vector.setScalar(n)`                       | exists in modern. Revert workaround.                                | `markers.js` |
| `Quaternion.setFromUnitVectors`             | exists in modern. Revert axis-angle workaround.                     | `markers.js` |
| `Detector.webgl`                            | `canvas.getContext('webgl2') \|\| canvas.getContext('webgl')`       | `main.js` |
| `WebGLRenderer({ antialiasing: true })`     | `WebGLRenderer({ antialias: true })` (typo fix)                     | `scene.js` |

## Replacement Snippets for Removed Deps

### jQuery → vanilla (8 call sites)

| jQuery | Vanilla |
|--------|---------|
| `$('#x').html(s)` | `document.getElementById('x').innerHTML = s` |
| `$('#x').attr('src', u)` | `document.getElementById('x').src = u` |
| `$('#x').fadeIn(ms)` / `.fadeOut(ms)` | CSS `.show` class toggle (see below) |
| `$(document).on('custom_event', cb)` | direct callback from `feed.js` |

CSS for fade:

```css
#detail, #loadingoverlay { opacity: 0; pointer-events: none; transition: opacity .4s ease; }
#detail.show, #loadingoverlay.show { opacity: 1; pointer-events: auto; }
```

JS: `el.classList.add('show')` / `.remove('show')`.

### jrumble → CSS keyframes

```css
@keyframes rumble {
  0%,100% { transform: translate(0,0) rotate(0); }
  25%     { transform: translate(1px,0) rotate(.5deg); }
  50%     { transform: translate(-1px,0) rotate(-.5deg); }
  75%     { transform: translate(0,0) rotate(.5deg); }
}
.rumble { animation: rumble .15s linear infinite; }
```

### USGS JSONP → fetch CORS

`src/feed.js`:

```js
import { Vector3 } from 'three';

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';
const EARTH_RADIUS = 6367;
const TEXTURE_EDGE_LNG = -180.806168;

export async function loadEarthquakes() {
  const r = await fetch(FEED_URL);
  if (!r.ok) throw new Error('USGS feed ' + r.status);
  const data = await r.json();
  return data.features.map(f => ({
    title: f.properties.place,
    magnitude: f.properties.mag,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    depth: f.geometry.coordinates[2],
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

### Detector.js → 4-line check

`src/main.js`:

```js
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
  document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
  throw new Error('no webgl');
}
```

### dat.GUI → lil-gui

API is essentially the same. Import:

```js
import GUI from 'lil-gui';
const gui = new GUI({ width: 300 });
const folder = gui.addFolder('Blob');
folder.add(tuning, 'radiusMin', 5, 200).onChange(save);
folder.addColor(tuning, 'emberHex').onChange(save);
```

## Module Architecture

### `main.js` — entry

- WebGL check.
- Construct Scene, Camera, Renderer via `scene.js`.
- Construct controls via `controls.js`.
- Construct lil-gui panel via `tuning.js`.
- Kick off USGS fetch via `feed.js`.
- For each earthquake, create a marker via `markers.js`, position it via `geoToVec3`, add to crust group.
- requestAnimationFrame loop calls `controls.update()`, `markers.updateUniforms(time)`, `renderer.render(scene, camera)`.

### `scene.js`

```js
import { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, PointLight,
         Object3D, SphereGeometry, MeshPhongMaterial, Mesh, TextureLoader,
         ClampToEdgeWrapping, LinearFilter, DoubleSide, Color } from 'three';

export function createScene(container) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, innerWidth/innerHeight, 1, 20000);
  camera.position.set(-4100, 4100, 0);
  camera.lookAt(6367, 6567, 0);

  const camGroup = new Object3D();
  camGroup.add(camera);
  scene.add(camGroup);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  container.appendChild(renderer.domElement);

  scene.add(new AmbientLight(0x660000));
  const point = new PointLight(0xffffff, 3, 10000);
  scene.add(point);

  const tex = new TextureLoader().load('./img/world.jpg');
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;

  const crust = new Mesh(
    new SphereGeometry(6367, 32, 32),
    new MeshPhongMaterial({ map: tex, side: DoubleSide, shininess: 100, specular: new Color('black') }),
  );
  scene.add(crust);

  return { scene, camera, camGroup, renderer, crust };
}
```

### `controls.js`

Encapsulates mouse/touch state, drag-to-rotate target rotations, arrow-key orbit, and raycast click handling. Exposes `update(camGroup)` (called per frame to lerp rotations) and a constructor that takes `{ camera, markers, onSelect }`.

### `markers.js`

Same structure as today, ES module form. `createBlobMarker(data)` returns `Object3D`, factory pushes onto module-private `allMarkers` array, `updateUniforms(time)` iterates and sets shader uniforms. `tuning.onRingCountChange` listener registered on import.

Reverts:
- Drop `setScalar` → `set` patch.
- Drop `type: 'v3'` → restore `{ value: new Color(...) }` and `u.color.value.set(...)`.
- Drop axis-angle code → restore `quat.setFromUnitVectors(...)`.

### `tuning.js`

lil-gui panel. Same defaults, same folders, same `onRingCountChange` API as today. Exports a singleton `tuning` object plus `onRingCountChange(cb)`.

### `detail.js`

Two functions: `showDetail(data)` populates fields + iframe + adds `.show` class; `hideDetail()` removes the class.

### `feed.js`

Already shown above. Exports `loadEarthquakes()` (async) and `geoToVec3()`.

## CSS Adjustments

- Add `#detail.show` / `#loadingoverlay.show` rules with opacity transition (replaces jQuery fade).
- Add `.rumble` keyframes (replaces jrumble).
- Remove any rule referencing `display: none` on `#detail` (replaced by opacity).

Otherwise `css/earthquake.css` is unchanged.

## Migration Order

The migration is one big swap, but the work fans out into clear stages. Each stage leaves the page either fully working OR clearly broken in a known way that the next stage fixes. No half-states across stage boundaries.

1. Bun init + install three + lil-gui + scripts.
2. Move `js/main.js`, `markers.js`, `tuning.js` to `src/`. Convert to ES modules with `import * as THREE from 'three'`. Update `index.html` to single `<script type="module">`. Run `bun ./index.html`. Page should load with same r64 compat shims still present (they happen to work in modern three.js too).
3. Migrate three.js APIs: drop `Projector`, swap `ImageUtils` → `TextureLoader`, drop `ambient` / `shading`, fix `antialias` typo. Verify visual parity.
4. Revert r64 compat shims: `setScalar`, Color uniforms, `setFromUnitVectors`. Verify visual parity.
5. Replace dat.GUI with lil-gui. Verify panel works.
6. Replace `geojson.js` JSONP with `feed.js` fetch. Replace `three.geospatial.js` plugin with `geoToVec3` inline. Delete the old files.
7. Replace jQuery: rewrite the 8 call sites with vanilla DOM. Add CSS class fade-in/out. Delete `js/vendor/jquery-1.10.2.min.js`.
8. Replace jrumble with CSS keyframes. Delete jrumble.
9. Replace Detector.js with the 4-line check. Delete Detector.
10. Delete Howler.js and Modernizr (unused).
11. Add `bun build` script. Verify `dist/` serves correctly via `python3 -m http.server` against `dist/`.

## Testing / Completion Checklist

### Behavior parity

- [ ] `bun run dev` opens to the rotating earth with quake markers, no console errors.
- [ ] Loading overlay shakes during USGS fetch, fades out when data arrives.
- [ ] Blob markers pulse + warp, sized + colored by magnitude / depth.
- [ ] Pulse rings lie flat on globe, expand outward, fade.
- [ ] lil-gui panel docks top-right; all sliders update markers live; persists across reload; Reset works.
- [ ] Click a blob → detail panel shows location, magnitude, depth, OSM iframe.
- [ ] Drag rotates the globe; arrow keys orbit camera.

### Migration wins

- [ ] r64 compat shims reverted: `setScalar`, `Color` uniforms, `setFromUnitVectors`. Page still works.
- [ ] No requests in Network tab to `js/three.js`, `js/howler.js`, `js/Detector.js`, `js/jquery.*`, `js/modernizr.*`, `js/three.geospatial.js`, `js/geojson.js`, `js/vendor/dat.gui.min.js`.
- [ ] `js/` directory deleted (only `src/` and `img/` remain on the JS side).
- [ ] `node_modules/`, `dist/` gitignored; `package.json`, `bun.lockb` committed.
- [ ] `bun run build` produces `dist/` that loads correctly when served by any static server.

## Open Questions

None — proceeding to implementation plan.
