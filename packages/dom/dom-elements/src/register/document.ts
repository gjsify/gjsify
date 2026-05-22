// Registers: document, Text, Comment, DocumentFragment, DOMTokenList
// + browser environment globals: self, window, Window, focus, blur, top,
//   alert, devicePixelRatio, addEventListener/removeEventListener/dispatchEvent

import { EventTarget as OurEventTarget } from '@gjsify/dom-events';

import { Comment } from '../comment.js';
import { document } from '../document.js';
import { DocumentFragment } from '../document-fragment.js';
import { DOMTokenList } from '../dom-token-list.js';
import { Text } from '../text.js';
import { defineGlobal, defineGlobalIfMissing } from './helpers.js';

defineGlobal('Text', Text);
defineGlobal('Comment', Comment);
defineGlobal('DocumentFragment', DocumentFragment);
defineGlobal('DOMTokenList', DOMTokenList);
defineGlobal('document', document);

// self — three.js checks `typeof self !== 'undefined'` for animation context
defineGlobalIfMissing('self', globalThis);

// window + Window — Excalibur's _applyDisplayMode uses `this.parent instanceof Window`
class Window {}
defineGlobalIfMissing('Window', Window);
defineGlobalIfMissing('window', globalThis);

// window.focus() / window.blur() stubs
defineGlobalIfMissing('focus', () => {});
defineGlobalIfMissing('blur', () => {});

/**
 * Module-local typed view of the globalThis-level event-target methods this
 * file installs. Centralises the 5 `(globalThis as any)` casts that would
 * otherwise appear in the install branch.
 */
interface _GlobalEventTarget {
    __gjsify_globalEventTarget?: OurEventTarget;
    addEventListener?: (type: string, listener: unknown, options?: unknown) => void;
    removeEventListener?: (type: string, listener: unknown, options?: unknown) => void;
    dispatchEvent?: (event: Event) => boolean;
}

// globalThis.addEventListener / removeEventListener / dispatchEvent
{
    const g = globalThis as unknown as _GlobalEventTarget;
    if (typeof g.addEventListener !== 'function') {
        const _globalEventTarget = new OurEventTarget();
        g.__gjsify_globalEventTarget = _globalEventTarget;
        // `_globalEventTarget` is the `@gjsify/dom-events` EventTarget, whose
        // type-level Event is structurally narrower than the global lib's.
        // The runtime accepts either shape; we cast through `unknown` so the
        // global signatures (lib.dom.d.ts) keep their assignability.
        type AnyListener = Parameters<OurEventTarget['addEventListener']>[1];
        type AnyAddOpts = Parameters<OurEventTarget['addEventListener']>[2];
        type AnyRemoveOpts = Parameters<OurEventTarget['removeEventListener']>[2];
        g.addEventListener = (type, listener, options) =>
            _globalEventTarget.addEventListener(type as string, listener as AnyListener, options as AnyAddOpts);
        g.removeEventListener = (type, listener, options) =>
            _globalEventTarget.removeEventListener(type as string, listener as AnyListener, options as AnyRemoveOpts);
        g.dispatchEvent = (event) =>
            _globalEventTarget.dispatchEvent(event as unknown as Parameters<OurEventTarget['dispatchEvent']>[0]);
    }
}

// devicePixelRatio — defaults to 1 (no HiDPI scaling in GTK GL context)
defineGlobalIfMissing('devicePixelRatio', 1);

// scrollX/scrollY — always 0 in a GTK widget (no page scrolling). Excalibur's
// getPosition() does `rect.x + window.scrollX`, producing NaN if scrollX is
// undefined and breaking all pointer coordinates.
defineGlobalIfMissing('scrollX', 0);
defineGlobalIfMissing('scrollY', 0);
defineGlobalIfMissing('pageXOffset', 0);
defineGlobalIfMissing('pageYOffset', 0);

// alert — stub redirecting to console.error
defineGlobalIfMissing('alert', (...args: unknown[]) => console.error('alert:', ...args));

// window.top — prevents Excalibur's iframe detection from crashing
if (typeof (globalThis as unknown as { top?: unknown }).top === 'undefined') {
    Object.defineProperty(globalThis, 'top', {
        get: () => globalThis,
        configurable: true,
    });
}
