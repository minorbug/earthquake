# Blobby Pulse Markers — Design

Replace the existing earthquake markers (low-poly sphere + spark.png sprite) with an animated, parameter-driven representation: a blobby deforming core surrounded by surface-tangent pulse rings. Add a `dat.GUI` panel for live tuning.

## Goals

- Each quake reads instantly: magnitude → energy/violence; depth → reach + temperature.
- Animation conveys "this is a seismic event," not a dot on a map.
- All visual parameters tunable live so the look can be dialed in by feel.
- Existing click-to-detail behavior preserved.

## Non-Goals

- Mobile performance optimization. Going with naive per-marker meshes; revisit if needed.
- New data sources or filters. Same USGS feed (`4.5+` / `month`).
- Reworking the globe, lighting, camera, or detail panel UI.

## Visual Design

### Composite per quake

Each marker is two sibling objects parented to a single `Object3D` placed by `GeoSpatialMap`:

1. **Blob core** — vertex-deformed icosahedron mesh. Pulses + warps continuously. Acts as raycast click target.
2. **Pulse rings** — N flat ring meshes (default 3) oriented tangent to the globe surface (ring plane perpendicular to surface normal at epicenter). Phases staggered evenly across the cycle. Expand outward, fade + thin + soften with distance from center.

Both share one depth-driven color. Time advances from a single global uniform updated once per frame in the existing render loop.

### Data → visual mapping

```
m = magnitude  (4.5 – ~9 from feed)
d = depth km   (0 – ~700)

mNorm = clamp((m - 4.5) / 4.5, 0, 1)
dNorm = clamp(d / depthNormKm, 0, 1)    // depthNormKm tunable, default 300

// Blob
blob.radius     = lerp(radiusMin,    radiusMax,    mNorm)
blob.deformAmp  = lerp(deformAmpMin, deformAmpMax, mNorm)   // fraction of radius
blob.pulseHz    = lerp(pulseHzMin,   pulseHzMax,   mNorm)
blob.color      = lerpRGB(EMBER → MID → CYAN, dNorm)        // 3-stop gradient

// Rings (count = ringCount; phase[i] = i / ringCount)
ring.maxRadius   = lerp(maxReachMin, maxReachMax, dNorm) * blob.radius
ring.cycleSec    = constant (per dat.GUI)
ring.color       = blob.color
t                = (currentRadius / maxRadius) in [0,1]
ring.alpha(t)    = (1 - t) ^ alphaExp
ring.thickness(t)= blob.radius * thicknessFrac * lerp(1, thicknessFalloff, t)
ring.softness(t) = t   // additive blur amount in shader
```

### Color ramp (default)

3-stop gradient applied via `dNorm`:

| stop | hex      | meaning            |
|------|----------|--------------------|
| 0.0  | #ffeebb  | shallow, hot ember |
| 0.5  | #ff7733  | mid-depth          |
| 1.0  | #22ccff  | deep, cool cyan    |

### Animation

- Blob deformation: per-vertex offset = `normal * radius * deformAmp * (0.5 * sin(time*pulseHz + 6*p.x) + 0.5 * sin(time*pulseHz*1.3 + 4*p.y) + 0.5 * sin(time*pulseHz*0.7 + 5*p.z)) / 1.5`. Each quake gets a `phaseSeed` uniform offset so they don't pulse in lockstep.
- Rings: progress `t` driven by `((time + phaseOffset[i]) mod cycleSec) / cycleSec`. Scale, alpha, thickness, softness derived from `t` per the mapping.

## Tuning Panel (dat.GUI)

Vendored as `js/vendor/dat.gui.min.js`. Panel docks top-right, collapsible. State persists to `localStorage` under key `eq-marker-tuning`. Includes a "Copy as JSON" button that copies the current parameter object to the clipboard.

### Folders & controls

```
Blob
  radiusMin        5..200      15
  radiusMax       50..400      180
  deformAmpMin     0..1        0.15
  deformAmpMax     0..1        0.45
  pulseHzMin       0..3        0.4
  pulseHzMax       0..5        1.6

Rings
  maxReachMin      1..20       3      (× blob.radius)
  maxReachMax      1..30       8
  cycleSec         0.5..8      3.0
  alphaExp         0.5..3      1.5
  thicknessFrac    0.02..0.3   0.08
  thicknessFalloff 0..1        0.2

Color
  emberHex         color       #ffeebb
  midHex           color       #ff7733
  cyanHex          color       #22ccff
  depthNormKm      50..1000    300

Globals
  ringCount        1..6 step 1 3
  visible          toggle      true
```

All controls write to a single `tuning` object whose values back the shader uniforms. Sliders update uniforms live; `ringCount` triggers a marker rebuild (cheap — same data, new ring meshes). `visible` toggles the marker group.

## Architecture

### File-level changes

| File | Change |
|------|--------|
| `index.html` | Add `<script src="js/vendor/dat.gui.min.js">` before `main.js`. |
| `js/vendor/dat.gui.min.js` | New, vendored copy. |
| `js/main.js` | Replace `createMarker` and parts of `createCrust` orientation logic; add tuning module wiring; add per-frame uniform update. |
| `js/markers.js` | New module: shader source, marker factory (`createBlobMarker(data, tuning)`), uniform-update helper, color-ramp helper. |
| `js/tuning.js` | New module: dat.GUI setup, `tuning` object, localStorage persistence, JSON export. |

`markers.js` and `tuning.js` are plain `<script>` files exposing globals (matching the existing project style). No bundler.

### Component responsibilities

**`tuning.js`** — owns the `tuning` object and dat.GUI panel. Loads from localStorage on init, saves on every change. Exposes `window.tuning` and a `tuning.onRingCountChange(cb)` hook so `markers.js` can rebuild ring meshes when count changes.

**`markers.js`** — owns the shader programs and marker factory.
- `BlobShader` — vertex-deformation icosahedron material; uniforms: `time`, `phaseSeed`, `radius`, `deformAmp`, `pulseHz`, `color`.
- `RingShader` — flat ring material; uniforms: `time`, `phaseOffset`, `cycleSec`, `maxRadius`, `color`, `alphaExp`, `thicknessFrac`, `thicknessFalloff`.
- `createBlobMarker(data)` returns an `Object3D` containing one blob mesh (with `userData = data` for click handling) and `ringCount` ring meshes. Rings are oriented so their plane is tangent to the globe surface (rotated to match the local surface normal at the epicenter).
- `colorForDepth(d)` — 3-stop interpolation using current `tuning.emberHex`, `tuning.midHex`, `tuning.cyanHex`.

**`main.js`** — wires the pieces:
- Calls `tuning.init()` on load.
- `addMarkerToCrust` calls `createBlobMarker` instead of the old `createMarker`.
- `render()` advances a `time` value (`clock.getElapsedTime()`) and pushes it to all markers' shared uniform.
- `onMarkerSelect` raycasts against blob meshes (currently raycasts against `THREE.Sprite`; switch to `THREE.Mesh` filter on the blob).

### Surface-tangent ring orientation

The marker is positioned by `GeoSpatialMap.GeoSymbol` using `phi`/`lambda`. After the symbol is placed, compute the normalized world position of the marker; that vector IS the surface normal. Build a quaternion that rotates the ring's local +Z axis to align with that normal, and apply it to each ring mesh. Rings then ripple flat across the surface.

## Click / detail panel

Existing flow:
1. `onDocumentMouseDown` records click coords.
2. `checkSelectInfo` raycasts against `markers` array, looks for `intersects[i].object instanceof THREE.Sprite`, opens detail.

Switch the raycast filter from `instanceof THREE.Sprite` to `instanceof THREE.Mesh && object.userData && object.userData.magnitude !== undefined`. Keep `marker.userData = data` on the blob mesh so `onMarkerSelect` continues to read magnitude/depth/etc. from `intersect.parent` or the mesh itself.

## Performance

Going with **per-marker meshes** (option A from brainstorm). At ~500 events × (1 blob + 3 rings) = ~2000 meshes. Each mesh gets its own `ShaderMaterial` clone because per-quake uniforms (`radius`, `pulseHz`, `color`, etc.) differ; the shared global uniforms (`time`, tuning sliders) are pushed each frame by iterating all markers. Acceptable on desktop; revisit with instanced attributes if frame rate drops.

## Testing

Manual visual verification on desktop Chrome:

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

## Open Questions

None — proceeding to implementation plan.
