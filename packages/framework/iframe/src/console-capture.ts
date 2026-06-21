// Console capture for @gjsify/iframe — original implementation.
//
// Forwards a page's `console.*` output to the GJS host so a debugging embedder
// can read it. The in-page hook (a self-contained UserScript) wraps the
// console methods, preserving their original output, and posts each call over
// the existing WebKit message handler. The host-side parse + buffer live here
// too so they unit-test headless (no WebView needed).

import type { ConsoleLogEntry } from './types/index.js';

/** Console levels the in-page hook wraps. */
const LEVELS = ['log', 'warn', 'error', 'info', 'debug'] as const;

/**
 * Build the self-contained in-page UserScript that mirrors `console.*` to the
 * host via `window.webkit.messageHandlers[channelName]`.
 *
 * Self-contained (acquires its own handler reference, own idempotency guard) so
 * it can be injected as a separate UserScript independent of the postMessage
 * bootstrap — it is opt-in (`captureConsole`), so it must not be entangled with
 * the always-injected bridge script. ES5 to match the bootstrap's style.
 *
 * Each forwarded entry is `{__gjsifyConsole: level, args: string[]}` — args are
 * stringified in-page (objects via JSON, Errors as `name: message`) so the host
 * never has to traverse a live JS graph across the bridge.
 */
export function buildConsoleCaptureScript(channelName: string): string {
    const channel = JSON.stringify(channelName);
    const levels = JSON.stringify(LEVELS);
    return `(function(){
    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[${channel}];
    if (!handler) return;
    if (window.__gjsifyConsoleHook) return;
    window.__gjsifyConsoleHook = true;
    function stringify(a){
        if (typeof a === 'string') return a;
        if (a instanceof Error) return (a.name || 'Error') + ': ' + (a.message || '');
        try { return JSON.stringify(a); }
        catch (_e) { try { return String(a); } catch (_e2) { return '[unserializable]'; } }
    }
    var levels = ${levels};
    for (var i = 0; i < levels.length; i++) {
        (function(level){
            var orig = (console[level] && console[level].bind) ? console[level].bind(console) : function(){};
            console[level] = function(){
                var args = Array.prototype.slice.call(arguments);
                try { handler.postMessage(JSON.stringify({ __gjsifyConsole: level, args: args.map(stringify) })); }
                catch (_e) {}
                return orig.apply(console, arguments);
            };
        })(levels[i]);
    }
})();`;
}

/**
 * Parse a received envelope into a {@link ConsoleLogEntry}, or null when it is
 * not a console envelope. Defensive — a tampered page must not crash the host:
 * non-string args are coerced to strings, a missing args array becomes empty.
 */
export function parseConsoleEnvelope(envelope: unknown): ConsoleLogEntry | null {
    if (envelope === null || typeof envelope !== 'object') return null;
    const level = (envelope as { __gjsifyConsole?: unknown }).__gjsifyConsole;
    if (typeof level !== 'string') return null;
    const rawArgs = (envelope as { args?: unknown }).args;
    const args = Array.isArray(rawArgs) ? rawArgs.map((a) => (typeof a === 'string' ? a : String(a))) : [];
    return { level, args };
}

/**
 * Bounded ring buffer of console entries. Keeps at most `max` (oldest dropped),
 * so a chatty page can't grow host memory without bound.
 */
export class ConsoleBuffer {
    private _entries: ConsoleLogEntry[] = [];
    constructor(private readonly _max = 1000) {}

    push(entry: ConsoleLogEntry): void {
        this._entries.push(entry);
        if (this._entries.length > this._max) {
            this._entries.splice(0, this._entries.length - this._max);
        }
    }

    /** A copy of the buffered entries (oldest first). */
    list(): ConsoleLogEntry[] {
        return this._entries.slice();
    }

    clear(): void {
        this._entries = [];
    }
}
