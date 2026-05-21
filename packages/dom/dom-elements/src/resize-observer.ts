// ResizeObserver polyfill for GJS — original implementation
// Reference (spec):   https://drafts.csswg.org/resize-observer/
// Reference (Node refs): refs/happy-dom/packages/happy-dom/src/resize-observer/ResizeObserver.ts
// Reference (browser): refs/jsdom/lib/jsdom/living/nodes/ResizeObserver-impl.js
// Modifications: wired into the GJS bridge resize pipeline (see
//                ./notify-resize.ts). No layout engine — sizes come from
//                framework bridges that own the real GTK widget.
//
// Why a real implementation (not a stub):
// Excalibur.js 0.32's `Screen._setResolutionAndViewportByDisplayMode()`
// installs `ResizeObserver` on `canvas.parentElement` (typically
// `document.body`) when `DisplayMode.FillContainer` is used. A stub would
// never re-run that calculation when the GTK widget allocation changes,
// stranding the rendered world at its initial resolution after every
// window/sidebar resize. See `docs/reports/webgl-bridge-resize-observer.md`
// for the full root-cause analysis.

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

export type ResizeObserverCallback = (
	entries: ResizeObserverEntry[],
	observer: ResizeObserver,
) => void;

export interface ResizeObserverOptions {
	box?: 'content-box' | 'border-box' | 'device-pixel-content-box';
}

/**
 * Cross-process queue of pending entries — flushed in a microtask so a
 * burst of resize notifications (e.g. one per ancestor in the parent
 * chain, or a synchronous GTK resize storm during application startup)
 * collapses into a single callback per observer with deduplicated
 * entries. Matches the spec's "deliver resize loop notifications"
 * semantics where each observation cycle batches into one delivery.
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
 * `ResizeObserver` polyfill. Subscribes to bridge-reported GTK widget
 * resizes via `Element._onResize()` (see `./element.ts`). The bridge calls
 * `notifyElementResize()` from `./notify-resize.ts` which fires the
 * subscribers on the resized element and every ancestor.
 *
 * @example
 * ```ts
 * const observer = new ResizeObserver((entries) => {
 *   for (const entry of entries) {
 *     console.log(entry.target, entry.contentRect.width, entry.contentRect.height);
 *   }
 * });
 * observer.observe(canvas);  // canvas paired with a Gtk.GLArea by WebGLBridge
 * // resize the GTK widget → callback fires with the new dimensions
 * observer.disconnect();
 * ```
 */
export class ResizeObserver {
	private readonly _callback: ResizeObserverCallback;
	private readonly _observed = new Map<Element, () => void>();
	private _pending = new Map<Element, ResizeObserverEntry>();

	constructor(callback: ResizeObserverCallback) {
		this._callback = callback;
	}

	/**
	 * Start observing `target`. Per spec, the first observation reports
	 * the target's current size — we honour this on a microtask so
	 * consumers that observe inside an initialisation routine receive
	 * the first measurement after their setup completes.
	 *
	 * `opts.box` is accepted for spec compatibility but does not change
	 * behaviour here — content-box, border-box, and device-pixel-content-box
	 * all map to the same single allocation reported by GTK.
	 */
	observe(target: Element, _opts?: ResizeObserverOptions): void {
		if (this._observed.has(target)) return;
		const unsubscribe = target._onResize((width, height) => {
			this._enqueue(target, width, height);
		});
		this._observed.set(target, unsubscribe);
		// Initial measurement, microtask-deferred to mirror spec timing.
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
	// HTMLElement.getBoundingClientRect() exists on every element that ends
	// up paired with a bridge (HTMLCanvasElement / HTMLVideoElement /
	// HTMLIFrameElement all extend HTMLElement). Fall back to 0×0 for the
	// rare case of an Element that doesn't expose it (e.g. an SVG root in
	// older tests).
	const fn = (target as Element & {
		getBoundingClientRect?: () => { width: number; height: number };
	}).getBoundingClientRect;
	if (typeof fn === 'function') {
		const rect = fn.call(target);
		return { width: rect.width ?? 0, height: rect.height ?? 0 };
	}
	return { width: 0, height: 0 };
}
