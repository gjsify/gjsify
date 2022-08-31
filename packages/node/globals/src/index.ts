
// TODO move to web globals
import timers from './timers.js';
if (!globalThis.clearImmediate) Object.defineProperty(globalThis, 'clearImmediate', { value: timers.clearImmediate });
if (!globalThis.clearInterval) Object.defineProperty(globalThis, 'clearInterval', { value: timers.clearInterval });
if (!globalThis.clearTimeout) Object.defineProperty(globalThis, 'clearTimeout', { value: timers.clearTimeout });
if (!globalThis.setImmediate) Object.defineProperty(globalThis, 'setImmediate', { value: timers.setImmediate });
if (!globalThis.setInterval) Object.defineProperty(globalThis, 'setInterval', { value: timers.setInterval });
if (!globalThis.setTimeout) Object.defineProperty(globalThis, 'setTimeout', { value: timers.setTimeout });

// TODO move to web globals
import { performance } from './performance.js';
if (!globalThis.performance) Object.defineProperty(globalThis, 'performance', { value: performance() });

import process from 'process';
if (!globalThis.process) Object.defineProperty(globalThis, 'process', { value: process });

import { Buffer } from 'buffer';
if (!globalThis.Buffer) Object.defineProperty(globalThis, 'Buffer', { value: Buffer });

// if (!globalThis.global) Object.defineProperty(globalThis, { value: globalThis });
// if (!globalThis.window) Object.defineProperty(globalThis, { value: globalThis });

