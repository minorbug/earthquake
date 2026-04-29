# Simplification Removals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four visual subsystems from the earthquake visualizer (magma core orb + fluid + crust-rim glow, heat-haze post-FX, plate-motion arrows + hover-to-reveal, earthquake ripple rings), leaving the crust + boundary lines + earthquake blob markers.

**Architecture:** Pure subtraction. No new modules. Each task removes one cohesive subsystem (consumers in `main.js` first, then orphaned modules, then GUI panels, then unused build flags / inspect scripts). After each task the app boots cleanly so the deletion is verifiable in isolation.

**Tech Stack:** Bun, Three.js, lil-gui, vanilla ES modules. No tests survive the removals (the only test file is `src/plateMotionMath.test.js`, deleted in Task 1).

**Spec:** `docs/superpowers/specs/2026-04-28-simplify-removals-design.md`

---

## File Structure

**Files deleted across all tasks:**
- `src/core.js`, `src/coreVolFluid.js`, `src/postFX.js`
- `src/plateMotion.js`, `src/plateMotionMath.js`, `src/plateMotionMath.test.js`
- `data/pb2002_poles.json`
- `scripts/inspect-core.js`, `inspect-flame.js`, `inspect-haze.js`, `inspect-haze-orbit.js`, `inspect-falloff.js`, `inspect-plate-motion.js`, `inspect-plate-wake.js`, `inspect-pole.js`, `inspect-volfluid.js`, `inspect-volfluid-debug.js`

**Files modified across all tasks:**
- `src/main.js` — drop imports, locals, and animate-loop calls for each removed subsystem; switch from `EffectComposer` rendering to `renderer.render()`.
- `src/atlas.js` — strip core-rim glow uniforms and varyings from the crust shader.
- `src/markers.js` — strip ring shader, ring factory, ring update loop, and unused Three.js imports.
- `src/tuning.js` — drop "Rings" GUI folder, ring defaults, ring listener plumbing.
- `src/atlasTuning.js` — drop "Core glow", "Heat haze", "Magma core", "Magma fluid", "Plate motion" GUI folders + their defaults.
- `package.json` — drop `build:no-fluid` and `build:no-plate-motion` scripts.

**Files retained that look related but stay:**
- `data/pb2002_steps_with_plates.geojson` — `src/atlas.js` consumes this for boundary-line geometry.
- `scripts/inspect-dist.js`, `inspect-geo.js`, `inspect-mask.js`, `inspect.js`, `prep-atlas-data.js` — not coupled to any removed subsystem.

**Resize handling note:** `src/scene.js` already owns the renderer-resize listener (camera aspect + `renderer.setSize`). The `main.js` resize listener for `postFX.setSize` is purely for the EffectComposer; once removed, no replacement is needed.

---

## Task 1: Remove plate-motion arrows + hover

**Files:**
- Modify: `src/main.js`
- Modify: `src/atlasTuning.js`
- Modify: `package.json`
- Delete: `src/plateMotion.js`, `src/plateMotionMath.js`, `src/plateMotionMath.test.js`, `data/pb2002_poles.json`
- Delete: `scripts/inspect-plate-motion.js`, `scripts/inspect-plate-wake.js`, `scripts/inspect-pole.js`

- [ ] **Step 1: Strip plate-motion wiring from `src/main.js`**

Edit `src/main.js`. Replace the dynamic-import block:

```js
// Plate motion vectors. Build-time-optional via process.env.ENABLE_PLATE_MOTION.
let plateMotion = null;
if (process.env.ENABLE_PLATE_MOTION !== 'false') {
    const { loadPlateMotion } = await import('./plateMotion.js');
    plateMotion = loadPlateMotion({ scene, radius: CRUST_RADIUS, atlas, camera, renderer });
}
```

with nothing (delete those six lines entirely).

In the same file, remove the `plateMotion.update(t)` call from the animate loop. Replace:

```js
    if (volFluid) volFluid.update(t);
    if (plateMotion) plateMotion.update(t);
    postFX.update(t);
```

with:

```js
    if (volFluid) volFluid.update(t);
    postFX.update(t);
```

(The `volFluid` and `postFX` lines stay — they're removed in Tasks 2 and 3.)

- [ ] **Step 2: Strip the "Plate motion" section from `src/atlasTuning.js`**

In `src/atlasTuning.js`, delete this block from `defaults`:

```js
    // Plate motion vectors layer (PB2002 Euler poles + flow shader).
    plateMotionEnabled: true,
    arrowsEnabled:      true,
    flowEnabled:        false,   // dashes-along-boundaries animation; off by default (was distracting)
    arrowDensity:       5.0,    // sample spacing in degrees of arc
    arrowScale:         1.0,
    arrowColor:         '#ffffff',
    arrowThickness:     0.25,   // cross-section as fraction of length
    flowSpeed:          1.0,
    flowOpacity:        0.7,
```

In `buildAtlasGui`, delete the entire "Plate motion" folder block:

```js
    const fPlate = gui.addFolder('Plate motion');
    bindVis(fPlate.add(atlasTuning, 'plateMotionEnabled'));
    bindVis(fPlate.add(atlasTuning, 'arrowsEnabled'));
    bindVis(fPlate.add(atlasTuning, 'flowEnabled'));
    bindColor(fPlate.add(atlasTuning, 'arrowDensity', 2, 15, 0.5));
    bindColor(fPlate.add(atlasTuning, 'arrowScale',     0, 5, 0.05));
    bindColor(fPlate.add(atlasTuning, 'arrowThickness', 0.05, 1.0, 0.01));
    bindColor(fPlate.addColor(atlasTuning, 'arrowColor'));
    bindColor(fPlate.add(atlasTuning, 'flowSpeed',    0, 4, 0.05));
    bindColor(fPlate.add(atlasTuning, 'flowOpacity',  0, 1, 0.01));
```

- [ ] **Step 3: Drop the `build:no-plate-motion` script from `package.json`**

Delete this line from the `scripts` object:

```json
    "build:no-plate-motion": "rm -rf dist && bun build ./index.html --outdir=dist --minify --define 'process.env.ENABLE_PLATE_MOTION=\"false\"' && cp -R img dist/img",
```

(The `build:no-fluid` script stays for now — Task 3 removes it.)

- [ ] **Step 4: Delete the plate-motion modules and data**

```bash
rm src/plateMotion.js src/plateMotionMath.js src/plateMotionMath.test.js data/pb2002_poles.json
```

- [ ] **Step 5: Delete the orphaned inspect scripts**

```bash
rm scripts/inspect-plate-motion.js scripts/inspect-plate-wake.js scripts/inspect-pole.js
```

- [ ] **Step 6: Build-check the bundle**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds with no errors. (A failure here means an import to a deleted module slipped through.)

- [ ] **Step 7: Test-check (informational)**

```bash
bun test src/
```

Expected: 0 test files found, exit code 0. (`plateMotionMath.test.js` was the only test file; it's deleted now.)

- [ ] **Step 8: Manual smoke test**

Start the dev server: `bun run dev`. Open `http://localhost:3000/` in a browser. Confirm:
- Page loads with no console errors.
- Plate boundary lines render in their three color groups.
- No arrows anywhere; hovering boundaries reveals nothing.
- The "Plate motion" GUI folder is gone (Atlas panel, top-left).
- The bottom-of-screen `plateMotionDebug` overlay no longer appears.

Stop the dev server (Ctrl-C).

- [ ] **Step 9: Commit**

```bash
git add src/main.js src/atlasTuning.js package.json
git rm src/plateMotion.js src/plateMotionMath.js src/plateMotionMath.test.js data/pb2002_poles.json scripts/inspect-plate-motion.js scripts/inspect-plate-wake.js scripts/inspect-pole.js
git commit -m "$(cat <<'EOF'
simplify: remove plate-motion arrows + hover

Drops the entire arrow layer (InstancedMesh, hover raycast, marching
pulse, debug overlay, flow-dash toggle). Plate boundary lines stay,
since atlas.js owns those independently of plateMotion.js.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Remove heat-haze post-FX

**Files:**
- Modify: `src/main.js`
- Modify: `src/atlasTuning.js`
- Delete: `src/postFX.js`
- Delete: `scripts/inspect-haze.js`, `scripts/inspect-haze-orbit.js`

- [ ] **Step 1: Switch `src/main.js` to direct rendering**

Edit `src/main.js`. Remove the `buildPostFX` import:

```js
import { buildPostFX } from './postFX.js';
```

Delete that line.

Remove the `postFX` construction and resize listener:

```js
const postFX = buildPostFX({ renderer, scene, camera });
window.addEventListener('resize', () => postFX.setSize(window.innerWidth, window.innerHeight));
```

Delete those two lines.

In the animate loop, replace:

```js
    if (volFluid) volFluid.update(t);
    postFX.update(t);
    postFX.composer.render();
```

with:

```js
    if (volFluid) volFluid.update(t);
    renderer.render(scene, camera);
```

(The `volFluid` line stays — Task 3 removes it.)

- [ ] **Step 2: Strip the "Heat haze" section from `src/atlasTuning.js`**

Delete this block from `defaults`:

```js
    // Heat-haze post-FX (screen-space ripple over bottom strip)
    hazeAmount:      0.5,   // distortion magnitude (0–1)
    hazeHeight:      0.10,  // fraction of viewport from bottom that ripples
    hazeSpeed:       1.0,   // wave temporal scale
```

In `buildAtlasGui`, delete the entire "Heat haze" folder block:

```js
    const fHaze = gui.addFolder('Heat haze');
    bindColor(fHaze.add(atlasTuning, 'hazeAmount', 0, 1, 0.01));
    bindColor(fHaze.add(atlasTuning, 'hazeHeight', 0, 0.5, 0.01));
    bindColor(fHaze.add(atlasTuning, 'hazeSpeed', 0, 3, 0.05));
```

- [ ] **Step 3: Delete the post-FX module and inspect scripts**

```bash
rm src/postFX.js scripts/inspect-haze.js scripts/inspect-haze-orbit.js
```

- [ ] **Step 4: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

`bun run dev`. Reload page. Confirm:
- No console errors.
- The screen no longer shows heat-shimmer wobble around the centre when the camera orbits.
- Atlas GUI panel no longer has "Heat haze" folder.
- Earthquake markers and boundary lines render unchanged.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/atlasTuning.js
git rm src/postFX.js scripts/inspect-haze.js scripts/inspect-haze-orbit.js
git commit -m "$(cat <<'EOF'
simplify: remove heat-haze post-FX

Drops the EffectComposer pipeline (RenderPass + ShaderPass with the
core-tracking heat-shimmer). Renderer now draws scene directly, no
composer. The window-resize listener for postFX.setSize is gone too;
scene.js already handles camera aspect + renderer size on resize.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remove magma core orb + volumetric fluid + crust-rim glow

**Files:**
- Modify: `src/main.js`
- Modify: `src/atlas.js`
- Modify: `src/atlasTuning.js`
- Modify: `package.json`
- Delete: `src/core.js`, `src/coreVolFluid.js`
- Delete: `scripts/inspect-core.js`, `scripts/inspect-flame.js`, `scripts/inspect-falloff.js`, `scripts/inspect-volfluid.js`, `scripts/inspect-volfluid-debug.js`

- [ ] **Step 1: Strip core + fluid wiring from `src/main.js`**

Edit `src/main.js`. Remove the `loadCore` import:

```js
import { loadCore } from './core.js';
```

Delete that line.

Remove the `core` instantiation:

```js
const core = loadCore({ scene });
```

Delete that line.

Remove the magma-fluid dynamic-import block (including the long explanatory comment):

```js
// Magma volumetric fluid layer is a build-time-optional feature. The check
// references `process.env.ENABLE_MAGMA_FLUID` literally so Bun's `--define`
// substitutes it inline at this exact site — dead-code elimination then
// drops the if-branch *and* the dynamic import inside, keeping
// coreVolFluid.js out of the bundle entirely when disabled. Anything else
// (a constant in another module, a destructured alias, a getter) defeats
// the substitution and the module ends up bundled even when unreachable.
// Build with: `bun run build:no-fluid` (or set ENABLE_MAGMA_FLUID=false in
// the dev server env).
let volFluid = null;
if (process.env.ENABLE_MAGMA_FLUID !== 'false') {
    const { loadCoreVolFluid } = await import('./coreVolFluid.js');
    volFluid = loadCoreVolFluid({ scene, renderer, camera });
}
```

Delete the whole block.

In the animate loop, replace:

```js
    const t = clock.getElapsedTime();
    updateUniforms(t);
    core.update(t);
    if (volFluid) volFluid.update(t);
    renderer.render(scene, camera);
```

with:

```js
    updateUniforms(clock.getElapsedTime());
    renderer.render(scene, camera);
```

After this task `main.js` should match the final state shown in the appendix below.

- [ ] **Step 2: Strip core-rim glow uniforms from `src/atlas.js`**

Edit `src/atlas.js`. Replace the `crustVert` shader:

```js
const crustVert = /* glsl */`
    varying vec3 vN;
    varying vec3 vWorldPos;
    void main() {
        vN = normalize(position);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
```

with:

```js
const crustVert = /* glsl */`
    varying vec3 vN;
    void main() {
        vN = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
```

Replace the comment block + `crustFrag` shader (lines starting with `// Core glow:`):

```js
// Core glow: when the surface normal is grazing the camera (limb of the
// visible portion of the inner sphere), the inner core bleeds through.
// Rim term = pow(1 - |dot(normal, view)|, coreFalloff). Heat-haze
// distortion happens in screen-space (postFX.js), not in this shader.
const crustFrag = /* glsl */`
    precision highp float;
    uniform sampler2D mask;
    uniform vec3 oceanColor;
    uniform vec3 landColor;
    uniform vec3 antarcticaColor;
    uniform vec3 coreColor;
    uniform float coreIntensity;
    uniform float coreFalloff;
    varying vec3 vN;
    varying vec3 vWorldPos;

    void main() {
        float thetaDeg = degrees(atan(vN.z, vN.x));
        float u = (180.0 - thetaDeg) / 360.0;
        u = fract(u + 1.0);

        float lat = 90.0 - degrees(acos(clamp(vN.y, -1.0, 1.0)));
        float v = (90.0 - lat) / 180.0;

        float cat = texture2D(mask, vec2(u, v)).r;
        vec3 base = oceanColor;
        if (cat > 0.55) base = antarcticaColor;
        else if (cat > 0.20) base = landColor;

        vec3 worldNormal = normalize(vWorldPos);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(worldNormal, viewDir));
        float rim = pow(1.0 - ndv, coreFalloff);

        vec3 color = base + coreColor * rim * coreIntensity;
        gl_FragColor = vec4(color, 1.0);
    }
`;
```

with:

```js
// Crust shader: sample the rasterized land/antarctica/ocean mask and emit
// the corresponding tuning color. Branches on the category byte: ocean (0),
// land (~85), antarctica (~170).
const crustFrag = /* glsl */`
    precision highp float;
    uniform sampler2D mask;
    uniform vec3 oceanColor;
    uniform vec3 landColor;
    uniform vec3 antarcticaColor;
    varying vec3 vN;

    void main() {
        float thetaDeg = degrees(atan(vN.z, vN.x));
        float u = (180.0 - thetaDeg) / 360.0;
        u = fract(u + 1.0);

        float lat = 90.0 - degrees(acos(clamp(vN.y, -1.0, 1.0)));
        float v = (90.0 - lat) / 180.0;

        float cat = texture2D(mask, vec2(u, v)).r;
        vec3 color = oceanColor;
        if (cat > 0.55) color = antarcticaColor;
        else if (cat > 0.20) color = landColor;

        gl_FragColor = vec4(color, 1.0);
    }
`;
```

Replace the `crustMat` uniforms block:

```js
    const crustMat = new ShaderMaterial({
        uniforms: {
            mask:            { value: maskTex },
            oceanColor:      { value: new Color(atlasTuning.oceanColor) },
            landColor:       { value: new Color(atlasTuning.showLand ? atlasTuning.landColor : atlasTuning.oceanColor) },
            antarcticaColor: { value: new Color(atlasTuning.showLand ? atlasTuning.antarcticaColor : atlasTuning.oceanColor) },
            coreColor:       { value: new Color(atlasTuning.coreColor) },
            coreIntensity:   { value: atlasTuning.coreIntensity },
            coreFalloff:     { value: atlasTuning.coreFalloff },
        },
        vertexShader: crustVert,
        fragmentShader: crustFrag,
        side: DoubleSide,
    });
```

with:

```js
    const crustMat = new ShaderMaterial({
        uniforms: {
            mask:            { value: maskTex },
            oceanColor:      { value: new Color(atlasTuning.oceanColor) },
            landColor:       { value: new Color(atlasTuning.showLand ? atlasTuning.landColor : atlasTuning.oceanColor) },
            antarcticaColor: { value: new Color(atlasTuning.showLand ? atlasTuning.antarcticaColor : atlasTuning.oceanColor) },
        },
        vertexShader: crustVert,
        fragmentShader: crustFrag,
        side: DoubleSide,
    });
```

In `applyColors`, remove the three lines that set the rim uniforms:

```js
        crustMat.uniforms.coreColor.value.set(t.coreColor);
        crustMat.uniforms.coreIntensity.value = t.coreIntensity;
        crustMat.uniforms.coreFalloff.value = t.coreFalloff;
```

Delete those three lines.

- [ ] **Step 3: Strip the three core/fluid sections from `src/atlasTuning.js`**

In `defaults`, delete the legacy "Core glow" sliders:

```js
    coreColor:       '#ff3008',
    coreIntensity:   0.35,
    coreFalloff:     2.0,
```

Delete these three lines.

In `defaults`, delete the "Magma core (real 3D orb at origin)" block:

```js
    // Magma core (real 3D orb at origin)
    coreEnabled:     true,
    coreRadius:      4500,    // km. Camera sits at ~5800; this fills the lower viewport.
    coreBrightness:  1.0,
    coreSpeed:       1.0,     // animation rate
    coreHotColor:    '#ffd060', // peaks of magma flow
    coreCoolColor:   '#a01a08', // troughs
    coreRimBoost:    0.6,     // fresnel rim brightness multiplier
```

In `defaults`, delete the "Magma volumetric fluid" block:

```js
    // Magma volumetric fluid layer (Stam-style 2D sim + raymarched shell).
    // Disabled at build time via `bun run build:no-fluid`.
    fluidEnabled:    true,
    fluidIntensity:  1.0,     // raymarcher emission master multiplier
    fluidBuoyancy:   3.0,     // dye→velocity force; higher = faster rising plumes
    fluidDecay:      0.32,    // dye dissipation per second
    fluidSpawnRate:  3.2,     // average new hot spots per second
```

In `buildAtlasGui`, delete the "Core glow" folder:

```js
    const fCore = gui.addFolder('Core glow');
    bindColor(fCore.addColor(atlasTuning, 'coreColor'));
    bindColor(fCore.add(atlasTuning, 'coreIntensity', 0, 2, 0.01));
    bindColor(fCore.add(atlasTuning, 'coreFalloff', 0.25, 4, 0.05).name('coreFalloff (lower = wider)'));
```

In `buildAtlasGui`, delete the "Magma core" folder:

```js
    const fCoreOrb = gui.addFolder('Magma core');
    bindVis(fCoreOrb.add(atlasTuning, 'coreEnabled'));
    bindColor(fCoreOrb.add(atlasTuning, 'coreRadius', 500, 5000, 50));
    bindColor(fCoreOrb.add(atlasTuning, 'coreBrightness', 0, 3, 0.01));
    bindColor(fCoreOrb.add(atlasTuning, 'coreSpeed', 0, 3, 0.05));
    bindColor(fCoreOrb.add(atlasTuning, 'coreRimBoost', 0, 2, 0.01));
    bindColor(fCoreOrb.addColor(atlasTuning, 'coreHotColor'));
    bindColor(fCoreOrb.addColor(atlasTuning, 'coreCoolColor'));
```

In `buildAtlasGui`, delete the "Magma fluid" folder:

```js
    const fFluid = gui.addFolder('Magma fluid');
    bindVis(fFluid.add(atlasTuning, 'fluidEnabled'));
    bindColor(fFluid.add(atlasTuning, 'fluidIntensity', 0, 3, 0.05));
    bindColor(fFluid.add(atlasTuning, 'fluidBuoyancy', 0, 6, 0.1));
    bindColor(fFluid.add(atlasTuning, 'fluidDecay', 0.05, 1.0, 0.01));
    bindColor(fFluid.add(atlasTuning, 'fluidSpawnRate', 0, 10, 0.1));
```

After this step, `src/atlasTuning.js` should match the final state shown in the appendix below.

- [ ] **Step 4: Drop the `build:no-fluid` script from `package.json`**

Delete this line from the `scripts` object:

```json
    "build:no-fluid": "rm -rf dist && bun build ./index.html --outdir=dist --minify --define 'process.env.ENABLE_MAGMA_FLUID=\"false\"' && cp -R img dist/img",
```

After this step, `package.json` `scripts` should contain only `dev`, `build`, `prep-data`.

- [ ] **Step 5: Delete the core/fluid modules and inspect scripts**

```bash
rm src/core.js src/coreVolFluid.js
rm scripts/inspect-core.js scripts/inspect-flame.js scripts/inspect-falloff.js scripts/inspect-volfluid.js scripts/inspect-volfluid-debug.js
```

- [ ] **Step 6: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds.

- [ ] **Step 7: Manual smoke test**

`bun run dev`. Reload page. Confirm:
- No console errors.
- The centre of the planet is empty — no magma orb, no fluid plumes.
- The inner crust limb has no warm rim glow when looking through (when the camera is positioned so the crust silhouette is visible from the inside).
- Atlas GUI panel no longer has "Core glow", "Magma core", or "Magma fluid" folders.
- Earthquake markers and boundary lines render unchanged.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/main.js src/atlas.js src/atlasTuning.js package.json
git rm src/core.js src/coreVolFluid.js scripts/inspect-core.js scripts/inspect-flame.js scripts/inspect-falloff.js scripts/inspect-volfluid.js scripts/inspect-volfluid-debug.js
git commit -m "$(cat <<'EOF'
simplify: remove magma core orb, fluid layer, crust rim glow

Drops the 3D magma orb at the origin, the volumetric-fluid raymarched
shell, and the legacy core-rim glow baked into the crust shader. With
no magma source, the rim term has no motivation. Also drops the
build:no-fluid script — the env-flag conditional is gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remove earthquake ripple rings

**Files:**
- Modify: `src/markers.js`
- Modify: `src/tuning.js`

- [ ] **Step 1: Replace `src/markers.js` with the ring-stripped version**

Replace the entire contents of `src/markers.js` with:

```js
// src/markers.js — blob shader, marker factory, per-frame uniform update.
import {
    Object3D,
    Mesh,
    IcosahedronGeometry,
    ShaderMaterial,
    Color,
} from 'three';

import { tuning } from './tuning.js';

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
        _blob: blob,
    };

    allMarkers.push(marker);
    return marker;
}

export function updateUniforms(time) {
    if (!allMarkers.length) return;
    for (const m of allMarkers) {
        m.visible = !!tuning.visible;

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
    }
}
```

- [ ] **Step 2: Replace `src/tuning.js` with the ring-stripped version**

Replace the entire contents of `src/tuning.js` with:

```js
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
    // Color
    emberHex: '#ffeebb',
    midHex: '#ff7733',
    cyanHex: '#22ccff',
    depthNormKm: 300,
    // Globals
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

    const fColor = gui.addFolder('Color');
    bind(fColor.addColor(tuning, 'emberHex'));
    bind(fColor.addColor(tuning, 'midHex'));
    bind(fColor.addColor(tuning, 'cyanHex'));
    bind(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));

    const fGlobals = gui.addFolder('Globals');
    bind(fGlobals.add(tuning, 'visible'));
    fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
    fGlobals.add({
        reset: () => {
            for (const k in defaults) tuning[k] = defaults[k];
            save();
            allControllers.forEach(c => c.updateDisplay());
        },
    }, 'reset').name('Reset to defaults');
}
```

- [ ] **Step 3: Build-check**

```bash
bun build ./index.html --outdir=/tmp/eq-build-check
rm -rf /tmp/eq-build-check
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke test**

`bun run dev`. Reload page. Confirm:
- No console errors.
- Earthquake markers still appear as deforming icosahedron blobs.
- No expanding ring "ping" effects radiate from any marker.
- Marker tuning panel (top-right) no longer has "Rings" folder.
- Marker colors still vary by depth (ember → orange → cyan).

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/markers.js src/tuning.js
git commit -m "$(cat <<'EOF'
simplify: remove earthquake ripple rings

Drops the expanding ring shaders (ringVert/ringFrag), the per-marker
ring meshes, the orient-to-surface logic, and all ring-related tuning
controls. Markers are now just the deforming blob, colored by depth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final verification

**Files:** None modified. This task confirms the cumulative result and catches any regression introduced across the four removals.

- [ ] **Step 1: Verify the final `src/main.js` matches the appendix**

Open `src/main.js` and confirm it matches the file shown in the appendix below verbatim. If it doesn't, reconcile against the appendix (the appendix is authoritative).

- [ ] **Step 2: Production build check**

```bash
bun run build
```

Expected: build succeeds and produces `dist/`. No warnings about missing modules.

```bash
ls dist/
```

Expected: `index.html`, `*.js` bundles, `img/` directory. No references to removed modules in the bundle.

- [ ] **Step 3: Comprehensive manual smoke test**

`bun run dev`. Reload page with localStorage cleared (`localStorage.clear(); location.reload();` in console — to confirm no stale-key issues), then again with localStorage populated (browser default). For each load, confirm all spec acceptance criteria:
- Earthquake markers appear as deforming blobs (no expanding rings).
- Plate boundary lines render with their three color groups (ridges purple, transforms orange, subduction violet); no arrows visible anywhere; hovering a line does nothing extra.
- The center of the planet is empty (no orb, no fluid, no rim glow on the inner crust limb).
- No screen-space wobble around the centre when the camera orbits (no haze).
- Both GUI panels open without errors. Marker panel (top-right) folders: Blob, Color, Globals. Atlas panel (top-left) folders: Colors, Geometry, Visibility.
- Browser console is clean of errors and warnings.

Stop the dev server.

- [ ] **Step 4: Branch summary commit (only if any fixes applied)**

If the verification surfaced no issues, skip this step. If it surfaced something missed (e.g., a stray import to a deleted module, a leftover `core.update` call), fix it inline and commit:

```bash
git add -A
git commit -m "simplify: fix-up after final smoke test"
```

---

## Appendix — final file states (post all tasks)

These are the authoritative final states for files modified in multiple tasks. After Task 4, the working tree should match these.

### `src/main.js` (final)

```js
// src/main.js — entry. Wires scene, controls, feed, markers, tuning, detail.
import { Clock } from 'three';
import { createScene, CRUST_RADIUS } from './scene.js';
import { buildGui } from './tuning.js';
import { loadEarthquakes, geoToVec3 } from './feed.js';
import { createBlobMarker, updateUniforms, getAllMarkers } from './markers.js';
import { attachControls } from './controls.js';
import { showDetail, hideDetail } from './detail.js';
import { atlasTuning, buildAtlasGui } from './atlasTuning.js';
import { loadAtlas } from './atlas.js';

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    document.body.innerHTML = '<p style="color:#fff;font:14px sans-serif;padding:20px">WebGL is required.</p>';
    throw new Error('no webgl');
}

const eqScene = document.getElementById('eqScene');
const { scene, camera, camGroup, renderer } = createScene(eqScene);
buildGui();
buildAtlasGui();
const atlas = loadAtlas({ scene, radius: CRUST_RADIUS });
const crust = atlas.crust;

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

if (typeof window !== 'undefined') {
    window.__eqDebug = { scene, camera, camGroup, geoToVec3, atlasTuning };
}
```

### `src/atlasTuning.js` (final)

```js
// src/atlasTuning.js — atlas styling state + lil-gui panel + persistence.
import GUI from 'lil-gui';

const STORAGE_KEY = 'eq-atlas-tuning';

const defaults = {
    // Colors
    oceanColor:      '#0a1428',
    landColor:       '#3e5d8a',
    antarcticaColor: '#9aa8c5',
    ridgeColor:      '#d840ff', // OSR, CRB
    subColor:        '#6020c0', // OCB, CCB, SUB
    transformColor:  '#f0c060', // OTF, CTF
    otherColor:      '#ffffff',
    otherAlpha:      0.18,
    // Geometry
    boundaryWidth:   1.0,
    // Visibility
    showLand:        true,
    showBoundaries:  true,
};

function loadStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

const stored = loadStored();
export const atlasTuning = {};
for (const k in defaults) atlasTuning[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : defaults[k];

function save() {
    try {
        const snap = {};
        for (const k in defaults) snap[k] = atlasTuning[k];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (e) {}
}

const colorListeners = [];
const visibilityListeners = [];

export function onAtlasColorChange(cb)      { colorListeners.push(cb); }
export function onAtlasVisibilityChange(cb) { visibilityListeners.push(cb); }

function fireColors() {
    for (const cb of colorListeners) {
        try { cb(atlasTuning); } catch (e) { console.error('atlasTuning color listener:', e); }
    }
}
function fireVisibility() {
    for (const cb of visibilityListeners) {
        try { cb(atlasTuning); } catch (e) { console.error('atlasTuning visibility listener:', e); }
    }
}

export function buildAtlasGui() {
    const gui = new GUI({ width: 300, title: 'Atlas' });
    // Default lil-gui placement is top-right; the marker-tuning panel
    // (tuning.js) lives there. Move this one to top-left so they don't
    // overlap or fight for cursor space.
    gui.domElement.style.left  = '0';
    gui.domElement.style.right = 'auto';

    const allControllers = [];
    const bindColor = (ctl) => { ctl.onChange(() => { save(); fireColors(); }); allControllers.push(ctl); return ctl; };
    const bindVis   = (ctl) => { ctl.onChange(() => { save(); fireVisibility(); }); allControllers.push(ctl); return ctl; };

    const fColors = gui.addFolder('Colors');
    bindColor(fColors.addColor(atlasTuning, 'oceanColor'));
    bindColor(fColors.addColor(atlasTuning, 'landColor'));
    bindColor(fColors.addColor(atlasTuning, 'antarcticaColor'));
    bindColor(fColors.addColor(atlasTuning, 'ridgeColor'));
    bindColor(fColors.addColor(atlasTuning, 'subColor'));
    bindColor(fColors.addColor(atlasTuning, 'transformColor'));
    bindColor(fColors.addColor(atlasTuning, 'otherColor'));
    bindColor(fColors.add(atlasTuning, 'otherAlpha', 0, 1, 0.01));

    const fGeom = gui.addFolder('Geometry');
    bindColor(fGeom.add(atlasTuning, 'boundaryWidth', 0, 12, 0.1));

    const fVis = gui.addFolder('Visibility');
    bindVis(fVis.add(atlasTuning, 'showLand'));
    bindVis(fVis.add(atlasTuning, 'showBoundaries'));

    gui.add({
        reset: () => {
            for (const k in defaults) atlasTuning[k] = defaults[k];
            save();
            allControllers.forEach((c) => c.updateDisplay());
            fireColors();
            fireVisibility();
        },
    }, 'reset').name('Reset atlas');
}
```

### `package.json` (final `scripts` section)

```json
  "scripts": {
    "dev": "bun run dev.js",
    "build": "rm -rf dist && bun build ./index.html --outdir=dist --minify && cp -R img dist/img",
    "prep-data": "bun run scripts/prep-atlas-data.js"
  },
```

---

## Self-review notes

- **Spec coverage:** Every removal in the spec maps to a task. Magma core / fluid / crust rim glow → Task 3. Heat haze → Task 2. Plate motion arrows + hover → Task 1. Earthquake rings → Task 4. Stale localStorage → addressed via "no migration needed" note in spec, no code change required (load loop already filters by current `defaults` keys). Manual smoke test from spec → Task 5.
- **Placeholder scan:** None. Every Edit step shows literal old/new content. Every shell command is exact. Every commit message is fully written.
- **Type/symbol consistency:** Edits remove symbols rather than rename them, so consistency concerns are minimal. Where the same file is touched in multiple tasks (`main.js`, `atlasTuning.js`), the appendix shows the final authoritative state.
- **Task ordering safety:** Each task edits the consumer (`main.js`) first, then deletes orphaned modules, so build never breaks at a checkpoint.
