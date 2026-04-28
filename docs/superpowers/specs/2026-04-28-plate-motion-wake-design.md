# Plate-Motion Wake Animation — Design

**Status:** approved 2026-04-28. Settings tuned interactively. Implementation next.

## Problem

The current plate-motion flow shader animates dashes drifting *along* the boundary line. That reads correctly on transform faults (where motion is along the line) but reads incorrectly on ridges and subduction zones, where the motion is *perpendicular* to the line. Result: dashes that "look like" motion but in the wrong direction half the time.

User feedback: "the lines aren't animating, they are blinking two different colors" — the constant motion plus the directional mismatch came across as visual noise rather than information.

## Visual concept

Replace the along-line dash drift with **per-side directional wakes** — soft elliptical bands that emerge near the boundary and propagate in the *correct* motion direction for that boundary class:

- **Divergent (ridges, OSR/CRB).** Wakes emerge at the line and expand outward on both sides, growing wider/longer along the line as they propagate, fading as they go. Cycle period inversely proportional to spreading rate.
- **Convergent (subduction, SUB/OCB/CCB).** Wakes appear far from the line, contract inward on both sides, shrink along the line, brighten on impact. Same cycle-period relationship.
- **Transform (strike-slip, OTF/CTF).** Wakes slide *along* the line in opposite directions on each side. Cycle period proportional to slip rate.

In all three cases the cycle period encodes magnitude (faster plate → faster pulses) — same data the dashed flow tried to convey, but now with directionally correct motion.

## Locked settings

Tuned interactively in the brainstorm tuner:

```json
{
  "lineWidth":     3,
  "bandThickness": 1.5,
  "travel":        38,
  "startW":        1.0,
  "endW":          2.0,
  "cycleFast":     3.0,
  "cycleSlow":     12.0,
  "concurrent":    3,
  "opacity":       0.20,
  "lightBoost":    0,
  "fadeIn":        0.08
}
```

Notes on the values:

- **Low opacity (0.2).** The wake should be ambient — present at the edge of attention, not the dominant signal. The arrows + colored line are the primary information.
- **Slow cycle (3 s for fast plates, 12 s for slow plates).** Fast enough to read as motion, slow enough to not feel busy. The 4× spread between fast and slow is the same dynamic range we want for magnitude perception.
- **Width grows from 1.0× → 2.0× along the line as the wake travels outward** — the "expanding ripple" feel.
- **Three concurrent wakes per side, evenly staggered** — gives a sense of continuous propagation without obvious "blinking."
- **No lightness boost (0%)** — base class colors are already at the right brightness; pumping them up would fight the lighter, low-opacity feel.

These map to shader uniforms / per-mesh constants in the implementation.

## Implementation sketch

For each boundary segment, render a **wake strip mesh** in addition to the existing colored boundary line. The strip is a thin rectangle of triangles oriented:

- For divergent / convergent: perpendicular to the boundary, with strip extent = `travel` (km) on each side. Strip vertices carry a `aPerpDist` attribute (signed distance from the line, in [-travel, +travel]) and an `aArcDist` attribute (along-line position).
- For transform: parallel to the boundary, with strip extent = `travel` along the line direction (effectively a thin rectangle following the line). Vertices carry `aArcDist` only.

Fragment shader (shared, with a uniform `uMode` for `div` / `con` / `tra`):

```glsl
// phase advances with time, scaled by per-segment magnitude
float phase = uTime * uSpeed;

// distance from the line (perpendicular for div/con; along-line for tra)
float d = uMode == TRA ? aArcDist : abs(aPerpDist);
float dn = d / uTravel;            // 0 at line, 1 at outer edge

// per-wake "age" within its cycle: shifted by which staggered wake we're in
float age = fract(phase + (dn * (uMode == CON ? 1.0 : -1.0)));   // direction sign

// envelope: ramp up to peak in fadeIn fraction, then linearly fade out
float env = smoothstep(0.0, uFadeIn, age) * (1.0 - smoothstep(uFadeIn, 1.0, age));

// width-along-line scale: 1.0 at start, 2.0 at end (interpolated by age, not dn,
// so the wake's geometric width grows over its lifetime)
float widthScale = mix(uStartW, uEndW, age);

// distance along the line, normalised to ±widthScale, used to mask the strip
// to its current shape — wake is bright in the middle, fades to zero at the
// scaled half-extent in the along-line direction
float alongMask = 1.0 - smoothstep(widthScale * 0.7, widthScale, abs(aAlongLineNormalised));

gl_FragColor = vec4(uColor, env * alongMask * uPeakOpacity);
```

Strip meshes can share the same shader; only their geometry orientation and `uMode` differ. Three strips can render concurrently per boundary side (staggered phases), or one strip with phase = `fract(uTime * uSpeed * N) / N` for each of N concurrent wakes — implementation detail.

## Per-segment magnitude

Reuse the existing per-group magnitude computation from `plateMotion.js`. Each boundary group gets a single `uSpeed` uniform driving its strips, so fast classes (East Pacific Rise, etc.) cycle visibly faster than slow ones — same trade-off as the prior flow shader.

If finer-grained per-segment animation is desired later, switch back to per-vertex `aSpeed` and use it instead of the group uniform — the shader doesn't otherwise change.

## Files touched

```
NEW
  src/plateWake.js          # the strip-mesh + shader for the wake animation
MODIFIED
  src/plateMotion.js        # build + update plateWake per group; replaces
                            # the current dashOffset animation
  src/atlas.js              # disable dashed mode on LineMaterial (the wakes
                            # take over the "motion" job)
  src/atlasTuning.js        # rename/repurpose flowSpeed → wakeSpeed,
                            # add wake-specific tunables
```

## Out of scope (follow-ups)

- **Per-segment magnitude.** Group-level for first cut; per-segment requires plumbing `aSpeed` per vertex through the strip geometry build.
- **GUI exposure of all 11 settings.** The locked values become hardcoded constants; expose only `wakeSpeed` and `wakeOpacity` (the two most likely to be live-tuned). Others stay as developer-tuned constants.
- **Curved strips that hug the sphere surface.** Initial implementation uses flat strips approximated to local tangent plane at each segment. For long boundary spans this could read flat against the curved orb; revisit if it's noticeable.

## Known limitations

- Pole-table coverage gaps from the parent feature still apply (~50% of segments have no Euler-pole entry, so they get no wake at all). Not addressed here.
- Each "wake" is conceptually a soft band at a single perpendicular distance from the line; there's no internal structure (no inner ripples, no chromatic gradient). Could be added later if the visual feels too uniform.
