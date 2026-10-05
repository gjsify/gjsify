// Browser UI for the Excalibur Jelly Jumper showcase.
// The widget tree is the GJS window's own `jelly-jumper-window.blp`, projected and mounted by
// @gjsify/adwaita-web — one authored file, so the header bar, its two buttons and the canvas
// container cannot drift from the GTK build. The game has no configurable params, hence no sidebar.

import { mountSharedTree } from '@gjsify/adwaita-web'; // also registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import tree from '../gjs/jelly-jumper-window.blp?shared-tree';
import { startGame, type GameHandle } from '../game.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    /** Base URL for game assets (default: '/'). Used when embedded in the website. */
    assetBase?: string;
    /** Start with audio muted (default: true for browser). */
    startMuted?: boolean;
    /** Enable in-game FPS overlay + [PERF] console logging (also auto-enabled via ?perf=1). */
    enablePerf?: boolean;
}

export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
    mute(): void;
    unmute(): void;
    readonly isMuted: boolean;
}

/** The one element of the mounted tree with this authored id. */
function byId(root: HTMLElement, id: string): HTMLElement {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el === null) throw new Error(`jelly-jumper-window.blp declares no object with the id "${id}"`);
    return el;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const startMuted = options?.startMuted ?? true; // browser defaults to muted

    const { root: win } = mountSharedTree(tree, container);
    const pauseBtn = byId(win, 'pauseButton');
    const audioBtn = byId(win, 'audioButton');

    // The tree holds the buttons' initial (unmuted) state; the browser starts muted by default.
    updateAudioButton(startMuted);

    // Canvas container — flex child that fills the window minus header.
    // IMPORTANT: position:relative is required so the canvas (which Excalibur
    // will style as position:absolute via FitContainerAndFill) uses this as
    // its offset parent and inherits the laid-out dimensions. Inline styles so the layout holds in
    // the website embed too, which loads no showcase CSS.
    const canvasContainer = byId(win, 'canvasContainer');
    canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;background:#000;overflow:hidden';

    // Canvas: no explicit drawing-buffer size — Excalibur's FitContainerAndFill
    // mode reads canvas.offsetWidth/offsetHeight after setting style.width='100%'
    // and drives canvas.width/height from that. We only set the style to ensure
    // the canvas lays out to fill the container (display:block kills the
    // baseline gap, the 100% sizing lets Excalibur read real offset dimensions).
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    canvasContainer.append(canvas);

    let game: GameHandle | null = null;
    let pendingPause = false;
    let pendingMuted = startMuted;

    function updatePauseButton(paused: boolean): void {
        pauseBtn.setAttribute('icon-name', paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
        pauseBtn.setAttribute('tooltip-text', paused ? 'Resume Game' : 'Pause Game');
    }

    function updateAudioButton(muted: boolean): void {
        audioBtn.setAttribute('icon-name', muted ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic');
        audioBtn.setAttribute('tooltip-text', muted ? 'Unmute Audio' : 'Mute Audio');
    }

    pauseBtn.addEventListener('click', () => {
        if (game) {
            if (game.isPaused) game.resume();
            else game.pause();
            updatePauseButton(game.isPaused);
        } else {
            pendingPause = !pendingPause;
            updatePauseButton(pendingPause);
        }
    });

    audioBtn.addEventListener('click', () => {
        if (game) {
            if (game.isMuted) game.unmute();
            else game.mute();
            updateAudioButton(game.isMuted);
        } else {
            pendingMuted = !pendingMuted;
            updateAudioButton(pendingMuted);
        }
    });

    // Wait for layout so canvasContainer has dimensions before we construct
    // the engine (avoids "Framebuffer not complete" WebGL warnings from a
    // zero-sized initial render). Audio unlocks automatically on the first
    // click/keydown via Excalibur's global user-gesture listeners — no
    // custom overlay needed (matches the upstream sample's behavior).
    const ro = new ResizeObserver(() => {
        if (game) return;
        if (canvasContainer.clientWidth === 0 || canvasContainer.clientHeight === 0) return;
        ro.disconnect();
        const enablePerf =
            options?.enablePerf ??
            (typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1');
        startGame(canvas, { startMuted: pendingMuted, assetBase: options?.assetBase, platform: 'browser', enablePerf })
            .then((g) => {
                game = g;
                if (pendingPause) {
                    game.pause();
                    pendingPause = false;
                }
                updatePauseButton(game.isPaused);
                updateAudioButton(game.isMuted);
            })
            .catch((err) => {
                console.error('JellyJumper: startGame failed:', err);
            });
    });
    ro.observe(canvasContainer);

    return {
        get isPaused() {
            return game ? game.isPaused : pendingPause;
        },
        pause() {
            if (game) {
                game.pause();
                updatePauseButton(true);
            } else {
                pendingPause = true;
                updatePauseButton(true);
            }
        },
        resume() {
            if (game) {
                game.resume();
                updatePauseButton(false);
            } else {
                pendingPause = false;
                updatePauseButton(false);
            }
        },
        get isMuted() {
            return game ? game.isMuted : pendingMuted;
        },
        mute() {
            if (game) {
                game.mute();
                updateAudioButton(true);
            } else {
                pendingMuted = true;
                updateAudioButton(true);
            }
        },
        unmute() {
            if (game) {
                game.unmute();
                updateAudioButton(false);
            } else {
                pendingMuted = false;
                updateAudioButton(false);
            }
        },
    };
}
