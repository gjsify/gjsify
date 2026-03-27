import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class STACKGLDestroyContext {
  destroy: () => void;
  constructor (ctx: WebGLRenderingContext) {
    this.destroy = ctx.destroy.bind(ctx)
  }
}

export function getSTACKGLDestroyContext (ctx: WebGLRenderingContext) {
  return new STACKGLDestroyContext(ctx)
}
