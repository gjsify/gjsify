import { performance } from './performance.js';
import timers from './timers.js';
import process from 'process';
import { Buffer } from 'buffer';


// if (!globalThis.global) Object.defineProperty(global, { value: globalThis });
// if (!globalThis.window) Object.defineProperty(window, { value: globalThis });

if (!globalThis.clearImmediate) Object.defineProperty(globalThis, 'clearImmediate', { value: timers.clearImmediate });
if (!globalThis.clearInterval) Object.defineProperty(globalThis, 'clearInterval', { value: timers.clearInterval });
if (!globalThis.clearTimeout) Object.defineProperty(globalThis, 'clearTimeout', { value: timers.clearTimeout });
if (!globalThis.setImmediate) Object.defineProperty(globalThis, 'setImmediate', { value: timers.setImmediate });
if (!globalThis.setInterval) Object.defineProperty(globalThis, 'setInterval', { value: timers.setInterval });
if (!globalThis.setTimeout) Object.defineProperty(globalThis, 'setTimeout', { value: timers.setTimeout });

if (!globalThis.process) Object.defineProperty(globalThis, 'process', { value: process });

if (!globalThis.Buffer) Object.defineProperty(globalThis, 'Buffer', { value: Buffer });

if (!globalThis.performance) Object.defineProperty(globalThis, 'performance', { value: performance() });