// Browser UI for the Excalibur Jelly Jumper showcase.
// Mirrors the GJS/Adwaita UI using @gjsify/adwaita-web — HeaderBar with
// pause/resume button only (no sidebar: the game has no configurable params).

import '@gjsify/adwaita-web';
import '@gjsify/adwaita-web/style.css';
import type { AdwHeaderBar } from '@gjsify/adwaita-web';
import { mediaPlaybackPauseSymbolic, mediaPlaybackStartSymbolic } from '@gjsify/adwaita-icons/actions';
import { startGame, type GameHandle } from '../game.js';

export interface ShowcaseHandle {
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

function parseSvg(src: string): SVGElement {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    return doc.documentElement as unknown as SVGElement;
}

export function mount(container: HTMLElement): ShowcaseHandle {
    // Build UI
    const win = document.createElement('adw-window');
    win.setAttribute('width', '1280');
    win.setAttribute('height', '720');

    const headerBar = document.createElement('adw-header-bar') as AdwHeaderBar;
    headerBar.setAttribute('title', 'Jelly Jumper — Excalibur.js');

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

    // Append pause button to header end section after DOM connection
    const endSection = headerBar.endSection ?? headerBar.querySelector('.adw-header-bar-end');
    if (endSection) {
        endSection.appendChild(pauseBtn);
    } else {
        headerBar.append(pauseBtn);
    }

    let game: GameHandle | null = null;
    let pendingPause = false;

    function updatePauseButton(paused: boolean): void {
        pauseBtn.replaceChildren(parseSvg(paused ? mediaPlaybackStartSymbolic : mediaPlaybackPauseSymbolic));
        pauseBtn.title = paused ? 'Resume Game' : 'Pause Game';
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

    // Start overlay — required to unlock AudioContext via user gesture.
    //
    // Firefox and Chromium block AudioContext.resume() until a real user
    // interaction (click, keydown, touch). Without a user gesture,
    // Excalibur's WebAudio.unlock() times out after 200ms and logs
    // "unable to unlock the audio context", then loading proceeds but
    // sound is muted. The traditional Excalibur workaround is its native
    // play button (`suppressPlayButton: false`), but we use our own
    // overlay so it integrates with the Adwaita-Web shell visually.
    //
    // This overlay also solves the canvas-sizing race condition: we only
    // construct the engine AFTER the user clicks, by which point the
    // container has been laid out long enough that
    // canvasContainer.clientWidth/clientHeight are guaranteed > 0 (which
    // avoids the "Framebuffer not complete" WebGL warnings).
    const startOverlay = document.createElement('div');
    startOverlay.style.cssText = [
        'position:absolute', 'inset:0',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.7)',
        'color:white', 'font-family:"Adwaita Sans", system-ui, sans-serif',
        'gap:1rem',
        'cursor:pointer',
        'z-index:10',
        'user-select:none',
    ].join(';');

    const startTitle = document.createElement('div');
    startTitle.textContent = 'Jelly Jumper';
    startTitle.style.cssText = 'font-size:2.5rem;font-weight:700;letter-spacing:0.05em';

    const startHint = document.createElement('div');
    startHint.textContent = 'Click to start';
    startHint.style.cssText = 'font-size:1rem;opacity:0.85';

    const startBtnVisual = document.createElement('div');
    startBtnVisual.textContent = '▶';
    startBtnVisual.style.cssText = [
        'display:flex', 'align-items:center', 'justify-content:center',
        'width:5rem', 'height:5rem',
        'border-radius:50%',
        'background:#3584e4', // Adwaita blue
        'color:white',
        'font-size:2.5rem',
        'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
        'transition:transform 0.15s ease',
    ].join(';');

    startOverlay.append(startTitle, startBtnVisual, startHint);
    canvasContainer.append(startOverlay);

    // Kick off the game on first click. The click itself unlocks the
    // AudioContext (Firefox/Chromium autoplay policy), and since
    // startGame() resolves `WebAudio.unlock()` synchronously on a real
    // user gesture, audio works without the 200ms warning.
    function startOnUserGesture(): void {
        startOverlay.removeEventListener('click', startOnUserGesture);
        startOverlay.remove();

        // Safety: if for some reason the container has no size yet
        // (very early call before layout completed), bail — the
        // startOverlay would have already been hidden, so we'd show
        // an empty screen. This shouldn't happen in practice because
        // the overlay is always visible for at least one paint before
        // the user can click it.
        if (canvasContainer.clientWidth === 0 || canvasContainer.clientHeight === 0) {
            console.error('JellyJumper: canvasContainer has no size at click time');
            return;
        }

        startGame(canvas, '').then(g => {
            game = g;
            if (pendingPause) { game.pause(); pendingPause = false; }
            updatePauseButton(game.isPaused);
        }).catch(err => {
            console.error('JellyJumper: startGame failed:', err);
        });
    }
    startOverlay.addEventListener('click', startOnUserGesture);

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
    };
}
