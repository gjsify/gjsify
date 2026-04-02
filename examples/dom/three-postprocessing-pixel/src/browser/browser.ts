// Browser UI for three-postprocessing-pixel example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import '@gjsify/adwaita-web';
import { start, type PixelDemo, type StartOptions } from '../three-demo.js';

export interface MountOptions {
    assetBase?: string;
}

export function mount(container: HTMLElement, options?: MountOptions) {
    const { assetBase } = options ?? {};

    // Build UI — mirrors GJS Blueprint structure
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar');
    headerBar.setAttribute('title', 'Pixel Post-Processing');

    const body = document.createElement('div');
    body.className = 'adw-window-body';

    // Sidebar with controls
    const sidebar = document.createElement('div');
    sidebar.className = 'adw-sidebar';
    const sidebarContent = document.createElement('div');
    sidebarContent.className = 'adw-sidebar-content';

    // Post-Processing group
    const group = document.createElement('adw-preferences-group');
    group.setAttribute('title', 'Post-Processing');

    const pixelSizeRow = document.createElement('adw-spin-row');
    pixelSizeRow.setAttribute('title', 'Pixel Size');
    pixelSizeRow.setAttribute('min', '1');
    pixelSizeRow.setAttribute('max', '16');
    pixelSizeRow.setAttribute('step', '1');
    pixelSizeRow.setAttribute('value', '4');

    const normalEdgeRow = document.createElement('adw-spin-row');
    normalEdgeRow.setAttribute('title', 'Normal Edge');
    normalEdgeRow.setAttribute('min', '0');
    normalEdgeRow.setAttribute('max', '2');
    normalEdgeRow.setAttribute('step', '0.05');
    normalEdgeRow.setAttribute('value', '0.30');

    const depthEdgeRow = document.createElement('adw-spin-row');
    depthEdgeRow.setAttribute('title', 'Depth Edge');
    depthEdgeRow.setAttribute('min', '0');
    depthEdgeRow.setAttribute('max', '1');
    depthEdgeRow.setAttribute('step', '0.05');
    depthEdgeRow.setAttribute('value', '0.40');

    const pixelAlignRow = document.createElement('adw-switch-row');
    pixelAlignRow.setAttribute('title', 'Pixel-Aligned Panning');
    pixelAlignRow.setAttribute('active', '');

    group.append(pixelSizeRow, normalEdgeRow, depthEdgeRow, pixelAlignRow);
    sidebarContent.append(group);
    sidebar.append(sidebarContent);

    // Separator + WebGL canvas
    const separator = document.createElement('div');
    separator.className = 'adw-separator-vertical';

    const glContainer = document.createElement('div');
    glContainer.id = 'gl-area-container';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    glContainer.append(canvas);

    body.append(sidebar, separator, glContainer);
    win.append(headerBar, body);
    container.append(win);

    // Sync canvas size with container
    new ResizeObserver(() => {
        canvas.width = glContainer.clientWidth;
        canvas.height = glContainer.clientHeight;
    }).observe(glContainer);
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    // Start three.js and connect controls
    const demo = start(canvas, { assetBase });
    connectControls(demo, pixelSizeRow, normalEdgeRow, depthEdgeRow, pixelAlignRow);
}

function connectControls(
    demo: PixelDemo,
    pixelSizeRow: any, normalEdgeRow: any, depthEdgeRow: any, pixelAlignRow: any,
) {
    pixelSizeRow.addEventListener('notify::value', () => {
        demo.effectController.pixelSize = pixelSizeRow.value;
    });

    normalEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.normalEdgeStrength = normalEdgeRow.value;
    });

    depthEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.depthEdgeStrength = depthEdgeRow.value;
    });

    pixelAlignRow.addEventListener('notify::active', () => {
        demo.effectController.pixelAlignedPanning = pixelAlignRow.active;
    });
}
