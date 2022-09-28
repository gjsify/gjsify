import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export type ExtensionFactory = (context: GjsifyWebGLRenderingContext) => any | null // TODO