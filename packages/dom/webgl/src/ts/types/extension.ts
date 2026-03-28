import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export type ExtensionFactory = (context: WebGLRenderingContext) => any | null // TODO