import * as bits from 'bit-twiddle';
import tokenize from 'glsl-tokenizer/string';
import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import { WebGLContextAttributes } from './webgl-context-attributes.js';
import { gl } from './native-gl.js';
import { warnNotImplemented } from '@gjsify/utils';
import {
    extractImageData,
    checkObject,
    checkFormat,
    checkUniform,
    convertPixels,
    validCubeTarget,
    formatSize,
    isTypedArray,
    unpackTypedArray,
    flag,
    bindPublics,
    listToArray,
    isValidString,
    uniformTypeSize,
    vertexCount,
} from './utils.js';

import { getANGLEInstancedArrays } from './extensions/angle-instanced-arrays.js';
import { getOESElementIndexUint } from './extensions/oes-element-index-unit.js';
import { getOESStandardDerivatives } from './extensions/oes-standard-derivatives.js';
import { getOESTextureFloat } from './extensions/oes-texture-float.js';
import { getOESTextureFloatLinear } from './extensions/oes-texture-float-linear.js';
import { getSTACKGLDestroyContext } from './extensions/stackgl-destroy-context.js';
import { getSTACKGLResizeDrawingBuffer } from './extensions/stackgl-resize-drawing-buffer.js';
// import { getWebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
import { getEXTBlendMinMax } from './extensions/ext-blend-minmax.js';
import { getEXTTextureFilterAnisotropic } from './extensions/ext-texture-filter-anisotropic.js';
import { getOESVertexArrayObject } from './extensions/oes-vertex-array-object.js';

import { WebGLActiveInfo } from './webgl-active-info.js';
import { WebGLFramebuffer } from './webgl-framebuffer.js';
import { WebGLBuffer } from './webgl-buffer.js';
import { WebGLDrawingBufferWrapper } from './webgl-drawing-buffer-wrapper.js';
import { WebGLProgram } from './webgl-program.js';
import { WebGLRenderbuffer } from './webgl-renderbuffer.js';
import { WebGLShader } from './webgl-shader.js';
import { WebGLShaderPrecisionFormat } from './webgl-shader-precision-format.js';
import { WebGLTextureUnit } from './webgl-texture-unit.js';
import { WebGLTexture } from './webgl-texture.js';
import { WebGLUniformLocation } from './webgl-uniform-location.js';
import { WebGLVertexArrayObjectState, WebGLVertexArrayGlobalState } from './webgl-vertex-attribute.js';

import type { ExtensionFactory, TypedArray } from './types/index.js';

const VERSION = '0.0.1';

let CONTEXT_COUNTER = 0;

// These are defined by the WebGL spec
const MAX_UNIFORM_LENGTH = 256
const MAX_ATTRIBUTE_LENGTH = 256

const DEFAULT_ATTACHMENTS = [
    gl.COLOR_ATTACHMENT0,
    gl.DEPTH_ATTACHMENT,
    gl.STENCIL_ATTACHMENT,
    gl.DEPTH_STENCIL_ATTACHMENT
]

const DEFAULT_COLOR_ATTACHMENTS = [gl.COLOR_ATTACHMENT0]

const availableExtensions: Record<string, ExtensionFactory> = {
    angle_instanced_arrays: getANGLEInstancedArrays,
    oes_element_index_uint: getOESElementIndexUint,
    oes_texture_float: getOESTextureFloat,
    oes_texture_float_linear: getOESTextureFloatLinear,
    oes_standard_derivatives: getOESStandardDerivatives,
    oes_vertex_array_object: getOESVertexArrayObject,
    stackgl_destroy_context: getSTACKGLDestroyContext,
    stackgl_resize_drawingbuffer: getSTACKGLResizeDrawingBuffer,
    // webgl_draw_buffers: getWebGLDrawBuffers,
    ext_blend_minmax: getEXTBlendMinMax,
    ext_texture_filter_anisotropic: getEXTTextureFilterAnisotropic
}

const privateMethods = [
    'resize',
    'destroy'
]

function wrapContext(ctx: GjsifyWebGLRenderingContext) {
    const wrapper = new GjsifyWebGLRenderingContext()
    bindPublics(Object.keys(ctx) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
    bindPublics(Object.keys(ctx.constructor.prototype) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
    bindPublics(Object.getOwnPropertyNames(ctx) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
    bindPublics(Object.getOwnPropertyNames(ctx.constructor.prototype) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)

    Object.defineProperties(wrapper, {
        drawingBufferWidth: {
            get() { return ctx.drawingBufferWidth },
            set(value) { ctx.drawingBufferWidth = value }
        },
        drawingBufferHeight: {
            get() { return ctx.drawingBufferHeight },
            set(value) { ctx.drawingBufferHeight = value }
        }
    })

    return wrapper
}

export class GjsifyWebGLRenderingContext implements WebGLRenderingContext {
    canvas: HTMLCanvasElement = null as any as HTMLCanvasElement; // TODO
    drawingBufferHeight: GLsizei = 0;
    drawingBufferWidth: GLsizei = 0;

    /** context counter */
    _ = 0;

    _native = new Gwebgl.WebGLRenderingContext();

    _contextAttributes: WebGLContextAttributes;

    _extensions: Record<string, any> /* TODO interface for extensions */ = {}
    _programs: Record<number, WebGLProgram> = {}
    _shaders: Record<number, WebGLShader> = {}
    _textures: Record<number, WebGLTexture> = {}
    _framebuffers: Record<number, WebGLFramebuffer> = {}
    _renderbuffers: Record<number, WebGLRenderbuffer> = {}
    _buffers: Record<number, WebGLBuffer> = {}

    _activeProgram: WebGLProgram | null = null
    _activeFramebuffer: WebGLFramebuffer | null = null
    _activeRenderbuffer: WebGLRenderbuffer | null = null
    _checkStencil = false
    _stencilState = true

    _activeTextureUnit = 0
    _errorStack: GLenum[] = []
    _defaultVertexObjectState: WebGLVertexArrayObjectState;
    _vertexObjectState: WebGLVertexArrayObjectState;

    // Vertex array attributes that are not in vertex array objects.
    _vertexGlobalState: WebGLVertexArrayGlobalState;

    // Store limits
    _maxTextureSize = 0;
    _maxTextureLevel = 0;
    _maxCubeMapSize = 0;
    _maxCubeMapLevel = 0;

    // Unpack alignment
    _unpackAlignment = 4
    _packAlignment = 4

    _attrib0Buffer: WebGLBuffer | null = null;

    _textureUnits: WebGLTextureUnit[] = [];
    _drawingBuffer: WebGLDrawingBufferWrapper | null = null;

    constructor(options: Gwebgl.WebGLRenderingContext.ConstructorProperties = {}) {
        this._initGLConstants();

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

        const width = options.width || 0;
        const height = options.height || 0;

        // Can only use premultipliedAlpha if alpha is set
        this._contextAttributes.premultipliedAlpha = this._contextAttributes.premultipliedAlpha && this._contextAttributes.alpha;

        this.drawingBufferWidth = width;
        this.drawingBufferHeight = height;

        this._ = CONTEXT_COUNTER++;

        // Initialize texture units
        const numTextures = this.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
        this._textureUnits = new Array(numTextures)
        for (let i = 0; i < numTextures; ++i) {
            this._textureUnits[i] = new WebGLTextureUnit(this, i)
        }

        this.activeTexture(gl.TEXTURE0)


        // Vertex array attributes that are in vertex array objects.
        this._defaultVertexObjectState = new WebGLVertexArrayObjectState(this)
        this._vertexObjectState = this._defaultVertexObjectState

        // Vertex array attributes that are not in vertex array objects.
        this._vertexGlobalState = new WebGLVertexArrayGlobalState(this)

        // Store limits
        this._maxTextureSize = this.getParameter(gl.MAX_TEXTURE_SIZE)
        this._maxTextureLevel = bits.log2(bits.nextPow2(gl._maxTextureSize))
        this._maxCubeMapSize = this.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)
        this._maxCubeMapLevel = bits.log2(bits.nextPow2(gl._maxCubeMapSize))

        // Unpack alignment
        this._unpackAlignment = 4
        this._packAlignment = 4

        // Allocate framebuffer
        this._allocateDrawingBuffer(width, height)

        const attrib0Buffer = this.createBuffer()
        this._attrib0Buffer = attrib0Buffer

        // Initialize defaults
        this.bindBuffer(gl.ARRAY_BUFFER, null)
        this.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
        this.bindFramebuffer(gl.FRAMEBUFFER, null)
        this.bindRenderbuffer(gl.RENDERBUFFER, null)

        // Set viewport and scissor
        this.viewport(0, 0, width, height)
        this.scissor(0, 0, width, height)

        // Clear buffers
        this.clearDepth(1)
        this.clearColor(0, 0, 0, 0)
        this.clearStencil(0)
        this.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)

        return wrapContext(this)
    }

    _initGLConstants() {
        const giBaseClass = new Gwebgl.WebGLRenderingContextBase();
        const hash = giBaseClass.get_webgl_constants();
        for (const [k, v] of Object.entries(hash)) {
            Object.defineProperty(this, k, { value: v });
        }
    }

    extWEBGL_draw_buffers() {
        return this._native.extWEBGL_draw_buffers().deepUnpack<Record<string, number>>();
    }

    _checkDimensions(target: GLenum, width: GLsizei, height: GLsizei, level: number) {
        if (level < 0 ||
            width < 0 ||
            height < 0) {
            this.setError(gl.INVALID_VALUE)
            return false
        }
        if (target === gl.TEXTURE_2D) {
            if (width > this._maxTextureSize ||
                height > this._maxTextureSize ||
                level > this._maxTextureLevel) {
                this.setError(gl.INVALID_VALUE)
                return false
            }
        } else if (this._validCubeTarget(target)) {
            if (width > this._maxCubeMapSize ||
                height > this._maxCubeMapSize ||
                level > this._maxCubeMapLevel) {
                this.setError(gl.INVALID_VALUE)
                return false
            }
        } else {
            this.setError(gl.INVALID_ENUM)
            return false
        }
        return true
    }

    _checkLocation(location: WebGLUniformLocation | null) {
        if (!(location instanceof WebGLUniformLocation)) {
            this.setError(gl.INVALID_VALUE)
            return false
        } else if (location._program._ctx !== this ||
            location._linkCount !== location._program._linkCount) {
            this.setError(gl.INVALID_OPERATION)
            return false
        }
        return true
    }

    _checkLocationActive(location: WebGLUniformLocation | null) {
        if (!location) {
            return false
        } else if (!this._checkLocation(location)) {
            return false
        } else if (location._program !== this._activeProgram) {
            this.setError(gl.INVALID_OPERATION)
            return false
        }
        return true
    }

    _checkOwns(object: any) {
        return typeof object === 'object' &&
            object._ctx === this
    }

    _checkShaderSource(shader: WebGLShader) {
        const source = shader._source
        const tokens = tokenize(source)

        let errorStatus = false
        const errorLog = []

        for (let i = 0; i < tokens.length; ++i) {
            const tok = tokens[i]
            if (!tok) continue;
            switch (tok.type) {
                case 'ident':
                    if (!this._validGLSLIdentifier(tok.data)) {
                        errorStatus = true
                        errorLog.push(tok.line + ':' + tok.column +
                            ' invalid identifier - ' + tok.data)
                    }
                    break
                case 'preprocessor': {
                    const match = tok.data.match(/^\s*#\s*(.*)$/);
                    if (!match || match?.length < 2) {
                        break;
                    }
                    const bodyToks = tokenize(match[1])
                    for (let j = 0; j < bodyToks.length; ++j) {
                        const btok = bodyToks[j]
                        if (btok.type === 'ident' || btok.type === undefined) {
                            if (!this._validGLSLIdentifier(btok.data)) {
                                errorStatus = true
                                errorLog.push(tok.line + ':' + btok.column +
                                    ' invalid identifier - ' + btok.data)
                            }
                        }
                    }
                    break
                }
                case 'keyword':
                    switch (tok.data) {
                        case 'do':
                            errorStatus = true
                            errorLog.push(tok.line + ':' + tok.column + ' do not supported')
                            break
                    }
                    break
                case 'builtin':
                    switch (tok.data) {
                        case 'dFdx':
                        case 'dFdy':
                        case 'fwidth':
                            if (!this._extensions.oes_standard_derivatives) {
                                errorStatus = true
                                errorLog.push(tok.line + ':' + tok.column + ' ' + tok.data + ' not supported')
                            }
                            break
                    }
            }
        }

        if (errorStatus) {
            shader._compileInfo = errorLog.join('\n')
        }
        return !errorStatus
    }

    _checkStencilState() {
        if (!this._checkStencil) {
            return this._stencilState
        }
        this._checkStencil = false
        this._stencilState = true
        if (this.getParameter(gl.STENCIL_WRITEMASK) !==
            this.getParameter(gl.STENCIL_BACK_WRITEMASK) ||
            this.getParameter(gl.STENCIL_VALUE_MASK) !==
            this.getParameter(gl.STENCIL_BACK_VALUE_MASK) ||
            this.getParameter(gl.STENCIL_REF) !==
            this.getParameter(gl.STENCIL_BACK_REF)) {
            this.setError(gl.INVALID_OPERATION)
            this._stencilState = false
        }
        return this._stencilState
    }

    _checkTextureTarget(target: GLenum) {
        const unit = this._getActiveTextureUnit()
        let tex = null
        if (target === gl.TEXTURE_2D) {
            tex = unit._bind2D
        } else if (target === gl.TEXTURE_CUBE_MAP) {
            tex = unit._bindCube
        } else {
            this.setError(gl.INVALID_ENUM)
            return false
        }
        if (!tex) {
            this.setError(gl.INVALID_OPERATION)
            return false
        }
        return true
    }

    _checkWrapper(object: any, Wrapper: any) {
        if (!this._checkValid(object, Wrapper)) {
            this.setError(gl.INVALID_VALUE)
            return false
        } else if (!this._checkOwns(object)) {
            this.setError(gl.INVALID_OPERATION)
            return false
        }
        return true
    }

    _checkValid(object: any, Type: any) {
        return object instanceof Type && object._ !== 0
    }

    _checkVertexAttribState(maxIndex: number) {
        const program = this._activeProgram
        if (!program) {
            this.setError(gl.INVALID_OPERATION)
            return false
        }
        const attribs = this._vertexObjectState._attribs
        for (let i = 0; i < attribs.length; ++i) {
            const attrib = attribs[i]
            if (attrib._isPointer) {
                const buffer = attrib._pointerBuffer
                if (!buffer) {
                    this.setError(gl.INVALID_OPERATION)
                    return false
                }
                if (program._attributes.indexOf(i) >= 0) {
                    let maxByte = 0
                    if (attrib._divisor) {
                        maxByte = attrib._pointerSize +
                            attrib._pointerOffset
                    } else {
                        maxByte = attrib._pointerStride * maxIndex +
                            attrib._pointerSize +
                            attrib._pointerOffset
                    }
                    if (maxByte > buffer._size) {
                        this.setError(gl.INVALID_OPERATION)
                        return false
                    }
                }
            }
        }
        return true
    }

    _checkVertexIndex(index: number) {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(gl.INVALID_VALUE)
            return false
        }
        return true
    }

    _computePixelSize(type: GLenum, internalFormat: GLenum) {
        const pixelSize = formatSize(internalFormat)
        if (pixelSize === 0) {
            this.setError(gl.INVALID_ENUM)
            return 0
        }
        switch (type) {
            case gl.UNSIGNED_BYTE:
                return pixelSize
            case gl.UNSIGNED_SHORT_5_6_5:
                if (internalFormat !== gl.RGB) {
                    this.setError(gl.INVALID_OPERATION)
                    break
                }
                return 2
            case gl.UNSIGNED_SHORT_4_4_4_4:
            case gl.UNSIGNED_SHORT_5_5_5_1:
                if (internalFormat !== gl.RGBA) {
                    this.setError(gl.INVALID_OPERATION)
                    break
                }
                return 2
            case gl.FLOAT:
                return 1
        }
        this.setError(gl.INVALID_ENUM)
        return 0
    }

    _computeRowStride(width: number, pixelSize: number) {
        let rowStride = width * pixelSize
        if (rowStride % this._unpackAlignment) {
            rowStride += this._unpackAlignment - (rowStride % this._unpackAlignment)
        }
        return rowStride
    }

    _fixupLink(program: WebGLProgram) {
        if (!this.getProgramParameter(program, gl.LINK_STATUS)) {
            program._linkInfoLog = this.getProgramInfoLog(program) || 'null'
            return false
        }

        // Record attribute attributeLocations
        const numAttribs = this.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES)
        const names = new Array(numAttribs)
        program._attributes.length = numAttribs
        for (let i = 0; i < numAttribs; ++i) {
            names[i] = this.getActiveAttrib(program, i)?.name
            program._attributes[i] = this.getAttribLocation(program, names[i]) | 0
        }

        // Check attribute names
        for (let i = 0; i < names.length; ++i) {
            if (names[i].length > MAX_ATTRIBUTE_LENGTH) {
                program._linkInfoLog = 'attribute ' + names[i] + ' is too long'
                return false
            }
        }

        for (let i = 0; i < numAttribs; ++i) {
            this._native.bindAttribLocation(
                program._ | 0,
                program._attributes[i],
                names[i])
        }

        this._native.linkProgram(program._ | 0)

        const numUniforms = this.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
        program._uniforms.length = numUniforms
        for (let i = 0; i < numUniforms; ++i) {
            const info = this.getActiveUniform(program, i);
            if (info) program._uniforms[i] = info
        }

        // Check attribute and uniform name lengths
        for (let i = 0; i < program._uniforms.length; ++i) {
            if (program._uniforms[i].name.length > MAX_UNIFORM_LENGTH) {
                program._linkInfoLog = 'uniform ' + program._uniforms[i].name + ' is too long'
                return false
            }
        }

        program._linkInfoLog = ''
        return true
    }

    _framebufferOk() {
        const framebuffer = this._activeFramebuffer
        if (framebuffer &&
            this._preCheckFramebufferStatus(framebuffer) !== gl.FRAMEBUFFER_COMPLETE) {
            this.setError(gl.INVALID_FRAMEBUFFER_OPERATION)
            return false
        }
        return true
    }

    _getActiveBuffer(target: GLenum) {
        if (target === gl.ARRAY_BUFFER) {
            return this._vertexGlobalState._arrayBufferBinding
        } else if (target === gl.ELEMENT_ARRAY_BUFFER) {
            return this._vertexObjectState._elementArrayBufferBinding
        }
        return null
    }

    _getActiveTextureUnit() {
        return this._textureUnits[this._activeTextureUnit]
    }

    _getActiveTexture(target: GLenum) {
        const activeUnit = this._getActiveTextureUnit()
        if (target === gl.TEXTURE_2D) {
            return activeUnit._bind2D
        } else if (target === gl.TEXTURE_CUBE_MAP) {
            return activeUnit._bindCube
        }
        return null
    }

    _getAttachments() {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_ATTACHMENTS : DEFAULT_ATTACHMENTS
    }

    _getColorAttachments() {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_COLOR_ATTACHMENTS : DEFAULT_COLOR_ATTACHMENTS
    }

    _getParameterDirect(pname: GLenum): any {
        return this._native.getParameterx(pname)?.deepUnpack();
    }

    _getTexImage(target: GLenum) {
        const unit = this._getActiveTextureUnit()
        if (target === gl.TEXTURE_2D) {
            return unit._bind2D
        } else if (validCubeTarget(target)) {
            return unit._bindCube
        }
        this.setError(gl.INVALID_ENUM)
        return null
    }

    _preCheckFramebufferStatus(framebuffer: WebGLFramebuffer) {
        const attachments = framebuffer._attachments
        const width = []
        const height = []
        const depthAttachment = attachments[gl.DEPTH_ATTACHMENT]
        const depthStencilAttachment = attachments[gl.DEPTH_STENCIL_ATTACHMENT]
        const stencilAttachment = attachments[gl.STENCIL_ATTACHMENT]

        if ((depthStencilAttachment && (stencilAttachment || depthAttachment)) ||
            (stencilAttachment && depthAttachment)) {
            return gl.FRAMEBUFFER_UNSUPPORTED
        }

        const colorAttachments = this._getColorAttachments()
        let colorAttachmentCount = 0
        for (const attachmentEnum in attachments) {
            if (attachments[attachmentEnum] && colorAttachments.indexOf(Number(attachmentEnum)) !== -1) {
                colorAttachmentCount++
            }
        }
        if (colorAttachmentCount === 0) {
            return gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
        }

        if (depthStencilAttachment instanceof WebGLTexture) {
            return gl.FRAMEBUFFER_UNSUPPORTED
        } else if (depthStencilAttachment instanceof WebGLRenderbuffer) {
            if (depthStencilAttachment._format !== gl.DEPTH_STENCIL) {
                return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(depthStencilAttachment._width)
            height.push(depthStencilAttachment._height)
        }

        if (depthAttachment instanceof WebGLTexture) {
            return gl.FRAMEBUFFER_UNSUPPORTED
        } else if (depthAttachment instanceof WebGLRenderbuffer) {
            if (depthAttachment._format !== gl.DEPTH_COMPONENT16) {
                return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(depthAttachment._width)
            height.push(depthAttachment._height)
        }

        if (stencilAttachment instanceof WebGLTexture) {
            return gl.FRAMEBUFFER_UNSUPPORTED
        } else if (stencilAttachment instanceof WebGLRenderbuffer) {
            if (stencilAttachment._format !== gl.STENCIL_INDEX8) {
                return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(stencilAttachment._width)
            height.push(stencilAttachment._height)
        }

        let colorAttached = false
        for (let i = 0; i < colorAttachments.length; ++i) {
            const colorAttachment = attachments[colorAttachments[i]]
            if (colorAttachment instanceof WebGLTexture) {
                if (colorAttachment._format !== gl.RGBA ||
                    !(colorAttachment._type === gl.UNSIGNED_BYTE || colorAttachment._type === gl.FLOAT)) {
                    return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
                }
                colorAttached = true
                const level = framebuffer._attachmentLevel[gl.COLOR_ATTACHMENT0]
                if (level === null) throw new TypeError('level is null!');
                width.push(colorAttachment._levelWidth[level])
                height.push(colorAttachment._levelHeight[level])
            } else if (colorAttachment instanceof WebGLRenderbuffer) {
                const format = colorAttachment._format
                if (format !== gl.RGBA4 &&
                    format !== gl.RGB565 &&
                    format !== gl.RGB5_A1) {
                    return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
                }
                colorAttached = true
                width.push(colorAttachment._width)
                height.push(colorAttachment._height)
            }
        }

        if (!colorAttached &&
            !stencilAttachment &&
            !depthAttachment &&
            !depthStencilAttachment) {
            return gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
        }

        if (width.length <= 0 || height.length <= 0) {
            return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
        }

        for (let i = 1; i < width.length; ++i) {
            if (width[i - 1] !== width[i] ||
                height[i - 1] !== height[i]) {
                return gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS
            }
        }

        if (width[0] === 0 || height[0] === 0) {
            return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
        }

        framebuffer._width = width[0]
        framebuffer._height = height[0]

        return gl.FRAMEBUFFER_COMPLETE
    }

    _isConstantBlendFunc(factor: GLenum) {
        return (
            factor === gl.CONSTANT_COLOR ||
            factor === gl.ONE_MINUS_CONSTANT_COLOR ||
            factor === gl.CONSTANT_ALPHA ||
            factor === gl.ONE_MINUS_CONSTANT_ALPHA)
    }

    _isObject(object: any, method: any, Wrapper: any) {
        if (!(object === null || object === undefined) &&
            !(object instanceof Wrapper)) {
            throw new TypeError(method + '(' + Wrapper.name + ')')
        }
        if (this._checkValid(object, Wrapper) && this._checkOwns(object)) {
            return true
        }
        return false
    }

    _resizeDrawingBuffer(width: number, height: number) {
        const prevFramebuffer = this._activeFramebuffer
        const prevTexture = this._getActiveTexture(gl.TEXTURE_2D)
        const prevRenderbuffer = this._activeRenderbuffer

        const contextAttributes = this._contextAttributes

        const drawingBuffer = this._drawingBuffer
        this._native.bindFramebuffer(gl.FRAMEBUFFER, drawingBuffer?._framebuffer || null)
        const attachments = this._getAttachments()
        // Clear all attachments
        for (let i = 0; i < attachments.length; ++i) {
            this._native.framebufferTexture2D(
                gl.FRAMEBUFFER,
                attachments[i],
                gl.TEXTURE_2D,
                0,
                0)
        }

        // Update color attachment
        this._native.bindTexture(gl.TEXTURE_2D, drawingBuffer?._color || null)
        const colorFormat = contextAttributes.alpha ? gl.RGBA : gl.RGB
        this._native.texImage2D(
            gl.TEXTURE_2D,
            0,
            colorFormat,
            width,
            height,
            0,
            colorFormat,
            gl.UNSIGNED_BYTE,
            null)
        this._native.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        this._native.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        this._native.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            drawingBuffer?._color || null,
            0)

        // Update depth-stencil attachments if needed
        let storage = 0
        let attachment = 0
        if (contextAttributes.depth && contextAttributes.stencil) {
            storage = gl.DEPTH_STENCIL
            attachment = gl.DEPTH_STENCIL_ATTACHMENT
        } else if (contextAttributes.depth) {
            storage = 0x81A7
            attachment = gl.DEPTH_ATTACHMENT
        } else if (contextAttributes.stencil) {
            storage = gl.STENCIL_INDEX8
            attachment = gl.STENCIL_ATTACHMENT
        }

        if (storage) {
            this._native.bindRenderbuffer(
                gl.RENDERBUFFER,
                drawingBuffer?._depthStencil || null)
            this._native.renderbufferStorage(
                gl.RENDERBUFFER,
                storage,
                width,
                height)
            this._native.framebufferRenderbuffer(
                gl.FRAMEBUFFER,
                attachment,
                gl.RENDERBUFFER,
                drawingBuffer?._depthStencil || null)
        }

        // Restore previous binding state
        this.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer)
        this.bindTexture(gl.TEXTURE_2D, prevTexture)
        this.bindRenderbuffer(gl.RENDERBUFFER, prevRenderbuffer)
    }

    _restoreError(lastError: GLenum) {
        const topError = this._errorStack.pop()
        if (topError === gl.NO_ERROR) {
            this.setError(lastError)
        } else if (topError) {
            this.setError(topError)
        }
    }

    _saveError() {
        this._errorStack.push(this.getError())
    }

    _switchActiveProgram(active: WebGLProgram) {
        if (active) {
            active._refCount -= 1
            active._checkDelete()
        }
    }

    _tryDetachFramebuffer(framebuffer: WebGLFramebuffer | null, renderbuffer: WebGLRenderbuffer) {
        // FIXME: Does the texture get unbound from *all* framebuffers, or just the
        // active FBO?
        if (framebuffer && framebuffer._linked(renderbuffer)) {
            const attachments = this._getAttachments()
            const framebufferAttachments = Object.keys(framebuffer._attachments)
            for (let i = 0; i < framebufferAttachments.length; ++i) {
                if (framebuffer._attachments[attachments[i]] === renderbuffer) {
                    this.framebufferTexture2D(
                        gl.FRAMEBUFFER,
                        attachments[i] | 0,
                        gl.TEXTURE_2D,
                        null)
                }
            }
        }
    }

    _updateFramebufferAttachments(framebuffer: WebGLFramebuffer | null) {
        if (!framebuffer) {
            return
        }
        const prevStatus = framebuffer._status
        const attachments = this._getAttachments()
        framebuffer._status = this._preCheckFramebufferStatus(framebuffer)
        if (framebuffer._status !== gl.FRAMEBUFFER_COMPLETE) {
            if (prevStatus === gl.FRAMEBUFFER_COMPLETE) {
                for (let i = 0; i < attachments.length; ++i) {
                    const attachmentEnum = attachments[i]
                    this._native.framebufferTexture2D(
                        gl.FRAMEBUFFER,
                        attachmentEnum,
                        framebuffer._attachmentFace[attachmentEnum],
                        0,
                        framebuffer._attachmentLevel[attachmentEnum])
                }
            }
            return
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i]
            this._native.framebufferTexture2D(
                gl.FRAMEBUFFER,
                attachmentEnum,
                framebuffer._attachmentFace[attachmentEnum],
                0,
                framebuffer._attachmentLevel[attachmentEnum])
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i]
            const attachment = framebuffer._attachments[attachmentEnum]
            if (attachment instanceof WebGLTexture) {
                this._native.framebufferTexture2D(
                    gl.FRAMEBUFFER,
                    attachmentEnum,
                    framebuffer._attachmentFace[attachmentEnum],
                    attachment._ | 0,
                    framebuffer._attachmentLevel[attachmentEnum])
            } else if (attachment instanceof WebGLRenderbuffer) {
                this._native.framebufferRenderbuffer(
                    gl.FRAMEBUFFER,
                    attachmentEnum,
                    gl.RENDERBUFFER,
                    attachment._ | 0)
            }
        }
    }

    _validBlendFunc(factor: GLenum) {
        return factor === gl.ZERO ||
            factor === gl.ONE ||
            factor === gl.SRC_COLOR ||
            factor === gl.ONE_MINUS_SRC_COLOR ||
            factor === gl.DST_COLOR ||
            factor === gl.ONE_MINUS_DST_COLOR ||
            factor === gl.SRC_ALPHA ||
            factor === gl.ONE_MINUS_SRC_ALPHA ||
            factor === gl.DST_ALPHA ||
            factor === gl.ONE_MINUS_DST_ALPHA ||
            factor === gl.SRC_ALPHA_SATURATE ||
            factor === gl.CONSTANT_COLOR ||
            factor === gl.ONE_MINUS_CONSTANT_COLOR ||
            factor === gl.CONSTANT_ALPHA ||
            factor === gl.ONE_MINUS_CONSTANT_ALPHA
    }

    _validBlendMode(mode: GLenum) {
        return mode === gl.FUNC_ADD ||
            mode === gl.FUNC_SUBTRACT ||
            mode === gl.FUNC_REVERSE_SUBTRACT ||
            (this._extensions.ext_blend_minmax && (
                mode === this._extensions.ext_blend_minmax.MIN_EXT ||
                mode === this._extensions.ext_blend_minmax.MAX_EXT))
    }

    _validCubeTarget(target: GLenum) {
        return target === gl.TEXTURE_CUBE_MAP_POSITIVE_X ||
            target === gl.TEXTURE_CUBE_MAP_NEGATIVE_X ||
            target === gl.TEXTURE_CUBE_MAP_POSITIVE_Y ||
            target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
            target === gl.TEXTURE_CUBE_MAP_POSITIVE_Z ||
            target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
    }

    _validFramebufferAttachment(attachment: GLenum) {
        switch (attachment) {
            case gl.DEPTH_ATTACHMENT:
            case gl.STENCIL_ATTACHMENT:
            case gl.DEPTH_STENCIL_ATTACHMENT:
            case gl.COLOR_ATTACHMENT0:
                return true
        }

        if (this._extensions.webgl_draw_buffers) {
            const { webgl_draw_buffers } = this._extensions;
            return attachment < (webgl_draw_buffers.COLOR_ATTACHMENT0_WEBGL + webgl_draw_buffers._maxDrawBuffers)
        }

        return false
    }

    _validGLSLIdentifier(str: string) {
        return !(str.indexOf('webgl_') === 0 ||
            str.indexOf('_webgl_') === 0 ||
            str.length > 256)
    }

    _validTextureTarget(target: GLenum) {
        return target === gl.TEXTURE_2D ||
            target === gl.TEXTURE_CUBE_MAP
    }

    _verifyTextureCompleteness(target: GLenum, pname: GLenum, param: GLenum) {
        const unit = this._getActiveTextureUnit()
        let texture: WebGLTexture | null = null
        if (target === gl.TEXTURE_2D) {
            texture = unit._bind2D
        } else if (this._validCubeTarget(target)) {
            texture = unit._bindCube
        }

        // oes_texture_float but not oes_texture_float_linear
        if (this._extensions.oes_texture_float && !this._extensions.oes_texture_float_linear && texture && texture._type === gl.FLOAT && (pname === gl.TEXTURE_MAG_FILTER || pname === gl.TEXTURE_MIN_FILTER) && (param === gl.LINEAR || param === gl.LINEAR_MIPMAP_NEAREST || param === gl.NEAREST_MIPMAP_LINEAR || param === gl.LINEAR_MIPMAP_LINEAR)) {
            texture._complete = false
            this.bindTexture(target, texture)
            return
        }

        if (texture && texture._complete === false) {
            texture._complete = true
            this.bindTexture(target, texture)
        }
    }

    _wrapShader(type: GLenum, source: string) { // eslint-disable-line
        // the gl implementation seems to define `GL_OES_standard_derivatives` even when the extension is disabled
        // this behaviour causes one conformance test ('GL_OES_standard_derivatives defined in shaders when extension is disabled') to fail
        // by `undef`ing `GL_OES_standard_derivatives`, this appears to solve the issue
        if (!this._extensions.oes_standard_derivatives && /#ifdef\s+GL_OES_standard_derivatives/.test(source)) {
            source = '#undef GL_OES_standard_derivatives\n' + source
        }

        return this._extensions.webgl_draw_buffers ? source : '#define gl_MaxDrawBuffers 1\n' + source // eslint-disable-line
    }

    _beginAttrib0Hack() {
        this._native.bindBuffer(gl.ARRAY_BUFFER, this._attrib0Buffer?._ || null)
        const uInt8Data = new Uint8Array(this._vertexGlobalState._attribs[0]._data.buffer);
        this._native.bufferData(
            gl.ARRAY_BUFFER,
            uInt8Data,
            gl.STREAM_DRAW)
        this._native.enableVertexAttribArray(0)
        this._native.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0)
        // TODO: this._native._vertexAttribDivisor(0, 1)
    }

    _endAttrib0Hack() {
        const attrib = this._vertexObjectState._attribs[0]
        if (attrib._pointerBuffer) {
            this._native.bindBuffer(gl.ARRAY_BUFFER, attrib._pointerBuffer._)
        } else {
            this._native.bindBuffer(gl.ARRAY_BUFFER, 0)
        }
        this._native.vertexAttribPointer(
            0,
            attrib._inputSize,
            attrib._pointerType,
            attrib._pointerNormal,
            attrib._inputStride,
            attrib._pointerOffset)
        // TODO: this._native._vertexAttribDivisor(0, attrib._divisor)
        this._native.disableVertexAttribArray(0)
        if (this._vertexGlobalState._arrayBufferBinding) {
            this._native.bindBuffer(gl.ARRAY_BUFFER, this._vertexGlobalState._arrayBufferBinding._)
        } else {
            this._native.bindBuffer(gl.ARRAY_BUFFER, 0)
        }
    }

    _allocateDrawingBuffer(width: number, height: number) {
        const newFramebuffer = this._native.createFramebuffer();

        this._drawingBuffer = new WebGLDrawingBufferWrapper(
            this._native.createFramebuffer(),
            this._native.createTexture(),
            this._native.createRenderbuffer())

        this._resizeDrawingBuffer(width, height)
    }

    /**
     * The `WebGLRenderingContext.getContextAttributes()` method returns a `WebGLContextAttributes` object that contains the actual context parameters.
     * Might return `null`, if the context is lost. 
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes
     * @returns A `WebGLContextAttributes` object that contains the actual context parameters, or `null` if the context is lost. 
     */
    getContextAttributes(): WebGLContextAttributes | null {
        return this._contextAttributes;
    }

    getExtension(name: string): any {
        const str = name.toLowerCase()
        if (str in this._extensions) {
            return this._extensions[str]
        }
        const ext = availableExtensions[str] ? availableExtensions[str](this) : null
        if (ext) {
            this._extensions[str] = ext
        }
        return ext
    }

    bufferData(target: GLenum, size: GLsizeiptr, usage: GLenum): void;
    bufferData(target: GLenum, data: TypedArray | BufferSource | null, usage: GLenum): void;
    bufferData(target: GLenum = 0, dataOrSize: GLsizeiptr | TypedArray | BufferSource | null, usage: GLenum = 0): void {
        let size = 0;
        let data: BufferSource | null = null;

        if (typeof dataOrSize === 'number') {
            size = dataOrSize;
        } else if (typeof dataOrSize === 'object') {
            data = dataOrSize;
        }

        if (usage !== gl.STREAM_DRAW &&
            usage !== gl.STATIC_DRAW &&
            usage !== gl.DYNAMIC_DRAW) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (target !== gl.ARRAY_BUFFER &&
            target !== gl.ELEMENT_ARRAY_BUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        const active = this._getActiveBuffer(target)
        if (!active) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (data) {
            let u8Data = null
            if (isTypedArray(data as TypedArray)) {
                u8Data = unpackTypedArray(data as TypedArray)
            } else if (data instanceof ArrayBuffer) {
                u8Data = new Uint8Array(data)
            } else {
                this.setError(gl.INVALID_VALUE)
                return
            }

            this._saveError()
            this._native.bufferData(
                target,
                u8Data,
                usage)
            const error = this.getError()
            this._restoreError(error)
            if (error !== gl.NO_ERROR) {
                return
            }

            active._size = u8Data.length
            if (target === gl.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(u8Data)
            }
        } else if (typeof dataOrSize === 'number') {
            if (size < 0) {
                this.setError(gl.INVALID_VALUE)
                return
            }

            this._saveError()
            this._native.bufferDataSizeOnly(
                target,
                size,
                usage)
            const error = this.getError()
            this._restoreError(error)
            if (error !== gl.NO_ERROR) {
                return
            }

            active._size = size
            if (target === gl.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(size)
            }
        } else {
            this.setError(gl.INVALID_VALUE)
        }
    }
    bufferSubData(target: GLenum = 0, offset: GLintptr = 0, data: BufferSource): void {
        if (target !== gl.ARRAY_BUFFER &&
            target !== gl.ELEMENT_ARRAY_BUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (data === null) {
            return
        }

        if (!data || typeof data !== 'object') {
            this.setError(gl.INVALID_VALUE)
            return
        }

        const active = this._getActiveBuffer(target)
        if (!active) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (offset < 0 || offset >= active._size) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        let u8Data = null
        if (isTypedArray(data as any)) {
            u8Data = unpackTypedArray(data as any)
        } else if (data instanceof ArrayBuffer) {
            u8Data = new Uint8Array(data)
        } else {
            this.setError(gl.INVALID_VALUE)
            return
        }

        if (offset + u8Data.length > active._size) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        if (target === gl.ELEMENT_ARRAY_BUFFER) {
            active._elements.set(u8Data, offset)
        }

        this._native.bufferSubData(target, offset, u8Data);
    }
    compressedTexImage2D(target: GLenum, level: GLint, internalFormat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: TypedArray): void {
        return this._native.compressedTexImage2D(target, level, internalFormat, width, height, border, unpackTypedArray(data));
    }
    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: TypedArray): void {
        return this._native.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, unpackTypedArray(data));
    }
    readPixels(x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, format: GLenum = 0, type: GLenum = 0, pixels: TypedArray | null): void {
        if(!pixels) return;
        // return this._native.readPixels(x, y, width, height, format, type, pixels);

        if (!(this._extensions.oes_texture_float && type === gl.FLOAT && format === gl.RGBA)) {
            if (format === gl.RGB ||
                format === gl.ALPHA ||
                type !== gl.UNSIGNED_BYTE) {
                this.setError(gl.INVALID_OPERATION)
                return
            } else if (format !== gl.RGBA) {
                this.setError(gl.INVALID_ENUM)
                return
            } else if (
                width < 0 ||
                height < 0 ||
                !(pixels instanceof Uint8Array)) {
                this.setError(gl.INVALID_VALUE)
                return
            }
        }

        if (!this._framebufferOk()) {
            return
        }

        let rowStride = width * 4
        if (rowStride % this._packAlignment !== 0) {
            rowStride += this._packAlignment - (rowStride % this._packAlignment)
        }

        const imageSize = rowStride * (height - 1) + width * 4
        if (imageSize <= 0) {
            return
        }
        const pixelsLength = (pixels as any).length || pixels.byteLength || 0;
        if (pixelsLength < imageSize) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        // Handle reading outside the window
        let viewWidth = this.drawingBufferWidth
        let viewHeight = this.drawingBufferHeight

        if (this._activeFramebuffer) {
            viewWidth = this._activeFramebuffer._width
            viewHeight = this._activeFramebuffer._height
        }

        const pixelData = unpackTypedArray(pixels)

        if (x >= viewWidth || x + width <= 0 ||
            y >= viewHeight || y + height <= 0) {
            for (let i = 0; i < pixelData.length; ++i) {
                pixelData[i] = 0
            }
        } else if (x < 0 || x + width > viewWidth ||
            y < 0 || y + height > viewHeight) {
            for (let i = 0; i < pixelData.length; ++i) {
                pixelData[i] = 0
            }

            let nx = x
            let nWidth = width
            if (x < 0) {
                nWidth += x
                nx = 0
            }
            if (nx + width > viewWidth) {
                nWidth = viewWidth - nx
            }
            let ny = y
            let nHeight = height
            if (y < 0) {
                nHeight += y
                ny = 0
            }
            if (ny + height > viewHeight) {
                nHeight = viewHeight - ny
            }

            let nRowStride = nWidth * 4
            if (nRowStride % this._packAlignment !== 0) {
                nRowStride += this._packAlignment - (nRowStride % this._packAlignment)
            }

            if (nWidth > 0 && nHeight > 0) {
                const subPixels = new Uint8Array(nRowStride * nHeight)
                this._native.readPixels(
                    nx,
                    ny,
                    nWidth,
                    nHeight,
                    format,
                    type,
                    subPixels)

                const offset = 4 * (nx - x) + (ny - y) * rowStride
                for (let j = 0; j < nHeight; ++j) {
                    for (let i = 0; i < nWidth; ++i) {
                        for (let k = 0; k < 4; ++k) {
                            pixelData[offset + j * rowStride + 4 * i + k] =
                                subPixels[j * nRowStride + 4 * i + k]
                        }
                    }
                }
            }
        } else {
            this._native.readPixels(
                x,
                y,
                width,
                height,
                format,
                type,
                pixelData)
        }

    }
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/javascript/webgl-rendering-context.js#L3131
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrBorder: TexImageSource | GLint, _format?: GLenum, _type?: GLenum, _pixels?: ArrayBufferView | null): void {

        let width: number = 0;
        let height: number = 0;
        let format: number = 0;
        let type: number = 0;
        let source: TexImageSource;
        let border: number = 0;
        let pixels: ArrayBufferView | null = null;

        if (arguments.length === 6) {
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

        // Need to check for out of memory error
        this._saveError()
        this._native.texImage2D(
            target,
            level,
            internalFormat,
            width,
            height,
            border,
            format,
            type,
            data)
        const error = this.getError()
        this._restoreError(error)
        if (error !== gl.NO_ERROR) {
            return
        }

        // Save width and height at level
        texture._levelWidth[level] = width
        texture._levelHeight[level] = height
        texture._format = format
        texture._type = type

        const activeFramebuffer = this._activeFramebuffer
        if (activeFramebuffer) {
            let needsUpdate = false
            const attachments = this._getAttachments()
            for (let i = 0; i < attachments.length; ++i) {
                if (activeFramebuffer._attachments[attachments[i]] === texture) {
                    needsUpdate = true
                    break
                }
            }
            if (needsUpdate && this._activeFramebuffer) {
                this._updateFramebufferAttachments(this._activeFramebuffer)
            }
        }
    }
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource): void;
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, formatOrWidth: GLenum | GLsizei, typeOrHeight: GLenum | GLsizei, sourceOrFormat: TexImageSource | GLenum, type?: GLenum, pixels?: ArrayBufferView | null): void {

    }

    _checkUniformValid(location: WebGLUniformLocation | null, v0: GLfloat, name: string, count: number, type: string) {
        if (!checkObject(location)) {
            throw new TypeError(`${name}(WebGLUniformLocation, ...)`)
        } else if (!location) {
            return false
        } else if (this._checkLocationActive(location)) {
            const utype = location._activeInfo.type
            if (utype === gl.SAMPLER_2D || utype === gl.SAMPLER_CUBE) {
                if (count !== 1) {
                    this.setError(gl.INVALID_VALUE)
                    return
                }
                if (type !== 'i') {
                    this.setError(gl.INVALID_OPERATION)
                    return
                }
                if (v0 < 0 || v0 >= this._textureUnits.length) {
                    this.setError(gl.INVALID_VALUE)
                    return false
                }
            }
            if (uniformTypeSize(utype) > count) {
                this.setError(gl.INVALID_OPERATION)
                return false
            }
            return true
        }
        return false
    }

    _checkUniformValueValid(location: WebGLUniformLocation | null, value: Float32List | Int32List, name: string, count: number, type: string) {
        if (!checkObject(location) ||
            !checkObject(value)) {
            throw new TypeError(`${name}v(WebGLUniformLocation, Array)`)
        } else if (!location) {
            return false
        } else if (!this._checkLocationActive(location)) {
            return false
        } else if (typeof value !== 'object' || !value || typeof value.length !== 'number') {
            throw new TypeError(`Second argument to ${name} must be array`)
        } else if (uniformTypeSize(location._activeInfo.type) > count) {
            this.setError(gl.INVALID_OPERATION)
            return false
        } else if (value.length >= count && value.length % count === 0) {
            if (location._array) {
                return true
            } else if (value.length === count) {
                return true
            } else {
                this.setError(gl.INVALID_OPERATION)
                return false
            }
        }
        this.setError(gl.INVALID_VALUE)
        return false
    }

    uniform1fv(location: WebGLUniformLocation | null, value: Float32List | Int32List): void {
        if (!location || this._checkUniformValueValid(location, value, 'uniform1fv', 1, 'f')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && i < value.length; ++i) {
                const loc = locs[i]
                this._native.uniform1f(loc, value[i])
            }
            return
        }
        this._native.uniform1f(location?._ | 0, value[0])
    }

    uniform1iv(location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform1iv', 1, 'i')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform1i(loc, v[i])
            }
            return
        }
        this.uniform1i(location, v[0])
    }

    uniform2fv(location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform2fv', 2, 'f')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform2f(loc, v[2 * i], v[(2 * i) + 1])
            }
            return
        }
        this._native.uniform2f(location?._ || 0, v[0], v[1])
    }

    uniform2iv(location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform2iv', 2, 'i')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform2i(loc, v[2 * i], v[2 * i + 1])
            }
            return
        }
        this.uniform2i(location, v[0], v[1])
    }

    uniform3fv(location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform3fv', 3, 'f')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform3f(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2])
            }
            return
        }
        this._native.uniform3f(location?._ || 0, v[0], v[1], v[2])
    }
    uniform3iv(location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform3iv', 3, 'i')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform3i(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2])
            }
            return
        }
        this.uniform3i(location, v[0], v[1], v[2])
    }
    uniform4fv(location: WebGLUniformLocation | null, v: Float32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform4fv', 4, 'f')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform4f(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3])
            }
            return
        }
        this._native.uniform4f(location?._ || 0, v[0], v[1], v[2], v[3])
    }
    uniform4iv(location: WebGLUniformLocation | null, v: Int32List): void {
        if (!this._checkUniformValueValid(location, v, 'uniform4iv', 4, 'i')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
                const loc = locs[i]
                this._native.uniform4i(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3])
            }
            return
        }
        this.uniform4i(location, v[0], v[1], v[2], v[3])
    }

    _checkUniformMatrix(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List, name: string, count: number) {
        if (!checkObject(location) ||
            typeof value !== 'object') {
            throw new TypeError(name + '(WebGLUniformLocation, Boolean, Array)')
        } else if (!!transpose ||
            typeof value !== 'object' ||
            value === null ||
            !value.length ||
            value.length % count * count !== 0) {
            this.setError(gl.INVALID_VALUE)
            return false
        }
        if (!location) {
            return false
        }
        if (!this._checkLocationActive(location)) {
            return false
        }

        if (value.length === count * count) {
            return true
        } else if (location._array) {
            return true
        }
        this.setError(gl.INVALID_VALUE)
        return false
    }

    uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix2fv', 2)) return
        const data = new Float32Array(value)
        this._native.uniformMatrix2fv(
            location?._ || 0,
            !!transpose,
            listToArray(data))
    }
    uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix3fv', 3)) return
        const data = new Float32Array(value)
        this._native.uniformMatrix3fv(
            location?._ || 0,
            !!transpose,
            listToArray(data))
    }
    uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: GLboolean, value: Float32List): void {
        if (!this._checkUniformMatrix(location, transpose, value, 'uniformMatrix4fv', 4)) return
        const data = new Float32Array(value)
        this._native.uniformMatrix4fv(
            location?._ || 0,
            !!transpose,
            listToArray(data))
    }

    //////////// BASE ////////////

    activeTexture(texture: GLenum = 0): void {
        // return this._native.activeTexture(texture);
        const texNum = texture - gl.TEXTURE0
        if (texNum >= 0 && texNum < this._textureUnits.length) {
            this._activeTextureUnit = texNum
            return this._native.activeTexture(texture)
        }

        this.setError(gl.INVALID_ENUM)
    }
    attachShader(program: WebGLProgram, shader: WebGLShader): void {
        // return this._native.attachShader(program._, shader._);
        if (!checkObject(program) ||
            !checkObject(shader)) {
            throw new TypeError('attachShader(WebGLProgram, WebGLShader)')
        }
        if (!program || !shader) {
            this.setError(gl.INVALID_VALUE)
            return
        } else if (program instanceof WebGLProgram &&
            shader instanceof WebGLShader &&
            this._checkOwns(program) &&
            this._checkOwns(shader)) {
            if (!program._linked(shader)) {
                this._saveError()
                this._native.attachShader(
                    program._ | 0,
                    shader._ | 0)
                const error = this.getError()
                this._restoreError(error)
                if (error === gl.NO_ERROR) {
                    program._link(shader)
                }
                return
            }
        }
        this.setError(gl.INVALID_OPERATION)
    }
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void {
        // return this._native.bindAttribLocation(program._, index, name);
        if (!checkObject(program) ||
            typeof name !== 'string') {
            throw new TypeError('bindAttribLocation(WebGLProgram, GLint, String)')
        }
        name += ''
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(gl.INVALID_VALUE)
        } else if (/^_?webgl_a/.test(name)) {
            this.setError(gl.INVALID_OPERATION)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return this._native.bindAttribLocation(
                program._ | 0,
                index | 0,
                name)
        }
    }
    bindBuffer(target: GLenum = 0, buffer: WebGLBuffer | null): void {
        // return this._native.bindBuffer(target, buffer?._ || null);
        if (!checkObject(buffer)) {
            throw new TypeError('bindBuffer(GLenum, WebGLBuffer)')
        }
        if (target !== gl.ARRAY_BUFFER &&
            target !== gl.ELEMENT_ARRAY_BUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (!buffer) {
            buffer = null
            this._native.bindBuffer(target, 0)
        } else if (buffer._pendingDelete) {
            return
        } else if (this._checkWrapper(buffer, WebGLBuffer)) {
            if (buffer._binding && buffer._binding !== target) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
            buffer._binding = target | 0

            this._native.bindBuffer(target, buffer._ | 0)
        } else {
            return
        }

        if (target === gl.ARRAY_BUFFER) {
            // Buffers of type ARRAY_BUFFER are bound to the global vertex state.
            this._vertexGlobalState.setArrayBuffer(buffer)
        } else {
            // Buffers of type ELEMENT_ARRAY_BUFFER are bound to vertex array object state.
            this._vertexObjectState.setElementArrayBuffer(buffer)
        }
    }
    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        // return this._native.bindFramebuffer(target, framebuffer?._ || null);
        if (!checkObject(framebuffer)) {
            throw new TypeError('bindFramebuffer(GLenum, WebGLFramebuffer)')
        }
        if (target !== gl.FRAMEBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }
        if (!framebuffer) {
            this._native.bindFramebuffer(
                gl.FRAMEBUFFER,
                this._drawingBuffer?._framebuffer || null)
        } else if (framebuffer._pendingDelete) {
            return
        } else if (this._checkWrapper(framebuffer, WebGLFramebuffer)) {
            this._native.bindFramebuffer(
                gl.FRAMEBUFFER,
                framebuffer._ | 0)
        } else {
            return
        }
        const activeFramebuffer = this._activeFramebuffer
        if (activeFramebuffer !== framebuffer) {
            if (activeFramebuffer) {
                activeFramebuffer._refCount -= 1
                activeFramebuffer._checkDelete()
            }
            if (framebuffer) {
                framebuffer._refCount += 1
            }
        }
        this._activeFramebuffer = framebuffer
        if (framebuffer) {
            this._updateFramebufferAttachments(framebuffer)
        }
    }
    bindRenderbuffer(target: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        // return this._native.bindRenderbuffer(target, renderbuffer?._ || null);
        if (!checkObject(renderbuffer)) {
            throw new TypeError('bindRenderbuffer(GLenum, WebGLRenderbuffer)')
        }

        if (target !== gl.RENDERBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (!renderbuffer) {
            this._native.bindRenderbuffer(
                target | 0,
                0)
        } else if (renderbuffer._pendingDelete) {
            return
        } else if (this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
            this._native.bindRenderbuffer(
                target | 0,
                renderbuffer._ | 0)
        } else {
            return
        }
        const active = this._activeRenderbuffer
        if (active !== renderbuffer) {
            if (active) {
                active._refCount -= 1
                active._checkDelete()
            }
            if (renderbuffer) {
                renderbuffer._refCount += 1
            }
        }
        this._activeRenderbuffer = renderbuffer
    }
    bindTexture(target: GLenum = 0, texture: WebGLTexture | null): void {
        if (!checkObject(texture)) {
            throw new TypeError('bindTexture(GLenum, WebGLTexture)')
        }

        if (!this._validTextureTarget(target)) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        // Get texture id
        let textureId = 0
        if (!texture) {
            texture = null
        } else if (texture instanceof WebGLTexture &&
            texture._pendingDelete) {
            // Special case: error codes for deleted textures don't get set for some dumb reason
            return
        } else if (this._checkWrapper(texture, WebGLTexture)) {
            // Check binding mode of texture
            if (texture._binding && texture._binding !== target) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
            texture._binding = target

            if (texture._complete) {
                textureId = texture._ | 0
            }
        } else {
            return
        }

        this._saveError()
        this._native.bindTexture(
            target,
            textureId)
        const error = this.getError()
        this._restoreError(error)

        if (error !== gl.NO_ERROR) {
            return
        }

        const activeUnit = this._getActiveTextureUnit()
        const activeTex = this._getActiveTexture(target)

        // Update references
        if (activeTex !== texture) {
            if (activeTex) {
                activeTex._refCount -= 1
                activeTex._checkDelete()
            }
            if (texture) {
                texture._refCount += 1
            }
        }

        if (target === gl.TEXTURE_2D) {
            activeUnit._bind2D = texture
        } else if (target === gl.TEXTURE_CUBE_MAP) {
            activeUnit._bindCube = texture
        }
    }
    blendColor(red: GLclampf = 0, green: GLclampf = 0, blue: GLclampf = 0, alpha: GLclampf = 0): void {
        return this._native.blendColor(+red, +green, +blue, +alpha);
    }
    blendEquation(mode: GLenum = 0): void {
        if (this._validBlendMode(mode)) {
            return this._native.blendEquation(mode)
        }
        this.setError(gl.INVALID_ENUM)
    }
    blendEquationSeparate(modeRGB: GLenum = 0, modeAlpha: GLenum = 0): void {
        if (this._validBlendMode(modeRGB) && this._validBlendMode(modeAlpha)) {
            return this._native.blendEquationSeparate(modeRGB, modeAlpha)
        }
        this.setError(gl.INVALID_ENUM)
    }
    blendFunc(sfactor: GLenum = 0, dfactor: GLenum = 0): void {
        if (!this._validBlendFunc(sfactor) ||
            !this._validBlendFunc(dfactor)) {
            this.setError(gl.INVALID_ENUM)
            return
        }
        if (this._isConstantBlendFunc(sfactor) && this._isConstantBlendFunc(dfactor)) {
            this.setError(gl.INVALID_OPERATION)
            return
        }
        this._native.blendFunc(sfactor, dfactor)
    }
    blendFuncSeparate(srcRGB: GLenum = 0, dstRGB: GLenum = 0, srcAlpha: GLenum = 0, dstAlpha: GLenum = 0): void {
        if (!(this._validBlendFunc(srcRGB) &&
            this._validBlendFunc(dstRGB) &&
            this._validBlendFunc(srcAlpha) &&
            this._validBlendFunc(dstAlpha))) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if ((this._isConstantBlendFunc(srcRGB) && this._isConstantBlendFunc(dstRGB)) ||
            (this._isConstantBlendFunc(srcAlpha) && this._isConstantBlendFunc(dstAlpha))) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        this._native.blendFuncSeparate(
            srcRGB,
            dstRGB,
            srcAlpha,
            dstAlpha)
    }
    checkFramebufferStatus(target: GLenum): GLenum {
        if (target !== gl.FRAMEBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return 0
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            return gl.FRAMEBUFFER_COMPLETE
        }

        return this._preCheckFramebufferStatus(framebuffer)
        // return this._native.checkFramebufferStatus(target);
    }
    clear(mask: GLbitfield = 0): void {
        if (!this._framebufferOk()) {
            return
        }
        return this._native.clear(mask);
    }
    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return this._native.clearColor(+red, +green, +blue, +alpha);
    }
    clearDepth(depth: GLclampf): void {
        return this._native.clearDepth(+depth);
    }
    clearStencil(s: GLint = 0): void {
        this._checkStencil = false;
        return this._native.clearStencil(s);
    }
    colorMask(red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void {
        return this._native.colorMask(!!red, !!green, !!blue, !!alpha);
    }
    compileShader(shader: WebGLShader): void {
        if (!checkObject(shader)) {
            throw new TypeError('compileShader(WebGLShader)')
        }
        if (this._checkWrapper(shader, WebGLShader) &&
            this._checkShaderSource(shader)) {
            const prevError = this.getError()
            this._native.compileShader(shader._ | 0)
            const error = this.getError()
            shader._compileStatus = !!this._native.getShaderParameter(
                shader._ | 0,
                gl.COMPILE_STATUS)
            shader._compileInfo = this._native.getShaderInfoLog(shader._ | 0) || 'null'
            this.getError()
            this.setError(prevError || error)
        }
    }
    copyTexImage2D(target: GLenum = 0, level: GLint = 0, internalFormat: GLenum = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, border: GLint = 0): void {
        const texture = this._getTexImage(target)
        if (!texture) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (internalFormat !== gl.RGBA &&
            internalFormat !== gl.RGB &&
            internalFormat !== gl.ALPHA &&
            internalFormat !== gl.LUMINANCE &&
            internalFormat !== gl.LUMINANCE_ALPHA) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (level < 0 || width < 0 || height < 0 || border !== 0) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        if (level > 0 && !(bits.isPow2(width) && bits.isPow2(height))) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        this._saveError()
        this._native.copyTexImage2D(
            target,
            level,
            internalFormat,
            x,
            y,
            width,
            height,
            border)
        const error = this.getError()
        this._restoreError(error)

        if (error === gl.NO_ERROR) {
            texture._levelWidth[level] = width
            texture._levelHeight[level] = height
            texture._format = gl.RGBA
            texture._type = gl.UNSIGNED_BYTE
        }
    }
    copyTexSubImage2D(target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        const texture = this._getTexImage(target)
        if (!texture) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (width < 0 || height < 0 || xoffset < 0 || yoffset < 0 || level < 0) {
            this.setError(gl.INVALID_VALUE)
            return
        }

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
        if (!id || id <= 0) return null
        const webGLBuffer = new WebGLBuffer(id, this)
        this._buffers[id] = webGLBuffer
        return webGLBuffer
    }
    createFramebuffer(): WebGLFramebuffer | null {
        const id = this._native.createFramebuffer()
        if (id <= 0) return null
        const webGLFramebuffer = new WebGLFramebuffer(id, this)
        this._framebuffers[id] = webGLFramebuffer
        return webGLFramebuffer
    }
    createProgram(): WebGLProgram | null {
        const id = this._native.createProgram()
        if (id <= 0) return null
        const webGLProgram = new WebGLProgram(id, this)
        this._programs[id] = webGLProgram
        return webGLProgram
    }
    createRenderbuffer(): WebGLRenderbuffer | null {
        // return this._native.createRenderbuffer() as WebGLRenderbuffer | null;
        const id = this._native.createRenderbuffer();
        if (id <= 0) return null
        const webGLRenderbuffer = new WebGLRenderbuffer(id, this)
        this._renderbuffers[id] = webGLRenderbuffer
        return webGLRenderbuffer

    }
    createShader(type: GLenum = 0): WebGLShader | null {
        // return this._native.createShader(type);
        if (type !== gl.FRAGMENT_SHADER &&
            type !== gl.VERTEX_SHADER) {
            this.setError(gl.INVALID_ENUM)
            return null
        }
        const id = this._native.createShader(type)
        if (id < 0) {
            return null
        }
        const result = new WebGLShader(id, this, type)
        this._shaders[id] = result
        return result
    }

    createTexture(): WebGLTexture | null {
        const id = this._native.createTexture();
        if (id <= 0) return null
        const webGlTexture = new WebGLTexture(id, this)
        this._textures[id] = webGlTexture
        return webGlTexture;
    }

    cullFace(mode: GLenum): void {
        return this._native.cullFace(mode | 0);
    }

    deleteBuffer(buffer: WebGLBuffer | null): void {
        // return this._native.deleteBuffer(buffer?._ || null);

        if (!checkObject(buffer) ||
            (buffer !== null && !(buffer instanceof WebGLBuffer))) {
            throw new TypeError('deleteBuffer(WebGLBuffer)')
        }

        if (!(buffer instanceof WebGLBuffer &&
            this._checkOwns(buffer))) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (this._vertexGlobalState._arrayBufferBinding === buffer) {
            this.bindBuffer(gl.ARRAY_BUFFER, null)
        }
        if (this._vertexObjectState._elementArrayBufferBinding === buffer) {
            this.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
        }

        if (this._vertexObjectState === this._defaultVertexObjectState) {
            // If no vertex array object is bound, release attrib bindings for the
            // array buffer.
            this._vertexObjectState.releaseArrayBuffer(buffer)
        }

        buffer._pendingDelete = true
        buffer._checkDelete()
    }

    deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void {
        // return this._native.deleteFramebuffer(framebuffer?._ || null);

        if (!checkObject(framebuffer)) {
            throw new TypeError('deleteFramebuffer(WebGLFramebuffer)')
        }

        if (!(framebuffer instanceof WebGLFramebuffer &&
            this._checkOwns(framebuffer))) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (this._activeFramebuffer === framebuffer) {
            this.bindFramebuffer(gl.FRAMEBUFFER, null)
        }

        framebuffer._pendingDelete = true
        framebuffer._checkDelete()
    }

    _deleteLinkable(name: 'deleteProgram', object: WebGLProgram | null, Type: typeof WebGLProgram): void;
    _deleteLinkable(name: 'deleteShader', object: WebGLShader | null, Type: typeof WebGLShader): void;
    _deleteLinkable(name: string, object: any, Type: any): void {
        if (!checkObject(object)) {
            throw new TypeError(name + '(' + Type.name + ')')
        }
        if (object instanceof Type &&
            this._checkOwns(object)) {
            object._pendingDelete = true
            object._checkDelete()
            return
        }
        this.setError(gl.INVALID_OPERATION)
    }

    deleteProgram(program: WebGLProgram | null): void {
        // return this._native.deleteProgram(program?._ || null);
        return this._deleteLinkable('deleteProgram', program, WebGLProgram)
    }

    // Need to handle textures and render buffers as a special case:
    // When a texture gets deleted, we need to do the following extra steps:
    //  1. Is it bound to the current texture unit?
    //     If so, then unbind it
    //  2. Is it attached to the active fbo?
    //     If so, then detach it
    //
    // For renderbuffers only need to do second step
    //
    // After this, proceed with the usual deletion algorithm
    //
    deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
        // return this._native.deleteRenderbuffer(renderbuffer?._ || null);

        if (!checkObject(renderbuffer)) {
            throw new TypeError('deleteRenderbuffer(WebGLRenderbuffer)')
        }

        if (!(renderbuffer instanceof WebGLRenderbuffer &&
            this._checkOwns(renderbuffer))) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (this._activeRenderbuffer === renderbuffer) {
            this.bindRenderbuffer(gl.RENDERBUFFER, null)
        }

        const activeFramebuffer = this._activeFramebuffer

        this._tryDetachFramebuffer(activeFramebuffer, renderbuffer)

        renderbuffer._pendingDelete = true
        renderbuffer._checkDelete()
    }

    deleteShader(shader: WebGLShader | null): void {
        // return this._native.deleteShader(shader?._ || null);
        return this._deleteLinkable('deleteShader', shader, WebGLShader)
    }

    deleteTexture(texture: WebGLTexture | null): void {
        // return this._native.deleteTexture(texture?._ || null);
        if (!checkObject(texture)) {
            throw new TypeError('deleteTexture(WebGLTexture)')
        }

        if (texture instanceof WebGLTexture) {
            if (!this._checkOwns(texture)) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
        } else {
            return
        }

        // Unbind from all texture units
        const curActive = this._activeTextureUnit

        for (let i = 0; i < this._textureUnits.length; ++i) {
            const unit = this._textureUnits[i]
            if (unit._bind2D === texture) {
                this.activeTexture(gl.TEXTURE0 + i)
                this.bindTexture(gl.TEXTURE_2D, null)
            } else if (unit._bindCube === texture) {
                this.activeTexture(gl.TEXTURE0 + i)
                this.bindTexture(gl.TEXTURE_CUBE_MAP, null)
            }
        }
        this.activeTexture(gl.TEXTURE0 + curActive)

        // FIXME: Does the texture get unbound from *all* framebuffers, or just the
        // active FBO?
        const ctx = this
        const activeFramebuffer = this._activeFramebuffer
        function tryDetach(framebuffer: WebGLFramebuffer | null) {
            if (framebuffer && framebuffer._linked(texture)) {
                const attachments = ctx._getAttachments()
                for (let i = 0; i < attachments.length; ++i) {
                    const attachment = attachments[i]
                    if (framebuffer._attachments[attachment] === texture) {
                        ctx.framebufferTexture2D(
                            gl.FRAMEBUFFER,
                            attachment,
                            gl.TEXTURE_2D,
                            null)
                    }
                }
            }
        }

        tryDetach(activeFramebuffer)

        // Mark texture for deletion
        texture._pendingDelete = true
        texture._checkDelete()
    }

    depthFunc(func: GLenum): void {
        func |= 0
        switch (func) {
            case gl.NEVER:
            case gl.LESS:
            case gl.EQUAL:
            case gl.LEQUAL:
            case gl.GREATER:
            case gl.NOTEQUAL:
            case gl.GEQUAL:
            case gl.ALWAYS:
                return this._native.depthFunc(func)
            default:
                this.setError(gl.INVALID_ENUM)
        }
    }

    depthMask(flag: GLboolean): void {
        return this._native.depthMask(!!flag);
    }

    depthRange(zNear: GLclampf, zFar: GLclampf): void {
        zNear = +zNear
        zFar = +zFar
        // return this._native.depthRange(zNear, zFar);
        if (zNear <= zFar) {
            return this._native.depthRange(zNear, zFar)
        }
        this.setError(gl.INVALID_OPERATION)
    }

    detachShader(program: WebGLProgram, shader: WebGLShader): void {
        //return this._native.detachShader(program._, shader._);
        if (!checkObject(program) ||
            !checkObject(shader)) {
            throw new TypeError('detachShader(WebGLProgram, WebGLShader)')
        }
        if (this._checkWrapper(program, WebGLProgram) &&
            this._checkWrapper(shader, WebGLShader)) {
            if (program._linked(shader)) {
                this._native.detachShader(program._, shader._)
                program._unlink(shader)
            } else {
                this.setError(gl.INVALID_OPERATION)
            }
        }
    }

    disable(cap: GLenum = 0): void {
        this._native.disable(cap);
        if (cap === gl.TEXTURE_2D ||
            cap === gl.TEXTURE_CUBE_MAP) {
            const active = this._getActiveTextureUnit()
            if (active._mode === cap) {
                active._mode = 0
            }
        }
    }

    disableVertexAttribArray(index: GLuint = 0): void {
        // return this._native.disableVertexAttribArray(index);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(gl.INVALID_VALUE)
            return
        }
        this._native.disableVertexAttribArray(index)
        this._vertexObjectState._attribs[index]._isPointer = false
    }

    drawArrays(mode: GLenum = 0, first: GLint = 0, count: GLsizei = 0): void {
        // return this._native.drawArrays(mode, first, count);

        if (first < 0 || count < 0) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const reducedCount = vertexCount(mode, count)
        if (reducedCount < 0) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (!this._framebufferOk()) {
            return
        }

        if (count === 0) {
            return
        }

        let maxIndex = first
        if (count > 0) {
            maxIndex = (count + first - 1) >>> 0
        }
        if (this._checkVertexAttribState(maxIndex)) {
            if (
                this._vertexObjectState._attribs[0]._isPointer || (
                    this._extensions.webgl_draw_buffers &&
                    this._extensions.webgl_draw_buffers._buffersState &&
                    this._extensions.webgl_draw_buffers._buffersState.length > 0
                )
            ) {
                return this._native.drawArrays(mode, first, reducedCount)
            } else {
                this._beginAttrib0Hack()
                // TODO: this._native._drawArraysInstanced(mode, first, reducedCount, 1)
                this._native.drawArrays(mode, first, reducedCount)
                this._endAttrib0Hack()
            }
        }
    }
    drawElements(mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, ioffset: GLintptr = 0): void {
        // return this._native.drawElements(mode, count, type, offset);

        if (count < 0 || ioffset < 0) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding
        if (!elementBuffer) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        // Unpack element data
        let elementData = null
        let offset = ioffset
        if (type === gl.UNSIGNED_SHORT) {
            if (offset % 2) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
            offset >>= 1
            elementData = new Uint16Array(elementBuffer._elements.buffer)
        } else if (this._extensions.oes_element_index_uint && type === gl.UNSIGNED_INT) {
            if (offset % 4) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
            offset >>= 2
            elementData = new Uint32Array(elementBuffer._elements.buffer)
        } else if (type === gl.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements
        } else {
            this.setError(gl.INVALID_ENUM)
            return
        }

        let reducedCount = count
        switch (mode) {
            case gl.TRIANGLES:
                if (count % 3) {
                    reducedCount -= (count % 3)
                }
                break
            case gl.LINES:
                if (count % 2) {
                    reducedCount -= (count % 2)
                }
                break
            case gl.POINTS:
                break
            case gl.LINE_LOOP:
            case gl.LINE_STRIP:
                if (count < 2) {
                    this.setError(gl.INVALID_OPERATION)
                    return
                }
                break
            case gl.TRIANGLE_FAN:
            case gl.TRIANGLE_STRIP:
                if (count < 3) {
                    this.setError(gl.INVALID_OPERATION)
                    return
                }
                break
            default:
                this.setError(gl.INVALID_ENUM)
                return
        }

        if (!this._framebufferOk()) {
            return
        }

        if (count === 0) {
            this._checkVertexAttribState(0)
            return
        }

        if ((count + offset) >>> 0 > elementData.length) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        // Compute max index
        let maxIndex = -1
        for (let i = offset; i < offset + count; ++i) {
            maxIndex = Math.max(maxIndex, elementData[i])
        }

        if (maxIndex < 0) {
            this._checkVertexAttribState(0)
            return
        }

        if (this._checkVertexAttribState(maxIndex)) {
            if (reducedCount > 0) {
                if (this._vertexObjectState._attribs[0]._isPointer) {
                    return this._native.drawElements(mode, reducedCount, type, ioffset)
                } else {
                    this._beginAttrib0Hack()
                    // TODO this._native._drawElementsInstanced(mode, reducedCount, type, ioffset, 1)
                    this._native.drawElements(mode, reducedCount, type, ioffset);
                    this._endAttrib0Hack()
                }
            }
        }
    }
    enable(cap: GLenum = 0): void {
        return this._native.enable(cap);
    }
    enableVertexAttribArray(index: GLuint): void {
        // return this._native.enableVertexAttribArray(index);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        this._native.enableVertexAttribArray(index)

        this._vertexObjectState._attribs[index]._isPointer = true
    }
    finish(): void {
        return this._native.finish();
    }
    flush(): void {
        return this._native.flush();
    }
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbufferTarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        // return this._native.framebufferRenderbuffer(target, attachment, renderbufferTarget, renderbuffer?._ || null);
        if (!checkObject(renderbuffer)) {
            throw new TypeError('framebufferRenderbuffer(GLenum, GLenum, GLenum, WebGLRenderbuffer)')
        }

        if (target !== gl.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment) ||
            renderbufferTarget !== gl.RENDERBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (renderbuffer && !this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
            return
        }

        framebuffer._setAttachment(renderbuffer, attachment)
        this._updateFramebufferAttachments(framebuffer)
    }
    framebufferTexture2D(target: GLenum, attachment: GLenum, textarget: GLenum, texture: WebGLTexture | null, level: GLint = 0): void {
        // return this._native.framebufferTexture2D(target, attachment, textarget, texture?._ || null, level);
        target |= 0
        attachment |= 0
        textarget |= 0
        level |= 0
        if (!checkObject(texture)) {
            throw new TypeError('framebufferTexture2D(GLenum, GLenum, GLenum, WebGLTexture, GLint)')
        }

        // Check parameters are ok
        if (target !== gl.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (level !== 0) {
            this.setError(gl.INVALID_VALUE)
            return
        }

        // Check object ownership
        if (texture && !this._checkWrapper(texture, WebGLTexture)) {
            return
        }

        // Check texture target is ok
        if (textarget === gl.TEXTURE_2D) {
            if (texture && texture._binding !== gl.TEXTURE_2D) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
        } else if (this._validCubeTarget(textarget)) {
            if (texture && texture._binding !== gl.TEXTURE_CUBE_MAP) {
                this.setError(gl.INVALID_OPERATION)
                return
            }
        } else {
            this.setError(gl.INVALID_ENUM)
            return
        }

        // Check a framebuffer is actually bound
        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        framebuffer._attachmentLevel[attachment] = level
        framebuffer._attachmentFace[attachment] = textarget
        framebuffer._setAttachment(texture, attachment)
        this._updateFramebufferAttachments(framebuffer)
    }
    frontFace(mode: GLenum = 0): void {
        return this._native.frontFace(mode);
    }
    generateMipmap(target: GLenum = 0): void {
        return this._native.generateMipmap(target);
    }
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        // return this._native.getActiveAttrib(program._, index);
        if (!checkObject(program)) {
            throw new TypeError('getActiveAttrib(WebGLProgram)')
        } else if (!program) {
            this.setError(gl.INVALID_VALUE)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const info = this._native.getActiveAttrib(program._ | 0, index | 0)
            if (info) {
                return new WebGLActiveInfo(info)
            }
        }
        return null
    }
    getActiveUniform(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        // return this._native.getActiveUniform(program._, index);
        if (!checkObject(program)) {
            throw new TypeError('getActiveUniform(WebGLProgram, GLint)')
        } else if (!program) {
            this.setError(gl.INVALID_VALUE)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const info = this._native.getActiveUniform(program._ | 0, index | 0)
            if (info) {
                return new WebGLActiveInfo(info)
            }
        }
        return null
    }
    getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
        // return this._native.getAttachedShaders(program._) as WebGLShader[] | null;
        if (!checkObject(program) ||
            (typeof program === 'object' &&
                program !== null &&
                !(program instanceof WebGLProgram))) {
            throw new TypeError('getAttachedShaders(WebGLProgram)')
        }
        if (!program) {
            this.setError(gl.INVALID_VALUE)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            const shaderArray = this._native.getAttachedShaders(program._ | 0)
            if (!shaderArray) {
                return null
            }
            const unboxedShaders = new Array(shaderArray.length)
            for (let i = 0; i < shaderArray.length; ++i) {
                unboxedShaders[i] = this._shaders[shaderArray[i]]
            }
            return unboxedShaders
        }
        return null
    }
    getAttribLocation(program: WebGLProgram, name: string): GLint {
        // return this._native.getAttribLocation(program._, name);
        if (!checkObject(program)) {
            throw new TypeError('getAttribLocation(WebGLProgram, String)')
        }
        name += ''
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(gl.INVALID_VALUE)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return this._native.getAttribLocation(program._ | 0, name + '')
        }
        return -1
    }
    getBufferParameter(target: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getBufferParameter(target, pname);
        if (target !== gl.ARRAY_BUFFER &&
            target !== gl.ELEMENT_ARRAY_BUFFER) {
            this.setError(gl.INVALID_ENUM)
            return null
        }

        switch (pname) {
            case gl.BUFFER_SIZE:
            case gl.BUFFER_USAGE:
                return this._native.getBufferParameter(target | 0, pname | 0)
            default:
                this.setError(gl.INVALID_ENUM)
                return null
        }
    }

    getError(): GLenum {
        return this._native.getError();
    }

    setError(error: GLenum) {
        this._native.setError(error);
    }

    getFramebufferAttachmentParameter(target: GLenum = 0, attachment: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getFramebufferAttachmentParameter(target, attachment, pname);
        if (target !== gl.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(gl.INVALID_ENUM)
            return null
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(gl.INVALID_OPERATION)
            return null
        }

        const object = framebuffer._attachments[attachment]
        if (object === null) {
            if (pname === gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) {
                return gl.NONE
            }
        } else if (object instanceof WebGLTexture) {
            switch (pname) {
                case gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object
                case gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return gl.TEXTURE
                case gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:
                    return framebuffer._attachmentLevel[attachment]
                case gl.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: {
                    const face = framebuffer._attachmentFace[attachment]
                    if (face === gl.TEXTURE_2D) {
                        return 0
                    }
                    return face
                }
            }
        } else if (object instanceof WebGLRenderbuffer) {
            switch (pname) {
                case gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object
                case gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return gl.RENDERBUFFER
            }
        }

        this.setError(gl.INVALID_ENUM)
        return null
    }

    getParameter(pname: GLenum = 0): any {
        // return this._native.getParameterx(pname)?.deepUnpack() || null;
        switch (pname) {
            case gl.ARRAY_BUFFER_BINDING:
                return this._vertexGlobalState._arrayBufferBinding
            case gl.ELEMENT_ARRAY_BUFFER_BINDING:
                return this._vertexObjectState._elementArrayBufferBinding
            case gl.CURRENT_PROGRAM:
                return this._activeProgram
            case gl.FRAMEBUFFER_BINDING:
                return this._activeFramebuffer
            case gl.RENDERBUFFER_BINDING:
                return this._activeRenderbuffer
            case gl.TEXTURE_BINDING_2D:
                return this._getActiveTextureUnit()._bind2D
            case gl.TEXTURE_BINDING_CUBE_MAP:
                return this._getActiveTextureUnit()._bindCube
            case gl.VERSION:
                return 'WebGL 1.0 Gjsify ' + VERSION
            case gl.VENDOR:
                return 'Gjsify'
            case gl.RENDERER:
                return 'ANGLE'
            case gl.SHADING_LANGUAGE_VERSION:
                return 'WebGL GLSL ES 1.0 Gjsify'

            case gl.COMPRESSED_TEXTURE_FORMATS:
                return new Uint32Array(0)

            // Int arrays
            case gl.MAX_VIEWPORT_DIMS:
            case gl.SCISSOR_BOX:
            case gl.VIEWPORT:
                return new Int32Array(this._getParameterDirect(pname))

            // Float arrays
            case gl.ALIASED_LINE_WIDTH_RANGE:
            case gl.ALIASED_POINT_SIZE_RANGE:
            case gl.DEPTH_RANGE:
            case gl.BLEND_COLOR:
            case gl.COLOR_CLEAR_VALUE:
                return new Float32Array(this._getParameterDirect(pname))

            case gl.COLOR_WRITEMASK:
                return this._getParameterDirect(pname);

            case gl.DEPTH_CLEAR_VALUE:
            case gl.LINE_WIDTH:
            case gl.POLYGON_OFFSET_FACTOR:
            case gl.POLYGON_OFFSET_UNITS:
            case gl.SAMPLE_COVERAGE_VALUE:
                return +this._getParameterDirect(pname);

            case gl.BLEND:
            case gl.CULL_FACE:
            case gl.DEPTH_TEST:
            case gl.DEPTH_WRITEMASK:
            case gl.DITHER:
            case gl.POLYGON_OFFSET_FILL:
            case gl.SAMPLE_COVERAGE_INVERT:
            case gl.SCISSOR_TEST:
            case gl.STENCIL_TEST:
            case gl.UNPACK_FLIP_Y_WEBGL:
            case gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
                return !!this._getParameterDirect(pname);

            case gl.ACTIVE_TEXTURE:
            case gl.ALPHA_BITS:
            case gl.BLEND_DST_ALPHA:
            case gl.BLEND_DST_RGB:
            case gl.BLEND_EQUATION_ALPHA:
            case gl.BLEND_EQUATION_RGB:
            case gl.BLEND_SRC_ALPHA:
            case gl.BLEND_SRC_RGB:
            case gl.BLUE_BITS:
            case gl.CULL_FACE_MODE:
            case gl.DEPTH_BITS:
            case gl.DEPTH_FUNC:
            case gl.FRONT_FACE:
            case gl.GENERATE_MIPMAP_HINT:
            case gl.GREEN_BITS:
            case gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
            case gl.MAX_CUBE_MAP_TEXTURE_SIZE:
            case gl.MAX_FRAGMENT_UNIFORM_VECTORS:
            case gl.MAX_RENDERBUFFER_SIZE:
            case gl.MAX_TEXTURE_IMAGE_UNITS:
            case gl.MAX_TEXTURE_SIZE:
            case gl.MAX_VARYING_VECTORS:
            case gl.MAX_VERTEX_ATTRIBS:
            case gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
            case gl.MAX_VERTEX_UNIFORM_VECTORS:
            case gl.PACK_ALIGNMENT:
            case gl.RED_BITS:
            case gl.SAMPLE_BUFFERS:
            case gl.SAMPLES:
            case gl.STENCIL_BACK_FAIL:
            case gl.STENCIL_BACK_FUNC:
            case gl.STENCIL_BACK_PASS_DEPTH_FAIL:
            case gl.STENCIL_BACK_PASS_DEPTH_PASS:
            case gl.STENCIL_BACK_REF:
            case gl.STENCIL_BACK_VALUE_MASK:
            case gl.STENCIL_BACK_WRITEMASK:
            case gl.STENCIL_BITS:
            case gl.STENCIL_CLEAR_VALUE:
            case gl.STENCIL_FAIL:
            case gl.STENCIL_FUNC:
            case gl.STENCIL_PASS_DEPTH_FAIL:
            case gl.STENCIL_PASS_DEPTH_PASS:
            case gl.STENCIL_REF:
            case gl.STENCIL_VALUE_MASK:
            case gl.STENCIL_WRITEMASK:
            case gl.SUBPIXEL_BITS:
            case gl.UNPACK_ALIGNMENT:
            case gl.UNPACK_COLORSPACE_CONVERSION_WEBGL:
                return this._getParameterDirect(pname) | 0;

            case gl.IMPLEMENTATION_COLOR_READ_FORMAT:
            case gl.IMPLEMENTATION_COLOR_READ_TYPE:
                return this._getParameterDirect(pname);

            default:
                if (this._extensions.webgl_draw_buffers) {
                    const ext = this._extensions.webgl_draw_buffers
                    switch (pname) {
                        case ext.DRAW_BUFFER0_WEBGL:
                        case ext.DRAW_BUFFER1_WEBGL:
                        case ext.DRAW_BUFFER2_WEBGL:
                        case ext.DRAW_BUFFER3_WEBGL:
                        case ext.DRAW_BUFFER4_WEBGL:
                        case ext.DRAW_BUFFER5_WEBGL:
                        case ext.DRAW_BUFFER6_WEBGL:
                        case ext.DRAW_BUFFER7_WEBGL:
                        case ext.DRAW_BUFFER8_WEBGL:
                        case ext.DRAW_BUFFER9_WEBGL:
                        case ext.DRAW_BUFFER10_WEBGL:
                        case ext.DRAW_BUFFER11_WEBGL:
                        case ext.DRAW_BUFFER12_WEBGL:
                        case ext.DRAW_BUFFER13_WEBGL:
                        case ext.DRAW_BUFFER14_WEBGL:
                        case ext.DRAW_BUFFER15_WEBGL:
                            if (ext._buffersState.length === 1 && ext._buffersState[0] === gl.BACK) {
                                return gl.BACK
                            }
                            return this._getParameterDirect(pname);
                        case ext.MAX_DRAW_BUFFERS_WEBGL:
                        case ext.MAX_COLOR_ATTACHMENTS_WEBGL:
                            return this._getParameterDirect(pname);
                    }
                }

                if (this._extensions.oes_standard_derivatives && pname === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES) {
                    return this._getParameterDirect(pname);
                }

                if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) {
                    return this._getParameterDirect(pname);
                }

                if (this._extensions.oes_vertex_array_object && pname === this._extensions.oes_vertex_array_object.VERTEX_ARRAY_BINDING_OES) {
                    return this._extensions.oes_vertex_array_object._activeVertexArrayObject
                }

                this.setError(gl.INVALID_ENUM)
                return null
        }
    }
    getProgramInfoLog(program: WebGLProgram): string | null {
        // return this._native.getProgramInfoLog(program._);
        if (!checkObject(program)) {
            throw new TypeError('getProgramInfoLog(WebGLProgram)')
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return program._linkInfoLog
        }
        return null
    }
    getProgramParameter(program: WebGLProgram, pname: GLenum = 0): any {
        // return this._native.getProgramParameter(program._, pname);
        if (!checkObject(program)) {
            throw new TypeError('getProgramParameter(WebGLProgram, GLenum)')
        } else if (this._checkWrapper(program, WebGLProgram)) {
            switch (pname) {
                case gl.DELETE_STATUS:
                    return program._pendingDelete

                case gl.LINK_STATUS:
                    return program._linkStatus

                case gl.VALIDATE_STATUS:
                    return !!this._native.getProgramParameter(program._, pname)

                case gl.ATTACHED_SHADERS:
                case gl.ACTIVE_ATTRIBUTES:
                case gl.ACTIVE_UNIFORMS:
                    return this._native.getProgramParameter(program._, pname)
            }
            this.setError(gl.INVALID_ENUM)
        }
        return null
    }
    getRenderbufferParameter(target: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getProgramParameter(target, pname);
        if (target !== gl.RENDERBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return null
        }
        const renderbuffer = this._activeRenderbuffer
        if (!renderbuffer) {
            this.setError(gl.INVALID_OPERATION)
            return null
        }
        switch (pname) {
            case gl.RENDERBUFFER_INTERNAL_FORMAT:
                return renderbuffer._format
            case gl.RENDERBUFFER_WIDTH:
                return renderbuffer._width
            case gl.RENDERBUFFER_HEIGHT:
                return renderbuffer._height
            case gl.RENDERBUFFER_SIZE:
            case gl.RENDERBUFFER_RED_SIZE:
            case gl.RENDERBUFFER_GREEN_SIZE:
            case gl.RENDERBUFFER_BLUE_SIZE:
            case gl.RENDERBUFFER_ALPHA_SIZE:
            case gl.RENDERBUFFER_DEPTH_SIZE:
            case gl.RENDERBUFFER_STENCIL_SIZE:
                return this._native.getRenderbufferParameter(target, pname)
        }
        this.setError(gl.INVALID_ENUM)
        return null
    }
    getShaderInfoLog(shader: WebGLShader): string | null {
        // return this._native.getShaderInfoLog(shader._);
        if (!checkObject(shader)) {
            throw new TypeError('getShaderInfoLog(WebGLShader)')
        } else if (this._checkWrapper(shader, WebGLShader)) {
            return shader._compileInfo
        }
        return null
    }
    getShaderParameter(shader: WebGLShader, pname: GLenum = 0): any {
        // return this._native.getShaderParameter(shader._, pname);
        if (!checkObject(shader)) {
            throw new TypeError('getShaderParameter(WebGLShader, GLenum)')
        } else if (this._checkWrapper(shader, WebGLShader)) {
            switch (pname) {
                case gl.DELETE_STATUS:
                    return shader._pendingDelete
                case gl.COMPILE_STATUS:
                    return shader._compileStatus
                case gl.SHADER_TYPE:
                    return shader._type
            }
            this.setError(gl.INVALID_ENUM)
        }
        return null
    }
    getShaderPrecisionFormat(shaderType: GLenum = 0, precisionType: GLenum = 0): WebGLShaderPrecisionFormat | null {
        // return this._native.getShaderPrecisionFormat(shaderType, precisionType);
        if (!(shaderType === gl.FRAGMENT_SHADER ||
            shaderType === gl.VERTEX_SHADER) ||
            !(precisionType === gl.LOW_FLOAT ||
                precisionType === gl.MEDIUM_FLOAT ||
                precisionType === gl.HIGH_FLOAT ||
                precisionType === gl.LOW_INT ||
                precisionType === gl.MEDIUM_INT ||
                precisionType === gl.HIGH_INT)) {
            this.setError(gl.INVALID_ENUM)
            return null
        }

        const format = this._native.getShaderPrecisionFormat(shaderType, precisionType)
        if (!format) {
            return null
        }

        return new WebGLShaderPrecisionFormat(format)
    }
    getShaderSource(shader: WebGLShader): string | null {
        // return this._native.getShaderSource(shader._);
        if (!checkObject(shader)) {
            throw new TypeError('Input to getShaderSource must be an object')
        } else if (this._checkWrapper(shader, WebGLShader)) {
            return shader._source
        }
        return null
    }
    getSupportedExtensions() {
        const exts = [
            'ANGLE_instanced_arrays',
            'STACKGL_resize_drawingbuffer',
            'STACKGL_destroy_context'
        ]

        const supportedExts = this._native.getSupportedExtensions();

        if (!supportedExts) {
            return exts;
        }

        if (supportedExts.indexOf('GL_OES_element_index_uint') >= 0) {
            exts.push('OES_element_index_uint')
        }

        if (supportedExts.indexOf('GL_OES_standard_derivatives') >= 0) {
            exts.push('OES_standard_derivatives')
        }

        if (supportedExts.indexOf('GL_OES_texture_float') >= 0) {
            exts.push('OES_texture_float')
        }

        if (supportedExts.indexOf('GL_OES_texture_float_linear') >= 0) {
            exts.push('OES_texture_float_linear')
        }

        if (supportedExts.indexOf('EXT_draw_buffers') >= 0) {
            exts.push('WEBGL_draw_buffers')
        }

        if (supportedExts.indexOf('EXT_blend_minmax') >= 0) {
            exts.push('EXT_blend_minmax')
        }

        if (supportedExts.indexOf('EXT_texture_filter_anisotropic') >= 0) {
            exts.push('EXT_texture_filter_anisotropic')
        }

        if (supportedExts.indexOf('GL_OES_vertex_array_object') >= 0) {
            exts.push('OES_vertex_array_object')
        }

        return exts
    }

    _getTexParameterDirect(target: GLenum = 0, pname: GLenum = 0) {
        return this._native.getTexParameterx(target, pname)?.unpack();
    }

    getTexParameter(target: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getTexParameterx(target, pname)?.unpack();
        if (!this._checkTextureTarget(target)) {
            return null
        }

        const unit = this._getActiveTextureUnit()
        if ((target === gl.TEXTURE_2D && !unit._bind2D) ||
            (target === gl.TEXTURE_CUBE_MAP && !unit._bindCube)) {
            this.setError(gl.INVALID_OPERATION)
            return null
        }

        switch (pname) {
            case gl.TEXTURE_MAG_FILTER:
            case gl.TEXTURE_MIN_FILTER:
            case gl.TEXTURE_WRAP_S:
            case gl.TEXTURE_WRAP_T:
                return this._getTexParameterDirect(target, pname)
        }

        if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
            return this._getTexParameterDirect(target, pname)
        }

        this.setError(gl.INVALID_ENUM)
        return null
    }
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
        // return this._native.getUniform(program._, location._);
        if (!checkObject(program) ||
            !checkObject(location)) {
            throw new TypeError('getUniform(WebGLProgram, WebGLUniformLocation)')
        } else if (!program) {
            this.setError(gl.INVALID_VALUE)
            return null
        } else if (!location) {
            return null
        } else if (this._checkWrapper(program, WebGLProgram)) {
            if (!checkUniform(program, location)) {
                this.setError(gl.INVALID_OPERATION)
                return null
            }
            const data = this._native.getUniform(program._ | 0, location._ | 0)
            if (!data) {
                return null
            }
            switch (location._activeInfo.type) {
                case gl.FLOAT:
                    return data[0]
                case gl.FLOAT_VEC2:
                    return new Float32Array(data.slice(0, 2))
                case gl.FLOAT_VEC3:
                    return new Float32Array(data.slice(0, 3))
                case gl.FLOAT_VEC4:
                    return new Float32Array(data.slice(0, 4))
                case gl.INT:
                    return data[0] | 0
                case gl.INT_VEC2:
                    return new Int32Array(data.slice(0, 2))
                case gl.INT_VEC3:
                    return new Int32Array(data.slice(0, 3))
                case gl.INT_VEC4:
                    return new Int32Array(data.slice(0, 4))
                case gl.BOOL:
                    return !!data[0]
                case gl.BOOL_VEC2:
                    return [!!data[0], !!data[1]]
                case gl.BOOL_VEC3:
                    return [!!data[0], !!data[1], !!data[2]]
                case gl.BOOL_VEC4:
                    return [!!data[0], !!data[1], !!data[2], !!data[3]]
                case gl.FLOAT_MAT2:
                    return new Float32Array(data.slice(0, 4))
                case gl.FLOAT_MAT3:
                    return new Float32Array(data.slice(0, 9))
                case gl.FLOAT_MAT4:
                    return new Float32Array(data.slice(0, 16))
                case gl.SAMPLER_2D:
                case gl.SAMPLER_CUBE:
                    return data[0] | 0
                default:
                    return null
            }
        }
        return null
    }
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
        // return this._native.getUniformLocation(program._, name) as WebGLUniformLocation | null;
        if (!checkObject(program)) {
            throw new TypeError('getUniformLocation(WebGLProgram, String)')
        }

        name += ''
        if (!isValidString(name)) {
            this.setError(gl.INVALID_VALUE)
            return null
        }

        if (this._checkWrapper(program, WebGLProgram)) {
            const loc = this._native.getUniformLocation(program._ | 0, name)
            if (loc && loc >= 0) {
                let searchName = name
                if (/\[\d+\]$/.test(name)) {
                    searchName = name.replace(/\[\d+\]$/, '[0]')
                }

                let info = null
                for (let i = 0; i < program._uniforms.length; ++i) {
                    const infoItem = program._uniforms[i]
                    if (infoItem.name === searchName) {
                        info = {
                            size: infoItem.size,
                            type: infoItem.type,
                            name: infoItem.name
                        }
                    }
                }
                if (!info) {
                    return null
                }

                const result = new WebGLUniformLocation(
                    loc,
                    program,
                    info)

                // handle array case
                if (/\[0\]$/.test(name)) {
                    const baseName = name.replace(/\[0\]$/, '')
                    const arrayLocs = []

                    // if (offset < 0 || offset >= info.size) {
                    //   return null
                    // }

                    this._saveError()
                    for (let i = 0; this.getError() === gl.NO_ERROR; ++i) {
                        const xloc = this._native.getUniformLocation(
                            program._ | 0,
                            baseName + '[' + i + ']')
                        if (this.getError() !== gl.NO_ERROR || !xloc || xloc < 0) {
                            break
                        }
                        arrayLocs.push(xloc)
                    }
                    this._restoreError(gl.NO_ERROR)

                    result._array = arrayLocs
                } else if (name && /\[(\d+)\]$/.test(name)) {
                    const _regexExec = /\[(\d+)\]$/.exec(name);
                    if (!_regexExec || _regexExec.length <= 0) {
                        return null;
                    }
                    const offset = +(_regexExec)[1]
                    if (offset < 0 || offset >= info.size) {
                        return null
                    }
                }
                return result
            }
        }
        return null
    }
    getVertexAttrib(index: GLuint = 0, pname: GLenum = 0): any {
        // return this._native.getVertexAttrib(index, pname);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(gl.INVALID_VALUE)
            return null
        }
        const attrib = this._vertexObjectState._attribs[index]
        const vertexAttribValue = this._vertexGlobalState._attribs[index]._data

        const extInstancing = this._extensions.angle_instanced_arrays
        if (extInstancing) {
            if (pname === extInstancing.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE) {
                return attrib._divisor
            }
        }

        switch (pname) {
            case gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
                return attrib._pointerBuffer
            case gl.VERTEX_ATTRIB_ARRAY_ENABLED:
                return attrib._isPointer
            case gl.VERTEX_ATTRIB_ARRAY_SIZE:
                return attrib._inputSize
            case gl.VERTEX_ATTRIB_ARRAY_STRIDE:
                return attrib._inputStride
            case gl.VERTEX_ATTRIB_ARRAY_TYPE:
                return attrib._pointerType
            case gl.VERTEX_ATTRIB_ARRAY_NORMALIZED:
                return attrib._pointerNormal
            case gl.CURRENT_VERTEX_ATTRIB:
                return new Float32Array(vertexAttribValue)
            default:
                this.setError(gl.INVALID_ENUM)
                return null
        }
    }
    getVertexAttribOffset(index: GLuint = 0, pname: GLenum = 0): GLintptr {
        // return this._native.getVertexAttribOffset(index, pname);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(gl.INVALID_VALUE)
            return -1
        }
        if (pname === gl.VERTEX_ATTRIB_ARRAY_POINTER) {
            return this._vertexObjectState._attribs[index]._pointerOffset
        } else {
            this.setError(gl.INVALID_ENUM)
            return -1
        }
    }
    hint(target: GLenum = 0, mode: GLenum = 0): void {
        // return this._native.hint(target, mode);
        if (!(
            target === gl.GENERATE_MIPMAP_HINT ||
            (
                this._extensions.oes_standard_derivatives && target === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES
            )
        )) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        if (mode !== gl.FASTEST &&
            mode !== gl.NICEST &&
            mode !== gl.DONT_CARE) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        return this._native.hint(target, mode)
    }
    isBuffer(buffer: WebGLBuffer | null): GLboolean {
        // return this._native.isBuffer(buffer?._ || null);
        if (!this._isObject(buffer, 'isBuffer', WebGLBuffer)) return false
        return this._native.isBuffer(buffer?._ || null);
    }
    isContextLost(): boolean {
        return false;
    }
    isEnabled(cap: GLenum): GLboolean {
        return this._native.isEnabled(cap);
    }
    isFramebuffer(framebuffer: WebGLShader | null): GLboolean {
        if (!this._isObject(framebuffer, 'isFramebuffer', WebGLFramebuffer)) return false
        return this._native.isFramebuffer(framebuffer?._ || null)
    }
    isProgram(program: WebGLProgram | null): GLboolean {
        if (!this._isObject(program, 'isProgram', WebGLProgram)) return false
        return this._native.isProgram(program?._ || null)
    }
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): GLboolean {
        if (!this._isObject(renderbuffer, 'isRenderbuffer', WebGLRenderbuffer)) return false
        return this._native.isRenderbuffer(renderbuffer?._ || null);
    }
    isShader(shader: WebGLShader | null): GLboolean {
        if (!this._isObject(shader, 'isShader', WebGLShader)) return false
        return this._native.isShader(shader?._ || null);
    }
    isTexture(texture: WebGLTexture | null): GLboolean {
        if (!this._isObject(texture, 'isTexture', WebGLTexture)) return false
        return this._native.isTexture(texture?._ || null);
    }
    lineWidth(width: GLfloat): void {
        if (isNaN(width)) {
            this.setError(gl.INVALID_VALUE)
            return
        }
        return this._native.lineWidth(+width);
    }
    linkProgram(program: WebGLProgram): void {
        // return this._native.linkProgram(program._);
        if (!checkObject(program)) {
            throw new TypeError('linkProgram(WebGLProgram)')
        }
        if (this._checkWrapper(program, WebGLProgram)) {
            program._linkCount += 1
            program._attributes = []
            const prevError = this.getError()
            this._native.linkProgram(program._ | 0)
            const error = this.getError()
            if (error === gl.NO_ERROR) {
                program._linkStatus = this._fixupLink(program)
            }
            this.getError()
            this.setError(prevError || error)
        }
    }
    /** The `WebGLRenderingContext.pixelStorei()` method of the WebGL API specifies the pixel storage modes. */
    pixelStorei(pname: GLenum = 0, param: GLint | GLboolean = 0): void {
        if (typeof param === 'boolean') {
            param = param === false ? 0 : 1;
        }
        // return this._native.pixelStorei(pname, param);
        if (pname === gl.UNPACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._unpackAlignment = param
            } else {
                this.setError(gl.INVALID_VALUE)
                return
            }
        } else if (pname === gl.PACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._packAlignment = param
            } else {
                this.setError(gl.INVALID_VALUE)
                return
            }
        } else if (pname === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
            if (!(param === gl.NONE || param === gl.BROWSER_DEFAULT_WEBGL)) {
                this.setError(gl.INVALID_VALUE)
                return
            }
        }
        return this._native.pixelStorei(pname, param)
    }
    polygonOffset(factor: GLfloat, units: GLfloat): void {
        return this._native.polygonOffset(+factor, +units);
    }
    renderbufferStorage(target: GLenum = 0, internalFormat: GLenum = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        // return this._native.renderbufferStorage(target, internalFormat, width, height);
        if (target !== gl.RENDERBUFFER) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        const renderbuffer = this._activeRenderbuffer
        if (!renderbuffer) {
            this.setError(gl.INVALID_OPERATION)
            return
        }

        if (internalFormat !== gl.RGBA4 &&
            internalFormat !== gl.RGB565 &&
            internalFormat !== gl.RGB5_A1 &&
            internalFormat !== gl.DEPTH_COMPONENT16 &&
            internalFormat !== gl.STENCIL_INDEX &&
            internalFormat !== gl.STENCIL_INDEX8 &&
            internalFormat !== gl.DEPTH_STENCIL) {
            this.setError(gl.INVALID_ENUM)
            return
        }

        this._saveError()
        this._native.renderbufferStorage(
            target,
            internalFormat,
            width,
            height)
        const error = this.getError()
        this._restoreError(error)
        if (error !== gl.NO_ERROR) {
            return
        }

        renderbuffer._width = width
        renderbuffer._height = height
        renderbuffer._format = internalFormat

        const activeFramebuffer = this._activeFramebuffer
        if (activeFramebuffer) {
            let needsUpdate = false
            const attachments = this._getAttachments()
            for (let i = 0; i < attachments.length; ++i) {
                if (activeFramebuffer._attachments[attachments[i]] === renderbuffer) {
                    needsUpdate = true
                    break
                }
            }
            if (needsUpdate) {
                this._updateFramebufferAttachments(this._activeFramebuffer)
            }
        }
    }

    resize(width = 0, height = 0) {
        width = width | 0
        height = height | 0
        if (!(width > 0 && height > 0)) {
            throw new Error('Invalid surface dimensions')
        } else if (width !== this.drawingBufferWidth ||
            height !== this.drawingBufferHeight) {
            this._resizeDrawingBuffer(width, height)
            this.drawingBufferWidth = width
            this.drawingBufferHeight = height
        }
    }

    sampleCoverage(value: GLclampf, invert: GLboolean): void {
        return this._native.sampleCoverage(+value, !!invert);
    }
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return this._native.scissor(x | 0, y | 0, width | 0, height | 0);
    }
    shaderSource(shader: WebGLShader, source: string): void {
        // return this._native.shaderSource(shader._, source);
        if (!checkObject(shader)) {
            throw new TypeError('shaderSource(WebGLShader, String)')
        }
        if (!shader || (!source && typeof source !== 'string')) {
            this.setError(gl.INVALID_VALUE)
            return
        }
        source += ''
        if (!isValidString(source)) {
            this.setError(gl.INVALID_VALUE)
        } else if (this._checkWrapper(shader, WebGLShader)) {
            this._native.shaderSource(shader._ | 0, this._wrapShader(shader._type, source))
            shader._source = source
        }
    }
    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        this._checkStencil = true
        return this._native.stencilFunc(func | 0, ref | 0, mask | 0);
    }
    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void {
        this._checkStencil = true
        return this._native.stencilFuncSeparate(face | 0, func | 0, ref | 0, mask | 0);
    }
    stencilMask(mask: GLuint): void {
        this._checkStencil = true
        return this._native.stencilMask(mask | 0);
    }
    stencilMaskSeparate(face: GLenum, mask: GLuint): void {
        this._checkStencil = true
        return this._native.stencilMaskSeparate(face | 0, mask | 0);
    }
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        this._checkStencil = true
        return this._native.stencilOp(fail | 0, zfail | 0, zpass | 0);
    }
    stencilOpSeparate(face: GLenum, fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        this._checkStencil = true
        return this._native.stencilOpSeparate(face | 0, fail | 0, zfail | 0, zpass | 0);
    }
    texParameterf(target: GLenum = 0, pname: GLenum = 0, param: GLfloat): void {
        param = +param;
        // return this._native.texParameterf(target, pname, param);
        if (this._checkTextureTarget(target)) {
            this._verifyTextureCompleteness(target, pname, param)
            switch (pname) {
                case gl.TEXTURE_MIN_FILTER:
                case gl.TEXTURE_MAG_FILTER:
                case gl.TEXTURE_WRAP_S:
                case gl.TEXTURE_WRAP_T:
                    return this._native.texParameterf(target, pname, param)
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                return this._native.texParameterf(target, pname, param)
            }

            this.setError(gl.INVALID_ENUM)
        }
    }
    texParameteri(target: GLenum = 0, pname: GLenum = 0, param: GLint = 0): void {
        // return this._native.texParameteri(target, pname, param);
        if (this._checkTextureTarget(target)) {
            this._verifyTextureCompleteness(target, pname, param)
            switch (pname) {
                case gl.TEXTURE_MIN_FILTER:
                case gl.TEXTURE_MAG_FILTER:
                case gl.TEXTURE_WRAP_S:
                case gl.TEXTURE_WRAP_T:
                    return this._native.texParameteri(target, pname, param)
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                return this._native.texParameteri(target, pname, param)
            }

            this.setError(gl.INVALID_ENUM)
        }
    }
    uniform1f(location: WebGLUniformLocation | null, x: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform1f', 1, 'f')) return
        return this._native.uniform1f(location?._ || 0, x);
    }
    uniform1i(location: WebGLUniformLocation | null, x: GLint): void {
        return this._native.uniform1i(location?._ || 0, x);
    }
    uniform2f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform2f', 2, 'f')) return
        return this._native.uniform2f(location?._ || 0, x, y);
    }
    uniform2i(location: WebGLUniformLocation | null, x: GLint, y: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform2i', 2, 'i')) return
        this._native.uniform2i(location?._ || 0, x, y);
    }
    uniform3f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform3f', 3, 'f')) return
        return this._native.uniform3f(location?._ || 0, x, y, z);
    }
    uniform3i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform3i', 3, 'i')) return
        return this._native.uniform3i(location?._ || 0, x, y, z);
    }
    uniform4f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        if (!this._checkUniformValid(location, x, 'uniform4f', 4, 'f')) return
        return this._native.uniform4f(location?._ || 0, x, y, z, w);
    }
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform4i', 4, 'i')) return
        return this._native.uniform4i(location?._ || 0, x, y, z, w);
    }
    useProgram(program: WebGLProgram | null): void {
        return this._native.useProgram(program?._ || null);
    }
    validateProgram(program: WebGLProgram): void {
        return this._native.validateProgram(program._);
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