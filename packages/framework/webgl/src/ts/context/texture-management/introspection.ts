// Internal texture-introspection helpers for WebGLContextBase — every
// `_`-prefixed helper that other texture methods (lifecycle / tex-image /
// copy-and-compressed / parameters) reach for: active-unit + active-texture
// lookup, target validation, texture-completeness verification, pixel-size /
// row-stride / dimension calculation. Same `install*Methods(proto)` shape
// as the sibling `lifecycle.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';
import type { WebGLTexture } from '../../webgl-texture.js';
import type { WebGLTextureUnit } from '../../webgl-texture-unit.js';
import { formatSize, validCubeTarget } from '../../utils.js';

export interface TextureIntrospectionMethods {
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

declare module '../../webgl-context-base.js' {
    interface WebGLContextBase extends TextureIntrospectionMethods {}
}

const textureIntrospectionMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
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
        return target === this.TEXTURE_2D || target === this.TEXTURE_CUBE_MAP;
    },

    _validCubeTarget(this: WebGLContextBase, target: GLenum): boolean {
        return (
            target === this.TEXTURE_CUBE_MAP_POSITIVE_X ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_X ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Z ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Z
        );
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
        if (
            this._extensions.oes_texture_float &&
            !this._extensions.oes_texture_float_linear &&
            texture &&
            texture._type === this.FLOAT &&
            (pname === this.TEXTURE_MAG_FILTER || pname === this.TEXTURE_MIN_FILTER) &&
            (param === this.LINEAR ||
                param === this.LINEAR_MIPMAP_NEAREST ||
                param === this.NEAREST_MIPMAP_LINEAR ||
                param === this.LINEAR_MIPMAP_LINEAR)
        ) {
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
        if (level < 0 || width < 0 || height < 0) {
            this.setError(this.INVALID_VALUE);
            return false;
        }
        if (target === this.TEXTURE_2D) {
            if (width > this._maxTextureSize || height > this._maxTextureSize || level > this._maxTextureLevel) {
                this.setError(this.INVALID_VALUE);
                return false;
            }
        } else if (this._validCubeTarget(target)) {
            if (width > this._maxCubeMapSize || height > this._maxCubeMapSize || level > this._maxCubeMapLevel) {
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

/** Install internal texture-introspection helpers on the given prototype. Called from texture-management.ts. */
export function installTextureIntrospectionMethods(proto: object): void {
    Object.assign(proto, textureIntrospectionMethods);
}
