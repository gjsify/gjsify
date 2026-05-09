// State-management methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 (libgwebgl) — original in webgl-context-base.ts.

import type { WebGLContextBase } from '../webgl-context-base.js';
import { WebGLBuffer } from '../webgl-buffer.js';
import { WebGLFramebuffer } from '../webgl-framebuffer.js';
import { WebGLProgram } from '../webgl-program.js';
import { WebGLRenderbuffer } from '../webgl-renderbuffer.js';
import { WebGLShader } from '../webgl-shader.js';
import { WebGLTexture } from '../webgl-texture.js';

/** Type-only interface that augments WebGLContextBase with the methods this module installs. */
export interface StateMethods {
    enable(cap?: GLenum): void;
    disable(cap?: GLenum): void;
    cullFace(mode: GLenum): void;
    depthFunc(func: GLenum): void;
    depthMask(flag: GLboolean): void;
    depthRange(zNear: GLclampf, zFar: GLclampf): void;
    frontFace(mode?: GLenum): void;
    lineWidth(width: GLfloat): void;
    polygonOffset(factor: GLfloat, units: GLfloat): void;
    sampleCoverage(value: GLclampf, invert: GLboolean): void;
    hint(target?: GLenum, mode?: GLenum): void;
    finish(): void;
    flush(): void;
    blendColor(red?: GLclampf, green?: GLclampf, blue?: GLclampf, alpha?: GLclampf): void;
    blendEquation(mode?: GLenum): void;
    blendEquationSeparate(modeRGB?: GLenum, modeAlpha?: GLenum): void;
    blendFunc(sfactor?: GLenum, dfactor?: GLenum): void;
    blendFuncSeparate(srcRGB?: GLenum, dstRGB?: GLenum, srcAlpha?: GLenum, dstAlpha?: GLenum): void;
    clear(mask?: GLbitfield): void;
    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void;
    clearDepth(depth: GLclampf): void;
    clearStencil(s?: GLint): void;
    colorMask(red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void;
    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void;
    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void;
    stencilMask(mask: GLuint): void;
    stencilMaskSeparate(face: GLenum, mask: GLuint): void;
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void;
    stencilOpSeparate(face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void;
    isEnabled(cap?: GLenum): GLboolean;
    isContextLost(): boolean;
    getError(): GLenum;
    setError(error: GLenum): void;
    isBuffer(buffer: WebGLBuffer): GLboolean;
    isFramebuffer(framebuffer: WebGLFramebuffer): GLboolean;
    isProgram(program: WebGLProgram): GLboolean;
    isRenderbuffer(renderbuffer: WebGLRenderbuffer): GLboolean;
    isShader(shader: WebGLShader): GLboolean;
    isTexture(texture: WebGLTexture): GLboolean;
    generateMipmap(target?: GLenum): void;
    _validBlendFunc(factor: GLenum): boolean;
    _validBlendMode(mode: GLenum): boolean;
    _isConstantBlendFunc(factor: GLenum): boolean;
    _saveError(): void;
    _restoreError(lastError: GLenum): void;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends StateMethods { }
}

const stateMethods: StateMethods & ThisType<WebGLContextBase> = {
    enable(this: WebGLContextBase, cap: GLenum = 0): void {
        this._gl.enable(cap);
    },

    disable(this: WebGLContextBase, cap: GLenum = 0): void {
        this._gl.disable(cap);
        if (cap === this.TEXTURE_2D ||
            cap === this.TEXTURE_CUBE_MAP) {
            const active = this._getActiveTextureUnit();
            if (active._mode === cap) {
                active._mode = 0;
            }
        }
    },

    cullFace(this: WebGLContextBase, mode: GLenum): void {
        this._gl.cullFace(mode | 0);
    },

    depthFunc(this: WebGLContextBase, func: GLenum): void {
        func |= 0;
        switch (func) {
            case this.NEVER:
            case this.LESS:
            case this.EQUAL:
            case this.LEQUAL:
            case this.GREATER:
            case this.NOTEQUAL:
            case this.GEQUAL:
            case this.ALWAYS:
                this._gl.depthFunc(func);
                return;
            default:
                this.setError(this.INVALID_ENUM);
        }
    },

    depthMask(this: WebGLContextBase, flag: GLboolean): void {
        this._gl.depthMask(!!flag);
    },

    depthRange(this: WebGLContextBase, zNear: GLclampf, zFar: GLclampf): void {
        zNear = +zNear;
        zFar = +zFar;
        if (zNear <= zFar) {
            this._gl.depthRange(zNear, zFar);
            return;
        }
        this.setError(this.INVALID_OPERATION);
    },

    frontFace(this: WebGLContextBase, mode: GLenum = 0): void {
        this._gl.frontFace(mode);
    },

    lineWidth(this: WebGLContextBase, width: GLfloat): void {
        if (isNaN(width)) {
            this.setError(this.INVALID_VALUE);
            return;
        }
        this._gl.lineWidth(+width);
    },

    polygonOffset(this: WebGLContextBase, factor: GLfloat, units: GLfloat): void {
        this._gl.polygonOffset(+factor, +units);
    },

    sampleCoverage(this: WebGLContextBase, value: GLclampf, invert: GLboolean): void {
        this._gl.sampleCoverage(+value, !!invert);
    },

    hint(this: WebGLContextBase, target: GLenum = 0, mode: GLenum = 0): void {
        if (!(
            target === this.GENERATE_MIPMAP_HINT ||
            (
                this._extensions.oes_standard_derivatives && target === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES
            )
        )) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (mode !== this.FASTEST &&
            mode !== this.NICEST &&
            mode !== this.DONT_CARE) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        this._gl.hint(target, mode);
    },

    finish(this: WebGLContextBase): void {
        this._gl.finish();
    },

    flush(this: WebGLContextBase): void {
        this._gl.flush();
    },

    blendColor(this: WebGLContextBase, red: GLclampf = 0, green: GLclampf = 0, blue: GLclampf = 0, alpha: GLclampf = 0): void {
        this._gl.blendColor(+red, +green, +blue, +alpha);
    },

    blendEquation(this: WebGLContextBase, mode: GLenum = 0): void {
        if (this._validBlendMode(mode)) {
            this._gl.blendEquation(mode);
            return;
        }
        this.setError(this.INVALID_ENUM);
    },

    blendEquationSeparate(this: WebGLContextBase, modeRGB: GLenum = 0, modeAlpha: GLenum = 0): void {
        if (this._validBlendMode(modeRGB) && this._validBlendMode(modeAlpha)) {
            this._gl.blendEquationSeparate(modeRGB, modeAlpha);
            return;
        }
        this.setError(this.INVALID_ENUM);
    },

    blendFunc(this: WebGLContextBase, sfactor: GLenum = 0, dfactor: GLenum = 0): void {
        if (!this._validBlendFunc(sfactor) ||
            !this._validBlendFunc(dfactor)) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        if (this._isConstantBlendFunc(sfactor) && this._isConstantBlendFunc(dfactor)) {
            this.setError(this.INVALID_OPERATION);
            return;
        }
        this._gl.blendFunc(sfactor, dfactor);
    },

    blendFuncSeparate(this: WebGLContextBase, srcRGB: GLenum = 0, dstRGB: GLenum = 0, srcAlpha: GLenum = 0, dstAlpha: GLenum = 0): void {
        if (!(this._validBlendFunc(srcRGB) &&
            this._validBlendFunc(dstRGB) &&
            this._validBlendFunc(srcAlpha) &&
            this._validBlendFunc(dstAlpha))) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if ((this._isConstantBlendFunc(srcRGB) && this._isConstantBlendFunc(dstRGB)) ||
            (this._isConstantBlendFunc(srcAlpha) && this._isConstantBlendFunc(dstAlpha))) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        this._gl.blendFuncSeparate(
            srcRGB,
            dstRGB,
            srcAlpha,
            dstAlpha);
    },

    clear(this: WebGLContextBase, mask: GLbitfield = 0): void {
        if (!this._framebufferOk()) {
            return;
        }
        this._gl.clear(mask);
    },

    clearColor(this: WebGLContextBase, red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        this._gl.clearColor(+red, +green, +blue, +alpha);
    },

    clearDepth(this: WebGLContextBase, depth: GLclampf): void {
        this._gl.clearDepth(+depth);
    },

    clearStencil(this: WebGLContextBase, s: GLint = 0): void {
        this._checkStencil = false;
        this._gl.clearStencil(s);
    },

    colorMask(this: WebGLContextBase, red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void {
        this._gl.colorMask(!!red, !!green, !!blue, !!alpha);
    },

    stencilFunc(this: WebGLContextBase, func: GLenum, ref: GLint, mask: GLuint): void {
        this._checkStencil = true;
        this._gl.stencilFunc(func | 0, ref | 0, mask | 0);
    },

    stencilFuncSeparate(this: WebGLContextBase, face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void {
        this._checkStencil = true;
        this._gl.stencilFuncSeparate(face | 0, func | 0, ref | 0, mask | 0);
    },

    stencilMask(this: WebGLContextBase, mask: GLuint): void {
        this._checkStencil = true;
        this._gl.stencilMask(mask >>> 0);
    },

    stencilMaskSeparate(this: WebGLContextBase, face: GLenum, mask: GLuint): void {
        this._checkStencil = true;
        this._gl.stencilMaskSeparate(face | 0, mask >>> 0);
    },

    stencilOp(this: WebGLContextBase, fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        this._checkStencil = true;
        this._gl.stencilOp(fail | 0, zfail | 0, zpass | 0);
    },

    stencilOpSeparate(this: WebGLContextBase, face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        this._checkStencil = true;
        this._gl.stencilOpSeparate(face | 0, fail | 0, zfail | 0, zpass | 0);
    },

    isEnabled(this: WebGLContextBase, cap: GLenum = 0): GLboolean {
        return this._gl.isEnabled(cap);
    },

    isContextLost(this: WebGLContextBase): boolean {
        return false;
    },

    getError(this: WebGLContextBase): GLenum {
        return this._gl.getError();
    },

    setError(this: WebGLContextBase, error: GLenum): void {
        this._gl.setError(error);
    },

    isBuffer(this: WebGLContextBase, buffer: WebGLBuffer): GLboolean {
        if (!this._isObject(buffer, 'isBuffer', WebGLBuffer)) return false;
        return this._gl.isBuffer(buffer?._);
    },

    isFramebuffer(this: WebGLContextBase, framebuffer: WebGLFramebuffer): GLboolean {
        if (!this._isObject(framebuffer, 'isFramebuffer', WebGLFramebuffer)) return false;
        return this._gl.isFramebuffer(framebuffer?._);
    },

    isProgram(this: WebGLContextBase, program: WebGLProgram): GLboolean {
        if (!this._isObject(program, 'isProgram', WebGLProgram)) return false;
        return this._gl.isProgram(program?._);
    },

    isRenderbuffer(this: WebGLContextBase, renderbuffer: WebGLRenderbuffer): GLboolean {
        if (!this._isObject(renderbuffer, 'isRenderbuffer', WebGLRenderbuffer)) return false;
        return this._gl.isRenderbuffer(renderbuffer?._);
    },

    isShader(this: WebGLContextBase, shader: WebGLShader): GLboolean {
        if (!this._isObject(shader, 'isShader', WebGLShader)) return false;
        return this._gl.isShader(shader?._);
    },

    isTexture(this: WebGLContextBase, texture: WebGLTexture): GLboolean {
        if (!this._isObject(texture, 'isTexture', WebGLTexture)) return false;
        return this._gl.isTexture(texture?._);
    },

    generateMipmap(this: WebGLContextBase, target: GLenum = 0): void {
        this._gl.generateMipmap(target);
    },

    _validBlendFunc(this: WebGLContextBase, factor: GLenum): boolean {
        return factor === this.ZERO ||
            factor === this.ONE ||
            factor === this.SRC_COLOR ||
            factor === this.ONE_MINUS_SRC_COLOR ||
            factor === this.DST_COLOR ||
            factor === this.ONE_MINUS_DST_COLOR ||
            factor === this.SRC_ALPHA ||
            factor === this.ONE_MINUS_SRC_ALPHA ||
            factor === this.DST_ALPHA ||
            factor === this.ONE_MINUS_DST_ALPHA ||
            factor === this.SRC_ALPHA_SATURATE ||
            factor === this.CONSTANT_COLOR ||
            factor === this.ONE_MINUS_CONSTANT_COLOR ||
            factor === this.CONSTANT_ALPHA ||
            factor === this.ONE_MINUS_CONSTANT_ALPHA;
    },

    _validBlendMode(this: WebGLContextBase, mode: GLenum): boolean {
        return mode === this.FUNC_ADD ||
            mode === this.FUNC_SUBTRACT ||
            mode === this.FUNC_REVERSE_SUBTRACT ||
            (this._extensions.ext_blend_minmax && (
                mode === this._extensions.ext_blend_minmax.MIN_EXT ||
                mode === this._extensions.ext_blend_minmax.MAX_EXT));
    },

    _isConstantBlendFunc(this: WebGLContextBase, factor: GLenum): boolean {
        return (
            factor === this.CONSTANT_COLOR ||
            factor === this.ONE_MINUS_CONSTANT_COLOR ||
            factor === this.CONSTANT_ALPHA ||
            factor === this.ONE_MINUS_CONSTANT_ALPHA);
    },

    _saveError(this: WebGLContextBase): void {
        this._errorStack.push(this.getError());
    },

    _restoreError(this: WebGLContextBase, lastError: GLenum): void {
        const topError = this._errorStack.pop();
        if (topError === this.NO_ERROR) {
            this.setError(lastError);
        } else if (topError !== undefined) {
            this.setError(topError);
        }
    },
};

/** Install state methods on the given prototype. Called from webgl-context-base.ts. */
export function installStateMethods(proto: object): void {
    Object.assign(proto, stateMethods);
}
