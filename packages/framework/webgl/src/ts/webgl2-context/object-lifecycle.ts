// Object-lifecycle methods for WebGL2RenderingContext: VAO, Query, Sampler,
// Sync, and Transform Feedback. Same `install*Methods(proto)` shape as the
// parent `WebGLContextBase` split — each group is a typed `*Methods`
// interface declaration-merged into `WebGL2RenderingContext` plus an
// `installObjectLifecycleMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2 — VAO /
//   Query / Sampler / Sync / TransformFeedback section).
// Original: see webgl2-rendering-context.ts pre-split.

import { warnNotImplemented } from '@gjsify/utils';
import type { WebGL2RenderingContext } from '../webgl2-rendering-context.js';
import { WebGLActiveInfo } from '../webgl-active-info.js';
import type { WebGLProgram as OurWebGLProgram } from '../webgl-program.js';
import { WebGLQuery } from '../webgl-query.js';
import { WebGLSampler } from '../webgl-sampler.js';
import { WebGLSync } from '../webgl-sync.js';
import { WebGLTransformFeedback } from '../webgl-transform-feedback.js';
import { WebGLVertexArrayObject } from '../webgl-vertex-array-object.js';

export interface ObjectLifecycleMethods {
    // VAO
    createVertexArray(): WebGLVertexArrayObject | null;
    deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
    isVertexArray(vertexArray: WebGLVertexArrayObject | null): GLboolean;
    bindVertexArray(array: WebGLVertexArrayObject | null): void;
    // Query
    createQuery(): WebGLQuery | null;
    deleteQuery(query: WebGLQuery | null): void;
    isQuery(query: WebGLQuery | null): GLboolean;
    beginQuery(target: GLenum, query: WebGLQuery): void;
    endQuery(target: GLenum): void;
    getQuery(target: GLenum, pname: GLenum): WebGLQuery | null;
    getQueryParameter(query: WebGLQuery, pname: GLenum): any;
    // Sampler
    createSampler(): WebGLSampler | null;
    deleteSampler(sampler: WebGLSampler | null): void;
    isSampler(sampler: WebGLSampler | null): GLboolean;
    bindSampler(unit: GLuint, sampler: WebGLSampler | null): void;
    samplerParameteri(sampler: WebGLSampler, pname: GLenum, param: GLint): void;
    samplerParameterf(sampler: WebGLSampler, pname: GLenum, param: GLfloat): void;
    getSamplerParameter(sampler: WebGLSampler, pname: GLenum): any;
    // Sync
    fenceSync(condition: GLenum, flags: GLbitfield): WebGLSync | null;
    isSync(sync: WebGLSync | null): GLboolean;
    deleteSync(sync: WebGLSync | null): void;
    clientWaitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLuint64): GLenum;
    waitSync(sync: WebGLSync, flags: GLbitfield, timeout: GLint64): void;
    getSyncParameter(sync: WebGLSync, pname: GLenum): any;
    // Transform Feedback
    createTransformFeedback(): WebGLTransformFeedback | null;
    deleteTransformFeedback(tf: WebGLTransformFeedback | null): void;
    isTransformFeedback(tf: WebGLTransformFeedback | null): GLboolean;
    bindTransformFeedback(target: GLenum, tf: WebGLTransformFeedback | null): void;
    beginTransformFeedback(primitiveMode: GLenum): void;
    endTransformFeedback(): void;
    pauseTransformFeedback(): void;
    resumeTransformFeedback(): void;
    transformFeedbackVaryings(program: WebGLProgram, varyings: string[], bufferMode: GLenum): void;
    getTransformFeedbackVarying(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null;
}

declare module '../webgl2-rendering-context.js' {
    interface WebGL2RenderingContext extends ObjectLifecycleMethods { }
}

const objectLifecycleMethods: ObjectLifecycleMethods & ThisType<WebGL2RenderingContext> = {

    // ─── Vertex Array Objects ─────────────────────────────────────────────

    createVertexArray(this: WebGL2RenderingContext): WebGLVertexArrayObject | null {
        const id = this._native2.createVertexArray();
        if (!id) return null;
        const vao = new WebGLVertexArrayObject(id, this);
        this._vertexArrayObjects[id] = vao;
        return vao;
    },

    deleteVertexArray(this: WebGL2RenderingContext, vertexArray: WebGLVertexArrayObject | null): void {
        if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return;
        vertexArray._pendingDelete = true;
        vertexArray._checkDelete();
    },

    isVertexArray(this: WebGL2RenderingContext, vertexArray: WebGLVertexArrayObject | null): GLboolean {
        if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return false;
        return this._native2.isVertexArray(vertexArray._);
    },

    bindVertexArray(this: WebGL2RenderingContext, array: WebGLVertexArrayObject | null): void {
        if (array === null) {
            this._native2.bindVertexArray(0);
            this._vertexObjectState = this._defaultVertexObjectState;
        } else if (array instanceof WebGLVertexArrayObject) {
            this._native2.bindVertexArray(array._);
            this._vertexObjectState = array._objectState;
        } else {
            this.setError(this.INVALID_OPERATION);
        }
    },

    // ─── Query Objects ────────────────────────────────────────────────────

    createQuery(this: WebGL2RenderingContext): WebGLQuery | null {
        const id = this._native2.createQuery();
        if (!id) return null;
        const query = new WebGLQuery(id, this);
        this._queries[id] = query;
        return query;
    },

    deleteQuery(this: WebGL2RenderingContext, query: WebGLQuery | null): void {
        if (!query || !(query instanceof WebGLQuery)) return;
        query._pendingDelete = true;
        query._checkDelete();
    },

    isQuery(this: WebGL2RenderingContext, query: WebGLQuery | null): GLboolean {
        if (!query || !(query instanceof WebGLQuery)) return false;
        return this._native2.isQuery(query._);
    },

    beginQuery(this: WebGL2RenderingContext, target: GLenum, query: WebGLQuery): void {
        if (!(query instanceof WebGLQuery)) return;
        this._native2.beginQuery(target, query._);
    },

    endQuery(this: WebGL2RenderingContext, target: GLenum): void {
        this._native2.endQuery(target);
    },

    getQuery(this: WebGL2RenderingContext, _target: GLenum, _pname: GLenum): WebGLQuery | null {
        warnNotImplemented('WebGL2RenderingContext.getQuery');
        return null;
    },

    getQueryParameter(this: WebGL2RenderingContext, query: WebGLQuery, pname: GLenum): any {
        if (!(query instanceof WebGLQuery)) return null;
        return this._native2.getQueryParameter(query._, pname);
    },

    // ─── Sampler Objects ──────────────────────────────────────────────────

    createSampler(this: WebGL2RenderingContext): WebGLSampler | null {
        const id = this._native2.createSampler();
        if (!id) return null;
        const sampler = new WebGLSampler(id, this);
        this._samplers[id] = sampler;
        return sampler;
    },

    deleteSampler(this: WebGL2RenderingContext, sampler: WebGLSampler | null): void {
        if (!sampler || !(sampler instanceof WebGLSampler)) return;
        sampler._pendingDelete = true;
        sampler._checkDelete();
    },

    isSampler(this: WebGL2RenderingContext, sampler: WebGLSampler | null): GLboolean {
        if (!sampler || !(sampler instanceof WebGLSampler)) return false;
        return this._native2.isSampler(sampler._);
    },

    bindSampler(this: WebGL2RenderingContext, unit: GLuint, sampler: WebGLSampler | null): void {
        this._native2.bindSampler(unit, sampler ? sampler._ : 0);
    },

    samplerParameteri(this: WebGL2RenderingContext, sampler: WebGLSampler, pname: GLenum, param: GLint): void {
        if (!(sampler instanceof WebGLSampler)) return;
        this._native2.samplerParameteri(sampler._, pname, param);
    },

    samplerParameterf(this: WebGL2RenderingContext, sampler: WebGLSampler, pname: GLenum, param: GLfloat): void {
        if (!(sampler instanceof WebGLSampler)) return;
        this._native2.samplerParameterf(sampler._, pname, param);
    },

    getSamplerParameter(this: WebGL2RenderingContext, sampler: WebGLSampler, pname: GLenum): any {
        if (!(sampler instanceof WebGLSampler)) return null;
        // Float params: TEXTURE_MIN_LOD, TEXTURE_MAX_LOD
        if (pname === 0x813A || pname === 0x813B) {
            return this._native2.getSamplerParameterf(sampler._, pname);
        }
        return this._native2.getSamplerParameteri(sampler._, pname);
    },

    // ─── Sync Objects ─────────────────────────────────────────────────────

    fenceSync(this: WebGL2RenderingContext, condition: GLenum, flags: GLbitfield): WebGLSync | null {
        const id = this._native2.fenceSync(condition, flags);
        if (!id) return null;
        const sync = new WebGLSync(id, this);
        this._syncs[id] = sync;
        return sync;
    },

    isSync(this: WebGL2RenderingContext, sync: WebGLSync | null): GLboolean {
        if (!sync || !(sync instanceof WebGLSync)) return false;
        return this._native2.isSync(sync._);
    },

    deleteSync(this: WebGL2RenderingContext, sync: WebGLSync | null): void {
        if (!sync || !(sync instanceof WebGLSync)) return;
        sync._pendingDelete = true;
        sync._checkDelete();
    },

    clientWaitSync(this: WebGL2RenderingContext, sync: WebGLSync, flags: GLbitfield, timeout: GLuint64): GLenum {
        if (!(sync instanceof WebGLSync)) return 0x911C; // WAIT_FAILED
        return this._native2.clientWaitSync(sync._, flags, timeout as unknown as number);
    },

    waitSync(this: WebGL2RenderingContext, sync: WebGLSync, flags: GLbitfield, timeout: GLint64): void {
        if (!(sync instanceof WebGLSync)) return;
        this._native2.waitSync(sync._, flags, timeout as unknown as number);
    },

    getSyncParameter(this: WebGL2RenderingContext, sync: WebGLSync, pname: GLenum): any {
        if (!(sync instanceof WebGLSync)) return null;
        return this._native2.getSyncParameter(sync._, pname);
    },

    // ─── Transform Feedback ───────────────────────────────────────────────

    createTransformFeedback(this: WebGL2RenderingContext): WebGLTransformFeedback | null {
        const id = this._native2.createTransformFeedback();
        if (!id) return null;
        const tf = new WebGLTransformFeedback(id, this);
        this._transformFeedbacks[id] = tf;
        return tf;
    },

    deleteTransformFeedback(this: WebGL2RenderingContext, tf: WebGLTransformFeedback | null): void {
        if (!tf || !(tf instanceof WebGLTransformFeedback)) return;
        tf._pendingDelete = true;
        tf._checkDelete();
    },

    isTransformFeedback(this: WebGL2RenderingContext, tf: WebGLTransformFeedback | null): GLboolean {
        if (!tf || !(tf instanceof WebGLTransformFeedback)) return false;
        return this._native2.isTransformFeedback(tf._);
    },

    bindTransformFeedback(this: WebGL2RenderingContext, target: GLenum, tf: WebGLTransformFeedback | null): void {
        this._native2.bindTransformFeedback(target, tf ? tf._ : 0);
    },

    beginTransformFeedback(this: WebGL2RenderingContext, primitiveMode: GLenum): void {
        this._native2.beginTransformFeedback(primitiveMode);
    },

    endTransformFeedback(this: WebGL2RenderingContext): void {
        this._native2.endTransformFeedback();
    },

    pauseTransformFeedback(this: WebGL2RenderingContext): void {
        this._native2.pauseTransformFeedback();
    },

    resumeTransformFeedback(this: WebGL2RenderingContext): void {
        this._native2.resumeTransformFeedback();
    },

    transformFeedbackVaryings(this: WebGL2RenderingContext, program: WebGLProgram, varyings: string[], bufferMode: GLenum): void {
        this._native2.transformFeedbackVaryings((program as unknown as OurWebGLProgram)._, varyings, bufferMode);
    },

    getTransformFeedbackVarying(this: WebGL2RenderingContext, program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        const result = this._native2.getTransformFeedbackVarying((program as unknown as OurWebGLProgram)._, index)
            .deepUnpack<{ name: string; size: number; type: number }>();
        return new WebGLActiveInfo({ size: result.size, type: result.type, name: result.name });
    },
};

/** Install object-lifecycle methods on WebGL2RenderingContext.prototype. */
export function installObjectLifecycleMethods(proto: object): void {
    Object.assign(proto, objectLifecycleMethods);
}
