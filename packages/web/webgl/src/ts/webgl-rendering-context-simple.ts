import * as bits from 'bit-twiddle';
import tokenize from 'glsl-tokenizer/string';
import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import GdkPixbuf from '@gjsify/types/GdkPixbuf-2.0';
import { WebGLContextAttributes } from './webgl-context-attributes.js';
import { GjsifyHTMLCanvasElement } from './html-canvas-element';
// import { gl } from './native-gl.js';
import {
    flag,
    listToArray,
    unpackTypedArray,
} from './utils.js';


import type { WebGLConstants, TypedArray } from './types/index.js';
import { notImplemented } from '@gjsify/utils';


export interface GjsifyWebGLRenderingContextSimple extends WebGLConstants { }

export class GjsifyWebGLRenderingContextSimple implements WebGLRenderingContext {
    canvas: GjsifyHTMLCanvasElement & HTMLCanvasElement;

    get drawingBufferHeight() {
        return this.canvas.height || 0;
    }

    get drawingBufferWidth() {
        return this.canvas.width || 0;
    }

    _native: Gwebgl.WebGLRenderingContext;

    _contextAttributes: WebGLContextAttributes;

    constructor(canvas: GjsifyHTMLCanvasElement | HTMLCanvasElement | null, options: Gwebgl.WebGLRenderingContext.ConstructorProperties = {}, ) {
        this._native = new Gwebgl.WebGLRenderingContext(options); 
        this._initGLConstants();

        this.canvas = canvas as GjsifyHTMLCanvasElement & HTMLCanvasElement;

        this._contextAttributes = new WebGLContextAttributes(
            flag(options, 'alpha', true),
            flag(options, 'depth', true),
            flag(options, 'stencil', false),
            false, // flag(options, 'antialias', true),
            flag(options, 'premultipliedAlpha', true),
            flag(options, 'preserveDrawingBuffer', false),
            flag(options, 'preferLowPowerToHighPerformance', false),
            flag(options, 'failIfMajorPerformanceCaveat', false)
        )

        // Can only use premultipliedAlpha if alpha is set
        this._contextAttributes.premultipliedAlpha = this._contextAttributes.premultipliedAlpha && this._contextAttributes.alpha;

        return this;
    }

    _initGLConstants() {
        const giBaseClass = new Gwebgl.WebGLRenderingContextBase();
        const hash = giBaseClass.get_webgl_constants();
        for (const [k, v] of Object.entries(hash)) {
            Object.defineProperty(this, k, { value: v });
        }
    }

    _getGlslVersion(es: boolean) {
        return es ? '100' : '120';
    }

    _getParameterDirect(pname: GLenum): any {
        return this._native.getParameterx(pname)?.deepUnpack();
    }

    // @ts-ignore
    bufferData(target: number, data: number | Uint8Array | ArrayBufferView, usage: number) {
        if (typeof data == 'number') {
            this._native.bufferDataSizeOnly(target, data, usage);
        } else if (data === null) {
            // Not sure how this makes sense, but MDN says it can be NULL
            this._native.bufferDataSizeOnly(target, 0, usage);
        } else {
            if (!(data instanceof Uint8Array)) {
                if (data.buffer) {
                    data = new Uint8Array(data.buffer);
                } else {
                    const dataTypeName = data?.constructor?.name ?? typeof data;
                    throw new Error(`Can't buffer data from type ${dataTypeName}`);
                }
            }
            this._native.bufferData(target, data, usage);
        }
    }

    bufferSubData(target: GLenum = 0, offset: GLintptr = 0, data: BufferSource): void {
        const u8Data = unpackTypedArray(data as any)
        this._native.bufferSubData(target, offset, u8Data);
    }

    compressedTexImage2D(target: GLenum, level: GLint, internalFormat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: TypedArray): void {
        return this._native.compressedTexImage2D(target, level, internalFormat, width, height, border, unpackTypedArray(data));
    }

    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: TypedArray): void {
        return this._native.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, unpackTypedArray(data));
    }

    //texImage2D(target, level, internalformat, format, type, source);
    // @ts-ignore
    texImage2D(target: number, level: number, internalformat: number, width: number, height: number, border: number,
        format: number, type: number, source: number | any)
    {
        if (format === undefined && type === undefined && source === undefined)
        {
            format = width;
            type = height;
            source = border;
            // source must be a GdkPixbuf or have a gpixbuf member of that type
            source = source.gpixbuf ?? source;
            this._native.texImage2DFromPixbuf(target, level, internalformat, format,
                type, source);
        } else {
            this._native.texImage2D(target, level, internalformat, width, height,
                border, format, type, source);
        }
    }

    //texSubImage2D(target, level, xoffset, yoffset,
    //  internalformat, format, type, source);
    texSubImage2D(...args: any[])
    {

        notImplemented('texSubImage2D')
    }

    readPixels(x: number, y: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView | Uint8Array | number[] | null) {
        if (!pixels) {
            return;
        }
        // Gjs seems to copy byte arrays, so the wrapper needs to copy the
        // output buffer into the input.
        if (!(pixels instanceof Uint8Array)) {
            if ((pixels as ArrayBufferView).buffer) {
                pixels = new Uint8Array((pixels as ArrayBufferView).buffer);
            } else {
                // Assume pixels is a buffer, this should throw an error if it
                // isn't, which is the most sensible reaction
                pixels = new Uint8Array(pixels as number[]);
            }
        }
        let result = this._native.readPixels(x, y, width, height, format, type,
            pixels);
        // pixels and result are now both Uint8Array
        if ((result as Uint8Array).buffer != pixels.buffer) {
            (result as Uint8Array).set(result);
        }
    }


    ////////////// BASE //////////////

    activeTexture(texture: GLenum = 0): void {
        return this._native.activeTexture(texture);
    }

    attachShader(program: WebGLProgram, shader: WebGLShader): void {
        return this._native.attachShader(program as number, shader as number);
    }

    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void {
        return this._native.bindAttribLocation(program as number, index, name);
    }

    bindBuffer(target: GLenum = 0, buffer: WebGLBuffer | null): void {
        return this._native.bindBuffer(target, buffer as number || null);
    }

    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        return this._native.bindFramebuffer(target, framebuffer as number || null);
    }

    bindRenderbuffer(target: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        return this._native.bindRenderbuffer(target, renderbuffer as number || null);
    }

    bindTexture(target: GLenum = 0, texture: WebGLTexture | null): void {
        this._native.bindTexture(target, texture as number);
    }

    blendColor(red: GLclampf = 0, green: GLclampf = 0, blue: GLclampf = 0, alpha: GLclampf = 0): void {
        return this._native.blendColor(red, green, blue, alpha);
    }

    blendEquation(mode: GLenum = 0): void {
        return this._native.blendEquation(mode)
    }

    blendEquationSeparate(modeRGB: GLenum = 0, modeAlpha: GLenum = 0): void {
        return this._native.blendEquationSeparate(modeRGB, modeAlpha)
    }

    blendFunc(sfactor: GLenum = 0, dfactor: GLenum = 0): void {
        this._native.blendFunc(sfactor, dfactor)
    }

    blendFuncSeparate(srcRGB: GLenum = 0, dstRGB: GLenum = 0, srcAlpha: GLenum = 0, dstAlpha: GLenum = 0): void {
        this._native.blendFuncSeparate(
            srcRGB,
            dstRGB,
            srcAlpha,
            dstAlpha)
    }

    clear(mask: GLbitfield = 0): void {
        return this._native.clear(mask);
    }

    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return this._native.clearColor(red, green, blue, alpha);
    }

    clearDepth(depth: GLclampf): void {
        return this._native.clearDepth(+depth);
    }

    clearStencil(s: GLint = 0): void {
        return this._native.clearStencil(s);
    }

    colorMask(red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void {
        return this._native.colorMask(!!red, !!green, !!blue, !!alpha);
    }

    compileShader(shader: WebGLShader): void {
        this._native.compileShader(shader as number)
    }

    copyTexImage2D(target: GLenum = 0, level: GLint = 0, internalFormat: GLenum = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, border: GLint = 0): void {
        this._native.copyTexImage2D(
            target,
            level,
            internalFormat,
            x,
            y,
            width,
            height,
            border)
    }

    copyTexSubImage2D(target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        this._native.copyTexSubImage2D(
            target,
            level,
            xoffset,
            yoffset,
            x,
            y,
            width,
            height)
    }

    createBuffer(): WebGLBuffer | null {
        const id = this._native.createBuffer()
        return id;
    }

    createFramebuffer(): WebGLFramebuffer | null {
        return this._native.createFramebuffer()
    }

    createProgram(): WebGLProgram | null {
        return this._native.createProgram();
    }

    createRenderbuffer(): WebGLRenderbuffer | null {
        return this._native.createRenderbuffer() as WebGLRenderbuffer | null;
    }

    createShader(type: GLenum = 0): WebGLShader | null {
        return this._native.createShader(type);
    }

    createTexture(): WebGLTexture | null {
        return this._native.createTexture();
    }

    cullFace(mode: GLenum): void {
        return this._native.cullFace(mode);
    }

    deleteBuffer(buffer: number | null): void {
        return this._native.deleteBuffer(buffer || null);
    }

    deleteFramebuffer(framebuffer: number | null): void {
        return this._native.deleteFramebuffer(framebuffer || null);
    }

    deleteProgram(program: number): void {
        return this._native.deleteProgram(program || null);
    }

    deleteRenderbuffer(renderbuffer: number | null): void {
        return this._native.deleteRenderbuffer(renderbuffer || null);
    }

    deleteShader(shader: number | null): void {
        return this._native.deleteShader(shader || null);
    }

    deleteTexture(texture: number): void {
        return this._native.deleteTexture(texture);
    }

    depthFunc(func: GLenum): void {
        this._native.depthFunc(func);
    }

    depthMask(flag: GLboolean): void {
        return this._native.depthMask(!!flag);
    }

    depthRange(zNear: GLclampf, zFar: GLclampf): void {
        return this._native.depthRange(zNear, zFar);
    }

    destroy () {
        // this._native.destroy()
    }

    detachShader(program: number, shader: number): void {
        return this._native.detachShader(program, shader);
    }

    disable(cap: GLenum = 0): void {
        this._native.disable(cap);
    }

    disableVertexAttribArray(index: GLuint = 0): void {
        return this._native.disableVertexAttribArray(index);
    }

    drawArrays(mode: GLenum = 0, first: GLint = 0, count: GLsizei = 0): void {
        return this._native.drawArrays(mode, first, count);
    }

    drawElements(mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, ioffset: GLintptr = 0): void {
        return this._native.drawElements(mode, count, type, ioffset);
    }

    enable(cap: GLenum = 0): void {
        return this._native.enable(cap);
    }

    enableVertexAttribArray(index: GLuint): void {
        this._native.enableVertexAttribArray(index)
    }

    // Converts an ArrayBufferView to an array of bools. gjs returns
    // Uint8Array, but the elements are actually 4 bytes each.
    _boolArray(array: ArrayBufferView | number[] | boolean[]) {
        if(Array.isArray(array)) {
            return array.map(a => a ? true : false);
        }
        return Array.from(new Int32Array(array.buffer)).map(
            a => a ? true : false);
    }

    finish(): void {
        return this._native.finish();
    }
    flush(): void {
        return this._native.flush();
    }
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbufferTarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        return this._native.framebufferRenderbuffer(target, attachment, renderbufferTarget, renderbuffer as number || null);
    }
    framebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: number | null, level: GLint = 0): void {
        return this._native.framebufferTexture2D(target, attachment, textarget, texture || null, level);
    }
    frontFace(mode: GLenum = 0): void {
        return this._native.frontFace(mode);
    }
    generateMipmap(target: GLenum = 0): void {
        return this._native.generateMipmap(target);
    }

    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
        return this._native.getAttachedShaders(program as number) as WebGLShader[] | null;
    }

    getAttribLocation(program: WebGLProgram, name: string): GLint {
        return this._native.getAttribLocation(program as number, name);
    }

    getBufferParameter(target: number, pname: number) {
        return this._native.getBufferParameteriv(target, pname);
    }

    getParameter(pname: number) {
        switch (pname) {
            case this.ACTIVE_TEXTURE:
            case this.BLEND_DST_ALPHA:
            case this.BLEND_DST_RGB:
            case this.BLEND_EQUATION:
            case this.BLEND_EQUATION_ALPHA:
            case this.BLEND_EQUATION_RGB:
            case this.BLEND_SRC_ALPHA:
            case this.BLEND_SRC_RGB:
            case this.CULL_FACE_MODE:
            case this.DEPTH_FUNC:
            case this.FRONT_FACE:
            case this.GENERATE_MIPMAP_HINT:
            case this.IMPLEMENTATION_COLOR_READ_FORMAT:
            case this.IMPLEMENTATION_COLOR_READ_TYPE:
            case this.STENCIL_BACK_FAIL:
            case this.STENCIL_BACK_FUNC:
            case this.STENCIL_BACK_PASS_DEPTH_FAIL:
            case this.STENCIL_BACK_PASS_DEPTH_PASS:
            case this.STENCIL_FAIL:
            case this.STENCIL_FUNC:
            case this.STENCIL_PASS_DEPTH_FAIL:
            case this.STENCIL_PASS_DEPTH_PASS:
            //case this.UNPACK_COLORSPACE_CONVERSION_WEB:
            case this.ALPHA_BITS:
            case this.BLUE_BITS:
            case this.DEPTH_BITS:
            case this.GREEN_BITS:
            case this.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
            case this.MAX_CUBE_MAP_TEXTURE_SIZE:
            case this.MAX_FRAGMENT_UNIFORM_VECTORS:
            case this.MAX_RENDERBUFFER_SIZE:
            case this.MAX_TEXTURE_IMAGE_UNITS:
            case this.MAX_TEXTURE_SIZE:
            case this.MAX_VARYING_VECTORS:
            case this.MAX_VERTEX_ATTRIBS:
            case this.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
            case this.MAX_VERTEX_UNIFORM_VECTORS:
            case this.PACK_ALIGNMENT:
            case this.RED_BITS:
            case this.SAMPLE_BUFFERS:
            case this.SAMPLES:
            case this.STENCIL_BACK_REF:
            case this.STENCIL_BITS:
            case this.STENCIL_CLEAR_VALUE:
            case this.STENCIL_REF:
            case this.SUBPIXEL_BITS:
            case this.UNPACK_ALIGNMENT:
            case this.STENCIL_VALUE_MASK:
            case this.STENCIL_BACK_VALUE_MASK:
            case this.STENCIL_BACK_WRITEMASK:
            case this.STENCIL_WRITEMASK:
                return this._native.getParameteri(pname);
            case this.BLEND:
            case this.CULL_FACE:
            case this.DEPTH_TEST:
            case this.DEPTH_WRITEMASK:
            case this.DITHER:
            case this.POLYGON_OFFSET_FILL:
            case this.SAMPLE_COVERAGE_INVERT:
            case this.SCISSOR_TEST:
            case this.STENCIL_TEST:
            //case this.UNPACK_FLIP_Y_WEB:
            //case this.UNPACK_PREMULTIPLY_ALPHA_WEB:
                return this._native.getParameterb(pname) ? true : false;
            case this.ARRAY_BUFFER_BINDING:
            case this.ELEMENT_ARRAY_BUFFER_BINDING:
            case this.FRAMEBUFFER_BINDING:
            case this.RENDERBUFFER_BINDING:
            case this.CURRENT_PROGRAM:
            case this.TEXTURE_BINDING_2D:
            case this.TEXTURE_BINDING_CUBE_MAP:
                return this._native.getParameteri(pname) || null;
            case this.DEPTH_CLEAR_VALUE:
            case this.LINE_WIDTH:
            case this.POLYGON_OFFSET_FACTOR:
            case this.POLYGON_OFFSET_UNITS:
            case this.SAMPLE_COVERAGE_VALUE:
                return this._native.getParameterf(pname);
            case this.COLOR_WRITEMASK:
                return this._boolArray(this._native.getParameterbv(pname, 16));
                // return this._native.getParameterbv(pname, 16);
            case this.ALIASED_LINE_WIDTH_RANGE:
            case this.ALIASED_POINT_SIZE_RANGE:
            case this.DEPTH_RANGE:
                return new Float32Array(
                    this._native.getParameterfv(pname, 8));
            case this.BLEND_COLOR:
            case this.COLOR_CLEAR_VALUE:
                return new Float32Array(
                    this._native.getParameterfv(pname, 16));
            case this.COMPRESSED_TEXTURE_FORMATS:
                // TODO
                // const n = this._native.getParameteri(
                //     this.NUM_COMPRESSED_TEXTURE_FORMATS);
                // return new Uint32Array(
                //     this._native.getParameteriv(pname, n).buffer);
            case this.MAX_VIEWPORT_DIMS:
                return new Int32Array(
                    this._native.getParameteriv(pname, 8));
            case this.SCISSOR_BOX:
            case this.VIEWPORT:
                return new Int32Array(
                    this._native.getParameteriv(pname, 16));
            case this.RENDERER:
            case this.SHADING_LANGUAGE_VERSION:
            case this.VENDOR:
            case this.VERSION:
                return this._native.getString(pname);
        }
    }

    getProgramInfoLog(program: WebGLProgram): string | null {
        return this._native.getProgramInfoLog(program as number);
    }

    getProgramParameter(program: WebGLProgram, pname: GLenum = 0): any {
        return this._native.getProgramParameter(program as number, pname);
    }

    getRenderbufferParameter(target: GLenum = 0, pname: GLenum = 0): any {
        return this._native.getProgramParameter(target, pname);
    }

    getShaderInfoLog(shader: WebGLShader): string | null {
        return this._native.getShaderInfoLog(shader as number);
    }

    getShaderParameter(shader: WebGLShader, pname: GLenum = 0): any {
        return this._native.getShaderParameter(shader as number, pname);
    }

    getShaderPrecisionFormat(shaderType: GLenum = 0, precisionType: GLenum = 0): WebGLShaderPrecisionFormat | null {
        return this._native.getShaderPrecisionFormat(shaderType, precisionType);
    }

    getShaderSource(shader: WebGLShader): string | null {
        return this._native.getShaderSource(shader as number);
    }

    getSupportedExtensions() {
        const supportedExts = this._native.getSupportedExtensions();
        return supportedExts;
    }

    getActiveAttrib(program: number, index: number) {
        const info = this._native.getActiveAttrib(program, index);
        console.log("TODO check result getActiveAttrib", info);
        return info;
        // return {type: info[0], size: info[1], name: info[2]};
    }

    getActiveUniform(program: number, index: number) {
        const info = this._native.getActiveUniform(program, index);
        console.log("TODO check result getActiveUniform", info);
        return info;
        // return {size: info[0], type: info[1], name: info[2]};
    }

    // TODO: With extensions or WebGL 2 this will sometimes need to call
    // the float version
    getTexParameter(target: number, pname: number) {
        return this._native.getTexParameteriv(target, pname);
    }

    getUniform(program: number, location: number) {
        const info = this.getActiveUniform(program, location);
        if (info.size < 1) {
            info.size = 1;
        }
        console.log(`Uniform ${info.name} size ${info.size} type ${info.type}`);
        switch (info.type) {
            case this.FLOAT:
                if (info.size == 1) {
                    return this._native.getUniformf(program, location);
                } else {
                    return new Float32Array(
                        this._native.getUniformfv(
                            program, location, 4 * info.size));
                }
            case this.FLOAT_VEC2:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 8 * info.size));
            case this.FLOAT_VEC3:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 12 * info.size));
            case this.FLOAT_VEC4:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 16 * info.size));
            case this.SAMPLER_2D:
            case this.SAMPLER_CUBE:
            case this.INT:
                if (info.size == 1) {
                    return this._native.getUniformi(program, location);
                } else {
                    return new Int32Array(
                        this._native.getUniformiv(
                            program, location, 4 * info.size));
                }
            case this.INT_VEC2:
                return new Int32Array(
                    this._native.getUniformiv(
                        program, location, 8 * info.size));
            case this.INT_VEC3:
                return new Int32Array(
                    this._native.getUniformiv(
                        program, location, 12 * info.size));
            case this.INT_VEC4:
                return new Int32Array(
                    this._native.getUniformiv(
                        program, location, 16 * info.size));
            case this.BOOL:
                if (info.size == 1) {
                    return this._native.getUniformi(program, location) ?
                        true : false;
                } else {
                    return this._boolArray(
                        this._native.getUniformiv(
                            program, location, 4 * info.size));
                }
            case this.BOOL_VEC2:
                return this._boolArray(
                    this._native.getUniformiv(program, location, 8 * info.size));
            case this.BOOL_VEC3:
                return this._boolArray(
                    this._native.getUniformiv(program, location, 12 * info.size));
            case this.BOOL_VEC4:
                return this._boolArray(
                    this._native.getUniformiv(program, location, 16 * info.size));
            case this.FLOAT_MAT2:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 16 * info.size));
            case this.FLOAT_MAT3:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 36 * info.size));
            case this.FLOAT_MAT4:
                return new Float32Array(
                    this._native.getUniformfv(
                        program, location, 64 * info.size));
        }
    }

    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
        return this._native.getUniformLocation(program as number, name) as WebGLUniformLocation | null;
    }

    getVertexAttrib(index: number, pname: number) {
        switch (pname) {
            case this.VERTEX_ATTRIB_ARRAY_ENABLED:
            case this.VERTEX_ATTRIB_ARRAY_NORMALIZED:
                return this._native.getVertexAttribi(index, pname) ? true : false;
            case this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
            case this.VERTEX_ATTRIB_ARRAY_SIZE:
            case this.VERTEX_ATTRIB_ARRAY_STRIDE:
            case this.VERTEX_ATTRIB_ARRAY_TYPE:
                return this._native.getVertexAttribi(index, pname);
            case this.CURRENT_VERTEX_ATTRIB:
                return new Float32Array(
                    this._native.getVertexAttribfv(index, pname, 16));
        }
    }

    getVertexAttribOffset(index: GLuint = 0, pname: GLenum = 0): GLintptr {
        return this._native.getVertexAttribOffset(index, pname);
    }

    hint(target: GLenum = 0, mode: GLenum = 0): void {
        return this._native.hint(target, mode);
    }

    isBuffer(buffer: WebGLBuffer | null): GLboolean {
        return this._native.isBuffer(buffer as number || null);
    }
    isContextLost(): boolean {
        return false;
    }
    isEnabled(cap: GLenum): GLboolean {
        return this._native.isEnabled(cap);
    }
    isFramebuffer(framebuffer: WebGLShader | null): GLboolean {
        return this._native.isFramebuffer(framebuffer as number || null)
    }
    isProgram(program: WebGLProgram | null): GLboolean {
        return this._native.isProgram(program as number || null)
    }
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): GLboolean {
        return this._native.isRenderbuffer(renderbuffer as number || null);
    }
    isShader(shader: WebGLShader | null): GLboolean {
        return this._native.isShader(shader as number || null);
    }
    isTexture(texture: WebGLTexture | null): GLboolean {
        return this._native.isTexture(texture as number || null);
    }

    lineWidth(width: GLfloat): void {
        return this._native.lineWidth(width);
    }

    linkProgram(program: WebGLProgram): void {
        return this._native.linkProgram(program as number);
    }

    shaderSource(shader: number, source: string) {

        if (this.canvas && !(source.startsWith('#version') ||
            source.includes('\n#version')))
        {
            const es = this.canvas._getGlArea().get_context()?.get_use_es() || false;
            let version = this.get_glsl_version(es);
            if (version) {
                version = '#version ' + version;
                if (!source.startsWith('\n')) {
                    version += '\n';
                }
                source = version + source;
            }
        }

        console.log("shaderSource", shader, source);

        this._native.shaderSource(shader, source);
    }

    get_glsl_version(es: boolean) {
        return es ? '100' : '120';
    }

    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        return this._native.stencilFunc(func, ref, mask);
    }

    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void {
        return this._native.stencilFuncSeparate(face, func, ref, mask);
    }

    stencilMask(mask: GLuint): void {
        return this._native.stencilMask(mask);
    }

    stencilMaskSeparate(face: GLenum, mask: GLuint): void {
        return this._native.stencilMaskSeparate(face, mask);
    }

    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        return this._native.stencilOp(fail, zfail, zpass);
    }

    stencilOpSeparate(face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        return this._native.stencilOpSeparate(face, fail, zfail, zpass);
    }

    texParameterf(target: GLenum = 0, pname: GLenum = 0, param: GLfloat): void {
        return this._native.texParameterf(target, pname, param);
    }

    uniform1f(location: number, x: GLfloat): void {
        return this._native.uniform1f(location, x);
    }
    uniform1i(location: number, x: GLint): void {
        return this._native.uniform1i(location, x);
    }
    uniform2f(location: number, x: GLfloat, y: GLfloat): void {
        return this._native.uniform2f(location, x, y);
    }
    uniform2i(location: number, x: GLint, y: GLint): void {
        this._native.uniform2i(location, x, y);
    }
    uniform3f(location: number, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return this._native.uniform3f(location, x, y, z);
    }
    uniform3i(location: number, x: GLint, y: GLint, z: GLint): void {
        return this._native.uniform3i(location, x, y, z);
    }
    uniform4f(location: number, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return this._native.uniform4f(location, x, y, z, w);
    }
    uniform4i(location: number, x: GLint, y: GLint, z: GLint, w: GLint): void {
        return this._native.uniform4i(location, x, y, z, w);
    }

    useProgram(program: number | null): void {
        return this._native.useProgram(program || null);
    }
    validateProgram(program: number): void {
        return this._native.validateProgram(program);
    }
    vertexAttrib1f(index: GLuint, x: GLfloat): void {
        return this._native.vertexAttrib1f(index, x);
    }
    vertexAttrib1fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib1fv(index, listToArray(values));
    }
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void {
        return this._native.vertexAttrib2f(index, x, y);
    }
    vertexAttrib2fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib2fv(index, listToArray(values));
    }
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return this._native.vertexAttrib3f(index, x, y, z);
    }
    vertexAttrib3fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib3fv(index, listToArray(values));
    }
    vertexAttrib4f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return this._native.vertexAttrib4f(index, x, y, z, w);
    }
    vertexAttrib4fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib4fv(index, listToArray(values));
    }
    vertexAttribPointer(index: GLuint, size: GLint, type: GLenum, normalized: GLboolean, stride: GLsizei, offset: GLintptr): void {
        return this._native.vertexAttribPointer(index, size, type, normalized, stride, offset);
    }
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return this._native.viewport(x, y, width, height);
    }
}

export { GjsifyWebGLRenderingContextSimple as WebGLRenderingContext }