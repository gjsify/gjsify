
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
    lastError: number

    // Owm methods of Gwebgl-0.1.Gwebgl.WebGLRenderingContextBase

    get_webgl_constants(): GLib.HashTable
    activeTexture(texture: any): void
    attachShader(program: number, shader: number): void
    bindAttribLocation(program: number, index: number, name: string): void
    bindBuffer(target: any, buffer: number | null): void
    bindFramebuffer(target: any, framebuffer: number | null): void
    bindRenderbuffer(target: any, renderbuffer: number | null): void
    bindTexture(target: any, texture: number | null): void
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
    compileShader(shader: number): void
    copyTexImage2D(target: any, level: any, internalformat: any, x: any, y: any, width: any, height: any, border: any): void
    copyTexSubImage2D(target: any, level: any, xoffset: any, yoffset: any, x: any, y: any, width: any, height: any): void
    createBuffer(): number
    createFramebuffer(): number
    createProgram(): number
    createRenderbuffer(): number
    createShader(type: any): any
    createTexture(): number | null
    cullFace(mode: any): void
    deleteBuffer(buffer: number | null): void
    deleteFramebuffer(framebuffer: number | null): void
    deleteProgram(program: number | null): void
    deleteRenderbuffer(renderbuffers: number | null): void
    deleteShader(shader: number | null): void
    deleteTexture(texture: number | null): void
    depthFunc(func: any): void
    depthMask(flag: any): void
    depthRange(zNear: number, zFar: number): void
    detachShader(program: number, shader: number): void
    disable(cap: any): void
    disableVertexAttribArray(index: any): void
    drawArrays(mode: any, first: any, count: any): void
    drawElements(mode: any, count: any, type: any, offset: any): void
    enable(cap: any): void
    enableVertexAttribArray(index: number): void
    finish(): void
    flush(): void
    framebufferRenderbuffer(target: any, attachment: any, renderbuffertarget: any, renderbuffer: number | null): void
    framebufferTexture2D(target: any, attachment: any, textarget: any, texture: number | null, level: any): void
    frontFace(mode: any): void
    generateMipmap(target: any): void
    getActiveAttrib(program: number, index: number): WebGLActiveInfo | null
    getActiveUniform(program: number, index: number): WebGLActiveInfo | null
    getAttachedShaders(program: number): number[] | null
    getAttribLocation(program: number, name: string): any
    getBufferParameter(target: any, pname: any): any
    getError(): any
    setError(_error_: any): void
    getFramebufferAttachmentParameter(target: any, attachment: any, pname: any): any
    getParameterx(pname: any): GLib.Variant | null
    getParameterb(pname: any): any
    getParameterbv(pname: any, resultSize: number): any
    getParameterf(pname: any): any
    getParameterfv(pname: any, resultSize: number): any
    getParameteri(pname: any): any
    getParameteriv(pname: any, resultSize: number): any
    getProgramInfoLog(program: number): string | null
    getProgramParameter(program: number, pname: any): any
    getRenderbufferParameter(target: any, pname: any): any
    getShaderInfoLog(shader: number): string | null
    getShaderParameter(shader: number, pname: any): any
    getShaderPrecisionFormat(shadertype: any, precisiontype: any): WebGLShaderPrecisionFormat | null
    getShaderSource(shader: number): string | null
    getString(pname: any): string
    getSupportedExtensions(): string[] | null
    getTexParameterx(target: any, pname: any): GLib.Variant
    getUniformLocation(program: number, name: string): number | null
    getUniform(program: number, location: number): any[]
    getUniformi(program: number, location: number): any[]
    getUniformiv(program: number, location: number, resultSize: number): any[]
    getVertexAttribOffset(index: number, pname: any): any
    getVertexAttrib(index: number, pname: any): GLib.Variant
    getVertexAttribf(index: number, pname: any): any[]
    getVertexAttribfv(index: number, pname: any, resultSize: number): any[]
    getVertexAttribi(index: any, pname: any): any[]
    hint(target: any, mode: any): void
    isBuffer(buffer: number | null): any
    isEnabled(cap: any): any
    isFramebuffer(framebuffer: number | null): any
    isProgram(program: number | null): any
    isRenderbuffer(renderbuffer: number | null): any
    isShader(shader: number | null): any
    isTexture(texture: number | null): any
    lineWidth(width: number): void
    linkProgram(program: number): void
    pixelStorei(pname: any, param: number): void
    polygonOffset(factor: number, units: number): void
    renderbufferStorage(target: any, internalformat: any, width: any, height: any): void
    sampleCoverage(value: any, invert: any): void
    scissor(x: number, y: number, width: number, height: number): void
    shaderSource(shader: number, source: string): void
    stencilFunc(func: any, ref_: any, mask: any): void
    stencilFuncSeparate(face: any, func: any, ref_: any, mask: any): void
    stencilMask(mask: any): void
    stencilMaskSeparate(face: any, mask: any): void
    stencilOp(fail: any, zfail: any, zpass: any): void
    stencilOpSeparate(face: any, fail: any, zfail: any, zpass: any): void
    texParameterf(target: any, pname: any, param: any): void
    texParameteri(target: any, pname: any, param: any): void
    uniform1f(location: number | null, x: number): void
    uniform1i(location: number | null, x: number): void
    uniform2f(location: number | null, x: number, y: number): void
    uniform2i(location: number | null, x: number, y: number): void
    uniform3f(location: number | null, x: number, y: number, z: number): void
    uniform3i(location: number | null, x: number, y: number, z: number): void
    uniform4f(location: number | null, x: number, y: number, z: number, w: number): void
    uniform4i(location: number | null, x: number, y: number, z: number, w: number): void
    useProgram(program: number | null): void
    validateProgram(program: number | null): void
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

    bufferData(target: any, _data: Uint8Array, usage: any): void
    bufferDataSizeOnly(target: any, size: any, usage: any): void
    bufferSubData(target: any, offset: number, _data: Uint8Array): void
    compressedTexImage2D(target: any, level: any, internalformat: any, width: number, height: number, border: number, _data: Uint8Array): void
    compressedTexSubImage2D(target: any, level: any, xoffset: number, yoffset: number, width: number, height: number, format: any, _data: Uint8Array): void
    readPixels(x: any, y: any, width: any, height: any, format: any, type: any, _pixels: Uint8Array): void
    texImage2D(target: any, level: any, internalformat: any, width: any, height: any, border: any, format: any, type: any, _pixels: Uint8Array | null): void
    texImage2DFromPixbuf(target: any, level: any, internalformat: any, format: any, type: any, source: GdkPixbuf.Pixbuf): void
    texSubImage2D(target: any, level: any, xoffset: any, yoffset: any, width: any, height: any, format: any, type: any, _pixels: Uint8Array): void
    texSubImage2DFromPixbuf(target: any, level: number, xoffset: number, yoffset: number, format: any, type: any, source: GdkPixbuf.Pixbuf): void
    uniform1fv(location: number, vLength: number, value: any[] | null): void
    uniform1iv(location: number, vLength: number, value: any[] | null): void
    uniform2fv(location: number, vLength: number, value: any[] | null): void
    uniform2iv(location: number, vLength: number, value: any[] | null): void
    uniform3fv(location: number, vLength: number, value: any[] | null): void
    uniform3iv(location: number, vLength: number, value: any[] | null): void
    uniform4fv(location: number, vLength: number, value: any[] | null): void
    uniform4iv(location: number, vLength: number, value: any[] | null): void
    uniformMatrix2fv(location: number, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix3fv(location: number, valueLength: number, transpose: any, value: any[] | null): void
    uniformMatrix4fv(location: number, valueLength: number, transpose: any, value: any[] | null): void
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