// Texture-parameter methods for WebGLContextBase — `texParameterf`,
// `texParameteri`, `getTexParameter`, plus the `_getTexParameterDirect`
// helper that bypasses the parameter-validation switch and reads straight
// from the native GL. Same `install*Methods(proto)` shape as the sibling
// `lifecycle.ts` split.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';

export interface TextureParameterMethods {
    texParameterf(target?: GLenum, pname?: GLenum, param?: GLfloat): void;
    texParameteri(target?: GLenum, pname?: GLenum, param?: GLint): void;
    getTexParameter(target?: GLenum, pname?: GLenum): unknown;
    _getTexParameterDirect(target?: GLenum, pname?: GLenum): unknown;
}

declare module '../../webgl-context-base.js' {
    interface WebGLContextBase extends TextureParameterMethods {}
}

const textureParameterMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
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

            const anisoExt = this._extensions.ext_texture_filter_anisotropic as
                | { TEXTURE_MAX_ANISOTROPY_EXT: GLenum }
                | undefined;
            if (anisoExt && pname === anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) {
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

            const anisoExt = this._extensions.ext_texture_filter_anisotropic as
                | { TEXTURE_MAX_ANISOTROPY_EXT: GLenum }
                | undefined;
            if (anisoExt && pname === anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) {
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
        if ((target === this.TEXTURE_2D && !unit._bind2D) || (target === this.TEXTURE_CUBE_MAP && !unit._bindCube)) {
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

        const anisoExt = this._extensions.ext_texture_filter_anisotropic as
            | { TEXTURE_MAX_ANISOTROPY_EXT: GLenum }
            | undefined;
        if (anisoExt && pname === anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) {
            return this._getTexParameterDirect(target, pname);
        }

        this.setError(this.INVALID_ENUM);
        return null;
    },

    _getTexParameterDirect(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0): unknown {
        return this._gl.getTexParameterx(target, pname)?.unpack();
    },
};

/** Install texture-parameter methods on the given prototype. Called from texture-management.ts. */
export function installTextureParameterMethods(proto: object): void {
    Object.assign(proto, textureParameterMethods);
}
