
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
import type GLib from './GLib-2.0.js';
import type GObject from './GObject-2.0.js';

export namespace Gwebgl {

module WebGLRenderingContextBase {

    // Constructor properties interface

    interface ConstructorProperties extends GObject.Object.ConstructorProperties {
    }

}

interface WebGLRenderingContextBase {

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    get_webgl_constants(): GLib.HashTable
    activeTexture(texture: any): void
    attachShader(program: GwebglWebGLProgram, shader: any): void
    bindAttribLocation(program: GwebglWebGLProgram, index: number, name: string): void
    bindBuffer(target: any, buffer: GwebglWebGLBuffer): void
    bindFramebuffer(target: any, framebuffer: GwebglWebGLFramebuffer): void
    bindRenderbuffer(target: any, renderbuffer: any): void
    bindTexture(target: any, texture: any): void
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
    compileShader(shader: any): void
    copyTexImage2D(target: any, level: any, internalformat: any, x: any, y: any, width: any, height: any, border: any): void
    copyTexSubImage2D(target: any, level: any, xoffset: any, yoffset: any, x: any, y: any, width: any, height: any): void
    createBuffer(): GwebglWebGLBuffer[]
    createFramebuffer(): GwebglWebGLFramebuffer[]
    createProgram(): GwebglWebGLProgram
    createRenderbuffer(): any[]
    createShader(type: any): any
    createTexture(): any
    cullFace(mode: any): void
    deleteBuffer(buffers: GwebglWebGLBuffer[]): void
    deleteFramebuffer(framebuffers: GwebglWebGLFramebuffer[]): void
    deleteProgram(program: GwebglWebGLProgram): void
    deleteRenderbuffer(renderbuffers: any[]): void
    deleteShader(shader: any): void
    deleteTexture(textures: any[]): void
    depthFunc(func: any): void
    depthMask(flag: any): void
    depthRange(zNear: number, zFar: number): void
    detachShader(program: GwebglWebGLProgram, shader: any): void
    disable(cap: any): void
    disableVertexAttribArray(index: any): void
    drawArrays(mode: any, first: any, count: any): void
    drawElements(mode: any, count: any, type: any, indices: any[] | null): void
    enable(cap: any): void
    enableVertexAttribArray(index: number): void
    finish(): void
    flush(): void
    framebufferRenderbuffer(target: any, attachment: any, renderbuffertarget: any, renderbuffer: any): void
    framebufferTexture2D(target: any, attachment: any, textarget: any, texture: any, level: any): void
    frontFace(mode: any): void
    generateMipmap(target: any): void
    getActiveAttrib(program: GwebglWebGLProgram, index: number, size: any, type: any, name: any): void
    getActiveUniform(program: GwebglWebGLProgram, index: number, size: any, type: any, name: any): void
    getAttachedShaders(program: GwebglWebGLProgram): any[]
    getAttribLocation(program: GwebglWebGLProgram, name: string): any
    getBufferParameteriv(target: any, pname: any): any
    getError(): any
    getFramebufferAttachmentParameter(target: any, attachment: any, pname: any): any
    getParameterb(pname: any): any
    getParameterbv(pname: any, resultSize: number): any
    getParameterf(pname: any): any
    getParameterfv(pname: any, resultSize: number): any
    getParameteri(pname: any): any
    getParameteriv(pname: any, resultSize: number): any
    getProgramInfoLog(program: GwebglWebGLProgram): any[]
    getProgramParameter(program: GwebglWebGLProgram, pname: any): any
    getRenderbufferParameter(target: any, pname: any): any
    getShaderInfoLog(shader: any): any[]
    getShaderParameter(shader: any, pname: any): any
    getShaderPrecisionFormat(shadertype: any, precisiontype: any, range_min: any, range_max: any, precision: any): void
    getShaderSource(shader: any): any[]
    getString(pname: any): string
    getSupportedExtensions(): string[]
    getTexParameterfv(target: any, pname: any): any[]
    getTexParameteriv(target: any, pname: any): any[]
    getUniformLocation(program: GwebglWebGLProgram, name: string): GwebglWebGLUniformLocation
    getUniformf(program: GwebglWebGLProgram, location: GwebglWebGLUniformLocation): any[]
    getUniformfv(program: GwebglWebGLProgram, location: GwebglWebGLUniformLocation, resultSize: number): any[]
    getUniformi(program: GwebglWebGLProgram, location: GwebglWebGLUniformLocation): any[]
    getUniformiv(program: GwebglWebGLProgram, location: GwebglWebGLUniformLocation, resultSize: number): any[]
    getVertexAttribOffset(index: number, pname: any): any[]
    getVertexAttribf(index: number, pname: any): any[]
    getVertexAttribfv(index: number, pname: any, resultSize: number): any[]
    getVertexAttribi(index: any, pname: any): any[]
    hint(target: any, mode: any): void
    isBuffer(buffer: GwebglWebGLBuffer): any
    isEnabled(cap: any): any
    isFramebuffer(framebuffer: GwebglWebGLFramebuffer): any
    isProgram(program: GwebglWebGLProgram): any
    isRenderbuffer(renderbuffer: any): any
    isShader(shader: any): any
    isTexture(texture: any): any
    lineWidth(width: number): void
    linkProgram(program: GwebglWebGLProgram): void
    pixelStorei(pname: any, param: number): void
    polygonOffset(factor: number, units: number): void
    renderbufferStorage(target: any, internalformat: any, width: any, height: any): void
    sampleCoverage(value: any, invert: any): void
    scissor(x: number, y: number, width: number, height: number): void
    shaderSource(shader: any, source: string[]): void
    stencilFunc(func: any, ref_: any, mask: any): void
    stencilFuncSeparate(face: any, func: any, ref_: any, mask: any): void
    stencilMask(mask: any): void
    stencilMaskSeparate(face: any, mask: any): void
    stencilOp(fail: any, zfail: any, zpass: any): void
    stencilOpSeparate(face: any, fail: any, zfail: any, zpass: any): void
    texParameterf(target: any, pname: any, param: any): void
    texParameteri(target: any, pname: any, param: any): void
    uniform1f(location: GwebglWebGLUniformLocation, x: number): void
    uniform1i(location: GwebglWebGLUniformLocation, x: number): void
    uniform2f(location: GwebglWebGLUniformLocation, x: number, y: number): void
    uniform2i(location: GwebglWebGLUniformLocation, x: number, y: number): void
    uniform3f(location: GwebglWebGLUniformLocation, x: number, y: number, z: number): void
    uniform3i(location: GwebglWebGLUniformLocation, x: number, y: number, z: number): void
    uniform4f(location: GwebglWebGLUniformLocation, x: number, y: number, z: number, w: number): void
    uniform4i(location: GwebglWebGLUniformLocation, x: number, y: number, z: number, w: number): void
    useProgram(program: GwebglWebGLProgram): void
    validateProgram(program: GwebglWebGLProgram): void
    vertexAttrib1f(index: number, x: number): void
    vertexAttrib1fv(index: number, v: any[] | null): void
    vertexAttrib2f(index: number, x: number, y: number): void
    vertexAttrib2fv(index: number, v: any[] | null): void
    vertexAttrib3f(index: any, x: any, y: any, z: any): void
    vertexAttrib3fv(index: any, v: any[] | null): void
    vertexAttrib4f(index: any, x: any, y: any, z: any, w: any): void
    vertexAttrib4fv(index: any, v: any[] | null): void
    vertexAttribPointer(index: any, size: any, type: any, normalized: any, stride: any, offset: any[] | null): void
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

    interface ConstructorProperties extends GObject.Object.ConstructorProperties {
    }

}

interface WebGLRenderingContext {

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    bufferData(target: any, _data: object | null, usage: any): void
    bufferDataSizeOnly(target: any, size: any, usage: any): void
    bufferSubData(target: any, offset: number, _data: object | null): void
    compressedTexImage2D(target: any, level: any, internalformat: any, width: number, height: number, border: number, _data: object | null): void
    compressedTexSubImage2D(target: any, level: any, xoffset: number, yoffset: number, width: number, height: number, format: any, _data: object | null): void
    readPixels(x: any, y: any, width: any, height: any, format: any, type: any, _pixels: object | null): void
    texImage2D(target: any, level: any, internalformat: any, width: any, height: any, border: any, format: any, type: any, _pixels: object | null): void
    texImage2DFromPixbuf(target: any, level: any, internalformat: any, format: any, type: any, source: object | null): void
    texSubImage2D(target: any, level: any, xoffset: any, yoffset: any, width: any, height: any, format: any, type: any, _pixels: object | null): void
    texSubImage2DFromPixbuf(target: any, level: number, xoffset: number, yoffset: number, format: any, type: any, source: object | null): void
    uniform1fv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform1iv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform2fv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform2iv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform3fv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform3iv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform4fv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniform4iv(location: GwebglWebGLUniformLocation, vLength: number, value: any[] | null): void
    uniformMatrix2fv(location: GwebglWebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix3fv(location: GwebglWebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix4fv(location: GwebglWebGLUniformLocation, valueLength: number, transpose: any, value: any[] | null): void

    // Class property signals of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    connect(sigName: string, callback: (...args: any[]) => void): number
    connect_after(sigName: string, callback: (...args: any[]) => void): number
    emit(sigName: string, ...args: any[]): void
    disconnect(id: number): void
}

class WebGLRenderingContext extends GObject.Object {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    static name: string
    static $gtype: GObject.GType<WebGLRenderingContext>

    // Constructors of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    constructor(config?: WebGLRenderingContext.ConstructorProperties) 
    constructor() 
    static new(): WebGLRenderingContext
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

interface GwebglWebGLProgram {
}

class GwebglWebGLProgram {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLProgram

    static name: string
}

interface GwebglWebGLShader {
}

class GwebglWebGLShader {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLShader

    static name: string
}

interface GwebglWebGLBuffer {
}

class GwebglWebGLBuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLBuffer

    static name: string
}

interface GwebglWebGLFramebuffer {
}

class GwebglWebGLFramebuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLFramebuffer

    static name: string
}

interface GwebglWebGLRenderbuffer {
}

class GwebglWebGLRenderbuffer {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLRenderbuffer

    static name: string
}

interface GwebglWebGLTexture {
}

class GwebglWebGLTexture {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLTexture

    static name: string
}

interface GwebglWebGLUniformLocation {
}

class GwebglWebGLUniformLocation {

    // Own properties of Gwebgl-0.1.Gwebgl.GwebglWebGLUniformLocation

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