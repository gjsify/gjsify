import { Linkable } from './linkable.js';

import type { WebGLContextBase } from './webgl-context-base.js';
// import type { WebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
// Structural placeholder until the WEBGL_draw_buffers extension is implemented;
// `webgl-draw-buffers.ts` will provide a concrete type with these GL enum constants.
type WebGLDrawBuffers = Record<`COLOR_ATTACHMENT${number}_WEBGL`, GLenum>;

export class WebGLFramebuffer extends Linkable implements WebGLFramebuffer {
    _ctx: WebGLContextBase;
    _binding = 0;

    _width = 0;
    _height = 0;
    _status: number | null = null;

    _attachments: Record<GLenum, WebGLTexture | WebGLRenderbuffer | null>;
    _attachmentLevel: Record<GLenum, number | null>;
    _attachmentFace: Record<GLenum, number | null>;

    constructor(_: number, ctx: WebGLContextBase) {
        super(_);
        this._ctx = ctx;

        this._attachments = {};
        this._attachments[ctx.COLOR_ATTACHMENT0] = null;
        this._attachments[ctx.DEPTH_ATTACHMENT] = null;
        this._attachments[ctx.STENCIL_ATTACHMENT] = null;
        this._attachments[ctx.DEPTH_STENCIL_ATTACHMENT] = null;

        this._attachmentLevel = {};
        this._attachmentLevel[ctx.COLOR_ATTACHMENT0] = 0;
        this._attachmentLevel[ctx.DEPTH_ATTACHMENT] = 0;
        this._attachmentLevel[ctx.STENCIL_ATTACHMENT] = 0;
        this._attachmentLevel[ctx.DEPTH_STENCIL_ATTACHMENT] = 0;

        this._attachmentFace = {};
        this._attachmentFace[ctx.COLOR_ATTACHMENT0] = 0;
        this._attachmentFace[ctx.DEPTH_ATTACHMENT] = 0;
        this._attachmentFace[ctx.STENCIL_ATTACHMENT] = 0;
        this._attachmentFace[ctx.DEPTH_STENCIL_ATTACHMENT] = 0;

        if (ctx._extensions.webgl_draw_buffers) {
            const webGLDrawBuffers = ctx._extensions.webgl_draw_buffers as WebGLDrawBuffers;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = null;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = null;
            this._attachments[ctx.NONE] = null;
            this._attachments[ctx.BACK] = null;

            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0;
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0;
            this._attachmentLevel[ctx.NONE] = null;
            this._attachmentLevel[ctx.BACK] = null;

            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0;
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0;
            this._attachmentFace[ctx.NONE] = null;
            this._attachmentFace[ctx.BACK] = null;
        }
    }

    _clearAttachment(attachment: GLenum) {
        const object = this._attachments[attachment];
        if (!object) {
            return;
        }
        this._attachments[attachment] = null;
        // Attachments are always framework subclasses (WebGLTexture/WebGLRenderbuffer extend Linkable)
        // but the public type uses lib.dom's empty-brand `WebGLTexture | WebGLRenderbuffer` interfaces.
        this._unlink(object as unknown as Linkable);
    }

    _setAttachment(object: WebGLTexture | WebGLRenderbuffer | null, attachment: GLenum) {
        const prevObject = this._attachments[attachment];
        if (prevObject === object) {
            return;
        }

        this._clearAttachment(attachment);
        if (!object) {
            return;
        }

        this._attachments[attachment] = object;

        // See _clearAttachment for the cast rationale.
        this._link(object as unknown as Linkable);
    }

    _performDelete() {
        const ctx = this._ctx;
        delete ctx._framebuffers[this._ | 0];
        ctx._gl.deleteFramebuffer(this._ | 0);
    }
}
