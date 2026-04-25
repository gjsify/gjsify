import type { WebGLContextBase } from '../webgl-context-base.js';

export class STACKGLDestroyContext {
  destroy: () => void;
  constructor (ctx: WebGLContextBase) {
    this.destroy = ctx.destroy.bind(ctx)
  }
}

export function getSTACKGLDestroyContext (ctx: WebGLContextBase) {
  return new STACKGLDestroyContext(ctx)
}
