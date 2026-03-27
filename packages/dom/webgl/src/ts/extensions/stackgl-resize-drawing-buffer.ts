import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class STACKGLResizeDrawingBuffer {

  resize: (width: number, height: number) => void;

  constructor (ctx: WebGLRenderingContext) {
    this.resize = ctx.resize.bind(ctx)
  }
}

export function getSTACKGLResizeDrawingBuffer (ctx: WebGLRenderingContext) {
  return new STACKGLResizeDrawingBuffer(ctx)
}
