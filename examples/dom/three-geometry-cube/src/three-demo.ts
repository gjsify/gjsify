// Ported from refs/three/examples/webgl_geometry_cube.html
// Original: MIT license, three.js contributors

import * as THREE from 'three';

export function start(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    const camera = new THREE.PerspectiveCamera(70, canvas.width / canvas.height, 0.1, 100);
    camera.position.z = 2;

    const scene = new THREE.Scene();

    // colorSpace conversion skipped: requires canvas 2D context (not available in GTK)
    const texture = new THREE.TextureLoader().load('./crate.gif');

    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let currentWidth = canvas.width;
    let currentHeight = canvas.height;

    renderer.setAnimationLoop(() => {
        const w = canvas.width;
        const h = canvas.height;
        if (w !== currentWidth || h !== currentHeight) {
            currentWidth = w;
            currentHeight = h;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        mesh.rotation.x += 0.005;
        mesh.rotation.y += 0.01;
        renderer.render(scene, camera);
    });
}
