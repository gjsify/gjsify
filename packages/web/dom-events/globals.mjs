/**
 * Re-exports native DOM Events globals for use in Node.js builds.
 * On Node.js, Event/EventTarget/CustomEvent are native globals.
 */
export const Event = globalThis.Event;
export const EventTarget = globalThis.EventTarget;
export const CustomEvent = globalThis.CustomEvent;
