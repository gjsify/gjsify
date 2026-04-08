// Side-effect module: registers EventSource as a global on GJS. Also ensures
// Event, EventTarget and MessageEvent are available (eventsource needs them
// internally). On Node.js the alias layer routes this to @gjsify/empty.

import {
  Event as DomEvent,
  EventTarget as DomEventTarget,
  MessageEvent as DomMessageEvent,
} from '@gjsify/dom-events';
import EventSource from './index.js';

if (typeof globalThis.Event === 'undefined') {
  (globalThis as any).Event = DomEvent;
}
if (typeof globalThis.EventTarget === 'undefined') {
  (globalThis as any).EventTarget = DomEventTarget;
}
if (typeof globalThis.MessageEvent === 'undefined') {
  (globalThis as any).MessageEvent = DomMessageEvent;
}
if (typeof globalThis.EventSource === 'undefined') {
  (globalThis as any).EventSource = EventSource;
}
