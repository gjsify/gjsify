import { Linkable } from './linkable.js'
import { gl } from './native-gl.js'

import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';

export class GjsifyWebGLRenderbuffer extends Linkable implements WebGLRenderbuffer {
    _ctx: GjsifyWebGLRenderingContext;
    _binding = 0;
    _width = 0;
    _height = 0;
    _format = 0;
  constructor (_: WebGLRenderbuffer & number, ctx: GjsifyWebGLRenderingContext) {
    super(_)
    this._ctx = ctx
    this._binding = 0
    this._width = 0
    this._height = 0
    this._format = 0
  }

  _performDelete () {
    const ctx = this._ctx
    delete ctx._renderbuffers[this._ | 0]
    gl.deleteRenderbuffer.call(ctx, this._ | 0)
  }
}

export { GjsifyWebGLRenderbuffer as WebGLRenderbuffer }