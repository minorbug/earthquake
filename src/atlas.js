// src/atlas.js — vector atlas (continents, antarctica, plate boundaries) on the globe.
import {
    Mesh,
    BufferGeometry,
    BufferAttribute,
    MeshBasicMaterial,
    LineSegments,
    LineBasicMaterial,
    DoubleSide,
    Color,
} from 'three';
import earcut from 'earcut';
import { geoToVec3 } from './feed.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';

import landJson from '../data/ne_110m_land.geojson' with { type: 'json' };
import antarcticaJson from '../data/ne_110m_antarctica.geojson' with { type: 'json' };
import boundariesJson from '../data/pb2002_boundaries.geojson' with { type: 'json' };

const LAND_RADIUS_FACTOR = 1.0005;
const BOUNDARY_RADIUS_FACTOR = 1.001;

// PB2002 type code → which tuning palette key + extra alpha multiplier
const BOUNDARY_GROUPS = [
    { key: 'ridge',     types: ['OSR', 'CRB'],            colorKey: 'ridgeColor',     alphaMult: 1.0 },
    { key: 'transform', types: ['OTF', 'CTF'],            colorKey: 'transformColor', alphaMult: 1.0 },
    { key: 'sub',       types: ['SUB'],                   colorKey: 'subColor',       alphaMult: 1.4 },
    { key: 'conv',      types: ['OCB', 'CCB'],            colorKey: 'subColor',       alphaMult: 1.0 },
    // any feature whose Type is none of the above falls into 'other'
];

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

// ---- Line → sphere line segments ----

function buildLineGeometry(features, radiusKm) {
    const positions = []; // flat segment pairs

    for (const feature of features) {
        const coords = feature.geometry.coordinates; // [[lng, lat], ...]
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng0, lat0] = coords[i];
            const [lng1, lat1] = coords[i + 1];
            const a = geoToVec3(lat0, lng0, 0).normalize().multiplyScalar(radiusKm);
            const b = geoToVec3(lat1, lng1, 0).normalize().multiplyScalar(radiusKm);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    return geo;
}

// ---- Public entry ----

export function loadAtlas({ scene, radius }) {
    const landRadius     = radius * LAND_RADIUS_FACTOR;
    const boundaryRadius = radius * BOUNDARY_RADIUS_FACTOR;

    // ----- Land + Antarctica (Task 3) -----
    const landGeo       = buildPolygonGeometry(landJson, landRadius);
    const antarcticaGeo = buildPolygonGeometry(antarcticaJson, landRadius);
    const landMat       = new MeshBasicMaterial({ color: new Color(atlasTuning.landColor),       side: DoubleSide });
    const antarcticaMat = new MeshBasicMaterial({ color: new Color(atlasTuning.antarcticaColor), side: DoubleSide });
    const land          = new Mesh(landGeo, landMat);
    const antarctica    = new Mesh(antarcticaGeo, antarcticaMat);
    land.renderOrder = 1;
    antarctica.renderOrder = 1;
    scene.add(land);
    scene.add(antarctica);

    // ----- Plate boundaries (this task) -----
    // Bucket features by group
    const otherFeatures = [];
    const groupedFeatures = Object.fromEntries(BOUNDARY_GROUPS.map((g) => [g.key, []]));
    for (const f of boundariesJson.features) {
        const t = (f.properties && f.properties.Type) || '';
        const grp = BOUNDARY_GROUPS.find((g) => g.types.includes(t));
        if (grp) groupedFeatures[grp.key].push(f);
        else otherFeatures.push(f);
    }

    const boundaryGroups = [];
    for (const g of BOUNDARY_GROUPS) {
        const geo = buildLineGeometry(groupedFeatures[g.key], boundaryRadius);
        const mat = new LineBasicMaterial({
            color: new Color(atlasTuning[g.colorKey]),
            transparent: true,
            opacity: Math.min(1, atlasTuning.boundaryWidth * g.alphaMult),
        });
        const lines = new LineSegments(geo, mat);
        lines.renderOrder = 2;
        scene.add(lines);
        boundaryGroups.push({ key: g.key, colorKey: g.colorKey, alphaMult: g.alphaMult, material: mat, mesh: lines });
    }
    // 'other' bucket
    const otherGeo = buildLineGeometry(otherFeatures, boundaryRadius);
    const otherMat = new LineBasicMaterial({
        color: new Color(atlasTuning.otherColor),
        transparent: true,
        opacity: atlasTuning.otherAlpha * atlasTuning.boundaryWidth,
    });
    const otherLines = new LineSegments(otherGeo, otherMat);
    otherLines.renderOrder = 2;
    scene.add(otherLines);
    boundaryGroups.push({ key: 'other', colorKey: 'otherColor', alphaMult: 1.0, material: otherMat, mesh: otherLines, isOther: true });

    // ----- Live tuning -----
    onAtlasColorChange((t) => {
        landMat.color.set(t.landColor);
        antarcticaMat.color.set(t.antarcticaColor);
        for (const g of boundaryGroups) {
            g.material.color.set(t[g.colorKey]);
            const baseAlpha = g.isOther ? t.otherAlpha : 1.0;
            g.material.opacity = Math.min(1, baseAlpha * t.boundaryWidth * g.alphaMult);
        }
    });
    onAtlasVisibilityChange((t) => {
        land.visible       = t.showLand;
        antarctica.visible = t.showLand;
        for (const g of boundaryGroups) g.mesh.visible = t.showBoundaries;
    });

    return { land, antarctica, boundaryGroups };
}
