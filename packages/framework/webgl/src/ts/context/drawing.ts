// Drawing, viewport/scissor, and vertex-attribute methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import type { WebGLContextBase } from '../webgl-context-base.js';
import { Uint8ArrayToVariant, arrayToUint8Array, typeSize, vertexCount } from '../utils.js';
import type { TypedArray } from '../types/index.js';

export interface DrawingMethods {
    drawArrays(mode?: GLenum, first?: GLint, count?: GLsizei): void;
    drawElements(mode?: GLenum, count?: GLsizei, type?: GLenum, ioffset?: GLintptr): void;
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void;
    readPixels(x: GLint | undefined, y: GLint | undefined, width: GLsizei | undefined, height: GLsizei | undefined, format: GLenum | undefined, type: GLenum | undefined, pixels: TypedArray | null): void;
    enableVertexAttribArray(index: GLuint): void;
    disableVertexAttribArray(index?: GLuint): void;
    vertexAttrib1f(index: GLuint, x: GLfloat): void;
    vertexAttrib1fv(index: GLuint, values: Float32List): void;
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void;
    vertexAttrib2fv(index: GLuint, values: Float32List): void;
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void;
    vertexAttrib3fv(index: GLuint, values: Float32List): void;
    vertexAttrib4f(index: GLuint | undefined, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void;
    vertexAttrib4fv(index: GLuint, values: Float32List): void;
    vertexAttribPointer(index?: GLuint, size?: GLint, type?: GLenum, normalized?: GLboolean, stride?: GLsizei, offset?: GLintptr): void;
    getVertexAttrib(index?: GLuint, pname?: GLenum): unknown;
    getVertexAttribOffset(index?: GLuint, pname?: GLenum): GLintptr;
    _checkVertexAttribState(maxIndex: number): boolean;
    _checkVertexIndex(index: number): boolean;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends DrawingMethods { }
}

const drawingMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    drawArrays(this: WebGLContextBase, mode: GLenum = 0, first: GLint = 0, count: GLsizei = 0): void {
        if (first < 0 || count < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (!this._checkStencilState()) {
            return;
        }

        const reducedCount = vertexCount(this, mode, count);
        if (reducedCount < 0) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (!this._framebufferOk()) {
            return;
        }

        if (count === 0) {
            return;
        }

        let maxIndex = first;
        if (count > 0) {
            maxIndex = (count + first - 1) >>> 0;
        }
        if (this._checkVertexAttribState(maxIndex)) {
            this._gl.drawArrays(mode, first, reducedCount);
        }
    },

    drawElements(this: WebGLContextBase, mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, ioffset: GLintptr = 0): void {
        if (count < 0 || ioffset < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (!this._checkStencilState()) {
            return;
        }

        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
        if (!elementBuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // Unpack element data
        let elementData: Uint8Array | Uint16Array | Uint32Array | null = null;
        let offset = ioffset;
        if (type === this.UNSIGNED_SHORT) {
            if (offset % 2) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
            offset >>= 1;
            elementData = new Uint16Array(elementBuffer._elements.buffer);
        } else if (this._extensions.oes_element_index_uint && type === this.UNSIGNED_INT) {
            if (offset % 4) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
            offset >>= 2;
            elementData = new Uint32Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements;
        } else {
            this.setError(this.INVALID_ENUM);
            return;
        }

        let reducedCount = count;
        switch (mode) {
            case this.TRIANGLES:
                if (count % 3) {
                    reducedCount -= (count % 3);
                }
                break;
            case this.LINES:
                if (count % 2) {
                    reducedCount -= (count % 2);
                }
                break;
            case this.POINTS:
                break;
            case this.LINE_LOOP:
            case this.LINE_STRIP:
                if (count < 2) {
                    this.setError(this.INVALID_OPERATION);
                    return;
                }
                break;
            case this.TRIANGLE_FAN:
            case this.TRIANGLE_STRIP:
                if (count < 3) {
                    this.setError(this.INVALID_OPERATION);
                    return;
                }
                break;
            default:
                this.setError(this.INVALID_ENUM);
                return;
        }

        if (!this._framebufferOk()) {
            return;
        }

        if (count === 0) {
            this._checkVertexAttribState(0);
            return;
        }

        if ((count + offset) >>> 0 > elementData.length) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // Compute max index
        let maxIndex = -1;
        for (let i = offset; i < offset + count; ++i) {
            maxIndex = Math.max(maxIndex, elementData[i]);
        }

        if (maxIndex < 0) {
            this._checkVertexAttribState(0);
            return;
        }

        if (this._checkVertexAttribState(maxIndex)) {
            if (reducedCount > 0) {
                this._gl.drawElements(mode, reducedCount, type, ioffset);
            }
        }
    },

    viewport(this: WebGLContextBase, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        this._viewport[0] = x | 0;
        this._viewport[1] = y | 0;
        this._viewport[2] = width | 0;
        this._viewport[3] = height | 0;
        this._gl.viewport(x, y, width, height);
    },

    scissor(this: WebGLContextBase, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        this._scissorBox[0] = x | 0;
        this._scissorBox[1] = y | 0;
        this._scissorBox[2] = width | 0;
        this._scissorBox[3] = height | 0;
        this._gl.scissor(x | 0, y | 0, width | 0, height | 0);
    },

    readPixels(this: WebGLContextBase, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, format: GLenum = 0, type: GLenum = 0, pixels: TypedArray | null): void {
        if (!pixels) return;

        if (!(this._extensions.oes_texture_float && type === this.FLOAT && format === this.RGBA)) {
            if (format === this.RGB ||
                format === this.ALPHA ||
                type !== this.UNSIGNED_BYTE) {
                this.setError(this.INVALID_OPERATION);
                return;
            } else if (format !== this.RGBA) {
                this.setError(this.INVALID_ENUM);
                return;
            } else if (width < 0 || height < 0 || !(pixels instanceof Uint8Array)) {
                this.setError(this.INVALID_VALUE);
                return;
            }
        }

        if (!this._framebufferOk()) {
            console.error('framebuffer is not okay!');
            return;
        }

        let rowStride = width * 4;
        if (rowStride % this._packAlignment !== 0) {
            rowStride += this._packAlignment - (rowStride % this._packAlignment);
        }

        const imageSize = rowStride * (height - 1) + width * 4;
        if (imageSize <= 0) {
            return;
        }
        const pixelsLength = (pixels as ArrayLike<number> & { byteLength?: number }).length || pixels.byteLength || 0;
        if (pixelsLength < imageSize) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        // Handle reading outside the window
        let viewWidth = this.drawingBufferWidth;
        let viewHeight = this.drawingBufferHeight;

        if (this._activeFramebuffer) {
            viewWidth = this._activeFramebuffer._width;
            viewHeight = this._activeFramebuffer._height;
        }

        const pixelData = arrayToUint8Array(pixels);

        if (x >= viewWidth || x + width <= 0 ||
            y >= viewHeight || y + height <= 0) {
            for (let i = 0; i < pixelData.length; ++i) {
                pixelData[i] = 0;
            }
        } else if (x < 0 || x + width > viewWidth ||
            y < 0 || y + height > viewHeight) {
            for (let i = 0; i < pixelData.length; ++i) {
                pixelData[i] = 0;
            }

            let nx = x;
            let nWidth = width;
            if (x < 0) {
                nWidth += x;
                nx = 0;
            }
            if (nx + width > viewWidth) {
                nWidth = viewWidth - nx;
            }
            let ny = y;
            let nHeight = height;
            if (y < 0) {
                nHeight += y;
                ny = 0;
            }
            if (ny + height > viewHeight) {
                nHeight = viewHeight - ny;
            }

            let nRowStride = nWidth * 4;
            if (nRowStride % this._packAlignment !== 0) {
                nRowStride += this._packAlignment - (nRowStride % this._packAlignment);
            }

            if (nWidth > 0 && nHeight > 0) {
                const subPixels = new Uint8Array(nRowStride * nHeight);
                const result = this._gl.readPixels(
                    nx,
                    ny,
                    nWidth,
                    nHeight,
                    format,
                    type,
                    Uint8ArrayToVariant(subPixels));

                const src = result && result.length > 0 ? result : subPixels;
                const offset = 4 * (nx - x) + (ny - y) * rowStride;
                for (let j = 0; j < nHeight; ++j) {
                    for (let i = 0; i < nWidth; ++i) {
                        for (let k = 0; k < 4; ++k) {
                            pixelData[offset + j * rowStride + 4 * i + k] =
                                src[j * nRowStride + 4 * i + k];
                        }
                    }
                }
            }
        } else {
            const result = this._gl.readPixels(
                x,
                y,
                width,
                height,
                format,
                type,
                Uint8ArrayToVariant(pixelData));
            if (result && result.length > 0) {
                pixelData.set(result);
            }
        }
    },

    enableVertexAttribArray(this: WebGLContextBase, index: GLuint): void {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        this._gl.enableVertexAttribArray(index);

        this._vertexObjectState._attribs[index]._isPointer = true;
    },

    disableVertexAttribArray(this: WebGLContextBase, index: GLuint = 0): void {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        this._gl.disableVertexAttribArray(index);
        this._vertexObjectState._attribs[index]._isPointer = false;
    },

    vertexAttrib1f(this: WebGLContextBase, index: GLuint, x: GLfloat): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[1] = data[2] = 0;
        data[0] = x;
        this._gl.vertexAttrib1f(index | 0, +x);
    },

    vertexAttrib1fv(this: WebGLContextBase, index: GLuint, values: Float32List): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        if (typeof values !== 'object' || values === null || values.length < 1) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[2] = 0;
        data[1] = 0;
        data[0] = values[0];
        this._gl.vertexAttrib1f(index | 0, +values[0]);
    },

    vertexAttrib2f(this: WebGLContextBase, index: GLuint, x: GLfloat, y: GLfloat): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[2] = 0;
        data[1] = y;
        data[0] = x;
        this._gl.vertexAttrib2f(index | 0, +x, +y);
    },

    vertexAttrib2fv(this: WebGLContextBase, index: GLuint, values: Float32List): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        if (typeof values !== 'object' || values === null || values.length < 2) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[2] = 0;
        data[1] = values[1];
        data[0] = values[0];
        this._gl.vertexAttrib2f(index | 0, +values[0], +values[1]);
    },

    vertexAttrib3f(this: WebGLContextBase, index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[2] = z;
        data[1] = y;
        data[0] = x;
        this._gl.vertexAttrib3f(index | 0, +x, +y, +z);
    },

    vertexAttrib3fv(this: WebGLContextBase, index: GLuint, values: Float32List): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        if (typeof values !== 'object' || values === null || values.length < 3) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = 1;
        data[2] = values[2];
        data[1] = values[1];
        data[0] = values[0];
        this._gl.vertexAttrib3f(index | 0, +values[0], +values[1], +values[2]);
    },

    vertexAttrib4f(this: WebGLContextBase, index: GLuint = 0, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        if (!this._checkVertexIndex(index)) return;
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = w;
        data[2] = z;
        data[1] = y;
        data[0] = x;
        this._gl.vertexAttrib4f(index | 0, +x, +y, +z, +w);
    },

    vertexAttrib4fv(this: WebGLContextBase, index: GLuint, values: Float32List): void {
        index |= 0;
        if (!this._checkVertexIndex(index)) return;
        if (typeof values !== 'object' || values === null || values.length < 4) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        const data = this._vertexGlobalState._attribs[index]._data;
        data[3] = values[3];
        data[2] = values[2];
        data[1] = values[1];
        data[0] = values[0];
        this._gl.vertexAttrib4f(index | 0, +values[0], +values[1], +values[2], +values[3]);
    },

    vertexAttribPointer(this: WebGLContextBase, index: GLuint = 0, size: GLint = 0, type: GLenum = 0, normalized: GLboolean = false, stride: GLsizei = 0, offset: GLintptr = 0): void {
        if (stride < 0 || offset < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (stride < 0 ||
            offset < 0 ||
            index < 0 || index >= this._vertexObjectState._attribs.length ||
            !(size === 1 || size === 2 || size === 3 || size === 4)) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (this._vertexGlobalState._arrayBufferBinding === null) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // fixed, int and unsigned int aren't allowed in WebGL
        const byteSize = typeSize(this, type);
        if (byteSize === 0 ||
            type === this.INT ||
            type === this.UNSIGNED_INT) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (stride > 255 || stride < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        // stride and offset must be multiples of size
        if ((stride % byteSize) !== 0 ||
            (offset % byteSize) !== 0) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // Call vertex attrib pointer
        this._gl.vertexAttribPointer(index, size, type, normalized, stride, offset);

        // Update the vertex state object and references.
        this._vertexObjectState.setVertexAttribPointer(
            /* buffer */ this._vertexGlobalState._arrayBufferBinding,
            /* index */ index,
            /* pointerSize */ size * byteSize,
            /* pointerOffset */ offset,
            /* pointerStride */ stride || (size * byteSize),
            /* pointerType */ type,
            /* pointerNormal */ normalized,
            /* inputStride */ stride,
            /* inputSize */ size,
        );
    },

    getVertexAttrib(this: WebGLContextBase, index: GLuint = 0, pname: GLenum = 0): unknown {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE);
            return null;
        }
        const attrib = this._vertexObjectState._attribs[index];
        const vertexAttribValue = this._vertexGlobalState._attribs[index]._data;

        const extInstancing = this._extensions.angle_instanced_arrays;
        if (extInstancing) {
            if (pname === extInstancing.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE) {
                return attrib._divisor;
            }
        }

        switch (pname) {
            case this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
                return attrib._pointerBuffer;
            case this.VERTEX_ATTRIB_ARRAY_ENABLED:
                return attrib._isPointer;
            case this.VERTEX_ATTRIB_ARRAY_SIZE:
                return attrib._inputSize;
            case this.VERTEX_ATTRIB_ARRAY_STRIDE:
                return attrib._inputStride;
            case this.VERTEX_ATTRIB_ARRAY_TYPE:
                return attrib._pointerType;
            case this.VERTEX_ATTRIB_ARRAY_NORMALIZED:
                return attrib._pointerNormal;
            case this.CURRENT_VERTEX_ATTRIB:
                return new Float32Array(vertexAttribValue);
            default:
                this.setError(this.INVALID_ENUM);
                return null;
        }
    },

    getVertexAttribOffset(this: WebGLContextBase, index: GLuint = 0, pname: GLenum = 0): GLintptr {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE);
            return -1;
        }
        if (pname === this.VERTEX_ATTRIB_ARRAY_POINTER) {
            return this._vertexObjectState._attribs[index]._pointerOffset;
        } else {
            this.setError(this.INVALID_ENUM);
            return -1;
        }
    },

    _checkVertexAttribState(this: WebGLContextBase, maxIndex: number): boolean {
        const program = this._activeProgram;
        if (!program) {
            this.setError(this.INVALID_OPERATION);
            return false;
        }
        const attribs = this._vertexObjectState._attribs;
        for (let i = 0; i < attribs.length; ++i) {
            const attrib = attribs[i];
            if (attrib._isPointer) {
                const buffer = attrib._pointerBuffer;
                if (!buffer) {
                    this.setError(this.INVALID_OPERATION);
                    return false;
                }
                if (program._attributes.indexOf(i) >= 0) {
                    let maxByte = 0;
                    if (attrib._divisor) {
                        maxByte = attrib._pointerSize +
                            attrib._pointerOffset;
                    } else {
                        maxByte = attrib._pointerStride * maxIndex +
                            attrib._pointerSize +
                            attrib._pointerOffset;
                    }
                    if (maxByte > buffer._size) {
                        this.setError(this.INVALID_OPERATION);
                        return false;
                    }
                }
            }
        }
        return true;
    },

    _checkVertexIndex(this: WebGLContextBase, index: number): boolean {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE);
            return false;
        }
        return true;
    },
};

/** Install drawing methods on the given prototype. Called from webgl-context-base.ts. */
export function installDrawingMethods(proto: object): void {
    Object.assign(proto, drawingMethods);
}
