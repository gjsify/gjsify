import type { WebGLContextBase } from '../webgl-context-base.js';

export type ExtensionFactory = (context: WebGLContextBase) => any | null // TODO