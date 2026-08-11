// ResizeObserver polyfill for GJS. There is no layout engine: sizes arrive from the framework
// bridges that own the real GTK widget, via ./notify-resize.ts.
// Reference (spec):   https://drafts.csswg.org/resize-observer/
// Reference (Node refs): refs/happy-dom/packages/happy-dom/src/resize-observer/ResizeObserver.ts
// Reference (browser): refs/jsdom/lib/jsdom/living/nodes/ResizeObserver-impl.js
//
// A stub would not do: Excalibur's `Screen._setResolutionAndViewportByDisplayMode()` installs a
// `ResizeObserver` on `canvas.parentElement` under `DisplayMode.FillContainer`, so with a stub the
// rendered world stays at its initial resolution after every window or sidebar resize.

import type { Element } from './element.js';

/** Spec: https://drafts.csswg.org/resize-observer/#resizeobserversize */
export interface ResizeObserverSize {
    inlineSize: number;
    blockSize: number;
}

/** Spec: https://drafts.csswg.org/resize-observer/#resizeobserverentry */
export interface ResizeObserverEntry {
    target: Element;
    contentRect: DOMRectLike;
    borderBoxSize: readonly ResizeObserverSize[];
    contentBoxSize: readonly ResizeObserverSize[];
    devicePixelContentBoxSize: readonly ResizeObserverSize[];
}

/** Subset of DOMRectReadOnly that `getBoundingClientRect()` already returns. */
interface DOMRectLike {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

export interface ResizeObserverOptions {
    box?: 'content-box' | 'border-box' | 'device-pixel-content-box';
}

/**
 * Module-level queue of pending entries, flushed in a microtask so a burst of notifications (one
 * per ancestor in the parent chain, or a synchronous GTK resize storm at startup) collapses into
 * one callback per observer with deduplicated entries — the spec's "deliver resize loop
 * notifications" batching.
 */
const pendingDelivery: Set<ResizeObserver> = new Set();
let flushScheduled = false;

function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        const batch = Array.from(pendingDelivery);
        pendingDelivery.clear();
        for (const observer of batch) {
            observer._deliver();
        }
    });
}

/**
 * `ResizeObserver` polyfill. Subscribes to bridge-reported GTK widget resizes through
 * `Element._onResize()`; `notifyElementResize()` fires those subscribers on the resized element and
 * every ancestor.
 */
export class ResizeObserver {
    private readonly _callback: ResizeObserverCallback;
    private readonly _observed = new Map<Element, () => void>();
    private _pending = new Map<Element, ResizeObserverEntry>();

    constructor(callback: ResizeObserverCallback) {
        this._callback = callback;
    }

    /**
     * Start observing `target`. The spec's mandatory first observation of the current size is
     * deferred to a microtask, so a consumer observing inside an init routine gets that measurement
     * after its setup completes. `opts.box` is accepted for compatibility but changes nothing: all
     * three box modes map to the single allocation GTK reports.
     */
    observe(target: Element, _opts?: ResizeObserverOptions): void {
        if (this._observed.has(target)) return;
        const unsubscribe = target._onResize((width, height) => {
            this._enqueue(target, width, height);
        });
        this._observed.set(target, unsubscribe);
        queueMicrotask(() => {
            if (!this._observed.has(target)) return; // unobserved meanwhile
            const rect = readClientRect(target);
            this._enqueue(target, rect.width, rect.height);
        });
    }

    unobserve(target: Element): void {
        const unsubscribe = this._observed.get(target);
        if (!unsubscribe) return;
        unsubscribe();
        this._observed.delete(target);
        this._pending.delete(target);
    }

    disconnect(): void {
        for (const unsubscribe of this._observed.values()) unsubscribe();
        this._observed.clear();
        this._pending.clear();
        pendingDelivery.delete(this);
    }

    /** @internal Called by the module-level scheduler. */
    _deliver(): void {
        if (this._pending.size === 0) return;
        const entries = Array.from(this._pending.values());
        this._pending.clear();
        try {
            this._callback(entries, this);
        } catch (err) {
            console.error('ResizeObserver callback threw:', err);
        }
    }

    private _enqueue(target: Element, width: number, height: number): void {
        const size: ResizeObserverSize = { inlineSize: width, blockSize: height };
        this._pending.set(target, {
            target,
            contentRect: {
                x: 0,
                y: 0,
                width,
                height,
                top: 0,
                right: width,
                bottom: height,
                left: 0,
            },
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
        });
        pendingDelivery.add(this);
        scheduleFlush();
    }
}

function readClientRect(target: Element): { width: number; height: number } {
    // Every bridge-paired element extends HTMLElement and so has getBoundingClientRect(); the 0×0
    // fallback covers a bare `Element` that does not expose it.
    const fn = (
        target as Element & {
            getBoundingClientRect?: () => { width: number; height: number };
        }
    ).getBoundingClientRect;
    if (typeof fn === 'function') {
        const rect = fn.call(target);
        return { width: rect.width ?? 0, height: rect.height ?? 0 };
    }
    return { width: 0, height: 0 };
}
