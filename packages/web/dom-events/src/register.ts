// Side-effect module: registers DOM Event classes as globals on GJS.
// Event, EventTarget, CustomEvent, MessageEvent, ErrorEvent, CloseEvent,
// ProgressEvent, UIEvent, MouseEvent, PointerEvent, KeyboardEvent,
// WheelEvent, FocusEvent. On Node.js the alias layer maps this subpath
// to @gjsify/empty — these are all native in modern Node.

import {
  Event,
  EventTarget,
  CustomEvent,
  MessageEvent,
  ErrorEvent,
  CloseEvent,
  ProgressEvent,
  UIEvent,
  MouseEvent,
  PointerEvent,
  KeyboardEvent,
  WheelEvent,
  FocusEvent,
} from './index.js';

const toRegister: Record<string, unknown> = {
  Event,
  EventTarget,
  CustomEvent,
  MessageEvent,
  ErrorEvent,
  CloseEvent,
  ProgressEvent,
  UIEvent,
  MouseEvent,
  PointerEvent,
  KeyboardEvent,
  WheelEvent,
  FocusEvent,
};

for (const [name, value] of Object.entries(toRegister)) {
  if (typeof (globalThis as any)[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }
}
