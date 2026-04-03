// WebGLRenderingContext — thin WebGL1 subclass of WebGLContextBase
// The attrib0 hack is WebGL1-specific (GLES2 requires attribute 0 to be an array).

import Gwebgl from '@girs/gwebgl-0.1';
import { WebGLContextBase } from './webgl-context-base.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { WebGLBuffer } from './webgl-buffer.js';
import { Uint8ArrayToVariant, vertexCount } from './utils.js';

import type { WebGLConstants } from './types/index.js';

// Re-export everything from the base so existing imports from this module still work
export { WebGLContextBase } from './webgl-context-base.js';

export interface WebGLRenderingContext extends WebGLConstants { }

export class WebGLRenderingContext extends WebGLContextBase implements WebGLRenderingContext {
    _native: Gwebgl.WebGLRenderingContext;

    _attrib0Buffer: WebGLBuffer | null = null;

    get _gl(): Gwebgl.WebGLRenderingContextBase {
        return this._native;
    }

    constructor(canvas: HTMLCanvasElement | null, options: Partial<Gwebgl.WebGLRenderingContext.ConstructorProps> = {}) {
        super(canvas, options);
        this._native = new Gwebgl.WebGLRenderingContext({});
        this._init();

        // Create the attrib0 buffer used by the WebGL1 attrib0 hack
        const attrib0Buffer = this.createBuffer();
        this._attrib0Buffer = attrib0Buffer;
    }

    // ─── Attrib0 Hack (WebGL1 / GLES2 only) ─────────────────────────────

    _beginAttrib0Hack() {
        this._native.bindBuffer(this.ARRAY_BUFFER, this._attrib0Buffer?._ || 0)
        const uInt8Data = new Uint8Array(this._vertexGlobalState._attribs[0]._data.buffer);
        this._native.bufferData(
            this.ARRAY_BUFFER,
            Uint8ArrayToVariant(uInt8Data),
            this.STREAM_DRAW)
        this._native.enableVertexAttribArray(0)
        this._native.vertexAttribPointer(0, 4, this.FLOAT, false, 0, 0)
        this._native._vertexAttribDivisor(0, 1)
    }

    _endAttrib0Hack() {
        const attrib = this._vertexObjectState._attribs[0]
        if (attrib._pointerBuffer) {
            this._native.bindBuffer(this.ARRAY_BUFFER, attrib._pointerBuffer._)
        } else {
            this._native.bindBuffer(this.ARRAY_BUFFER, 0)
        }
        this._native.vertexAttribPointer(
            0,
            attrib._inputSize,
            attrib._pointerType,
            attrib._pointerNormal,
            attrib._inputStride,
            attrib._pointerOffset)
        this._native._vertexAttribDivisor(0, attrib._divisor)
        this._native.disableVertexAttribArray(0)
        if (this._vertexGlobalState._arrayBufferBinding) {
            this._native.bindBuffer(this.ARRAY_BUFFER, this._vertexGlobalState._arrayBufferBinding._)
        } else {
            this._native.bindBuffer(this.ARRAY_BUFFER, 0)
        }
    }

    // ─── drawArrays / drawElements with attrib0 hack ─────────────────────

    override drawArrays(mode: GLenum = 0, first: GLint = 0, count: GLsizei = 0): void {
        if (first < 0 || count < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const reducedCount = vertexCount(this, mode, count)
        if (reducedCount < 0) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (!this._framebufferOk()) {
            return
        }

        if (count === 0) {
            return
        }

        let maxIndex = first
        if (count > 0) {
            maxIndex = (count + first - 1) >>> 0
        }
        if (this._checkVertexAttribState(maxIndex)) {
            if (
                this._vertexObjectState._attribs[0]._isPointer || (
                    this._extensions.webgl_draw_buffers &&
                    this._extensions.webgl_draw_buffers._buffersState &&
                    this._extensions.webgl_draw_buffers._buffersState.length > 0
                )
            ) {
                return this._native.drawArrays(mode, first, reducedCount)
            } else {
                this._beginAttrib0Hack()
                this._native._drawArraysInstanced(mode, first, reducedCount, 1)
                this._endAttrib0Hack()
            }
        }
    }

    override drawElements(mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, ioffset: GLintptr = 0): void {
        if (count < 0 || ioffset < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding
        if (!elementBuffer) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        // Unpack element data
        let elementData = null
        let offset = ioffset
        if (type === this.UNSIGNED_SHORT) {
            if (offset % 2) {
                this.setError(this.INVALID_OPERATION)
                return
            }
            offset >>= 1
            elementData = new Uint16Array(elementBuffer._elements.buffer)
        } else if (this._extensions.oes_element_index_uint && type === this.UNSIGNED_INT) {
            if (offset % 4) {
                this.setError(this.INVALID_OPERATION)
                return
            }
            offset >>= 2
            elementData = new Uint32Array(elementBuffer._elements.buffer)
        } else if (type === this.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements
        } else {
            this.setError(this.INVALID_ENUM)
            return
        }

        let reducedCount = count
        switch (mode) {
            case this.TRIANGLES:
                if (count % 3) {
                    reducedCount -= (count % 3)
                }
                break
            case this.LINES:
                if (count % 2) {
                    reducedCount -= (count % 2)
                }
                break
            case this.POINTS:
                break
            case this.LINE_LOOP:
            case this.LINE_STRIP:
                if (count < 2) {
                    this.setError(this.INVALID_OPERATION)
                    return
                }
                break
            case this.TRIANGLE_FAN:
            case this.TRIANGLE_STRIP:
                if (count < 3) {
                    this.setError(this.INVALID_OPERATION)
                    return
                }
                break
            default:
                this.setError(this.INVALID_ENUM)
                return
        }

        if (!this._framebufferOk()) {
            return
        }

        if (count === 0) {
            this._checkVertexAttribState(0)
            return
        }

        if ((count + offset) >>> 0 > elementData.length) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        // Compute max index
        let maxIndex = -1
        for (let i = offset; i < offset + count; ++i) {
            maxIndex = Math.max(maxIndex, elementData[i])
        }

        if (maxIndex < 0) {
            this._checkVertexAttribState(0)
            return
        }

        if (this._checkVertexAttribState(maxIndex)) {
            if (reducedCount > 0) {
                if (this._vertexObjectState._attribs[0]._isPointer) {
                    return this._native.drawElements(mode, reducedCount, type, ioffset)
                } else {
                    this._beginAttrib0Hack()
                    this._native._drawElementsInstanced(mode, reducedCount, type, ioffset, 1)
                    this._endAttrib0Hack()
                }
            }
        }
    }
}
