import { Linkable } from './linkable.js'
// import { gl } from './native-gl.js'

import type { GjsifyWebGLRenderingContext } from './webgl-rendering-context.js';
// import type { WebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
type WebGLDrawBuffers = any;

export class GjsifyWebGLFramebuffer extends Linkable implements WebGLFramebuffer {

    _ctx: GjsifyWebGLRenderingContext;
    _binding = 0

    _width = 0
    _height = 0
    _status: number | null = null

    _attachments: Record<GLenum, WebGLTexture | WebGLRenderbuffer | null>;
    _attachmentLevel: Record<GLenum, number | null>;
    _attachmentFace: Record<GLenum, number | null>;

    constructor(_: WebGLFramebuffer & number, ctx: GjsifyWebGLRenderingContext) {
        super(_)
        this._ctx = ctx

        this._attachments = {}
        this._attachments[ctx.COLOR_ATTACHMENT0] = null
        this._attachments[ctx.DEPTH_ATTACHMENT] = null
        this._attachments[ctx.STENCIL_ATTACHMENT] = null
        this._attachments[ctx.DEPTH_STENCIL_ATTACHMENT] = null

        this._attachmentLevel = {}
        this._attachmentLevel[ctx.COLOR_ATTACHMENT0] = 0
        this._attachmentLevel[ctx.DEPTH_ATTACHMENT] = 0
        this._attachmentLevel[ctx.STENCIL_ATTACHMENT] = 0
        this._attachmentLevel[ctx.DEPTH_STENCIL_ATTACHMENT] = 0

        this._attachmentFace = {}
        this._attachmentFace[ctx.COLOR_ATTACHMENT0] = 0
        this._attachmentFace[ctx.DEPTH_ATTACHMENT] = 0
        this._attachmentFace[ctx.STENCIL_ATTACHMENT] = 0
        this._attachmentFace[ctx.DEPTH_STENCIL_ATTACHMENT] = 0

        if (ctx._extensions.webgl_draw_buffers) {
            const webGLDrawBuffers: WebGLDrawBuffers = ctx._extensions.webgl_draw_buffers;
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = null
            this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = null
            this._attachments[ctx.NONE] = null
            this._attachments[ctx.BACK] = null

            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0
            this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0
            this._attachmentLevel[ctx.NONE] = null
            this._attachmentLevel[ctx.BACK] = null

            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0
            this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0
            this._attachmentFace[ctx.NONE] = null
            this._attachmentFace[ctx.BACK] = null
        }
    }

    _clearAttachment(attachment: GLenum) {
        const object = this._attachments[attachment]
        if (!object) {
            return
        }
        this._attachments[attachment] = null
        this._unlink(object)
    }

    _setAttachment(object: WebGLTexture | WebGLRenderbuffer | null, attachment: GLenum) {
        const prevObject = this._attachments[attachment]
        if (prevObject === object) {
            return
        }

        this._clearAttachment(attachment)
        if (!object) {
            return
        }

        this._attachments[attachment] = object

        this._link(object)
    }

    _performDelete() {
        const ctx = this._ctx
        delete ctx._framebuffers[this._ | 0]
        ctx.deleteFramebuffer.call(ctx, this)
    }
}

export { GjsifyWebGLFramebuffer as WebGLFramebuffer }
