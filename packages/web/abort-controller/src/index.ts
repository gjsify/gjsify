import { AbortController, AbortSignal } from 'abort-controller/dist/abort-controller.js';

if (!globalThis.AbortController) Object.defineProperty(globalThis, 'AbortController', { value: AbortController });
if (!globalThis.AbortSignal) Object.defineProperty(globalThis, 'AbortSignal', { value: AbortSignal });