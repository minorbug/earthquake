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
