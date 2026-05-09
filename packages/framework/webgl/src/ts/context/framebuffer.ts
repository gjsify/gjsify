// Framebuffer/renderbuffer methods for WebGLContextBase.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js
// Reimplemented for GJS using @girs/gwebgl-0.1 — original in webgl-context-base.ts.

import type { WebGLContextBase } from '../webgl-context-base.js';
import { WebGLDrawingBufferWrapper } from '../webgl-drawing-buffer-wrapper.js';
import { WebGLFramebuffer } from '../webgl-framebuffer.js';
import { WebGLRenderbuffer } from '../webgl-renderbuffer.js';
import { WebGLTexture } from '../webgl-texture.js';
import { Uint8ArrayToVariant, checkObject } from '../utils.js';

export interface FramebufferMethods {
    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void;
    bindRenderbuffer(target: GLenum, renderbuffer: WebGLRenderbuffer | null): void;
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbufferTarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void;
    framebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: WebGLTexture | null, level?: GLint): void;
    createFramebuffer(): WebGLFramebuffer | null;
    deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void;
    createRenderbuffer(): WebGLRenderbuffer | null;
    deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void;
    renderbufferStorage(target?: GLenum, internalFormat?: GLenum, width?: GLsizei, height?: GLsizei): void;
    getFramebufferAttachmentParameter(target?: GLenum, attachment?: GLenum, pname?: GLenum): unknown;
    getRenderbufferParameter(target?: GLenum, pname?: GLenum): unknown;
    checkFramebufferStatus(target: GLenum): GLenum;
    _preCheckFramebufferStatus(framebuffer: WebGLFramebuffer): GLenum;
    _framebufferOk(): boolean;
    _validFramebufferAttachment(attachment: GLenum): boolean;
    _updateFramebufferAttachments(framebuffer: WebGLFramebuffer | null): void;
    _tryDetachFramebuffer(framebuffer: WebGLFramebuffer | null, renderbuffer: WebGLRenderbuffer): void;
    _getAttachments(): number[];
    _getColorAttachments(): number[];
    _resizeDrawingBuffer(width: number, height: number): void;
    _allocateDrawingBuffer(width: number, height: number): void;
    resize(width?: number, height?: number): void;
}

declare module '../webgl-context-base.js' {
    interface WebGLContextBase extends FramebufferMethods { }
}

const framebufferMethods: ThisType<WebGLContextBase> & Record<string, Function> = {
    bindFramebuffer(this: WebGLContextBase, target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        if (!checkObject(framebuffer)) {
            throw new TypeError('bindFramebuffer(GLenum, WebGLFramebuffer)');
        }
        if (target !== this.FRAMEBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }
        if (!framebuffer) {
            this._gl.bindFramebuffer(this.FRAMEBUFFER, this._gtkFboId);
        } else if (framebuffer._pendingDelete) {
            return;
        } else if (this._checkWrapper(framebuffer, WebGLFramebuffer)) {
            this._gl.bindFramebuffer(
                this.FRAMEBUFFER,
                framebuffer._ | 0);
        } else {
            return;
        }
        const activeFramebuffer = this._activeFramebuffer;
        if (activeFramebuffer !== framebuffer) {
            if (activeFramebuffer) {
                activeFramebuffer._refCount -= 1;
                activeFramebuffer._checkDelete();
            }
            if (framebuffer) {
                framebuffer._refCount += 1;
            }
        }
        this._activeFramebuffer = framebuffer;
        if (framebuffer) {
            this._updateFramebufferAttachments(framebuffer);
        }
    },

    bindRenderbuffer(this: WebGLContextBase, target: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        if (!checkObject(renderbuffer)) {
            throw new TypeError('bindRenderbuffer(GLenum, WebGLRenderbuffer)');
        }

        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (!renderbuffer) {
            this._gl.bindRenderbuffer(
                target | 0,
                0);
        } else if (renderbuffer._pendingDelete) {
            return;
        } else if (this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
            this._gl.bindRenderbuffer(
                target | 0,
                renderbuffer._ | 0);
        } else {
            return;
        }
        const active = this._activeRenderbuffer;
        if (active !== renderbuffer) {
            if (active) {
                active._refCount -= 1;
                active._checkDelete();
            }
            if (renderbuffer) {
                renderbuffer._refCount += 1;
            }
        }
        this._activeRenderbuffer = renderbuffer;
    },

    framebufferRenderbuffer(this: WebGLContextBase, target: GLenum, attachment: GLenum, renderbufferTarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        if (!checkObject(renderbuffer)) {
            throw new TypeError('framebufferRenderbuffer(GLenum, GLenum, GLenum, WebGLRenderbuffer)');
        }

        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment) ||
            renderbufferTarget !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        const framebuffer = this._activeFramebuffer;
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (renderbuffer && !this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
            return;
        }

        framebuffer._setAttachment(renderbuffer, attachment);
        this._updateFramebufferAttachments(framebuffer);
    },

    framebufferTexture2D(this: WebGLContextBase, target: GLenum, attachment: GLenum, textarget: GLenum, texture: WebGLTexture | null, level: GLint = 0): void {
        target |= 0;
        attachment |= 0;
        textarget |= 0;
        level |= 0;
        if (!checkObject(texture)) {
            throw new TypeError('framebufferTexture2D(GLenum, GLenum, GLenum, WebGLTexture, GLint)');
        }

        // Check parameters are ok
        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        if (level !== 0) {
            this.setError(this.INVALID_VALUE);
            return;
        }

        // Check object ownership
        if (texture && !this._checkWrapper(texture, WebGLTexture)) {
            return;
        }

        // Check texture target is ok
        if (textarget === this.TEXTURE_2D) {
            if (texture && texture._binding !== this.TEXTURE_2D) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
        } else if (this._validCubeTarget(textarget)) {
            if (texture && texture._binding !== this.TEXTURE_CUBE_MAP) {
                this.setError(this.INVALID_OPERATION);
                return;
            }
        } else {
            this.setError(this.INVALID_ENUM);
            return;
        }

        // Check a framebuffer is actually bound
        const framebuffer = this._activeFramebuffer;
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        framebuffer._attachmentLevel[attachment] = level;
        framebuffer._attachmentFace[attachment] = textarget;
        framebuffer._setAttachment(texture, attachment);
        this._updateFramebufferAttachments(framebuffer);
    },

    createFramebuffer(this: WebGLContextBase): WebGLFramebuffer | null {
        const id = this._gl.createFramebuffer();
        if (id <= 0) return null;
        const webGLFramebuffer = new WebGLFramebuffer(id, this);
        this._framebuffers[id] = webGLFramebuffer;
        return webGLFramebuffer;
    },

    deleteFramebuffer(this: WebGLContextBase, framebuffer: WebGLFramebuffer | null): void {
        if (!checkObject(framebuffer)) {
            throw new TypeError('deleteFramebuffer(WebGLFramebuffer)');
        }

        if (!(framebuffer instanceof WebGLFramebuffer &&
            this._checkOwns(framebuffer))) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (this._activeFramebuffer === framebuffer) {
            this.bindFramebuffer(this.FRAMEBUFFER, null);
        }

        framebuffer._pendingDelete = true;
        framebuffer._checkDelete();
    },

    createRenderbuffer(this: WebGLContextBase): WebGLRenderbuffer | null {
        const id = this._gl.createRenderbuffer();
        if (id <= 0) return null;
        const webGLRenderbuffer = new WebGLRenderbuffer(id, this);
        this._renderbuffers[id] = webGLRenderbuffer;
        return webGLRenderbuffer;
    },

    // When a renderbuffer gets deleted, we need to do the following extra steps:
    //   1. Is it bound to the active fbo? If so, then detach it.
    deleteRenderbuffer(this: WebGLContextBase, renderbuffer: WebGLRenderbuffer | null): void {
        if (!checkObject(renderbuffer)) {
            throw new TypeError('deleteRenderbuffer(WebGLRenderbuffer)');
        }

        if (!(renderbuffer instanceof WebGLRenderbuffer &&
            this._checkOwns(renderbuffer))) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (this._activeRenderbuffer === renderbuffer) {
            this.bindRenderbuffer(this.RENDERBUFFER, null);
        }

        const activeFramebuffer = this._activeFramebuffer;

        this._tryDetachFramebuffer(activeFramebuffer, renderbuffer);

        renderbuffer._pendingDelete = true;
        renderbuffer._checkDelete();
    },

    renderbufferStorage(this: WebGLContextBase, target: GLenum = 0, internalFormat: GLenum = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        const renderbuffer = this._activeRenderbuffer;
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION);
            return;
        }

        if (internalFormat !== this.RGBA4 &&
            internalFormat !== this.RGB565 &&
            internalFormat !== this.RGB5_A1 &&
            internalFormat !== this.DEPTH_COMPONENT16 &&
            internalFormat !== this.STENCIL_INDEX &&
            internalFormat !== this.STENCIL_INDEX8 &&
            internalFormat !== this.DEPTH_STENCIL) {
            this.setError(this.INVALID_ENUM);
            return;
        }

        this._saveError();
        this._gl.renderbufferStorage(
            target,
            internalFormat,
            width,
            height);
        const error = this.getError();
        this._restoreError(error);
        if (error !== this.NO_ERROR) {
            return;
        }

        renderbuffer._width = width;
        renderbuffer._height = height;
        renderbuffer._format = internalFormat;

        const activeFramebuffer = this._activeFramebuffer;
        if (activeFramebuffer) {
            let needsUpdate = false;
            const attachments = this._getAttachments();
            for (let i = 0; i < attachments.length; ++i) {
                if (activeFramebuffer._attachments[attachments[i]] === renderbuffer) {
                    needsUpdate = true;
                    break;
                }
            }
            if (needsUpdate) {
                this._updateFramebufferAttachments(this._activeFramebuffer);
            }
        }
    },

    getFramebufferAttachmentParameter(this: WebGLContextBase, target: GLenum = 0, attachment: GLenum = 0, pname: GLenum = 0): unknown {
        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(this.INVALID_ENUM);
            return null;
        }

        const framebuffer = this._activeFramebuffer;
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION);
            return null;
        }

        const object = framebuffer._attachments[attachment];
        if (object === null) {
            if (pname === this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) {
                return this.NONE;
            }
        } else if (object instanceof WebGLTexture) {
            switch (pname) {
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object;
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return this.TEXTURE;
                case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:
                    return framebuffer._attachmentLevel[attachment];
                case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: {
                    const face = framebuffer._attachmentFace[attachment];
                    if (face === this.TEXTURE_2D) {
                        return 0;
                    }
                    return face;
                }
            }
        } else if (object instanceof WebGLRenderbuffer) {
            switch (pname) {
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object;
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return this.RENDERBUFFER;
            }
        }

        this.setError(this.INVALID_ENUM);
        return null;
    },

    getRenderbufferParameter(this: WebGLContextBase, target: GLenum = 0, pname: GLenum = 0): unknown {
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM);
            return null;
        }
        const renderbuffer = this._activeRenderbuffer;
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION);
            return null;
        }
        switch (pname) {
            case this.RENDERBUFFER_INTERNAL_FORMAT:
                return renderbuffer._format;
            case this.RENDERBUFFER_WIDTH:
                return renderbuffer._width;
            case this.RENDERBUFFER_HEIGHT:
                return renderbuffer._height;
            // STATUS.md "Open TODOs": MAX_RENDERBUFFER_SIZE returns the live native limit
            // for now; investigate whether GL_MAX_RENDERBUFFER_SIZE needs JS-side caching
            // (see "WebGL: cache MAX_RENDERBUFFER_SIZE on context init").
            case this.MAX_RENDERBUFFER_SIZE:
            case this.RENDERBUFFER_RED_SIZE:
            case this.RENDERBUFFER_GREEN_SIZE:
            case this.RENDERBUFFER_BLUE_SIZE:
            case this.RENDERBUFFER_ALPHA_SIZE:
            case this.RENDERBUFFER_DEPTH_SIZE:
            case this.RENDERBUFFER_STENCIL_SIZE:
                return this._gl.getRenderbufferParameter(target, pname);
        }
        this.setError(this.INVALID_ENUM);
        return null;
    },

    checkFramebufferStatus(this: WebGLContextBase, target: GLenum): GLenum {
        if (target !== this.FRAMEBUFFER) {
            this.setError(this.INVALID_ENUM);
            return 0;
        }

        const framebuffer = this._activeFramebuffer;
        if (!framebuffer) {
            return this.FRAMEBUFFER_COMPLETE;
        }

        return this._preCheckFramebufferStatus(framebuffer);
    },

    _preCheckFramebufferStatus(this: WebGLContextBase, framebuffer: WebGLFramebuffer): GLenum {
        const attachments = framebuffer._attachments;
        const width: number[] = [];
        const height: number[] = [];
        const depthAttachment = attachments[this.DEPTH_ATTACHMENT];
        const depthStencilAttachment = attachments[this.DEPTH_STENCIL_ATTACHMENT];
        const stencilAttachment = attachments[this.STENCIL_ATTACHMENT];

        if ((depthStencilAttachment && (stencilAttachment || depthAttachment)) ||
            (stencilAttachment && depthAttachment)) {
            return this.FRAMEBUFFER_UNSUPPORTED;
        }

        const colorAttachments = this._getColorAttachments();
        let colorAttachmentCount = 0;
        for (const attachmentEnum in attachments) {
            if (attachments[attachmentEnum] && colorAttachments.indexOf(Number(attachmentEnum)) !== -1) {
                colorAttachmentCount++;
            }
        }
        if (colorAttachmentCount === 0) {
            return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
        }

        if (depthStencilAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED;
        } else if (depthStencilAttachment instanceof WebGLRenderbuffer) {
            if (depthStencilAttachment._format !== this.DEPTH_STENCIL) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
            }
            width.push(depthStencilAttachment._width);
            height.push(depthStencilAttachment._height);
        }

        if (depthAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED;
        } else if (depthAttachment instanceof WebGLRenderbuffer) {
            if (depthAttachment._format !== this.DEPTH_COMPONENT16) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
            }
            width.push(depthAttachment._width);
            height.push(depthAttachment._height);
        }

        if (stencilAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED;
        } else if (stencilAttachment instanceof WebGLRenderbuffer) {
            if (stencilAttachment._format !== this.STENCIL_INDEX8) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
            }
            width.push(stencilAttachment._width);
            height.push(stencilAttachment._height);
        }

        let colorAttached = false;
        for (let i = 0; i < colorAttachments.length; ++i) {
            const colorAttachment = attachments[colorAttachments[i]];
            if (colorAttachment instanceof WebGLTexture) {
                if (colorAttachment._format !== this.RGBA ||
                    !(colorAttachment._type === this.UNSIGNED_BYTE || colorAttachment._type === this.FLOAT)) {
                    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
                }
                colorAttached = true;
                const level = framebuffer._attachmentLevel[this.COLOR_ATTACHMENT0];
                if (level === null) throw new TypeError('level is null!');
                width.push(colorAttachment._levelWidth[level]);
                height.push(colorAttachment._levelHeight[level]);
            } else if (colorAttachment instanceof WebGLRenderbuffer) {
                const format = colorAttachment._format;
                if (format !== this.RGBA4 &&
                    format !== this.RGB565 &&
                    format !== this.RGB5_A1) {
                    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
                }
                colorAttached = true;
                width.push(colorAttachment._width);
                height.push(colorAttachment._height);
            }
        }

        if (!colorAttached &&
            !stencilAttachment &&
            !depthAttachment &&
            !depthStencilAttachment) {
            return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
        }

        if (width.length <= 0 || height.length <= 0) {
            return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }

        for (let i = 1; i < width.length; ++i) {
            if (width[i - 1] !== width[i] ||
                height[i - 1] !== height[i]) {
                return this.FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
            }
        }

        if (width[0] === 0 || height[0] === 0) {
            return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }

        framebuffer._width = width[0];
        framebuffer._height = height[0];

        return this.FRAMEBUFFER_COMPLETE;
    },

    _framebufferOk(this: WebGLContextBase): boolean {
        const framebuffer = this._activeFramebuffer;
        if (framebuffer &&
            this._preCheckFramebufferStatus(framebuffer) !== this.FRAMEBUFFER_COMPLETE) {
            this.setError(this.INVALID_FRAMEBUFFER_OPERATION);
            return false;
        }
        return true;
    },

    _validFramebufferAttachment(this: WebGLContextBase, attachment: GLenum): boolean {
        switch (attachment) {
            case this.DEPTH_ATTACHMENT:
            case this.STENCIL_ATTACHMENT:
            case this.DEPTH_STENCIL_ATTACHMENT:
            case this.COLOR_ATTACHMENT0:
                return true;
        }

        if (this._extensions.webgl_draw_buffers) {
            const { webgl_draw_buffers } = this._extensions;
            return attachment < (webgl_draw_buffers.COLOR_ATTACHMENT0_WEBGL + webgl_draw_buffers._maxDrawBuffers);
        }

        return false;
    },

    _updateFramebufferAttachments(this: WebGLContextBase, framebuffer: WebGLFramebuffer | null): void {
        if (!framebuffer) {
            return;
        }
        const prevStatus = framebuffer._status;
        const attachments = this._getAttachments();
        framebuffer._status = this._preCheckFramebufferStatus(framebuffer);
        if (framebuffer._status !== this.FRAMEBUFFER_COMPLETE) {
            if (prevStatus === this.FRAMEBUFFER_COMPLETE) {
                for (let i = 0; i < attachments.length; ++i) {
                    const attachmentEnum = attachments[i];
                    this._gl.framebufferTexture2D(
                        this.FRAMEBUFFER,
                        attachmentEnum,
                        framebuffer._attachmentFace[attachmentEnum] || 0,
                        0,
                        framebuffer._attachmentLevel[attachmentEnum] || 0);
                }
            }
            return;
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i];
            this._gl.framebufferTexture2D(
                this.FRAMEBUFFER,
                attachmentEnum,
                framebuffer._attachmentFace[attachmentEnum] || 0,
                0,
                framebuffer._attachmentLevel[attachmentEnum] || 0);
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i];
            const attachment = framebuffer._attachments[attachmentEnum];
            if (attachment instanceof WebGLTexture) {
                this._gl.framebufferTexture2D(
                    this.FRAMEBUFFER,
                    attachmentEnum,
                    framebuffer._attachmentFace[attachmentEnum] || 0,
                    attachment._ | 0,
                    framebuffer._attachmentLevel[attachmentEnum] || 0);
            } else if (attachment instanceof WebGLRenderbuffer) {
                this._gl.framebufferRenderbuffer(
                    this.FRAMEBUFFER,
                    attachmentEnum,
                    this.RENDERBUFFER,
                    attachment._ | 0);
            }
        }
    },

    // STATUS.md "Open TODOs": detach the renderbuffer from every framebuffer
    // it might be linked to, not just the active one
    // (see "WebGL: detach renderbuffers from all framebuffers, not just the active one").
    _tryDetachFramebuffer(this: WebGLContextBase, framebuffer: WebGLFramebuffer | null, renderbuffer: WebGLRenderbuffer): void {
        if (framebuffer && framebuffer._linked(renderbuffer)) {
            const attachments = this._getAttachments();
            const framebufferAttachments = Object.keys(framebuffer._attachments);
            for (let i = 0; i < framebufferAttachments.length; ++i) {
                if (framebuffer._attachments[attachments[i]] === renderbuffer) {
                    this.framebufferTexture2D(
                        this.FRAMEBUFFER,
                        attachments[i] | 0,
                        this.TEXTURE_2D,
                        null);
                }
            }
        }
    },

    _getAttachments(this: WebGLContextBase): number[] {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_ATTACHMENTS : this.DEFAULT_ATTACHMENTS;
    },

    _getColorAttachments(this: WebGLContextBase): number[] {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_COLOR_ATTACHMENTS : this.DEFAULT_COLOR_ATTACHMENTS;
    },

    _resizeDrawingBuffer(this: WebGLContextBase, width: number, height: number): void {
        const prevFramebuffer = this._activeFramebuffer;
        const prevTexture = this._getActiveTexture(this.TEXTURE_2D);
        const prevRenderbuffer = this._activeRenderbuffer;

        const contextAttributes = this._contextAttributes;

        const drawingBuffer = this._drawingBuffer;
        if (drawingBuffer?._framebuffer) {
            this._gl.bindFramebuffer(this.FRAMEBUFFER, drawingBuffer?._framebuffer);
        }
        const attachments = this._getAttachments();
        // Clear all attachments
        for (let i = 0; i < attachments.length; ++i) {
            this._gl.framebufferTexture2D(
                this.FRAMEBUFFER,
                attachments[i],
                this.TEXTURE_2D,
                0,
                0);
        }

        // Update color attachment
        if (drawingBuffer?._color) {
            this._gl.bindTexture(this.TEXTURE_2D, drawingBuffer?._color);
        }
        const colorFormat = contextAttributes.alpha ? this.RGBA : this.RGB;
        this._gl.texImage2D(
            this.TEXTURE_2D,
            0,
            colorFormat,
            width,
            height,
            0,
            colorFormat,
            this.UNSIGNED_BYTE,
            Uint8ArrayToVariant(null));
        this._gl.texParameteri(this.TEXTURE_2D, this.TEXTURE_MIN_FILTER, this.NEAREST);
        this._gl.texParameteri(this.TEXTURE_2D, this.TEXTURE_MAG_FILTER, this.NEAREST);
        if (drawingBuffer?._color) {
            this._gl.framebufferTexture2D(
                this.FRAMEBUFFER,
                this.COLOR_ATTACHMENT0,
                this.TEXTURE_2D,
                drawingBuffer?._color,
                0);
        }


        // Update depth-stencil attachments if needed
        let storage = 0;
        let attachment = 0;
        if (contextAttributes.depth && contextAttributes.stencil) {
            storage = this.DEPTH_STENCIL;
            attachment = this.DEPTH_STENCIL_ATTACHMENT;
        } else if (contextAttributes.depth) {
            storage = 0x81A7;
            attachment = this.DEPTH_ATTACHMENT;
        } else if (contextAttributes.stencil) {
            storage = this.STENCIL_INDEX8;
            attachment = this.STENCIL_ATTACHMENT;
        }

        if (storage) {
            if (drawingBuffer?._depthStencil) {
                this._gl.bindRenderbuffer(
                    this.RENDERBUFFER,
                    drawingBuffer?._depthStencil);
            }
            this._gl.renderbufferStorage(
                this.RENDERBUFFER,
                storage,
                width,
                height);
            if (drawingBuffer?._depthStencil) {
                this._gl.framebufferRenderbuffer(
                    this.FRAMEBUFFER,
                    attachment,
                    this.RENDERBUFFER,
                    drawingBuffer?._depthStencil);
            }
        }

        // Restore previous binding state
        this.bindFramebuffer(this.FRAMEBUFFER, prevFramebuffer);
        this.bindTexture(this.TEXTURE_2D, prevTexture);
        this.bindRenderbuffer(this.RENDERBUFFER, prevRenderbuffer);
    },

    _allocateDrawingBuffer(this: WebGLContextBase, width: number, height: number): void {
        this._drawingBuffer = new WebGLDrawingBufferWrapper(
            this._gl.createFramebuffer(),
            this._gl.createTexture(),
            this._gl.createRenderbuffer());

        this._resizeDrawingBuffer(width, height);
    },

    resize(this: WebGLContextBase, width = 0, height = 0): void {
        width = width | 0;
        height = height | 0;
        if (!(width > 0 && height > 0)) {
            throw new Error('Invalid surface dimensions');
        } else if (width !== this.drawingBufferWidth ||
            height !== this.drawingBufferHeight) {
            this._resizeDrawingBuffer(width, height);
        }
    },
};

/** Install framebuffer methods on the given prototype. Called from webgl-context-base.ts. */
export function installFramebufferMethods(proto: object): void {
    Object.assign(proto, framebufferMethods);
}
