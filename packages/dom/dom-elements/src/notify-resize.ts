// Bridge → DOM ResizeObserver pipeline.
//
// Framework bridges (`@gjsify/webgl`'s `WebGLBridge`, `@gjsify/canvas2d`'s
// `Canvas2DBridge`, `@gjsify/video`'s `VideoBridge`, `@gjsify/iframe`'s
// `IFrameBridge`) own a real GTK widget paired with a polyfill DOM element
// (canvas / video / iframe). When the GTK widget's `resize` signal fires,
// the bridge must reach the `ResizeObserver` machinery — without this, a
// consumer writing standard `new ResizeObserver(cb).observe(target)` code
// (Excalibur.js 0.32's `DisplayMode.FillContainer` is the canonical
// example) never gets notified of GTK allocation changes, and the rendered
// world stays at its initial resolution after every resize.
//
// This function is the single entry point: bridges call it once per GTK
// resize with the affected DOM element + new dimensions. Subscribers on
// the element itself fire first, then we walk up the parent chain and
// fire each ancestor's subscribers in turn — this is the part that
// matters most in practice. Excalibur's `_getParent()` returns
// `canvas.parentElement || document.body`, never the canvas itself, so a
// resize that only fired on the canvas would never reach Excalibur's
// observer.

import { Element } from './element.js';
import type { Node } from './node.js';

/**
 * Notify every `ResizeObserver` subscribed to `target` — or to any
 * ancestor of `target` — that the backing widget's allocation just
 * changed. Called from framework bridges' GTK `resize` signal handlers.
 *
 * @param target  the polyfill DOM element paired with the resized widget
 * @param width   the widget's new allocated width (CSS pixels)
 * @param height  the widget's new allocated height (CSS pixels)
 */
export function notifyElementResize(target: Element, width: number, height: number): void {
	// Update the cached allocation on the target + its ancestors so
	// `clientWidth` / `clientHeight` getters return the new size.
	// Without this, consumers that read `parent.clientWidth` after
	// the ResizeObserver fires (Excalibur.js's `Screen.FillContainer`
	// path is the canonical case) would see 0 even though the
	// callback fired with correct dimensions, defeating the whole
	// pipeline.
	target._allocatedClientWidth = width;
	target._allocatedClientHeight = height;
	target._fireResizeSubscribers(width, height);

	// Walk up the parent chain. Both the dimension write + the
	// subscriber dispatch happen at every ancestor — Excalibur's
	// observer is on `canvas.parentElement` (i.e. `document.body`
	// when the canvas is attached directly), and it reads that
	// element's `clientWidth` in its resize-handler callback.
	// Multi-bridge scenarios collapse on shared ancestors
	// (last-write-wins on `document.body`); acceptable since the
	// "one canvas filling the window" pattern is the dominant one.
	let node: Node | null = target.parentNode;
	while (node) {
		if (node instanceof Element) {
			node._allocatedClientWidth = width;
			node._allocatedClientHeight = height;
			node._fireResizeSubscribers(width, height);
		}
		node = node.parentNode;
	}
}
