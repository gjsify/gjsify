import { Linkable } from './linkable.js'
// import { gl } from './native-gl.js'

import type { WebGLRenderingContext } from './webgl-rendering-context.js';

export class WebGLRenderbuffer extends Linkable implements WebGLRenderbuffer {
    _ctx: WebGLRenderingContext;
    _binding = 0;
    _width = 0;
    _height = 0;
    _format = 0;
  constructor (_: number, ctx: WebGLRenderingContext) {
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
    ctx._native.deleteRenderbuffer(this._)
  }
}
