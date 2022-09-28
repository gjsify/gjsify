import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class STACKGLDestroyContext {
  constructor (ctx: GjsifyWebGLRenderingContext) {
    this.destroy = ctx.destroy.bind(ctx)
  }
}

export function getSTACKGLDestroyContext (ctx: GjsifyWebGLRenderingContext) {
  return new STACKGLDestroyContext(ctx)
}
