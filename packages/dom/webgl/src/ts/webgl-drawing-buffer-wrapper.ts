export class WebGLDrawingBufferWrapper {
    _framebuffer: WebGLFramebuffer & number;
    _color: WebGLTexture & number;
    _depthStencil: WebGLRenderbuffer & number;
    constructor(framebuffer: WebGLFramebuffer & number, color: WebGLTexture & number, depthStencil: WebGLRenderbuffer & number) {
        this._framebuffer = framebuffer
        this._color = color
        this._depthStencil = depthStencil
    }
}