import { gl } from '../native-gl.js';
import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class WebGLDrawBuffers {
  ctx: GjsifyWebGLRenderingContext;
  _buffersState: number[] = [];
  _maxDrawBuffers = 0;
  _ALL_ATTACHMENTS: GLenum[] = []
  _ALL_COLOR_ATTACHMENTS: GLenum[] = []

  MAX_DRAW_BUFFERS_WEBGL = 0;
  COLOR_ATTACHMENT0_WEBGL = 0;
  COLOR_ATTACHMENT1_WEBGL = 0;
  COLOR_ATTACHMENT2_WEBGL = 0;
  COLOR_ATTACHMENT3_WEBGL = 0;
  COLOR_ATTACHMENT4_WEBGL = 0;
  COLOR_ATTACHMENT5_WEBGL = 0;
  COLOR_ATTACHMENT6_WEBGL = 0;
  COLOR_ATTACHMENT7_WEBGL = 0;
  COLOR_ATTACHMENT8_WEBGL = 0;
  COLOR_ATTACHMENT9_WEBGL = 0;
  COLOR_ATTACHMENT10_WEBGL = 0;
  COLOR_ATTACHMENT11_WEBGL = 0;
  COLOR_ATTACHMENT12_WEBGL = 0;
  COLOR_ATTACHMENT13_WEBGL = 0;
  COLOR_ATTACHMENT14_WEBGL = 0;
  COLOR_ATTACHMENT15_WEBGL = 0;

  constructor (ctx: GjsifyWebGLRenderingContext) {
    this.ctx = ctx
    const exts = ctx.getSupportedExtensions()

    if (exts && exts.indexOf('WEBGL_draw_buffers') >= 0) {
      Object.assign(this, ctx.extWEBGL_draw_buffers())
      this._buffersState = [ctx.BACK]
      this._maxDrawBuffers = ctx._getParameterDirect(this.MAX_DRAW_BUFFERS_WEBGL) as number;
      this._ALL_ATTACHMENTS = []
      this._ALL_COLOR_ATTACHMENTS = []
      const allColorAttachments = [
        this.COLOR_ATTACHMENT0_WEBGL,
        this.COLOR_ATTACHMENT1_WEBGL,
        this.COLOR_ATTACHMENT2_WEBGL,
        this.COLOR_ATTACHMENT3_WEBGL,
        this.COLOR_ATTACHMENT4_WEBGL,
        this.COLOR_ATTACHMENT5_WEBGL,
        this.COLOR_ATTACHMENT6_WEBGL,
        this.COLOR_ATTACHMENT7_WEBGL,
        this.COLOR_ATTACHMENT8_WEBGL,
        this.COLOR_ATTACHMENT9_WEBGL,
        this.COLOR_ATTACHMENT10_WEBGL,
        this.COLOR_ATTACHMENT11_WEBGL,
        this.COLOR_ATTACHMENT12_WEBGL,
        this.COLOR_ATTACHMENT13_WEBGL,
        this.COLOR_ATTACHMENT14_WEBGL,
        this.COLOR_ATTACHMENT15_WEBGL
      ]
      while (this._ALL_ATTACHMENTS.length < this._maxDrawBuffers) {
        const colorAttachment = allColorAttachments.shift()
        if(colorAttachment) {
          this._ALL_ATTACHMENTS.push(colorAttachment)
          this._ALL_COLOR_ATTACHMENTS.push(colorAttachment)
        }
      }
      this._ALL_ATTACHMENTS.push(
        gl.DEPTH_ATTACHMENT,
        gl.STENCIL_ATTACHMENT,
        gl.DEPTH_STENCIL_ATTACHMENT
      )
    }
  }

  drawBuffersWEBGL (buffers: GLenum[]) {
    const { ctx } = this
    if (buffers.length < 1) {
      ctx.setError(gl.INVALID_OPERATION)
      return
    }
    if (buffers.length === 1 && buffers[0] === gl.BACK) {
      this._buffersState = buffers
      ctx.drawBuffersWEBGL([this.COLOR_ATTACHMENT0_WEBGL])
      return
    } else if (!ctx._activeFramebuffer) {
      if (buffers.length > 1) {
        ctx.setError(gl.INVALID_OPERATION)
        return
      }
      for (let i = 0; i < buffers.length; i++) {
        if (buffers[i] > gl.NONE) {
          ctx.setError(gl.INVALID_OPERATION)
          return
        }
      }
    }
    this._buffersState = buffers
    ctx.drawBuffersWEBGL(buffers)
  }
}

export function getWebGLDrawBuffers (ctx: GjsifyWebGLRenderingContext) {
  const exts = ctx.getSupportedExtensions()

  if (exts && exts.indexOf('WEBGL_draw_buffers') >= 0) {
    return new WebGLDrawBuffers(ctx)
  } else {
    return null
  }
}
