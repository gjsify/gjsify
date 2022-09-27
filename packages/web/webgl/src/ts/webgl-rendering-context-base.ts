// LD_LIBRARY_PATH=build GI_TYPELIB_PATH=build gjs -m test.js

import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import { WebGLBuffer, WebGLProgram, WebGLRenderbuffer, WebGLShader, WebGLTexture, WebGLUniformLocation, WebGLActiveInfo, WebGLShaderPrecisionFormat } from './types/index.js';
import { GjsifyHTMLCanvasElement } from './html-canvas-element.js';
import { warnNotImplemented } from '@gjsify/utils';
import { float32ListToArray } from './utils.js';


export class GjsifyWebGLRenderingContextBase extends Gwebgl.WebGLRenderingContextBase implements WebGLRenderingContextBase {
    readonly canvas: HTMLCanvasElement = null as any as HTMLCanvasElement; // TODO
    readonly drawingBufferHeight: GLsizei = 0;
    readonly drawingBufferWidth: GLsizei = 0;

    constructor() {
        super();
        this._initGLConstants();        
    }

    _initGLConstants() {
        const giBaseClass = new Gwebgl.WebGLRenderingContextBase(); 
        const hash = giBaseClass.get_webgl_constants();
        for (const [k, v] of Object.entries(hash)) {
            Object.defineProperty(this, k, {value: v});
        }
    }
    
    activeTexture(texture: GLenum): void {
        return super.activeTexture(texture);
    }
    attachShader(program: WebGLProgram, shader: WebGLShader): void {
        return super.attachShader(program, shader);
    }
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void {
        return super.bindAttribLocation(program, index, name);
    }
    bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
        return super.bindBuffer(target, buffer);
    }
    bindFramebuffer(target: GLenum, framebuffer: WebGLShader | null): void {
        return super.bindFramebuffer(target, framebuffer);
    }
    bindRenderbuffer(target: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        return super.bindRenderbuffer(target, renderbuffer);
    }
    bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        return super.bindTexture(target, texture);
    }
    blendColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return super.blendColor(red, green, blue, alpha);
    }
    blendEquation(mode: GLenum): void {
        return super.blendEquation(mode);
    }
    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void {
        return super.blendEquationSeparate(modeRGB, modeAlpha);
    }
    blendFunc(sfactor: GLenum, dfactor: GLenum): void {
        return super.blendFunc(sfactor, dfactor);
    }
    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void {
        return super.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
    }
    checkFramebufferStatus(target: GLenum): GLenum {
        return super.checkFramebufferStatus(target);
    }
    clear(mask: GLbitfield): void {
        return super.clear(mask);
    }
    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return super.clearColor(red, green, blue, alpha);
    }
    clearDepth(depth: GLclampf): void {
        return super.clearDepth(depth);
    }
    clearStencil(s: GLint): void {
        return super.clearStencil(s);
    }
    colorMask(red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void {
        return super.colorMask(red, green, blue, alpha);
    }
    compileShader(shader: WebGLShader): void {
        return super.compileShader(shader);
    }
    copyTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, x: GLint, y: GLint, width: GLsizei, height: GLsizei, border: GLint): void {
        return super.copyTexImage2D(target, level, internalformat, x, y, width, height, border);
    }
    copyTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return super.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    }
    createBuffer(): WebGLBuffer | null {
        return super.createBuffer();
    }
    createFramebuffer(): WebGLShader | null {
        return super.createFramebuffer();
    }
    createProgram(): WebGLProgram | null {
        return super.createProgram();
    }
    createRenderbuffer(): WebGLRenderbuffer | null {
        return super.createRenderbuffer();
    }
    createShader(type: GLenum): WebGLShader | null {
        return super.createShader(type);
    }
    createTexture(): WebGLTexture | null {
        return super.createTexture();
    }
    cullFace(mode: GLenum): void {
        return super.cullFace(mode);
    }
    deleteBuffer(buffer: WebGLBuffer | null): void {
        return super.deleteBuffer(buffer);
    }
    deleteFramebuffer(framebuffer: WebGLShader | null): void {
        return super.deleteFramebuffer(framebuffer);
    }
    deleteProgram(program: WebGLProgram | null): void {
        return super.deleteProgram(program);
    }
    deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
        return super.deleteRenderbuffer(renderbuffer);
    }
    deleteShader(shader: WebGLShader | null): void {
        return super.deleteShader(shader);
    }
    deleteTexture(texture: WebGLTexture | null): void {
        return super.deleteTexture(texture);
    }
    depthFunc(func: GLenum): void {
        return super.depthFunc(func);
    }
    depthMask(flag: GLboolean): void {
        return super.depthMask(flag);
    }
    depthRange(zNear: GLclampf, zFar: GLclampf): void {
        return super.depthRange(zNear, zFar);
    }
    detachShader(program: WebGLProgram, shader: WebGLShader): void {
        return super.detachShader(program, shader);
    }
    disable(cap: GLenum): void {
        return super.disable(cap);
    }
    disableVertexAttribArray(index: GLuint): void {
        return super.disableVertexAttribArray(index);
    }
    drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
        return super.drawArrays(mode, first, count);
    }
    drawElements(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr): void {
        return super.drawElements(mode, count, type, offset);
    }
    enable(cap: GLenum): void {
        return super.enable(cap);
    }
    enableVertexAttribArray(index: GLuint): void {
        return super.enableVertexAttribArray(index);
    }
    finish(): void {
        return super.finish();
    }
    flush(): void {
        return super.flush();
    }
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbuffertarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        return super.framebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer);
    }
    framebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: WebGLTexture | null, level: GLint): void {
        return super.framebufferTexture2D(target, attachment, textarget, texture, level);
    }
    frontFace(mode: GLenum): void {
        return super.frontFace(mode);
    }
    generateMipmap(target: GLenum): void {
        return super.generateMipmap(target);
    }
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        return super.getActiveAttrib(program, index);
    }
    getActiveUniform(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        return super.getActiveUniform(program, index);
    }
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
        return super.getAttachedShaders(program) as WebGLShader[] | null;
    }
    getAttribLocation(program: WebGLProgram, name: string): GLint {
        return super.getAttribLocation(program, name);
    }
    getBufferParameter(target: GLenum, pname: GLenum): any {
        return super.getBufferParameter(target, pname);
    }
    /**
     * The `WebGLRenderingContext.getContextAttributes()` method returns a `WebGLContextAttributes` object that contains the actual context parameters.
     * Might return `null`, if the context is lost. 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes
     * @returns A `WebGLContextAttributes` object that contains the actual context parameters, or `null` if the context is lost. 
     */
    getContextAttributes(): WebGLContextAttributes | null {
        // TODO
        warnNotImplemented('GjsifyWebGLRenderingContextBase.getContextAttributes');
        return {}
    }
    getError(): GLenum {
        return super.getError();
    }
    getExtension(extensionName: "EXT_blend_minmax"): EXT_blend_minmax | null;
    getExtension(extensionName: "EXT_color_buffer_float"): EXT_color_buffer_float | null;
    getExtension(extensionName: "EXT_color_buffer_half_float"): EXT_color_buffer_half_float | null;
    getExtension(extensionName: "EXT_float_blend"): EXT_float_blend | null;
    getExtension(extensionName: "EXT_texture_filter_anisotropic"): EXT_texture_filter_anisotropic | null;
    getExtension(extensionName: "EXT_frag_depth"): EXT_frag_depth | null;
    getExtension(extensionName: "EXT_shader_texture_lod"): EXT_shader_texture_lod | null;
    getExtension(extensionName: "EXT_sRGB"): EXT_sRGB | null;
    getExtension(extensionName: "KHR_parallel_shader_compile"): KHR_parallel_shader_compile | null;
    getExtension(extensionName: "OES_vertex_array_object"): OES_vertex_array_object | null;
    getExtension(extensionName: "OVR_multiview2"): OVR_multiview2 | null;
    getExtension(extensionName: "WEBGL_color_buffer_float"): WEBGL_color_buffer_float | null;
    getExtension(extensionName: "WEBGL_compressed_texture_astc"): WEBGL_compressed_texture_astc | null;
    getExtension(extensionName: "WEBGL_compressed_texture_etc"): WEBGL_compressed_texture_etc | null;
    getExtension(extensionName: "WEBGL_compressed_texture_etc1"): WEBGL_compressed_texture_etc1 | null;
    getExtension(extensionName: "WEBGL_compressed_texture_s3tc_srgb"): WEBGL_compressed_texture_s3tc_srgb | null;
    getExtension(extensionName: "WEBGL_debug_shaders"): WEBGL_debug_shaders | null;
    getExtension(extensionName: "WEBGL_draw_buffers"): WEBGL_draw_buffers | null;
    getExtension(extensionName: "WEBGL_lose_context"): WEBGL_lose_context | null;
    getExtension(extensionName: "WEBGL_depth_texture"): WEBGL_depth_texture | null;
    getExtension(extensionName: "WEBGL_debug_renderer_info"): WEBGL_debug_renderer_info | null;
    getExtension(extensionName: "WEBGL_compressed_texture_s3tc"): WEBGL_compressed_texture_s3tc | null;
    getExtension(extensionName: "OES_texture_half_float_linear"): OES_texture_half_float_linear | null;
    getExtension(extensionName: "OES_texture_half_float"): OES_texture_half_float | null;
    getExtension(extensionName: "OES_texture_float_linear"): OES_texture_float_linear | null;
    getExtension(extensionName: "OES_texture_float"): OES_texture_float | null;
    getExtension(extensionName: "OES_standard_derivatives"): OES_standard_derivatives | null;
    getExtension(extensionName: "OES_element_index_uint"): OES_element_index_uint | null;
    getExtension(extensionName: "ANGLE_instanced_arrays"): ANGLE_instanced_arrays | null;
    getExtension(name: string): any {
        warnNotImplemented('GjsifyWebGLRenderingContextBase.getExtension')
        // return super.getExtension(name);
    }
    getFramebufferAttachmentParameter(target: GLenum, attachment: GLenum, pname: GLenum): any {
        return super.getFramebufferAttachmentParameter(target, attachment, pname);
    }
    getParameter(pname: GLenum): any {
        return super.getParameterx(pname)?.deepUnpack() || null;
    }
    getProgramInfoLog(program: WebGLProgram): string | null {
        return super.getProgramInfoLog(program);
    }
    getProgramParameter(program: WebGLProgram, pname: GLenum): any {
        return super.getProgramParameter(program, pname);
    }
    getRenderbufferParameter(target: GLenum, pname: GLenum): any {
        return super.getProgramParameter(target, pname);
    }
    getShaderInfoLog(shader: WebGLShader): string | null {
        return super.getShaderInfoLog(shader);
    }
    getShaderParameter(shader: WebGLShader, pname: GLenum): any {
        return super.getShaderParameter(shader, pname);
    }
    getShaderPrecisionFormat(shadertype: GLenum, precisiontype: GLenum): WebGLShaderPrecisionFormat | null {
        return super.getShaderPrecisionFormat(shadertype, precisiontype);
    }
    getShaderSource(shader: WebGLShader): string | null {
        return super.getShaderSource(shader);
    }
    getSupportedExtensions(): string[] | null {
        return super.getSupportedExtensions();
    }
    getTexParameter(target: GLenum, pname: GLenum): any {
        return super.getTexParameterx(target, pname)?.unpack();
    }
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
        return super.getUniform(program, location);
    }
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
        return super.getUniformLocation(program, name) as WebGLUniformLocation | null;
    }
    getVertexAttrib(index: GLuint, pname: GLenum): any {
        return super.getVertexAttrib(index, pname);
    }
    getVertexAttribOffset(index: GLuint, pname: GLenum): GLintptr {
        return super.getVertexAttribOffset(index, pname);
    }
    hint(target: GLenum, mode: GLenum): void {
        return super.hint(target, mode);
    }
    isBuffer(buffer: WebGLBuffer | null): GLboolean {
        return super.isBuffer(buffer);
    }
    isContextLost(): boolean {
        return false;
    }
    isEnabled(cap: GLenum): GLboolean {
        return super.isEnabled(cap);
    }
    isFramebuffer(framebuffer: WebGLShader | null): GLboolean {
        return super.isFramebuffer(framebuffer);
    }
    isProgram(program: WebGLProgram | null): GLboolean {
        return super.isProgram(program);
    }
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): GLboolean {
        return super.isRenderbuffer(renderbuffer);
    }
    isShader(shader: WebGLShader | null): GLboolean {
        return super.isShader(shader);
    }
    isTexture(texture: WebGLTexture | null): GLboolean {
        return super.isTexture(texture);
    }
    lineWidth(width: GLfloat): void {
        return super.lineWidth(width);
    }
    linkProgram(program: WebGLProgram): void {
        return super.linkProgram(program);
    }
    /** The `WebGLRenderingContext.pixelStorei()` method of the WebGL API specifies the pixel storage modes. */
    pixelStorei(pname: GLenum, param: GLint | GLboolean): void {
        if(typeof param === 'boolean') {
            param = param === false ? 0 : 1;
        }
        return super.pixelStorei(pname, param);
    }
    polygonOffset(factor: GLfloat, units: GLfloat): void {
        return super.polygonOffset(factor, units);
    }
    renderbufferStorage(target: GLenum, internalformat: GLenum, width: GLsizei, height: GLsizei): void {
        return super.renderbufferStorage(target, internalformat, width, height);
    }
    sampleCoverage(value: GLclampf, invert: GLboolean): void {
        return super.sampleCoverage(value, invert);
    }
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return super.scissor(x, y, width, height);
    }
    shaderSource(shader: WebGLShader, source: string): void {
        return super.shaderSource(shader, source);
    }
    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        return super.stencilFunc(func, ref, mask);
    }
    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void {
        return super.stencilFuncSeparate(func, func, ref, mask);
    }
    stencilMask(mask: GLuint): void {
        return super.stencilMask(mask);
    }
    stencilMaskSeparate(face: GLenum, mask: GLuint): void {
        return super.stencilMaskSeparate(face, mask);
    }
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        return super.stencilOp(fail, zfail, zpass);
    }
    stencilOpSeparate(face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        return super.stencilOpSeparate(face, fail, zfail, zpass);
    }
    texParameterf(target: GLenum, pname: GLenum, param: GLfloat): void {
        return super.texParameterf(target, pname, param);
    }
    texParameteri(target: GLenum, pname: GLenum, param: GLint): void {
        return super.texParameteri(target, pname, param);
    }
    uniform1f(location: WebGLUniformLocation | null, x: GLfloat): void {
        return super.uniform1f(location, x);
    }
    uniform1i(location: WebGLUniformLocation | null, x: GLint): void {
        return super.uniform1i(location, x);
    }
    uniform2f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void {
        return super.uniform2f(location, x, y);
    }
    uniform2i(location: WebGLUniformLocation | null, x: GLint, y: GLint): void {
        return super.uniform2i(location, x, y);
    }
    uniform3f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return super.uniform3f(location, x, y, z);
    }
    uniform3i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void {
        return super.uniform3i(location, x, y, z);
    }
    uniform4f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return super.uniform4f(location, x, y, z, w);
    }
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void {
        return super.uniform4i(location, x, y, z, w);
    }
    useProgram(program: WebGLProgram | null): void {
        return super.useProgram(program);
    }
    validateProgram(program: WebGLProgram): void {
        return super.validateProgram(program);
    }
    vertexAttrib1f(index: GLuint, x: GLfloat): void {
        return super.vertexAttrib1f(index, x);
    }
    vertexAttrib1fv(index: GLuint, values: Float32List): void {
        return super.vertexAttrib1fv(index, float32ListToArray(values));
    }
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void {
        return super.vertexAttrib2f(index, x, y);
    }
    vertexAttrib2fv(index: GLuint, values: Float32List): void {
        return super.vertexAttrib2fv(index, float32ListToArray(values));
    }
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return super.vertexAttrib3f(index, x, y, z);
    }
    vertexAttrib3fv(index: GLuint, values: Float32List): void {
        return super.vertexAttrib3fv(index, float32ListToArray(values));
    }
    vertexAttrib4f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return super.vertexAttrib4f(index, x, y, z, w);
    }
    vertexAttrib4fv(index: GLuint, values: Float32List): void {
        return super.vertexAttrib4fv(index, float32ListToArray(values));
    }
    vertexAttribPointer(index: GLuint, size: GLint, type: GLenum, normalized: GLboolean, stride: GLsizei, offset: GLintptr): void {
        return super.vertexAttribPointer(index, size, type, normalized, stride, offset);
    }
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return super.viewport(x, y, width, height);
    }

    readonly ACTIVE_ATTRIBUTES: GLenum = 0;
    readonly ACTIVE_TEXTURE: GLenum = 0;
    readonly ACTIVE_UNIFORMS: GLenum = 0;
    readonly ALIASED_LINE_WIDTH_RANGE: GLenum = 0;
    readonly ALIASED_POINT_SIZE_RANGE: GLenum = 0;
    readonly ALPHA: GLenum = 0;
    readonly ALPHA_BITS: GLenum = 0;
    readonly ALWAYS: GLenum = 0;
    readonly ARRAY_BUFFER: GLenum = 0;
    readonly ARRAY_BUFFER_BINDING: GLenum = 0;
    readonly ATTACHED_SHADERS: GLenum = 0;
    readonly BACK: GLenum = 0;
    readonly BLEND: GLenum = 0;
    readonly BLEND_COLOR: GLenum = 0;
    readonly BLEND_DST_ALPHA: GLenum = 0;
    readonly BLEND_DST_RGB: GLenum = 0;
    readonly BLEND_EQUATION: GLenum = 0;
    readonly BLEND_EQUATION_ALPHA: GLenum = 0;
    readonly BLEND_EQUATION_RGB: GLenum = 0;
    readonly BLEND_SRC_ALPHA: GLenum = 0;
    readonly BLEND_SRC_RGB: GLenum = 0;
    readonly BLUE_BITS: GLenum = 0;
    readonly BOOL: GLenum = 0;
    readonly BOOL_VEC2: GLenum = 0;
    readonly BOOL_VEC3: GLenum = 0;
    readonly BOOL_VEC4: GLenum = 0;
    readonly BROWSER_DEFAULT_WEBGL: GLenum = 0;
    readonly BUFFER_SIZE: GLenum = 0;
    readonly BUFFER_USAGE: GLenum = 0;
    readonly BYTE: GLenum = 0;
    readonly CCW: GLenum = 0;
    readonly CLAMP_TO_EDGE: GLenum = 0;
    readonly COLOR_ATTACHMENT0: GLenum = 0;
    readonly COLOR_BUFFER_BIT: GLenum = 0;
    readonly COLOR_CLEAR_VALUE: GLenum = 0;
    readonly COLOR_WRITEMASK: GLenum = 0;
    readonly COMPILE_STATUS: GLenum = 0;
    readonly COMPRESSED_TEXTURE_FORMATS: GLenum = 0;
    readonly CONSTANT_ALPHA: GLenum = 0;
    readonly CONSTANT_COLOR: GLenum = 0;
    readonly CONTEXT_LOST_WEBGL: GLenum = 0;
    readonly CULL_FACE: GLenum = 0;
    readonly CULL_FACE_MODE: GLenum = 0;
    readonly CURRENT_PROGRAM: GLenum = 0;
    readonly CURRENT_VERTEX_ATTRIB: GLenum = 0;
    readonly CW: GLenum = 0;
    readonly DECR: GLenum = 0;
    readonly DECR_WRAP: GLenum = 0;
    readonly DELETE_STATUS: GLenum = 0;
    readonly DEPTH_ATTACHMENT: GLenum = 0;
    readonly DEPTH_BITS: GLenum = 0;
    readonly DEPTH_BUFFER_BIT: GLenum = 0;
    readonly DEPTH_CLEAR_VALUE: GLenum = 0;
    readonly DEPTH_COMPONENT: GLenum = 0;
    readonly DEPTH_COMPONENT16: GLenum = 0;
    readonly DEPTH_FUNC: GLenum = 0;
    readonly DEPTH_RANGE: GLenum = 0;
    readonly DEPTH_STENCIL: GLenum = 0;
    readonly DEPTH_STENCIL_ATTACHMENT: GLenum = 0;
    readonly DEPTH_TEST: GLenum = 0;
    readonly DEPTH_WRITEMASK: GLenum = 0;
    readonly DITHER: GLenum = 0;
    readonly DONT_CARE: GLenum = 0;
    readonly DST_ALPHA: GLenum = 0;
    readonly DST_COLOR: GLenum = 0;
    readonly DYNAMIC_DRAW: GLenum = 0;
    readonly ELEMENT_ARRAY_BUFFER: GLenum = 0;
    readonly ELEMENT_ARRAY_BUFFER_BINDING: GLenum = 0;
    readonly EQUAL: GLenum = 0;
    readonly FASTEST: GLenum = 0;
    readonly FLOAT: GLenum = 0;
    readonly FLOAT_MAT2: GLenum = 0;
    readonly FLOAT_MAT3: GLenum = 0;
    readonly FLOAT_MAT4: GLenum = 0;
    readonly FLOAT_VEC2: GLenum = 0;
    readonly FLOAT_VEC3: GLenum = 0;
    readonly FLOAT_VEC4: GLenum = 0;
    readonly FRAGMENT_SHADER: GLenum = 0;
    readonly FRAMEBUFFER: GLenum = 0;
    readonly FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: GLenum = 0;
    readonly FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: GLenum = 0;
    readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: GLenum = 0;
    readonly FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: GLenum = 0;
    readonly FRAMEBUFFER_BINDING: GLenum = 0;
    readonly FRAMEBUFFER_COMPLETE: GLenum = 0;
    readonly FRAMEBUFFER_INCOMPLETE_ATTACHMENT: GLenum = 0;
    readonly FRAMEBUFFER_INCOMPLETE_DIMENSIONS: GLenum = 0;
    readonly FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: GLenum = 0;
    readonly FRAMEBUFFER_UNSUPPORTED: GLenum = 0;
    readonly FRONT: GLenum = 0;
    readonly FRONT_AND_BACK: GLenum = 0;
    readonly FRONT_FACE: GLenum = 0;
    readonly FUNC_ADD: GLenum = 0;
    readonly FUNC_REVERSE_SUBTRACT: GLenum = 0;
    readonly FUNC_SUBTRACT: GLenum = 0;
    readonly GENERATE_MIPMAP_HINT: GLenum = 0;
    readonly GEQUAL: GLenum = 0;
    readonly GREATER: GLenum = 0;
    readonly GREEN_BITS: GLenum = 0;
    readonly HIGH_FLOAT: GLenum = 0;
    readonly HIGH_INT: GLenum = 0;
    readonly IMPLEMENTATION_COLOR_READ_FORMAT: GLenum = 0;
    readonly IMPLEMENTATION_COLOR_READ_TYPE: GLenum = 0;
    readonly INCR: GLenum = 0;
    readonly INCR_WRAP: GLenum = 0;
    readonly INT: GLenum = 0;
    readonly INT_VEC2: GLenum = 0;
    readonly INT_VEC3: GLenum = 0;
    readonly INT_VEC4: GLenum = 0;
    readonly INVALID_ENUM: GLenum = 0;
    readonly INVALID_FRAMEBUFFER_OPERATION: GLenum = 0;
    readonly INVALID_OPERATION: GLenum = 0;
    readonly INVALID_VALUE: GLenum = 0;
    readonly INVERT: GLenum = 0;
    readonly KEEP: GLenum = 0;
    readonly LEQUAL: GLenum = 0;
    readonly LESS: GLenum = 0;
    readonly LINEAR: GLenum = 0;
    readonly LINEAR_MIPMAP_LINEAR: GLenum = 0;
    readonly LINEAR_MIPMAP_NEAREST: GLenum = 0;
    readonly LINES: GLenum = 0;
    readonly LINE_LOOP: GLenum = 0;
    readonly LINE_STRIP: GLenum = 0;
    readonly LINE_WIDTH: GLenum = 0;
    readonly LINK_STATUS: GLenum = 0;
    readonly LOW_FLOAT: GLenum = 0;
    readonly LOW_INT: GLenum = 0;
    readonly LUMINANCE: GLenum = 0;
    readonly LUMINANCE_ALPHA: GLenum = 0;
    readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS: GLenum = 0;
    readonly MAX_CUBE_MAP_TEXTURE_SIZE: GLenum = 0;
    readonly MAX_FRAGMENT_UNIFORM_VECTORS: GLenum = 0;
    readonly MAX_RENDERBUFFER_SIZE: GLenum = 0;
    readonly MAX_TEXTURE_IMAGE_UNITS: GLenum = 0;
    readonly MAX_TEXTURE_SIZE: GLenum = 0;
    readonly MAX_VARYING_VECTORS: GLenum = 0;
    readonly MAX_VERTEX_ATTRIBS: GLenum = 0;
    readonly MAX_VERTEX_TEXTURE_IMAGE_UNITS: GLenum = 0;
    readonly MAX_VERTEX_UNIFORM_VECTORS: GLenum = 0;
    readonly MAX_VIEWPORT_DIMS: GLenum = 0;
    readonly MEDIUM_FLOAT: GLenum = 0;
    readonly MEDIUM_INT: GLenum = 0;
    readonly MIRRORED_REPEAT: GLenum = 0;
    readonly NEAREST: GLenum = 0;
    readonly NEAREST_MIPMAP_LINEAR: GLenum = 0;
    readonly NEAREST_MIPMAP_NEAREST: GLenum = 0;
    readonly NEVER: GLenum = 0;
    readonly NICEST: GLenum = 0;
    readonly NONE: GLenum = 0;
    readonly NOTEQUAL: GLenum = 0;
    readonly NO_ERROR: GLenum = 0;
    readonly ONE: GLenum = 0;
    readonly ONE_MINUS_CONSTANT_ALPHA: GLenum = 0;
    readonly ONE_MINUS_CONSTANT_COLOR: GLenum = 0;
    readonly ONE_MINUS_DST_ALPHA: GLenum = 0;
    readonly ONE_MINUS_DST_COLOR: GLenum = 0;
    readonly ONE_MINUS_SRC_ALPHA: GLenum = 0;
    readonly ONE_MINUS_SRC_COLOR: GLenum = 0;
    readonly OUT_OF_MEMORY: GLenum = 0;
    readonly PACK_ALIGNMENT: GLenum = 0;
    readonly POINTS: GLenum = 0;
    readonly POLYGON_OFFSET_FACTOR: GLenum = 0;
    readonly POLYGON_OFFSET_FILL: GLenum = 0;
    readonly POLYGON_OFFSET_UNITS: GLenum = 0;
    readonly RED_BITS: GLenum = 0;
    readonly RENDERBUFFER: GLenum = 0;
    readonly RENDERBUFFER_ALPHA_SIZE: GLenum = 0;
    readonly RENDERBUFFER_BINDING: GLenum = 0;
    readonly RENDERBUFFER_BLUE_SIZE: GLenum = 0;
    readonly RENDERBUFFER_DEPTH_SIZE: GLenum = 0;
    readonly RENDERBUFFER_GREEN_SIZE: GLenum = 0;
    readonly RENDERBUFFER_HEIGHT: GLenum = 0;
    readonly RENDERBUFFER_INTERNAL_FORMAT: GLenum = 0;
    readonly RENDERBUFFER_RED_SIZE: GLenum = 0;
    readonly RENDERBUFFER_STENCIL_SIZE: GLenum = 0;
    readonly RENDERBUFFER_WIDTH: GLenum = 0;
    readonly RENDERER: GLenum = 0;
    readonly REPEAT: GLenum = 0;
    readonly REPLACE: GLenum = 0;
    readonly RGB: GLenum = 0;
    readonly RGB565: GLenum = 0;
    readonly RGB5_A1: GLenum = 0;
    readonly RGBA: GLenum = 0;
    readonly RGBA4: GLenum = 0;
    readonly SAMPLER_2D: GLenum = 0;
    readonly SAMPLER_CUBE: GLenum = 0;
    readonly SAMPLES: GLenum = 0;
    readonly SAMPLE_ALPHA_TO_COVERAGE: GLenum = 0;
    readonly SAMPLE_BUFFERS: GLenum = 0;
    readonly SAMPLE_COVERAGE: GLenum = 0;
    readonly SAMPLE_COVERAGE_INVERT: GLenum = 0;
    readonly SAMPLE_COVERAGE_VALUE: GLenum = 0;
    readonly SCISSOR_BOX: GLenum = 0;
    readonly SCISSOR_TEST: GLenum = 0;
    readonly SHADER_TYPE: GLenum = 0;
    readonly SHADING_LANGUAGE_VERSION: GLenum = 0;
    readonly SHORT: GLenum = 0;
    readonly SRC_ALPHA: GLenum = 0;
    readonly SRC_ALPHA_SATURATE: GLenum = 0;
    readonly SRC_COLOR: GLenum = 0;
    readonly STATIC_DRAW: GLenum = 0;
    readonly STENCIL_ATTACHMENT: GLenum = 0;
    readonly STENCIL_BACK_FAIL: GLenum = 0;
    readonly STENCIL_BACK_FUNC: GLenum = 0;
    readonly STENCIL_BACK_PASS_DEPTH_FAIL: GLenum = 0;
    readonly STENCIL_BACK_PASS_DEPTH_PASS: GLenum = 0;
    readonly STENCIL_BACK_REF: GLenum = 0;
    readonly STENCIL_BACK_VALUE_MASK: GLenum = 0;
    readonly STENCIL_BACK_WRITEMASK: GLenum = 0;
    readonly STENCIL_BITS: GLenum = 0;
    readonly STENCIL_BUFFER_BIT: GLenum = 0;
    readonly STENCIL_CLEAR_VALUE: GLenum = 0;
    readonly STENCIL_FAIL: GLenum = 0;
    readonly STENCIL_FUNC: GLenum = 0;
    readonly STENCIL_INDEX8: GLenum = 0;
    readonly STENCIL_PASS_DEPTH_FAIL: GLenum = 0;
    readonly STENCIL_PASS_DEPTH_PASS: GLenum = 0;
    readonly STENCIL_REF: GLenum = 0;
    readonly STENCIL_TEST: GLenum = 0;
    readonly STENCIL_VALUE_MASK: GLenum = 0;
    readonly STENCIL_WRITEMASK: GLenum = 0;
    readonly STREAM_DRAW: GLenum = 0;
    readonly SUBPIXEL_BITS: GLenum = 0;
    readonly TEXTURE: GLenum = 0;
    readonly TEXTURE0: GLenum = 0;
    readonly TEXTURE1: GLenum = 0;
    readonly TEXTURE10: GLenum = 0;
    readonly TEXTURE11: GLenum = 0;
    readonly TEXTURE12: GLenum = 0;
    readonly TEXTURE13: GLenum = 0;
    readonly TEXTURE14: GLenum = 0;
    readonly TEXTURE15: GLenum = 0;
    readonly TEXTURE16: GLenum = 0;
    readonly TEXTURE17: GLenum = 0;
    readonly TEXTURE18: GLenum = 0;
    readonly TEXTURE19: GLenum = 0;
    readonly TEXTURE2: GLenum = 0;
    readonly TEXTURE20: GLenum = 0;
    readonly TEXTURE21: GLenum = 0;
    readonly TEXTURE22: GLenum = 0;
    readonly TEXTURE23: GLenum = 0;
    readonly TEXTURE24: GLenum = 0;
    readonly TEXTURE25: GLenum = 0;
    readonly TEXTURE26: GLenum = 0;
    readonly TEXTURE27: GLenum = 0;
    readonly TEXTURE28: GLenum = 0;
    readonly TEXTURE29: GLenum = 0;
    readonly TEXTURE3: GLenum = 0;
    readonly TEXTURE30: GLenum = 0;
    readonly TEXTURE31: GLenum = 0;
    readonly TEXTURE4: GLenum = 0;
    readonly TEXTURE5: GLenum = 0;
    readonly TEXTURE6: GLenum = 0;
    readonly TEXTURE7: GLenum = 0;
    readonly TEXTURE8: GLenum = 0;
    readonly TEXTURE9: GLenum = 0;
    readonly TEXTURE_2D: GLenum = 0;
    readonly TEXTURE_BINDING_2D: GLenum = 0;
    readonly TEXTURE_BINDING_CUBE_MAP: GLenum = 0;
    readonly TEXTURE_CUBE_MAP: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_NEGATIVE_X: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_NEGATIVE_Y: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_NEGATIVE_Z: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_POSITIVE_X: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_POSITIVE_Y: GLenum = 0;
    readonly TEXTURE_CUBE_MAP_POSITIVE_Z: GLenum = 0;
    readonly TEXTURE_MAG_FILTER: GLenum = 0;
    readonly TEXTURE_MIN_FILTER: GLenum = 0;
    readonly TEXTURE_WRAP_S: GLenum = 0;
    readonly TEXTURE_WRAP_T: GLenum = 0;
    readonly TRIANGLES: GLenum = 0;
    readonly TRIANGLE_FAN: GLenum = 0;
    readonly TRIANGLE_STRIP: GLenum = 0;
    readonly UNPACK_ALIGNMENT: GLenum = 0;
    readonly UNPACK_COLORSPACE_CONVERSION_WEBGL: GLenum = 0;
    readonly UNPACK_FLIP_Y_WEBGL: GLenum = 0;
    readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: GLenum = 0;
    readonly UNSIGNED_BYTE: GLenum = 0;
    readonly UNSIGNED_INT: GLenum = 0;
    readonly UNSIGNED_SHORT: GLenum = 0;
    readonly UNSIGNED_SHORT_4_4_4_4: GLenum = 0;
    readonly UNSIGNED_SHORT_5_5_5_1: GLenum = 0;
    readonly UNSIGNED_SHORT_5_6_5: GLenum = 0;
    readonly VALIDATE_STATUS: GLenum = 0;
    readonly VENDOR: GLenum = 0;
    readonly VERSION: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_ENABLED: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_NORMALIZED: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_POINTER: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_SIZE: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_STRIDE: GLenum = 0;
    readonly VERTEX_ATTRIB_ARRAY_TYPE: GLenum = 0;
    readonly VERTEX_SHADER: GLenum = 0;
    readonly VIEWPORT: GLenum = 0;
    readonly ZERO: GLenum = 0;
}

export { GjsifyWebGLRenderingContextBase as WebGLRenderingContextBase }