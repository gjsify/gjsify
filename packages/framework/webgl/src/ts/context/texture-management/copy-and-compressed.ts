// Copy + compressed-texture methods for WebGLContextBase — `copyTexImage2D`,
// `copyTexSubImage2D`, `compressedTexImage2D`, `compressedTexSubImage2D`.
// Same `install*Methods(proto)` shape as the sibling `lifecycle.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import * as bits from 'bit-twiddle';
import type GLib from '@girs/glib-2.0';
import type { WebGLContextBase } from '../../webgl-context-base.js';
import { Uint8ArrayToVariant, arrayToUint8Array } from '../../utils.js';
import type { TypedArray } from '../../types/index.js';
import {
    coreStorageForLegacyFormat,
    extractLegacyChannels,
    isLegacyFormat,
    type LegacyFormatStorage,
} from './legacy-formats.js';

const RGBA = 0x1908;
const UNSIGNED_BYTE = 0x1401;
const READ_FRAMEBUFFER = 0x8ca8;
const FRAMEBUFFER_COMPLETE = 0x8cd5;
const INVALID_FRAMEBUFFER_OPERATION = 0x0506;
const PIXEL_PACK_BUFFER = 0x88eb;
const PIXEL_UNPACK_BUFFER = 0x88ec;
const PIXEL_PACK_BUFFER_BINDING = 0x88ed;
const PIXEL_UNPACK_BUFFER_BINDING = 0x88ef;

/**
 * Pixel-store state the readback copy pins for its own two transfers — every
 * value a consumer (WebGL 2 exposes all of them) may have left set that would
 * reshape a tightly packed RGBA read or R/RG upload. Restored afterwards.
 */
const PINNED_PIXEL_STORE: ReadonlyArray<readonly [number, number]> = [
    [0x0d05 /* PACK_ALIGNMENT */, 4],
    [0x0d02 /* PACK_ROW_LENGTH */, 0],
    [0x0d03 /* PACK_SKIP_ROWS */, 0],
    [0x0d04 /* PACK_SKIP_PIXELS */, 0],
    [0x0cf5 /* UNPACK_ALIGNMENT */, 1],
    [0x0cf2 /* UNPACK_ROW_LENGTH */, 0],
    [0x0cf3 /* UNPACK_SKIP_ROWS */, 0],
    [0x0cf4 /* UNPACK_SKIP_PIXELS */, 0],
];

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
    _copyLegacyChannels(
        format: GLenum,
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
        upload: (storage: LegacyFormatStorage, channels: GLib.Variant) => void,
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

        // A core profile has no legacy formats (legacy-formats.ts). LUMINANCE is
        // the framebuffer's RED, which a native copy into R8 already takes; ALPHA
        // and LUMINANCE_ALPHA need the framebuffer's ALPHA in the R/G slot, which
        // no copy can move, so those go through a readback.
        const legacy = this._legacyFormatStorage(internalFormat, this.UNSIGNED_BYTE);

        this._saveError();
        if (legacy && internalFormat !== this.LUMINANCE) {
            this._copyLegacyChannels(internalFormat, x, y, width, height, (storage, channels) =>
                this._gl.texImage2D(
                    target,
                    level,
                    storage.internalFormat,
                    width,
                    height,
                    0,
                    storage.format,
                    UNSIGNED_BYTE,
                    channels,
                ),
            );
        } else {
            this._gl.copyTexImage2D(
                target,
                level,
                legacy ? legacy.internalFormat : internalFormat,
                x,
                y,
                width,
                height,
                border,
            );
        }
        const error = this.getError();
        this._restoreError(error);

        if (error === this.NO_ERROR) {
            texture._levelWidth[level] = width;
            texture._levelHeight[level] = height;
            // Record a legacy format as itself: WebGL says it is not color-renderable
            // (on every context), and emulated RED/RG storage would pass as if it were.
            texture._format = isLegacyFormat(internalFormat) ? internalFormat : this.RGBA;
            texture._type = this.UNSIGNED_BYTE;
            this._setTextureSwizzle(target, texture, legacy ? legacy.swizzle : null);
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

        // Into emulated ALPHA / LUMINANCE_ALPHA storage the framebuffer's ALPHA
        // must land in R/G — see copyTexImage2D.
        if (
            (texture._format === this.ALPHA || texture._format === this.LUMINANCE_ALPHA) &&
            this._legacyFormatStorage(texture._format, this.UNSIGNED_BYTE)
        ) {
            this._copyLegacyChannels(texture._format, x, y, width, height, (storage, channels) =>
                this._gl.texSubImage2D(
                    target,
                    level,
                    xoffset,
                    yoffset,
                    width,
                    height,
                    storage.format,
                    UNSIGNED_BYTE,
                    channels,
                ),
            );
            return;
        }

        this._gl.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    },

    /**
     * Copy a framebuffer region into core-profile legacy-format storage by
     * reading it back as RGBA and handing the legacy channels, in the RED/RG
     * layout, to `upload` — the one copy the driver cannot do, since it only
     * ever moves R→R and G→G. `upload` specifies or updates the image (2D or
     * 3D) with the pixel-store state pinned to tight packing. Reads through
     * `readPixels`, so a WebGL 1 region outside the framebuffer copies zeros,
     * as WebGL requires of copyTex*Image2D.
     */
    _copyLegacyChannels(
        this: WebGLContextBase,
        format: GLenum,
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
        upload: (storage: LegacyFormatStorage, channels: GLib.Variant) => void,
    ): void {
        const storage = isLegacyFormat(format) ? coreStorageForLegacyFormat(format, UNSIGNED_BYTE) : null;
        if (!storage) return;
        // The copy would have raised this itself; readPixels only logs.
        if (this._gl.checkFramebufferStatus(READ_FRAMEBUFFER) !== FRAMEBUFFER_COMPLETE) {
            this.setError(INVALID_FRAMEBUFFER_OPERATION);
            return;
        }

        // A bound pack/unpack buffer (WebGL 2) would turn both transfers into
        // buffer offsets; pin it and the pixel-store state, restore after.
        const packBuffer = this._gl.getParameteri(PIXEL_PACK_BUFFER_BINDING);
        const unpackBuffer = this._gl.getParameteri(PIXEL_UNPACK_BUFFER_BINDING);
        const saved = PINNED_PIXEL_STORE.map(([pname]) => this._gl.getParameteri(pname));
        const savedPackAlignment = this._packAlignment;
        if (packBuffer) this._gl.bindBuffer(PIXEL_PACK_BUFFER, 0);
        if (unpackBuffer) this._gl.bindBuffer(PIXEL_UNPACK_BUFFER, 0);
        for (const [pname, value] of PINNED_PIXEL_STORE) this._gl.pixelStorei(pname, value);
        // readPixels strides the destination by the JS-side pack alignment.
        this._packAlignment = 4;
        try {
            const rgba = new Uint8Array(Math.max(0, width * height * 4));
            if (rgba.length > 0) this.readPixels(x, y, width, height, RGBA, UNSIGNED_BYTE, rgba);
            upload(storage, Uint8ArrayToVariant(extractLegacyChannels(rgba, format)));
        } finally {
            this._packAlignment = savedPackAlignment;
            PINNED_PIXEL_STORE.forEach(([pname], i) => this._gl.pixelStorei(pname, saved[i]));
            if (packBuffer) this._gl.bindBuffer(PIXEL_PACK_BUFFER, packBuffer);
            if (unpackBuffer) this._gl.bindBuffer(PIXEL_UNPACK_BUFFER, unpackBuffer);
        }
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
        this._saveError();
        this._gl.compressedTexImage2D(
            target,
            level,
            internalFormat,
            width,
            height,
            border,
            Uint8ArrayToVariant(arrayToUint8Array(data)),
        );
        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) return;
        // The image is no legacy format any more: drop the record and the
        // emulation swizzle a former ALPHA/LUMINANCE image left (texImage2D).
        const texture = this._getTexImage(target);
        if (texture) {
            texture._format = internalFormat;
            this._setTextureSwizzle(target, texture, null);
        }
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
