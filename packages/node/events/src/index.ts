// Reference: Node.js lib/events.js
// Reimplemented for GJS

import { EventEmitter } from './event-emitter.js';

export { EventEmitter };

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
