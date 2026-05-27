// Side-effect module: registers EventSource as a global on GJS. Also ensures
// Event, EventTarget and MessageEvent are available (eventsource needs them
// internally). On Node.js the alias layer routes this to @gjsify/empty.

import { Event as DomEvent, EventTarget as DomEventTarget, MessageEvent as DomMessageEvent } from '@gjsify/dom-events';
import EventSource from './index.js';

/** Module-local typed view of the globals this file writes. */
interface _EventSourceGlobals {
    Event?: typeof DomEvent;
    EventTarget?: typeof DomEventTarget;
    MessageEvent?: typeof DomMessageEvent;
    EventSource?: typeof EventSource;
}

const g = globalThis as unknown as _EventSourceGlobals;

if (typeof globalThis.Event === 'undefined') {
    g.Event = DomEvent;
}
if (typeof globalThis.EventTarget === 'undefined') {
    g.EventTarget = DomEventTarget;
}
if (typeof globalThis.MessageEvent === 'undefined') {
    g.MessageEvent = DomMessageEvent;
}
if (typeof globalThis.EventSource === 'undefined') {
    g.EventSource = EventSource;
}
