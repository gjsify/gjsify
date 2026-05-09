// Texture-management methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import * as bits from 'bit-twiddle';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import type { WebGLContextBase } from '../webgl-context-base.js';
import { WebGLFramebuffer } from '../webgl-framebuffer.js';
import { WebGLTexture } from '../webgl-texture.js';
import { WebGLTextureUnit } from '../webgl-texture-unit.js';
import {
    Uint8ArrayToVariant,
    arrayToUint8Array,
    checkFormat,
    checkObject,
    convertPixels,
    extractImageData,
    formatSize,
    premultiplyAlpha,
    validCubeTarget,
} from '../utils.js';
import type { TypedArray } from '../types/index.js';

export interface TextureManagementMethods {
    activeTexture(texture?: GLenum): void;
    bindTexture(target: GLenum | undefined, texture: WebGLTexture | null): void;
    createTexture(): WebGLTexture | null;
    deleteTexture(texture: WebGLTexture | null): void;
    pixelStorei(pname?: GLenum, param?: GLint | GLboolean): void;
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    copyTexImage2D(target?: GLenum, level?: GLint, internalFormat?: GLenum, x?: GLint, y?: GLint, width?: GLsizei, height?: GLsizei, border?: GLint): void;
    copyTexSubImage2D(target?: GLenum, level?: GLint, xoffset?: GLint, yoffset?: GLint, x?: GLint, y?: GLint, width?: GLsizei, height?: GLsizei): void;
    compressedTexImage2D(target: GLenum, level: GLint, internalFormat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: TypedArray): void;
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: TypedArray): void;
    texParameterf(target?: GLenum, pname?: GLenum, param?: GLfloat): void;
    texParameteri(target?: GLenum, pname?: GLenum, param?: GLint): void;
    getTexParameter(target?: GLenum, pname?: GLenum): unknown;
    _getTexParameterDirect(target?: GLenum, pname?: GLenum): unknown;
    _getActiveTextureUnit(): WebGLTextureUnit;
    _getActiveTexture(target: GLenum): WebGLTexture | null;
    _getTexImage(target: GLenum): WebGLTexture | null;
    _checkTextureTarget(target: GLenum): boolean;
    _validTextureTarget(target: GLenum): boolean;
    _validCubeTarget(target: GLenum): boolean;
    _verifyTextureCompleteness(target: GLenum, pname: GLenum, param: GLenum): void;
    _computePixelSize(type: GLenum, internalFormat: GLenum): number;
    _computeRowStride(width: number, pixelSize: number): number;
    _checkDimensions(target: GLenum, width: GLsizei, height: GLsizei, level: number): boolean;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends TextureManagementMethods { }
}

const textureMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    activeTexture(this: WebGLContextBase, texture: GLenum = 0): void {
        const texNum = texture - this.TEXTURE0;
        if (texNum >= 0 && texNum < this._textureUnits.length) {
            this._activeTextureUnit = texNum;
            this._gl.activeTexture(texture);
            return;
        }

        this.setError(this.INVALID_ENUM);
    },

    bindTexture(this: WebGLContextBase, target: GLenum = 0, texture: WebGLTexture | null): void {
        if (!checkObject(texture)) {
            throw new TypeError('bindTexture(GLenum, WebGLTexture)');
        }

        if (!this._validTextureTarget(target)) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        // Get texture id
        let textureId = 0;
        if (!texture) {
            texture = null;
        } else if (texture instanceof WebGLTexture &&
            texture._pendingDelete) {
            // Special case: error codes for deleted textures don't get set for some dumb reason
            return;
        } else if (this._checkWrapper(texture, WebGLTexture)) {
            // Check binding mode of texture
            if (texture._binding && texture._binding !== target) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
            texture._binding = target;

            if (texture._complete) {
                textureId = texture._ | 0;
            }
        } else {
            return;
        }

        this._saveError();
        this._gl.bindTexture(
            target,
            textureId);
        const error = this.getError();
        this._restoreError(error);

        if (error !== this.NO_ERROR) {
            return;
        }

        const activeUnit = this._getActiveTextureUnit();
        const activeTex = this._getActiveTexture(target);

        // Update references
        if (activeTex !== texture) {
            if (activeTex) {
                activeTex._refCount -= 1;
                activeTex._checkDelete();
            }
            if (texture) {
                texture._refCount += 1;
            }
        }

        if (target === this.TEXTURE_2D) {
            activeUnit._bind2D = texture;
        } else if (target === this.TEXTURE_CUBE_MAP) {
            activeUnit._bindCube = texture;
        }
    },

    createTexture(this: WebGLContextBase): WebGLTexture | null {
        const id = this._gl.createTexture();
        if (id <= 0) return null;
        const webGlTexture = new WebGLTexture(id, this);
        this._textures[id] = webGlTexture;
        return webGlTexture;
    },

    deleteTexture(this: WebGLContextBase, texture: WebGLTexture | null): void {
        if (!checkObject(texture)) {
            throw new TypeError('deleteTexture(WebGLTexture)');
        }

        if (texture instanceof WebGLTexture) {
            if (!this._checkOwns(texture)) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
        } else {
            return;
        }

        // Unbind from all texture units
        const curActive = this._activeTextureUnit;

        for (let i = 0; i < this._textureUnits.length; ++i) {
            const unit = this._textureUnits[i];
            if (unit._bind2D === texture) {
                this.activeTexture(this.TEXTURE0 + i);
                this.bindTexture(this.TEXTURE_2D, null);
            } else if (unit._bindCube === texture) {
                this.activeTexture(this.TEXTURE0 + i);
                this.bindTexture(this.TEXTURE_CUBE_MAP, null);
            }
        }
        this.activeTexture(this.TEXTURE0 + curActive);

        // Detach the texture from the active framebuffer if it is bound there.
        // STATUS.md "Open TODOs": multi-FBO unbinding still has to be wired up
        // (see "WebGL: detach textures from all framebuffers, not just the active one").
        const ctx = this;
        const activeFramebuffer = this._activeFramebuffer;
        const tryDetach = (framebuffer: WebGLFramebuffer | null) => {
            if (framebuffer && framebuffer._linked(texture)) {
                const attachments = ctx._getAttachments();
                for (let i = 0; i < attachments.length; ++i) {
                    const attachment = attachments[i];
                    if (framebuffer._attachments[attachment] === texture) {
                        ctx.framebufferTexture2D(
                            ctx.FRAMEBUFFER,
                            attachment,
                            ctx.TEXTURE_2D,
                            null);
                    }
                }
            }
        };

        tryDetach(activeFramebuffer);

        // Mark texture for deletion
        texture._pendingDelete = true;
        texture._checkDelete();
    },

    pixelStorei(this: WebGLContextBase, pname: GLenum = 0, param: GLint | GLboolean = 0): void {
        if (typeof param === 'boolean') {
            param = param === false ? 0 : 1;
        }
        if (pname === this.UNPACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._unpackAlignment = param;
            } else {
                this.setError(this.INVALID_VALUE);
                return;
            }
        } else if (pname === this.PACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._packAlignment = param;
            } else {
                this.setError(this.INVALID_VALUE);
                return;
            }
        } else if (pname === this.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
            if (!(param === this.NONE || param === this.BROWSER_DEFAULT_WEBGL)) {
                this.setError(this.INVALID_VALUE);
                return;
            }
        } else if (pname === this.UNPACK_FLIP_Y_WEBGL) {
            this._unpackFlipY = !!param;
            return; // WebGL-only flag, not forwarded to native GL
        } else if (pname === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) {
            this._unpackPremultAlpha = !!param;
            return; // not forwarded to native GL — premultiplication is done in JS
        }
        this._gl.pixelStorei(pname, param);
    },

    texImage2D(this: WebGLContextBase, target: GLenum = 0, level: GLint = 0, internalFormat: GLint = 0, formatOrWidth: GLenum | GLsizei = 0, typeOrHeight: GLenum | GLsizei = 0, sourceOrBorder: TexImageSource | GdkPixbuf.Pixbuf | GLint = 0, _format: GLenum = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {
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
                    throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)');
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
            type = type;
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

        if (!this._checkDimensions(
            target,
            width,
            height,
            level)) {
            return;
        }

        let data = convertPixels(pixels as ArrayBufferView);
        const rowStride = this._computeRowStride(width, pixelSize);
        const imageSize = rowStride * height;

        if (data && data.length < imageSize) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (border !== 0 ||
            (validCubeTarget(this, target) && width !== height)) {
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

        this._gl.texImage2D(target, level, internalFormat, width, height, border, format, type, Uint8ArrayToVariant(data));

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

    texSubImage2D(this: WebGLContextBase, target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, formatOrWidth: GLenum | GLsizei = 0, typeOrHeight: GLenum | GLsizei = 0, sourceOrFormat: TexImageSource | GdkPixbuf.Pixbuf | GLenum = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {
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

        if (!this._checkDimensions(
            target,
            width,
            height,
            level)) {
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

        this._gl.texSubImage2D(
            target,
            level,
            xoffset,
            yoffset,
            width,
            height,
            format,
            type,
            Uint8ArrayToVariant(data));
    },

    copyTexImage2D(this: WebGLContextBase, target: GLenum = 0, level: GLint = 0, internalFormat: GLenum = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, border: GLint = 0): void {
        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (internalFormat !== this.RGBA &&
            internalFormat !== this.RGB &&
            internalFormat !== this.ALPHA &&
            internalFormat !== this.LUMINANCE &&
            internalFormat !== this.LUMINANCE_ALPHA) {
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
        this._gl.copyTexImage2D(
            target,
            level,
            internalFormat,
            x,
            y,
            width,
            height,
            border);
        const error = this.getError();
        this._restoreError(error);

        if (error === this.NO_ERROR) {
            texture._levelWidth[level] = width;
            texture._levelHeight[level] = height;
            texture._format = this.RGBA;
            texture._type = this.UNSIGNED_BYTE;
        }
    },

    copyTexSubImage2D(this: WebGLContextBase, target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        const texture = this._getTexImage(target);
        if (!texture) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (width < 0 || height < 0 || xoffset < 0 || yoffset < 0 || level < 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        this._gl.copyTexSubImage2D(
            target,
            level,
            xoffset,
            yoffset,
            x,
            y,
            width,
            height);
    },

    compressedTexImage2D(this: WebGLContextBase, target: GLenum, level: GLint, internalFormat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: TypedArray): void {
        this._gl.compressedTexImage2D(target, level, internalFormat, width, height, border, Uint8ArrayToVariant(arrayToUint8Array(data)));
    },

    compressedTexSubImage2D(this: WebGLContextBase, target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: TypedArray): void {
        this._gl.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, Uint8ArrayToVariant(arrayToUint8Array(data)));
    },

    texParameterf(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0, param: GLfloat): void {
        param = +param;
        if (this._checkTextureTarget(target)) {
            this._verifyTextureCompleteness(target, pname, param);
            switch (pname) {
                case this.TEXTURE_MIN_FILTER:
                case this.TEXTURE_MAG_FILTER:
                case this.TEXTURE_WRAP_S:
                case this.TEXTURE_WRAP_T:
                    this._gl.texParameterf(target, pname, param);
                    return;
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                this._gl.texParameterf(target, pname, param);
                return;
            }

            this.setError(this.INVALID_ENUM);
        }
    },

    texParameteri(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0, param: GLint = 0): void {
        if (this._checkTextureTarget(target)) {
            this._verifyTextureCompleteness(target, pname, param);
            switch (pname) {
                case this.TEXTURE_MIN_FILTER:
                case this.TEXTURE_MAG_FILTER:
                case this.TEXTURE_WRAP_S:
                case this.TEXTURE_WRAP_T:
                    this._gl.texParameteri(target, pname, param);
                    return;
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                this._gl.texParameteri(target, pname, param);
                return;
            }

            this.setError(this.INVALID_ENUM);
        }
    },

    getTexParameter(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0): unknown {
        if (!this._checkTextureTarget(target)) {
            return null;
        }

        const unit = this._getActiveTextureUnit();
        if ((target === this.TEXTURE_2D && !unit._bind2D) ||
            (target === this.TEXTURE_CUBE_MAP && !unit._bindCube)) {
            this.setError(this.INVALID_OPERATION);
            return null;
        }

        switch (pname) {
            case this.TEXTURE_MAG_FILTER:
            case this.TEXTURE_MIN_FILTER:
            case this.TEXTURE_WRAP_S:
            case this.TEXTURE_WRAP_T:
                return this._getTexParameterDirect(target, pname);
        }

        if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
            return this._getTexParameterDirect(target, pname);
        }

        this.setError(this.INVALID_ENUM);
        return null;
    },

    _getTexParameterDirect(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0): unknown {
        return this._gl.getTexParameterx(target, pname)?.unpack();
    },

    _getActiveTextureUnit(this: WebGLContextBase): WebGLTextureUnit {
        return this._textureUnits[this._activeTextureUnit];
    },

    _getActiveTexture(this: WebGLContextBase, target: GLenum): WebGLTexture | null {
        const activeUnit = this._getActiveTextureUnit();
        if (target === this.TEXTURE_2D) {
            return activeUnit._bind2D;
        } else if (target === this.TEXTURE_CUBE_MAP) {
            return activeUnit._bindCube;
        }
        return null;
    },

    _getTexImage(this: WebGLContextBase, target: GLenum): WebGLTexture | null {
        const unit = this._getActiveTextureUnit();
        if (target === this.TEXTURE_2D) {
            return unit._bind2D;
        } else if (validCubeTarget(this, target)) {
            return unit._bindCube;
        }
        this.setError(this.INVALID_ENUM);
        return null;
    },

    _checkTextureTarget(this: WebGLContextBase, target: GLenum): boolean {
        const unit = this._getActiveTextureUnit();
        let tex = null;
        if (target === this.TEXTURE_2D) {
            tex = unit._bind2D;
        } else if (target === this.TEXTURE_CUBE_MAP) {
            tex = unit._bindCube;
        } else {
            this.setError(this.INVALID_ENUM);
            return false;
        }
        if (!tex) {
            this.setError(this.INVALID_OPERATION);
            return false;
        }
        return true;
    },

    _validTextureTarget(this: WebGLContextBase, target: GLenum): boolean {
        return target === this.TEXTURE_2D ||
            target === this.TEXTURE_CUBE_MAP;
    },

    _validCubeTarget(this: WebGLContextBase, target: GLenum): boolean {
        return target === this.TEXTURE_CUBE_MAP_POSITIVE_X ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_X ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Z ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Z;
    },

    _verifyTextureCompleteness(this: WebGLContextBase, target: GLenum, pname: GLenum, param: GLenum): void {
        const unit = this._getActiveTextureUnit();
        let texture: WebGLTexture | null = null;
        if (target === this.TEXTURE_2D) {
            texture = unit._bind2D;
        } else if (this._validCubeTarget(target)) {
            texture = unit._bindCube;
        }

        // oes_texture_float but not oes_texture_float_linear
        if (this._extensions.oes_texture_float && !this._extensions.oes_texture_float_linear && texture && texture._type === this.FLOAT && (pname === this.TEXTURE_MAG_FILTER || pname === this.TEXTURE_MIN_FILTER) && (param === this.LINEAR || param === this.LINEAR_MIPMAP_NEAREST || param === this.NEAREST_MIPMAP_LINEAR || param === this.LINEAR_MIPMAP_LINEAR)) {
            texture._complete = false;
            this.bindTexture(target, texture);
            return;
        }

        if (texture && texture._complete === false) {
            texture._complete = true;
            this.bindTexture(target, texture);
        }
    },

    _computePixelSize(this: WebGLContextBase, type: GLenum, internalFormat: GLenum): number {
        const pixelSize = formatSize(this, internalFormat);
        if (pixelSize === 0) {
            this.setError(this.INVALID_ENUM);
            return 0;
        }
        switch (type) {
            case this.UNSIGNED_BYTE:
                return pixelSize;
            case this.UNSIGNED_SHORT_5_6_5:
                if (internalFormat !== this.RGB) {
                    this.setError(this.INVALID_OPERATION);
                    break;
                }
                return 2;
            case this.UNSIGNED_SHORT_4_4_4_4:
            case this.UNSIGNED_SHORT_5_5_5_1:
                if (internalFormat !== this.RGBA) {
                    this.setError(this.INVALID_OPERATION);
                    break;
                }
                return 2;
            case this.FLOAT:
                return 1;
        }
        this.setError(this.INVALID_ENUM);
        return 0;
    },

    _computeRowStride(this: WebGLContextBase, width: number, pixelSize: number): number {
        let rowStride = width * pixelSize;
        if (rowStride % this._unpackAlignment) {
            rowStride += this._unpackAlignment - (rowStride % this._unpackAlignment);
        }
        return rowStride;
    },

    _checkDimensions(this: WebGLContextBase, target: GLenum, width: GLsizei, height: GLsizei, level: number): boolean {
        if (level < 0 ||
            width < 0 ||
            height < 0) {
            this.setError(this.INVALID_VALUE);
            return false;
        }
        if (target === this.TEXTURE_2D) {
            if (width > this._maxTextureSize ||
                height > this._maxTextureSize ||
                level > this._maxTextureLevel) {
                this.setError(this.INVALID_VALUE);
                return false;
            }
        } else if (this._validCubeTarget(target)) {
            if (width > this._maxCubeMapSize ||
                height > this._maxCubeMapSize ||
                level > this._maxCubeMapLevel) {
                this.setError(this.INVALID_VALUE);
                return false;
            }
        } else {
            this.setError(this.INVALID_ENUM);
            return false;
        }
        return true;
    },
};

/** Install texture-management methods on the given prototype. Called from webgl-context-base.ts. */
export function installTextureManagementMethods(proto: object): void {
    Object.assign(proto, textureMethods);
}
