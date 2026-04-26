// src/feed.js — USGS GeoJSON fetch + lat/lng/depth → Vector3 helper.
import { Vector3 } from 'three';

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';
const TEXTURE_EDGE_LNG = -180.806168;

export const EARTH_RADIUS = 6367;

export async function loadEarthquakes() {
    const r = await fetch(FEED_URL);
    if (!r.ok) throw new Error('USGS feed HTTP ' + r.status);
    const data = await r.json();
    return data.features.map((f) => ({
        title: f.properties.place,
        magnitude: f.properties.mag,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depth: f.geometry.coordinates[2], // km
    }));
}

export function geoToVec3(lat, lng, depthKm = 0) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * Math.PI / 180;
    const r = EARTH_RADIUS - depthKm;
    return new Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
    );
}
