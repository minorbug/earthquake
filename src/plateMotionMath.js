// src/plateMotionMath.js — pure math helpers for plate-motion vectors.
//
// Inputs/outputs are plain numbers and {x,y,z} bags; no Three.js so this
// is unit-testable under bun test.

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
// 1 deg/Myr at Earth radius = (R_km * π/180) km/Myr = ... mm/yr.
// km/Myr → mm/yr is a factor of 1e6 (km→mm) / 1e6 (Myr→yr) = 1.
// So mm/yr per (deg/Myr) = R_km * π/180.
const MM_PER_YR_PER_DEG_PER_MYR = EARTH_RADIUS_KM * DEG;

// Must match feed.js geoToVec3 convention so arrows overlay boundary lines.
const TEXTURE_EDGE_LNG = -180.806168;

function latLngToXyz(lat, lng) {
    const phi   = (90 - lat) * DEG;
    const theta = (180 - (lng - TEXTURE_EDGE_LNG)) * DEG;
    const sp = Math.sin(phi);
    return { x: sp * Math.cos(theta), y: Math.cos(phi), z: sp * Math.sin(theta) };
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function lengthXyz(v) {
    return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
    const L = lengthXyz(v);
    if (L === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/**
 * Build an indexed lookup over a flat list of pole entries.
 * Each entry is {a, b, lat, lng, rate} where rate is deg/Myr and
 * (a, b) means a rotates relative to b about the pole.
 */
export function buildPoleIndex(entries) {
    const map = new Map();
    for (const e of entries) {
        map.set(`${e.a}|${e.b}`, { ...e, sign: 1 });
    }
    return {
        lookup(a, b) {
            const direct = map.get(`${a}|${b}`);
            if (direct) return direct;
            const reverse = map.get(`${b}|${a}`);
            if (reverse) return { ...reverse, sign: -1 };
            return null;
        },
    };
}

/**
 * Great-circle arc distance in degrees between two lat/lng points.
 */
function arcDeg(lat1, lng1, lat2, lng2) {
    const phi1 = lat1 * DEG, phi2 = lat2 * DEG;
    const dLam = (lng2 - lng1) * DEG;
    const cosD = Math.sin(phi1) * Math.sin(phi2)
               + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLam);
    return Math.acos(Math.min(1, Math.max(-1, cosD))) / DEG;
}

/**
 * Slerp two lat/lng points by fraction t (0..1) along the great circle.
 */
function slerpLatLng(lat1, lng1, lat2, lng2, t) {
    const a = latLngToXyz(lat1, lng1);
    const b = latLngToXyz(lat2, lng2);
    const omega = Math.acos(Math.min(1, Math.max(-1, a.x*b.x + a.y*b.y + a.z*b.z)));
    if (omega < 1e-9) return { lat: lat1, lng: lng1 };
    const sinO = Math.sin(omega);
    const k1 = Math.sin((1 - t) * omega) / sinO;
    const k2 = Math.sin(t * omega) / sinO;
    const x = a.x * k1 + b.x * k2;
    const y = a.y * k1 + b.y * k2;
    const z = a.z * k1 + b.z * k2;
    return {
        lat: Math.asin(Math.min(1, Math.max(-1, y))) / DEG,
        lng: Math.atan2(z, x) / DEG,
    };
}

/**
 * Walk segments accumulating great-circle arc length; emit a sample each
 * time the running total crosses `spacingDeg`. Each sample carries the
 * segment's plate-pair, type, and surface-tangent direction at the
 * sample point.
 *
 * `segments` is an array of {coords:[[lng,lat],[lng,lat]], type, plateA, plateB}.
 * The lng/lat ordering matches GeoJSON.
 */
export function sampleBoundaries(segments, spacingDeg) {
    if (!(spacingDeg > 0)) return [];
    const samples = [];
    let acc = 0;
    let target = spacingDeg;
    for (const seg of segments) {
        const [[lngA, latA], [lngB, latB]] = seg.coords;
        const segLen = arcDeg(latA, lngA, latB, lngB);
        if (segLen < 1e-6) continue;
        // Walk this segment, emit samples while target falls within it.
        while (target <= acc + segLen + 1e-9) {
            const t = (target - acc) / segLen;
            const { lat, lng } = slerpLatLng(latA, lngA, latB, lngB, t);
            // Tangent vector in 3D: derivative of slerp wrt t at this point,
            // approximated via finite difference along the great circle.
            const eps = 1e-3;
            const t1 = Math.min(1, t + eps);
            const t0 = Math.max(0, t - eps);
            const p1 = slerpLatLng(latA, lngA, latB, lngB, t1);
            const p0 = slerpLatLng(latA, lngA, latB, lngB, t0);
            const a = latLngToXyz(p0.lat, p0.lng);
            const b = latLngToXyz(p1.lat, p1.lng);
            const tan = normalize({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
            samples.push({
                lat, lng,
                tangent: tan,
                plateA: seg.plateA,
                plateB: seg.plateB,
                type: seg.type,
            });
            target += spacingDeg;
        }
        acc += segLen;
    }
    return samples;
}

/**
 * Compute the surface-tangent velocity of plate `a` relative to plate `b`
 * at the given lat/lng. Returns {direction:{x,y,z}, magnitude} where
 * magnitude is in mm/yr. Returns null if the plate pair isn't in the table.
 */
export function velocityAt(poleIndex, a, b, lat, lng) {
    const e = poleIndex.lookup(a, b);
    if (!e) return null;
    // ω vector: pole direction × signed rate (deg/Myr).
    const axis = latLngToXyz(e.lat, e.lng);
    const omega = {
        x: axis.x * e.rate * e.sign,
        y: axis.y * e.rate * e.sign,
        z: axis.z * e.rate * e.sign,
    };
    // r is the unit position. v = ω × r is in deg/Myr (axis is unit length,
    // r is unit length, |v| has units of |ω| times sin(angle between)).
    const r = latLngToXyz(lat, lng);
    const vDeg = cross(omega, r);
    const magDeg = lengthXyz(vDeg);
    const magnitude = magDeg * MM_PER_YR_PER_DEG_PER_MYR;
    return { direction: normalize(vDeg), magnitude };
}
