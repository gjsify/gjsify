import type { WebGLRenderingContext } from './webgl-rendering-context.js';
import type { WebGLTexture } from './webgl-texture.js';

export class WebGLTextureUnit {
    _ctx: WebGLRenderingContext;
    _idx: number;
    _mode = 0
    _bind2D: WebGLTexture | null = null
    _bindCube: WebGLTexture | null = null

    constructor(ctx: WebGLRenderingContext, idx: number) {
        this._ctx = ctx
        this._idx = idx
    }
}

