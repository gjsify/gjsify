// Browser UI for three-postprocessing-pixel example.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import type { Adw } from '@gjsify/adwaita-web';
import { mediaPlaybackPauseSymbolic, mediaPlaybackStartSymbolic } from '@gjsify/adwaita-icons/actions';
import { start, type PixelDemo } from '../three-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    assetBase?: string;
}

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

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const { assetBase } = options ?? {};

    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar') as Adw.HeaderBar;
    headerBar.setAttribute('title', 'Pixel Post-Processing');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'adw-header-btn adw-sidebar-toggle-icon active';
    toggleBtn.title = 'Toggle Sidebar';

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'adw-header-btn';
    pauseBtn.title = 'Pause Rendering';
    setButtonIcon(pauseBtn, mediaPlaybackPauseSymbolic);

    const splitView = document.createElement('adw-overlay-split-view') as Adw.OverlaySplitView;
    splitView.setAttribute('min-sidebar-width', '280');
    splitView.setAttribute('max-sidebar-width', '400');
    splitView.setAttribute('sidebar-width-fraction', '0.30');
    splitView.setAttribute('show-sidebar', '');

    const sidebarContent = document.createElement('div');
    sidebarContent.setAttribute('slot', 'sidebar');
    sidebarContent.className = 'adw-sidebar-content';

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

    // Inline styles so the layout holds in the website embed too, which loads no showcase CSS.
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

    // AFTER DOM connection: connectedCallback is what creates the .adw-header-bar-start wrapper.
    const startSection = headerBar.startSection ?? headerBar.querySelector('.adw-header-bar-start');
    if (startSection) {
        startSection.appendChild(toggleBtn);
    } else {
        headerBar.prepend(toggleBtn);
    }

    const endSection = headerBar.endSection ?? headerBar.querySelector('.adw-header-bar-end');
    if (endSection) {
        endSection.appendChild(pauseBtn);
    } else {
        headerBar.append(pauseBtn);
    }

    function syncCanvasSize() {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    toggleBtn.addEventListener('click', () => {
        splitView.toggleSidebar();
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

    // Also fires for a backdrop click, which does not go through the button.
    splitView.addEventListener('sidebar-toggled', () => {
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

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

    // The demo reference lives in an outer closure so the pause button and the returned handle can
    // delegate to it once it exists.
    let demo: PixelDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists.
    let pendingPause = false;

    const sizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
        if (!demo && canvas.width > 0 && canvas.height > 0) {
            demo = start(canvas, { assetBase });
            connectControls(
                demo,
                pixelSizeRow as AdwRow,
                normalEdgeRow as AdwRow,
                depthEdgeRow as AdwRow,
                pixelAlignRow as AdwRow,
            );
            if (pendingPause) {
                demo.pause();
                pendingPause = false;
            }
        }
    });
    sizeObserver.observe(glContainer);

    // The content area is observed too: glContainer's own observer can miss a sidebar toggle while a
    // CSS transition is running.
    const contentArea = splitView.querySelector('.adw-osv-content');
    if (contentArea) sizeObserver.observe(contentArea);

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
        get isPaused() {
            return demo ? demo.isPaused : pendingPause;
        },
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

// Adwaita web components expose custom properties (.value, .active) not in HTMLElement types.
type AdwRow = HTMLElement & Record<string, unknown>;

function connectControls(
    demo: PixelDemo,
    pixelSizeRow: AdwRow,
    normalEdgeRow: AdwRow,
    depthEdgeRow: AdwRow,
    pixelAlignRow: AdwRow,
) {
    pixelSizeRow.addEventListener('notify::value', () => {
        demo.effectController.pixelSize = pixelSizeRow.value as number;
    });

    normalEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.normalEdgeStrength = normalEdgeRow.value as number;
    });

    depthEdgeRow.addEventListener('notify::value', () => {
        demo.effectController.depthEdgeStrength = depthEdgeRow.value as number;
    });

    pixelAlignRow.addEventListener('notify::active', () => {
        demo.effectController.pixelAlignedPanning = pixelAlignRow.active as boolean;
    });
}
