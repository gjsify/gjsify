import { Linkable } from './linkable.js'
import { WebGLActiveInfo } from './webgl-active-info.js';

import type { WebGLRenderingContext } from './webgl-rendering-context.js';

export class WebGLProgram extends Linkable implements WebGLProgram {
    _ctx: WebGLRenderingContext;
    _linkCount = 0
    _linkStatus = false
    _linkInfoLog: string | null = 'not linked'
    _attributes: number[] = []
    _uniforms: WebGLActiveInfo[] = []
    constructor(_: number, ctx: WebGLRenderingContext) {
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
        ctx._native.deleteProgram(this._ | 0)
    }
}
