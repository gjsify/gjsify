import * as bits from 'bit-twiddle';
import tokenize from 'glsl-tokenizer/string';
import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import { WebGLContextAttributes } from './webgl-context-attributes.js';
import { extractImageData, checkFormat, convertPixels, validCubeTarget, formatSize, isTypedArray, unpackTypedArray, flag, bindPublics, checkObject, float32ListToArray } from './utils.js';
import { gl } from './native-gl.js';
import { warnNotImplemented } from '@gjsify/utils';

import { getANGLEInstancedArrays } from './extensions/angle-instanced-arrays.js';
import { getOESElementIndexUint } from './extensions/oes-element-index-unit.js';
import { getOESStandardDerivatives } from './extensions/oes-standard-derivatives.js';
import { getOESTextureFloat } from './extensions/oes-texture-float.js';
import { getOESTextureFloatLinear } from './extensions/oes-texture-float-linear.js';
import { getSTACKGLDestroyContext } from './extensions/stackgl-destroy-context.js';
import { getSTACKGLResizeDrawingBuffer } from './extensions/stackgl-resize-drawing-buffer.js';
import { getWebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
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

import type { ExtensionFactory } from './types/index.js';

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
    webgl_draw_buffers: getWebGLDrawBuffers,
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

    // Vertex array attibures that are not in vertex array objects.
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

        // Vertex array attibures that are not in vertex array objects.
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

    _getParameterDirect(pname: GLenum) {
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

    _tryDetachFramebuffer(framebuffer: WebGLFramebuffer, renderbuffer: WebGLRenderbuffer) {
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

    _updateFramebufferAttachments(framebuffer: WebGLFramebuffer) {
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

        if (this._extensions.webgl_draw_buffers) { // eslint-disable-line
            const { webgl_draw_buffers } = this._extensions; // eslint-disable-line
            return attachment < (webgl_draw_buffers.COLOR_ATTACHMENT0_WEBGL + webgl_draw_buffers._maxDrawBuffers) // eslint-disable-line
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
        this._native.bufferData(
            gl.ARRAY_BUFFER,
            this._vertexGlobalState._attribs[0]._data,
            gl.STREAM_DRAW)
        this._native.enableVertexAttribArray(0)
        this._native.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0)
        this._native._vertexAttribDivisor(0, 1)
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
        this._native._vertexAttribDivisor(0, attrib._divisor)
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
    bufferData(target: GLenum, data: BufferSource | null, usage: GLenum): void;
    bufferData(target: GLenum, dataOrSize: GLsizeiptr | BufferSource | null, usage: GLenum): void {
        let size = 0;
        let data: BufferSource | null = null;
        if (typeof dataOrSize === 'number') {
            size = dataOrSize;
        } else if (dataOrSize && typeof dataOrSize === 'object') {
            data = dataOrSize;
        }

        if (!data) {
            return super.bufferDataSizeOnly(target, size, usage);
        }
    }
    bufferSubData(target: GLenum, offset: GLintptr, data: BufferSource): void {
        target |= 0
        offset |= 0

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

        super.bufferSubData(target, offset, u8Data);
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
    texImage2D(target: GLenum, level: GLint, internalformat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
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
        super.texImage2D(
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
            if (needsUpdate) {
                this._updateFramebufferAttachments(this._activeFramebuffer)
            }
        }
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

    //////////// BASE ////////////

    activeTexture(texture: GLenum): void {
        return this._native.activeTexture(texture);
    }
    attachShader(program: WebGLProgram, shader: WebGLShader): void {
        return this._native.attachShader(program._, shader._);
    }
    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void {
        return this._native.bindAttribLocation(program._, index, name);
    }
    bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
        return this._native.bindBuffer(target, buffer?._ || null);
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
                this._drawingBuffer._framebuffer)
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
        return this._native.bindRenderbuffer(target, renderbuffer?._ || null);
    }
    bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        return this._native.bindTexture(target, texture?._ || null);
    }
    blendColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return this._native.blendColor(red, green, blue, alpha);
    }
    blendEquation(mode: GLenum): void {
        return this._native.blendEquation(mode);
    }
    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void {
        return this._native.blendEquationSeparate(modeRGB, modeAlpha);
    }
    blendFunc(sfactor: GLenum, dfactor: GLenum): void {
        return this._native.blendFunc(sfactor, dfactor);
    }
    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void {
        return this._native.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
    }
    checkFramebufferStatus(target: GLenum): GLenum {
        return this._native.checkFramebufferStatus(target);
    }
    clear(mask: GLbitfield): void {
        return this._native.clear(mask);
    }
    clearColor(red: GLclampf, green: GLclampf, blue: GLclampf, alpha: GLclampf): void {
        return this._native.clearColor(red, green, blue, alpha);
    }
    clearDepth(depth: GLclampf): void {
        return this._native.clearDepth(depth);
    }
    clearStencil(s: GLint): void {
        return this._native.clearStencil(s);
    }
    colorMask(red: GLboolean, green: GLboolean, blue: GLboolean, alpha: GLboolean): void {
        return this._native.colorMask(red, green, blue, alpha);
    }
    compileShader(shader: WebGLShader): void {
        return this._native.compileShader(shader._);
    }
    copyTexImage2D(target: GLenum, level: GLint, internalformat: GLenum, x: GLint, y: GLint, width: GLsizei, height: GLsizei, border: GLint): void {
        return this._native.copyTexImage2D(target, level, internalformat, x, y, width, height, border);
    }
    copyTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return this._native.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    }
    createBuffer(): WebGLBuffer | null {
        const id = this._native.createBuffer()
        if (!id || id <= 0) return null
        const webGLBuffer = new WebGLBuffer(id, this)
        this._buffers[id] = webGLBuffer
        return webGLBuffer
    }
    createFramebuffer(): WebGLShader | null {
        return this._native.createFramebuffer() as WebGLShader | null;
    }
    createProgram(): WebGLProgram | null {
        return this._native.createProgram() as WebGLProgram | null;
    }
    createRenderbuffer(): WebGLRenderbuffer | null {
        return this._native.createRenderbuffer() as WebGLRenderbuffer | null;
    }
    createShader(type: GLenum): WebGLShader | null {
        return this._native.createShader(type);
    }
    createTexture(): WebGLTexture | null {
        return this._native.createTexture() as WebGLTexture | null;
    }
    cullFace(mode: GLenum): void {
        return this._native.cullFace(mode);
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
    deleteProgram(program: WebGLProgram | null): void {
        return this._native.deleteProgram(program?._ || null);
    }
    deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
        return this._native.deleteRenderbuffer(renderbuffer?._ || null);
    }
    deleteShader(shader: WebGLShader | null): void {
        return this._native.deleteShader(shader?._ || null);
    }
    deleteTexture(texture: WebGLTexture | null): void {
        return this._native.deleteTexture(texture?._ || null);
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
        return this._native.depthRange(zNear, zFar);
    }
    detachShader(program: WebGLProgram, shader: WebGLShader): void {
        return this._native.detachShader(program._, shader._);
    }
    disable(cap: GLenum): void {
        return this._native.disable(cap);
    }
    disableVertexAttribArray(index: GLuint): void {
        return this._native.disableVertexAttribArray(index);
    }
    drawArrays(mode: GLenum, first: GLint, count: GLsizei): void {
        return this._native.drawArrays(mode, first, count);
    }
    drawElements(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr): void {
        return this._native.drawElements(mode, count, type, offset);
    }
    enable(cap: GLenum): void {
        return this._native.enable(cap);
    }
    enableVertexAttribArray(index: GLuint): void {
        return this._native.enableVertexAttribArray(index);
    }
    finish(): void {
        return this._native.finish();
    }
    flush(): void {
        return this._native.flush();
    }
    framebufferRenderbuffer(target: GLenum, attachment: GLenum, renderbuffertarget: GLenum, renderbuffer: WebGLRenderbuffer | null): void {
        return this._native.framebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer?._ || null);
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
    frontFace(mode: GLenum): void {
        return this._native.frontFace(mode);
    }
    generateMipmap(target: GLenum): void {
        return this._native.generateMipmap(target);
    }
    getActiveAttrib(program: WebGLProgram, index: GLuint): WebGLActiveInfo | null {
        return this._native.getActiveAttrib(program._, index);
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
        return this._native.getAttachedShaders(program._) as WebGLShader[] | null;
    }
    getAttribLocation(program: WebGLProgram, name: string): GLint {
        return this._native.getAttribLocation(program._, name);
    }
    getBufferParameter(target: GLenum, pname: GLenum): any {
        return this._native.getBufferParameter(target, pname);
    }

    getError(): GLenum {
        return this._native.getError();
    }

    setError(error: GLenum) {
        this._native.setError(error);
    }

    getFramebufferAttachmentParameter(target: GLenum, attachment: GLenum, pname: GLenum): any {
        return this._native.getFramebufferAttachmentParameter(target, attachment, pname);
    }
    getParameter(pname: GLenum): any {
        return this._native.getParameterx(pname)?.deepUnpack() || null;
    }
    getProgramInfoLog(program: WebGLProgram): string | null {
        return this._native.getProgramInfoLog(program._);
    }
    getProgramParameter(program: WebGLProgram, pname: GLenum): any {
        return this._native.getProgramParameter(program._, pname);
    }
    getRenderbufferParameter(target: GLenum, pname: GLenum): any {
        return this._native.getProgramParameter(target, pname);
    }
    getShaderInfoLog(shader: WebGLShader): string | null {
        return this._native.getShaderInfoLog(shader._);
    }
    getShaderParameter(shader: WebGLShader, pname: GLenum): any {
        return this._native.getShaderParameter(shader._, pname);
    }
    getShaderPrecisionFormat(shadertype: GLenum, precisiontype: GLenum): WebGLShaderPrecisionFormat | null {
        return this._native.getShaderPrecisionFormat(shadertype, precisiontype);
    }
    getShaderSource(shader: WebGLShader): string | null {
        return this._native.getShaderSource(shader._);
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
    getTexParameter(target: GLenum, pname: GLenum): any {
        return this._native.getTexParameterx(target, pname)?.unpack();
    }
    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
        return this._native.getUniform(program._, location._);
    }
    getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
        return this._native.getUniformLocation(program._, name) as WebGLUniformLocation | null;
    }
    getVertexAttrib(index: GLuint, pname: GLenum): any {
        return this._native.getVertexAttrib(index, pname);
    }
    getVertexAttribOffset(index: GLuint, pname: GLenum): GLintptr {
        return this._native.getVertexAttribOffset(index, pname);
    }
    hint(target: GLenum, mode: GLenum): void {
        return this._native.hint(target, mode);
    }
    isBuffer(buffer: WebGLBuffer | null): GLboolean {
        return this._native.isBuffer(buffer?._ || null);
    }
    isContextLost(): boolean {
        return false;
    }
    isEnabled(cap: GLenum): GLboolean {
        return this._native.isEnabled(cap);
    }
    isFramebuffer(framebuffer: WebGLShader | null): GLboolean {
        return this._native.isFramebuffer(framebuffer?._ || null);
    }
    isProgram(program: WebGLProgram | null): GLboolean {
        return this._native.isProgram(program?._ || null);
    }
    isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): GLboolean {
        return this._native.isRenderbuffer(renderbuffer?._ || null);
    }
    isShader(shader: WebGLShader | null): GLboolean {
        return this._native.isShader(shader?._ || null);
    }
    isTexture(texture: WebGLTexture | null): GLboolean {
        return this._native.isTexture(texture?._ || null);
    }
    lineWidth(width: GLfloat): void {
        return this._native.lineWidth(width);
    }
    linkProgram(program: WebGLProgram): void {
        if (!program) return;
        return this._native.linkProgram(program._);
    }
    /** The `WebGLRenderingContext.pixelStorei()` method of the WebGL API specifies the pixel storage modes. */
    pixelStorei(pname: GLenum, param: GLint | GLboolean): void {
        if (typeof param === 'boolean') {
            param = param === false ? 0 : 1;
        }
        return this._native.pixelStorei(pname, param);
    }
    polygonOffset(factor: GLfloat, units: GLfloat): void {
        return this._native.polygonOffset(factor, units);
    }
    renderbufferStorage(target: GLenum, internalformat: GLenum, width: GLsizei, height: GLsizei): void {
        return this._native.renderbufferStorage(target, internalformat, width, height);
    }
    sampleCoverage(value: GLclampf, invert: GLboolean): void {
        return this._native.sampleCoverage(value, invert);
    }
    scissor(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return this._native.scissor(x, y, width, height);
    }
    shaderSource(shader: WebGLShader, source: string): void {
        return this._native.shaderSource(shader._, source);
    }
    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        return this._native.stencilFunc(func, ref, mask);
    }
    stencilFuncSeparate(face: GLenum, func: GLenum, ref: GLint, mask: GLuint): void {
        return this._native.stencilFuncSeparate(func, func, ref, mask);
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
    texParameterf(target: GLenum, pname: GLenum, param: GLfloat): void {
        return this._native.texParameterf(target, pname, param);
    }
    texParameteri(target: GLenum, pname: GLenum, param: GLint): void {
        return this._native.texParameteri(target, pname, param);
    }
    uniform1f(location: WebGLUniformLocation | null, x: GLfloat): void {
        return this._native.uniform1f(location?._ || null, x);
    }
    uniform1i(location: WebGLUniformLocation | null, x: GLint): void {
        return this._native.uniform1i(location?._ || null, x);
    }
    uniform2f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat): void {
        return this._native.uniform2f(location?._ || null, x, y);
    }
    uniform2i(location: WebGLUniformLocation | null, x: GLint, y: GLint): void {
        return this._native.uniform2i(location?._ || null, x, y);
    }
    uniform3f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return this._native.uniform3f(location?._ || null, x, y, z);
    }
    uniform3i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint): void {
        return this._native.uniform3i(location?._ || null, x, y, z);
    }
    uniform4f(location: WebGLUniformLocation | null, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return this._native.uniform4f(location?._ || null, x, y, z, w);
    }
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void {
        return this._native.uniform4i(location?._ || null, x, y, z, w);
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
        return this._native.vertexAttrib1fv(index, float32ListToArray(values));
    }
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void {
        return this._native.vertexAttrib2f(index, x, y);
    }
    vertexAttrib2fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib2fv(index, float32ListToArray(values));
    }
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void {
        return this._native.vertexAttrib3f(index, x, y, z);
    }
    vertexAttrib3fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib3fv(index, float32ListToArray(values));
    }
    vertexAttrib4f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        return this._native.vertexAttrib4f(index, x, y, z, w);
    }
    vertexAttrib4fv(index: GLuint, values: Float32List): void {
        return this._native.vertexAttrib4fv(index, float32ListToArray(values));
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