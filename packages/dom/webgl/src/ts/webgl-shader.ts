import { Linkable } from './linkable.js'

import type { WebGLRenderingContext } from './webgl-rendering-context.js';

export class WebGLShader extends Linkable implements WebGLShader {

    _type: GLenum;
    _ctx: WebGLRenderingContext;
    _source = ''
    _compileStatus = false
    _compileInfo = ''

  constructor (_: number, ctx: WebGLRenderingContext, type: GLenum) {
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
    ctx._native.deleteShader(this._ | 0)
  }
}
