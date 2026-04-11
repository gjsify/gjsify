// Registers: CustomEvent, MessageEvent, ErrorEvent, CloseEvent, ProgressEvent

import {
  CustomEvent,
  MessageEvent,
  ErrorEvent,
  CloseEvent,
  ProgressEvent,
} from '../index.js';

const toRegister: Record<string, unknown> = {
  CustomEvent,
  MessageEvent,
  ErrorEvent,
  CloseEvent,
  ProgressEvent,
};

for (const [name, value] of Object.entries(toRegister)) {
  if (typeof (globalThis as any)[name] === 'undefined') {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
}
