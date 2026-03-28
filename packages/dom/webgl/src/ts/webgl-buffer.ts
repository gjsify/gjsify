import { Linkable } from './linkable.js'

import type { WebGLRenderingContext } from './webgl-rendering-context.js';

export class WebGLBuffer extends Linkable implements WebGLBuffer {
    _ctx: WebGLRenderingContext;
    _size = 0
    _elements = new Uint8Array(0)
    constructor(_: number, ctx: WebGLRenderingContext) {
        super(_)
        this._ctx = ctx
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._buffers[this._ | 0]
        ctx._native.deleteBuffer(this._)
    }
}
