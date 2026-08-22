// Browser UI for three-geometry-teapot example.
// Mirrors the GJS/Adwaita UI from gjs/teapot-window.ts using @gjsify/adwaita-web.

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import type { AdwOverlaySplitView, AdwHeaderBar } from '@gjsify/adwaita-web';
import { mediaPlaybackPauseSymbolic, mediaPlaybackStartSymbolic } from '@gjsify/adwaita-icons/actions';
import {
    start,
    TESS_VALUES,
    SHADING_VALUES,
    DEFAULT_TESS_INDEX,
    DEFAULT_SHADING_INDEX,
    type TeapotDemo,
} from '../three-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    /** Base path for loading texture assets (forwarded to three-demo). */
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

/**
 * Mounts an adw-window with sidebar controls and a WebGL canvas into `container`.
 */
export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1100');
    win.setAttribute('height', '700');

    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Three.js Teapot');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'adw-header-btn adw-sidebar-toggle-icon active';
    toggleBtn.title = 'Toggle Sidebar';

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'adw-header-btn';
    pauseBtn.title = 'Pause Rendering';
    setButtonIcon(pauseBtn, mediaPlaybackPauseSymbolic);

    const splitView = document.createElement('adw-overlay-split-view') as AdwOverlaySplitView;
    splitView.setAttribute('min-sidebar-width', '280');
    splitView.setAttribute('max-sidebar-width', '400');
    splitView.setAttribute('sidebar-width-fraction', '0.30');
    splitView.setAttribute('show-sidebar', '');

    const sidebarContent = document.createElement('div');
    sidebarContent.setAttribute('slot', 'sidebar');
    sidebarContent.className = 'adw-sidebar-content';

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

    const matGroup = document.createElement('adw-preferences-group');
    matGroup.setAttribute('title', 'Material');

    const shadingRow = document.createElement('adw-combo-row');
    shadingRow.setAttribute('title', 'Shading');
    shadingRow.setAttribute('items', JSON.stringify([...SHADING_VALUES]));
    shadingRow.setAttribute('selected', String(DEFAULT_SHADING_INDEX));

    matGroup.append(shadingRow);

    sidebarContent.append(geoGroup, matGroup);

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

    // AFTER DOM connection: connectedCallback is what creates the header-bar-start wrapper.
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

    toggleBtn.addEventListener('click', () => {
        splitView.toggleSidebar();
        toggleBtn.classList.toggle('active', splitView.showSidebar);
    });

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

    // Also covers a slide becoming visible after `display: none`, which reports a size for the first
    // time.
    canvas.width = glContainer.clientWidth;
    canvas.height = glContainer.clientHeight;

    let demo: TeapotDemo | null = null;
    // Buffers pause() calls that arrive before the demo exists.
    let pendingPause = false;
    new ResizeObserver(() => {
        const w = glContainer.clientWidth;
        const h = glContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            if (!demo) {
                demo = start(canvas, { assetBase: options?.assetBase });
                connectControls(
                    demo,
                    tessRow as AdwRow,
                    shadingRow as AdwRow,
                    lidRow as AdwRow,
                    bodyRow as AdwRow,
                    bottomRow as AdwRow,
                    fitLidRow as AdwRow,
                    nonblinnRow as AdwRow,
                );
                if (pendingPause) {
                    demo.pause();
                    pendingPause = false;
                }
            } else {
                demo.render();
            }
        }
    }).observe(glContainer);

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

// Adwaita web components expose custom properties (.selected, .active) not in HTMLElement types.
type AdwRow = HTMLElement & Record<string, unknown>;

function connectControls(
    demo: TeapotDemo,
    tessRow: AdwRow,
    shadingRow: AdwRow,
    lidRow: AdwRow,
    bodyRow: AdwRow,
    bottomRow: AdwRow,
    fitLidRow: AdwRow,
    nonblinnRow: AdwRow,
) {
    tessRow.addEventListener('notify::selected', () => {
        demo.effectController.newTess = TESS_VALUES[tessRow.selected as number];
        demo.render();
    });

    shadingRow.addEventListener('notify::selected', () => {
        demo.effectController.newShading = SHADING_VALUES[shadingRow.selected as number];
        demo.render();
    });

    const toggleRows: Array<[AdwRow, 'lid' | 'body' | 'bottom' | 'fitLid' | 'nonblinn']> = [
        [lidRow, 'lid'],
        [bodyRow, 'body'],
        [bottomRow, 'bottom'],
        [fitLidRow, 'fitLid'],
        [nonblinnRow, 'nonblinn'],
    ];
    for (const [row, key] of toggleRows) {
        row.addEventListener('notify::active', () => {
            demo.effectController[key] = Boolean(row.active);
            demo.render();
        });
    }
}
