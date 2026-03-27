import { Linkable } from './linkable.js'

import type { WebGL2RenderingContext } from './webgl2-rendering-context.js';

export class WebGLTransformFeedback extends Linkable implements WebGLTransformFeedback {
    _ctx: WebGL2RenderingContext;
    constructor(_: number, ctx: WebGL2RenderingContext) {
        super(_)
        this._ctx = ctx
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._transformFeedbacks[this._ | 0]
        ctx._native2.deleteTransformFeedback(this._ | 0)
    }
}
