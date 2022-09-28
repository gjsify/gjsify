import { Linkable } from './linkable.js'
import { gl } from './native-gl.js'

import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';

export class GjsifyWebGLBuffer extends Linkable implements WebGLBuffer {
    _ctx: GjsifyWebGLRenderingContext;
    _size = 0
    _elements = new Uint8Array(0)
    constructor(_: WebGLBuffer & number, ctx: GjsifyWebGLRenderingContext) {
        super(_)
        this._ctx = ctx
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._buffers[this._ | 0]
        ctx.deleteBuffer.call(ctx, this)
    }
}

export { GjsifyWebGLBuffer as WebGLBuffer }