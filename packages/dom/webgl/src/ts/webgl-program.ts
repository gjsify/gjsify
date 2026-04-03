import { Linkable } from './linkable.js'
import { WebGLActiveInfo } from './webgl-active-info.js';

import type { WebGLContextBase } from './webgl-context-base.js';

export class WebGLProgram extends Linkable implements WebGLProgram {
    _ctx: WebGLContextBase;
    _linkCount = 0
    _linkStatus = false
    _linkInfoLog: string | null = 'not linked'
    _attributes: number[] = []
    _uniforms: WebGLActiveInfo[] = []
    constructor(_: number, ctx: WebGLContextBase) {
        super(_)
        this._ctx = ctx
        this._linkCount = 0
        this._linkStatus = false
        this._linkInfoLog = 'not linked'
        this._attributes = []
        this._uniforms = []
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._programs[this._ | 0]
        ctx._gl.deleteProgram(this._ | 0)
    }
}
