import type { WebGLProgram } from './webgl-program.js';

export class GjsifyWebGLUniformLocation implements WebGLUniformLocation {
    _: WebGLUniformLocation & number;
    _program: WebGLProgram;
    _linkCount = 0;
    _activeInfo: {size: GLsizei, type: GLenum, name: string };
    _array = null
    constructor (_: WebGLUniformLocation & number, program: WebGLProgram, info: {size: GLsizei, type: GLenum, name: string }) {
      this._ = _
      this._program = program
      this._linkCount = program._linkCount
      this._activeInfo = info
      this._array = null
    }
}

export { GjsifyWebGLUniformLocation as WebGLUniformLocation }