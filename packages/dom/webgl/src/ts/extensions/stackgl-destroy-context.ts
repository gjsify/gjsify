import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class STACKGLDestroyContext {
  destroy: () => void;
  constructor (ctx: GjsifyWebGLRenderingContext) {
    this.destroy = ctx.destroy.bind(ctx)
  }
}

export function getSTACKGLDestroyContext (ctx: GjsifyWebGLRenderingContext) {
  return new STACKGLDestroyContext(ctx)
}
