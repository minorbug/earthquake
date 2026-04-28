// src/coreFluid.js — magma core driven by a real heightfield fluid sim.
//
// A 256×128 equirectangular heightmap (height in R, velocity in G) is updated
// by a wave-equation kernel with buoyancy (sustained injection from JS-side
// hotspots) and viscous damping. The displaced sphere is rendered with the
// FBM magma fragment shader from src/core.js — the heightfield only changes
// vertex positions and a "plume tip glow" rim term, so the existing molten
// surface texture survives.
//
// Numerical stability: discrete wave eq's CFL bound is waveSpeedSq*dt² < 4.
// Defaults waveSpeedSq=0.18, dt=0.5 → 0.045, well inside.
import {
    Mesh,
    SphereGeometry,
    ShaderMaterial,
    Color,
    Vector3,
    RepeatWrapping,
    ClampToEdgeWrapping,
    LinearFilter,
} from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { atlasTuning, onAtlasColorChange, onAtlasVisibilityChange } from './atlasTuning.js';

const SIM_W = 256;
const SIM_H = 128;
const MAX_HOTSPOTS = 8;

// --- compute kernel: 1 timestep of (wave eq + buoyancy + damping) -----------
// state.r = height, state.g = vertical velocity. Hotspots are vec3(uv.x, uv.y,
// intensity); intensity ≤ 0 means "slot empty." Horizontal sampling auto-wraps
// because the variable's wrapS = RepeatWrapping; vertical clamps at the poles.
const heightShader = /* glsl */`
    uniform float dt;
    uniform float waveSpeedSq;
    uniform float damping;
    uniform float heightDecay;
    uniform float buoyancy;
    uniform float hotspotRadius;
    uniform vec3  hotspots[${MAX_HOTSPOTS}];

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec2 texel = 1.0 / resolution.xy;

        vec4 here = texture2D(textureState, uv);
        float h = here.r;
        float v = here.g;

        float hL = texture2D(textureState, uv + vec2(-texel.x, 0.0)).r;
        float hR = texture2D(textureState, uv + vec2( texel.x, 0.0)).r;
        float hD = texture2D(textureState, uv + vec2(0.0, -texel.y)).r;
        float hU = texture2D(textureState, uv + vec2(0.0,  texel.y)).r;
        float laplacian = (hL + hR + hD + hU) - 4.0 * h;

        // Wrap-aware Gaussian heat from each active hot spot.
        float heat = 0.0;
        for (int i = 0; i < ${MAX_HOTSPOTS}; i++) {
            float intensity = hotspots[i].z;
            if (intensity <= 0.0) continue;
            vec2 d = uv - hotspots[i].xy;
            d.x = d.x - floor(d.x + 0.5);
            float r = length(d) / hotspotRadius;
            heat += intensity * exp(-r * r);
        }

        // Buoyancy is gated by (1 - h) so heat stops lifting once a plume
        // reaches its terminal height; without this the integrator runs away
        // and merges every hot spot into a single saturating tongue.
        float dv = waveSpeedSq * laplacian + buoyancy * heat * max(0.0, 1.0 - h) - damping * v;
        v += dv * dt;
        h += v * dt;
        h *= heightDecay;
        h = clamp(h, -0.6, 1.2);

        gl_FragColor = vec4(h, v, 0.0, 1.0);
    }
`;

// --- sphere material: vertex displacement + FBM magma surface ---------------
const vertShader = /* glsl */`
    uniform sampler2D heightMap;
    uniform float displacementScale;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vHeight;

    void main() {
        vec3 n = normalize(position);
        // Equirectangular UV; matches the kernel's gl_FragCoord-based grid.
        float lng = atan(n.z, n.x);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        vec2 uv = vec2(lng / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
        float h = texture2D(heightMap, uv).r;
        vHeight = h;
        vec3 displaced = position + n * h * displacementScale;
        vec4 wp = modelMatrix * vec4(displaced, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * wp;
    }
`;

const fragShader = /* glsl */`
    precision highp float;
    uniform float time;
    uniform float brightness;
    uniform float rimBoost;
    uniform float plumeBoost;
    uniform float debugHeight;
    uniform vec3  hotColor;
    uniform vec3  coolColor;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vHeight;

    float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    }
    float vnoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i),                      hash(i + vec3(1.0,0.0,0.0)), u.x),
                mix(hash(i + vec3(0.0,1.0,0.0)),  hash(i + vec3(1.0,1.0,0.0)), u.x), u.y),
            mix(mix(hash(i + vec3(0.0,0.0,1.0)),  hash(i + vec3(1.0,0.0,1.0)), u.x),
                mix(hash(i + vec3(0.0,1.0,1.0)),  hash(i + vec3(1.0,1.0,1.0)), u.x), u.y),
            u.z
        );
    }
    float fbm(vec3 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
        return v;
    }

    void main() {
        vec3 np = vWorldPos * 0.0012;
        np.y -= time * 0.3;
        float n = fbm(np);
        float n2 = fbm(vWorldPos * 0.0004 + vec3(0.0, time * -0.08, 0.0));
        float blend = smoothstep(0.35, 0.75, n * 0.6 + n2 * 0.4);
        vec3 col = mix(coolColor, hotColor, blend);

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(vWorldNormal, viewDir));
        float rim = pow(1.0 - ndv, 2.0);
        col += hotColor * rim * rimBoost;

        // Plume tips glow extra hot.
        col += hotColor * max(vHeight, 0.0) * plumeBoost;

        if (debugHeight > 0.5) {
            // Red = positive height, blue = negative, green = magnitude.
            gl_FragColor = vec4(max(vHeight, 0.0), abs(vHeight) * 0.4, max(-vHeight, 0.0), 1.0);
            return;
        }
        gl_FragColor = vec4(col * brightness, 1.0);
    }
`;

// --- public ----------------------------------------------------------------
export function loadCoreFluid({ scene, renderer }) {
    const gpu = new GPUComputationRenderer(SIM_W, SIM_H, renderer);
    const initTex = gpu.createTexture();
    const stateVar = gpu.addVariable('textureState', heightShader, initTex);
    gpu.setVariableDependencies(stateVar, [stateVar]);
    stateVar.wrapS = RepeatWrapping;
    stateVar.wrapT = ClampToEdgeWrapping;
    stateVar.minFilter = LinearFilter;
    stateVar.magFilter = LinearFilter;

    const u = stateVar.material.uniforms;
    u.dt              = { value: 0.20 };
    u.waveSpeedSq     = { value: 0.06 };
    u.damping         = { value: 0.18 };
    u.heightDecay     = { value: 0.96 };
    u.buoyancy        = { value: 0.45 };
    u.hotspotRadius   = { value: 0.045 };
    u.hotspots        = {
        value: Array.from({ length: MAX_HOTSPOTS }, () => new Vector3()),
    };

    const initErr = gpu.init();
    if (initErr !== null) console.error('coreFluid GPGPU init:', initErr);

    const mat = new ShaderMaterial({
        uniforms: {
            heightMap:         { value: null },
            displacementScale: { value: 720 },
            time:              { value: 0 },
            brightness:        { value: atlasTuning.coreBrightness },
            rimBoost:          { value: atlasTuning.coreRimBoost },
            plumeBoost:        { value: 0.45 },
            debugHeight:       { value: 0.0 },
            hotColor:          { value: new Color(atlasTuning.coreHotColor) },
            coolColor:         { value: new Color(atlasTuning.coreCoolColor) },
        },
        vertexShader: vertShader,
        fragmentShader: fragShader,
    });

    let currentRadius = atlasTuning.coreRadius;
    const geo = new SphereGeometry(currentRadius, 192, 96);
    const mesh = new Mesh(geo, mat);
    mesh.visible = atlasTuning.coreEnabled;
    mesh.renderOrder = -1;
    scene.add(mesh);

    // --- hot-spot lifecycle ---
    const hotspots = [];
    let lastT = 0;
    let pendingDt = 0;
    const cfg = {
        spawnRate: 0.9,         // average hot spots per second
        intensityRange: [0.4, 0.85],
        lifetimeRange: [1.5, 3.0],
    };

    function spawnHotspot() {
        // Uniform on sphere → uniform u, arccos-distributed v.
        const u_ = Math.random();
        const cosTheta = 1 - 2 * Math.random();
        const v_ = Math.acos(cosTheta) / Math.PI;
        const intensity = cfg.intensityRange[0]
            + (cfg.intensityRange[1] - cfg.intensityRange[0]) * Math.random();
        const lifetime = cfg.lifetimeRange[0]
            + (cfg.lifetimeRange[1] - cfg.lifetimeRange[0]) * Math.random();
        hotspots.push({ u: u_, v: v_, intensity, lifetime, age: 0 });
    }

    function update(t) {
        const dt = lastT === 0 ? 0 : Math.min(t - lastT, 0.1);
        lastT = t;

        // Age hot spots, drop expired ones.
        for (const hs of hotspots) hs.age += dt;
        for (let i = hotspots.length - 1; i >= 0; i--) {
            if (hotspots[i].age > hotspots[i].lifetime) hotspots.splice(i, 1);
        }

        // Spawn new ones at a Poisson-ish rate.
        pendingDt += dt;
        while (pendingDt > 0 && hotspots.length < MAX_HOTSPOTS) {
            const interval = -Math.log(1 - Math.random()) / cfg.spawnRate;
            if (interval > pendingDt) break;
            pendingDt -= interval;
            spawnHotspot();
        }
        if (hotspots.length >= MAX_HOTSPOTS) pendingDt = 0;

        // Push to uniform with a sin-bell intensity envelope over lifetime.
        const arr = stateVar.material.uniforms.hotspots.value;
        for (let i = 0; i < MAX_HOTSPOTS; i++) {
            const hs = hotspots[i];
            if (hs) {
                const tnorm = hs.age / hs.lifetime;
                const fade = Math.sin(tnorm * Math.PI);
                arr[i].set(hs.u, hs.v, hs.intensity * fade);
            } else {
                arr[i].set(0, 0, 0);
            }
        }

        gpu.compute();
        mat.uniforms.heightMap.value = gpu.getCurrentRenderTarget(stateVar).texture;
        mat.uniforms.time.value = t;
    }

    onAtlasColorChange((tn) => {
        mat.uniforms.brightness.value = tn.coreBrightness;
        mat.uniforms.rimBoost.value   = tn.coreRimBoost;
        mat.uniforms.hotColor.value.set(tn.coreHotColor);
        mat.uniforms.coolColor.value.set(tn.coreCoolColor);
        if (tn.coreRadius !== currentRadius) {
            currentRadius = tn.coreRadius;
            mesh.geometry.dispose();
            mesh.geometry = new SphereGeometry(currentRadius, 192, 96);
        }
    });
    onAtlasVisibilityChange((tn) => {
        mesh.visible = tn.coreEnabled;
    });

    // Headless tuning hook.
    if (typeof window !== 'undefined') {
        window.__eqFluidDebug = {
            kernel: u,
            material: mat.uniforms,
            cfg,
            spawnHotspot,
            getHotspots: () => hotspots,
        };
    }

    return { mesh, update };
}
