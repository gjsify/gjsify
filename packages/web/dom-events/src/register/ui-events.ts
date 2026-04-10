// Registers: UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent

import {
  UIEvent,
  MouseEvent,
  PointerEvent,
  KeyboardEvent,
  WheelEvent,
  FocusEvent,
} from '../index.js';

const toRegister: Record<string, unknown> = {
  UIEvent,
  MouseEvent,
  PointerEvent,
  KeyboardEvent,
  WheelEvent,
  FocusEvent,
};

for (const [name, value] of Object.entries(toRegister)) {
  if (typeof (globalThis as any)[name] === 'undefined') {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
}
