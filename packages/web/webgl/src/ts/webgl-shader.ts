import { gl } from './native-gl.js'
import { Linkable } from './linkable.js'

import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';

export class GjsifyWebGLShader extends Linkable implements WebGLShader {

    _type: GLenum;
    _ctx: GjsifyWebGLRenderingContext;
    _source = ''
    _compileStatus = false
    _compileInfo = ''

  constructor (_: WebGLShader, ctx: GjsifyWebGLRenderingContext, type: GLenum) {
    super(_)
    this._type = type
    this._ctx = ctx
    this._source = ''
    this._compileStatus = false
    this._compileInfo = ''
  }

  _performDelete () {
    const ctx = this._ctx
    delete ctx._shaders[this._ | 0]
    gl.deleteShader.call(ctx, this._ | 0)
  }
}

export { GjsifyWebGLShader as WebGLShader }