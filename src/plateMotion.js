// src/plateMotion.js — relative-motion vector layer over the atlas's plate
// boundaries.
//
// Owns:
//   - the Euler-pole table (data/pb2002_poles.json)
//   - the sample-point list derived from PB2002 boundary segments
//   - (added in subsequent tasks) the arrow InstancedMesh and the flow
//     ShaderMaterial that replaces atlas's boundary LineBasicMaterial
//
// Tests for the math live in src/plateMotionMath.test.js. This module is
// the Three.js / DOM glue around those pure helpers.

import {
    InstancedMesh,
    ConeGeometry,
    CylinderGeometry,
    MeshBasicMaterial,
    Color,
    Vector3,
    Matrix4,
    InstancedBufferAttribute,
    Raycaster,
    Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPoleIndex, velocityAt, sampleBoundaries } from './plateMotionMath.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import polesData from '../data/pb2002_poles.json' with { type: 'json' };
import stepsData from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };

// Hover behaviour constants.
const HOVER_RADIUS_KM = 800;     // arrows within this distance of cursor activate
const FADE_RATE       = 8;        // 1/sec — how fast active state lerps toward target
const MARCH_FREQ_HZ   = 0.6;      // arrow forward-pulse frequency
const MARCH_AMPLITUDE = 0.6;      // pulse fraction of arrow length
const RAY_LINE_THRESHOLD_KM = 60; // raycast tolerance for hitting a thin line

// SAMPLE_SPACING_DEG is read from atlasTuning.arrowDensity at module init;
// density changes require a page reload (rebuilding instances live would
// be a significant restructure — arrowDensity is treated as a startup param).

const ARROW_RADIUS_FACTOR = 0.998;   // sit just inside the crust
const ARROW_MIN_LEN_KM    = 120;
const ARROW_MAX_LEN_KM    = 380;
const MAG_CEILING_MM_YR   = 150;     // East Pacific Rise rate

// Boundary class → arrow color. Atlas colors but slightly brighter so arrows
// pop above the lines they sit on.
const TYPE_COLORS = {
    OSR: 0xe070ff,  // ridges
    CRB: 0xe070ff,
    OTF: 0xffd070,  // transforms
    CTF: 0xffd070,
    SUB: 0x9050e0,  // subduction
    OCB: 0x9050e0,
    CCB: 0x9050e0,
};
const DEFAULT_COLOR = 0xffffff;

function buildArrowGeometry() {
    // Stem along +Y, then we rotate it onto +X.
    const stem = new CylinderGeometry(0.05, 0.05, 0.7, 8, 1, true);
    stem.translate(0, 0.35, 0);
    const head = new ConeGeometry(0.15, 0.3, 12);
    head.translate(0, 0.85, 0);
    const merged = mergeGeometries([stem, head]);
    // Rotate so the arrow points along +X with tail at origin.
    merged.rotateZ(-Math.PI / 2);
    return merged;
}


function compressLength(magMmYr) {
    const t = Math.min(1, Math.sqrt(Math.max(0, magMmYr) / MAG_CEILING_MM_YR));
    return ARROW_MIN_LEN_KM + t * (ARROW_MAX_LEN_KM - ARROW_MIN_LEN_KM);
}

function arrowMatrix(latLngXyzPos, dirXyz, lengthKm, surfaceRadius) {
    // Position: on the surface at radius surfaceRadius * ARROW_RADIUS_FACTOR.
    const r = surfaceRadius * ARROW_RADIUS_FACTOR;
    const pos = new Vector3(latLngXyzPos.x, latLngXyzPos.y, latLngXyzPos.z).multiplyScalar(r);

    // Orientation: align +X with the velocity tangent direction (which lies
    // in the surface plane — it's already a tangent vector from velocityAt).
    const xAxis = new Vector3(dirXyz.x, dirXyz.y, dirXyz.z).normalize();
    const yAxis = new Vector3(latLngXyzPos.x, latLngXyzPos.y, latLngXyzPos.z).normalize(); // outward = local "up"
    const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize();
    // Re-orthogonalise xAxis in case dir wasn't perfectly tangent.
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const m = new Matrix4();
    m.makeBasis(xAxis, yAxis, zAxis);
    m.setPosition(pos);
    // Scale: lengthKm along the arrow axis (X), thinner cross-section.
    const scale = new Matrix4().makeScale(lengthKm, lengthKm * 0.25, lengthKm * 0.25);
    m.multiply(scale);
    return m;
}

const DEG_ARROW = Math.PI / 180;
const TEXTURE_EDGE_LNG_ARROW = -180.806168;
function arrowLatLngToXyz(lat, lng) {
    const phi   = (90 - lat) * DEG_ARROW;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG_ARROW)) * DEG_ARROW;
    const sp = Math.sin(phi);
    return { x: sp * Math.cos(theta), y: Math.cos(phi), z: sp * Math.sin(theta) };
}

// Build a static per-instance state record: world position, velocity-tangent
// direction (for marching), pre-computed orient basis, base length.
// instanceMatrix is then a function of state + hover-active + march-phase, so
// it can be rebuilt cheaply per frame without re-running velocityAt etc.
function buildArrowStates(samples, surfaceRadius) {
    const states = [];
    const r = surfaceRadius * ARROW_RADIUS_FACTOR;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const r3d = arrowLatLngToXyz(s.lat, s.lng);
        const worldPos = new Vector3(r3d.x, r3d.y, r3d.z).multiplyScalar(r);
        for (const v of [s.vA, s.vB]) {
            const xAxis = new Vector3(v.direction.x, v.direction.y, v.direction.z).normalize();
            const yAxis = new Vector3(r3d.x, r3d.y, r3d.z).normalize();
            const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize();
            xAxis.crossVectors(yAxis, zAxis).normalize();
            const length = compressLength(v.magnitude) * atlasTuning.arrowScale;
            states.push({
                worldPos: worldPos.clone(),
                xAxis: xAxis.clone(),
                yAxis: yAxis.clone(),
                zAxis: zAxis.clone(),
                length,
                active: 0,         // 0..1 hover ramp
                phaseOffset: Math.random() * Math.PI * 2,  // stagger marches
            });
        }
    }
    return states;
}

// Write a single arrow's instanceMatrix from its state + per-frame phase.
// active=0 → zero-scale (invisible); active=1 → full size + marching pulse.
const _tmpScale = new Matrix4();
const _tmpBasis = new Matrix4();
function writeArrowMatrix(arrowMesh, idx, st, t) {
    if (st.active < 0.001) {
        // Hidden: collapse to zero scale (no fragments rasterised).
        arrowMesh.setMatrixAt(idx, _tmpScale.makeScale(0, 0, 0));
        return;
    }
    // Marching pulse: arrow translates forward along its xAxis by a small
    // sin-driven offset, scaled by activation so it's calm when fading in.
    const pulse = Math.sin(t * MARCH_FREQ_HZ * Math.PI * 2 + st.phaseOffset);
    const marchOffset = pulse * MARCH_AMPLITUDE * st.length * 0.5 * st.active;
    const pos = st.worldPos.clone().addScaledVector(st.xAxis, marchOffset);
    _tmpBasis.makeBasis(st.xAxis, st.yAxis, st.zAxis);
    _tmpBasis.setPosition(pos);
    const len = st.length * st.active;
    _tmpScale.makeScale(len, len * 0.25, len * 0.25);
    _tmpBasis.multiply(_tmpScale);
    arrowMesh.setMatrixAt(idx, _tmpBasis);
}

function writeAllArrows(arrowMesh, states, t) {
    for (let i = 0; i < states.length; i++) writeArrowMatrix(arrowMesh, i, states[i], t);
    arrowMesh.instanceMatrix.needsUpdate = true;
}

export function loadPlateMotion({ scene, radius, atlas, camera, renderer }) {
    const poleIndex = buildPoleIndex(polesData.poles);

    // Convert geojson features to the shape sampleBoundaries expects.
    const segments = stepsData.features.map((f) => ({
        coords: f.geometry.coordinates,
        type:   f.properties.Type   || '',
        plateA: f.properties.PlateA || '',
        plateB: f.properties.PlateB || '',
    }));

    // arrowDensity is a startup param — density changes require a page reload.
    const sampleSpacing = atlasTuning.arrowDensity;
    const rawSamples = sampleBoundaries(segments, sampleSpacing);

    // Annotate each sample with computed velocities for both adjacent plates.
    // Drop samples whose plate pair isn't in the pole table — the rendering
    // tasks will skip them.
    let missing = 0;
    const samples = [];
    for (const s of rawSamples) {
        const vA = velocityAt(poleIndex, s.plateA, s.plateB, s.lat, s.lng);
        const vB = velocityAt(poleIndex, s.plateB, s.plateA, s.lat, s.lng);
        if (!vA || !vB) { missing++; continue; }
        samples.push({ ...s, vA, vB });
    }
    if (missing > 0) {
        console.warn(`plateMotion: skipped ${missing}/${rawSamples.length} samples whose plate pairs aren't in the Euler-pole table.`);
    }

    if (typeof window !== 'undefined') {
        window.__eqPlateMotion = { poleIndex, segments, rawSamples, samples };
    }

    // ----- Arrow InstancedMesh -----
    const arrowGeo = buildArrowGeometry();
    const arrowMat = new MeshBasicMaterial({ vertexColors: true });
    const totalArrows = samples.length * 2;
    const arrowMesh = new InstancedMesh(arrowGeo, arrowMat, totalArrows);
    arrowMesh.frustumCulled = false;
    arrowMesh.renderOrder = 3;
    scene.add(arrowMesh);

    // Per-instance color attribute.
    const colorAttr = new Float32Array(totalArrows * 3);
    for (let i = 0; i < samples.length; i++) {
        const c = new Color(TYPE_COLORS[samples[i].type] ?? DEFAULT_COLOR);
        colorAttr[(i * 2) * 3 + 0] = c.r;
        colorAttr[(i * 2) * 3 + 1] = c.g;
        colorAttr[(i * 2) * 3 + 2] = c.b;
        colorAttr[(i * 2 + 1) * 3 + 0] = c.r;
        colorAttr[(i * 2 + 1) * 3 + 1] = c.g;
        colorAttr[(i * 2 + 1) * 3 + 2] = c.b;
    }
    arrowMesh.instanceColor = new InstancedBufferAttribute(colorAttr, 3);

    const arrowStates = buildArrowStates(samples, radius);
    writeAllArrows(arrowMesh, arrowStates, 0);

    // ----- Hover detection -----
    // Raycast against the boundary line meshes; on hit, mark arrows within
    // HOVER_RADIUS_KM of the hit point as active. Per-frame ramp lerps each
    // arrow's `active` toward 1 (target) or 0 (no target).
    const raycaster = new Raycaster();
    // Default Raycaster.params has no Line2 entry; LineSegments2 uses
    // params.Line2.threshold for its hit tolerance. Set it explicitly.
    raycaster.params.Line2 = { threshold: RAY_LINE_THRESHOLD_KM };
    raycaster.params.Line  = { threshold: RAY_LINE_THRESHOLD_KM };
    const ndc = new Vector2();
    let hoverPoint = null;   // Vector3 in world space, or null
    let lastT = 0;

    if (typeof window !== 'undefined') {
        const canvas = renderer ? renderer.domElement : window;

        // Live debug overlay: tiny fixed panel that updates on every
        // mousemove with cursor xy, ndc, hits count, hoverPoint, and
        // active-arrow count. Lets you SEE what the raycaster is doing.
        const dbg = document.createElement('div');
        dbg.id = 'plateMotionDebug';
        dbg.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(0,0,0,.75);color:#9fe;font:11px/1.4 ui-monospace,monospace;padding:6px 10px;border-radius:4px;pointer-events:none;border:1px solid rgba(255,255,255,.15);white-space:pre;';
        dbg.textContent = 'plateMotion: move mouse over a boundary line';
        document.body.appendChild(dbg);

        const onMove = (ev) => {
            const x = ev.clientX, y = ev.clientY;
            ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            const meshes = atlas.boundaryGroups.map((g) => g.mesh);
            const hits = raycaster.intersectObjects(meshes, false);
            hoverPoint = hits.length > 0 ? hits[0].point.clone() : null;
            window.__eqHover = { ndc: ndc.toArray(), hits: hits.length, hoverPoint: hoverPoint && hoverPoint.toArray() };

            // Count nearby arrows (target=1)
            let nearby = 0;
            if (hoverPoint) {
                const radSq = HOVER_RADIUS_KM * HOVER_RADIUS_KM;
                for (const st of arrowStates) {
                    if (st.worldPos.distanceToSquared(hoverPoint) < radSq) nearby++;
                }
            }
            const hpStr = hoverPoint
                ? `(${hoverPoint.x.toFixed(0)}, ${hoverPoint.y.toFixed(0)}, ${hoverPoint.z.toFixed(0)})`
                : 'null';
            dbg.textContent =
                `xy=(${x},${y})  ndc=(${ndc.x.toFixed(2)},${ndc.y.toFixed(2)})\n` +
                `hits=${hits.length}  hoverPoint=${hpStr}\n` +
                `nearby arrows (target=1): ${nearby} / ${arrowStates.length}`;
        };
        const onLeave = () => { hoverPoint = null; dbg.textContent += '\n(mouseleave)'; };
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseleave', onLeave);
    }

    function applyFlowEnabled(enabled) {
        for (const grp of atlas.boundaryGroups) {
            const mat = grp.material;
            if (mat && 'dashed' in mat) mat.dashed = enabled;
        }
    }

    function applyFlowOpacity() {
        const opacity = atlasTuning.flowOpacity;
        for (const grp of atlas.boundaryGroups) {
            const mat = grp.material;
            if (!mat) continue;
            if (grp.isOther) {
                mat.opacity = Math.min(1, atlasTuning.otherAlpha * opacity);
            } else {
                mat.opacity = Math.min(1, 0.95 * opacity);
            }
        }
    }

    // Apply initial state.
    arrowMesh.visible = atlasTuning.plateMotionEnabled && atlasTuning.arrowsEnabled;
    for (const grp of atlas.boundaryGroups) {
        grp.mesh.visible = atlasTuning.showBoundaries;
    }
    applyFlowEnabled(atlasTuning.plateMotionEnabled && atlasTuning.flowEnabled);
    applyFlowOpacity();

    function update(t) {
        const dt = lastT === 0 ? 0.016 : Math.max(0, Math.min(0.1, t - lastT));
        lastT = t;
        const radSq = HOVER_RADIUS_KM * HOVER_RADIUS_KM;
        const lerpAmount = Math.min(1, FADE_RATE * dt);
        for (const st of arrowStates) {
            const target = (hoverPoint && st.worldPos.distanceToSquared(hoverPoint) < radSq) ? 1 : 0;
            st.active += (target - st.active) * lerpAmount;
        }
        writeAllArrows(arrowMesh, arrowStates, t);
    }

    onAtlasColorChange((tn) => {
        // atlas.js's own applyColors handles color/linewidth. arrowScale change
        // requires rebuilding the per-instance length on each state.
        for (let i = 0; i < arrowStates.length; i++) {
            const sIdx = Math.floor(i / 2);
            const v = (i % 2 === 0) ? samples[sIdx].vA : samples[sIdx].vB;
            arrowStates[i].length = compressLength(v.magnitude) * tn.arrowScale;
        }
        applyFlowOpacity();
    });
    onAtlasVisibilityChange((tn) => {
        arrowMesh.visible = tn.plateMotionEnabled && tn.arrowsEnabled;
        for (const grp of atlas.boundaryGroups) {
            grp.mesh.visible = tn.showBoundaries;
        }
        applyFlowEnabled(tn.plateMotionEnabled && tn.flowEnabled);
    });

    return { update };
}
