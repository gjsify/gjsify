// Browser UI for canvas2d-fireworks example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.

import '@gjsify/adwaita-web';
import '@gjsify/adwaita-web/style.css';
import type { AdwOverlaySplitView, AdwHeaderBar } from '@gjsify/adwaita-web';
import { mediaPlaybackPauseSymbolic, mediaPlaybackStartSymbolic } from '@gjsify/adwaita-icons/actions';
import { start, type FireworksDemo } from '../fireworks.js';

/** Handle returned by `mount()` so hosts (e.g. the website slideshow) can pause and resume rendering. */
export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

/** Parse a trusted literal SVG string into an SVGElement. */
function parseSvg(svgSource: string): SVGElement {
    const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
    return doc.documentElement as unknown as SVGElement;
}

/** Replace a button's icon with a freshly-parsed copy of the given SVG source. */
function setButtonIcon(btn: HTMLButtonElement, svgSource: string): void {
    btn.replaceChildren(parseSvg(svgSource));
}

export function mount(container: HTMLElement): ShowcaseHandle {
    // Build UI — mirrors GJS Blueprint structure
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    // Header bar (toggle button added after DOM connection below)
    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Fireworks — Canvas 2D');

    // Sidebar toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'adw-header-btn adw-sidebar-toggle-icon active';
    toggleBtn.title = 'Toggle Sidebar';

    // Pause/Resume rendering button (header end). Starts in "running" state →
    // shows the pause icon. Clicking toggles the pause state and swaps the icon.
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'adw-header-btn';
    pauseBtn.title = 'Pause Rendering';
    setButtonIcon(pauseBtn, mediaPlaybackPauseSymbolic);

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

    // Fireworks group
    const group = document.createElement('adw-preferences-group');
    group.setAttribute('title', 'Fireworks');

    const particleCountRow = document.createElement('adw-spin-row');
    particleCountRow.setAttribute('title', 'Particle Count');
    particleCountRow.setAttribute('min', '10');
    particleCountRow.setAttribute('max', '100');
    particleCountRow.setAttribute('step', '1');
    particleCountRow.setAttribute('value', '30');

    const autoIntervalRow = document.createElement('adw-spin-row');
    autoIntervalRow.setAttribute('title', 'Auto Interval (ms)');
    autoIntervalRow.setAttribute('min', '50');
    autoIntervalRow.setAttribute('max', '1000');
    autoIntervalRow.setAttribute('step', '50');
    autoIntervalRow.setAttribute('value', '200');

    const maxBurstRadiusRow = document.createElement('adw-spin-row');
    maxBurstRadiusRow.setAttribute('title', 'Max Burst Radius');
    maxBurstRadiusRow.setAttribute('min', '50');
    maxBurstRadiusRow.setAttribute('max', '300');
    maxBurstRadiusRow.setAttribute('step', '10');
    maxBurstRadiusRow.setAttribute('value', '160');

    const autoFireworksRow = document.createElement('adw-switch-row');
    autoFireworksRow.setAttribute('title', 'Auto Fireworks');
    autoFireworksRow.setAttribute('active', '');

    group.append(particleCountRow, autoIntervalRow, maxBurstRadiusRow, autoFireworksRow);
    sidebarContent.append(group);

    // Canvas container (content slot) — inline styles so the showcase
    // is self-contained and works regardless of host CSS.
    const canvasContainer = document.createElement('div');
    canvasContainer.setAttribute('slot', 'content');
    canvasContainer.id = 'canvas-container';
    canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;background:#000';

    const canvas = document.createElement('canvas');
    canvas.id = 'fireworks-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    canvasContainer.append(canvas);

    splitView.append(sidebarContent, canvasContainer);
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

    const endSection = headerBar.endSection
        ?? headerBar.querySelector('.adw-header-bar-end');
    if (endSection) {
        endSection.appendChild(pauseBtn);
    } else {
        headerBar.append(pauseBtn);
    }

    // Sync canvas buffer to container dimensions
    function syncCanvasSize() {
        const w = canvasContainer.clientWidth;
        const h = canvasContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
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

    // Start fireworks once the canvas has a size. We keep the demo reference
    // in an outer closure so the pause button and the returned ShowcaseHandle
    // can delegate to it once it's alive.
    let demo: FireworksDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists (lazy mount
    // racing with the slideshow calling pause() on the non-active slide).
    let pendingPause = false;

    const sizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        if (!demo && canvas.width > 0 && canvas.height > 0) {
            demo = start(canvas);
            connectControls(demo, particleCountRow, autoIntervalRow, maxBurstRadiusRow, autoFireworksRow);
            if (pendingPause) {
                demo.pause();
                pendingPause = false;
            }
        }
    });
    sizeObserver.observe(canvasContainer);

    const contentArea = splitView.querySelector('.adw-osv-content');
    if (contentArea) sizeObserver.observe(contentArea);

    // Pause button wiring — toggles demo state and swaps the icon.
    function updatePauseButton(paused: boolean): void {
        setButtonIcon(pauseBtn, paused ? mediaPlaybackStartSymbolic : mediaPlaybackPauseSymbolic);
        pauseBtn.title = paused ? 'Resume Rendering' : 'Pause Rendering';
    }
    pauseBtn.addEventListener('click', () => {
        if (demo) {
            if (demo.isPaused) demo.resume();
            else demo.pause();
            updatePauseButton(demo.isPaused);
        } else {
            pendingPause = !pendingPause;
            updatePauseButton(pendingPause);
        }
    });

    return {
        get isPaused() { return demo ? demo.isPaused : pendingPause; },
        pause() {
            if (demo) {
                demo.pause();
                updatePauseButton(true);
            } else {
                pendingPause = true;
                updatePauseButton(true);
            }
        },
        resume() {
            if (demo) {
                demo.resume();
                updatePauseButton(false);
            } else {
                pendingPause = false;
                updatePauseButton(false);
            }
        },
    };
}

function connectControls(
    demo: FireworksDemo,
    particleCountRow: any, autoIntervalRow: any, maxBurstRadiusRow: any, autoFireworksRow: any,
) {
    particleCountRow.addEventListener('notify::value', () => {
        demo.effectController.particleCount = particleCountRow.value;
    });

    autoIntervalRow.addEventListener('notify::value', () => {
        demo.effectController.autoInterval = autoIntervalRow.value;
    });

    maxBurstRadiusRow.addEventListener('notify::value', () => {
        demo.effectController.maxBurstRadius = maxBurstRadiusRow.value;
    });

    autoFireworksRow.addEventListener('notify::active', () => {
        demo.effectController.autoFireworks = autoFireworksRow.active;
    });
}
