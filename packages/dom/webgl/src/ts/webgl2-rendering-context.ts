// WebGL2RenderingContext for GJS — original implementation using Gwebgl.WebGL2RenderingContext
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2),
//            refs/deno/cli/tsc/dts/lib.webworker.d.ts (WebGL2RenderingContextBase)

import Gwebgl from '@girs/gwebgl-0.1';
import { WebGLRenderingContext } from './webgl-rendering-context.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { WebGLQuery } from './webgl-query.js';
import { WebGLSampler } from './webgl-sampler.js';
import { WebGLSync } from './webgl-sync.js';
import { WebGLTransformFeedback } from './webgl-transform-feedback.js';
import { WebGLVertexArrayObject } from './webgl-vertex-array-object.js';
import { WebGLUniformLocation } from './webgl-uniform-location.js';
import { WebGLActiveInfo } from './webgl-active-info.js';
import { WebGLProgram as OurWebGLProgram } from './webgl-program.js';
import { WebGLTexture } from './webgl-texture.js';
import { WebGLRenderbuffer } from './webgl-renderbuffer.js';
import { Uint8ArrayToVariant, arrayToUint8Array, vertexCount } from './utils.js';
import { warnNotImplemented } from '@gjsify/utils';

export class WebGL2RenderingContext extends WebGLRenderingContext implements WebGL2RenderingContext {

    _native2: Gwebgl.WebGL2RenderingContext;

    _queries: Record<number, WebGLQuery> = {}
    _samplers: Record<number, WebGLSampler> = {}
    _transformFeedbacks: Record<number, WebGLTransformFeedback> = {}
    _vertexArrayObjects: Record<number, WebGLVertexArrayObject> = {}
    _syncs: Record<number, WebGLSync> = {}

    constructor(canvas: HTMLCanvasElement | null, options: Gwebgl.WebGL2RenderingContext.ConstructorProperties = {}) {
        super(canvas, options as Gwebgl.WebGLRenderingContext.ConstructorProperties);
        this._native2 = new Gwebgl.WebGL2RenderingContext({});
    }

    override _getGlslVersion(es: boolean): string {
        return es ? '300 es' : '130';
    }

    // ─── WebGL2 overrides for WebGL1 validation that's too strict ─────────

    /** WebGL2 allows COLOR_ATTACHMENT1–15 as framebuffer attachment points. */
    override _validFramebufferAttachment(attachment: GLenum): boolean {
        if (super._validFramebufferAttachment(attachment)) return true;
        // COLOR_ATTACHMENT1 (0x8CE1) through COLOR_ATTACHMENT15 (0x8CEF)
        return attachment >= 0x8CE1 && attachment <= 0x8CEF;
    }

    /**
     * Apply COLOR_ATTACHMENT1–15 to the native GL FBO when they have attachments.
     * The base class only knows about CA0, DEPTH, STENCIL, DEPTH_STENCIL.
     */
    override _updateFramebufferAttachments(framebuffer: any): void {
        super._updateFramebufferAttachments(framebuffer);
        if (!framebuffer) return;
        for (let i = 1; i <= 15; i++) {
            const attachmentEnum = 0x8CE0 + i; // COLOR_ATTACHMENT1–15
            // Only process slots that were explicitly set via framebufferTexture2D
            if (!(attachmentEnum in framebuffer._attachments)) continue;
            const attachment = framebuffer._attachments[attachmentEnum];
            if (attachment instanceof WebGLTexture) {
                const face = framebuffer._attachmentFace[attachmentEnum] || this.TEXTURE_2D;
                const level = framebuffer._attachmentLevel[attachmentEnum] ?? 0;
                this._native.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, face, attachment._ | 0, level | 0);
            } else if (attachment instanceof WebGLRenderbuffer) {
                this._native.framebufferRenderbuffer(this.FRAMEBUFFER, attachmentEnum, this.RENDERBUFFER, attachment._ | 0);
            } else {
                // Detach: use TEXTURE_2D as textarget (required by some GLES3 drivers)
                this._native.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, this.TEXTURE_2D, 0, 0);
            }
        }
    }

    /** WebGL2 adds UNIFORM_BUFFER, TRANSFORM_FEEDBACK_BUFFER, etc. targets. */
    override bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
        const isWebGL2Target = target === 0x8A11 /* UNIFORM_BUFFER */ ||
            target === 0x8C8E /* TRANSFORM_FEEDBACK_BUFFER */ ||
            target === 0x8F36 /* COPY_READ_BUFFER */ ||
            target === 0x8F37 /* COPY_WRITE_BUFFER */;
        if (isWebGL2Target) {
            // Bypass WebGL1 validation that only accepts ARRAY_BUFFER/ELEMENT_ARRAY_BUFFER.
            const id = buffer ? (buffer as any)._ | 0 : 0;
            this._native.bindBuffer(target, id);
            return;
        }
        super.bindBuffer(target, buffer as any);
    }

    /** WebGL2 adds READ/COPY buffer usages and additional buffer targets. */
    override bufferData(target: GLenum, dataOrSize: GLsizeiptr | BufferSource | null, usage: GLenum): void {
        const isWebGL2Target = target === 0x8A11 /* UNIFORM_BUFFER */ ||
            target === 0x8C8E /* TRANSFORM_FEEDBACK_BUFFER */ ||
            target === 0x8F36 /* COPY_READ_BUFFER */ ||
            target === 0x8F37 /* COPY_WRITE_BUFFER */;

        // Remap READ/COPY usages to STATIC_DRAW — WebGL1 tracking only accepts DRAW hints.
        const isReadOrCopy = usage === 0x88E1 /* STATIC_READ */ || usage === 0x88E3 /* DYNAMIC_READ */ ||
            usage === 0x88E5 /* STREAM_READ */ || usage === 0x88E2 /* STATIC_COPY */ ||
            usage === 0x88E4 /* DYNAMIC_COPY */ || usage === 0x88E6 /* STREAM_COPY */;
        const remappedUsage = isReadOrCopy ? this.STATIC_DRAW : usage;

        if (isWebGL2Target) {
            // Bypass WebGL1 target+usage validation and call native directly.
            if (typeof dataOrSize === 'number') {
                if (dataOrSize >= 0) this._native.bufferDataSizeOnly(target, dataOrSize, remappedUsage);
            } else if (dataOrSize !== null && typeof dataOrSize === 'object') {
                const u8Data = arrayToUint8Array(dataOrSize as any);
                this._native.bufferData(target, Uint8ArrayToVariant(u8Data), remappedUsage);
            }
            return;
        }

        super.bufferData(target, dataOrSize as any, remappedUsage);
    }

    /** WebGL2 adds TEXTURE_3D and TEXTURE_2D_ARRAY target support. */
    override bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        if (target === 0x806F /* TEXTURE_3D */ || target === 0x8C1A /* TEXTURE_2D_ARRAY */) {
            // Bypass WebGL1 _validTextureTarget check and call native directly.
            const id = texture ? (texture as any)._ | 0 : 0;
            this._native.bindTexture(target, id);
            if (texture) (texture as any)._binding = target;
            return;
        }
        super.bindTexture(target, texture);
    }

    /** WebGL2 adds TEXTURE_3D/TEXTURE_2D_ARRAY targets and TEXTURE_WRAP_R pname. */
    override texParameteri(target: GLenum, pname: GLenum, param: GLint): void {
        if (target === 0x806F /* TEXTURE_3D */ || target === 0x8C1A /* TEXTURE_2D_ARRAY */) {
            // Bypass WebGL1 _checkTextureTarget which only allows TEXTURE_2D/CUBE_MAP.
            this._native.texParameteri(target, pname, param);
            return;
        }
        if (pname === 0x8072 /* TEXTURE_WRAP_R — WebGL2 only */) {
            this._native.texParameteri(target, pname, param);
            return;
        }
        super.texParameteri(target, pname, param);
    }

    /**
     * In WebGL2/GLES3 the attribute-0 requirement from WebGL1 does not apply.
     * Override drawArrays to skip the attrib0 hack and call glDrawArrays directly.
     */
    override drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
        if (first < 0 || count < 0) { this.setError(this.INVALID_VALUE); return; }
        if (!this._checkStencilState()) return;
        const rc = vertexCount(this, mode, count);
        if (rc < 0) { this.setError(this.INVALID_ENUM); return; }
        if (!this._framebufferOk()) return;
        if (count === 0) return;
        if (this._checkVertexAttribState((count + first - 1) >>> 0)) {
            this._native.drawArrays(mode, first, rc);
        }
    }

    // ─── Vertex Array Objects ─────────────────────────────────────────────

    createVertexArray(): WebGLVertexArrayObject | null {
        const id = this._native2.createVertexArray();
        if (!id) return null;
        const vao = new WebGLVertexArrayObject(id, this);
        this._vertexArrayObjects[id] = vao;
        return vao;
    }

    deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return;
        vertexArray._pendingDelete = true;
        vertexArray._checkDelete();
    }

    isVertexArray(vertexArray: WebGLVertexArrayObject | null): GLboolean {
        if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return false;
        return this._native2.isVertexArray(vertexArray._);
    }

    bindVertexArray(array: WebGLVertexArrayObject | null): void {
        if (array === null) {
            this._native2.bindVertexArray(0);
            this._vertexObjectState = this._defaultVertexObjectState;
        } else if (array instanceof WebGLVertexArrayObject) {
            this._native2.bindVertexArray(array._);
            this._vertexObjectState = array._objectState;
        } else {
            this.setError(this.INVALID_OPERATION);
        }
    }

    // ─── Query Objects ────────────────────────────────────────────────────

    createQuery(): WebGLQuery | null {
        const id = this._native2.createQuery();
        if (!id) return null;
        const query = new WebGLQuery(id, this);
        this._queries[id] = query;
        return query;
    }

    deleteQuery(query: WebGLQuery | null): void {
        if (!query || !(query instanceof WebGLQuery)) return;
        query._pendingDelete = true;
        query._checkDelete();
    }

    isQuery(query: WebGLQuery | null): GLboolean {
        if (!query || !(query instanceof WebGLQuery)) return false;
        return this._native2.isQuery(query._);
    }

    beginQuery(target: GLenum, query: WebGLQuery): void {
        if (!(query instanceof WebGLQuery)) return;
        this._native2.beginQuery(target, query._);
    }

    endQuery(target: GLenum): void {
        this._native2.endQuery(target);
    }

    getQuery(_target: GLenum, _pname: GLenum): WebGLQuery | null {
        warnNotImplemented('WebGL2RenderingContext.getQuery');
        return null;
    }

    getQueryParameter(query: WebGLQuery, pname: GLenum): any {
        if (!(query instanceof WebGLQuery)) return null;
        return this._native2.getQueryParameter(query._, pname);
    }

    // ─── Sampler Objects ──────────────────────────────────────────────────

    createSampler(): WebGLSampler | null {
        const id = this._native2.createSampler();
        if (!id) return null;
        const sampler = new WebGLSampler(id, this);
        this._samplers[id] = sampler;
        return sampler;
    }

    deleteSampler(sampler: WebGLSampler | null): void {
        if (!sampler || !(sampler instanceof WebGLSampler)) return;
        sampler._pendingDelete = true;
        sampler._checkDelete();
    }

    isSampler(sampler: WebGLSampler | null): GLboolean {
        if (!sampler || !(sampler instanceof WebGLSampler)) return false;
        return this._native2.isSampler(sampler._);
    }

    bindSampler(unit: GLuint, sampler: WebGLSampler | null): void {
        this._native2.bindSampler(unit, sampler ? sampler._ : 0);
    }

    samplerParameteri(sampler: WebGLSampler, pname: GLenum, param: GLint): void {
        if (!(sampler instanceof WebGLSampler)) return;
        this._native2.samplerParameteri(sampler._, pname, param);
    }

    samplerParameterf(sampler: WebGLSampler, pname: GLenum, param: GLfloat): void {
        if (!(sampler instanceof WebGLSampler)) return;
        this._native2.samplerParameterf(sampler._, pname, param);
    }

    getSamplerParameter(sampler: WebGLSampler, pname: GLenum): any {
        if (!(sampler instanceof WebGLSampler)) return null;
        // Float params: TEXTURE_MIN_LOD, TEXTURE_MAX_LOD
        if (pname === 0x813A || pname === 0x813B) {
            return this._native2.getSamplerParameterf(sampler._, pname);
        }
        return this._native2.getSamplerParameteri(sampler._, pname);
    }

    // ─── Sync Objects ─────────────────────────────────────────────────────

    fenceSync(condition: GLenum, flags: GLbitfield): WebGLSync | null {
        const id = this._native2.fenceSync(condition, flags);
        if (!id) return null;
        const sync = new WebGLSync(id, this);
        this._syncs[id] = sync;
        return sync;
    }

    isSync(sync: WebGLSync | null): GLboolean {
        if (!sync || !(sync instanceof WebGLSync)) return false;
        return this._native2.isSync(sync._);
    }

    deleteSync(sync: WebGLSync | null): void {
        if (!sync || !(sync instanceof WebGLSync)) return;
        sync._pendingDelete = true;
        sync._checkDelete();
    }

    clientWaitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLuint64): GLenum {
        if (!(sync instanceof WebGLSync)) return 0x911C; // WAIT_FAILED
        return this._native2.clientWaitSync(sync._, flags, timeout as unknown as number);
    }

    waitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLint64): void {
        if (!(sync instanceof WebGLSync)) return;
        this._native2.waitSync(sync._, flags, timeout as unknown as number);
    }

    getSyncParameter(sync: WebGLSync, pname: GLenum): any {
        if (!(sync instanceof WebGLSync)) return null;
        return this._native2.getSyncParameter(sync._, pname);
    }

    // ─── Transform Feedback ───────────────────────────────────────────────

    createTransformFeedback(): WebGLTransformFeedback | null {
        const id = this._native2.createTransformFeedback();
        if (!id) return null;
        const tf = new WebGLTransformFeedback(id, this);
        this._transformFeedbacks[id] = tf;
        return tf;
    }

    deleteTransformFeedback(tf: WebGLTransformFeedback | null): void {
        if (!tf || !(tf instanceof WebGLTransformFeedback)) return;
        tf._pendingDelete = true;
        tf._checkDelete();
    }

    isTransformFeedback(tf: WebGLTransformFeedback | null): GLboolean {
        if (!tf || !(tf instanceof WebGLTransformFeedback)) return false;
        return this._native2.isTransformFeedback(tf._);
    }

    bindTransformFeedback(target: GLenum, tf: WebGLTransformFeedback | null): void {
        this._native2.bindTransformFeedback(target, tf ? tf._ : 0);
    }

    beginTransformFeedback(primitiveMode: GLenum): void {
        this._native2.beginTransformFeedback(primitiveMode);
    }

    endTransformFeedback(): void {
        this._native2.endTransformFeedback();
    }

    pauseTransformFeedback(): void {
        this._native2.pauseTransformFeedback();
    }

    resumeTransformFeedback(): void {
        this._native2.resumeTransformFeedback();
    }

    transformFeedbackVaryings(program: WebGLProgram, varyings: string[], bufferMode: GLenum): void {
        this._native2.transformFeedbackVaryings((program as unknown as OurWebGLProgram)._, varyings, bufferMode);
    }

    getTransformFeedbackVarying(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        const result = this._native2.getTransformFeedbackVarying((program as unknown as OurWebGLProgram)._, index)
            .deepUnpack<{ name: string; size: number; type: number }>();
        return new WebGLActiveInfo({ size: result.size, type: result.type, name: result.name });
    }

    // ─── Indexed Buffer Binding ───────────────────────────────────────────

    bindBufferBase(target: GLenum, index: GLuint, buffer: WebGLBuffer | null): void {
        this._native2.bindBufferBase(target, index, buffer ? (buffer as any)._ : 0);
    }

    bindBufferRange(target: GLenum, index: GLuint, buffer: WebGLBuffer | null, offset: GLintptr, size: GLsizeiptr): void {
        this._native2.bindBufferRange(target, index, buffer ? (buffer as any)._ : 0, offset, size);
    }

    copyBufferSubData(readTarget: GLenum, writeTarget: GLenum, readOffset: GLintptr, writeOffset: GLintptr, size: GLsizeiptr): void {
        this._native2.copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size);
    }

    getBufferSubData(target: GLenum, srcByteOffset: GLintptr, dstBuffer: ArrayBufferView, dstOffset?: GLuint, length?: GLuint): void {
        const byteLength = length !== undefined ? length : dstBuffer.byteLength - (dstOffset ?? 0);
        const data = this._native2.getBufferSubData(target, srcByteOffset, byteLength);
        const dst = new Uint8Array(dstBuffer.buffer, dstBuffer.byteOffset + (dstOffset ?? 0) * (dstBuffer instanceof Uint8Array ? 1 : (dstBuffer as any).BYTES_PER_ELEMENT ?? 1));
        dst.set(data.subarray(0, dst.byteLength));
    }

    // ─── 3D Textures ──────────────────────────────────────────────────────

    texImage3D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void {
        if (pixels === null) {
            this._native2.texImage3DNull(target, level, internalformat, width, height, depth, border, format, type);
        } else {
            this._native2.texImage3D(target, level, internalformat, width, height, depth, border, format, type, Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)));
        }
    }

    texSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void {
        if (pixels === null) return;
        this._native2.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)));
    }

    compressedTexImage3D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei, border: GLint, _imageSize: GLsizei, data: ArrayBufferView): void {
        this._native2.compressedTexImage3D(target, level, internalformat, width, height, depth, border, Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
    }

    compressedTexSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, width: GLsizei, height: GLsizei, depth: GLsizei, format: GLenum, _imageSize: GLsizei, data: ArrayBufferView): void {
        this._native2.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
    }

    copyTexSubImage3D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        this._native2.copyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height);
    }

    texStorage2D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei): void {
        this._native2.texStorage2D(target, levels, internalformat, width, height);
    }

    texStorage3D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei): void {
        this._native2.texStorage3D(target, levels, internalformat, width, height, depth);
    }

    framebufferTextureLayer(target: GLenum, attachment: GLenum, texture: WebGLTexture | null, level: GLint, layer: GLint): void {
        this._native2.framebufferTextureLayer(target, attachment, texture ? (texture as any)._ : 0, level, layer);
    }

    // ─── Instancing & Advanced Draw ───────────────────────────────────────

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        this._native2.drawArraysInstanced(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void {
        this._native2.drawElementsInstanced(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this._native2.vertexAttribDivisor(index, divisor);
    }

    vertexAttribIPointer(index: GLuint, size: GLint, type: GLenum, stride: GLsizei, offset: GLintptr): void {
        this._native2.vertexAttribIPointer(index, size, type, stride, offset);
    }

    drawBuffers(buffers: GLenum[]): void {
        this._native2.drawBuffers(Array.from(buffers) as number[]);
    }

    drawRangeElements(mode: GLenum, start: GLuint, end: GLuint, count: GLsizei, type: GLenum, offset: GLintptr): void {
        this._native2.drawRangeElements(mode, start, end, count, type, offset);
    }

    blitFramebuffer(srcX0: GLint, srcY0: GLint, srcX1: GLint, srcY1: GLint, dstX0: GLint, dstY0: GLint, dstX1: GLint, dstY1: GLint, mask: GLbitfield, filter: GLenum): void {
        this._native2.blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter);
    }

    invalidateFramebuffer(target: GLenum, attachments: GLenum[]): void {
        this._native2.invalidateFramebuffer(target, Array.from(attachments) as number[]);
    }

    invalidateSubFramebuffer(target: GLenum, attachments: GLenum[], x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        this._native2.invalidateSubFramebuffer(target, Array.from(attachments) as number[], x, y, width, height);
    }

    readBuffer(src: GLenum): void {
        this._native2.readBuffer(src);
    }

    renderbufferStorageMultisample(target: GLenum, samples: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei): void {
        this._native2.renderbufferStorageMultisample(target, samples, internalformat, width, height);
    }

    // ─── Unsigned Integer Uniforms ────────────────────────────────────────

    uniform1ui(location: WebGLUniformLocation | null, v0: GLuint): void {
        if (!location) return;
        this._native2.uniform1ui((location as WebGLUniformLocation)._, v0);
    }

    uniform2ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint): void {
        if (!location) return;
        this._native2.uniform2ui((location as WebGLUniformLocation)._, v0, v1);
    }

    uniform3ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint): void {
        if (!location) return;
        this._native2.uniform3ui((location as WebGLUniformLocation)._, v0, v1, v2);
    }

    uniform4ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint, v3: GLuint): void {
        if (!location) return;
        this._native2.uniform4ui((location as WebGLUniformLocation)._, v0, v1, v2, v3);
    }

    uniform1uiv(location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform1uiv((location as WebGLUniformLocation)._, arr.length, Array.from(arr) as number[]);
    }

    uniform2uiv(location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform2uiv((location as WebGLUniformLocation)._, arr.length / 2, Array.from(arr) as number[]);
    }

    uniform3uiv(location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform3uiv((location as WebGLUniformLocation)._, arr.length / 3, Array.from(arr) as number[]);
    }

    uniform4uiv(location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform4uiv((location as WebGLUniformLocation)._, arr.length / 4, Array.from(arr) as number[]);
    }

    // ─── Non-square Matrix Uniforms ───────────────────────────────────────

    uniformMatrix2x3fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix2x3fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    uniformMatrix3x2fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix3x2fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    uniformMatrix2x4fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix2x4fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    uniformMatrix4x2fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix4x2fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    uniformMatrix3x4fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix3x4fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    uniformMatrix4x3fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix4x3fv((location as WebGLUniformLocation)._, transpose, Array.from(arr));
    }

    // ─── getUniform — WebGL2 uint type support ────────────────────────────

    /** WebGL1 getUniform falls to default:null for UNSIGNED_INT types. Handle them here. */
    override getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
        const type = (location as any)?._activeInfo?.type;
        const UINT = 0x1405, UVEC2 = 0x8DC6, UVEC3 = 0x8DC7, UVEC4 = 0x8DC8;
        const isUintType = type === UINT || type === UVEC2 || type === UVEC3 || type === UVEC4;
        if (!isUintType) return super.getUniform(program as any, location);
        // Use getUniformiv (glGetUniformiv converts uint→int, exact for values < 2^31)
        if (!program || !location) return null;
        const data = (this._native as any).getUniformi((program as any)._ | 0, (location as any)._ | 0);
        if (!data) return null;
        if (type === UINT) return data[0] >>> 0;
        if (type === UVEC2) return new Uint32Array([data[0] >>> 0, data[1] >>> 0]);
        if (type === UVEC3) return new Uint32Array([data[0] >>> 0, data[1] >>> 0, data[2] >>> 0]);
        return new Uint32Array([data[0] >>> 0, data[1] >>> 0, data[2] >>> 0, data[3] >>> 0]);
    }

    // ─── Uniform Blocks ───────────────────────────────────────────────────

    getUniformBlockIndex(program: WebGLProgram, uniformBlockName: string): GLuint {
        return this._native2.getUniformBlockIndex((program as unknown as OurWebGLProgram)._, uniformBlockName);
    }

    uniformBlockBinding(program: WebGLProgram, uniformBlockIndex: GLuint, uniformBlockBinding: GLuint): void {
        this._native2.uniformBlockBinding((program as unknown as OurWebGLProgram)._, uniformBlockIndex, uniformBlockBinding);
    }

    getActiveUniformBlockName(program: WebGLProgram, uniformBlockIndex: GLuint): string | null {
        const name = this._native2.getActiveUniformBlockName((program as unknown as OurWebGLProgram)._, uniformBlockIndex);
        return name.length > 0 ? name : null;
    }

    getActiveUniformBlockParameter(program: WebGLProgram, uniformBlockIndex: GLuint, pname: GLenum): any {
        return this._native2.getActiveUniformBlockParameter((program as unknown as OurWebGLProgram)._, uniformBlockIndex, pname);
    }

    getActiveUniforms(program: WebGLProgram, uniformIndices: GLuint[], pname: GLenum): any {
        const result = this._native2.getActiveUniforms((program as unknown as OurWebGLProgram)._, uniformIndices, pname);
        return result;
    }

    // ─── Program Queries ──────────────────────────────────────────────────

    getFragDataLocation(program: WebGLProgram, name: string): GLint {
        return this._native2.getFragDataLocation((program as unknown as OurWebGLProgram)._, name);
    }

    // ─── Indexed Parameter Queries ────────────────────────────────────────

    getIndexedParameter(target: GLenum, index: GLuint): any {
        return this._native2.getIndexedParameteri(target, index);
    }

    getInternalformatParameter(target: GLenum, internalformat: GLenum, pname: GLenum): any {
        return this._native2.getInternalformatParameter(target, internalformat, pname);
    }

    override getParameter(pname: GLenum): any {
        if (pname === 0x1F02 /* GL_VERSION */) return 'WebGL 2.0';
        if (pname === 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */) return 'WebGL GLSL ES 3.00';
        if (pname === 0x1F03 /* GL_EXTENSIONS */) {
            warnNotImplemented('WebGL2RenderingContext.getParameter(GL_EXTENSIONS)');
            return '';
        }
        // WebGL2-specific integer parameters not in the WebGL1 switch.
        // Vala getParameterx default calls glGetIntegerv for any pname, so this works
        // for all valid OpenGL ES 3.x integer queries.
        switch (pname) {
            case 0x8D57: // MAX_SAMPLES
            case 0x88FF: // MAX_ARRAY_TEXTURE_LAYERS
            case 0x8073: // MAX_3D_TEXTURE_SIZE
            case 0x8CDF: // MAX_COLOR_ATTACHMENTS
            case 0x8824: // MAX_DRAW_BUFFERS
            case 0x8D6B: // MAX_ELEMENT_INDEX
            case 0x80E9: // MAX_ELEMENTS_INDICES
            case 0x80E8: // MAX_ELEMENTS_VERTICES
            case 0x9125: // MAX_FRAGMENT_INPUT_COMPONENTS
            case 0x8A2D: // MAX_FRAGMENT_UNIFORM_BLOCKS
            case 0x8B49: // MAX_FRAGMENT_UNIFORM_COMPONENTS
            case 0x8905: // MAX_PROGRAM_TEXEL_OFFSET
            case 0x8C8A: // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
            case 0x8C8B: // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS
            case 0x8C80: // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS
            case 0x8A30: // MAX_UNIFORM_BLOCK_SIZE
            case 0x8A2F: // MAX_UNIFORM_BUFFER_BINDINGS
            case 0x8B4B: // MAX_VARYING_COMPONENTS
            case 0x9122: // MAX_VERTEX_OUTPUT_COMPONENTS
            case 0x8A2B: // MAX_VERTEX_UNIFORM_BLOCKS
            case 0x8B4A: // MAX_VERTEX_UNIFORM_COMPONENTS
            case 0x8A33: // MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS
            case 0x8A2E: // MAX_COMBINED_UNIFORM_BLOCKS
            case 0x8A31: // MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS
            case 0x8904: // MIN_PROGRAM_TEXEL_OFFSET
            case 0x0D02: // PACK_ROW_LENGTH
            case 0x0D04: // PACK_SKIP_PIXELS
            case 0x0D03: // PACK_SKIP_ROWS
            case 0x88ED: // PIXEL_PACK_BUFFER_BINDING
            case 0x88EF: // PIXEL_UNPACK_BUFFER_BINDING
            case 0x0C02: // READ_BUFFER
            case 0x8CAA: // READ_FRAMEBUFFER_BINDING
            case 0x806A: // TEXTURE_BINDING_3D
            case 0x8C1D: // TEXTURE_BINDING_2D_ARRAY
            case 0x8E25: // TRANSFORM_FEEDBACK_BINDING
            case 0x8C8F: // TRANSFORM_FEEDBACK_BUFFER_BINDING
            case 0x8A28: // UNIFORM_BUFFER_BINDING
            case 0x8A34: // UNIFORM_BUFFER_OFFSET_ALIGNMENT
            case 0x806E: // UNPACK_IMAGE_HEIGHT
            case 0x0CF2: // UNPACK_ROW_LENGTH
            case 0x806D: // UNPACK_SKIP_IMAGES
            case 0x0CF4: // UNPACK_SKIP_PIXELS
            case 0x0CF3: // UNPACK_SKIP_ROWS
            case 0x84FD: // MAX_TEXTURE_LOD_BIAS
                return (this._native2.getParameterx(pname)?.deepUnpack() as number) | 0;
            case 0x8C89: // RASTERIZER_DISCARD
            case 0x8E24: // TRANSFORM_FEEDBACK_ACTIVE
            case 0x8E23: // TRANSFORM_FEEDBACK_PAUSED
                return !!this._native2.getParameterx(pname)?.deepUnpack();
        }
        return super.getParameter(pname);
    }

    // ─── Misc ─────────────────────────────────────────────────────────────

    getStringi(name: GLenum, index: GLuint): string | null {
        const s = this._native2.getStringi(name, index);
        return s.length > 0 ? s : null;
    }
}
