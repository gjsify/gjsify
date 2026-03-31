// Browser entry point for three-geometry-teapot example.
// Uses plain HTML controls instead of Adwaita widgets.

import { start, type ShadingMode } from './three-demo.js';

const TESS_VALUES = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50];
const SHADING_VALUES: ShadingMode[] = ['wireframe', 'flat', 'smooth', 'glossy', 'textured', 'reflective'];

function main() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }, { passive: true });

    const demo = start(canvas);

    // Wire HTML controls
    const tessSelect = document.getElementById('tess') as HTMLSelectElement;
    const shadingSelect = document.getElementById('shading') as HTMLSelectElement;
    const lidCheck = document.getElementById('lid') as HTMLInputElement;
    const bodyCheck = document.getElementById('body') as HTMLInputElement;
    const bottomCheck = document.getElementById('bottom') as HTMLInputElement;
    const fitLidCheck = document.getElementById('fitLid') as HTMLInputElement;
    const nonblinnCheck = document.getElementById('nonblinn') as HTMLInputElement;

    tessSelect.addEventListener('change', () => {
        demo.effectController.newTess = parseInt(tessSelect.value, 10);
        demo.render();
    });

    shadingSelect.addEventListener('change', () => {
        demo.effectController.newShading = shadingSelect.value as ShadingMode;
        demo.render();
    });

    lidCheck.addEventListener('change', () => {
        demo.effectController.lid = lidCheck.checked;
        demo.render();
    });

    bodyCheck.addEventListener('change', () => {
        demo.effectController.body = bodyCheck.checked;
        demo.render();
    });

    bottomCheck.addEventListener('change', () => {
        demo.effectController.bottom = bottomCheck.checked;
        demo.render();
    });

    fitLidCheck.addEventListener('change', () => {
        demo.effectController.fitLid = fitLidCheck.checked;
        demo.render();
    });

    nonblinnCheck.addEventListener('change', () => {
        demo.effectController.nonblinn = nonblinnCheck.checked;
        demo.render();
    });
}

main();
