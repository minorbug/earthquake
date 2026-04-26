# Blobby Pulse Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing earthquake markers (low-poly sphere + spark.png sprite) with animated blobby cores + surface-tangent pulse rings, plus a `dat.GUI` panel for live tuning of all visual parameters.

**Architecture:** Two new ES5 globals-style modules (`js/markers.js`, `js/tuning.js`) sit alongside `js/main.js`. `tuning.js` owns the dat.GUI panel and a global `tuning` object. `markers.js` owns the shaders and `createBlobMarker(data)` factory used by `main.js` in place of the old `createMarker`. Per-frame `time` uniform is pushed to all markers from the existing `render()` loop.

**Tech Stack:** three.js r64 (already in repo), dat.GUI (vendored), vanilla ES5, no bundler, no test framework.

**Testing note:** This codebase has no automated test framework and the work is purely visual. Each task ends with a **manual visual verification** step served via `python3 -m http.server` against the project root (file:// breaks WebGL textures — see project history). Treat the verification step as the "make the test pass" gate before committing.

**Reference spec:** `docs/superpowers/specs/2026-04-26-blobby-pulse-markers-design.md`

---

## File Structure

| File | Status | Purpose |
|------|--------|---------|
| `index.html` | modify | Add `<script>` tags for `dat.gui.min.js`, `tuning.js`, `markers.js`. |
| `js/vendor/dat.gui.min.js` | create | Vendored dat.GUI 0.7.9 (last standalone release before npm-only). |
| `js/tuning.js` | create | dat.GUI panel + `window.tuning` object + localStorage persist + Copy-as-JSON. |
| `js/markers.js` | create | Shader sources, `createBlobMarker(data)`, `updateMarkerUniforms(time)`, `colorForDepth(d)`. |
| `js/main.js` | modify | Swap `createMarker` → `createBlobMarker`; advance time uniform each frame; widen click raycast filter. |

---

## Task 1: Vendor dat.GUI

**Files:**
- Create: `js/vendor/dat.gui.min.js`
- Modify: `index.html` (add script tag in `<body>` before `js/main.js`)

- [ ] **Step 1: Download dat.GUI 0.7.9**

Run from project root:

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/dat.gui@0.7.9/build/dat.gui.min.js -o js/vendor/dat.gui.min.js
```

Expected: file ~120 KB, exit 0.

- [ ] **Step 2: Verify file is JavaScript, not HTML**

```bash
head -c 200 js/vendor/dat.gui.min.js
```

Expected: starts with `/**` or minified JS — NOT `<!DOCTYPE html>`. If HTML, the CDN failed; try `https://unpkg.com/dat.gui@0.7.9/build/dat.gui.min.js`.

- [ ] **Step 3: Add script tag to index.html**

In `index.html`, insert this line **immediately before** `<script src="js/main.js"></script>`:

```html
    <script src="js/vendor/dat.gui.min.js"></script>
    <script src="js/tuning.js"></script>
    <script src="js/markers.js"></script>
```

- [ ] **Step 4: Visual verification**

Start server (leave running for the rest of the plan):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Open devtools console.

Expected:
- Page loads, globe renders.
- Console shows no 404s.
- Typing `dat` in console returns the dat.GUI namespace object.
- `tuning.js` and `markers.js` will 404 — that's fine for this task only.

- [ ] **Step 5: Commit**

```bash
git add js/vendor/dat.gui.min.js index.html
git commit -m "Vendor dat.GUI 0.7.9 + add script tags for tuning/markers modules"
```

---

## Task 2: Create empty tuning.js + markers.js stubs (kill 404s)

**Files:**
- Create: `js/tuning.js`
- Create: `js/markers.js`

- [ ] **Step 1: Create `js/tuning.js`**

```javascript
// tuning.js — dat.GUI panel + global tuning object. Filled in later tasks.
(function () {
    window.tuning = {};
})();
```

- [ ] **Step 2: Create `js/markers.js`**

```javascript
// markers.js — shaders + blob marker factory. Filled in later tasks.
(function () {
    window.Markers = {};
})();
```

- [ ] **Step 3: Visual verification**

Reload `http://localhost:8000/`.

Expected:
- No 404s in Network tab.
- Console: `tuning` and `Markers` are defined globals.

- [ ] **Step 4: Commit**

```bash
git add js/tuning.js js/markers.js
git commit -m "Stub tuning + markers modules"
```

---

## Task 3: Build the `tuning` object with defaults + dat.GUI panel

**Files:**
- Modify: `js/tuning.js`

- [ ] **Step 1: Replace `js/tuning.js` with the full panel**

```javascript
// tuning.js — owns window.tuning + dat.GUI panel + localStorage persistence.
(function () {
    var STORAGE_KEY = 'eq-marker-tuning';

    var defaults = {
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
        midHex:   '#ff7733',
        cyanHex:  '#22ccff',
        depthNormKm: 300,
        // Globals
        ringCount: 3,
        visible: true
    };

    function loadStored() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch (e) { return {}; }
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning)); } catch (e) {}
    }

    var stored = loadStored();
    var tuning = {};
    for (var k in defaults) tuning[k] = stored.hasOwnProperty(k) ? stored[k] : defaults[k];

    var ringCountListeners = [];
    tuning.onRingCountChange = function (cb) { ringCountListeners.push(cb); };

    function copyJson() {
        var snapshot = {};
        for (var k in defaults) snapshot[k] = tuning[k];
        var json = JSON.stringify(snapshot, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json);
        } else {
            // Fallback
            var ta = document.createElement('textarea');
            ta.value = json;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
        }
        console.log('Tuning JSON copied:\n' + json);
    }

    function buildGui() {
        var gui = new dat.GUI({ width: 300 });

        function bindSave(controller) {
            controller.onChange(save);
            return controller;
        }

        var fBlob = gui.addFolder('Blob');
        bindSave(fBlob.add(tuning, 'radiusMin',    5,  200));
        bindSave(fBlob.add(tuning, 'radiusMax',   50,  400));
        bindSave(fBlob.add(tuning, 'deformAmpMin', 0,    1, 0.01));
        bindSave(fBlob.add(tuning, 'deformAmpMax', 0,    1, 0.01));
        bindSave(fBlob.add(tuning, 'pulseHzMin',   0,    3, 0.05));
        bindSave(fBlob.add(tuning, 'pulseHzMax',   0,    5, 0.05));
        fBlob.open();

        var fRings = gui.addFolder('Rings');
        bindSave(fRings.add(tuning, 'maxReachMin',     1,  20, 0.1));
        bindSave(fRings.add(tuning, 'maxReachMax',     1,  30, 0.1));
        bindSave(fRings.add(tuning, 'cycleSec',      0.5,   8, 0.1));
        bindSave(fRings.add(tuning, 'alphaExp',      0.5,   3, 0.05));
        bindSave(fRings.add(tuning, 'thicknessFrac', 0.02, 0.3, 0.005));
        bindSave(fRings.add(tuning, 'thicknessFalloff', 0,   1, 0.01));
        fRings.open();

        var fColor = gui.addFolder('Color');
        bindSave(fColor.addColor(tuning, 'emberHex'));
        bindSave(fColor.addColor(tuning, 'midHex'));
        bindSave(fColor.addColor(tuning, 'cyanHex'));
        bindSave(fColor.add(tuning, 'depthNormKm', 50, 1000, 10));
        fColor.open();

        var fGlobals = gui.addFolder('Globals');
        var ringCtl = fGlobals.add(tuning, 'ringCount', 1, 6, 1);
        ringCtl.onChange(function (v) {
            save();
            for (var i = 0; i < ringCountListeners.length; i++) ringCountListeners[i](v);
        });
        bindSave(fGlobals.add(tuning, 'visible'));
        fGlobals.add({ copyAsJson: copyJson }, 'copyAsJson').name('Copy as JSON');
        fGlobals.open();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildGui);
    } else {
        buildGui();
    }

    window.tuning = tuning;
})();
```

- [ ] **Step 2: Visual verification**

Reload `http://localhost:8000/`.

Expected:
- dat.GUI panel docks top-right with folders **Blob**, **Rings**, **Color**, **Globals**, all open.
- All sliders move; color pickers open swatches; **Copy as JSON** button visible.
- Click Copy as JSON → console logs the snapshot.
- Move a slider, refresh the page → slider keeps its new value (localStorage works).

- [ ] **Step 3: Commit**

```bash
git add js/tuning.js
git commit -m "Add dat.GUI tuning panel with defaults, persistence, copy-as-JSON"
```

---

## Task 4: Color helper + shared shader sources in markers.js

**Files:**
- Modify: `js/markers.js`

- [ ] **Step 1: Replace `js/markers.js` with the helpers + shader source**

```javascript
// markers.js — shaders, color helpers, blob marker factory.
(function () {

    function hexToRgb(hex) {
        var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return { r: 1, g: 1, b: 1 };
        return {
            r: parseInt(m[1], 16) / 255,
            g: parseInt(m[2], 16) / 255,
            b: parseInt(m[3], 16) / 255
        };
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function lerpRgb(c1, c2, t) {
        return {
            r: lerp(c1.r, c2.r, t),
            g: lerp(c1.g, c2.g, t),
            b: lerp(c1.b, c2.b, t)
        };
    }

    // 3-stop gradient: ember (0) → mid (0.5) → cyan (1)
    function colorForDepth(depthKm) {
        var t = Math.max(0, Math.min(1, depthKm / window.tuning.depthNormKm));
        var ember = hexToRgb(window.tuning.emberHex);
        var mid   = hexToRgb(window.tuning.midHex);
        var cyan  = hexToRgb(window.tuning.cyanHex);
        return t < 0.5
            ? lerpRgb(ember, mid, t * 2)
            : lerpRgb(mid, cyan, (t - 0.5) * 2);
    }

    // ----- Blob shader (positions are unit-sphere; mesh.scale carries radius) -----
    var blobVert = [
        'uniform float time;',
        'uniform float phaseSeed;',
        'uniform float deformAmp;',
        'uniform float pulseHz;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float ph = time * pulseHz + phaseSeed;',
        '  float d = (sin(ph + 6.0 * position.x)',
        '           + sin(ph * 1.3 + 4.0 * position.y)',
        '           + sin(ph * 0.7 + 5.0 * position.z)) / 3.0;',
        '  vec3 displaced = position + normal * deformAmp * d;',
        '  vNormal = normalize(normalMatrix * normal);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);',
        '}'
    ].join('\n');

    var blobFrag = [
        'uniform vec3 color;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 1.5);',
        '  vec3 c = color + vec3(rim) * 0.4;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
    ].join('\n');

    window.Markers = {
        colorForDepth: colorForDepth,
        hexToRgb: hexToRgb,
        blobVert: blobVert,
        blobFrag: blobFrag
    };

})();
```

- [ ] **Step 2: Visual verification**

Reload page. Console:

```js
Markers.colorForDepth(0)    // ≈ {r:1, g:0.93, b:0.73}  (ember)
Markers.colorForDepth(150)  // ≈ {r:1, g:0.47, b:0.2}   (mid)
Markers.colorForDepth(300)  // ≈ {r:0.13, g:0.8, b:1}   (cyan)
Markers.colorForDepth(9999) // clamps to cyan
```

Expected: values in those ranges. No errors.

- [ ] **Step 3: Commit**

```bash
git add js/markers.js
git commit -m "Add colorForDepth + blob shader source to markers module"
```

---

## Task 5: Implement `createBlobMarker` (blob only, no rings yet)

**Files:**
- Modify: `js/markers.js`

- [ ] **Step 1: Append the factory + uniform-update helpers to `js/markers.js`**

Inside the IIFE, **before** the final `window.Markers = ...` line, add:

```javascript
    var allMarkers = [];

    function makeBlobMaterial(magnitude, depth, phaseSeed) {
        var mNorm = Math.max(0, Math.min(1, (magnitude - 4.5) / 4.5));
        var deform = lerp(window.tuning.deformAmpMin, window.tuning.deformAmpMax, mNorm);
        var hz     = lerp(window.tuning.pulseHzMin, window.tuning.pulseHzMax, mNorm);
        var c      = colorForDepth(depth);

        return new THREE.ShaderMaterial({
            uniforms: {
                time:      { type: 'f', value: 0 },
                phaseSeed: { type: 'f', value: phaseSeed },
                deformAmp: { type: 'f', value: deform },
                pulseHz:   { type: 'f', value: hz },
                color:     { type: 'v3', value: new THREE.Vector3(c.r, c.g, c.b) }
            },
            vertexShader: blobVert,
            fragmentShader: blobFrag
        });
    }

    function createBlobMarker(data) {
        var marker = new THREE.Object3D();
        var phaseSeed = Math.random() * 6.28318;
        var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
        var radius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);

        var blobMat = makeBlobMaterial(data.magnitude, data.depth, phaseSeed);
        var blobGeo = new THREE.IcosahedronGeometry(1, 2);
        var blob = new THREE.Mesh(blobGeo, blobMat);
        blob.scale.set(radius, radius, radius);
        blob.userData = data;
        blob.userData._kind = 'blob';
        marker.add(blob);

        marker.userData = data;
        marker.userData._phaseSeed = phaseSeed;
        marker.userData._blob = blob;
        marker.userData._rings = []; // populated in Task 6

        allMarkers.push(marker);
        return marker;
    }

    function updateMarkerUniforms(time) {
        if (!allMarkers.length) return;
        for (var i = 0, l = allMarkers.length; i < l; i++) {
            var m = allMarkers[i];
            m.visible = !!window.tuning.visible;

            var blob = m.userData._blob;
            if (blob) {
                var u = blob.material.uniforms;
                u.time.value = time;

                // Re-evaluate per-marker derived values from current tuning
                var data = m.userData;
                var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
                var radius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);
                blob.scale.set(radius, radius, radius);
                u.deformAmp.value = lerp(window.tuning.deformAmpMin, window.tuning.deformAmpMax, mNorm);
                u.pulseHz.value   = lerp(window.tuning.pulseHzMin, window.tuning.pulseHzMax, mNorm);
                var c = colorForDepth(data.depth);
                u.color.value.set(c.r, c.g, c.b);
            }
        }
    }
```

- [ ] **Step 2: Update the `window.Markers` export**

Replace the final export block in `js/markers.js` with:

```javascript
    window.Markers = {
        colorForDepth: colorForDepth,
        hexToRgb: hexToRgb,
        blobVert: blobVert,
        blobFrag: blobFrag,
        createBlobMarker: createBlobMarker,
        updateMarkerUniforms: updateMarkerUniforms,
        allMarkers: allMarkers
    };
```

- [ ] **Step 3: Wire `createBlobMarker` into `main.js`**

In `js/main.js`, find `addMarkerToCrust` (around line 142):

```javascript
    function addMarkerToCrust(crustModel,data){

        var marker = createMarker(data);
        markers.push(marker);
        ...
```

Change `createMarker(data)` to `Markers.createBlobMarker(data)`:

```javascript
    function addMarkerToCrust(crustModel,data){

        var marker = Markers.createBlobMarker(data);
        markers.push(marker);
        ...
```

- [ ] **Step 4: Push time to markers each frame**

In `js/main.js`, find the `render()` function (around line 119). After `scene.updateMatrixWorld();` add:

```javascript
        Markers.updateMarkerUniforms(clock.getElapsedTime());
```

- [ ] **Step 5: Visual verification**

Reload `http://localhost:8000/`.

Expected:
- Old sphere markers replaced by new orange-cyan blobs visibly pulsing/warping.
- Bigger quakes (mag 6+) pulse faster + are larger.
- Deeper quakes (depth > 200km) tinted toward cyan.
- Move `radiusMin`/`radiusMax` sliders → all blobs grow/shrink instantly.
- Move `deformAmp` sliders → blobs warp more/less.
- Toggle **visible** off → blobs disappear.
- Click on a blob → detail panel may NOT open yet (raycast still expects sprites — fixed in Task 9). That's OK.

- [ ] **Step 6: Commit**

```bash
git add js/markers.js js/main.js
git commit -m "Replace sphere/sprite markers with shader-driven blob cores"
```

---

## Task 6: Add ring shader + ring meshes (camera-facing for now)

We start with billboard rings to verify the ring lifecycle, then orient them tangent to the surface in Task 7.

**Files:**
- Modify: `js/markers.js`

- [ ] **Step 1: Add ring shader source**

Inside the IIFE in `js/markers.js`, after the `blobFrag` definition, add:

```javascript
    var ringVert = [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');

    var ringFrag = [
        'uniform float time;',
        'uniform float phaseOffset;',
        'uniform float cycleSec;',
        'uniform float alphaExp;',
        'uniform float thicknessFrac;',
        'uniform float thicknessFalloff;',
        'uniform vec3  color;',
        'varying vec2 vUv;',
        'void main() {',
        '  float t = mod(time + phaseOffset, cycleSec) / cycleSec;', // 0..1
        '  // distance from center of unit-disk geometry, 0..1
        '  float r = length(vUv - vec2(0.5)) * 2.0;',
        '  // ring expands: target radius is t (in unit-disk coordinates)
        '  float thick = thicknessFrac * mix(1.0, thicknessFalloff, t);',
        '  float band = 1.0 - smoothstep(0.0, thick, abs(r - t));',
        '  float alpha = band * pow(1.0 - t, alphaExp);',
        '  // additive softening as it expands
        '  alpha *= mix(1.0, 0.6, t);',
        '  if (alpha < 0.01) discard;',
        '  gl_FragColor = vec4(color, alpha);',
        '}'
    ].join('\n');
```

(Note: GLSL line comments inside JS string array — keep as-is, the runtime sees them after `.join('\n')`.)

- [ ] **Step 2: Add ring factory inside the IIFE**

After `makeBlobMaterial`, add:

```javascript
    function makeRingMaterial(magnitude, depth, phaseOffset) {
        var c = colorForDepth(depth);
        return new THREE.ShaderMaterial({
            uniforms: {
                time:             { type: 'f', value: 0 },
                phaseOffset:      { type: 'f', value: phaseOffset },
                cycleSec:         { type: 'f', value: window.tuning.cycleSec },
                alphaExp:         { type: 'f', value: window.tuning.alphaExp },
                thicknessFrac:    { type: 'f', value: window.tuning.thicknessFrac },
                thicknessFalloff: { type: 'f', value: window.tuning.thicknessFalloff },
                color:            { type: 'v3', value: new THREE.Vector3(c.r, c.g, c.b) }
            },
            vertexShader: ringVert,
            fragmentShader: ringFrag,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
    }

    function buildRingsForMarker(marker) {
        // Remove old rings
        var oldRings = marker.userData._rings || [];
        for (var i = 0; i < oldRings.length; i++) marker.remove(oldRings[i]);

        var data = marker.userData;
        var count = window.tuning.ringCount | 0;
        var rings = [];
        var dNorm = Math.max(0, Math.min(1, data.depth / window.tuning.depthNormKm));
        var mNorm = Math.max(0, Math.min(1, (data.magnitude - 4.5) / 4.5));
        var blobRadius = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm);
        var maxRadius  = lerp(window.tuning.maxReachMin, window.tuning.maxReachMax, dNorm) * blobRadius;

        for (var i = 0; i < count; i++) {
            var phaseOff = (window.tuning.cycleSec * i) / count;
            var mat = makeRingMaterial(data.magnitude, data.depth, phaseOff);
            // Plane disk geometry, unit-radius (scaled by mesh scale)
            var geo = new THREE.PlaneGeometry(2, 2, 1, 1); // -1..1 in x and y; uv 0..1
            var ring = new THREE.Mesh(geo, mat);
            ring.scale.set(maxRadius, maxRadius, maxRadius);
            ring.userData._kind = 'ring';
            marker.add(ring);
            rings.push(ring);
        }
        marker.userData._rings = rings;
    }
```

- [ ] **Step 3: Call `buildRingsForMarker` from `createBlobMarker`**

In `createBlobMarker`, just before `allMarkers.push(marker);` add:

```javascript
        buildRingsForMarker(marker);
```

- [ ] **Step 4: Push ring uniforms each frame in `updateMarkerUniforms`**

Inside the `for (var i = 0; ... allMarkers.length; ...)` loop in `updateMarkerUniforms`, after the blob block, add:

```javascript
            var rings = m.userData._rings || [];
            if (rings.length) {
                var data2 = m.userData;
                var mNorm2 = Math.max(0, Math.min(1, (data2.magnitude - 4.5) / 4.5));
                var dNorm2 = Math.max(0, Math.min(1, data2.depth / window.tuning.depthNormKm));
                var blobR  = lerp(window.tuning.radiusMin, window.tuning.radiusMax, mNorm2);
                var maxR   = lerp(window.tuning.maxReachMin, window.tuning.maxReachMax, dNorm2) * blobR;
                var c2 = colorForDepth(data2.depth);
                for (var k = 0; k < rings.length; k++) {
                    var ring = rings[k];
                    var ru = ring.material.uniforms;
                    ru.time.value             = time;
                    ru.cycleSec.value         = window.tuning.cycleSec;
                    ru.alphaExp.value         = window.tuning.alphaExp;
                    ru.thicknessFrac.value    = window.tuning.thicknessFrac;
                    ru.thicknessFalloff.value = window.tuning.thicknessFalloff;
                    ru.color.value.set(c2.r, c2.g, c2.b);
                    // phaseOffset depends on index + cycleSec, refresh in case cycleSec changed
                    ru.phaseOffset.value = (window.tuning.cycleSec * k) / rings.length;
                    ring.scale.set(maxR, maxR, maxR);
                }
            }
```

- [ ] **Step 5: Hook ringCount changes to rebuild rings**

In `js/markers.js`, **at the bottom of the IIFE just before `window.Markers = ...`**, add:

```javascript
    if (window.tuning && window.tuning.onRingCountChange) {
        window.tuning.onRingCountChange(function () {
            for (var i = 0; i < allMarkers.length; i++) buildRingsForMarker(allMarkers[i]);
        });
    }
```

Add `buildRingsForMarker` and `makeRingMaterial` to the export object so they can be inspected from console:

```javascript
    window.Markers = {
        colorForDepth: colorForDepth,
        hexToRgb: hexToRgb,
        createBlobMarker: createBlobMarker,
        buildRingsForMarker: buildRingsForMarker,
        updateMarkerUniforms: updateMarkerUniforms,
        allMarkers: allMarkers
    };
```

- [ ] **Step 6: Visual verification**

Reload `http://localhost:8000/`.

Expected:
- Each blob now has 3 expanding rings around it (camera-facing flat planes — they look like circles for now).
- Rings expand, fade, and thin out.
- Deeper quakes have rings reaching further.
- Slider `cycleSec` changes ring expansion speed live.
- Slider `alphaExp` makes rings fade faster/slower.
- Change `ringCount` to 5 → 5 staggered rings appear; back to 1 → only one ring.

- [ ] **Step 7: Commit**

```bash
git add js/markers.js
git commit -m "Add expanding pulse rings (camera-facing planes for now)"
```

---

## Task 7: Orient rings tangent to globe surface

The marker is parented under `crust` (a `THREE.GeoSpatialMap` — a sphere). The marker's local position vector from the sphere center IS the surface normal direction. We need each ring's plane normal to point along that surface normal so the ring lies flat on the globe.

**Files:**
- Modify: `js/markers.js`

- [ ] **Step 1: Add an orientation helper**

Inside the IIFE, after `buildRingsForMarker`, add:

```javascript
    function orientRingsToSurface(marker) {
        // marker.position is local to crust; crust is centered at origin.
        // Surface normal is just the normalized local position.
        if (marker.position.lengthSq() < 1e-6) return;
        var normal = marker.position.clone().normalize();

        // PlaneGeometry's default normal is +Z. We want the plane's +Z to align with `normal`.
        var quat = new THREE.Quaternion();
        quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

        var rings = marker.userData._rings || [];
        for (var i = 0; i < rings.length; i++) {
            rings[i].quaternion.copy(quat);
        }
    }
```

- [ ] **Step 2: Apply orientation after rings are built**

The marker isn't placed at its world location until `crust.addGeoSymbol` is called in `addMarkerToCrust`. So we need to orient AFTER that. Two clean options — we'll do it on the first frame of `updateMarkerUniforms` (since by then the marker has been placed).

In `js/markers.js`, modify `createBlobMarker`: do NOT orient yet (position is still 0,0,0 at this point). Add a flag:

```javascript
        marker.userData._needsOrient = true;
```

Place that line just after `marker.userData._rings = [];` in `createBlobMarker`.

In `updateMarkerUniforms`, at the **top of the per-marker loop body** (before the blob block), add:

```javascript
            if (m.userData._needsOrient && m.position.lengthSq() > 1e-6) {
                orientRingsToSurface(m);
                m.userData._needsOrient = false;
            }
```

Also re-orient when ring count changes — extend the ring-count listener at the bottom of the IIFE:

```javascript
    if (window.tuning && window.tuning.onRingCountChange) {
        window.tuning.onRingCountChange(function () {
            for (var i = 0; i < allMarkers.length; i++) {
                buildRingsForMarker(allMarkers[i]);
                orientRingsToSurface(allMarkers[i]);
            }
        });
    }
```

- [ ] **Step 3: Visual verification**

Reload `http://localhost:8000/`.

Expected:
- Rings now lie FLAT on the globe surface — they look like ellipses when viewed at oblique angles (e.g., quakes near the limb of the globe).
- Quakes near the center of view show near-circular rings; quakes near the horizon show flattened ovals tilted to match the surface curvature.
- Drag-rotate the globe — rings stay glued to the surface.
- Bug check: no rings spinning wildly; no rings perpendicular to the surface.

- [ ] **Step 4: Commit**

```bash
git add js/markers.js
git commit -m "Orient pulse rings tangent to globe surface"
```

---

## Task 8: Live-tune blob colors (verify Color folder)

The color uniforms are already pushed every frame in `updateMarkerUniforms` from Task 5/6. This task is a verification + small-bug-fix pass.

**Files:**
- (verify only; modify only if a bug is found)

- [ ] **Step 1: Visual verification — color sliders**

Reload page. In the **Color** folder:

- Click `emberHex` and pick bright magenta. Expected: shallow quakes turn magenta.
- Click `cyanHex` and pick green. Expected: deep quakes turn green.
- Move `depthNormKm` to 100. Expected: many more quakes look "deep" (saturate cyan).
- Move `depthNormKm` to 1000. Expected: most quakes look shallow.

- [ ] **Step 2: Visual verification — magnitude sliders**

- Move `radiusMax` to 400. Expected: large quakes get huge.
- Move `pulseHzMax` to 5. Expected: large quakes pulse rapidly.
- Move `deformAmpMax` to 1.0. Expected: large quakes warp dramatically.

- [ ] **Step 3: Visual verification — ring sliders**

- Move `maxReachMax` to 30. Expected: deep quakes have very long-reaching rings.
- Move `cycleSec` to 0.8. Expected: rings expand much faster.
- Move `thicknessFrac` to 0.3. Expected: rings appear as thick bands.
- Move `thicknessFalloff` to 0.0. Expected: rings stay thick all the way out.
- Move `alphaExp` to 3. Expected: rings fade out almost immediately.

- [ ] **Step 4: If any of the above don't update live**

Verify the corresponding uniform is being pushed in `updateMarkerUniforms`. Most likely culprit is a typo in a uniform name. No commit if everything works; if you fixed something:

```bash
git add js/markers.js
git commit -m "Fix live-tune wiring for <slider>"
```

---

## Task 9: Restore click-to-detail on the new blob meshes

The existing raycast in `main.js` looks for `THREE.Sprite` intersections. Switch it to the new blob meshes.

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Find the existing raycast**

In `js/main.js`, locate `checkSelectInfo` (around lines 199-223). The relevant block:

```javascript
        intersects = raycaster.intersectObjects( markers,true );
        console.log (intersects);
        for(var i= 0, l=intersects.length;i<l;i++){
            if (intersects[i].object instanceof THREE.Sprite){
                intersectFound = true;
                $("#detail").fadeOut(500, function(){
                    onMarkerSelect(intersects[ i ].object.parent);
                });
                break;
            }
        }
```

- [ ] **Step 2: Replace the filter**

Replace the `if (intersects[i].object instanceof THREE.Sprite){` line with:

```javascript
            var hit = intersects[i].object;
            if (hit instanceof THREE.Mesh && hit.userData && hit.userData._kind === 'blob'){
```

So the block becomes:

```javascript
        intersects = raycaster.intersectObjects( markers,true );
        for(var i= 0, l=intersects.length;i<l;i++){
            var hit = intersects[i].object;
            if (hit instanceof THREE.Mesh && hit.userData && hit.userData._kind === 'blob'){
                intersectFound = true;
                $("#detail").fadeOut(500, function(){
                    onMarkerSelect(hit.parent);
                });
                break;
            }
        }
```

(Also drops the leftover `console.log(intersects)` debug line.)

- [ ] **Step 3: Verify `onMarkerSelect` still works**

`onMarkerSelect` reads `o.userData` to populate the detail panel. Our blob's parent (the marker `Object3D`) has `marker.userData = data` set in `createBlobMarker`, so this still works without changes.

But check: in `onMarkerSelect`, the existing code uses `crust.traverse` to colorize the selected marker's **mesh** orange/white. With blobs, those meshes are blob meshes whose color is shader-driven, not material.color-driven. The existing color-swap won't have a visible effect. That's acceptable for now — selection is conveyed by the detail panel + the surface map underlay.

If this causes a runtime error (because `mesh.material.color` is undefined on ShaderMaterial), find this block in `onMarkerSelect`:

```javascript
                mesh.material.color.setHex(0xffffff);
            } else {
               if (mesh && mesh instanceof THREE.Mesh) mesh.material.color.setHex(0xffa500);
            }
```

And guard it:

```javascript
                if (mesh && mesh.material && mesh.material.color) mesh.material.color.setHex(0xffffff);
            } else {
               if (mesh && mesh instanceof THREE.Mesh && mesh.material && mesh.material.color) mesh.material.color.setHex(0xffa500);
            }
```

- [ ] **Step 4: Visual verification**

Reload page. Click a blob.

Expected:
- Detail panel slides in from the bottom-right with location, magnitude, depth.
- No console errors.
- Click empty space → detail panel fades.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "Route click raycast to new blob meshes; guard color swap on shader material"
```

---

## Task 10: Remove dead code from old marker path

`createMarker` and the `magnitudeRadii`/`spark.png`/`noiseTexture` setup are unused now. Clean up.

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Delete dead code**

In `js/main.js`, remove:

- The `magnitudeRadii` array declaration (around line 35).
- The `noiseTexture` lines (around lines 31–32).
- The entire `function createMarker(data)` (around lines 156–182).

Leave `createCrust` and everything else alone.

- [ ] **Step 2: Visual verification**

Reload page.

Expected:
- Page still works identically.
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add js/main.js
git commit -m "Remove unused createMarker/spark/noiseTexture code"
```

---

## Task 11: Final pass — full design checklist

Walk the spec's testing checklist end-to-end. Anything that fails goes back to the relevant task and gets fixed before this plan is considered done.

- [ ] **Step 1: Run through the full checklist**

From the spec (`docs/superpowers/specs/2026-04-26-blobby-pulse-markers-design.md`):

- [ ] Markers replace old sphere+sprite cleanly. No old artifacts.
- [ ] Blob pulses; bigger magnitudes pulse faster + larger.
- [ ] Rings emanate flat across globe surface (ellipses at oblique view, not circles facing camera).
- [ ] Deeper quakes show cooler hue + larger ring reach.
- [ ] Ring fades + thins + softens with distance.
- [ ] dat.GUI panel renders top-right, all controls update markers live.
- [ ] Color pickers update both blob + rings.
- [ ] `ringCount` change rebuilds rings without breaking the scene.
- [ ] localStorage persists tuning across reload.
- [ ] "Copy as JSON" copies a valid JSON object.
- [ ] Click on a marker opens the detail panel as before.
- [ ] No console errors.

- [ ] **Step 2: Commit any final tweaks under one commit**

If you had to fix anything:

```bash
git add -A
git commit -m "Polish blobby pulse markers based on full design checklist"
```

If nothing needed fixing, skip the commit.

---

## Done

The feature is complete when every checkbox in Task 11 is ticked. Suggest the user run `/ultrareview` against the branch for a multi-agent review, or merge to master if satisfied.
