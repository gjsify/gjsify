import { Linkable } from './linkable.js'

import type { WebGLContextBase } from './webgl-context-base.js';

export class WebGLBuffer extends Linkable implements WebGLBuffer {
    _ctx: WebGLContextBase;
    _size = 0
    _elements = new Uint8Array(0)
    constructor(_: number, ctx: WebGLContextBase) {
        super(_)
        this._ctx = ctx
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._buffers[this._ | 0]
        ctx._gl.deleteBuffer(this._)
    }
}
