// src/scene.js — Scene, Camera, Renderer, plain-color crust globe.
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Object3D,
    SphereGeometry,
    MeshBasicMaterial,
    Mesh,
    DoubleSide,
    Color,
} from 'three';
import { atlasTuning, onAtlasColorChange } from './atlasTuning.js';

export const CRUST_RADIUS = 6367;

export function createScene(container) {
    const scene = new Scene();

    const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(-4100, 4100, 0);
    camera.lookAt(CRUST_RADIUS, CRUST_RADIUS + 200, 0);

    const camGroup = new Object3D();
    camGroup.add(camera);
    scene.add(camGroup);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const crustMat = new MeshBasicMaterial({ color: new Color(atlasTuning.oceanColor), side: DoubleSide });
    const crust = new Mesh(new SphereGeometry(CRUST_RADIUS, 32, 32), crustMat);
    scene.add(crust);

    onAtlasColorChange((t) => {
        crustMat.color.set(t.oceanColor);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, camGroup, renderer, crust };
}
