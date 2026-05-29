// Texture lifecycle methods for WebGLContextBase — `createTexture`,
// `deleteTexture`, `activeTexture`, `bindTexture`, `pixelStorei`, plus the
// internal `_detachTextureFromAllFramebuffers` helper that runs as part of
// `deleteTexture`. Same `install*Methods(proto)` shape as the sibling
// `buffer-binding.ts` / `state.ts` splits — typed `*Methods` interface
// declaration-merged into `WebGLContextBase` plus an
// `installTextureLifecycleMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Original: see context/texture-management.ts pre-split.

import type { WebGLContextBase } from '../../webgl-context-base.js';
import { WebGLTexture } from '../../webgl-texture.js';
import { checkObject } from '../../utils.js';

export interface TextureLifecycleMethods {
    activeTexture(texture?: GLenum): void;
    bindTexture(target: GLenum | undefined, texture: WebGLTexture | null): void;
    createTexture(): WebGLTexture | null;
    deleteTexture(texture: WebGLTexture | null): void;
    _detachTextureFromAllFramebuffers(texture: WebGLTexture): void;
    pixelStorei(pname?: GLenum, param?: GLint | GLboolean): void;
}

declare module '../../webgl-context-base.js' {
    interface WebGLContextBase extends TextureLifecycleMethods {}
}

const textureLifecycleMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
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
        } else if (texture instanceof WebGLTexture && texture._pendingDelete) {
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
        this._gl.bindTexture(target, textureId);
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

        // Detach the texture from every framebuffer it is attached to — not just
        // the active one. Per WebGL/OpenGL ES 2.0 §4.4.2.3 the native driver only
        // auto-detaches from the currently bound FBO; any other FBO would otherwise
        // keep a stale attachment that becomes undefined on read after the texture
        // is freed. Browsers (Chrome/Firefox) detach from all FBOs; we mirror that.
        this._detachTextureFromAllFramebuffers(texture);

        // Mark texture for deletion
        texture._pendingDelete = true;
        texture._checkDelete();
    },

    _detachTextureFromAllFramebuffers(this: WebGLContextBase, texture: WebGLTexture): void {
        const activeFramebuffer = this._activeFramebuffer;
        const attachments = this._getAttachments();
        let restoreActive = false;

        for (const idStr in this._framebuffers) {
            const framebuffer = this._framebuffers[idStr];
            if (!framebuffer || !framebuffer._linked(texture)) continue;

            // Bind this FBO so the native framebufferTexture2D call targets it.
            // The active FBO is already bound, so skip the rebind in that case.
            if (framebuffer !== activeFramebuffer) {
                this._gl.bindFramebuffer(this.FRAMEBUFFER, framebuffer._ | 0);
                restoreActive = true;
            }

            for (let i = 0; i < attachments.length; ++i) {
                const attachment = attachments[i];
                if (framebuffer._attachments[attachment] === texture) {
                    // Clear native attachment for the currently bound FBO.
                    this._gl.framebufferTexture2D(
                        this.FRAMEBUFFER,
                        attachment,
                        framebuffer._attachmentFace[attachment] || this.TEXTURE_2D,
                        0,
                        framebuffer._attachmentLevel[attachment] || 0,
                    );
                    // Clear JS-side bookkeeping (updates _refCount + _references).
                    framebuffer._setAttachment(null, attachment);
                }
            }
        }

        // Restore previous binding if we changed it.
        if (restoreActive) {
            this._gl.bindFramebuffer(this.FRAMEBUFFER, activeFramebuffer ? activeFramebuffer._ | 0 : this._gtkFboId);
        }
    },

    pixelStorei(this: WebGLContextBase, pname: GLenum = 0, param: GLint | GLboolean = 0): void {
        if (typeof param === 'boolean') {
            param = param === false ? 0 : 1;
        }
        if (pname === this.UNPACK_ALIGNMENT) {
            if (param === 1 || param === 2 || param === 4 || param === 8) {
                this._unpackAlignment = param;
            } else {
                this.setError(this.INVALID_VALUE);
                return;
            }
        } else if (pname === this.PACK_ALIGNMENT) {
            if (param === 1 || param === 2 || param === 4 || param === 8) {
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
};

/** Install texture-lifecycle methods on the given prototype. Called from texture-management.ts. */
export function installTextureLifecycleMethods(proto: object): void {
    Object.assign(proto, textureLifecycleMethods);
}
