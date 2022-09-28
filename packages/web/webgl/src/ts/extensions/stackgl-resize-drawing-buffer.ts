import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class STACKGLResizeDrawingBuffer {
  constructor (ctx: GjsifyWebGLRenderingContext) {
    this.resize = ctx.resize.bind(ctx)
  }
}

export function getSTACKGLResizeDrawingBuffer (ctx: GjsifyWebGLRenderingContext) {
  return new STACKGLResizeDrawingBuffer(ctx)
}
