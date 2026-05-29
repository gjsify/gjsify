// Copy + compressed-texture methods for WebGLContextBase — `copyTexImage2D`,
// `copyTexSubImage2D`, `compressedTexImage2D`, `compressedTexSubImage2D`.
// Same `install*Methods(proto)` shape as the sibling `lifecycle.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import * as bits from 'bit-twiddle';
import type { WebGLContextBase } from '../../webgl-context-base.js';
import { Uint8ArrayToVariant, arrayToUint8Array } from '../../utils.js';
import type { TypedArray } from '../../types/index.js';

export interface CopyAndCompressedTextureMethods {
    copyTexImage2D(
        target?: GLenum,
        level?: GLint,
        internalFormat?: GLenum,
        x?: GLint,
        y?: GLint,
        width?: GLsizei,
        height?: GLsizei,
        border?: GLint,
    ): void;
    copyTexSubImage2D(
        target?: GLenum,
        level?: GLint,
        xoffset?: GLint,
        yoffset?: GLint,
        x?: GLint,
        y?: GLint,
        width?: GLsizei,
        height?: GLsizei,
    ): void;
    compressedTexImage2D(
        target: GLenum,
        level: GLint,
        internalFormat: GLenum,
        width: GLsizei,
        height: GLsizei,
        border: GLint,
        data: TypedArray,
    ): void;
    compressedTexSubImage2D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        data: TypedArray,
    ): void;
}

declare module '../../webgl-context-base.js' {
    interface WebGLContextBase extends CopyAndCompressedTextureMethods {}
}

const copyAndCompressedTextureMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    copyTexImage2D(
        this: WebGLContextBase,
        target: GLenum = 0,
        level: GLint = 0,
        internalFormat: GLenum = 0,
        x: GLint = 0,
        y: GLint = 0,
        width: GLsizei = 0,
        height: GLsizei = 0,
        border: GLint = 0,
    ): void {
        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (
            internalFormat !== this.RGBA &&
            internalFormat !== this.RGB &&
            internalFormat !== this.ALPHA &&
            internalFormat !== this.LUMINANCE &&
            internalFormat !== this.LUMINANCE_ALPHA
        ) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (level < 0 || width < 0 || height < 0 || border !== 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        if (level > 0 && !(bits.isPow2(width) && bits.isPow2(height))) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        this._saveError();
        this._gl.copyTexImage2D(target, level, internalFormat, x, y, width, height, border);
        const error = this.getError();
        this._restoreError(error);

        if (error === this.NO_ERROR) {
            texture._levelWidth[level] = width;
            texture._levelHeight[level] = height;
            texture._format = this.RGBA;
            texture._type = this.UNSIGNED_BYTE;
        }
    },

    copyTexSubImage2D(
        this: WebGLContextBase,
        target: GLenum = 0,
        level: GLint = 0,
        xoffset: GLint = 0,
        yoffset: GLint = 0,
        x: GLint = 0,
        y: GLint = 0,
        width: GLsizei = 0,
        height: GLsizei = 0,
    ): void {
        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (width < 0 || height < 0 || xoffset < 0 || yoffset < 0 || level < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        this._gl.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    },

    compressedTexImage2D(
        this: WebGLContextBase,
        target: GLenum,
        level: GLint,
        internalFormat: GLenum,
        width: GLsizei,
        height: GLsizei,
        border: GLint,
        data: TypedArray,
    ): void {
        this._gl.compressedTexImage2D(
            target,
            level,
            internalFormat,
            width,
            height,
            border,
            Uint8ArrayToVariant(arrayToUint8Array(data)),
        );
    },

    compressedTexSubImage2D(
        this: WebGLContextBase,
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        data: TypedArray,
    ): void {
        this._gl.compressedTexSubImage2D(
            target,
            level,
            xoffset,
            yoffset,
            width,
            height,
            format,
            Uint8ArrayToVariant(arrayToUint8Array(data)),
        );
    },
};

/** Install copy + compressed texture methods on the given prototype. Called from texture-management.ts. */
export function installCopyAndCompressedTextureMethods(proto: object): void {
    Object.assign(proto, copyAndCompressedTextureMethods);
}
