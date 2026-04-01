// Ported from refs/three/examples/webgl_morphtargets.html
// Original: MIT license, three.js contributors
// Modifications: removed OrbitControls/GUI (auto-animated morph influences), adapted for GTK canvas

import * as THREE from 'three';

function createGeometry(): THREE.BoxGeometry {
    const geometry = new THREE.BoxGeometry(2, 2, 2, 32, 32, 32);

    // morphing positions and normals is supported
    geometry.morphAttributes.position = [];

    const positionAttribute = geometry.attributes.position;

    // Morph target 1: cube vertices mapped onto a sphere surface
    const spherePositions: number[] = [];

    // Morph target 2: twisted cube vertices
    const twistPositions: number[] = [];
    const direction = new THREE.Vector3(1, 0, 0);
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positionAttribute.count; i++) {
        const x = positionAttribute.getX(i);
        const y = positionAttribute.getY(i);
        const z = positionAttribute.getZ(i);

        spherePositions.push(
            x * Math.sqrt(1 - (y * y / 2) - (z * z / 2) + (y * y * z * z / 3)),
            y * Math.sqrt(1 - (z * z / 2) - (x * x / 2) + (z * z * x * x / 3)),
            z * Math.sqrt(1 - (x * x / 2) - (y * y / 2) + (x * x * y * y / 3)),
        );

        // Stretch along x-axis so the twist is more visible
        vertex.set(x * 2, y, z);
        vertex.applyAxisAngle(direction, Math.PI * x / 2).toArray(twistPositions, twistPositions.length);
    }

    geometry.morphAttributes.position[0] = new THREE.Float32BufferAttribute(spherePositions, 3);
    geometry.morphAttributes.position[1] = new THREE.Float32BufferAttribute(twistPositions, 3);

    return geometry;
}

export function start(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8FBCD4);

    const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 20);
    camera.position.z = 10;
    scene.add(camera);

    scene.add(new THREE.AmbientLight(0x8FBCD4, 1.5));

    const pointLight = new THREE.PointLight(0xffffff, 200);
    camera.add(pointLight);

    const geometry = createGeometry();
    const material = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        flatShading: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Auto-animated morph influences replace GUI sliders
    const clock = new THREE.Clock();

    renderer.setAnimationLoop(() => {
        const elapsed = clock.getElapsedTime();

        // Animate morph targets with sine waves (0..1 range)
        mesh.morphTargetInfluences![0] = (Math.sin(elapsed * 0.5) + 1) / 2;   // Spherify
        mesh.morphTargetInfluences![1] = (Math.sin(elapsed * 0.3 + 1.5) + 1) / 2; // Twist

        // Slow auto-rotation
        mesh.rotation.y += 0.005;

        renderer.render(scene, camera);
    });
}
