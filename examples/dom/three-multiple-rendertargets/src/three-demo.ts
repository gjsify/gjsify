// Ported from refs/three/examples/webgl_multiple_rendertargets.html
// Original: MIT license, three.js contributors
// Modifications: no DOM/GUI/OrbitControls; canvas-based setup; animation loop via setAnimationLoop

import * as THREE from 'three';

// G-Buffer pass: write diffuse color + normals into two render targets
const gbufferVS = /* glsl */`
in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vNormal;
out vec2 vUv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vec3 transformedNormal = normalMatrix * normal;
    vNormal = normalize( transformedNormal );
    gl_Position = projectionMatrix * mvPosition;
}`;

const gbufferFS = /* glsl */`
precision highp float;
precision highp int;

layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;

in vec3 vNormal;
in vec2 vUv;

void main() {
    // Smooth rainbow gradient based on UV — visually distinct from checkerboard demos
    vec3 color = 0.5 + 0.5 * cos( 6.28318 * (vUv.xyx + vec3(0.0, 0.33, 0.67)) );
    gColor = vec4( color, 1.0 );
    // Write surface normal (encoded to 0..1 range) to the normal G-Buffer
    gNormal = vec4( normalize( vNormal ) * 0.5 + 0.5, 1.0 );
}`;

// Screen-space pass: read G-Buffer, split left=diffuse / right=normals
const renderVS = /* glsl */`
in vec3 position;
in vec2 uv;

out vec2 vUv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const renderFS = /* glsl */`
precision highp float;
precision highp int;

vec4 LinearTosRGB( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

layout(location = 0) out vec4 pc_FragColor;

in vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tNormal;

void main() {
    vec4 diffuse = texture( tDiffuse, vUv );
    vec4 normal  = texture( tNormal,  vUv );

    // Left half: G-Buffer color, right half: normal visualization
    pc_FragColor = mix( diffuse, normal, step( 0.5, vUv.x ) );
    pc_FragColor.a = 1.0;
    pc_FragColor = LinearTosRGB( pc_FragColor );
}`;

export function start(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as any });
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.debug.checkShaderErrors = true;

    // G-Buffer render target with 2 color attachments (diffuse + normal)
    const renderTarget = new THREE.WebGLRenderTarget(
        canvas.width, canvas.height,
        {
            count: 2,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        }
    );
    renderTarget.textures[0].name = 'diffuse';
    renderTarget.textures[1].name = 'normal';

    // 3D scene (TorusKnot with G-Buffer RawShaderMaterial)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    const camera = new THREE.PerspectiveCamera(70, canvas.width / canvas.height, 0.1, 50);
    camera.position.z = 4;

    const mesh = new THREE.Mesh(
        new THREE.TorusKnotGeometry(1, 0.3, 128, 32),
        new THREE.RawShaderMaterial({
            name: 'G-Buffer Shader',
            vertexShader: gbufferVS,
            fragmentShader: gbufferFS,
            glslVersion: THREE.GLSL3,
        })
    );
    scene.add(mesh);

    // Post-processing scene (screen quad sampling the G-Buffer)
    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    postScene.add(new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.RawShaderMaterial({
            name: 'Post-FX Shader',
            vertexShader: renderVS,
            fragmentShader: renderFS,
            uniforms: {
                tDiffuse: { value: renderTarget.textures[0] },
                tNormal:  { value: renderTarget.textures[1] },
            },
            glslVersion: THREE.GLSL3,
        })
    ));

    let currentWidth = canvas.width;
    let currentHeight = canvas.height;

    renderer.setAnimationLoop(() => {
        const w = canvas.width;
        const h = canvas.height;
        if (w !== currentWidth || h !== currentHeight) {
            currentWidth = w;
            currentHeight = h;
            renderer.setSize(w, h, false);
            renderTarget.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }

        mesh.rotation.x += 0.003;
        mesh.rotation.y += 0.007;

        // Pass 1: render 3D scene into G-Buffer
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);

        // Pass 2: composite G-Buffer to screen
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCamera);
    });
}
