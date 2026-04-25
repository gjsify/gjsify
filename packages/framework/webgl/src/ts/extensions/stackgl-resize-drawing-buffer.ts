import type { WebGLContextBase } from '../webgl-context-base.js';

export class STACKGLResizeDrawingBuffer {

  resize: (width: number, height: number) => void;

  constructor (ctx: WebGLContextBase) {
    this.resize = ctx.resize.bind(ctx)
  }
}

export function getSTACKGLResizeDrawingBuffer (ctx: WebGLContextBase) {
  return new STACKGLResizeDrawingBuffer(ctx)
}
