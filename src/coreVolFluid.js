// src/coreVolFluid.js — volumetric magma plume layer driven by a real 2D
// fluid simulation.
//
// Two-layer architecture:
//   1. Stam-style 2D fluid (advection + buoyancy + damping) on a 192x96
//      equirectangular grid. Velocity (RG) and dye (R) live in their own
//      ping-pong WebGLRenderTargets. Hot spots inject dye and a vertical
//      kick; advection carries dye/velocity per the velocity field; buoyancy
//      lifts dye-rich cells in the +v direction (= world +Y on the sphere).
//   2. A spherical shell mesh (innerR → innerR*1.35) with a fragment shader
//      that raymarches camera→fragment, samples the 2D dye texture by
//      converting each 3D sample to equirectangular UV, and accumulates
//      additive emission with a radial profile. The dye field is "extruded"
//      radially with a falloff, so plumes appear as 3D volumetric flows
//      rising out of the core surface — extending past the previously-hard
//      silhouette into the surrounding mantle space.
//
// Why this fixes the hard break: the plumes render OUTSIDE the core
// silhouette (within the shell) as soft volumetric emission. The orb's
// edge dissolves into the brightness of rising dye.

import {
    Mesh,
    SphereGeometry,
    PlaneGeometry,
    ShaderMaterial,
    WebGLRenderTarget,
    OrthographicCamera,
    Scene,
    Vector2,
    Vector3,
    Color,
    HalfFloatType,
    RGBAFormat,
    LinearFilter,
    RepeatWrapping,
    ClampToEdgeWrapping,
    BackSide,
    AdditiveBlending,
} from 'three';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';

const SIM_W = 192;
const SIM_H = 96;
const MAX_HOTSPOTS = 16;
const SHELL_FACTOR = 1.35;       // outerR = innerR * SHELL_FACTOR (must stay inside crust)

function makeRT(w, h) {
    return new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        format: RGBAFormat,
        magFilter: LinearFilter,
        minFilter: LinearFilter,
        wrapS: RepeatWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
    });
}

const fullScreenVert = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

// Velocity update: advect by self + apply buoyancy from dye + hotspot kick + damping.
const velocityUpdateFrag = /* glsl */`
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D dye;
    uniform float dt;
    uniform float damping;
    uniform float buoyancy;
    uniform float hotspotBuoyancy;
    uniform float hotspotRadius;
    uniform vec3 hotspots[${MAX_HOTSPOTS}];
    uniform vec2 res;
    varying vec2 vUv;

    void main() {
        vec2 vel = texture2D(velocity, vUv).rg;
        // Semi-Lagrangian advection: where did this parcel come from?
        vec2 prev = vUv - vel * dt / res;
        vec2 advected = texture2D(velocity, prev).rg;

        float d = texture2D(dye, vUv).r;
        vec2 force = vec2(0.0, buoyancy * d);

        for (int i = 0; i < ${MAX_HOTSPOTS}; i++) {
            float intensity = hotspots[i].z;
            if (intensity <= 0.0) continue;
            vec2 dvec = vUv - hotspots[i].xy;
            dvec.x = dvec.x - floor(dvec.x + 0.5);
            float r = length(dvec) / hotspotRadius;
            force.y += hotspotBuoyancy * intensity * exp(-r * r);
        }

        vec2 newVel = advected + force * dt;
        newVel *= max(0.0, 1.0 - damping * dt);
        gl_FragColor = vec4(newVel, 0.0, 1.0);
    }
`;

// Dye update: advect by velocity + inject from hot spots + slow decay.
const dyeUpdateFrag = /* glsl */`
    precision highp float;
    uniform sampler2D velocity;
    uniform sampler2D dye;
    uniform float dt;
    uniform float decay;
    uniform float injectStrength;
    uniform float hotspotRadius;
    uniform vec3 hotspots[${MAX_HOTSPOTS}];
    uniform vec2 res;
    varying vec2 vUv;

    void main() {
        vec2 vel = texture2D(velocity, vUv).rg;
        vec2 prev = vUv - vel * dt / res;
        float advected = texture2D(dye, prev).r;

        float inj = 0.0;
        for (int i = 0; i < ${MAX_HOTSPOTS}; i++) {
            float intensity = hotspots[i].z;
            if (intensity <= 0.0) continue;
            vec2 dvec = vUv - hotspots[i].xy;
            dvec.x = dvec.x - floor(dvec.x + 0.5);
            float r = length(dvec) / hotspotRadius;
            inj += injectStrength * intensity * exp(-r * r);
        }

        float newDye = advected + inj * dt;
        newDye *= max(0.0, 1.0 - decay * dt);
        gl_FragColor = vec4(clamp(newDye, 0.0, 4.0), 0.0, 0.0, 1.0);
    }
`;

const raymarchVert = /* glsl */`
    varying vec3 vWorldPos;
    void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
    }
`;

const raymarchFrag = /* glsl */`
    precision highp float;
    uniform sampler2D dyeMap;
    uniform float innerRadius;
    uniform float outerRadius;
    uniform float intensity;
    uniform float time;
    uniform vec3 hotColor;
    uniform vec3 coolColor;
    varying vec3 vWorldPos;

    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float vnoise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i),                     hash(i + vec3(1.0,0.0,0.0)), u.x),
                mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), u.x), u.y),
            mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), u.x),
                mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), u.x), u.y),
            u.z
        );
    }

    vec2 dirToUv(vec3 n) {
        return vec2(atan(n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
    }

    bool raySphere(vec3 ro, vec3 rd, float R, out float tNear, out float tFar) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - R * R;
        float disc = b * b - c;
        if (disc < 0.0) return false;
        float s = sqrt(disc);
        tNear = -b - s;
        tFar  = -b + s;
        return true;
    }

    void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorldPos - ro);

        float tOuterNear, tOuterFar;
        if (!raySphere(ro, rd, outerRadius, tOuterNear, tOuterFar)) discard;
        float tInnerNear, tInnerFar;
        bool hitsInner = raySphere(ro, rd, innerRadius, tInnerNear, tInnerFar);

        float tStart = max(tOuterNear, 0.0);
        float tEnd   = (hitsInner && tInnerNear > 0.0) ? min(tInnerNear, tOuterFar) : tOuterFar;
        if (tEnd <= tStart) discard;

        const int STEPS = 40;
        float stepSize = (tEnd - tStart) / float(STEPS);
        // Cheap dither so we don't see stepped banding.
        float jitter = hash(vec3(gl_FragCoord.xy, fract(time))) * stepSize;

        vec3 accumColor = vec3(0.0);
        float accumA = 0.0;

        for (int i = 0; i < STEPS; i++) {
            float t = tStart + jitter + stepSize * float(i);
            if (t > tEnd) break;
            vec3 p = ro + rd * t;
            float r = length(p);
            if (r < innerRadius) break;

            vec3 nrm = p / r;
            vec2 uv = dirToUv(nrm);
            float dye = texture2D(dyeMap, uv).r;
            if (dye < 0.005) continue;

            float altitude = (r - innerRadius) / (outerRadius - innerRadius);
            // Plumes are full at the surface, taper off with altitude.
            float profile = pow(1.0 - altitude, 1.6);
            // Fine 3D noise so the plume isn't a smooth radial extrusion;
            // gives flickering, billowing detail that reads as flame/magma.
            float detail = vnoise(p * 0.0014 + vec3(0.0, time * 0.25, 0.0));
            detail = mix(0.45, 1.0, detail);

            float density = dye * profile * detail * intensity;
            float heatT = clamp(dye * profile, 0.0, 1.0);
            vec3 col = mix(coolColor, hotColor, heatT);

            float alpha = density * stepSize * 0.004;
            alpha = clamp(alpha, 0.0, 0.7);
            accumColor += (1.0 - accumA) * col * alpha * 30.0;
            accumA    += (1.0 - accumA) * alpha;
            if (accumA > 0.97) break;
        }

        if (accumA < 0.001) discard;
        gl_FragColor = vec4(accumColor, accumA);
    }
`;

class StamFluid2D {
    constructor(renderer, w, h) {
        this.renderer = renderer;
        this.w = w; this.h = h;
        this.velRT = [makeRT(w, h), makeRT(w, h)];
        this.dyeRT = [makeRT(w, h), makeRT(w, h)];
        this.velIdx = 0;
        this.dyeIdx = 0;

        // Initialise both sets of RTs to zero so half-float buffers don't
        // start full of GPU-allocator garbage.
        const prevTarget = renderer.getRenderTarget();
        for (const rt of [...this.velRT, ...this.dyeRT]) {
            renderer.setRenderTarget(rt);
            renderer.clear();
        }
        renderer.setRenderTarget(prevTarget);

        this.scene = new Scene();
        this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new Mesh(new PlaneGeometry(2, 2));
        this.scene.add(this.quad);

        this.velMat = new ShaderMaterial({
            vertexShader: fullScreenVert,
            fragmentShader: velocityUpdateFrag,
            uniforms: {
                velocity:        { value: null },
                dye:             { value: null },
                dt:              { value: 0.05 },
                damping:         { value: 0.35 },
                buoyancy:        { value: 3.0 },
                hotspotBuoyancy: { value: 12.0 },
                hotspotRadius:   { value: 0.04 },
                hotspots:        { value: Array.from({ length: MAX_HOTSPOTS }, () => new Vector3()) },
                res:             { value: new Vector2(w, h) },
            },
        });

        this.dyeMat = new ShaderMaterial({
            vertexShader: fullScreenVert,
            fragmentShader: dyeUpdateFrag,
            uniforms: {
                velocity:       { value: null },
                dye:            { value: null },
                dt:             { value: 0.05 },
                decay:          { value: 0.32 },
                injectStrength: { value: 22.0 },
                hotspotRadius:  { value: 0.04 },
                hotspots:       { value: Array.from({ length: MAX_HOTSPOTS }, () => new Vector3()) },
                res:            { value: new Vector2(w, h) },
            },
        });
    }

    runPass(material, target) {
        this.quad.material = material;
        const prevTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.cam);
        this.renderer.setRenderTarget(prevTarget);
    }

    step(dt, hotspotsArr) {
        const velSrc = this.velRT[this.velIdx].texture;
        const dyeSrc = this.dyeRT[this.dyeIdx].texture;

        this.velMat.uniforms.velocity.value = velSrc;
        this.velMat.uniforms.dye.value = dyeSrc;
        this.velMat.uniforms.dt.value = dt;
        this.velMat.uniforms.hotspots.value = hotspotsArr;
        this.runPass(this.velMat, this.velRT[1 - this.velIdx]);
        this.velIdx = 1 - this.velIdx;

        const newVelSrc = this.velRT[this.velIdx].texture;
        this.dyeMat.uniforms.velocity.value = newVelSrc;
        this.dyeMat.uniforms.dye.value = dyeSrc;
        this.dyeMat.uniforms.dt.value = dt;
        this.dyeMat.uniforms.hotspots.value = hotspotsArr;
        this.runPass(this.dyeMat, this.dyeRT[1 - this.dyeIdx]);
        this.dyeIdx = 1 - this.dyeIdx;
    }

    getDyeTexture() {
        return this.dyeRT[this.dyeIdx].texture;
    }
}

export function loadCoreVolFluid({ scene, renderer }) {
    const fluid = new StamFluid2D(renderer, SIM_W, SIM_H);

    const innerR = atlasTuning.coreRadius;
    const outerR = innerR * SHELL_FACTOR;

    const mat = new ShaderMaterial({
        vertexShader: raymarchVert,
        fragmentShader: raymarchFrag,
        uniforms: {
            dyeMap:      { value: fluid.getDyeTexture() },
            innerRadius: { value: innerR },
            outerRadius: { value: outerR },
            intensity:   { value: 1.0 },
            time:        { value: 0 },
            hotColor:    { value: new Color(atlasTuning.coreHotColor) },
            coolColor:   { value: new Color(atlasTuning.coreCoolColor) },
        },
        transparent: true,
        depthTest: false,    // volumetric back-face is behind the orb in z;
        depthWrite: false,   // we want the accumulated emission painted over
        side: BackSide,      // the orb regardless. Raymarch already terminates
        blending: AdditiveBlending,  // at the core surface from inside.
    });

    let currentRadius = innerR;
    const geo = new SphereGeometry(outerR, 64, 32);
    const mesh = new Mesh(geo, mat);
    mesh.visible = atlasTuning.coreEnabled;
    mesh.renderOrder = 1;
    scene.add(mesh);

    const hotspots = [];
    const hotspotUniformArr = Array.from({ length: MAX_HOTSPOTS }, () => new Vector3());
    let lastT = 0;
    let pendingDt = 0;
    const cfg = {
        spawnRate: 3.2,
        intensityRange: [0.6, 1.0],
        lifetimeRange: [1.3, 2.4],
    };

    function spawnHotspot() {
        // Bias longitude toward the camera-facing hemisphere (u ≈ 0.5 is
        // +X; default camera looks roughly +X) so plumes spawn where they're
        // visible rather than wasted on the far side. Uniform-on-sphere v
        // away from the poles.
        const u_ = 0.25 + 0.5 * Math.random();
        const cosTheta = 0.7 - 1.4 * Math.random();
        const v_ = Math.acos(cosTheta) / Math.PI;
        hotspots.push({
            u: u_,
            v: v_,
            intensity: cfg.intensityRange[0] + (cfg.intensityRange[1] - cfg.intensityRange[0]) * Math.random(),
            lifetime: cfg.lifetimeRange[0] + (cfg.lifetimeRange[1] - cfg.lifetimeRange[0]) * Math.random(),
            age: 0,
        });
    }

    function update(t) {
        const dt = lastT === 0 ? 0.016 : Math.min(t - lastT, 0.06);
        lastT = t;

        for (const hs of hotspots) hs.age += dt;
        for (let i = hotspots.length - 1; i >= 0; i--) {
            if (hotspots[i].age > hotspots[i].lifetime) hotspots.splice(i, 1);
        }
        pendingDt += dt;
        while (pendingDt > 0 && hotspots.length < MAX_HOTSPOTS) {
            const interval = -Math.log(1 - Math.random()) / cfg.spawnRate;
            if (interval > pendingDt) break;
            pendingDt -= interval;
            spawnHotspot();
        }
        if (hotspots.length >= MAX_HOTSPOTS) pendingDt = 0;

        for (let i = 0; i < MAX_HOTSPOTS; i++) {
            const hs = hotspots[i];
            if (hs) {
                const tn = hs.age / hs.lifetime;
                hotspotUniformArr[i].set(hs.u, hs.v, hs.intensity * Math.sin(tn * Math.PI));
            } else {
                hotspotUniformArr[i].set(0, 0, 0);
            }
        }

        // 2 sub-steps per frame so the sim moves visibly faster than 1×dt
        // would deliver.
        const SUB = 2;
        const subDt = dt / SUB;
        for (let i = 0; i < SUB; i++) fluid.step(subDt, hotspotUniformArr);

        mat.uniforms.dyeMap.value = fluid.getDyeTexture();
        mat.uniforms.time.value = t;
    }

    onAtlasColorChange((tn) => {
        mat.uniforms.hotColor.value.set(tn.coreHotColor);
        mat.uniforms.coolColor.value.set(tn.coreCoolColor);
        if (tn.coreRadius !== currentRadius) {
            currentRadius = tn.coreRadius;
            const newOuter = currentRadius * SHELL_FACTOR;
            mat.uniforms.innerRadius.value = currentRadius;
            mat.uniforms.outerRadius.value = newOuter;
            mesh.geometry.dispose();
            mesh.geometry = new SphereGeometry(newOuter, 64, 32);
        }
    });
    onAtlasVisibilityChange((tn) => {
        mesh.visible = tn.coreEnabled;
    });

    // Pre-warm: spin the sim with a few hot spots so the page loads with
    // established plumes rather than a quiet first second.
    for (let i = 0; i < 5; i++) spawnHotspot();
    for (let warm = 0; warm < 60; warm++) {
        for (let i = 0; i < MAX_HOTSPOTS; i++) {
            const hs = hotspots[i];
            if (hs) {
                hs.age += 0.04;
                const tn = Math.min(hs.age / hs.lifetime, 1.0);
                hotspotUniformArr[i].set(hs.u, hs.v, hs.intensity * Math.sin(tn * Math.PI));
            } else {
                hotspotUniformArr[i].set(0, 0, 0);
            }
        }
        fluid.step(0.04, hotspotUniformArr);
        // Drop expired and occasionally spawn during pre-warm too.
        for (let i = hotspots.length - 1; i >= 0; i--) {
            if (hotspots[i].age > hotspots[i].lifetime) hotspots.splice(i, 1);
        }
        if (warm % 12 === 0 && hotspots.length < MAX_HOTSPOTS) spawnHotspot();
    }
    mat.uniforms.dyeMap.value = fluid.getDyeTexture();

    if (typeof window !== 'undefined') {
        window.__eqVolDebug = {
            sim: fluid,
            material: mat.uniforms,
            cfg,
            spawnHotspot,
            getHotspots: () => hotspots,
        };
    }

    return { mesh, update };
}
