import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import { GjsifyWebGLRenderingContextBase } from './webgl-rendering-context-base.js';
import { extractImageData, checkFormat, convertPixels, validCubeTarget } from './utils.js';
import { warnNotImplemented } from '@gjsify/utils';

export class GjsifyWebGLRenderingContext extends Gwebgl.WebGLRenderingContext implements WebGLRenderingContext {
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

    // TODO: The following are part of webgl-rendering-context-base.ts and should be applied via a mixin
    getContextAttributes(): WebGLContextAttributes | null {
        warnNotImplemented('GjsifyWebGLRenderingContext.getContextAttributes');
        return {}
    }
    getExtension(name: string): any {
        warnNotImplemented('GjsifyWebGLRenderingContextBase.getExtension')
    }
    getParameter(pname: GLenum): any {
        return super.getParameterx(pname)?.deepUnpack() || null;
    }
    getTexParameter(target: GLenum, pname: GLenum): any {
        return super.getTexParameterx(target, pname)?.unpack();
    }
    isContextLost(): boolean {
        return false;
    }

    bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void;
    bufferData(target: GLenum, data: BufferSource | null, usage: GLenum): void;
    bufferData(target: GLenum, dataOrSize: GLsizeiptr | BufferSource | null, usage: GLenum): void {
        let size = 0;
        let data: BufferSource | null = null;
        if(typeof dataOrSize === 'number') {
            size = dataOrSize;
        } else if(dataOrSize && typeof dataOrSize === 'object') {
            data = dataOrSize;
        }

        if(!data) {
            return super.bufferDataSizeOnly(target, size, usage);
        }
    }
    bufferSubData(target: GLenum, offset: GLintptr, data: BufferSource): void {
        return super.bufferSubData(target, offset, data);
    }
    compressedTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: ArrayBufferView): void {
        return super.compressedTexImage2D(target, level, internalformat, width, height, border, data);
    }
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: ArrayBufferView): void {
        return super.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, data);
    }
    readPixels(x: GLint, y: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void {
        return super.readPixels(x, y, width, height, format, type, pixels);
    }
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void ;
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/javascript/webgl-rendering-context.js#L3131
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrBorder: TexImageSource | GLint, _format?: GLenum, _type?: GLenum, _pixels?: ArrayBufferView | null): void {
        
        let width: number = 0;
        let height: number = 0;
        let format: number = 0;
        let type: number = 0;
        let source: TexImageSource;
        let border: number = 0;
        let pixels: ArrayBufferView | null = null;
        
        if(arguments.length === 6) {
            source = sourceOrBorder as TexImageSource
            type = typeOrHeight;
            format = formatOrWidth;

            let imageData = extractImageData(source);

            if (imageData == null) {
                throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)')
            }

            width = imageData.width;
            height = imageData.height;
            pixels = imageData.data;
        } else if (arguments.length === 9) {
            width = formatOrWidth;
            height = typeOrHeight;
            border = sourceOrBorder as GLint;
            format = _format as GLenum;
            type = _type as GLenum;
            pixels = _pixels as ArrayBufferView | null;
        }

        target |= 0
        level |= 0
        internalFormat |= 0
        width |= 0
        height |= 0
        border |= 0
        format |= 0
        type |= 0

        if (typeof pixels !== 'object' && pixels !== undefined) {
            throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)')
        }
      
        if (!checkFormat(format) || !checkFormat(internalFormat)) {
            this.setError(gl.INVALID_ENUM)
            return
        }
      
        if (type === this.FLOAT && !this._extensions.oes_texture_float) {
            this.setError(gl.INVALID_ENUM)
            return
        }
      
        const texture = this._getTexImage(target)
        if (!texture || format !== internalFormat) {
            this.setError(gl.INVALID_OPERATION)
            return
        }
      
        const pixelSize = this._computePixelSize(type, format)
        if (pixelSize === 0) {
            return
        }
      
        if (!this._checkDimensions(
            target,
            width,
            height,
            level)) {
            return
        }
      
        const data = convertPixels(pixels)
        const rowStride = this._computeRowStride(width, pixelSize)
        const imageSize = rowStride * height
    
        if (data && data.length < imageSize) {
            this.setError(gl.INVALID_OPERATION)
            return
        }
      
        if (border !== 0 ||
            (validCubeTarget(target) && width !== height)) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        target |= 0
        level |= 0
        internalFormat |= 0
        width |= 0
        height |= 0
        border |= 0
        format |= 0
        type |= 0
        
        return super.texImage2D(target, level, internalformat, width, height, border, format, type, data);
    }
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrFormat: TexImageSource | GLenum, type?: GLenum, pixels?: ArrayBufferView | null): void {

    }
    uniform1fv(location: WebGLUniformLocation | null, v: Float32List): void {
        super.uniform1fv(location, v);
    }
    uniform1iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform2fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform2iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform3fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform3iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniform4fv(location: WebGLUniformLocation | null, v: Float32List): void {

    }
    uniform4iv(location: WebGLUniformLocation | null, v: Int32List): void {

    }
    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

    }
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

    }
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {

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