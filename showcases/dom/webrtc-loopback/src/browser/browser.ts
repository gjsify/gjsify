// Browser entry — WebRTC data-channel loopback with mount() API.
//
// Exposes `mount(container, options?)` so the website slideshow can embed
// the showcase. Standalone runs go through `browser-main.ts` which calls
// `mount(document.body)`.

import { runLoopback } from '../loopback-demo.js';

export interface MountOptions {
    /** Override the heading shown above the log. */
    title?: string;
}

/** Handle returned by `mount()` so hosts can pause / resume / restart. */
export interface ShowcaseHandle {
    /** Stop accepting new log entries (UI only; underlying RTCPeerConnection
     *  pair keeps running). */
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
    /** Drop all log lines and restart the loopback round-trip from scratch. */
    restart(): Promise<void>;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    const title = options?.title ?? 'WebRTC Data-Channel Loopback';

    // Build the embedded UI: heading + preformatted log + restart button.
    // Styles are inline so the showcase is self-contained — no external CSS
    // file the website would need to host separately.
    const root = document.createElement('section');
    root.style.fontFamily = 'monospace';
    root.style.background = '#1e1e2e';
    root.style.color = '#cdd6f4';
    root.style.padding = '1rem';
    root.style.minHeight = '100%';
    root.style.boxSizing = 'border-box';

    const header = document.createElement('header');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '0.5rem';
    header.style.marginBottom = '0.5rem';

    const headingEl = document.createElement('h1');
    headingEl.textContent = title;
    headingEl.style.fontSize = '1.2rem';
    headingEl.style.color = '#89b4fa';
    headingEl.style.margin = '0';
    headingEl.style.flex = '1';

    const restartBtn = document.createElement('button');
    restartBtn.textContent = 'Restart';
    restartBtn.style.background = '#45475a';
    restartBtn.style.color = '#cdd6f4';
    restartBtn.style.border = '1px solid #585b70';
    restartBtn.style.borderRadius = '4px';
    restartBtn.style.padding = '0.3rem 0.8rem';
    restartBtn.style.cursor = 'pointer';
    restartBtn.style.fontFamily = 'inherit';

    header.appendChild(headingEl);
    header.appendChild(restartBtn);

    const logEl = document.createElement('pre');
    logEl.style.whiteSpace = 'pre-wrap';
    logEl.style.fontSize = '0.85rem';
    logEl.style.lineHeight = '1.5';
    logEl.style.maxHeight = '70vh';
    logEl.style.overflowY = 'auto';
    logEl.style.margin = '0';

    root.appendChild(header);
    root.appendChild(logEl);
    container.appendChild(root);

    let paused = false;

    function log(tag: string, msg: string): void {
        if (paused) return;
        const line = `[${tag}] ${msg}\n`;
        logEl.textContent += line;
        logEl.scrollTop = logEl.scrollHeight;
    }

    function clearLog(): void {
        logEl.textContent = '';
    }

    async function runOnce(): Promise<void> {
        try {
            await runLoopback(log);
        } catch (err) {
            log('ERROR', (err as Error)?.message ?? String(err));
        }
    }

    restartBtn.addEventListener('click', () => {
        clearLog();
        void runOnce();
    });

    // Kick off the first run automatically.
    void runOnce();

    return {
        pause(): void { paused = true; },
        resume(): void { paused = false; },
        get isPaused(): boolean { return paused; },
        async restart(): Promise<void> {
            clearLog();
            await runOnce();
        },
    };
}
