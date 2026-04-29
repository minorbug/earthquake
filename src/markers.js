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
