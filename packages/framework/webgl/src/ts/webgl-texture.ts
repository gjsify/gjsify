
import { Linkable } from './linkable.js'
// import { gl } from './native-gl.js'

import type { WebGLContextBase } from './webgl-context-base.js';

export class WebGLTexture extends Linkable implements WebGLTexture {
    _ctx: WebGLContextBase;
    _binding = 0
    _levelWidth = new Int32Array(32)
    _levelHeight = new Int32Array(32)
    _format = 0
    _type = 0
    _complete = true
  constructor (_: number, ctx: WebGLContextBase) {
    super(_)
    this._ctx = ctx
  }

  _performDelete () {
    const ctx = this._ctx
    delete ctx._textures[this._ | 0]
    ctx._gl.deleteTexture(this._ | 0)
  }
}
