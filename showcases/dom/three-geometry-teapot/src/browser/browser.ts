// Browser UI for three-geometry-teapot example.
// Mirrors the GJS/Adwaita UI from gjs/teapot-window.ts using @gjsify/adwaita-web.

import '@gjsify/adwaita-web';
import type { AdwOverlaySplitView, AdwHeaderBar } from '@gjsify/adwaita-web';
import { start, TESS_VALUES, SHADING_VALUES, DEFAULT_TESS_INDEX, DEFAULT_SHADING_INDEX, type TeapotDemo } from '../three-demo.js';

export interface MountOptions {
    /** Base path for loading texture assets (forwarded to three-demo). */
    assetBase?: string;
}

/**
 * Create the Adwaita teapot UI and mount it into the given container.
 * The container receives an adw-window with sidebar controls and a WebGL canvas.
 */
export function mount(container: HTMLElement, options?: MountOptions) {
    // Build UI — mirrors GJS Blueprint structure
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    // Header bar (toggle button added after DOM connection below)
    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Three.js Teapot');

    // Sidebar toggle button
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

    // Geometry group
    const geoGroup = document.createElement('adw-preferences-group');
    geoGroup.setAttribute('title', 'Geometry');

    const tessRow = document.createElement('adw-combo-row');
    tessRow.setAttribute('title', 'Tessellation Level');
    tessRow.setAttribute('items', JSON.stringify(TESS_VALUES.map(String)));
    tessRow.setAttribute('selected', String(DEFAULT_TESS_INDEX));

    const lidRow = document.createElement('adw-switch-row');
    lidRow.setAttribute('title', 'Display Lid');
    lidRow.setAttribute('active', '');

    const bodyRow = document.createElement('adw-switch-row');
    bodyRow.setAttribute('title', 'Display Body');
    bodyRow.setAttribute('active', '');

    const bottomRow = document.createElement('adw-switch-row');
    bottomRow.setAttribute('title', 'Display Bottom');
    bottomRow.setAttribute('active', '');

    const fitLidRow = document.createElement('adw-switch-row');
    fitLidRow.setAttribute('title', 'Snug Lid');

    const nonblinnRow = document.createElement('adw-switch-row');
    nonblinnRow.setAttribute('title', 'Original Scale');

    geoGroup.append(tessRow, lidRow, bodyRow, bottomRow, fitLidRow, nonblinnRow);

    // Material group
    const matGroup = document.createElement('adw-preferences-group');
    matGroup.setAttribute('title', 'Material');

    const shadingRow = document.createElement('adw-combo-row');
    shadingRow.setAttribute('title', 'Shading');
    shadingRow.setAttribute('items', JSON.stringify([...SHADING_VALUES]));
    shadingRow.setAttribute('selected', String(DEFAULT_SHADING_INDEX));

    matGroup.append(shadingRow);

    sidebarContent.append(geoGroup, matGroup);

    // GL container (content slot) — inline styles so the showcase
    // is self-contained and works regardless of host CSS.
    const glContainer = document.createElement('div');
    glContainer.setAttribute('slot', 'content');
    glContainer.id = 'gl-area-container';
    glContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0';

    const canvas = document.createElement('canvas');
    canvas.id = 'webgl-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    glContainer.append(canvas);

    splitView.append(sidebarContent, glContainer);
    win.append(headerBar, splitView);
    container.append(win);

    // Append toggle button to header bar start section AFTER DOM connection
    const startSection = headerBar.startSection
        ?? headerBar.querySelector('.adw-header-bar-start');
    if (startSection) {
        startSection.appendChild(toggleBtn);
    } else {
        headerBar.prepend(toggleBtn);
    }

    // Sidebar toggle wiring
    toggleBtn.addEventListener('click', () => {
        splitView.toggleSidebar();
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

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

    // Sync canvas size with container and re-render on resize
    // (needed when slide becomes visible after being display:none)
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    let demo: TeapotDemo | null = null;
    new ResizeObserver(() => {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            if (!demo) {
                demo = start(canvas, { assetBase: options?.assetBase });
                connectControls(demo, tessRow, shadingRow, lidRow, bodyRow, bottomRow, fitLidRow, nonblinnRow);
            } else {
                demo.render();
            }
        }
    }).observe(glContainer);
}

function connectControls(
    demo: TeapotDemo,
    tessRow: any, shadingRow: any,
    lidRow: any, bodyRow: any, bottomRow: any,
    fitLidRow: any, nonblinnRow: any,
) {
    tessRow.addEventListener('notify::selected', () => {
        demo.effectController.newTess = TESS_VALUES[tessRow.selected];
        demo.render();
    });

    shadingRow.addEventListener('notify::selected', () => {
        demo.effectController.newShading = SHADING_VALUES[shadingRow.selected];
        demo.render();
    });

    for (const [row, key] of [
        [lidRow, 'lid'], [bodyRow, 'body'], [bottomRow, 'bottom'],
        [fitLidRow, 'fitLid'], [nonblinnRow, 'nonblinn'],
    ] as const) {
        row.addEventListener('notify::active', () => {
            (demo.effectController as any)[key] = row.active;
            demo.render();
        });
    }
}
