// src/atlas.js — vector atlas (continents, antarctica, plate boundaries) on the globe.
import {
    Mesh,
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    DoubleSide,
    Color,
} from 'three';
import earcut from 'earcut';
import { geoToVec3 } from './feed.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';

import landJson from '../data/ne_110m_land.geojson' with { type: 'json' };
import antarcticaJson from '../data/ne_110m_antarctica.geojson' with { type: 'json' };
// (PB2002 import is added in Task 4)

const LAND_RADIUS_FACTOR = 1.0005;

// ---- Polygon → triangulated sphere mesh ----

function buildPolygonGeometry(featureCollection, radiusKm) {
    // Each feature is a Polygon or MultiPolygon. Earcut each polygon's rings,
    // project lat/lng to sphere, accumulate into one BufferGeometry.
    const positions = []; // flat [x,y,z, x,y,z, ...]
    const indices  = [];

    for (const feature of featureCollection.features) {
        const g = feature.geometry;
        const polygons = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];

        for (const polygon of polygons) {
            // polygon = [outerRing, ...holes], each ring = [[lng, lat], ...]
            const flat = [];
            const holeIndices = [];
            for (let r = 0; r < polygon.length; r++) {
                if (r > 0) holeIndices.push(flat.length / 2);
                for (const [lng, lat] of polygon[r]) {
                    flat.push(lng, lat);
                }
            }
            const triangles = earcut(flat, holeIndices, 2);

            const baseVertex = positions.length / 3;
            for (let i = 0; i < flat.length; i += 2) {
                const v = geoToVec3(flat[i + 1], flat[i], 0); // (lat, lng, depth=0)
                v.normalize().multiplyScalar(radiusKm);
                positions.push(v.x, v.y, v.z);
            }
            for (const ti of triangles) indices.push(baseVertex + ti);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

// ---- Public entry ----

export function loadAtlas({ scene, radius }) {
    const landRadius = radius * LAND_RADIUS_FACTOR;

    const landGeo       = buildPolygonGeometry(landJson, landRadius);
    const antarcticaGeo = buildPolygonGeometry(antarcticaJson, landRadius);

    const landMat = new MeshBasicMaterial({
        color: new Color(atlasTuning.landColor),
        side: DoubleSide,
    });
    const antarcticaMat = new MeshBasicMaterial({
        color: new Color(atlasTuning.antarcticaColor),
        side: DoubleSide,
    });

    const land       = new Mesh(landGeo, landMat);
    const antarctica = new Mesh(antarcticaGeo, antarcticaMat);
    land.renderOrder       = 1;
    antarctica.renderOrder = 1;
    scene.add(land);
    scene.add(antarctica);

    onAtlasColorChange((t) => {
        landMat.color.set(t.landColor);
        antarcticaMat.color.set(t.antarcticaColor);
    });
    onAtlasVisibilityChange((t) => {
        land.visible       = t.showLand;
        antarctica.visible = t.showLand;
    });

    return { land, antarctica, boundaryGroups: [] };
}
