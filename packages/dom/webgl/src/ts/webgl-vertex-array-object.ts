import { Linkable } from './linkable.js'
import { WebGLVertexArrayObjectState } from './webgl-vertex-attribute.js'

import type { WebGL2RenderingContext } from './webgl2-rendering-context.js';

export class WebGLVertexArrayObject extends Linkable implements WebGLVertexArrayObject {
    _ctx: WebGL2RenderingContext;
    _objectState: WebGLVertexArrayObjectState;

    constructor(_: number, ctx: WebGL2RenderingContext) {
        super(_)
        this._ctx = ctx
        this._objectState = new WebGLVertexArrayObjectState(ctx)
    }

    _performDelete() {
        const ctx = this._ctx
        // If this VAO is currently active, restore default state
        if (ctx._vertexObjectState === this._objectState) {
            ctx._vertexObjectState = ctx._defaultVertexObjectState;
        }
        this._objectState.cleanUp();
        delete ctx._vertexArrayObjects[this._ | 0]
        ctx._native2.deleteVertexArray(this._ | 0)
    }
}
