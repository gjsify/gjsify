// WebGL2RenderingContext for GJS — original implementation using Gwebgl.WebGL2RenderingContext
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2),
//            refs/deno/cli/tsc/dts/lib.webworker.d.ts (WebGL2RenderingContextBase)

import Gwebgl from '@girs/gwebgl-0.1';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import { WebGLContextBase } from './webgl-context-base.js';
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
import { WebGLFramebuffer } from './webgl-framebuffer.js';
import { Uint8ArrayToVariant, arrayToUint8Array, vertexCount, convertPixels, extractImageData, checkObject } from './utils.js';
import { warnNotImplemented } from '@gjsify/utils';

export class WebGL2RenderingContext extends WebGLContextBase implements WebGL2RenderingContext {

    _native2: Gwebgl.WebGL2RenderingContext;

    get _gl(): Gwebgl.WebGLRenderingContextBase {
        return this._native2;
    }

    _queries: Record<number, WebGLQuery> = {}
    _samplers: Record<number, WebGLSampler> = {}
    _transformFeedbacks: Record<number, WebGLTransformFeedback> = {}
    _vertexArrayObjects: Record<number, WebGLVertexArrayObject> = {}
    _syncs: Record<number, WebGLSync> = {}

    _activeReadFramebuffer: WebGLFramebuffer | null = null;
    _activeDrawFramebuffer: WebGLFramebuffer | null = null;

    constructor(canvas: HTMLCanvasElement | null, options: Partial<Gwebgl.WebGL2RenderingContext.ConstructorProps> = {}) {
        super(canvas, options);
        this._native2 = new Gwebgl.WebGL2RenderingContext({});
        this._init();
    }

    override _getGlslVersion(es: boolean): string {
        return es ? '300 es' : '130';
    }

    // ─── WebGL2 overrides for WebGL1 validation that's too strict ─────────

    /**
     * WebGL2 delegates framebuffer completeness to the native GL driver.
     * Called by _framebufferOk() before draw calls and by _updateFramebufferAttachments.
     * The base class version uses JS-side format whitelists that reject valid WebGL2 formats.
     */
    /** WebGL2 allows COLOR_ATTACHMENT1–15 as framebuffer attachment points. */
    override _validFramebufferAttachment(attachment: GLenum): boolean {
        if (super._validFramebufferAttachment(attachment)) return true;
        // COLOR_ATTACHMENT1 (0x8CE1) through COLOR_ATTACHMENT15 (0x8CEF)
        return attachment >= 0x8CE1 && attachment <= 0x8CEF;
    }

    // ─── MRT: native COLOR_ATTACHMENT0–15 support ────────────────────────

    private static readonly _WGL2_ALL_COLOR_ATTACHMENTS: number[] = [
        0x8CE0, 0x8CE1, 0x8CE2, 0x8CE3, 0x8CE4, 0x8CE5, 0x8CE6, 0x8CE7,
        0x8CE8, 0x8CE9, 0x8CEA, 0x8CEB, 0x8CEC, 0x8CED, 0x8CEE, 0x8CEF,
    ];

    override _getColorAttachments(): number[] {
        return WebGL2RenderingContext._WGL2_ALL_COLOR_ATTACHMENTS;
    }


    /**
     * WebGL2 extends the base-class framebuffer completeness pre-check to
     * accept WebGL2-specific formats that the WebGL1 whitelist rejects.
     *
     * NOTE: This is called by _updateFramebufferAttachments BEFORE the native
     * GL attachments are set, so we must NOT query glCheckFramebufferStatus
     * here (it would see an empty FBO and always return INCOMPLETE).
     * Instead we extend the JS-side format whitelist to cover WebGL2 formats.
     */
    override _preCheckFramebufferStatus(framebuffer: WebGLFramebuffer): GLenum {
        const attachments = framebuffer._attachments;

        // WebGL2 supports many attachment combinations that WebGL1 rejected:
        //  - Sized internal formats (RGBA8, RGBA16F, RGB32F, DEPTH_COMPONENT24, ...)
        //  - Depth textures as DEPTH_ATTACHMENT (used by shadow maps, RenderPixelatedPass)
        //  - Depth-only FBOs without any color attachment (valid in WebGL2)
        //  - WebGL2 renderbuffer formats (DEPTH_COMPONENT24, DEPTH24_STENCIL8, ...)
        //
        // Strategy: scan all attachments and derive the FBO dimensions.  If we find
        // at least one attachment with valid (non-zero) dimensions, return COMPLETE and
        // let the native GL driver do the real completeness check at draw time.
        // (draw calls are gated by _framebufferOk() which always returns true in WebGL2,
        //  so this JS check is only needed to keep _updateFramebufferAttachments happy
        //  so it actually pushes the attachments to the native FBO.)

        let bestWidth = 0;
        let bestHeight = 0;

        const allEnums = [
            this.COLOR_ATTACHMENT0, this.DEPTH_ATTACHMENT, this.STENCIL_ATTACHMENT, this.DEPTH_STENCIL_ATTACHMENT,
            ...WebGL2RenderingContext._WGL2_ALL_COLOR_ATTACHMENTS,
        ];
        for (const enumVal of allEnums) {
            const attach = attachments[enumVal];
            if (!attach) continue;
            if (attach instanceof WebGLTexture) {
                const level = framebuffer._attachmentLevel[enumVal] ?? 0;
                const w = attach._levelWidth[level] ?? 0;
                const h = attach._levelHeight[level] ?? 0;
                if (w > 0 && h > 0) { bestWidth = w; bestHeight = h; break; }
            } else if (attach instanceof WebGLRenderbuffer) {
                if (attach._width > 0 && attach._height > 0) {
                    bestWidth = attach._width; bestHeight = attach._height; break;
                }
            }
        }

        if (bestWidth > 0 && bestHeight > 0) {
            framebuffer._width = bestWidth;
            framebuffer._height = bestHeight;
            return this.FRAMEBUFFER_COMPLETE;
        }

        // No attachment with valid dimensions yet — report incomplete so the
        // attachment is deferred until texStorage2D/texImage2D populates dimensions.
        return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    }

    /**
     * WebGL2 completely replaces the base class framebuffer attachment flow.
     *
     * The base class flow is: (1) pre-check formats in JS → (2) set native
     * attachments only if pre-check passes. This is wrong for WebGL2 because
     * the JS pre-check uses WebGL1 format whitelists that reject valid WebGL2
     * formats.
     *
     * WebGL2 flow: (1) always set native attachments first → (2) query native
     * glCheckFramebufferStatus to determine completeness. This delegates all
     * format validation to the native GL driver, matching browser behavior.
     *
     * Also handles COLOR_ATTACHMENT1–15 (WebGL2 MRT) that the base class
     * doesn't know about.
     */
    /**
     * Apply COLOR_ATTACHMENT1–15 to the native GL FBO (WebGL2 MRT).
     * The base class handles CA0, DEPTH, STENCIL, DEPTH_STENCIL and calls
     * _preCheckFramebufferStatus (which we override to query native GL).
     */
    override _updateFramebufferAttachments(framebuffer: any): void {
        super._updateFramebufferAttachments(framebuffer);
        if (!framebuffer) return;
        for (let i = 1; i <= 15; i++) {
            const attachmentEnum = 0x8CE0 + i;
            if (!(attachmentEnum in framebuffer._attachments)) continue;
            const attachment = framebuffer._attachments[attachmentEnum];
            if (attachment instanceof WebGLTexture) {
                const face = framebuffer._attachmentFace[attachmentEnum] || this.TEXTURE_2D;
                const level = framebuffer._attachmentLevel[attachmentEnum] ?? 0;
                this._gl.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, face, attachment._ | 0, level | 0);
            } else if (attachment instanceof WebGLRenderbuffer) {
                this._gl.framebufferRenderbuffer(this.FRAMEBUFFER, attachmentEnum, this.RENDERBUFFER, attachment._ | 0);
            } else {
                this._gl.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, this.TEXTURE_2D, 0, 0);
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
            this._gl.bindBuffer(target, id);
            return;
        }
        super.bindBuffer(target, buffer as any);
    }

    /**
     * WebGL2 adds READ_FRAMEBUFFER (0x8CA8) and DRAW_FRAMEBUFFER (0x8CA9) targets.
     * The base class only accepts FRAMEBUFFER; this override handles the two new targets
     * and keeps _activeReadFramebuffer / _activeDrawFramebuffer in sync.
     */
    override bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        if (target === 0x8CA8 /* READ_FRAMEBUFFER */ || target === 0x8CA9 /* DRAW_FRAMEBUFFER */) {
            if (!checkObject(framebuffer)) {
                throw new TypeError('bindFramebuffer(GLenum, WebGLFramebuffer)');
            }
            if (framebuffer && framebuffer._pendingDelete) return;
            if (framebuffer && !this._checkWrapper(framebuffer, WebGLFramebuffer)) return;

            // null → restore GTK's FBO (captured at init time).
            // FBO 0 is NOT the display FBO in GtkGLArea — GTK uses its own custom FBO.
            const id = framebuffer ? framebuffer._ | 0 : this._gtkFboId;
            this._gl.bindFramebuffer(target, id);

            if (target === 0x8CA8 /* READ_FRAMEBUFFER */) {
                const prev = this._activeReadFramebuffer;
                if (prev !== framebuffer) {
                    if (prev) { prev._refCount -= 1; prev._checkDelete(); }
                    if (framebuffer) framebuffer._refCount += 1;
                }
                this._activeReadFramebuffer = framebuffer;
            } else {
                // DRAW_FRAMEBUFFER
                const prev = this._activeDrawFramebuffer;
                if (prev !== framebuffer) {
                    if (prev) { prev._refCount -= 1; prev._checkDelete(); }
                    if (framebuffer) framebuffer._refCount += 1;
                }
                this._activeDrawFramebuffer = framebuffer;
                // Keep _activeFramebuffer in sync so inherited methods (readPixels, etc.) work.
                this._activeFramebuffer = framebuffer;
            }
            return;
        }

        // FRAMEBUFFER target — delegate to base class, then sync both read/draw fields.
        super.bindFramebuffer(this.FRAMEBUFFER, framebuffer);
        this._activeReadFramebuffer = framebuffer;
        this._activeDrawFramebuffer = framebuffer;
    }

    /** WebGL2 also unbinds from read/draw framebuffer slots when deleting. */
    override deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void {
        if (this._activeReadFramebuffer === framebuffer) {
            this.bindFramebuffer(0x8CA8 /* READ_FRAMEBUFFER */, null);
        }
        if (this._activeDrawFramebuffer === framebuffer) {
            this.bindFramebuffer(0x8CA9 /* DRAW_FRAMEBUFFER */, null);
        }
        super.deleteFramebuffer(framebuffer);
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
                if (dataOrSize >= 0) this._gl.bufferDataSizeOnly(target, dataOrSize, remappedUsage);
            } else if (dataOrSize !== null && typeof dataOrSize === 'object') {
                const u8Data = arrayToUint8Array(dataOrSize as any);
                this._gl.bufferData(target, Uint8ArrayToVariant(u8Data), remappedUsage);
            }
            return;
        }

        super.bufferData(target, dataOrSize as any, remappedUsage);
    }

    /** WebGL2 adds UNIFORM_BUFFER, TRANSFORM_FEEDBACK_BUFFER, COPY_READ/WRITE targets. */
    override bufferSubData(target: GLenum, offset: GLintptr, data: BufferSource): void {
        const isWebGL2Target = target === 0x8A11 /* UNIFORM_BUFFER */ ||
            target === 0x8C8E /* TRANSFORM_FEEDBACK_BUFFER */ ||
            target === 0x8F36 /* COPY_READ_BUFFER */ ||
            target === 0x8F37 /* COPY_WRITE_BUFFER */;
        if (isWebGL2Target) {
            if (offset < 0) { this.setError(this.INVALID_VALUE); return; }
            if (!data) { this.setError(this.INVALID_VALUE); return; }
            const u8Data = arrayToUint8Array(data as any);
            this._gl.bufferSubData(target, offset, Uint8ArrayToVariant(u8Data));
            return;
        }
        super.bufferSubData(target, offset, data);
    }

    /** WebGL2 adds TEXTURE_3D and TEXTURE_2D_ARRAY target support. */
    override bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        if (target === 0x806F /* TEXTURE_3D */ || target === 0x8C1A /* TEXTURE_2D_ARRAY */) {
            // Bypass WebGL1 _validTextureTarget check and call native directly.
            const id = texture ? (texture as any)._ | 0 : 0;
            this._gl.bindTexture(target, id);
            if (texture) (texture as any)._binding = target;
            return;
        }
        super.bindTexture(target, texture);
    }

    /** WebGL2 adds TEXTURE_3D/TEXTURE_2D_ARRAY targets and many new pnames. */
    override texParameteri(target: GLenum, pname: GLenum, param: GLint): void {
        if (target === 0x806F /* TEXTURE_3D */ || target === 0x8C1A /* TEXTURE_2D_ARRAY */) {
            // Bypass WebGL1 _checkTextureTarget which only allows TEXTURE_2D/CUBE_MAP.
            this._gl.texParameteri(target, pname, param);
            return;
        }
        // WebGL2-specific pnames that the base class rejects with INVALID_ENUM:
        //   TEXTURE_WRAP_R (0x8072) — 3D wrap mode
        //   TEXTURE_COMPARE_MODE (0x884C) — shadow sampler setup (GL_COMPARE_REF_TO_TEXTURE)
        //   TEXTURE_COMPARE_FUNC (0x884D) — GL_LEQUAL etc. for shadow comparison
        //   TEXTURE_BASE_LEVEL (0x813C) — mipmap base level
        //   TEXTURE_MAX_LEVEL (0x813D) — mipmap max level
        //   TEXTURE_MIN_LOD (0x813B) — minimum LOD clamp
        //   TEXTURE_MAX_LOD (0x813A) — maximum LOD clamp
        const isWebGL2Pname =
            pname === 0x8072 /* TEXTURE_WRAP_R */ ||
            pname === 0x884C /* TEXTURE_COMPARE_MODE */ ||
            pname === 0x884D /* TEXTURE_COMPARE_FUNC */ ||
            pname === 0x813C /* TEXTURE_BASE_LEVEL */ ||
            pname === 0x813D /* TEXTURE_MAX_LEVEL */ ||
            pname === 0x813B /* TEXTURE_MIN_LOD */ ||
            pname === 0x813A /* TEXTURE_MAX_LOD */;
        if (isWebGL2Pname) {
            this._gl.texParameteri(target, pname, param);
            return;
        }
        super.texParameteri(target, pname, param);
    }

    /**
     * In WebGL2/GLES3 the attribute-0 requirement from WebGL1 does not apply.
     * Override drawArrays to skip the attrib0 hack and call glDrawArrays directly.
     */
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
        if (!this._checkVertexAttribState((count + first - 1) >>> 0)) return;
        this._native2.drawArrays(mode, first, rc);
    }

    /**
     * In WebGL2, UNSIGNED_INT element indices are a core feature — no extension needed.
     * Override drawElements to skip the oes_element_index_uint extension check.
     */
    override drawElements(mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, offset: GLintptr = 0): void {
        if (count < 0 || offset < 0) { this.setError(this.INVALID_VALUE); return; }
        if (!this._checkStencilState()) return;

        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
        if (!elementBuffer) { this.setError(this.INVALID_OPERATION); return; }

        // WebGL2: UNSIGNED_INT is always allowed (core feature, no extension check)
        let elementData = null;
        let adjustedOffset = offset;
        if (type === this.UNSIGNED_SHORT) {
            if (adjustedOffset % 2) { this.setError(this.INVALID_OPERATION); return; }
            adjustedOffset >>= 1;
            elementData = new Uint16Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_INT) {
            if (adjustedOffset % 4) { this.setError(this.INVALID_OPERATION); return; }
            adjustedOffset >>= 2;
            elementData = new Uint32Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements;
        } else {
            this.setError(this.INVALID_ENUM);
            return;
        }

        let reducedCount = count;
        switch (mode) {
            case this.TRIANGLES: if (count % 3) reducedCount -= (count % 3); break;
            case this.LINES: if (count % 2) reducedCount -= (count % 2); break;
            case this.POINTS: break;
            case this.LINE_LOOP: case this.LINE_STRIP: if (count < 2) { this.setError(this.INVALID_OPERATION); return; } break;
            case this.TRIANGLE_FAN: case this.TRIANGLE_STRIP: if (count < 3) { this.setError(this.INVALID_OPERATION); return; } break;
            default: this.setError(this.INVALID_ENUM); return;
        }

        if (!this._framebufferOk()) return;
        if (count === 0) return;

        let maxIndex = 0;
        for (let i = adjustedOffset; i < adjustedOffset + reducedCount; ++i) {
            if (i < elementData.length && elementData[i] > maxIndex) maxIndex = elementData[i];
        }

        if (this._checkVertexAttribState(maxIndex)) {
            this._native2.drawElements(mode, reducedCount, type, offset);
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
        // Update JS-side metadata so _updateFramebufferAttachments / _preCheckFramebufferStatus
        // can see valid dimensions. Without this, w/h stay 0 and the attachment is cleared.
        const texture = this._getTexImage(target);
        if (texture) {
            for (let lvl = 0; lvl < levels; lvl++) {
                texture._levelWidth[lvl] = Math.max(1, width >> lvl);
                texture._levelHeight[lvl] = Math.max(1, height >> lvl);
            }
            texture._format = this.RGBA; // base format; type varies but unused by our completeness check
            texture._type = this.UNSIGNED_BYTE;
        }
    }

    texStorage3D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei, depth: GLsizei): void {
        this._native2.texStorage3D(target, levels, internalformat, width, height, depth);
    }

    // ─── WebGL2 texImage2D / texSubImage2D overrides ─────────────────────
    // The base WebGL1 implementation rejects WebGL2 sized internal formats
    // (e.g. RGBA8, RGB8, SRGB8_ALPHA8) and requires format === internalFormat.
    // WebGL2 allows format !== internalFormat (e.g. internalFormat=RGBA8, format=RGBA).
    // We bypass the WebGL1 validation and delegate directly to the native GL layer
    // which supports all OpenGL ES 3.2 format combinations.

    override texImage2D(target: GLenum, level: GLint, internalFormat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    override texImage2D(target: GLenum, level: GLint, internalFormat: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    override texImage2D(target: GLenum = 0, level: GLint = 0, internalFormat: GLint = 0, formatOrWidth: any = 0, typeOrHeight: any = 0, sourceOrBorder: any = 0, _format: GLenum = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {
        let width: number = 0;
        let height: number = 0;
        let format: number = 0;
        let border: number = 0;

        if (arguments.length === 6) {
            type = typeOrHeight;
            format = formatOrWidth;

            if (sourceOrBorder instanceof GdkPixbuf.Pixbuf) {
                const pixbuf = sourceOrBorder;
                width = pixbuf.get_width();
                height = pixbuf.get_height();
                pixels = pixbuf.get_pixels();
            } else {
                const imageData = extractImageData(sourceOrBorder as TexImageSource);
                if (imageData == null) {
                    throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)');
                }
                width = imageData.width;
                height = imageData.height;
                pixels = imageData.data;
            }
        } else if (arguments.length >= 9) {
            width = formatOrWidth;
            height = typeOrHeight;
            border = sourceOrBorder as GLint;
            format = _format as GLenum;
        }

        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        let data = convertPixels(pixels as ArrayBufferView);

        // UNPACK_FLIP_Y_WEBGL: reverse row order before upload
        if (this._unpackFlipY && data && width > 0 && height > 0) {
            const pixelSize = this._computePixelSize(type, format);
            if (pixelSize > 0) {
                const rowStride = this._computeRowStride(width, pixelSize);
                const flipped = new Uint8Array(data.length);
                for (let row = 0; row < height; row++) {
                    const srcOffset = row * rowStride;
                    const dstOffset = (height - 1 - row) * rowStride;
                    flipped.set(data.subarray(srcOffset, srcOffset + rowStride), dstOffset);
                }
                data = flipped;
            }
        }

        this._saveError();
        this._gl.texImage2D(target, level, internalFormat, width, height, border, format, type, Uint8ArrayToVariant(data));
        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) return;

        texture._levelWidth[level] = width;
        texture._levelHeight[level] = height;
        texture._format = format;
        texture._type = type;

        const activeFramebuffer = this._activeFramebuffer;
        if (activeFramebuffer) {
            let needsUpdate = false;
            const attachments = this._getAttachments();
            for (let i = 0; i < attachments.length; ++i) {
                if (activeFramebuffer._attachments[attachments[i]] === texture) {
                    needsUpdate = true;
                    break;
                }
            }
            if (needsUpdate && this._activeFramebuffer) {
                this._updateFramebufferAttachments(this._activeFramebuffer);
            }
        }
    }

    override texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    override texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    override texSubImage2D(target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, formatOrWidth: any = 0, typeOrHeight: any = 0, sourceOrFormat: any = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {
        let width: number = 0;
        let height: number = 0;
        let format: number = 0;

        if (arguments.length === 7) {
            type = typeOrHeight;
            format = formatOrWidth;

            if (sourceOrFormat instanceof GdkPixbuf.Pixbuf) {
                const pixbuf = sourceOrFormat;
                width = pixbuf.get_width();
                height = pixbuf.get_height();
                pixels = pixbuf.get_pixels();
            } else {
                const imageData = extractImageData(sourceOrFormat as TexImageSource);
                if (imageData == null) {
                    throw new TypeError('texSubImage2D(GLenum, GLint, GLint, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)');
                }
                width = imageData.width;
                height = imageData.height;
                pixels = imageData.data;
            }
        } else {
            width = formatOrWidth;
            height = typeOrHeight;
            format = sourceOrFormat as GLenum;
        }

        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        let data = convertPixels(pixels as ArrayBufferView);
        if (!data) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // UNPACK_FLIP_Y_WEBGL: reverse row order before upload (same as texImage2D)
        if (this._unpackFlipY && data && width > 0 && height > 0) {
            const pixelSize = this._computePixelSize(type, format);
            if (pixelSize > 0) {
                const rowStride = this._computeRowStride(width, pixelSize);
                const flipped = new Uint8Array(data.length);
                for (let row = 0; row < height; row++) {
                    const srcOffset = row * rowStride;
                    const dstOffset = (height - 1 - row) * rowStride;
                    flipped.set(data.subarray(srcOffset, srcOffset + rowStride), dstOffset);
                }
                data = flipped;
            }
        }

        this._gl.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, Uint8ArrayToVariant(data));
    }

    framebufferTextureLayer(target: GLenum, attachment: GLenum, texture: WebGLTexture | null, level: GLint, layer: GLint): void {
        this._native2.framebufferTextureLayer(target, attachment, texture ? (texture as any)._ : 0, level, layer);
    }

    // ─── Instancing & Advanced Draw ───────────────────────────────────────

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        if (first < 0 || count < 0 || instanceCount < 0) { this.setError(this.INVALID_VALUE); return; }
        if (!this._checkStencilState()) return;
        const rc = vertexCount(this, mode, count);
        if (rc < 0) { this.setError(this.INVALID_ENUM); return; }
        if (!this._framebufferOk()) return;
        if (count === 0 || instanceCount === 0) return;
        if (!this._checkVertexAttribState((count + first - 1) >>> 0)) return;
        if ((globalThis as any).__GJSIFY_DEBUG_GL) {
            const n = (this as any).__drawInstCount = ((this as any).__drawInstCount | 0) + 1;
            if (n <= 5 || n % 100 === 0) console.log(`[WebGL] drawArraysInstanced #${n} count=${rc} instances=${instanceCount} fbo=${(this._activeFramebuffer as any)?._ ?? '_gtkFbo'}`);
        }
        this._native2.drawArraysInstanced(mode, first, rc, instanceCount);
    }

    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void {
        if (count < 0 || offset < 0 || instanceCount < 0) { this.setError(this.INVALID_VALUE); return; }
        if (!this._checkStencilState()) return;
        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
        if (!elementBuffer) { this.setError(this.INVALID_OPERATION); return; }

        let elementData: Uint8Array | Uint16Array | Uint32Array | null = null;
        let adjustedOffset = offset;
        if (type === this.UNSIGNED_SHORT) {
            if (adjustedOffset % 2) { this.setError(this.INVALID_OPERATION); return; }
            adjustedOffset >>= 1;
            elementData = new Uint16Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_INT) {
            if (adjustedOffset % 4) { this.setError(this.INVALID_OPERATION); return; }
            adjustedOffset >>= 2;
            elementData = new Uint32Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements;
        } else {
            this.setError(this.INVALID_ENUM);
            return;
        }

        let reducedCount = count;
        switch (mode) {
            case this.TRIANGLES: if (count % 3) reducedCount -= (count % 3); break;
            case this.LINES: if (count % 2) reducedCount -= (count % 2); break;
            case this.POINTS: break;
            case this.LINE_LOOP: case this.LINE_STRIP:
                if (count < 2) { this.setError(this.INVALID_OPERATION); return; }
                break;
            case this.TRIANGLE_FAN: case this.TRIANGLE_STRIP:
                if (count < 3) { this.setError(this.INVALID_OPERATION); return; }
                break;
            default:
                this.setError(this.INVALID_ENUM);
                return;
        }

        if (!this._framebufferOk()) return;
        if (reducedCount === 0 || instanceCount === 0) { this._checkVertexAttribState(0); return; }
        if ((reducedCount + adjustedOffset) >>> 0 > elementData.length) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        let maxIndex = 0;
        for (let i = adjustedOffset; i < adjustedOffset + reducedCount; ++i) {
            if (elementData[i] > maxIndex) maxIndex = elementData[i];
        }
        if (this._checkVertexAttribState(maxIndex)) {
            this._native2.drawElementsInstanced(mode, reducedCount, type, offset, instanceCount);
        }
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this._native2.vertexAttribDivisor(index, divisor);
    }

    vertexAttribIPointer(index: GLuint, size: GLint, type: GLenum, stride: GLsizei, offset: GLintptr): void {
        this._native2.vertexAttribIPointer(index, size, type, stride, offset);
    }

    drawBuffers(buffers: GLenum[]): void {
        // GL_BACK (0x0405) is only valid for the window-system default framebuffer (FBO 0).
        // GtkGLArea uses its own FBO (not FBO 0), so GL_BACK → GL_INVALID_OPERATION.
        // Map GL_BACK → GL_COLOR_ATTACHMENT0 which is the attachment GTK's FBO uses.
        const mapped = buffers.map(b => b === 0x0405 /* GL_BACK */ ? this.COLOR_ATTACHMENT0 : b);
        this._native2.drawBuffers(Array.from(mapped) as number[]);
    }

    drawRangeElements(mode: GLenum, start: GLuint, end: GLuint, count: GLsizei, type: GLenum, offset: GLintptr): void {
        if (count < 0 || offset < 0) { this.setError(this.INVALID_VALUE); return; }
        if (end < start) { this.setError(this.INVALID_VALUE); return; }
        // Delegate to drawElements for full validation.
        // drawRangeElements is just a hint to the driver about the index range.
        this.drawElements(mode, count, type, offset);
    }

    blitFramebuffer(srcX0: GLint, srcY0: GLint, srcX1: GLint, srcY1: GLint, dstX0: GLint, dstY0: GLint, dstX1: GLint, dstY1: GLint, mask: GLbitfield, filter: GLenum): void {
        if ((globalThis as any).__GJSIFY_DEBUG_GL) {
            // Check GL error before blit to isolate issues
            const errBefore = this._gl.getError();
            if (errBefore !== 0) console.log(`[WebGL] blitFramebuffer PRE-ERROR 0x${errBefore.toString(16)}`);
        }
        this._native2.blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter);
        if ((globalThis as any).__GJSIFY_DEBUG_GL) {
            const err = this._gl.getError();
            const n = (this as any).__blitCount = ((this as any).__blitCount | 0) + 1;
            if (n <= 5) console.log(`[WebGL] blitFramebuffer #${n} src=(${srcX0},${srcY0},${srcX1},${srcY1}) readFbo=${(this._activeReadFramebuffer as any)?._  ?? '_gtkFbo'} err=${err === 0 ? 'OK' : '0x' + err.toString(16)}`);
        }
    }

    // clearBuffer{fv,iv,uiv,fi} — WebGL2 methods for clearing specific
    // framebuffer attachments. The native Vala binding does not expose the
    // glClearBuffer* entry points yet, so we emulate the common cases via
    // glClearColor/glClearDepth/glClearStencil + glClear. This is equivalent
    // when the DRAW_FRAMEBUFFER has a single attachment per buffer type,
    // which matches Excalibur's ExcaliburGraphicsContextWebGL.blitToScreen.
    //
    // Buffer target constants per WebGL2 spec (not on our class):
    //   COLOR         = 0x1800
    //   DEPTH         = 0x1801
    //   STENCIL       = 0x1802
    //   DEPTH_STENCIL = 0x84F9

    clearBufferfv(buffer: GLenum, drawbuffer: GLint, values: Float32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as any;
        if (typeof n2.clearBufferfv === 'function') {
            n2.clearBufferfv(buffer, drawbuffer, Array.from(values) as number[]);
            return;
        }
        const v = values as ArrayLike<number>;
        if (buffer === 0x1800 /* COLOR */) {
            const prev = this.getParameter(this.COLOR_CLEAR_VALUE) as Float32Array | number[] | null;
            this.clearColor(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
            this.clear(this.COLOR_BUFFER_BIT);
            if (prev) this.clearColor(prev[0], prev[1], prev[2], prev[3]);
        } else if (buffer === 0x1801 /* DEPTH */) {
            const prev = this.getParameter(this.DEPTH_CLEAR_VALUE) as number | null;
            this.clearDepth(v[0] ?? 1);
            this.clear(this.DEPTH_BUFFER_BIT);
            if (prev !== null) this.clearDepth(prev);
        }
    }

    clearBufferiv(buffer: GLenum, drawbuffer: GLint, values: Int32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as any;
        if (typeof n2.clearBufferiv === 'function') {
            n2.clearBufferiv(buffer, drawbuffer, Array.from(values) as number[]);
            return;
        }
        if (buffer === 0x1802 /* STENCIL */) {
            const v = values as ArrayLike<number>;
            const prev = this.getParameter(this.STENCIL_CLEAR_VALUE) as number | null;
            this.clearStencil(v[0] ?? 0);
            this.clear(this.STENCIL_BUFFER_BIT);
            if (prev !== null) this.clearStencil(prev);
        }
        // Integer color buffers are not emulatable via clearColor — silently no-op.
    }

    clearBufferuiv(buffer: GLenum, drawbuffer: GLint, values: Uint32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as any;
        if (typeof n2.clearBufferuiv === 'function') {
            n2.clearBufferuiv(buffer, drawbuffer, Array.from(values) as number[]);
            return;
        }
        // Unsigned integer color buffers are not emulatable via clearColor —
        // silently no-op.
        void buffer; void drawbuffer;
    }

    clearBufferfi(buffer: GLenum, drawbuffer: GLint, depth: GLfloat, stencil: GLint): void {
        const n2 = this._native2 as any;
        if (typeof n2.clearBufferfi === 'function') {
            n2.clearBufferfi(buffer, drawbuffer, depth, stencil);
            return;
        }
        // Only DEPTH_STENCIL makes sense for this entry point.
        if (buffer === 0x84F9 /* DEPTH_STENCIL */) {
            const prevDepth = this.getParameter(this.DEPTH_CLEAR_VALUE) as number | null;
            const prevStencil = this.getParameter(this.STENCIL_CLEAR_VALUE) as number | null;
            this.clearDepth(depth);
            this.clearStencil(stencil);
            this.clear(this.DEPTH_BUFFER_BIT | this.STENCIL_BUFFER_BIT);
            if (prevDepth !== null) this.clearDepth(prevDepth);
            if (prevStencil !== null) this.clearStencil(prevStencil);
        }
        void drawbuffer;
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

    renderbufferStorageMultisample(target: GLenum, samples: GLsizei, internalFormat: GLenum, width: GLsizei, height: GLsizei): void {
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        const renderbuffer = (this as any)._activeRenderbuffer as WebGLRenderbuffer | null;
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        this._saveError();
        this._native2.renderbufferStorageMultisample(target, samples, internalFormat, width, height);
        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) return;

        renderbuffer._width = width;
        renderbuffer._height = height;
        renderbuffer._format = internalFormat;
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
        const data = (this._gl as any).getUniformi((program as any)._ | 0, (location as any)._ | 0);
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
        // Framebuffer binding queries must return JS-side objects, not native IDs.
        if (pname === 0x8CA6 /* DRAW_FRAMEBUFFER_BINDING */) return this._activeDrawFramebuffer;
        if (pname === 0x8CAA /* READ_FRAMEBUFFER_BINDING */) return this._activeReadFramebuffer;

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

    // ─── WebGL2 overrides for format validation ────────────────────────────

    /**
     * WebGL2 supports ~30+ renderbuffer formats (R8, RG8, RGBA8, RGBA16F,
     * DEPTH_COMPONENT24, DEPTH32F_STENCIL8, etc.). The WebGL1 base class
     * only allows 7 formats. Delegate format validation to native GL.
     */
    override renderbufferStorage(target: GLenum, internalFormat: GLenum, width: GLsizei, height: GLsizei): void {
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        const renderbuffer = (this as any)._activeRenderbuffer as WebGLRenderbuffer | null;
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        if (width < 0 || height < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        // Call native GL directly. Drain prior GL errors so we only check ours.
        while (this._gl.getError() !== this.NO_ERROR) { /* drain */ }
        this._gl.renderbufferStorage(target, internalFormat, width, height);
        if (this._gl.getError() !== this.NO_ERROR) return;

        renderbuffer._width = width;
        renderbuffer._height = height;
        renderbuffer._format = internalFormat;

        const activeFramebuffer = (this as any)._activeFramebuffer;
        if (activeFramebuffer) {
            const attachments = this._getAttachments();
            let needsUpdate = false;
            for (let i = 0; i < attachments.length; ++i) {
                if (activeFramebuffer._attachments[attachments[i]] === renderbuffer) {
                    needsUpdate = true;
                    break;
                }
            }
            if (needsUpdate) this._updateFramebufferAttachments(activeFramebuffer);
        }
    }

    /**
     * WebGL2 makes several WebGL1 extensions part of the core spec.
     * EXT_color_buffer_float and EXT_color_buffer_half_float are always
     * available in WebGL2 contexts. Append them if the base class didn't.
     */
    override getSupportedExtensions(): string[] {
        const exts = super.getSupportedExtensions();
        const ensure = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_half_float'];
        for (const ext of ensure) {
            if (exts.indexOf(ext) === -1) exts.push(ext);
        }
        return exts;
    }

    /**
     * WebGL2 allows reading pixels in many more format/type combinations
     * than WebGL1's strict RGBA/UNSIGNED_BYTE. Delegate validation to native.
     */
    override readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei,
        format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void {
        if (!pixels) return;
        if (width < 0 || height < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        if (!this._framebufferOk()) return;

        // Compute component count from format
        const componentCount =
            (format === 0x1908 /* RGBA */ || format === 0x8058 /* RGBA8 */) ? 4 :
            format === 0x1907 /* RGB */ ? 3 :
            format === 0x8227 /* RG */ ? 2 : 1;
        // Compute bytes per component from type
        const bytesPerComponent =
            type === 0x1406 /* FLOAT */ ? 4 :
            type === 0x140B /* HALF_FLOAT */ || type === 0x8D61 /* HALF_FLOAT_OES */ ? 2 :
            type === 0x1405 /* UNSIGNED_INT */ || type === 0x1404 /* INT */ ? 4 :
            type === 0x1403 /* UNSIGNED_SHORT */ || type === 0x1402 /* SHORT */ ? 2 : 1;
        const byteCount = width * height * componentCount * bytesPerComponent;
        const pixelData = new Uint8Array(byteCount);
        this._saveError();
        const result = this._gl.readPixels(x, y, width, height, format, type, Uint8ArrayToVariant(pixelData));
        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) return;

        // _native.readPixels returns the data written by glReadPixels
        // (GLib.Variant is a copy so glReadPixels writes into the Vala-side buffer;
        //  the return value is the only way to get the data back)
        const src = (result && (result as any).length > 0) ? result as Uint8Array : pixelData;
        if (pixels instanceof Uint8Array) {
            pixels.set(src);
        } else if (pixels instanceof Float32Array) {
            const floatView = new Float32Array((src as Uint8Array).buffer, 0, pixels.length);
            pixels.set(floatView);
        }
    }

    // framebufferTexture2D: inherits from base class. WebGL2 allows level>0 for
    // mipmap attachments, but Three.js only uses level=0. The base class level===0
    // check is acceptable for now. If needed, override to skip level validation.

    /**
     * WebGL2 never blocks draw calls on JS-side framebuffer format checks.
     * The native GL (Mesa/libepoxy) handles completeness and generates
     * INVALID_FRAMEBUFFER_OPERATION for truly incomplete FBOs at draw time.
     * This matches headless-gl's approach: _framebufferOk() always returns true.
     *
     * The base class rejects valid WebGL2 formats (RGBA16F/HALF_FLOAT, depth
     * textures, WebGL2 renderbuffer formats) causing silent rendering failures
     * for postprocessing effects and environment maps.
     */
    override _framebufferOk(): boolean {
        return true;
    }
}
