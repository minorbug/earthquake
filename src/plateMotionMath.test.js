import { test, expect } from 'bun:test';
import { buildPoleIndex, velocityAt } from './plateMotionMath.js';

const TABLE = [
    {"a": "PA", "b": "NA", "lat": 50.0, "lng": -73.6, "rate": 0.749},
    {"a": "AF", "b": "EU", "lat": 21.0, "lng": -20.6, "rate": 0.118},
];

test('buildPoleIndex - lookup in stored direction', () => {
    const idx = buildPoleIndex(TABLE);
    const e = idx.lookup('PA', 'NA');
    expect(e).not.toBeNull();
    expect(e.lat).toBe(50.0);
    expect(e.rate).toBe(0.749);
    expect(e.sign).toBe(1);
});

test('buildPoleIndex - lookup in reverse direction flips sign', () => {
    const idx = buildPoleIndex(TABLE);
    const e = idx.lookup('NA', 'PA');
    expect(e).not.toBeNull();
    expect(e.sign).toBe(-1);
});

test('buildPoleIndex - unknown pair returns null', () => {
    const idx = buildPoleIndex(TABLE);
    expect(idx.lookup('FOO', 'BAR')).toBeNull();
});

test('velocityAt - PA-NA at San Francisco gives ~50 mm/yr', () => {
    // SF is at ~37.8°N, -122.4°E; San Andreas is right-lateral at ~50 mm/yr.
    const idx = buildPoleIndex(TABLE);
    const v = velocityAt(idx, 'PA', 'NA', 37.8, -122.4);
    expect(v).not.toBeNull();
    expect(v.magnitude).toBeGreaterThan(35);
    expect(v.magnitude).toBeLessThan(65);
    // Direction should be a unit vector
    const len = Math.hypot(v.direction.x, v.direction.y, v.direction.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
});

test('velocityAt - unknown pair returns null', () => {
    const idx = buildPoleIndex(TABLE);
    expect(velocityAt(idx, 'FOO', 'BAR', 0, 0)).toBeNull();
});

test('velocityAt - swapping plates flips the direction', () => {
    const idx = buildPoleIndex(TABLE);
    const a = velocityAt(idx, 'PA', 'NA', 37.8, -122.4);
    const b = velocityAt(idx, 'NA', 'PA', 37.8, -122.4);
    // Same magnitude
    expect(Math.abs(a.magnitude - b.magnitude)).toBeLessThan(0.01);
    // Opposite direction
    expect(a.direction.x).toBeCloseTo(-b.direction.x, 5);
    expect(a.direction.y).toBeCloseTo(-b.direction.y, 5);
    expect(a.direction.z).toBeCloseTo(-b.direction.z, 5);
});
