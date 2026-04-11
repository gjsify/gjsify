// Registers: Event, EventTarget (base layer)

import { Event, EventTarget } from '../index.js';

if (typeof (globalThis as any).Event === 'undefined') {
  Object.defineProperty(globalThis, 'Event', { value: Event, writable: true, configurable: true });
}
if (typeof (globalThis as any).EventTarget === 'undefined') {
  Object.defineProperty(globalThis, 'EventTarget', { value: EventTarget, writable: true, configurable: true });
}
