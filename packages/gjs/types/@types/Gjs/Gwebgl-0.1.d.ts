
/*
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in ts-for-gir itself or create a bug report on https://github.com/sammydre/ts-for-gjs
 */
/**
 * Gwebgl-0.1
 */

import type * as Gjs from './Gjs.js';
import type GdkPixbuf from './GdkPixbuf-2.0.js';
import type Gio from './Gio-2.0.js';
import type GObject from './GObject-2.0.js';
import type GLib from './GLib-2.0.js';
import type GModule from './GModule-2.0.js';

export namespace Gwebgl {

enum TypeError {
    CODE,
}
const UNPACK_FLIP_Y_WEBGL: number
const UNPACK_PREMULTIPLY_ALPHA_WEBGL: number
const UNPACK_COLORSPACE_CONVERSION_WEBGL: number
const CONTEXT_LOST_WEBGL: number
const BROWSER_DEFAULT_WEBGL: number
const VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: number
const UNMASKED_VENDOR_WEBGL: number
const UNMASKED_RENDERER_WEBGL: number
const MAX_DRAW_BUFFERS_WEBGL: number
const MAX_TEXTURE_MAX_ANISOTROPY_EXT: number
const TEXTURE_MAX_ANISOTROPY_EXT: number
module WebGLRenderingContextBase {

    // Constructor properties interface

    interface ConstructorProperties extends GObject.Object.ConstructorProperties {
    }

}

interface WebGLRenderingContextBase {

    // Own fields of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    unpack_flip_y: boolean
    unpack_premultiply_alpha: boolean
    unpack_colorspace_conversion: number
    unpack_alignment: number

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    get_webgl_constants(): GLib.HashTable
    activeTexture(texture: any): void
    attachShader(program: WebGLProgram, shader: WebGLShader): void
    bindAttribLocation(program: WebGLProgram, index: number, name: string): void
    bindBuffer(target: any, buffer: WebGLBuffer | null): void
    bindFramebuffer(target: any, framebuffer: WebGLFramebuffer | null): void
    bindRenderbuffer(target: any, renderbuffer: WebGLRenderbuffer | null): void
    bindTexture(target: any, texture: WebGLTexture | null): void
    blendColor(red: number, green: number, blue: number, alpha: number): void
    blendEquation(mode: any): void
    blendEquationSeparate(modeRGB: any, modeAlpha: any): void
    blendFunc(sfactor: any, dfactor: any): void
    blendFuncSeparate(srcRGB: any, dstRGB: any, srcAlpha: any, dstAlpha: any): void
    checkFramebufferStatus(target: any): any
    clear(mask: any): void
    clearColor(red: any, green: any, blue: any, alpha: any): void
    clearDepth(depth: any): void
    clearStencil(s: any): void
    colorMask(red: any, green: any, blue: any, alpha: any): void
    compileShader(shader: WebGLShader): void
    copyTexImage2D(target: any, level: any, internalformat: any, x: any, y: any, width: any, height: any, border: any): void
    copyTexSubImage2D(target: any, level: any, xoffset: any, yoffset: any, x: any, y: any, width: any, height: any): void
    createBuffer(): WebGLBuffer | null
    createFramebuffer(): WebGLFramebuffer | null
    createProgram(): WebGLProgram | null
    createRenderbuffer(): WebGLRenderbuffer | null
    createShader(type: any): any
    createTexture(): WebGLTexture | null
    cullFace(mode: any): void
    deleteBuffer(buffer: WebGLBuffer | null): void
    deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void
    deleteProgram(program: WebGLProgram | null): void
    deleteRenderbuffer(renderbuffers: WebGLRenderbuffer | null): void
    deleteShader(shader: WebGLShader | null): void
    deleteTexture(texture: WebGLTexture | null): void
    depthFunc(func: any): void
    depthMask(flag: any): void
    depthRange(zNear: number, zFar: number): void
    detachShader(program: WebGLProgram, shader: WebGLShader): void
    disable(cap: any): void
    disableVertexAttribArray(index: any): void
    drawArrays(mode: any, first: any, count: any): void
    drawElements(mode: any, count: any, type: any, offset: any): void
    enable(cap: any): void
    enableVertexAttribArray(index: number): void
    finish(): void
    flush(): void
    framebufferRenderbuffer(target: any, attachment: any, renderbuffertarget: any, renderbuffer: WebGLRenderbuffer | null): void
    framebufferTexture2D(target: any, attachment: any, textarget: any, texture: WebGLTexture | null, level: any): void
    frontFace(mode: any): void
    generateMipmap(target: any): void
    getActiveAttrib(program: WebGLProgram, index: number): WebGLActiveInfo | null
    getActiveUniform(program: WebGLProgram, index: number): WebGLActiveInfo | null
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null
    getAttribLocation(program: WebGLProgram, name: string): any
    getBufferParameter(target: any, pname: any): any
    getError(): any
    getFramebufferAttachmentParameter(target: any, attachment: any, pname: any): any
    getParameterx(pname: any): GLib.Variant | null
    getParameterb(pname: any): any
    getParameterbv(pname: any, resultSize: number): any
    getParameterf(pname: any): any
    getParameterfv(pname: any, resultSize: number): any
    getParameteri(pname: any): any
    getParameteriv(pname: any, resultSize: number): any
    getProgramInfoLog(program: WebGLProgram): string | null
    getProgramParameter(program: WebGLProgram, pname: any): any
    getRenderbufferParameter(target: any, pname: any): any
    getShaderInfoLog(shader: WebGLShader): string | null
    getShaderParameter(shader: WebGLShader, pname: any): any
    getShaderPrecisionFormat(shadertype: any, precisiontype: any): WebGLShaderPrecisionFormat | null
    getShaderSource(shader: WebGLShader): string | null
    getString(pname: any): string
    getSupportedExtensions(): string[] | null
    getTexParameterx(target: any, pname: any): GLib.Variant
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any[]
    getUniformi(program: WebGLProgram, location: WebGLUniformLocation): any[]
    getUniformiv(program: WebGLProgram, location: WebGLUniformLocation, resultSize: number): any[]
    getVertexAttribOffset(index: number, pname: any): any
    getVertexAttrib(index: number, pname: any): GLib.Variant
    getVertexAttribf(index: number, pname: any): any[]
    getVertexAttribfv(index: number, pname: any, resultSize: number): any[]
    getVertexAttribi(index: any, pname: any): any[]
    hint(target: any, mode: any): void
    isBuffer(buffer: WebGLBuffer | null): any
    isEnabled(cap: any): any
    isFramebuffer(framebuffer: WebGLFramebuffer | null): any
    isProgram(program: WebGLProgram | null): any
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): any
    isShader(shader: WebGLShader | null): any
    isTexture(texture: WebGLTexture | null): any
    lineWidth(width: number): void
    linkProgram(program: WebGLProgram): void
    pixelStorei(pname: any, param: number): void
    polygonOffset(factor: number, units: number): void
    renderbufferStorage(target: any, internalformat: any, width: any, height: any): void
    sampleCoverage(value: any, invert: any): void
    scissor(x: number, y: number, width: number, height: number): void
    shaderSource(shader: WebGLShader, source: string): void
    stencilFunc(func: any, ref_: any, mask: any): void
    stencilFuncSeparate(face: any, func: any, ref_: any, mask: any): void
    stencilMask(mask: any): void
    stencilMaskSeparate(face: any, mask: any): void
    stencilOp(fail: any, zfail: any, zpass: any): void
    stencilOpSeparate(face: any, fail: any, zfail: any, zpass: any): void
    texParameterf(target: any, pname: any, param: any): void
    texParameteri(target: any, pname: any, param: any): void
    uniform1f(location: WebGLUniformLocation | null, x: number): void
    uniform1i(location: WebGLUniformLocation | null, x: number): void
    uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void
    uniform2i(location: WebGLUniformLocation | null, x: number, y: number): void
    uniform3f(location: WebGLUniformLocation | null, x: number, y: number, z: number): void
    uniform3i(location: WebGLUniformLocation | null, x: number, y: number, z: number): void
    uniform4f(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void
    uniform4i(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void
    useProgram(program: WebGLProgram | null): void
    validateProgram(program: WebGLProgram | null): void
    vertexAttrib1f(index: any, x: any): void
    vertexAttrib1fv(index: any, v: any[]): void
    vertexAttrib2f(index: any, x: any, y: any): void
    vertexAttrib2fv(index: any, values: any[]): void
    vertexAttrib3f(index: any, x: any, y: any, z: any): void
    vertexAttrib3fv(index: any, values: any[]): void
    vertexAttrib4f(index: any, x: any, y: any, z: any, w: any): void
    vertexAttrib4fv(index: any, values: any[]): void
    vertexAttribPointer(index: any, size: any, type: any, normalized: any, stride: any, offset: any): void
    viewport(x: any, y: any, width: any, height: any): void

    // Class property signals of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    connect(sigName: string, callback: (...args: any[]) => void): number
    connect_after(sigName: string, callback: (...args: any[]) => void): number
    emit(sigName: string, ...args: any[]): void
    disconnect(id: number): void
}

class WebGLRenderingContextBase extends GObject.Object {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    static name: string
    static $gtype: GObject.GType<WebGLRenderingContextBase>

    // Constructors of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    constructor(config?: WebGLRenderingContextBase.ConstructorProperties) 
    constructor() 
    static new(): WebGLRenderingContextBase
    _init(config?: WebGLRenderingContextBase.ConstructorProperties): void
}

module WebGLRenderingContext {

    // Constructor properties interface

    interface ConstructorProperties extends WebGLRenderingContextBase.ConstructorProperties {
    }

}

interface WebGLRenderingContext {

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    bufferData(target: any, _data: Uint8Array, usage: any): void
    bufferDataSizeOnly(target: any, size: any, usage: any): void
    bufferSubData(target: any, offset: number, _data: Uint8Array): void
    compressedTexImage2D(target: any, level: any, internalformat: any, width: number, height: number, border: number, _data: Uint8Array): void
    compressedTexSubImage2D(target: any, level: any, xoffset: number, yoffset: number, width: number, height: number, format: any, _data: Uint8Array): void
    readPixels(x: any, y: any, width: any, height: any, format: any, type: any, _pixels: Uint8Array): void
    texImage2D(target: any, level: any, internalformat: any, width: any, height: any, border: any, format: any, type: any, _pixels: Uint8Array): void
    texImage2DFromPixbuf(target: any, level: any, internalformat: any, format: any, type: any, source: GdkPixbuf.Pixbuf): void
    texSubImage2D(target: any, level: any, xoffset: any, yoffset: any, width: any, height: any, format: any, type: any, _pixels: Uint8Array): void
    texSubImage2DFromPixbuf(target: any, level: number, xoffset: number, yoffset: number, format: any, type: any, source: GdkPixbuf.Pixbuf): void
    uniform1fv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform1iv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform2fv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform2iv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform3fv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform3iv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform4fv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform4iv(location: WebGLUniformLocation, vLength: number, value: any[] | null): void
    uniformMatrix2fv(location: WebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix3fv(location: WebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix4fv(location: WebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void

    // Class property signals of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    connect(sigName: string, callback: (...args: any[]) => void): number
    connect_after(sigName: string, callback: (...args: any[]) => void): number
    emit(sigName: string, ...args: any[]): void
    disconnect(id: number): void
}

class WebGLRenderingContext extends WebGLRenderingContextBase {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    static name: string
    static $gtype: GObject.GType<WebGLRenderingContext>

    // Constructors of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    constructor(config?: WebGLRenderingContext.ConstructorProperties) 
    constructor() 
    static new(): WebGLRenderingContext

    // Overloads of new

    static new(): WebGLRenderingContextBase
    _init(config?: WebGLRenderingContext.ConstructorProperties): void
}

interface WebGLRenderingContextBaseClass {
}

abstract class WebGLRenderingContextBaseClass {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBaseClass

    static name: string
}

interface WebGLRenderingContextBasePrivate {
}

class WebGLRenderingContextBasePrivate {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBasePrivate

    static name: string
}

interface WebGLRenderingContextClass {
}

abstract class WebGLRenderingContextClass {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContextClass

    static name: string
}

interface WebGLRenderingContextPrivate {
}

class WebGLRenderingContextPrivate {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContextPrivate

    static name: string
}

interface WebGLProgram {
}

class WebGLProgram {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLProgram

    static name: string
}

interface WebGLShader {
}

class WebGLShader {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLShader

    static name: string
}

interface WebGLBuffer {
}

class WebGLBuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLBuffer

    static name: string
}

interface WebGLFramebuffer {
}

class WebGLFramebuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLFramebuffer

    static name: string
}

interface WebGLRenderbuffer {
}

class WebGLRenderbuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderbuffer

    static name: string
}

interface WebGLTexture {
}

class WebGLTexture {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLTexture

    static name: string
}

interface WebGLUniformLocation {
}

class WebGLUniformLocation {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLUniformLocation

    static name: string
}

interface WebGLActiveInfo {

    // Own fields of Gwebgl-0.1.Gwebgl.WebGLActiveInfo

    name: string
    size: number
    type: number
}

class WebGLActiveInfo {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLActiveInfo

    static name: string
}

interface WebGLShaderPrecisionFormat {

    // Own fields of Gwebgl-0.1.Gwebgl.WebGLShaderPrecisionFormat

    precision: number
    rangeMax: number
    rangeMin: number
}

class WebGLShaderPrecisionFormat {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLShaderPrecisionFormat

    static name: string
}

/**
 * Name of the imported GIR library
 * @see https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L188
 */
const __name__: string
/**
 * Version of the imported GIR library
 * @see https://gitlab.gnome.org/GNOME/gjs/-/blob/master/gi/ns.cpp#L189
 */
const __version__: string
}
export default Gwebgl;