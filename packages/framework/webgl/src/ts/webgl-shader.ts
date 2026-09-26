import { Linkable } from './linkable.js';

import type { WebGLContextBase } from './webgl-context-base.js';

export class WebGLShader extends Linkable implements WebGLShader {
    _type: GLenum;
    _ctx: WebGLContextBase;
    _source = '';
    /** The source exactly as the consumer passed it, before `_wrapShader`. */
    _userSource = '';
    /** Does this source itself need desktop GLSL (see `_needsDesktopSpelling`)? */
    _needsDesktop = false;
    /** Is it CURRENTLY spelled in desktop GLSL — itself, or to match a program partner? */
    _desktopSpelled = false;
    _compileStatus = false;
    _compileInfo = '';
    _needsRecompile = false;

    constructor(_: number, ctx: WebGLContextBase, type: GLenum) {
        super(_);
        this._type = type;
        this._ctx = ctx;
        this._source = '';
        this._compileStatus = false;
        this._compileInfo = '';
    }

    _performDelete() {
        const ctx = this._ctx;
        delete ctx._shaders[this._ | 0];
        ctx._gl.deleteShader(this._ | 0);
    }
}
