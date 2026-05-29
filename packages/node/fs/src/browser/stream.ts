// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Minimal Readable / Writable streams + FSWatcher stub.
//
// We deliberately do NOT pull `@gjsify/stream` so the browser bundle stays
// independent of the wider workspace. Consumers that need a full Node
// stream surface can layer one over these — our impl exposes the minimum
// surface that real-world `fs.createReadStream(p).on('data', …)` users
// hit (`on`, `pipe`, `destroy`, plus the async iterator protocol).

import * as sync from './sync.js';
import { __defaultVolume as vol, absolutise } from './volume.js';

export interface ReadOpts { encoding?: string; start?: number; end?: number; highWaterMark?: number; flags?: string }
export interface WriteOpts { encoding?: string; mode?: number; flags?: string }

class EventBus {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, fn: (...args: unknown[]) => void): this {
        const arr = this.listeners.get(event) ?? [];
        arr.push(fn);
        this.listeners.set(event, arr);
        return this;
    }
    once(event: string, fn: (...args: unknown[]) => void): this {
        const wrapper = (...args: unknown[]) => { this.off(event, wrapper); fn(...args); };
        return this.on(event, wrapper);
    }
    off(event: string, fn: (...args: unknown[]) => void): this {
        const arr = this.listeners.get(event);
        if (!arr) return this;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
        return this;
    }
    emit(event: string, ...args: unknown[]): boolean {
        const arr = this.listeners.get(event);
        if (!arr || arr.length === 0) return false;
        for (const fn of arr.slice()) fn(...args);
        return true;
    }
    removeAllListeners(event?: string): this {
        if (event) this.listeners.delete(event);
        else this.listeners.clear();
        return this;
    }
}

export class ReadStream extends EventBus {
    readonly path: string;
    private destroyed = false;
    private buffer: Uint8Array;
    private position: number;
    private end: number;
    private chunkSize: number;
    private encoding?: string;

    constructor(path: string | URL, opts: ReadOpts = {}) {
        super();
        this.path = absolutise(path);
        try {
            this.buffer = vol.readFileSync(this.path);
        } catch (e) {
            this.buffer = new Uint8Array(0);
            queueMicrotask(() => this.emit('error', e));
            return;
        }
        this.position = opts.start ?? 0;
        this.end = Math.min(opts.end ?? this.buffer.byteLength - 1, this.buffer.byteLength - 1);
        this.chunkSize = opts.highWaterMark ?? 65536;
        this.encoding = opts.encoding;
        queueMicrotask(() => this._pump());
    }

    private _pump(): void {
        if (this.destroyed) return;
        while (this.position <= this.end) {
            const sliceEnd = Math.min(this.position + this.chunkSize, this.end + 1);
            const chunk = this.buffer.subarray(this.position, sliceEnd);
            this.position = sliceEnd;
            if (this.encoding) this.emit('data', new TextDecoder(this.encoding).decode(chunk));
            else this.emit('data', chunk);
        }
        this.emit('end');
        this.emit('close');
    }

    pipe<W extends { write(chunk: Uint8Array): boolean | unknown; end?: () => void }>(dest: W): W {
        this.on('data', (chunk: unknown) => { dest.write(chunk as Uint8Array); });
        this.on('end', () => { dest.end?.(); });
        return dest;
    }

    destroy(err?: Error): void {
        this.destroyed = true;
        if (err) this.emit('error', err);
        this.emit('close');
    }

    async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string> {
        const chunks: Array<Uint8Array | string> = [];
        let done = false;
        let resolve: (() => void) | null = null;
        this.on('data', (chunk: unknown) => {
            chunks.push(chunk as Uint8Array | string);
            resolve?.();
        });
        this.on('end', () => { done = true; resolve?.(); });
        while (!done || chunks.length > 0) {
            if (chunks.length === 0) {
                await new Promise<void>(r => { resolve = r; });
                resolve = null;
                continue;
            }
            const chunk = chunks.shift();
            if (chunk !== undefined) yield chunk;
        }
    }

    // Node ReadStream getters
    get bytesRead(): number { return this.position; }
}

export function createReadStream(path: string | URL, opts?: ReadOpts): ReadStream {
    return new ReadStream(path, opts);
}

export class WriteStream extends EventBus {
    readonly path: string;
    private destroyed = false;
    private parts: Uint8Array[] = [];
    private ended = false;
    private flags: string;
    private mode: number;
    private encoding?: string;
    bytesWritten = 0;

    constructor(path: string | URL, opts: WriteOpts = {}) {
        super();
        this.path = absolutise(path);
        this.flags = opts.flags ?? 'w';
        this.mode = opts.mode ?? 0o666;
        this.encoding = opts.encoding;
        queueMicrotask(() => this.emit('open', -1));
    }

    write(chunk: Uint8Array | string, encOrCb?: string | ((err: Error | null) => void), maybeCb?: (err: Error | null) => void): boolean {
        if (this.destroyed || this.ended) return false;
        const cb = typeof encOrCb === 'function' ? encOrCb : maybeCb;
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        this.parts.push(bytes);
        this.bytesWritten += bytes.byteLength;
        queueMicrotask(() => cb?.(null));
        return true;
    }

    end(chunk?: Uint8Array | string, cb?: () => void): void {
        if (this.ended) return;
        if (chunk) this.write(chunk);
        this.ended = true;
        queueMicrotask(() => {
            try {
                const merged = new Uint8Array(this.parts.reduce((s, p) => s + p.byteLength, 0));
                let off = 0;
                for (const p of this.parts) { merged.set(p, off); off += p.byteLength; }
                if (this.flags === 'a' || this.flags === 'a+') sync.appendFileSync(this.path, merged);
                else sync.writeFileSync(this.path, merged, { mode: this.mode });
                this.emit('finish');
                this.emit('close');
                cb?.();
            } catch (e) {
                this.emit('error', e);
            }
        });
    }

    destroy(err?: Error): void {
        this.destroyed = true;
        if (err) this.emit('error', err);
        this.emit('close');
    }
}

export function createWriteStream(path: string | URL, opts?: WriteOpts): WriteStream {
    return new WriteStream(path, opts);
}

// ───────────── FSWatcher (stub) ──────────────────────────────────────────────
// True file watching is a TODO — the in-memory volume is single-process so a
// future iteration could thread mutator events through here. For now consumers
// get an `EventBus` that exposes `.close()` and never fires — preserves the
// shape so importer code doesn't have to special-case browsers.

export class FSWatcher extends EventBus {
    readonly path: string;
    private closed = false;

    constructor(path: string | URL) {
        super();
        this.path = absolutise(path);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit('close');
    }

    ref(): this { return this; }
    unref(): this { return this; }
}

export function watch(
    path: string | URL,
    _opts?: { persistent?: boolean; recursive?: boolean; encoding?: string },
    _listener?: (eventType: string, filename: string | null) => void,
): FSWatcher {
    return new FSWatcher(path);
}

export class StatWatcher extends EventBus {
    close(): void { this.emit('close'); }
    ref(): this { return this; }
    unref(): this { return this; }
}

export function watchFile(_path: string | URL): StatWatcher {
    return new StatWatcher();
}

export function unwatchFile(_path: string | URL): void { /* no-op */ }
