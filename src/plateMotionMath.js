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

function latLngToXyz(lat, lng) {
    const phi = lat * DEG;
    const lam = lng * DEG;
    const cp = Math.cos(phi);
    return { x: cp * Math.cos(lam), y: Math.sin(phi), z: cp * Math.sin(lam) };
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
