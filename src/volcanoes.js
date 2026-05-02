// src/volcanoes.js — Holocene volcanoes layer.
//
// Renders ~1,440 Holocene-active volcanoes (Smithsonian GVP, sourced
// from data/volcanoes_holocene.geojson) as a single Three.js Points
// mesh — one draw call regardless of count. A shared triangle-icon
// CanvasTexture is tinted by the material's color uniform; size is in
// pixels (sizeAttenuation: false) so icons stay readable at any zoom.
//
// Click handling uses the raycaster's Points support — controls.js
// raycasts this mesh and reads `intersection.index` to look up the
// matching feature, which is then passed to the detail panel.
import {
    Points,
    PointsMaterial,
    BufferGeometry,
    BufferAttribute,
    CanvasTexture,
    Color,
    LinearFilter,
} from 'three';
import volcanoesJson from '../data/volcanoes_holocene.geojson' with { type: 'json' };
import { tuning, onTuningChange } from './tuning.js';
import { geoToVec3 } from './feed.js';

// Build a triangle icon texture once at module init. White pixels — the
// PointsMaterial.color tints them at render time, so a single texture
// serves any color choice.
function createTriangleTexture(sizePx = 64) {
    const c = document.createElement('canvas');
    c.width = c.height = sizePx;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(sizePx * 0.5,  sizePx * 0.12);
    ctx.lineTo(sizePx * 0.92, sizePx * 0.88);
    ctx.lineTo(sizePx * 0.08, sizePx * 0.88);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // Thin dark outline so the icon reads on bright land/ocean alike.
    ctx.lineWidth = sizePx * 0.06;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    const tex = new CanvasTexture(c);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    return tex;
}

export function loadVolcanoes({ scene }) {
    const features = volcanoesJson.features || [];
    if (features.length === 0) {
        console.warn('volcanoes: no features in data/volcanoes_holocene.geojson');
        return null;
    }

    // Position buffer: one xyz per volcano.
    const positions = new Float32Array(features.length * 3);
    for (let i = 0; i < features.length; i++) {
        const [lng, lat] = features[i].geometry.coordinates;
        const v = geoToVec3(lat, lng, 0);
        positions[i * 3]     = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.computeBoundingSphere();

    const tex = createTriangleTexture(64);
    const mat = new PointsMaterial({
        map: tex,
        color: new Color(tuning.volcanoColor),
        size: tuning.volcanoSize,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        alphaTest: 0.5,
    });

    const points = new Points(geo, mat);
    points.renderOrder = 1;
    points.visible = !!tuning.showVolcanoes;
    points.userData = {
        _kind: 'volcano-points',
        features,                  // parallel array; intersection.index → feature
    };
    scene.add(points);

    // Live tuning. Track previous volcano-related values so we don't redo
    // work on unrelated tuning changes.
    let prevColor = tuning.volcanoColor;
    let prevSize  = tuning.volcanoSize;
    let prevShow  = tuning.showVolcanoes;
    onTuningChange((t) => {
        if (t.volcanoColor !== prevColor) {
            mat.color.set(t.volcanoColor);
            prevColor = t.volcanoColor;
        }
        if (t.volcanoSize !== prevSize) {
            mat.size = t.volcanoSize;
            prevSize = t.volcanoSize;
        }
        if (t.showVolcanoes !== prevShow) {
            points.visible = !!t.showVolcanoes;
            prevShow = t.showVolcanoes;
        }
    });

    return {
        points,
        features,
        getFeatureAt: (idx) => features[idx] || null,
    };
}
