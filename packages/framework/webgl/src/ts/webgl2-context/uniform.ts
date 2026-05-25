// Unsigned-integer + non-square matrix uniform methods for
// WebGL2RenderingContext. Same `install*Methods(proto)` shape as the
// sibling `object-lifecycle.ts` split — typed `*Methods` interface
// declaration-merged into `WebGL2RenderingContext` plus an
// `installUniformMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2 —
//   uniform1ui … uniform4uiv / uniformMatrix{2x3,3x2,2x4,4x2,3x4,4x3}fv).
// Original: see webgl2-rendering-context.ts pre-split.

import type { WebGL2RenderingContext } from '../webgl2-rendering-context.js';
import { WebGLUniformLocation } from '../webgl-uniform-location.js';

export interface UniformMethods {
    uniform1ui(location: WebGLUniformLocation | null, v0: GLuint): void;
    uniform2ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint): void;
    uniform3ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint): void;
    uniform4ui(location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint, v3: GLuint): void;
    uniform1uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniform2uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniform3uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniform4uiv(location: WebGLUniformLocation | null, data: Uint32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix2x3fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix3x2fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix2x4fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix4x2fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix3x4fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
    uniformMatrix4x3fv(location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, srcOffset?: GLuint, srcLength?: GLuint): void;
}

declare module '../webgl2-rendering-context.js' {
    interface WebGL2RenderingContext extends UniformMethods { }
}

const uniformMethods: UniformMethods & ThisType<WebGL2RenderingContext> = {

    // ─── Unsigned Integer Uniforms ────────────────────────────────────────

    uniform1ui(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, v0: GLuint): void {
        if (!location) return;
        this._native2.uniform1ui((location as WebGLUniformLocation)._, v0);
    },

    uniform2ui(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint): void {
        if (!location) return;
        this._native2.uniform2ui((location as WebGLUniformLocation)._, v0, v1);
    },

    uniform3ui(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint): void {
        if (!location) return;
        this._native2.uniform3ui((location as WebGLUniformLocation)._, v0, v1, v2);
    },

    uniform4ui(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, v0: GLuint, v1: GLuint, v2: GLuint, v3: GLuint): void {
        if (!location) return;
        this._native2.uniform4ui((location as WebGLUniformLocation)._, v0, v1, v2, v3);
    },

    uniform1uiv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        // TODO: update @girs/gwebgl-0.1 types to accept Uint32Array; cast until then
        this._native2.uniform1uiv((location as WebGLUniformLocation)._, arr.length, arr as unknown as number[]);
    },

    uniform2uiv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform2uiv((location as WebGLUniformLocation)._, arr.length / 2, arr as unknown as number[]);
    },

    uniform3uiv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform3uiv((location as WebGLUniformLocation)._, arr.length / 3, arr as unknown as number[]);
    },

    uniform4uiv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, data: Uint32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Uint32Array ? data : new Uint32Array(data as number[]);
        this._native2.uniform4uiv((location as WebGLUniformLocation)._, arr.length / 4, arr as unknown as number[]);
    },

    // ─── Non-square Matrix Uniforms ───────────────────────────────────────

    uniformMatrix2x3fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        // TODO: update @girs/gwebgl-0.1 types to accept Float32Array; cast until then
        this._native2.uniformMatrix2x3fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },

    uniformMatrix3x2fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix3x2fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },

    uniformMatrix2x4fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix2x4fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },

    uniformMatrix4x2fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix4x2fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },

    uniformMatrix3x4fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix3x4fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },

    uniformMatrix4x3fv(this: WebGL2RenderingContext, location: WebGLUniformLocation | null, transpose: GLboolean, data: Float32List, _srcOffset?: GLuint, _srcLength?: GLuint): void {
        if (!location) return;
        const arr = data instanceof Float32Array ? data : new Float32Array(data as number[]);
        this._native2.uniformMatrix4x3fv((location as WebGLUniformLocation)._, transpose, arr as unknown as number[]);
    },
};

/** Install unsigned-integer + non-square matrix uniform methods on WebGL2RenderingContext.prototype. */
export function installUniformMethods(proto: object): void {
    Object.assign(proto, uniformMethods);
}
