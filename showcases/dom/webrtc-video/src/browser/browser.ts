// Browser entry — WebRTC webcam preview in an Adwaita window (via
// @gjsify/adwaita-web), mirroring the native GJS chrome (src/gjs/gjs.ts): an
// Adw.ApplicationWindow + Adw.HeaderBar + the video filling the content. The
// browser uses a real <video>; the GJS variant uses a VideoBridge.
//
// Exposes `mount(container, options?)` so the website slideshow can embed the
// showcase. Standalone runs go through `browser-main.ts` (`mount(document.body)`).

import '@gjsify/adwaita-web'; // registers the custom elements + self-injects the stylesheet
// A showcase is served to whatever browser opens it, so it cannot assume the host has
// Adwaita Sans the way a GNOME desktop does. `import '@gjsify/adwaita-web'` names the
// family and ships no `@font-face`, so without this call the chrome renders in the host's
// default sans on macOS, on Windows and on any Linux that is not GNOME — and looks right
// only on the machine it was written on.
import { applyAdwaitaFonts } from '@gjsify/adwaita-web/fonts';
import { startVideo } from '../video-demo.js';

// Idempotent, and a no-op where there is no `document` — so a build-time import of this
// module (the website slideshow does one) neither throws nor half-applies.
applyAdwaitaFonts();

export interface MountOptions {
    /** Override the header bar title. */
    title?: string;
}

/** Handle returned by `mount()` so hosts can pause / resume / stop. */
export interface ShowcaseHandle {
    /** Suppress further status updates (the underlying MediaStream keeps running). */
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
    /** Release the webcam and remove the showcase DOM. */
    stop(): void;
}

const SHOWCASE_CSS = `
.wv-window { height: 100%; width: 100%; overflow: hidden; }
.wv-content {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; padding: 18px;
    background: var(--window-bg-color);
}
.wv-video { max-width: 100%; max-height: 100%; border-radius: 12px; background: #000; }
.wv-status {
    color: var(--window-fg-color); opacity: var(--dim-opacity);
    font-family: ui-monospace, 'Adwaita Mono', monospace; font-size: var(--font-size-small);
}
`;

function ensureStyles(): void {
    if (document.getElementById('webrtc-video-style')) return;
    const s = document.createElement('style');
    s.id = 'webrtc-video-style';
    s.textContent = SHOWCASE_CSS;
    document.head.appendChild(s);
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const title = options?.title ?? 'WebRTC Video — Webcam Preview';
    ensureStyles();

    const win = document.createElement('adw-window');
    win.classList.add('wv-window');

    const header = document.createElement('adw-header-bar');
    header.setAttribute('title', title);

    const content = document.createElement('div');
    content.className = 'wv-content';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = 'wv-video';

    const statusEl = document.createElement('div');
    statusEl.className = 'wv-status';
    statusEl.textContent = 'Initializing…';

    content.append(video, statusEl);
    win.append(header, content);
    container.appendChild(win);

    let paused = false;
    let stream: MediaStream | null = null;

    function log(msg: string): void {
        if (paused) return;
        statusEl.textContent = msg;
        console.log(`[webrtc-video] ${msg}`);
    }

    startVideo(video, log)
        .then((s) => {
            stream = s;
        })
        .catch((err: unknown) => {
            const msg = (err as Error)?.message ?? String(err);
            statusEl.textContent = `Error: ${msg}`;
        });

    return {
        pause(): void {
            paused = true;
        },
        resume(): void {
            paused = false;
        },
        get isPaused(): boolean {
            return paused;
        },
        stop(): void {
            paused = true;
            if (stream) {
                for (const track of stream.getTracks()) track.stop();
                stream = null;
            }
            if (win.parentNode) win.parentNode.removeChild(win);
        },
    };
}
