// Browser UI for three-postprocessing-pixel example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import '@gjsify/adwaita-web';
import type { AdwOverlaySplitView, AdwHeaderBar } from '@gjsify/adwaita-web';
import { start, type PixelDemo } from '../three-demo.js';

export interface MountOptions {
    assetBase?: string;
}

export function mount(container: HTMLElement, options?: MountOptions) {
    const { assetBase } = options ?? {};

    // Build UI — mirrors GJS Blueprint structure
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    // Header bar (toggle button added after DOM connection below)
    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Pixel Post-Processing');

    // Sidebar toggle button — will be placed in header bar start section
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'adw-header-btn adw-sidebar-toggle-icon active';
    toggleBtn.title = 'Toggle Sidebar';

    // OverlaySplitView — sidebar + content
    const splitView = document.createElement('adw-overlay-split-view') as AdwOverlaySplitView;
    splitView.setAttribute('min-sidebar-width', '280');
    splitView.setAttribute('max-sidebar-width', '400');
    splitView.setAttribute('sidebar-width-fraction', '0.30');
    splitView.setAttribute('show-sidebar', '');

    // Sidebar content
    const sidebarContent = document.createElement('div');
    sidebarContent.setAttribute('slot', 'sidebar');
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

    // GL container (content slot)
    const glContainer = document.createElement('div');
    glContainer.setAttribute('slot', 'content');
    glContainer.id = 'gl-area-container';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    glContainer.append(canvas);

    splitView.append(sidebarContent, glContainer);
    win.append(headerBar, splitView);
    container.append(win);

    // Append toggle button to header bar start section AFTER DOM connection
    // (connectedCallback has already created the .adw-header-bar-start wrapper)
    const startSection = headerBar.startSection
        ?? headerBar.querySelector('.adw-header-bar-start');
    if (startSection) {
        startSection.appendChild(toggleBtn);
    } else {
        // Fallback: prepend directly
        headerBar.prepend(toggleBtn);
    }

    // Sync canvas buffer to parent container dimensions
    function syncCanvasSize() {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    // Sidebar toggle button wiring
    toggleBtn.addEventListener('click', () => {
        splitView.toggleSidebar();
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

    // Sync toggle button on sidebar-toggled events (e.g. backdrop click)
    splitView.addEventListener('sidebar-toggled', () => {
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

    // Responsive breakpoints — mirror GJS Adw.Breakpoint behavior
    let lastCollapsed: boolean | null = null;
    new ResizeObserver(([entry]) => {
        const width = entry.contentRect.width;
        const shouldCollapse = width < 800;
        if (shouldCollapse === lastCollapsed) return;
        lastCollapsed = shouldCollapse;
        splitView.collapsed = shouldCollapse;
        splitView.showSidebar = !shouldCollapse;
        toggleBtn.classList.toggle('active', !shouldCollapse);
    }).observe(win);

    // Observe parent container for size changes (window resize, layout changes)
    let demoStarted = false;
    const sizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        if (!demoStarted && canvas.width > 0 && canvas.height > 0) {
            demoStarted = true;
            const demo = start(canvas, { assetBase });
            connectControls(demo, pixelSizeRow, normalEdgeRow, depthEdgeRow, pixelAlignRow);
        }
    });
    sizeObserver.observe(glContainer);

    // Also observe the split view content area — catches sidebar toggle
    // changes that glContainer's observer might miss during CSS transitions.
    const contentArea = splitView.querySelector('.adw-osv-content');
    if (contentArea) sizeObserver.observe(contentArea);
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
