// Bridge → DOM ResizeObserver pipeline: framework bridges (canvas / video / iframe /
// webgl) call this from their GTK `resize` handler, so consumer code written against the
// standard `new ResizeObserver(cb).observe(target)` API sees GTK allocation changes at
// all. Without it a bridged canvas stays at its initial resolution after every resize.

import { Element } from './element.js';
import type { Node } from './node.js';

/**
 * Notify every `ResizeObserver` subscribed to `target` — or to any ancestor of `target` —
 * that the backing widget's allocation just changed. Dimensions are CSS pixels.
 */
export function notifyElementResize(target: Element, width: number, height: number): void {
    // The cached allocation is written, not only dispatched: consumers read `clientWidth` /
    // `clientHeight` inside the resize callback and would otherwise see 0.
    target._allocatedClientWidth = width;
    target._allocatedClientHeight = height;
    target._fireResizeSubscribers(width, height);

    // Ancestors get the write and the dispatch too, because Excalibur's `_getParent()`
    // returns `canvas.parentElement || document.body`, never the canvas itself — a
    // canvas-only notification never reaches its observer. Shared ancestors collapse to
    // last-write-wins, acceptable while "one canvas fills the window" is the dominant case.
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
