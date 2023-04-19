/*
 * Type Definitions for Gjs (https://gjs.guide/)
 *
 * These type definitions are automatically generated, do not edit them by hand.
 * If you found a bug fix it in ts-for-gir itself or create a bug report on https://github.com/gjsify/ts-for-gjs
 */
/**
 * Gwebgl-0.1
 */

import type * as Gjs from './Gjs.js';
import type GLib from './GLib-2.0.js';
import type GObject from './GObject-2.0.js';

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
const STENCIL_INDEX: number
const VERSION: number
const IMPLEMENTATION_COLOR_READ_TYPE: number
const IMPLEMENTATION_COLOR_READ_FORMAT: number
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
    lastError: number

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    get_webgl_constants(): GLib.HashTable
    _vertexAttribDivisor(index: number, divisor: number): void
    activeTexture(texture: number): void
    attachShader(program: number, shader: number): void
    bindAttribLocation(program: number, index: number, name: string | null): void
    bindBuffer(target: number, buffer: number): void
    bindFramebuffer(target: number, framebuffer: number): void
    bindRenderbuffer(target: number, renderbuffer: number): void
    bindTexture(target: number, texture: number): void
    blendColor(red: number, green: number, blue: number, alpha: number): void
    blendEquation(mode: number): void
    blendEquationSeparate(modeRGB: number, modeAlpha: number): void
    blendFunc(sfactor: number, dfactor: number): void
    blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void
    checkFramebufferStatus(target: number): number
    clear(mask: number): void
    clearColor(red: number, green: number, blue: number, alpha: number): void
    clearDepth(depth: number): void
    clearStencil(s: number): void
    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void
    compileShader(shader: number): void
    copyTexImage2D(target: number, level: number, internalFormat: number, x: number, y: number, width: number, height: number, border: number): void
    copyTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, x: number, y: number, width: number, height: number): void
    createBuffer(): number
    createFramebuffer(): number
    createProgram(): number
    createRenderbuffer(): number
    createShader(type: number): number
    createTexture(): number
    cullFace(mode: number): void
    deleteBuffer(buffer: number): void
    deleteFramebuffer(framebuffer: number): void
    deleteProgram(program: number): void
    deleteRenderbuffer(renderbuffer: number): void
    deleteShader(shader: number): void
    deleteTexture(texture: number): void
    depthFunc(func: number): void
    depthMask(flag: boolean): void
    depthRange(zNear: number, zFar: number): void
    detachShader(program: number, shader: number): void
    disable(cap: number): void
    disableVertexAttribArray(index: number): void
    drawArrays(mode: number, first: number, count: number): void
    _drawArraysInstanced(mode: number, first: number, count: number, instancecount: number): void
    drawElements(mode: number, count: number, type: number, offset: number): void
    _drawElementsInstanced(mode: number, count: number, type: number, offset: number, instancecount: number): void
    enable(cap: number): void
    enableVertexAttribArray(index: number): void
    finish(): void
    flush(): void
    framebufferRenderbuffer(target: number, attachment: number, renderbufferTarget: number, renderbuffer: number): void
    framebufferTexture2D(target: number, attachment: number, textarget: number, texture: number, level: number): void
    frontFace(mode: number): void
    generateMipmap(target: number): void
    getActiveAttrib(program: number, index: number): /* result */ WebGLActiveInfo
    getActiveUniform(program: number, index: number): /* result */ WebGLActiveInfo
    getAttachedShaders(program: number): number[]
    getAttribLocation(program: number, name: string | null): number
    getBufferParameteriv(target: number, pname: number): number[]
    getError(): number
    setError(_error_: number): void
    getFramebufferAttachmentParameter(target: number, attachment: number, pname: number): number
    getParameterx(pname: number): GLib.Variant
    getParameterb(pname: number): boolean
    getParameterbv(pname: number, resultSize: number): boolean[]
    getParameterf(pname: number): number
    getParameterfv(pname: number, resultSize: number): number[]
    getParameteri(pname: number): number
    getParameteriv(pname: number, resultSize: number): number[]
    getProgramInfoLog(program: number): string | null
    getProgramParameter(program: number, pname: number): number
    getRenderbufferParameter(target: number, pname: number): number
    getShaderInfoLog(shader: number): string | null
    getShaderParameter(shader: number, pname: number): number
    getShaderPrecisionFormat(shadertype: number, precisiontype: number): /* result */ WebGLShaderPrecisionFormat
    getShaderSource(shader: number): string | null
    getString(pname: number): string | null
    getSupportedExtensions(): string[]
    getTexParameterx(target: number, pname: number): GLib.Variant
    getTexParameterfv(target: number, pname: number): number
    getTexParameteriv(target: number, pname: number): number
    getUniformLocation(program: number, name: string | null): number
    getUniform(program: number, location: number): number[]
    getUniformf(program: number, location: number): number[]
    getUniformfv(program: number, location: number, resultSize: number): number[]
    getUniformi(program: number, location: number): number[]
    getUniformiv(program: number, location: number, resultSize: number): number[]
    getVertexAttribOffset(index: number, pname: number): number
    getVertexAttrib(index: number, pname: number): GLib.Variant
    getVertexAttribf(index: number, pname: number): number[]
    getVertexAttribfv(index: number, pname: number, resultSize: number): number[]
    getVertexAttribi(index: number, pname: number): number[]
    hint(target: number, mode: number): void
    isBuffer(buffer: number): boolean
    isEnabled(cap: number): boolean
    isFramebuffer(framebuffer: number): boolean
    isProgram(program: number): boolean
    isRenderbuffer(renderbuffer: number): boolean
    isShader(shader: number): boolean
    isTexture(texture: number): boolean
    lineWidth(width: number): void
    linkProgram(program: number): void
    pixelStorei(pname: number, param: number): void
    polygonOffset(factor: number, units: number): void
    renderbufferStorage(target: number, internalFormat: number, width: number, height: number): void
    sampleCoverage(value: number, invert: boolean): void
    scissor(x: number, y: number, width: number, height: number): void
    shaderSource(shader: number, source: string | null): void
    stencilFunc(func: number, ref_: number, mask: number): void
    stencilFuncSeparate(face: number, func: number, ref_: number, mask: number): void
    stencilMask(mask: number): void
    stencilMaskSeparate(face: number, mask: number): void
    stencilOp(fail: number, zfail: number, zpass: number): void
    stencilOpSeparate(face: number, fail: number, zfail: number, zpass: number): void
    texParameterf(target: number, pname: number, param: number): void
    texParameteri(target: number, pname: number, param: number): void
    uniform1f(location: number, x: number): void
    uniform1i(location: number, x: number): void
    uniform2f(location: number, x: number, y: number): void
    uniform2i(location: number, x: number, y: number): void
    uniform3f(location: number, x: number, y: number, z: number): void
    uniform3i(location: number, x: number, y: number, z: number): void
    uniform4f(location: number, x: number, y: number, z: number, w: number): void
    uniform4i(location: number, x: number, y: number, z: number, w: number): void
    useProgram(program: number): void
    validateProgram(program: number): void
    vertexAttrib1f(index: number, x: number): void
    vertexAttrib1fv(index: number, v: number[]): void
    vertexAttrib2f(index: number, x: number, y: number): void
    vertexAttrib2fv(index: number, values: number[]): void
    vertexAttrib3f(index: number, x: number, y: number, z: number): void
    vertexAttrib3fv(index: number, values: number[]): void
    vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void
    vertexAttrib4fv(index: number, values: number[]): void
    vertexAttribPointer(index: number, size: number, type: number, _normalized: boolean, stride: number, offset: number): void
    viewport(x: number, y: number, width: number, height: number): void

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

        // Own constructor properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

        width?: number | null
        height?: number | null
        alpha?: boolean | null
        depth?: boolean | null
        stencil?: boolean | null
        antialias?: boolean | null
        premultipliedAlpha?: boolean | null
        preserveDrawingBuffer?: boolean | null
        preferLowPowerToHighPerformance?: boolean | null
        failIfMajorPerformanceCaveat?: boolean | null
    }

}

interface WebGLRenderingContext {

    // Own properties of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    readonly width: number
    readonly height: number
    readonly alpha: boolean
    readonly depth: boolean
    readonly stencil: boolean
    readonly antialias: boolean
    readonly premultipliedAlpha: boolean
    readonly preserveDrawingBuffer: boolean
    readonly preferLowPowerToHighPerformance: boolean
    readonly failIfMajorPerformanceCaveat: boolean

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    isVariantOfByteArray(variant: GLib.Variant): boolean
    bufferData(target: number, variant: GLib.Variant, usage: number): void
    bufferDataSizeOnly(target: number, size: number, usage: number): void
    bufferSubData(target: number, offset: number, variant: GLib.Variant): void
    compressedTexImage2D(target: number, level: number, internalFormat: any, width: number, height: number, border: number, variant: GLib.Variant): void
    compressedTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, width: number, height: number, format: number, variant: GLib.Variant): void
    readPixels(x: number, y: number, width: number, height: number, format: number, type: number, variant: GLib.Variant): Uint8Array
    texImage2D(target: number, level: number, internalFormat: number, width: number, height: number, border: number, format: number, type: number, variant: GLib.Variant): void
    texImage2DFromPixbuf(target: number, level: number, internalFormat: number, format: number, type: number, source: any | null): void
    texSubImage2D(target: number, level: number, xoffset: number, yoffset: number, width: number, height: number, format: number, type: number, variant: GLib.Variant): void
    texSubImage2DFromPixbuf(target: number, level: number, xoffset: number, yoffset: number, format: number, type: number, source: any | null): void
    uniform1fv(location: number, vLength: number, value: number[]): void
    uniform1iv(location: number, vLength: number, value: number[]): void
    uniform2fv(location: number, vLength: number, value: number[]): void
    uniform2iv(location: number, vLength: number, value: number[]): void
    uniform3fv(location: number, vLength: number, value: number[]): void
    uniform3iv(location: number, vLength: number, value: number[]): void
    uniform4fv(location: number, vLength: number, value: number[]): void
    uniform4iv(location: number, vLength: number, value: number[]): void
    uniformMatrix2fv(location: number, transpose: boolean, value: number[]): void
    uniformMatrix3fv(location: number, transpose: boolean, value: number[]): void
    uniformMatrix4fv(location: number, transpose: boolean, value: number[]): void
    get_width(): number
    get_height(): number
    get_alpha(): boolean
    get_depth(): boolean
    get_stencil(): boolean
    get_antialias(): boolean
    get_premultipliedAlpha(): boolean
    get_preserveDrawingBuffer(): boolean
    get_preferLowPowerToHighPerformance(): boolean
    get_failIfMajorPerformanceCaveat(): boolean

    // Class property signals of Gwebgl-0.1.Gwebgl.WebGLRenderingContext

    connect(sigName: "notify::width", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::width", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::width", ...args: any[]): void
    connect(sigName: "notify::height", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::height", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::height", ...args: any[]): void
    connect(sigName: "notify::alpha", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::alpha", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::alpha", ...args: any[]): void
    connect(sigName: "notify::depth", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::depth", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::depth", ...args: any[]): void
    connect(sigName: "notify::stencil", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::stencil", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::stencil", ...args: any[]): void
    connect(sigName: "notify::antialias", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::antialias", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::antialias", ...args: any[]): void
    connect(sigName: "notify::premultipliedAlpha", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::premultipliedAlpha", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::premultipliedAlpha", ...args: any[]): void
    connect(sigName: "notify::preserveDrawingBuffer", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::preserveDrawingBuffer", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::preserveDrawingBuffer", ...args: any[]): void
    connect(sigName: "notify::preferLowPowerToHighPerformance", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::preferLowPowerToHighPerformance", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::preferLowPowerToHighPerformance", ...args: any[]): void
    connect(sigName: "notify::failIfMajorPerformanceCaveat", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    connect_after(sigName: "notify::failIfMajorPerformanceCaveat", callback: (($obj: WebGLRenderingContext, pspec: GObject.ParamSpec) => void)): number
    emit(sigName: "notify::failIfMajorPerformanceCaveat", ...args: any[]): void
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
    constructor(width: number, height: number, alpha: boolean, depth: boolean, stencil: boolean, antialias: boolean, premultipliedAlpha: boolean, preserveDrawingBuffer: boolean, preferLowPowerToHighPerformance: boolean, failIfMajorPerformanceCaveat: boolean) 
    static new(width: number, height: number, alpha: boolean, depth: boolean, stencil: boolean, antialias: boolean, premultipliedAlpha: boolean, preserveDrawingBuffer: boolean, preferLowPowerToHighPerformance: boolean, failIfMajorPerformanceCaveat: boolean): WebGLRenderingContext

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

interface WebGLActiveInfo {

    // Own fields of Gwebgl-0.1.Gwebgl.WebGLActiveInfo

    name: string | null
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