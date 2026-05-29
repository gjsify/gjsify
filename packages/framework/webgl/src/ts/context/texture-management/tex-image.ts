// 2D texture upload methods for WebGLContextBase — `texImage2D` and
// `texSubImage2D`, including the 6-arg-vs-9-arg / 7-arg-vs-9-arg overload
// dispatch, `GdkPixbuf.Pixbuf` + `TexImageSource` source extraction, the
// `UNPACK_PREMULTIPLY_ALPHA_WEBGL` premultiplication step, and the
// `UNPACK_FLIP_Y_WEBGL` row-reverse step. Same `install*Methods(proto)`
// shape as the sibling `lifecycle.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import type { WebGLContextBase } from '../../webgl-context-base.js';
import {
    Uint8ArrayToVariant,
    checkFormat,
    convertPixels,
    extractImageData,
    premultiplyAlpha,
    validCubeTarget,
} from '../../utils.js';

export interface TexImage2DMethods {
    texImage2D(
        target: GLenum,
        level: GLint,
        internalFormat: GLint,
        width: GLsizei,
        height: GLsizei,
        border: GLint,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void;
    texImage2D(
        target: GLenum,
        level: GLint,
        internalFormat: GLint,
        format: GLenum,
        type: GLenum,
        source: TexImageSource | GdkPixbuf.Pixbuf,
    ): void;
    texSubImage2D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
    ): void;
    texSubImage2D(
        target: GLenum,
        level: GLint,
        xoffset: GLint,
        yoffset: GLint,
        format: GLenum,
        type: GLenum,
        source: TexImageSource | GdkPixbuf.Pixbuf,
    ): void;
}

declare module '../../webgl-context-base.js' {
    interface WebGLContextBase extends TexImage2DMethods {}
}

const texImage2DMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    texImage2D(
        this: WebGLContextBase,
        target: GLenum = 0,
        level: GLint = 0,
        internalFormat: GLint = 0,
        formatOrWidth: GLenum | GLsizei = 0,
        typeOrHeight: GLenum | GLsizei = 0,
        sourceOrBorder: TexImageSource | GdkPixbuf.Pixbuf | GLint = 0,
        _format: GLenum = 0,
        type: GLenum = 0,
        pixels?: ArrayBufferView | null,
    ): void {
        let width = 0;
        let height = 0;
        let format = 0;
        let source: TexImageSource;
        let pixbuf: GdkPixbuf.Pixbuf;
        let border = 0;

        if (arguments.length === 6) {
            type = typeOrHeight;
            format = formatOrWidth;

            if (sourceOrBorder instanceof GdkPixbuf.Pixbuf) {
                pixbuf = sourceOrBorder;

                width = pixbuf.get_width();
                height = pixbuf.get_height();
                pixels = pixbuf.get_pixels();
            } else {
                source = sourceOrBorder as TexImageSource;
                const imageData = extractImageData(source);

                if (imageData == null) {
                    throw new TypeError(
                        'texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)',
                    );
                }

                width = imageData.width;
                height = imageData.height;
                pixels = imageData.data;
            }
        } else if (arguments.length === 9) {
            width = formatOrWidth;
            height = typeOrHeight;
            border = sourceOrBorder as GLint;
            format = _format;
            // `type` is already the 8th positional parameter in the 9-arg form — no remap needed.
            pixels = pixels as ArrayBufferView | null;
        }

        if (typeof pixels !== 'object' && pixels !== undefined) {
            throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)');
        }

        if (!checkFormat(this, format) || !checkFormat(this, internalFormat)) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (type === this.FLOAT && !this._extensions.oes_texture_float) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        const texture = this._getTexImage(target);
        if (!texture || format !== internalFormat) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        const pixelSize = this._computePixelSize(type, format);
        if (pixelSize === 0) {
            return;
        }

        if (!this._checkDimensions(target, width, height, level)) {
            return;
        }

        let data = convertPixels(pixels as ArrayBufferView);
        const rowStride = this._computeRowStride(width, pixelSize);
        const imageSize = rowStride * height;

        if (data && data.length < imageSize) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (border !== 0 || (validCubeTarget(this, target) && width !== height)) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        // UNPACK_PREMULTIPLY_ALPHA_WEBGL: premultiply RGB by A before upload.
        // Required for Excalibur's blend mode (gl.ONE, gl.ONE_MINUS_SRC_ALPHA).
        // Without this, transparent PNG background pixels with white RGB bleed
        // through as white rectangles in the rendered output.
        if (this._unpackPremultAlpha && data && format === this.RGBA) {
            data = premultiplyAlpha(data);
        }

        // UNPACK_FLIP_Y_WEBGL: reverse row order before upload
        if (this._unpackFlipY && data && width > 0 && height > 0) {
            const flipped = new Uint8Array(data.length);
            for (let row = 0; row < height; row++) {
                const srcOffset = row * rowStride;
                const dstOffset = (height - 1 - row) * rowStride;
                flipped.set(data.subarray(srcOffset, srcOffset + rowStride), dstOffset);
            }
            data = flipped;
        }

        // Need to check for out of memory error
        this._saveError();

        this._gl.texImage2D(
            target,
            level,
            internalFormat,
            width,
            height,
            border,
            format,
            type,
            Uint8ArrayToVariant(data),
        );

        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) {
            return;
        }

        // Save width and height at level
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
    },

    texSubImage2D(
        this: WebGLContextBase,
        target: GLenum = 0,
        level: GLint = 0,
        xoffset: GLint = 0,
        yoffset: GLint = 0,
        formatOrWidth: GLenum | GLsizei = 0,
        typeOrHeight: GLenum | GLsizei = 0,
        sourceOrFormat: TexImageSource | GdkPixbuf.Pixbuf | GLenum = 0,
        type: GLenum = 0,
        pixels?: ArrayBufferView | null,
    ): void {
        let width = 0;
        let height = 0;
        let format = 0;
        let source: TexImageSource;
        let pixbuf: GdkPixbuf.Pixbuf;

        if (arguments.length === 7) {
            type = typeOrHeight;
            format = formatOrWidth;

            if (sourceOrFormat instanceof GdkPixbuf.Pixbuf) {
                pixbuf = sourceOrFormat;

                width = pixbuf.get_width();
                height = pixbuf.get_height();
                pixels = pixbuf.get_pixels();
            } else {
                source = sourceOrFormat as TexImageSource;
                const imageData = extractImageData(source);

                if (imageData == null) {
                    throw new TypeError(
                        'texSubImage2D(GLenum, GLint, GLint, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)',
                    );
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

        if (typeof pixels !== 'object') {
            throw new TypeError('texSubImage2D(GLenum, GLint, GLint, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)');
        }

        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (type === this.FLOAT && !this._extensions.oes_texture_float) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        const pixelSize = this._computePixelSize(type, format);
        if (pixelSize === 0) {
            return;
        }

        if (!this._checkDimensions(target, width, height, level)) {
            return;
        }

        if (xoffset < 0 || yoffset < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        let data = convertPixels(pixels);
        const rowStride = this._computeRowStride(width, pixelSize);
        const imageSize = rowStride * height;

        if (!data || data.length < imageSize) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        // UNPACK_PREMULTIPLY_ALPHA_WEBGL: premultiply RGB by alpha before upload
        if (this._unpackPremultAlpha && data && format === this.RGBA) {
            data = premultiplyAlpha(data);
        }

        // UNPACK_FLIP_Y_WEBGL: reverse row order before upload (same as texImage2D)
        if (this._unpackFlipY && data && width > 0 && height > 0) {
            const flipped = new Uint8Array(data.length);
            for (let row = 0; row < height; row++) {
                const srcOffset = row * rowStride;
                const dstOffset = (height - 1 - row) * rowStride;
                flipped.set(data.subarray(srcOffset, srcOffset + rowStride), dstOffset);
            }
            data = flipped;
        }

        this._gl.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, Uint8ArrayToVariant(data));
    },
};

/** Install 2D texture-upload methods on the given prototype. Called from texture-management.ts. */
export function installTexImage2DMethods(proto: object): void {
    Object.assign(proto, texImage2DMethods);
}
