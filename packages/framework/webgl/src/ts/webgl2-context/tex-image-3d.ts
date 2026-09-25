// 3D-texture upload methods for WebGL2RenderingContext: texImage3D /
// texSubImage3D / compressedTexImage3D / compressedTexSubImage3D /
// copyTexSubImage3D / texStorage2D / texStorage3D. Same
// `install*Methods(proto)` shape as the sibling `object-lifecycle.ts`
// split — typed `*Methods` interface declaration-merged into
// `WebGL2RenderingContext` plus an `installTexImage3DMethods(proto)`
// function that copies the implementations onto the prototype.
//
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2 — 3D
//   texture upload / texStorage section).
// Original: see webgl2-rendering-context.ts pre-split.

import type { WebGL2RenderingContext } from '../webgl2-rendering-context.js';
import { Uint8ArrayToVariant } from '../utils.js';

export interface TexImage3DMethods {
    texImage3D(
        target: GLenum,
        level: GLint,
        internalformat: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        border: GLint,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void;
    texSubImage3D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void;
    compressedTexImage3D(
        target: GLenum,
        level: GLint,
        internalformat: GLenum,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        border: GLint,
        imageSize: GLsizei,
        data: ArrayBufferView,
    ): void;
    compressedTexSubImage3D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        format: GLenum,
        imageSize: GLsizei,
        data: ArrayBufferView,
    ): void;
    copyTexSubImage3D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
    ): void;
    texStorage2D(target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei): void;
    texStorage3D(
        target: GLenum,
        levels: GLsizei,
        internalformat: GLenum,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
    ): void;
}

declare module '../webgl2-rendering-context.js' {
    interface WebGL2RenderingContext extends TexImage3DMethods {}
}

const texImage3DMethods: TexImage3DMethods & ThisType<WebGL2RenderingContext> = {
    // ─── 3D Textures ──────────────────────────────────────────────────────

    texImage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        level: GLint,
        internalformat: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        border: GLint,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void {
        // The unsized legacy formats are valid 3D/array uploads in WebGL 2 too;
        // a core profile stores them as RED/RG + swizzle (legacy-formats.ts).
        const legacy = internalformat === format ? this._legacyFormatStorage(format, type) : null;
        const nativeInternal = legacy ? legacy.internalFormat : internalformat;
        const nativeFormat = legacy ? legacy.format : format;
        this._saveError();
        if (pixels === null) {
            this._native2.texImage3DNull(
                target,
                level,
                nativeInternal,
                width,
                height,
                depth,
                border,
                nativeFormat,
                type,
            );
        } else {
            this._native2.texImage3D(
                target,
                level,
                nativeInternal,
                width,
                height,
                depth,
                border,
                nativeFormat,
                type,
                Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)),
            );
        }
        const error = this.getError();
        this._restoreError(error);
        // No JS-side record of 3D/array textures exists to say whether this one
        // was swizzled before, so where the emulation runs every upload writes its swizzle.
        if (error === this.NO_ERROR && this._emulatesLegacyFormats()) {
            this._setTextureSwizzle(target, null, legacy ? legacy.swizzle : null);
        }
    },

    texSubImage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void {
        if (pixels === null) return;
        this._native2.texSubImage3D(
            target,
            level,
            xoffset,
            yoffset,
            zoffset,
            width,
            height,
            depth,
            this._legacyFormatStorage(format, type)?.format ?? format,
            type,
            Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)),
        );
    },

    compressedTexImage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        level: GLint,
        internalformat: GLenum,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        border: GLint,
        _imageSize: GLsizei,
        data: ArrayBufferView,
    ): void {
        this._native2.compressedTexImage3D(
            target,
            level,
            internalformat,
            width,
            height,
            depth,
            border,
            Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
        );
    },

    compressedTexSubImage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        format: GLenum,
        _imageSize: GLsizei,
        data: ArrayBufferView,
    ): void {
        this._native2.compressedTexSubImage3D(
            target,
            level,
            xoffset,
            yoffset,
            zoffset,
            width,
            height,
            depth,
            format,
            Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
        );
    },

    copyTexSubImage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        zoffset: GLint,
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
    ): void {
        this._native2.copyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height);
    },

    texStorage2D(
        this: WebGL2RenderingContext,
        target: GLenum,
        levels: GLsizei,
        internalformat: GLenum,
        width: GLsizei,
        height: GLsizei,
    ): void {
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
            // Immutable storage is never a legacy format: drop an emulation swizzle.
            this._setTextureSwizzle(target, texture, null);
        }
    },

    texStorage3D(
        this: WebGL2RenderingContext,
        target: GLenum,
        levels: GLsizei,
        internalformat: GLenum,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
    ): void {
        this._native2.texStorage3D(target, levels, internalformat, width, height, depth);
        // Immutable storage is never a legacy format; see texImage3D for why this always writes.
        if (this._emulatesLegacyFormats()) this._setTextureSwizzle(target, null, null);
    },
};

/** Install 3D texture upload methods on WebGL2RenderingContext.prototype. */
export function installTexImage3DMethods(proto: object): void {
    Object.assign(proto, texImage3DMethods);
}
