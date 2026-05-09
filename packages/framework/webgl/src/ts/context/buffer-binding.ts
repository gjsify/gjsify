// Buffer-binding methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import type { WebGLContextBase } from '../webgl-context-base.js';
import { WebGLBuffer } from '../webgl-buffer.js';
import { Uint8ArrayToVariant, arrayToUint8Array, checkObject, isTypedArray } from '../utils.js';
import type { TypedArray } from '../types/index.js';

export interface BufferBindingMethods {
    bindBuffer(target: GLenum | undefined, buffer: WebGLBuffer | null): void;
    bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void;
    bufferData(target: GLenum, data: BufferSource | null, usage: GLenum): void;
    bufferSubData(target?: GLenum, offset?: GLintptr, data?: BufferSource): void;
    createBuffer(): WebGLBuffer | null;
    deleteBuffer(buffer: WebGLBuffer | null): void;
    getBufferParameter(target?: GLenum, pname?: GLenum): unknown;
    _getActiveBuffer(target: GLenum): WebGLBuffer | null;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends BufferBindingMethods { }
}

const bufferBindingMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    bindBuffer(this: WebGLContextBase, target: GLenum = 0, buffer: WebGLBuffer | null): void {
        if (!checkObject(buffer)) {
            throw new TypeError('bindBuffer(GLenum, WebGLBuffer)');
        }
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (!buffer) {
            buffer = null;
            this._gl.bindBuffer(target, 0);
        } else if (buffer._pendingDelete) {
            return;
        } else if (this._checkWrapper(buffer, WebGLBuffer)) {
            if (buffer._binding && buffer._binding !== target) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
            buffer._binding = target | 0;

            this._gl.bindBuffer(target, buffer._ | 0);
        } else {
            return;
        }

        if (target === this.ARRAY_BUFFER) {
            // Buffers of type ARRAY_BUFFER are bound to the global vertex state.
            this._vertexGlobalState.setArrayBuffer(buffer);
        } else {
            // Buffers of type ELEMENT_ARRAY_BUFFER are bound to vertex array object state.
            this._vertexObjectState.setElementArrayBuffer(buffer);
        }
    },

    bufferData(this: WebGLContextBase, target: GLenum = 0, dataOrSize: GLsizeiptr | BufferSource | null, usage: GLenum = 0): void {
        let size = 0;
        let data: BufferSource | null = null;

        if (typeof dataOrSize === 'number') {
            size = dataOrSize;
        } else if (typeof dataOrSize === 'object') {
            data = dataOrSize;
        }

        if (usage !== this.STREAM_DRAW &&
            usage !== this.STATIC_DRAW &&
            usage !== this.DYNAMIC_DRAW) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        const active = this._getActiveBuffer(target);
        if (!active) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (data) {
            let u8Data: Uint8Array | null = null;
            if (isTypedArray(data as TypedArray) || data instanceof DataView || data instanceof ArrayBuffer) {
                u8Data = arrayToUint8Array(data as TypedArray | DataView | ArrayBuffer);
            } else {
                this.setError(this.INVALID_VALUE);
                return;
            }

            this._saveError();

            this._gl.bufferData(
                target,
                Uint8ArrayToVariant(u8Data),
                usage);
            const error = this.getError();
            this._restoreError(error);
            if (error !== this.NO_ERROR) {
                return;
            }

            active._size = u8Data.length;
            if (target === this.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(u8Data);
            }
        } else if (typeof dataOrSize === 'number') {
            if (size < 0) {
                this.setError(this.INVALID_VALUE);
                return;
            }

            this._saveError();
            this._gl.bufferDataSizeOnly(
                target,
                size,
                usage);
            const error = this.getError();
            this._restoreError(error);
            if (error !== this.NO_ERROR) {
                return;
            }

            active._size = size;
            if (target === this.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(size);
            }
        } else {
            this.setError(this.INVALID_VALUE);
        }
    },

    bufferSubData(this: WebGLContextBase, target: GLenum = 0, offset: GLintptr = 0, data: BufferSource): void {
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (data === null || typeof data !== 'object') {
            throw new TypeError('bufferSubData: data must be a BufferSource');
        }

        const active = this._getActiveBuffer(target);
        if (!active) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (offset < 0 || offset >= active._size) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        let u8Data: Uint8Array | null = null;
        if (isTypedArray(data as TypedArray) || data instanceof DataView || data instanceof ArrayBuffer) {
            u8Data = arrayToUint8Array(data as TypedArray | DataView | ArrayBuffer);
        } else {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (offset + u8Data.length > active._size) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (target === this.ELEMENT_ARRAY_BUFFER) {
            active._elements.set(u8Data, offset);
        }

        this._gl.bufferSubData(target, offset, Uint8ArrayToVariant(u8Data));
    },

    createBuffer(this: WebGLContextBase): WebGLBuffer | null {
        const id = this._gl.createBuffer();
        if (!id || id <= 0) return null;
        const webGLBuffer = new WebGLBuffer(id, this);
        this._buffers[id] = webGLBuffer;
        return webGLBuffer;
    },

    deleteBuffer(this: WebGLContextBase, buffer: WebGLBuffer | null): void {
        if (!checkObject(buffer) ||
            (buffer !== null && !(buffer instanceof WebGLBuffer))) {
            throw new TypeError('deleteBuffer(WebGLBuffer)');
        }

        if (!(buffer instanceof WebGLBuffer &&
            this._checkOwns(buffer))) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (this._vertexGlobalState._arrayBufferBinding === buffer) {
            this.bindBuffer(this.ARRAY_BUFFER, null);
        }
        if (this._vertexObjectState._elementArrayBufferBinding === buffer) {
            this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null);
        }

        if (this._vertexObjectState === this._defaultVertexObjectState) {
            // If no vertex array object is bound, release attrib bindings for the
            // array buffer.
            this._vertexObjectState.releaseArrayBuffer(buffer);
        }

        buffer._pendingDelete = true;
        buffer._checkDelete();
    },

    getBufferParameter(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0): unknown {
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM);
            return null;
        }

        switch (pname) {
            case this.BUFFER_SIZE:
            case this.BUFFER_USAGE:
                return this._gl.getBufferParameteriv(target | 0, pname | 0)[0];
            default:
                this.setError(this.INVALID_ENUM);
                return null;
        }
    },

    _getActiveBuffer(this: WebGLContextBase, target: GLenum): WebGLBuffer | null {
        if (target === this.ARRAY_BUFFER) {
            return this._vertexGlobalState._arrayBufferBinding;
        } else if (target === this.ELEMENT_ARRAY_BUFFER) {
            return this._vertexObjectState._elementArrayBufferBinding;
        }
        return null;
    },
};

/** Install buffer-binding methods on the given prototype. Called from webgl-context-base.ts. */
export function installBufferBindingMethods(proto: object): void {
    Object.assign(proto, bufferBindingMethods);
}
