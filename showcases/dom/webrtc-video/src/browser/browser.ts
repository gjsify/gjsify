// Browser entry — WebRTC video preview with native <video> element.
//
// Exposes `mount(container, options?)` so the website slideshow can embed
// the showcase. Standalone runs go through `browser-main.ts` which calls
// `mount(document.body)`.

import { startVideo } from '../video-demo.js';

export interface MountOptions {
    /** Override the heading shown above the video. */
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

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const title = options?.title ?? 'WebRTC Video — Webcam Preview';

    const root = document.createElement('section');
    root.style.fontFamily = 'monospace';
    root.style.background = '#1e1e2e';
    root.style.color = '#cdd6f4';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.alignItems = 'center';
    root.style.justifyContent = 'center';
    root.style.padding = '1rem';
    root.style.minHeight = '100%';
    root.style.boxSizing = 'border-box';

    const headingEl = document.createElement('h1');
    headingEl.textContent = title;
    headingEl.style.fontSize = '1.2rem';
    headingEl.style.color = '#89b4fa';
    headingEl.style.margin = '0 0 0.75rem 0';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.maxWidth = '100%';
    video.style.maxHeight = '70vh';
    video.style.borderRadius = '12px';
    video.style.background = '#000';

    const statusEl = document.createElement('div');
    statusEl.textContent = 'Initializing...';
    statusEl.style.fontSize = '0.9rem';
    statusEl.style.marginTop = '0.75rem';

    root.appendChild(headingEl);
    root.appendChild(video);
    root.appendChild(statusEl);
    container.appendChild(root);

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
            if (root.parentNode) root.parentNode.removeChild(root);
        },
    };
}
