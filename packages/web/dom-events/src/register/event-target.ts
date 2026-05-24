// Registers: Event, EventTarget (base layer)

import { Event, EventTarget } from '../index.js';

/**
 * Typed view of the GJS global slots this register module probes
 * (for the existence guard) and installs. Keeps both branches free of
 * `as any` while still tolerating their absence in the stock GJS
 * bootstrap state.
 */
interface _EventTargetGlobals {
  Event?: typeof Event;
  EventTarget?: typeof EventTarget;
}

const g = globalThis as unknown as _EventTargetGlobals;

if (typeof g.Event === 'undefined') {
  Object.defineProperty(globalThis, 'Event', { value: Event, writable: true, configurable: true });
}
if (typeof g.EventTarget === 'undefined') {
  Object.defineProperty(globalThis, 'EventTarget', { value: EventTarget, writable: true, configurable: true });
}
