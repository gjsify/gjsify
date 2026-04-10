// Browser UI for the Excalibur Jelly Jumper showcase.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web — HeaderBar with
// pause/resume button only (no sidebar: the game has no configurable params).

import '@gjsify/adwaita-web';
import '@gjsify/adwaita-web/style.css';
import type { AdwHeaderBar } from '@gjsify/adwaita-web';
import { mediaPlaybackPauseSymbolic, mediaPlaybackStartSymbolic } from '@gjsify/adwaita-icons/actions';
import { audioVolumeHighSymbolic, audioVolumeMutedSymbolic } from '@gjsify/adwaita-icons/status';
import { startGame, type GameHandle } from '../game.js';

export interface MountOptions {
    /** Base URL for game assets (default: '/'). Used when embedded in the website. */
    assetBase?: string;
    /** Start with audio muted (default: true for browser). */
    startMuted?: boolean;
}

export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
    mute(): void;
    unmute(): void;
    readonly isMuted: boolean;
}

function parseSvg(src: string): SVGElement {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    return doc.documentElement as unknown as SVGElement;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const startMuted = options?.startMuted ?? true; // browser defaults to muted

    // Build UI
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1280');
    win.setAttribute('height', '720');

    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Jelly Jumper — Excalibur.js');

    // Audio toggle button
    const audioBtn = document.createElement('button');
    audioBtn.className = 'adw-header-btn';
    audioBtn.title = startMuted ? 'Unmute Audio' : 'Mute Audio';
    audioBtn.replaceChildren(parseSvg(startMuted ? audioVolumeMutedSymbolic : audioVolumeHighSymbolic));

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'adw-header-btn';
    pauseBtn.title = 'Pause Game';
    pauseBtn.replaceChildren(parseSvg(mediaPlaybackPauseSymbolic));

    // Canvas container — flex child that fills the window minus header.
    // IMPORTANT: position:relative is required so the canvas (which Excalibur
    // will style as position:absolute via FitContainerAndFill) uses this as
    // its offset parent and inherits the laid-out dimensions.
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;background:#000;overflow:hidden';

    // Canvas: no explicit drawing-buffer size — Excalibur's FitContainerAndFill
    // mode reads canvas.offsetWidth/offsetHeight after setting style.width='100%'
    // and drives canvas.width/height from that. We only set the style to ensure
    // the canvas lays out to fill the container (display:block kills the
    // baseline gap, the 100% sizing lets Excalibur read real offset dimensions).
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    canvasContainer.append(canvas);

    win.append(headerBar, canvasContainer);
    container.append(win);

    // Append buttons to header end section after DOM connection
    const endSection = headerBar.endSection ?? headerBar.querySelector('.adw-header-bar-end');
    if (endSection) {
        endSection.appendChild(audioBtn);
        endSection.appendChild(pauseBtn);
    } else {
        headerBar.append(audioBtn, pauseBtn);
    }

    let game: GameHandle | null = null;
    let pendingPause = false;
    let pendingMuted = startMuted;

    function updatePauseButton(paused: boolean): void {
        pauseBtn.replaceChildren(parseSvg(paused ? mediaPlaybackStartSymbolic : mediaPlaybackPauseSymbolic));
        pauseBtn.title = paused ? 'Resume Game' : 'Pause Game';
    }

    function updateAudioButton(muted: boolean): void {
        audioBtn.replaceChildren(parseSvg(muted ? audioVolumeMutedSymbolic : audioVolumeHighSymbolic));
        audioBtn.title = muted ? 'Unmute Audio' : 'Mute Audio';
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
        startGame(canvas, { startMuted: pendingMuted, assetBase: options?.assetBase }).then(g => {
            game = g;
            if (pendingPause) { game.pause(); pendingPause = false; }
            updatePauseButton(game.isPaused);
            updateAudioButton(game.isMuted);
        }).catch(err => {
            console.error('JellyJumper: startGame failed:', err);
        });
    });
    ro.observe(canvasContainer);

    return {
        get isPaused() { return game ? game.isPaused : pendingPause; },
        pause() {
            if (game) { game.pause();  updatePauseButton(true);  }
            else { pendingPause = true;  updatePauseButton(true);  }
        },
        resume() {
            if (game) { game.resume(); updatePauseButton(false); }
            else { pendingPause = false; updatePauseButton(false); }
        },
        get isMuted() { return game ? game.isMuted : pendingMuted; },
        mute() {
            if (game) { game.mute();   updateAudioButton(true);  }
            else { pendingMuted = true;  updateAudioButton(true);  }
        },
        unmute() {
            if (game) { game.unmute(); updateAudioButton(false); }
            else { pendingMuted = false; updateAudioButton(false); }
        },
    };
}
