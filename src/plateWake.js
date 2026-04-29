// src/plateWake.js — directional wake animation on plate boundaries.
//
// For each boundary group, build two strip meshes (one each side of the
// line). Each strip is a sequence of quads, one per segment, offset
// perpendicular to the segment by WAKE.travelKm. A shared ShaderMaterial
// animates a soft band that propagates outward (divergent), inward
// (convergent), or along-line (transform) based on a mode uniform.

import {
    Mesh,
    BufferGeometry,
    BufferAttribute,
    ShaderMaterial,
    Color,
    Vector3,
    DoubleSide,
    AdditiveBlending,
} from 'three';
import { geoToVec3, EARTH_RADIUS } from './feed.js';
import { velocityAt } from './plateMotionMath.js';

const WAKE = {
    travelKm:      150,
    cycleFastSec:  3.0,
    cycleSlowSec:  12.0,
    concurrent:    3,
    peakOpacity:   0.20,
    fadeIn:        0.08,
    startW:        1.0,
    endW:          2.0,
};
const MAG_CEILING = 150;   // mm/yr — same as plateMotion's MAG_CEILING_MM_YR

// Boundary class → wake mode (0 = divergent, 1 = convergent, 2 = transform)
const MODE_DIV = 0;
const MODE_CON = 1;
const MODE_TRA = 2;
const TYPE_MODE = {
    OSR: MODE_DIV, CRB: MODE_DIV,
    SUB: MODE_CON, OCB: MODE_CON, CCB: MODE_CON,
    OTF: MODE_TRA, CTF: MODE_TRA,
};

// Boundary class → wake color (matches arrow palette but lighter)
const TYPE_COLOR = {
    OSR: 0xe070ff, CRB: 0xe070ff,
    OTF: 0xffd070, CTF: 0xffd070,
    SUB: 0x9050e0, OCB: 0x9050e0, CCB: 0x9050e0,
};
const DEFAULT_COLOR = 0xffffff;

function buildStripGeometry(features, sideSign, surfaceRadius) {
    // Per segment, emit 4 vertices and 2 triangles (6 indices).
    // Vertices: { aArcKm: cumulative along-line distance,
    //             aPerpFrac: 0 at inner edge, 1 at outer edge,
    //             aSide: sideSign (-1 or +1) }
    const positions = [];
    const arcs = [];
    const perps = [];
    const sides = [];
    const indices = [];
    let cumulativeArc = 0;
    let vertexBase = 0;

    for (const feature of features) {
        const coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) continue;
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng0, lat0] = coords[i];
            const [lng1, lat1] = coords[i + 1];

            // Inner endpoints sit on the boundary line itself (at surfaceRadius
            // — same radius the existing atlas line uses). We get the
            // direction along the segment, then compute a perpendicular offset
            // along the surface tangent plane scaled by WAKE.travelKm.
            const a = geoToVec3(lat0, lng0, 0).normalize().multiplyScalar(surfaceRadius);
            const b = geoToVec3(lat1, lng1, 0).normalize().multiplyScalar(surfaceRadius);

            // Tangent along segment (in world XYZ, projected to local tangent plane).
            const along = b.clone().sub(a);
            const segLen = along.length();
            if (segLen < 1e-6) continue;
            along.normalize();

            // Outward radial at midpoint (= local "up" on sphere).
            const mid = a.clone().add(b).multiplyScalar(0.5);
            const radial = mid.clone().normalize();

            // Perpendicular = along × radial; sideSign chooses left/right.
            const perp = along.clone().cross(radial).normalize().multiplyScalar(sideSign);

            // Outer endpoints: offset by travelKm along perp.
            const aOuter = a.clone().addScaledVector(perp, WAKE.travelKm);
            const bOuter = b.clone().addScaledVector(perp, WAKE.travelKm);

            // 4 vertices: a (inner), b (inner), aOuter, bOuter
            positions.push(a.x, a.y, a.z);
            positions.push(b.x, b.y, b.z);
            positions.push(aOuter.x, aOuter.y, aOuter.z);
            positions.push(bOuter.x, bOuter.y, bOuter.z);

            arcs.push(cumulativeArc, cumulativeArc + segLen, cumulativeArc, cumulativeArc + segLen);
            perps.push(0, 0, 1, 1);
            sides.push(sideSign, sideSign, sideSign, sideSign);

            // Two triangles: (a, b, aOuter) and (b, bOuter, aOuter)
            indices.push(
                vertexBase + 0, vertexBase + 1, vertexBase + 2,
                vertexBase + 1, vertexBase + 3, vertexBase + 2,
            );
            vertexBase += 4;
            cumulativeArc += segLen;
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('aArcKm',  new BufferAttribute(new Float32Array(arcs), 1));
    geo.setAttribute('aPerpFrac', new BufferAttribute(new Float32Array(perps), 1));
    geo.setAttribute('aSide',  new BufferAttribute(new Float32Array(sides), 1));
    geo.setIndex(indices);
    return geo;
}

const wakeVert = /* glsl */`
    attribute float aArcKm;
    attribute float aPerpFrac;
    attribute float aSide;
    varying float vArcKm;
    varying float vPerpFrac;
    void main() {
        vArcKm = aArcKm;
        vPerpFrac = aPerpFrac;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const wakeFrag = /* glsl */`
    precision highp float;
    uniform vec3  uColor;
    uniform float uTime;
    uniform float uSpeed;       // 1.0 = baseline; >1 = faster cycle
    uniform int   uMode;        // 0 div, 1 con, 2 tra
    uniform float uPeakOpacity;
    uniform float uFadeIn;
    uniform float uConcurrent;
    uniform float uTotalArcKm;  // cumulative arc-length of the whole strip
    varying float vArcKm;
    varying float vPerpFrac;

    void main() {
        // Base phase: cycles per second × time, scaled by uSpeed
        float baseCycles = uTime * uSpeed;

        // For div/con, phase advances along the perpendicular axis.
        // For tra, phase advances along the arc.
        float u = (uMode == 2) ? (vArcKm / uTotalArcKm) : vPerpFrac;

        // Wake direction: divergent goes outward (phase = baseCycles - u);
        // convergent goes inward (phase = baseCycles + u); transform along.
        float phase = (uMode == 1) ? (baseCycles + u) : (baseCycles - u);

        // Multiple staggered wakes within one cycle: take fract * concurrent.
        float wakePhase = fract(phase);

        // Envelope: ramp to peak in uFadeIn, then linearly fade to 0 by 1.0
        float env = smoothstep(0.0, uFadeIn, wakePhase) *
                    (1.0 - smoothstep(uFadeIn, 1.0, wakePhase));

        // Strip alpha falls off at perp edges so the strip isn't a hard rectangle.
        float edgeMask = (uMode == 2)
            ? 1.0 - smoothstep(0.0, 1.0, vPerpFrac)   // tra: brightest at inner edge
            : 1.0;                                     // div/con: solid across perp

        gl_FragColor = vec4(uColor, env * edgeMask * uPeakOpacity);
    }
`;

export function loadPlateWake({ scene, atlas, poleIndex }) {
    const surfaceRadius = atlas.boundaryGroups[0]?.mesh?.geometry?.boundingSphere?.radius
        || (EARTH_RADIUS * 0.999);

    const wakeMeshes = [];

    for (const grp of atlas.boundaryGroups) {
        const features = grp.features || [];
        if (features.length === 0) continue;

        // Determine mode + total arc + per-group speed from one representative
        // feature's class. (All segments in a group share a class.)
        const repProps = features[0].properties;
        const mode = TYPE_MODE[repProps.Type] ?? MODE_TRA;
        const colorHex = TYPE_COLOR[repProps.Type] ?? DEFAULT_COLOR;

        // Group speed = avg sqrt-compressed magnitude across segments.
        let sum = 0, count = 0, totalArc = 0;
        for (const f of features) {
            const c = f.geometry.coordinates;
            if (!c || c.length < 2) continue;
            const [[lngA, latA], [lngB, latB]] = c;
            const v = velocityAt(poleIndex, f.properties.PlateA, f.properties.PlateB,
                                 (latA + latB) / 2, (lngA + lngB) / 2);
            if (v) { sum += Math.sqrt(Math.max(0, v.magnitude) / MAG_CEILING); count++; }
            // Arc length will also be computed inside buildStripGeometry; for
            // the uniform we estimate from sphere geometry.
        }
        const groupSpeedNorm = count > 0 ? sum / count : 0;
        // Map normalized speed (0..1) to cycles-per-second:
        //   speed 1 → 1/cycleFastSec
        //   speed 0 → 1/cycleSlowSec
        const cyclesPerSec = (1 / WAKE.cycleSlowSec) +
            groupSpeedNorm * ((1 / WAKE.cycleFastSec) - (1 / WAKE.cycleSlowSec));

        for (const sideSign of [-1, +1]) {
            const geo = buildStripGeometry(features, sideSign, surfaceRadius);
            // totalArcKm: read from the largest aArcKm value
            const arcAttr = geo.getAttribute('aArcKm');
            let maxArc = 0;
            for (let i = 0; i < arcAttr.count; i++) maxArc = Math.max(maxArc, arcAttr.getX(i));
            const mat = new ShaderMaterial({
                vertexShader:   wakeVert,
                fragmentShader: wakeFrag,
                uniforms: {
                    uColor:        { value: new Color(colorHex) },
                    uTime:         { value: 0 },
                    uSpeed:        { value: cyclesPerSec },
                    uMode:         { value: mode },
                    uPeakOpacity:  { value: WAKE.peakOpacity },
                    uFadeIn:       { value: WAKE.fadeIn },
                    uConcurrent:   { value: WAKE.concurrent },
                    uTotalArcKm:   { value: maxArc || 1 },
                },
                transparent:  true,
                depthWrite:   false,
                side:         DoubleSide,
                blending:     AdditiveBlending,
            });
            const mesh = new Mesh(geo, mat);
            mesh.renderOrder = 1.5;   // between core and arrows
            scene.add(mesh);
            wakeMeshes.push(mesh);
        }
    }

    function update(t) {
        for (const m of wakeMeshes) m.material.uniforms.uTime.value = t;
    }

    function dispose() {
        for (const m of wakeMeshes) {
            scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        }
        wakeMeshes.length = 0;
    }

    return { update, dispose };
}
