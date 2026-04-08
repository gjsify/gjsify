// Reference: Node.js lib/events.js
// Reimplemented for GJS

import { makeCallable } from '@gjsify/utils';
import { EventEmitter as EventEmitter_ } from './event-emitter.js';

export const EventEmitter = makeCallable(EventEmitter_) as typeof EventEmitter_;
// Expose instance type alias so consumers can use `EventEmitter` as a type
// (mirrors Node.js's `typeof EventEmitter` pattern).
export type EventEmitter = EventEmitter_;
// Overwrite the backward-compat self-reference so CJS consumers that access
// EventEmitter.EventEmitter (via __toESM namespace spread) also get the
// makeCallable-wrapped version, not the raw inner class.
(EventEmitter as any).EventEmitter = EventEmitter;

// Named static exports matching Node.js events module API
export const captureRejectionSymbol = EventEmitter.captureRejectionSymbol;
export const errorMonitor = EventEmitter.errorMonitor;
export const defaultMaxListeners = EventEmitter.defaultMaxListeners;
export const setMaxListeners = EventEmitter.setMaxListeners;
export const getMaxListeners = EventEmitter.getMaxListeners;
export const once = EventEmitter.once;
export const on = EventEmitter.on;
export const getEventListeners = EventEmitter.getEventListeners;
export const listenerCount = EventEmitter.listenerCount;
export const addAbortListener = EventEmitter.addAbortListener;

export default EventEmitter;
