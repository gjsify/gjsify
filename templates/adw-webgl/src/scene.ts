import * as THREE from 'three';

export function startScene(canvas: HTMLCanvasElement): void {
    // Three.js r163+ requires WebGL2.
    const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl2) throw new Error('WebGL2 context unavailable');

    const renderer = new THREE.WebGLRenderer({ canvas, context: gl2 });
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.setClearColor(0x1e1e2e);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 100);
    camera.position.z = 3;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshNormalMaterial();
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    canvas.addEventListener('resize', () => {
        renderer.setSize(canvas.width, canvas.height, false);
        camera.aspect = canvas.width / canvas.height;
        camera.updateProjectionMatrix();
    });

    const loop = () => {
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.013;
        renderer.render(scene, camera);
        requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
}
