
import { Linkable } from './linkable.js'
import { gl } from './native-gl.js'

import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';

export class GjsifyWebGLTexture extends Linkable implements WebGLTexture {
    _ctx: GjsifyWebGLRenderingContext;
    _binding = 0
    _levelWidth = new Int32Array(32)
    _levelHeight = new Int32Array(32)
    _format = 0
    _type = 0
    _complete = true
  constructor (_: WebGLTexture, ctx: GjsifyWebGLRenderingContext) {
    super(_)
    this._ctx = ctx
  }

  _performDelete () {
    const ctx = this._ctx
    delete ctx._textures[this._ | 0]
    gl.deleteTexture.call(ctx, this._ | 0)
  }
}

export { GjsifyWebGLTexture as WebGLTexture }