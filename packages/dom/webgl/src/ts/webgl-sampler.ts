import { Linkable } from './linkable.js'

import type { WebGL2RenderingContext } from './webgl2-rendering-context.js';

export class WebGLSampler extends Linkable implements WebGLSampler {
    _ctx: WebGL2RenderingContext;
    constructor(_: number, ctx: WebGL2RenderingContext) {
        super(_)
        this._ctx = ctx
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._samplers[this._ | 0]
        ctx._native2.deleteSampler(this._ | 0)
    }
}
