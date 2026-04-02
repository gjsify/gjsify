import { Linkable } from './linkable.js'

import type { WebGLContextBase } from './webgl-context-base.js';

export class WebGLShader extends Linkable implements WebGLShader {

    _type: GLenum;
    _ctx: WebGLContextBase;
    _source = ''
    _compileStatus = false
    _compileInfo = ''

  constructor (_: number, ctx: WebGLContextBase, type: GLenum) {
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
    ctx._gl.deleteShader(this._ | 0)
  }
}
