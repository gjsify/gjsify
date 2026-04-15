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

// globalThis.addEventListener / removeEventListener / dispatchEvent
if (typeof (globalThis as any).addEventListener !== 'function') {
    const _globalEventTarget = new OurEventTarget();
    (globalThis as any).__gjsify_globalEventTarget = _globalEventTarget;
    (globalThis as any).addEventListener = (type: string, listener: any, options?: any) =>
        _globalEventTarget.addEventListener(type, listener, options);
    (globalThis as any).removeEventListener = (type: string, listener: any, options?: any) =>
        _globalEventTarget.removeEventListener(type, listener, options);
    (globalThis as any).dispatchEvent = (event: Event) =>
        _globalEventTarget.dispatchEvent(event as any);
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
if (typeof (globalThis as any).top === 'undefined') {
    Object.defineProperty(globalThis, 'top', {
        get: () => globalThis,
        configurable: true,
    });
}
