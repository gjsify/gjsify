import type { WebGLContextBase } from './webgl-context-base.js';
import type { WebGLTexture } from './webgl-texture.js';

export class WebGLTextureUnit {
    _ctx: WebGLContextBase;
    _idx: number;
    _mode = 0
    _bind2D: WebGLTexture | null = null
    _bindCube: WebGLTexture | null = null

    constructor(ctx: WebGLContextBase, idx: number) {
        this._ctx = ctx
        this._idx = idx
    }
}

