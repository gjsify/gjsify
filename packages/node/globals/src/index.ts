import "./errors.js";
import "@gjsify/require";

// Native replacements for @gjsify/deno_std/node/global
import process from '@gjsify/process';
import { Buffer } from '@gjsify/buffer';

Object.defineProperty(globalThis, "global", {
  value: globalThis,
  writable: false,
  enumerable: false,
  configurable: true,
});

Object.defineProperty(globalThis, "process", {
  value: process,
  enumerable: false,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "Buffer", {
  value: Buffer,
  enumerable: false,
  writable: true,
  configurable: true,
});

// setImmediate/clearImmediate polyfill via setTimeout
function setImmediate<T extends any[]>(callback: (...args: T) => void, ...args: T): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0, ...args);
}

function clearImmediate(id: ReturnType<typeof setTimeout>): void {
  clearTimeout(id);
}

Object.defineProperty(globalThis, "setImmediate", {
  value: setImmediate,
  enumerable: true,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "clearImmediate", {
  value: clearImmediate,
  enumerable: true,
  writable: true,
  configurable: true,
});

export {};
