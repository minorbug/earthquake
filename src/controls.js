// src/controls.js — mouse/touch rotation, arrow-key orbit, raycast click selection.
import { Vector2, Raycaster } from 'three';

export function attachControls({ camera, camGroup, markers, onSelect, onMiss }) {
    let targetRotationX = 0;
    let targetRotationY = 0;
    let targetCameraRotationY = 0;
    let mouseXOnDown = 0;
    let mouseYOnDown = 0;
    let targetRotationOnDownX = 0;
    let targetRotationOnDownY = 0;

    const halfX = () => window.innerWidth / 2;
    const halfY = () => window.innerHeight / 2;

    let pendingClick = null;

    function onMouseDown(e) {
        e.preventDefault();
        pendingClick = { x: e.clientX, y: e.clientY };
        mouseXOnDown = e.clientX - halfX();
        mouseYOnDown = e.clientY - halfY();
        targetRotationOnDownX = targetRotationX;
        targetRotationOnDownY = targetRotationY;
        document.addEventListener('mousemove', onMouseMove, false);
        document.addEventListener('mouseup', onMouseUp, false);
        document.addEventListener('mouseout', onMouseUp, false);
    }
    function onMouseMove(e) {
        const mx = e.clientX - halfX();
        const my = e.clientY - halfY();
        targetRotationX = targetRotationOnDownX + (mx - mouseXOnDown) * 0.02;
        targetRotationY = targetRotationOnDownY + (my - mouseYOnDown) * 0.02;
    }
    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove, false);
        document.removeEventListener('mouseup', onMouseUp, false);
        document.removeEventListener('mouseout', onMouseUp, false);
    }
    function onTouchStart(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            pendingClick = { x: e.touches[0].pageX, y: e.touches[0].pageY };
            mouseXOnDown = e.touches[0].pageX - halfX();
            mouseYOnDown = e.touches[0].pageY - halfY();
            targetRotationOnDownX = targetRotationX;
            targetRotationOnDownY = targetRotationY;
        }
    }
    function onTouchMove(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            const mx = e.touches[0].pageX - halfX();
            const my = e.touches[0].pageY - halfY();
            targetRotationX = targetRotationOnDownX + (mx - mouseXOnDown) * 0.05;
            targetRotationY = targetRotationOnDownY + (my - mouseYOnDown) * 0.05;
        }
    }
    function onKeyDown(e) {
        if (e.keyCode === 65 || e.keyCode === 37) targetCameraRotationY += 0.5; // A or ←
        else if (e.keyCode === 68 || e.keyCode === 39) targetCameraRotationY -= 0.5; // D or →
    }

    document.addEventListener('mousedown', onMouseDown, false);
    document.addEventListener('touchstart', onTouchStart, false);
    document.addEventListener('touchmove', onTouchMove, false);
    document.addEventListener('keydown', onKeyDown, false);

    const raycaster = new Raycaster();
    const ndc = new Vector2();

    function processClick() {
        if (!pendingClick) return;
        ndc.x = (pendingClick.x / window.innerWidth) * 2 - 1;
        ndc.y = -(pendingClick.y / window.innerHeight) * 2 + 1;
        pendingClick = null;
        raycaster.setFromCamera(ndc, camera);
        const intersects = raycaster.intersectObjects(markers, true);
        for (const hit of intersects) {
            const o = hit.object;
            if (o.userData && o.userData._kind === 'blob') {
                onSelect(o.parent);
                return;
            }
        }
        onMiss();
    }

    function update() {
        camGroup.rotation.x += (-targetRotationX - camGroup.rotation.x) * 0.05;
        camGroup.rotation.z += ( targetRotationY - camGroup.rotation.z) * 0.05;
        camGroup.rotation.y += ( targetCameraRotationY - camGroup.rotation.y) * 0.15;
        processClick();
    }

    return { update };
}
