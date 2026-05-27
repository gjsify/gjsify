// Instanced-draw + framebuffer-op methods for WebGL2RenderingContext:
// drawArraysInstanced / drawElementsInstanced / vertexAttribDivisor /
// vertexAttribIPointer / drawBuffers / drawRangeElements /
// blitFramebuffer / framebufferTextureLayer / invalidateFramebuffer /
// invalidateSubFramebuffer / readBuffer / renderbufferStorageMultisample.
// Same `install*Methods(proto)` shape as the sibling
// `object-lifecycle.ts` split — typed `*Methods` interface
// declaration-merged into `WebGL2RenderingContext` plus an
// `installInstancedAndFramebufferOpsMethods(proto)` function that copies
// the implementations onto the prototype.
//
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2 —
//   instancing / draw-buffers / blit / framebuffer-attachment-layer /
//   invalidate / readBuffer / renderbufferStorageMultisample section).
// Original: see webgl2-rendering-context.ts pre-split.

import type { WebGL2RenderingContext } from '../webgl2-rendering-context.js';
import type { WebGLTexture } from '../webgl-texture.js';
import { vertexCount } from '../utils.js';

/** Internal debug counters attached to the context instance — opt-in via `globalThis.__GJSIFY_DEBUG_GL = true`. */
interface DebugCounters {
    __drawInstCount?: number;
    __blitCount?: number;
}

/** Read the global debug flag without leaking `any` into call sites. */
function debugGlEnabled(): boolean {
    return (globalThis as { __GJSIFY_DEBUG_GL?: boolean }).__GJSIFY_DEBUG_GL === true;
}

export interface InstancedAndFramebufferOpsMethods {
    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void;
    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void;
    vertexAttribDivisor(index: GLuint, divisor: GLuint): void;
    vertexAttribIPointer(index: GLuint, size: GLint, type: GLenum, stride: GLsizei, offset: GLintptr): void;
    drawBuffers(buffers: GLenum[]): void;
    drawRangeElements(mode: GLenum, start: GLuint, end: GLuint, count: GLsizei, type: GLenum, offset: GLintptr): void;
    blitFramebuffer(
        srcX0: GLint,
        srcY0: GLint,
        srcX1: GLint,
        srcY1: GLint,
        dstX0: GLint,
        dstY0: GLint,
        dstX1: GLint,
        dstY1: GLint,
        mask: GLbitfield,
        filter: GLenum,
    ): void;
    framebufferTextureLayer(
        target: GLenum,
        attachment: GLenum,
        texture: WebGLTexture | null,
        level: GLint,
        layer: GLint,
    ): void;
    invalidateFramebuffer(target: GLenum, attachments: GLenum[]): void;
    invalidateSubFramebuffer(
        target: GLenum,
        attachments: GLenum[],
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
    ): void;
    readBuffer(src: GLenum): void;
    renderbufferStorageMultisample(
        target: GLenum,
        samples: GLsizei,
        internalFormat: GLenum,
        width: GLsizei,
        height: GLsizei,
    ): void;
}

declare module '../webgl2-rendering-context.js' {
    interface WebGL2RenderingContext extends InstancedAndFramebufferOpsMethods {}
}

const instancedAndFramebufferOpsMethods: InstancedAndFramebufferOpsMethods & ThisType<WebGL2RenderingContext> = {
    // ─── Instancing & Advanced Draw ───────────────────────────────────────

    drawArraysInstanced(
        this: WebGL2RenderingContext,
        mode: GLenum,
        first: GLint,
        count: GLsizei,
        instanceCount: GLsizei,
    ): void {
        if (first < 0 || count < 0 || instanceCount < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        if (!this._checkStencilState()) return;
        const rc = vertexCount(this, mode, count);
        if (rc < 0) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        if (!this._framebufferOk()) return;
        if (count === 0 || instanceCount === 0) return;
        if (!this._checkVertexAttribState((count + first - 1) >>> 0)) return;
        if (debugGlEnabled()) {
            const dbg = this as DebugCounters;
            const n = (dbg.__drawInstCount = (dbg.__drawInstCount | 0) + 1);
            if (n <= 5 || n % 100 === 0)
                console.log(
                    `[WebGL] drawArraysInstanced #${n} count=${rc} instances=${instanceCount} fbo=${this._activeFramebuffer?._ ?? '_gtkFbo'}`,
                );
        }
        this._native2.drawArraysInstanced(mode, first, rc, instanceCount);
    },

    drawElementsInstanced(
        this: WebGL2RenderingContext,
        mode: GLenum,
        count: GLsizei,
        type: GLenum,
        offset: GLintptr,
        instanceCount: GLsizei,
    ): void {
        if (count < 0 || offset < 0 || instanceCount < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        if (!this._checkStencilState()) return;
        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
        if (!elementBuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        let elementData: Uint8Array | Uint16Array | Uint32Array | null = null;
        let adjustedOffset = offset;
        if (type === this.UNSIGNED_SHORT) {
            if (adjustedOffset % 2) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
            adjustedOffset >>= 1;
            elementData = new Uint16Array(elementBuffer._elements.buffer);
        } else if (type === this.UNSIGNED_INT) {
            if (adjustedOffset % 4) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
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
            case this.TRIANGLES:
                if (count % 3) reducedCount -= count % 3;
                break;
            case this.LINES:
                if (count % 2) reducedCount -= count % 2;
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

        if (!this._framebufferOk()) return;
        if (reducedCount === 0 || instanceCount === 0) {
            this._checkVertexAttribState(0);
            return;
        }
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
    },

    vertexAttribDivisor(this: WebGL2RenderingContext, index: GLuint, divisor: GLuint): void {
        this._native2.vertexAttribDivisor(index, divisor);
    },

    vertexAttribIPointer(
        this: WebGL2RenderingContext,
        index: GLuint,
        size: GLint,
        type: GLenum,
        stride: GLsizei,
        offset: GLintptr,
    ): void {
        this._native2.vertexAttribIPointer(index, size, type, stride, offset);
    },

    drawBuffers(this: WebGL2RenderingContext, buffers: GLenum[]): void {
        // GL_BACK (0x0405) is only valid for the window-system default framebuffer (FBO 0).
        // GtkGLArea uses its own FBO (not FBO 0), so GL_BACK → GL_INVALID_OPERATION.
        // Map GL_BACK → GL_COLOR_ATTACHMENT0 which is the attachment GTK's FBO uses.
        let hasBack = false;
        for (let i = 0; i < buffers.length; i++) {
            if (buffers[i] === 0x0405) {
                hasBack = true;
                break;
            }
        }
        if (!hasBack) {
            this._native2.drawBuffers(buffers);
            return;
        }
        this._native2.drawBuffers(buffers.map((b) => (b === 0x0405 /* GL_BACK */ ? this.COLOR_ATTACHMENT0 : b)));
    },

    drawRangeElements(
        this: WebGL2RenderingContext,
        mode: GLenum,
        start: GLuint,
        end: GLuint,
        count: GLsizei,
        type: GLenum,
        offset: GLintptr,
    ): void {
        if (count < 0 || offset < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        if (end < start) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        // Delegate to drawElements for full validation.
        // drawRangeElements is just a hint to the driver about the index range.
        this.drawElements(mode, count, type, offset);
    },

    blitFramebuffer(
        this: WebGL2RenderingContext,
        srcX0: GLint,
        srcY0: GLint,
        srcX1: GLint,
        srcY1: GLint,
        dstX0: GLint,
        dstY0: GLint,
        dstX1: GLint,
        dstY1: GLint,
        mask: GLbitfield,
        filter: GLenum,
    ): void {
        if (debugGlEnabled()) {
            // Check GL error before blit to isolate issues
            const errBefore = this._gl.getError();
            if (errBefore !== 0) console.log(`[WebGL] blitFramebuffer PRE-ERROR 0x${errBefore.toString(16)}`);
        }
        this._native2.blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter);
        if (debugGlEnabled()) {
            const err = this._gl.getError();
            const dbg = this as DebugCounters;
            const n = (dbg.__blitCount = (dbg.__blitCount | 0) + 1);
            if (n <= 5)
                console.log(
                    `[WebGL] blitFramebuffer #${n} src=(${srcX0},${srcY0},${srcX1},${srcY1}) readFbo=${this._activeReadFramebuffer?._ ?? '_gtkFbo'} err=${err === 0 ? 'OK' : '0x' + err.toString(16)}`,
                );
        }
    },

    framebufferTextureLayer(
        this: WebGL2RenderingContext,
        target: GLenum,
        attachment: GLenum,
        texture: WebGLTexture | null,
        level: GLint,
        layer: GLint,
    ): void {
        this._native2.framebufferTextureLayer(
            target,
            attachment,
            texture ? (texture as unknown as WebGLTexture)._ : 0,
            level,
            layer,
        );
    },

    invalidateFramebuffer(this: WebGL2RenderingContext, target: GLenum, attachments: GLenum[]): void {
        this._native2.invalidateFramebuffer(target, attachments);
    },

    invalidateSubFramebuffer(
        this: WebGL2RenderingContext,
        target: GLenum,
        attachments: GLenum[],
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
    ): void {
        this._native2.invalidateSubFramebuffer(target, attachments, x, y, width, height);
    },

    readBuffer(this: WebGL2RenderingContext, src: GLenum): void {
        this._native2.readBuffer(src);
    },

    renderbufferStorageMultisample(
        this: WebGL2RenderingContext,
        target: GLenum,
        samples: GLsizei,
        internalFormat: GLenum,
        width: GLsizei,
        height: GLsizei,
    ): void {
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        const renderbuffer = this._activeRenderbuffer;
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
    },
};

/** Install instanced-draw + framebuffer-op methods on WebGL2RenderingContext.prototype. */
export function installInstancedAndFramebufferOpsMethods(proto: object): void {
    Object.assign(proto, instancedAndFramebufferOpsMethods);
}
