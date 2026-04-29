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
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPoleIndex, velocityAt, sampleBoundaries } from './plateMotionMath.js';
import { loadPlateWake } from './plateWake.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';
import polesData from '../data/pb2002_poles.json' with { type: 'json' };
import stepsData from '../data/pb2002_steps_with_plates.geojson' with { type: 'json' };

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

function populateArrowInstances(arrowMesh, samples, surfaceRadius) {
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const r3d = arrowLatLngToXyz(s.lat, s.lng);
        const lenA = compressLength(s.vA.magnitude) * atlasTuning.arrowScale;
        const lenB = compressLength(s.vB.magnitude) * atlasTuning.arrowScale;
        arrowMesh.setMatrixAt(i * 2,     arrowMatrix(r3d, s.vA.direction, lenA, surfaceRadius));
        arrowMesh.setMatrixAt(i * 2 + 1, arrowMatrix(r3d, s.vB.direction, lenB, surfaceRadius));
    }
    arrowMesh.instanceMatrix.needsUpdate = true;
}

export function loadPlateMotion({ scene, radius, atlas }) {
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

    populateArrowInstances(arrowMesh, samples, radius);

    const plateWake = loadPlateWake({ scene, atlas, poleIndex, radius });

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
        plateWake.update(t);
    }

    onAtlasColorChange((tn) => {
        // atlas.js's own applyColors handles color/linewidth; we only need arrowScale here.
        populateArrowInstances(arrowMesh, samples, radius);
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
