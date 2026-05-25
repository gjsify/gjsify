// `clearBuffer{fv,iv,uiv,fi}` methods for WebGL2RenderingContext. Same
// `install*Methods(proto)` shape as the sibling `object-lifecycle.ts`
// split — typed `*Methods` interface declaration-merged into
// `WebGL2RenderingContext` plus an `installClearBufferMethods(proto)`
// function that copies the implementations onto the prototype.
//
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2 —
//   glClearBufferfv / glClearBufferiv / glClearBufferuiv / glClearBufferfi
//   section).
// Original: see webgl2-rendering-context.ts pre-split.

import type Gwebgl from '@girs/gwebgl-0.1';
import type { WebGL2RenderingContext } from '../webgl2-rendering-context.js';

/**
 * `clearBuffer{fv,iv,uiv,fi}` only ship in newer Vala bindings of `Gwebgl.WebGL2RenderingContext`.
 * The static GIR types may not include them yet; we feature-detect at runtime, so accept
 * "either present or absent" without falling back to `as any`.
 */
interface OptionalClearBufferNative {
    clearBufferfv?(buffer: GLenum, drawbuffer: GLint, values: number[]): void;
    clearBufferiv?(buffer: GLenum, drawbuffer: GLint, values: number[]): void;
    clearBufferuiv?(buffer: GLenum, drawbuffer: GLint, values: number[]): void;
    clearBufferfi?(buffer: GLenum, drawbuffer: GLint, depth: number, stencil: number): void;
}

export interface ClearBufferMethods {
    clearBufferfv(buffer: GLenum, drawbuffer: GLint, values: Float32List, srcOffset?: GLuint): void;
    clearBufferiv(buffer: GLenum, drawbuffer: GLint, values: Int32List, srcOffset?: GLuint): void;
    clearBufferuiv(buffer: GLenum, drawbuffer: GLint, values: Uint32List, srcOffset?: GLuint): void;
    clearBufferfi(buffer: GLenum, drawbuffer: GLint, depth: GLfloat, stencil: GLint): void;
}

declare module '../webgl2-rendering-context.js' {
    interface WebGL2RenderingContext extends ClearBufferMethods { }
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

const clearBufferMethods: ClearBufferMethods & ThisType<WebGL2RenderingContext> = {

    clearBufferfv(this: WebGL2RenderingContext, buffer: GLenum, drawbuffer: GLint, values: Float32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as Gwebgl.WebGL2RenderingContext & OptionalClearBufferNative;
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
    },

    clearBufferiv(this: WebGL2RenderingContext, buffer: GLenum, drawbuffer: GLint, values: Int32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as Gwebgl.WebGL2RenderingContext & OptionalClearBufferNative;
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
    },

    clearBufferuiv(this: WebGL2RenderingContext, buffer: GLenum, drawbuffer: GLint, values: Uint32List, _srcOffset?: GLuint): void {
        const n2 = this._native2 as Gwebgl.WebGL2RenderingContext & OptionalClearBufferNative;
        if (typeof n2.clearBufferuiv === 'function') {
            n2.clearBufferuiv(buffer, drawbuffer, Array.from(values) as number[]);
            return;
        }
        // Unsigned integer color buffers are not emulatable via clearColor —
        // silently no-op.
        void buffer; void drawbuffer;
    },

    clearBufferfi(this: WebGL2RenderingContext, buffer: GLenum, drawbuffer: GLint, depth: GLfloat, stencil: GLint): void {
        const n2 = this._native2 as Gwebgl.WebGL2RenderingContext & OptionalClearBufferNative;
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
    },
};

/** Install clearBuffer{fv,iv,uiv,fi} methods on WebGL2RenderingContext.prototype. */
export function installClearBufferMethods(proto: object): void {
    Object.assign(proto, clearBufferMethods);
}
