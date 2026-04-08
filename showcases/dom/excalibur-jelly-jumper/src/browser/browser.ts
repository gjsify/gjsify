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

    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = 'flex:1;position:relative;min-width:0;min-height:0;background:#000;overflow:hidden';

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

    // Start the game once the container has a real size. baseUrl = '' uses
    // relative paths (served by the dev/http-server from the same dist/).
    new ResizeObserver(() => {
        const w = canvasContainer.clientWidth;
        const h = canvasContainer.clientHeight;
        if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
        }
        if (!game && canvas.width > 0 && canvas.height > 0) {
            startGame(canvas, '').then(g => {
                game = g;
                if (pendingPause) { game.pause(); pendingPause = false; }
                updatePauseButton(game.isPaused);
            });
        }
    }).observe(canvasContainer);

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
