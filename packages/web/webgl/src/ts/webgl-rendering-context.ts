import * as bits from 'bit-twiddle';
import tokenize from 'glsl-tokenizer/string';
import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import GdkPixbuf from '@gjsify/types/GdkPixbuf-2.0';
import { WebGLContextAttributes } from './webgl-context-attributes.js';
import { GjsifyHTMLCanvasElement } from './html-canvas-element';
import {
    extractImageData,
    checkObject,
    checkFormat,
    checkUniform,
    convertPixels,
    validCubeTarget,
    formatSize,
    isTypedArray,
    arrayToUint8Array,
    flag,
    listToArray,
    isValidString,
    uniformTypeSize,
    vertexCount,
    typeSize,
    Uint8ArrayToVariant,
} from './utils.js';

// import { getANGLEInstancedArrays } from './extensions/angle-instanced-arrays.js';
import { getOESElementIndexUint } from './extensions/oes-element-index-unit.js';
import { getOESStandardDerivatives } from './extensions/oes-standard-derivatives.js';
import { getOESTextureFloat } from './extensions/oes-texture-float.js';
import { getOESTextureFloatLinear } from './extensions/oes-texture-float-linear.js';
import { getSTACKGLDestroyContext } from './extensions/stackgl-destroy-context.js';
import { getSTACKGLResizeDrawingBuffer } from './extensions/stackgl-resize-drawing-buffer.js';
// import { getWebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
import { getEXTBlendMinMax } from './extensions/ext-blend-minmax.js';
import { getEXTTextureFilterAnisotropic } from './extensions/ext-texture-filter-anisotropic.js';
// import { getOESVertexArrayObject } from './extensions/oes-vertex-array-object.js';

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

import type { ExtensionFactory, TypedArray, WebGLConstants } from './types/index.js';
import { warnNotImplemented } from '@gjsify/utils';

const VERSION = '0.0.1';

let CONTEXT_COUNTER = 0;

// These are defined by the WebGL spec
const MAX_UNIFORM_LENGTH = 256
const MAX_ATTRIBUTE_LENGTH = 256

const availableExtensions: Record<string, ExtensionFactory> = {
    // angle_instanced_arrays: getANGLEInstancedArrays,
    oes_element_index_uint: getOESElementIndexUint,
    oes_texture_float: getOESTextureFloat,
    oes_texture_float_linear: getOESTextureFloatLinear,
    oes_standard_derivatives: getOESStandardDerivatives,
    // oes_vertex_array_object: getOESVertexArrayObject,
    stackgl_destroy_context: getSTACKGLDestroyContext,
    stackgl_resize_drawingbuffer: getSTACKGLResizeDrawingBuffer,
    // webgl_draw_buffers: getWebGLDrawBuffers,
    ext_blend_minmax: getEXTBlendMinMax,
    ext_texture_filter_anisotropic: getEXTTextureFilterAnisotropic
}

// const privateMethods = [
//     'resize',
//     'destroy'
// ]

// function wrapContext(ctx: GjsifyWebGLRenderingContext) {
//     const wrapper = new GjsifyWebGLRenderingContext()
//     bindPublics(Object.keys(ctx) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
//     bindPublics(Object.keys(ctx.constructor.prototype) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
//     bindPublics(Object.getOwnPropertyNames(ctx) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)
//     bindPublics(Object.getOwnPropertyNames(ctx.constructor.prototype) as Array<keyof GjsifyWebGLRenderingContext>, wrapper, ctx, privateMethods)

//     Object.defineProperties(wrapper, {
//         drawingBufferWidth: {
//             get() { return ctx.drawingBufferWidth },
//             set(value) { ctx.drawingBufferWidth = value }
//         },
//         drawingBufferHeight: {
//             get() { return ctx.drawingBufferHeight },
//             set(value) { ctx.drawingBufferHeight = value }
//         }
//     })

//     return wrapper
// }

export interface GjsifyWebGLRenderingContext extends WebGLConstants { }

export class GjsifyWebGLRenderingContext implements WebGLRenderingContext {
    canvas: GjsifyHTMLCanvasElement & HTMLCanvasElement;

    get drawingBufferHeight() {
        return this.canvas.height || 0;
    }

    get drawingBufferWidth() {
        return this.canvas.width || 0;
    }

    DEFAULT_ATTACHMENTS: number[] = [];

    DEFAULT_COLOR_ATTACHMENTS: number[] = [];

    /** context counter */
    _ = 0;

    _native: Gwebgl.WebGLRenderingContext;

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

    constructor(canvas: GjsifyHTMLCanvasElement | HTMLCanvasElement | null, options: Gwebgl.WebGLRenderingContext.ConstructorProperties = {},) {
        this._native = new Gwebgl.WebGLRenderingContext(options);
        this._initGLConstants();

        this.DEFAULT_ATTACHMENTS = [
            this.COLOR_ATTACHMENT0,
            this.DEPTH_ATTACHMENT,
            this.STENCIL_ATTACHMENT,
            this.DEPTH_STENCIL_ATTACHMENT
        ]

        this.DEFAULT_COLOR_ATTACHMENTS = [this.COLOR_ATTACHMENT0]

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

        // const glArea = this.canvas._getGlArea();
        // if(glArea) {
        //     glArea.connect('realize', () => {
        //         glArea.set_use_es(true);
        //         glArea.set_has_depth_buffer(this._contextAttributes.depth || false);
        //         glArea.set_has_stencil_buffer(this._contextAttributes.stencil || false);
        //         glArea.make_current();
        //         // glArea.set_required_version(3, 2);
        //         return true;
        //     })
        // }

        const width = this.drawingBufferWidth || options.width || 0;
        const height = this.drawingBufferHeight || options.height || 0;

        // Can only use premultipliedAlpha if alpha is set
        this._contextAttributes.premultipliedAlpha = this._contextAttributes.premultipliedAlpha && this._contextAttributes.alpha;

        this._ = CONTEXT_COUNTER++;

        // Initialize texture units
        const numTextures = this.getParameter(this.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
        this._textureUnits = new Array(numTextures)
        for (let i = 0; i < numTextures; ++i) {
            this._textureUnits[i] = new WebGLTextureUnit(this, i)
        }

        this.activeTexture(this.TEXTURE0)


        // Vertex array attributes that are in vertex array objects.
        this._defaultVertexObjectState = new WebGLVertexArrayObjectState(this)
        this._vertexObjectState = this._defaultVertexObjectState

        // Vertex array attributes that are not in vertex array objects.
        this._vertexGlobalState = new WebGLVertexArrayGlobalState(this)

        // Store limits
        this._maxTextureSize = this.getParameter(this.MAX_TEXTURE_SIZE)
        this._maxTextureLevel = bits.log2(bits.nextPow2(this._maxTextureSize))
        this._maxCubeMapSize = this.getParameter(this.MAX_CUBE_MAP_TEXTURE_SIZE)
        this._maxCubeMapLevel = bits.log2(bits.nextPow2(this._maxCubeMapSize))

        // Unpack alignment
        this._unpackAlignment = 4
        this._packAlignment = 4

        // Allocate framebuffer
        // TODO?
        // this._allocateDrawingBuffer(width, height)

        const attrib0Buffer = this.createBuffer()
        this._attrib0Buffer = attrib0Buffer

        // Initialize defaults
        this.bindBuffer(this.ARRAY_BUFFER, null)
        this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null)
        this.bindFramebuffer(this.FRAMEBUFFER, null)
        this.bindRenderbuffer(this.RENDERBUFFER, null)

        // Set viewport and scissor
        this.viewport(0, 0, width, height)
        this.scissor(0, 0, width, height)

        // Clear buffers
        this.clearDepth(1)
        this.clearColor(0, 0, 0, 0)
        this.clearStencil(0)
        this.clear(this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT | this.STENCIL_BUFFER_BIT)

        // return wrapContext(this)
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

    // extWEBGL_draw_buffers() {
    //     return this._native.extWEBGL_draw_buffers().deepUnpack<Record<string, number>>();
    // }

    _checkDimensions(target: GLenum, width: GLsizei, height: GLsizei, level: number) {
        if (level < 0 ||
            width < 0 ||
            height < 0) {
            this.setError(this.INVALID_VALUE)
            return false
        }
        if (target === this.TEXTURE_2D) {
            if (width > this._maxTextureSize ||
                height > this._maxTextureSize ||
                level > this._maxTextureLevel) {
                this.setError(this.INVALID_VALUE)
                return false
            }
        } else if (this._validCubeTarget(target)) {
            if (width > this._maxCubeMapSize ||
                height > this._maxCubeMapSize ||
                level > this._maxCubeMapLevel) {
                this.setError(this.INVALID_VALUE)
                return false
            }
        } else {
            this.setError(this.INVALID_ENUM)
            return false
        }
        return true
    }

    _checkLocation(location: WebGLUniformLocation | null) {
        if (!(location instanceof WebGLUniformLocation)) {
            this.setError(this.INVALID_VALUE)
            return false
        } else if (location._program._ctx !== this ||
            location._linkCount !== location._program._linkCount) {
            this.setError(this.INVALID_OPERATION)
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
            this.setError(this.INVALID_OPERATION)
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
        if (this.getParameter(this.STENCIL_WRITEMASK) !==
            this.getParameter(this.STENCIL_BACK_WRITEMASK) ||
            this.getParameter(this.STENCIL_VALUE_MASK) !==
            this.getParameter(this.STENCIL_BACK_VALUE_MASK) ||
            this.getParameter(this.STENCIL_REF) !==
            this.getParameter(this.STENCIL_BACK_REF)) {
            this.setError(this.INVALID_OPERATION)
            this._stencilState = false
        }
        return this._stencilState
    }

    _checkTextureTarget(target: GLenum) {
        const unit = this._getActiveTextureUnit()
        let tex = null
        if (target === this.TEXTURE_2D) {
            tex = unit._bind2D
        } else if (target === this.TEXTURE_CUBE_MAP) {
            tex = unit._bindCube
        } else {
            this.setError(this.INVALID_ENUM)
            return false
        }
        if (!tex) {
            this.setError(this.INVALID_OPERATION)
            return false
        }
        return true
    }

    _checkWrapper(object: any, Wrapper: any) {
        if (!this._checkValid(object, Wrapper)) {
            this.setError(this.INVALID_VALUE)
            return false
        } else if (!this._checkOwns(object)) {
            this.setError(this.INVALID_OPERATION)
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
            this.setError(this.INVALID_OPERATION)
            return false
        }
        const attribs = this._vertexObjectState._attribs
        for (let i = 0; i < attribs.length; ++i) {
            const attrib = attribs[i]
            if (attrib._isPointer) {
                const buffer = attrib._pointerBuffer
                if (!buffer) {
                    this.setError(this.INVALID_OPERATION)
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
                        this.setError(this.INVALID_OPERATION)
                        return false
                    }
                }
            }
        }
        return true
    }

    _checkVertexIndex(index: number) {
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE)
            return false
        }
        return true
    }

    _computePixelSize(type: GLenum, internalFormat: GLenum) {
        const pixelSize = formatSize(this, internalFormat)
        if (pixelSize === 0) {
            this.setError(this.INVALID_ENUM)
            return 0
        }
        switch (type) {
            case this.UNSIGNED_BYTE:
                return pixelSize
            case this.UNSIGNED_SHORT_5_6_5:
                if (internalFormat !== this.RGB) {
                    this.setError(this.INVALID_OPERATION)
                    break
                }
                return 2
            case this.UNSIGNED_SHORT_4_4_4_4:
            case this.UNSIGNED_SHORT_5_5_5_1:
                if (internalFormat !== this.RGBA) {
                    this.setError(this.INVALID_OPERATION)
                    break
                }
                return 2
            case this.FLOAT:
                return 1
        }
        this.setError(this.INVALID_ENUM)
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
        if (!this._native.getProgramParameter(program._, this.LINK_STATUS)) {
            program._linkInfoLog = this._native.getProgramInfoLog(program._)
            return false
        }

        // Record attribute attributeLocations
        const numAttribs = this.getProgramParameter(program, this.ACTIVE_ATTRIBUTES)
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

        const numUniforms = this.getProgramParameter(program, this.ACTIVE_UNIFORMS)
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
            this._preCheckFramebufferStatus(framebuffer) !== this.FRAMEBUFFER_COMPLETE) {
            this.setError(this.INVALID_FRAMEBUFFER_OPERATION)
            return false
        }
        return true
    }

    _getActiveBuffer(target: GLenum) {
        if (target === this.ARRAY_BUFFER) {
            return this._vertexGlobalState._arrayBufferBinding
        } else if (target === this.ELEMENT_ARRAY_BUFFER) {
            return this._vertexObjectState._elementArrayBufferBinding
        }
        return null
    }

    _getActiveTextureUnit() {
        return this._textureUnits[this._activeTextureUnit]
    }

    _getActiveTexture(target: GLenum) {
        const activeUnit = this._getActiveTextureUnit()
        if (target === this.TEXTURE_2D) {
            return activeUnit._bind2D
        } else if (target === this.TEXTURE_CUBE_MAP) {
            return activeUnit._bindCube
        }
        return null
    }

    _getAttachments() {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_ATTACHMENTS : this.DEFAULT_ATTACHMENTS
    }

    _getColorAttachments() {
        return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_COLOR_ATTACHMENTS : this.DEFAULT_COLOR_ATTACHMENTS
    }

    _getParameterDirect(pname: GLenum): any {
        return this._native.getParameterx(pname)?.deepUnpack();
    }

    _getTexImage(target: GLenum) {
        const unit = this._getActiveTextureUnit()
        if (target === this.TEXTURE_2D) {
            return unit._bind2D
        } else if (validCubeTarget(this, target)) {
            return unit._bindCube
        }
        this.setError(this.INVALID_ENUM)
        return null
    }

    _preCheckFramebufferStatus(framebuffer: WebGLFramebuffer) {
        const attachments = framebuffer._attachments
        const width = []
        const height = []
        const depthAttachment = attachments[this.DEPTH_ATTACHMENT]
        const depthStencilAttachment = attachments[this.DEPTH_STENCIL_ATTACHMENT]
        const stencilAttachment = attachments[this.STENCIL_ATTACHMENT]

        if ((depthStencilAttachment && (stencilAttachment || depthAttachment)) ||
            (stencilAttachment && depthAttachment)) {
            return this.FRAMEBUFFER_UNSUPPORTED
        }

        const colorAttachments = this._getColorAttachments()
        let colorAttachmentCount = 0
        for (const attachmentEnum in attachments) {
            if (attachments[attachmentEnum] && colorAttachments.indexOf(Number(attachmentEnum)) !== -1) {
                colorAttachmentCount++
            }
        }
        if (colorAttachmentCount === 0) {
            return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
        }

        if (depthStencilAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED
        } else if (depthStencilAttachment instanceof WebGLRenderbuffer) {
            if (depthStencilAttachment._format !== this.DEPTH_STENCIL) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(depthStencilAttachment._width)
            height.push(depthStencilAttachment._height)
        }

        if (depthAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED
        } else if (depthAttachment instanceof WebGLRenderbuffer) {
            if (depthAttachment._format !== this.DEPTH_COMPONENT16) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(depthAttachment._width)
            height.push(depthAttachment._height)
        }

        if (stencilAttachment instanceof WebGLTexture) {
            return this.FRAMEBUFFER_UNSUPPORTED
        } else if (stencilAttachment instanceof WebGLRenderbuffer) {
            if (stencilAttachment._format !== this.STENCIL_INDEX8) {
                return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            }
            width.push(stencilAttachment._width)
            height.push(stencilAttachment._height)
        }

        let colorAttached = false
        for (let i = 0; i < colorAttachments.length; ++i) {
            const colorAttachment = attachments[colorAttachments[i]]
            if (colorAttachment instanceof WebGLTexture) {
                if (colorAttachment._format !== this.RGBA ||
                    !(colorAttachment._type === this.UNSIGNED_BYTE || colorAttachment._type === this.FLOAT)) {
                    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
                }
                colorAttached = true
                const level = framebuffer._attachmentLevel[this.COLOR_ATTACHMENT0]
                if (level === null) throw new TypeError('level is null!');
                width.push(colorAttachment._levelWidth[level])
                height.push(colorAttachment._levelHeight[level])
            } else if (colorAttachment instanceof WebGLRenderbuffer) {
                const format = colorAttachment._format
                if (format !== this.RGBA4 &&
                    format !== this.RGB565 &&
                    format !== this.RGB5_A1) {
                    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
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
            return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
        }

        if (width.length <= 0 || height.length <= 0) {
            return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
        }

        for (let i = 1; i < width.length; ++i) {
            if (width[i - 1] !== width[i] ||
                height[i - 1] !== height[i]) {
                return this.FRAMEBUFFER_INCOMPLETE_DIMENSIONS
            }
        }

        if (width[0] === 0 || height[0] === 0) {
            return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
        }

        framebuffer._width = width[0]
        framebuffer._height = height[0]

        return this.FRAMEBUFFER_COMPLETE
    }

    _isConstantBlendFunc(factor: GLenum) {
        return (
            factor === this.CONSTANT_COLOR ||
            factor === this.ONE_MINUS_CONSTANT_COLOR ||
            factor === this.CONSTANT_ALPHA ||
            factor === this.ONE_MINUS_CONSTANT_ALPHA)
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
        const prevTexture = this._getActiveTexture(this.TEXTURE_2D)
        const prevRenderbuffer = this._activeRenderbuffer

        const contextAttributes = this._contextAttributes

        const drawingBuffer = this._drawingBuffer;
        if (drawingBuffer?._framebuffer) {
            this._native.bindFramebuffer(this.FRAMEBUFFER, drawingBuffer?._framebuffer)
        }
        const attachments = this._getAttachments()
        // Clear all attachments
        for (let i = 0; i < attachments.length; ++i) {
            this._native.framebufferTexture2D(
                this.FRAMEBUFFER,
                attachments[i],
                this.TEXTURE_2D,
                0,
                0)
        }

        // Update color attachment
        if (drawingBuffer?._color) {
            this._native.bindTexture(this.TEXTURE_2D, drawingBuffer?._color)
        }
        const colorFormat = contextAttributes.alpha ? this.RGBA : this.RGB
        this._native.texImage2D(
            this.TEXTURE_2D,
            0,
            colorFormat,
            width,
            height,
            0,
            colorFormat,
            this.UNSIGNED_BYTE,
            Uint8ArrayToVariant(null))
        this._native.texParameteri(this.TEXTURE_2D, this.TEXTURE_MIN_FILTER, this.NEAREST)
        this._native.texParameteri(this.TEXTURE_2D, this.TEXTURE_MAG_FILTER, this.NEAREST)
        if (drawingBuffer?._color) {
            this._native.framebufferTexture2D(
                this.FRAMEBUFFER,
                this.COLOR_ATTACHMENT0,
                this.TEXTURE_2D,
                drawingBuffer?._color,
                0)
        }


        // Update depth-stencil attachments if needed
        let storage = 0
        let attachment = 0
        if (contextAttributes.depth && contextAttributes.stencil) {
            storage = this.DEPTH_STENCIL
            attachment = this.DEPTH_STENCIL_ATTACHMENT
        } else if (contextAttributes.depth) {
            storage = 0x81A7
            attachment = this.DEPTH_ATTACHMENT
        } else if (contextAttributes.stencil) {
            storage = this.STENCIL_INDEX8
            attachment = this.STENCIL_ATTACHMENT
        }

        if (storage) {
            if (drawingBuffer?._depthStencil) {
                this._native.bindRenderbuffer(
                    this.RENDERBUFFER,
                    drawingBuffer?._depthStencil)
            }
            this._native.renderbufferStorage(
                this.RENDERBUFFER,
                storage,
                width,
                height)
            if (drawingBuffer?._depthStencil) {
                this._native.framebufferRenderbuffer(
                    this.FRAMEBUFFER,
                    attachment,
                    this.RENDERBUFFER,
                    drawingBuffer?._depthStencil)
            }
        }

        // Restore previous binding state
        this.bindFramebuffer(this.FRAMEBUFFER, prevFramebuffer)
        this.bindTexture(this.TEXTURE_2D, prevTexture)
        this.bindRenderbuffer(this.RENDERBUFFER, prevRenderbuffer)
    }

    _restoreError(lastError: GLenum) {
        const topError = this._errorStack.pop()
        if (topError === this.NO_ERROR) {
            this.setError(lastError)
        } else if (topError) {
            this.setError(topError)
        }
    }

    _saveError() {
        this._errorStack.push(this.getError())
    }

    _switchActiveProgram(active: WebGLProgram | null) {
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
                        this.FRAMEBUFFER,
                        attachments[i] | 0,
                        this.TEXTURE_2D,
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
        if (framebuffer._status !== this.FRAMEBUFFER_COMPLETE) {
            if (prevStatus === this.FRAMEBUFFER_COMPLETE) {
                for (let i = 0; i < attachments.length; ++i) {
                    const attachmentEnum = attachments[i]
                    this._native.framebufferTexture2D(
                        this.FRAMEBUFFER,
                        attachmentEnum,
                        framebuffer._attachmentFace[attachmentEnum] || 0,
                        0,
                        framebuffer._attachmentLevel[attachmentEnum] || 0)
                }
            }
            return
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i]
            this._native.framebufferTexture2D(
                this.FRAMEBUFFER,
                attachmentEnum,
                framebuffer._attachmentFace[attachmentEnum] || 0,
                0,
                framebuffer._attachmentLevel[attachmentEnum] || 0)
        }

        for (let i = 0; i < attachments.length; ++i) {
            const attachmentEnum = attachments[i]
            const attachment = framebuffer._attachments[attachmentEnum]
            if (attachment instanceof WebGLTexture) {
                this._native.framebufferTexture2D(
                    this.FRAMEBUFFER,
                    attachmentEnum,
                    framebuffer._attachmentFace[attachmentEnum] || 0,
                    attachment._ | 0,
                    framebuffer._attachmentLevel[attachmentEnum] || 0)
            } else if (attachment instanceof WebGLRenderbuffer) {
                this._native.framebufferRenderbuffer(
                    this.FRAMEBUFFER,
                    attachmentEnum,
                    this.RENDERBUFFER,
                    attachment._ | 0)
            }
        }
    }

    _validBlendFunc(factor: GLenum) {
        return factor === this.ZERO ||
            factor === this.ONE ||
            factor === this.SRC_COLOR ||
            factor === this.ONE_MINUS_SRC_COLOR ||
            factor === this.DST_COLOR ||
            factor === this.ONE_MINUS_DST_COLOR ||
            factor === this.SRC_ALPHA ||
            factor === this.ONE_MINUS_SRC_ALPHA ||
            factor === this.DST_ALPHA ||
            factor === this.ONE_MINUS_DST_ALPHA ||
            factor === this.SRC_ALPHA_SATURATE ||
            factor === this.CONSTANT_COLOR ||
            factor === this.ONE_MINUS_CONSTANT_COLOR ||
            factor === this.CONSTANT_ALPHA ||
            factor === this.ONE_MINUS_CONSTANT_ALPHA
    }

    _validBlendMode(mode: GLenum) {
        return mode === this.FUNC_ADD ||
            mode === this.FUNC_SUBTRACT ||
            mode === this.FUNC_REVERSE_SUBTRACT ||
            (this._extensions.ext_blend_minmax && (
                mode === this._extensions.ext_blend_minmax.MIN_EXT ||
                mode === this._extensions.ext_blend_minmax.MAX_EXT))
    }

    _validCubeTarget(target: GLenum) {
        return target === this.TEXTURE_CUBE_MAP_POSITIVE_X ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_X ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
            target === this.TEXTURE_CUBE_MAP_POSITIVE_Z ||
            target === this.TEXTURE_CUBE_MAP_NEGATIVE_Z
    }

    _validFramebufferAttachment(attachment: GLenum) {
        switch (attachment) {
            case this.DEPTH_ATTACHMENT:
            case this.STENCIL_ATTACHMENT:
            case this.DEPTH_STENCIL_ATTACHMENT:
            case this.COLOR_ATTACHMENT0:
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
        return target === this.TEXTURE_2D ||
            target === this.TEXTURE_CUBE_MAP
    }

    _verifyTextureCompleteness(target: GLenum, pname: GLenum, param: GLenum) {
        const unit = this._getActiveTextureUnit()
        let texture: WebGLTexture | null = null
        if (target === this.TEXTURE_2D) {
            texture = unit._bind2D
        } else if (this._validCubeTarget(target)) {
            texture = unit._bindCube
        }

        // oes_texture_float but not oes_texture_float_linear
        if (this._extensions.oes_texture_float && !this._extensions.oes_texture_float_linear && texture && texture._type === this.FLOAT && (pname === this.TEXTURE_MAG_FILTER || pname === this.TEXTURE_MIN_FILTER) && (param === this.LINEAR || param === this.LINEAR_MIPMAP_NEAREST || param === this.NEAREST_MIPMAP_LINEAR || param === this.LINEAR_MIPMAP_LINEAR)) {
            texture._complete = false
            this.bindTexture(target, texture)
            return
        }

        if (texture && texture._complete === false) {
            texture._complete = true
            this.bindTexture(target, texture)
        }
    }

    _wrapShader(_type: GLenum, source: string) {
        // the gl implementation seems to define `GL_OES_standard_derivatives` even when the extension is disabled
        // this behaviour causes one conformance test ('GL_OES_standard_derivatives defined in shaders when extension is disabled') to fail
        // by `undef`ing `GL_OES_standard_derivatives`, this appears to solve the issue
        if (!this._extensions.oes_standard_derivatives && /#ifdef\s+GL_OES_standard_derivatives/.test(source)) {
            source = '#undef GL_OES_standard_derivatives\n' + source
        }

        source = this._extensions.webgl_draw_buffers ? source : '#define gl_MaxDrawBuffers 1\n' + source

        if (this.canvas && !(source.startsWith('#version') || source.includes('\n#version'))) {
            const glArea = this.canvas._getGlArea();
            const es = glArea.get_use_es();
            let version = this._getGlslVersion(es);
            if (version) {
                version = '#version ' + version;
                if (!source.startsWith('\n')) {
                    version += '\n';
                }
                source = version + source;
            }
        }

        return source;

    }

    _beginAttrib0Hack() {
        this._native.bindBuffer(this.ARRAY_BUFFER, this._attrib0Buffer?._ || 0)
        const uInt8Data = new Uint8Array(this._vertexGlobalState._attribs[0]._data.buffer);
        this._native.bufferData(
            this.ARRAY_BUFFER,
            Uint8ArrayToVariant(uInt8Data),
            this.STREAM_DRAW)
        this._native.enableVertexAttribArray(0)
        this._native.vertexAttribPointer(0, 4, this.FLOAT, false, 0, 0)
        this._native._vertexAttribDivisor(0, 1)
    }

    _endAttrib0Hack() {
        const attrib = this._vertexObjectState._attribs[0]
        if (attrib._pointerBuffer) {
            this._native.bindBuffer(this.ARRAY_BUFFER, attrib._pointerBuffer._)
        } else {
            this._native.bindBuffer(this.ARRAY_BUFFER, 0)
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
            this._native.bindBuffer(this.ARRAY_BUFFER, this._vertexGlobalState._arrayBufferBinding._)
        } else {
            this._native.bindBuffer(this.ARRAY_BUFFER, 0)
        }
    }

    _allocateDrawingBuffer(width: number, height: number) {
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

        if (usage !== this.STREAM_DRAW &&
            usage !== this.STATIC_DRAW &&
            usage !== this.DYNAMIC_DRAW) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }

        const active = this._getActiveBuffer(target)
        if (!active) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (data) {
            let u8Data = null
            if (isTypedArray(data as TypedArray)) {
                u8Data = arrayToUint8Array(data as TypedArray)
            } else {
                this.setError(this.INVALID_VALUE)
                return
            }

            this._saveError();

            this._native.bufferData(
                target,
                Uint8ArrayToVariant(u8Data),
                usage)
            const error = this.getError()
            this._restoreError(error)
            if (error !== this.NO_ERROR) {
                return
            }

            active._size = u8Data.length
            if (target === this.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(u8Data)
            }
        } else if (typeof dataOrSize === 'number') {
            if (size < 0) {
                this.setError(this.INVALID_VALUE)
                return
            }

            this._saveError()
            this._native.bufferDataSizeOnly(
                target,
                size,
                usage)
            const error = this.getError()
            this._restoreError(error)
            if (error !== this.NO_ERROR) {
                return
            }

            active._size = size
            if (target === this.ELEMENT_ARRAY_BUFFER) {
                active._elements = new Uint8Array(size)
            }
        } else {
            this.setError(this.INVALID_VALUE)
        }
    }

    bufferSubData(target: GLenum = 0, offset: GLintptr = 0, data: BufferSource): void {
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (data === null) {
            return
        }

        if (!data || typeof data !== 'object') {
            this.setError(this.INVALID_VALUE)
            return
        }

        const active = this._getActiveBuffer(target)
        if (!active) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (offset < 0 || offset >= active._size) {
            this.setError(this.INVALID_VALUE)
            return
        }

        let u8Data = null
        if (isTypedArray(data as any)) {
            u8Data = arrayToUint8Array(data as any)
        } else {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (offset + u8Data.length > active._size) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (target === this.ELEMENT_ARRAY_BUFFER) {
            active._elements.set(u8Data, offset)
        }

        this._native.bufferSubData(target, offset, Uint8ArrayToVariant(u8Data));
    }

    compressedTexImage2D(target: GLenum, level: GLint, internalFormat: GLenum, width: GLsizei, height: GLsizei, border: GLint, data: TypedArray): void {
        return this._native.compressedTexImage2D(target, level, internalFormat, width, height, border, Uint8ArrayToVariant(arrayToUint8Array(data)));
    }

    compressedTexSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, width: GLsizei, height: GLsizei, format: GLenum, data: TypedArray): void {
        return this._native.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, Uint8ArrayToVariant(arrayToUint8Array(data)));
    }

    readPixels(x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, format: GLenum = 0, type: GLenum = 0, pixels: TypedArray | null): void {
        if (!pixels) return;
        // return this._native.readPixels(x, y, width, height, format, type, pixels);

        if (!(this._extensions.oes_texture_float && type === this.FLOAT && format === this.RGBA)) {
            if (format === this.RGB ||
                format === this.ALPHA ||
                type !== this.UNSIGNED_BYTE) {
                this.setError(this.INVALID_OPERATION)
                return
            } else if (format !== this.RGBA) {
                this.setError(this.INVALID_ENUM)
                return
            } else if (width < 0 || height < 0 || !(pixels instanceof Uint8Array)) {
                this.setError(this.INVALID_VALUE)
                return
            }
        }

        if (!this._framebufferOk()) {
            console.error("framebuffer is not okay!");
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
            this.setError(this.INVALID_VALUE)
            return
        }

        // Handle reading outside the window
        let viewWidth = this.drawingBufferWidth
        let viewHeight = this.drawingBufferHeight

        if (this._activeFramebuffer) {
            viewWidth = this._activeFramebuffer._width
            viewHeight = this._activeFramebuffer._height
        }

        const pixelData = arrayToUint8Array(pixels)

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
                    Uint8ArrayToVariant(subPixels))

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
                Uint8ArrayToVariant(pixelData))
        }
    }

    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, width: GLsizei, height: GLsizei, border: GLint, format: GLenum, type: GLenum, pixels: ArrayBufferView | null): void;
    texImage2D(target: GLenum, level: GLint, internalFormat: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/javascript/webgl-rendering-context.js#L3131
    texImage2D(target: GLenum = 0, level: GLint = 0, internalFormat: GLint = 0, formatOrWidth: GLenum | GLsizei = 0, typeOrHeight: GLenum | GLsizei = 0, sourceOrBorder: TexImageSource | GdkPixbuf.Pixbuf | GLint = 0, _format: GLenum = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {

        let width: number = 0;
        let height: number = 0;
        let format: number = 0;
        let source: TexImageSource;
        let pixbuf: GdkPixbuf.Pixbuf;
        let border: number = 0;

        if (arguments.length === 6) {
            type = typeOrHeight;
            format = formatOrWidth;

            if (sourceOrBorder instanceof GdkPixbuf.Pixbuf) {
                pixbuf = sourceOrBorder;

                width = pixbuf.get_width();
                height = pixbuf.get_height();;
                pixels = pixbuf.get_pixels();
            } else {
                source = sourceOrBorder as TexImageSource;
                const imageData = extractImageData(source);

                if (imageData == null) {
                    throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)')
                }

                width = imageData.width;
                height = imageData.height;
                pixels = imageData.data;
            }
        } else if (arguments.length === 9) {
            width = formatOrWidth;
            height = typeOrHeight;
            border = sourceOrBorder as GLint;
            format = _format as GLenum;
            type = type as GLenum;
            pixels = pixels as ArrayBufferView | null;
        }

        if (typeof pixels !== 'object' && pixels !== undefined) {
            throw new TypeError('texImage2D(GLenum, GLint, GLenum, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)')
        }

        if (!checkFormat(this, format) || !checkFormat(this, internalFormat)) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (type === this.FLOAT && !this._extensions.oes_texture_float) {
            this.setError(this.INVALID_ENUM)
            return
        }

        const texture = this._getTexImage(target)
        if (!texture || format !== internalFormat) {
            this.setError(this.INVALID_OPERATION)
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

        const data = convertPixels(pixels as ArrayBufferView)
        const rowStride = this._computeRowStride(width, pixelSize)
        const imageSize = rowStride * height

        if (data && data.length < imageSize) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (border !== 0 ||
            (validCubeTarget(this, target) && width !== height)) {
            this.setError(this.INVALID_VALUE)
            return
        }

        // Need to check for out of memory error
        this._saveError()

        this._native.texImage2D(target, level, internalFormat, width, height, border, format, type, Uint8ArrayToVariant(data))

        const error = this.getError()
        this._restoreError(error)
        if (error !== this.NO_ERROR) {
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
    texSubImage2D(target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, format: GLenum, type: GLenum, source: TexImageSource | GdkPixbuf.Pixbuf): void;
    texSubImage2D(target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, formatOrWidth: GLenum | GLsizei = 0, typeOrHeight: GLenum | GLsizei = 0, sourceOrFormat: TexImageSource | GdkPixbuf.Pixbuf | GLenum = 0, type: GLenum = 0, pixels?: ArrayBufferView | null): void {

        let width: number = 0;
        let height: number = 0;
        let format: number = 0;
        let source: TexImageSource;
        let pixbuf: GdkPixbuf.Pixbuf;

        if (arguments.length === 7) {
            type = typeOrHeight
            format = formatOrWidth

            if (sourceOrFormat instanceof GdkPixbuf.Pixbuf) {
                pixbuf = sourceOrFormat;

                width = pixbuf.get_width();
                height = pixbuf.get_height();;
                pixels = pixbuf.get_pixels();
            } else {
                source = sourceOrFormat as TexImageSource;
                const imageData = extractImageData(source)

                if (imageData == null) {
                    throw new TypeError('texSubImage2D(GLenum, GLint, GLint, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)')
                }

                width = imageData.width
                height = imageData.height
                pixels = imageData.data
            }


        } else {
            width = formatOrWidth;
            height = typeOrHeight;
            format = sourceOrFormat as GLenum;
        }

        if (typeof pixels !== 'object') {
            throw new TypeError('texSubImage2D(GLenum, GLint, GLint, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)')
        }

        const texture = this._getTexImage(target)
        if (!texture) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (type === this.FLOAT && !this._extensions.oes_texture_float) {
            this.setError(this.INVALID_ENUM)
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

        if (xoffset < 0 || yoffset < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        const data = convertPixels(pixels)
        const rowStride = this._computeRowStride(width, pixelSize)
        const imageSize = rowStride * height

        if (!data || data.length < imageSize) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        this._native.texSubImage2D(
            target,
            level,
            xoffset,
            yoffset,
            width,
            height,
            format,
            type,
            Uint8ArrayToVariant(data))
    }

    _checkUniformValid(location: WebGLUniformLocation | null, v0: GLfloat, name: string, count: number, type: string) {
        if (!checkObject(location)) {
            throw new TypeError(`${name}(WebGLUniformLocation, ...)`)
        } else if (!location) {
            return false
        } else if (this._checkLocationActive(location)) {
            const utype = location._activeInfo.type
            if (utype === this.SAMPLER_2D || utype === this.SAMPLER_CUBE) {
                if (count !== 1) {
                    this.setError(this.INVALID_VALUE)
                    return
                }
                if (type !== 'i') {
                    this.setError(this.INVALID_OPERATION)
                    return
                }
                if (v0 < 0 || v0 >= this._textureUnits.length) {
                    this.setError(this.INVALID_VALUE)
                    return false
                }
            }
            if (uniformTypeSize(this, utype) > count) {
                this.setError(this.INVALID_OPERATION)
                return false
            }
            return true
        }
        return false
    }

    _checkUniformValueValid(location: WebGLUniformLocation | null, value: Float32List | Int32List, name: string, count: number, _type: string) {
        if (!checkObject(location) ||
            !checkObject(value)) {
            throw new TypeError(`${name}v(WebGLUniformLocation, Array)`)
        } else if (!location) {
            return false
        } else if (!this._checkLocationActive(location)) {
            return false
        } else if (typeof value !== 'object' || !value || typeof value.length !== 'number') {
            throw new TypeError(`Second argument to ${name} must be array`)
        } else if (uniformTypeSize(this, location._activeInfo.type) > count) {
            this.setError(this.INVALID_OPERATION)
            return false
        } else if (value.length >= count && value.length % count === 0) {
            if (location._array) {
                return true
            } else if (value.length === count) {
                return true
            } else {
                this.setError(this.INVALID_OPERATION)
                return false
            }
        }
        this.setError(this.INVALID_VALUE)
        return false
    }

    uniform1fv(location: WebGLUniformLocation | null, value: Float32List | Int32List): void {
        if (!location || this._checkUniformValueValid(location, value, 'uniform1fv', 1, 'f')) return
        if (location?._array) {
            const locs = location._array
            for (let i = 0; i < locs.length && i < value.length; ++i) {
                const loc = locs[i]
                if (loc) {
                    this._native.uniform1f(loc, value[i])
                }
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
                if (loc) {
                    this._native.uniform1i(loc, v[i])
                }
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
                if (loc) {
                    this._native.uniform2f(loc, v[2 * i], v[(2 * i) + 1])
                }
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
                if (loc) {
                    this._native.uniform2i(loc, v[2 * i], v[2 * i + 1])
                }
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
                if (loc) {
                    this._native.uniform3f(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2])
                }
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
                if (loc) {
                    this._native.uniform3i(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2])
                }
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
                if (loc) {
                    this._native.uniform4f(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3])
                }
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
                if (loc) {
                    this._native.uniform4i(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3])
                }
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
            this.setError(this.INVALID_VALUE)
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
        this.setError(this.INVALID_VALUE)
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
        const texNum = texture - this.TEXTURE0
        if (texNum >= 0 && texNum < this._textureUnits.length) {
            this._activeTextureUnit = texNum
            return this._native.activeTexture(texture)
        }

        this.setError(this.INVALID_ENUM)
    }

    attachShader(program: WebGLProgram, shader: WebGLShader): void {
        // return this._native.attachShader(program._, shader._);
        if (!checkObject(program) ||
            !checkObject(shader)) {
            throw new TypeError('attachShader(WebGLProgram, WebGLShader)')
        }
        if (!program || !shader) {
            this.setError(this.INVALID_VALUE)
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
                if (error === this.NO_ERROR) {
                    program._link(shader)
                }
                return
            }
        }
        this.setError(this.INVALID_OPERATION)
    }

    bindAttribLocation(program: WebGLProgram, index: GLuint, name: string): void {
        // return this._native.bindAttribLocation(program._, index, name);
        if (!checkObject(program) ||
            typeof name !== 'string') {
            throw new TypeError('bindAttribLocation(WebGLProgram, GLint, String)')
        }
        name += ''
        if (!isValidString(name) || name.length > MAX_ATTRIBUTE_LENGTH) {
            this.setError(this.INVALID_VALUE)
        } else if (/^_?webgl_a/.test(name)) {
            this.setError(this.INVALID_OPERATION)
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
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (!buffer) {
            buffer = null
            this._native.bindBuffer(target, 0)
        } else if (buffer._pendingDelete) {
            return
        } else if (this._checkWrapper(buffer, WebGLBuffer)) {
            if (buffer._binding && buffer._binding !== target) {
                this.setError(this.INVALID_OPERATION)
                return
            }
            buffer._binding = target | 0

            this._native.bindBuffer(target, buffer._ | 0)
        } else {
            return
        }

        if (target === this.ARRAY_BUFFER) {
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
        if (target !== this.FRAMEBUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }
        if (!framebuffer) {
            if (this._drawingBuffer?._framebuffer) {
                this._native.bindFramebuffer(
                    this.FRAMEBUFFER,
                    this._drawingBuffer._framebuffer)
            }
        } else if (framebuffer._pendingDelete) {
            return
        } else if (this._checkWrapper(framebuffer, WebGLFramebuffer)) {
            this._native.bindFramebuffer(
                this.FRAMEBUFFER,
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

        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM)
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
            this.setError(this.INVALID_ENUM)
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
                this.setError(this.INVALID_OPERATION)
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

        if (error !== this.NO_ERROR) {
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

        if (target === this.TEXTURE_2D) {
            activeUnit._bind2D = texture
        } else if (target === this.TEXTURE_CUBE_MAP) {
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
        this.setError(this.INVALID_ENUM)
    }

    blendEquationSeparate(modeRGB: GLenum = 0, modeAlpha: GLenum = 0): void {
        if (this._validBlendMode(modeRGB) && this._validBlendMode(modeAlpha)) {
            return this._native.blendEquationSeparate(modeRGB, modeAlpha)
        }
        this.setError(this.INVALID_ENUM)
    }

    blendFunc(sfactor: GLenum = 0, dfactor: GLenum = 0): void {
        if (!this._validBlendFunc(sfactor) ||
            !this._validBlendFunc(dfactor)) {
            this.setError(this.INVALID_ENUM)
            return
        }
        if (this._isConstantBlendFunc(sfactor) && this._isConstantBlendFunc(dfactor)) {
            this.setError(this.INVALID_OPERATION)
            return
        }
        this._native.blendFunc(sfactor, dfactor)
    }

    blendFuncSeparate(srcRGB: GLenum = 0, dstRGB: GLenum = 0, srcAlpha: GLenum = 0, dstAlpha: GLenum = 0): void {
        if (!(this._validBlendFunc(srcRGB) &&
            this._validBlendFunc(dstRGB) &&
            this._validBlendFunc(srcAlpha) &&
            this._validBlendFunc(dstAlpha))) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if ((this._isConstantBlendFunc(srcRGB) && this._isConstantBlendFunc(dstRGB)) ||
            (this._isConstantBlendFunc(srcAlpha) && this._isConstantBlendFunc(dstAlpha))) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        this._native.blendFuncSeparate(
            srcRGB,
            dstRGB,
            srcAlpha,
            dstAlpha)
    }

    checkFramebufferStatus(target: GLenum): GLenum {
        if (target !== this.FRAMEBUFFER) {
            this.setError(this.INVALID_ENUM)
            return 0
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            return this.FRAMEBUFFER_COMPLETE
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
                this.COMPILE_STATUS)
            shader._compileInfo = this._native.getShaderInfoLog(shader._ | 0) || 'null'
            this.getError()
            this.setError(prevError || error)
        }
    }

    copyTexImage2D(target: GLenum = 0, level: GLint = 0, internalFormat: GLenum = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0, border: GLint = 0): void {
        const texture = this._getTexImage(target)
        if (!texture) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (internalFormat !== this.RGBA &&
            internalFormat !== this.RGB &&
            internalFormat !== this.ALPHA &&
            internalFormat !== this.LUMINANCE &&
            internalFormat !== this.LUMINANCE_ALPHA) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (level < 0 || width < 0 || height < 0 || border !== 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (level > 0 && !(bits.isPow2(width) && bits.isPow2(height))) {
            this.setError(this.INVALID_VALUE)
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

        if (error === this.NO_ERROR) {
            texture._levelWidth[level] = width
            texture._levelHeight[level] = height
            texture._format = this.RGBA
            texture._type = this.UNSIGNED_BYTE
        }
    }
    copyTexSubImage2D(target: GLenum = 0, level: GLint = 0, xoffset: GLint = 0, yoffset: GLint = 0, x: GLint = 0, y: GLint = 0, width: GLsizei = 0, height: GLsizei = 0): void {
        const texture = this._getTexImage(target)
        if (!texture) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (width < 0 || height < 0 || xoffset < 0 || yoffset < 0 || level < 0) {
            this.setError(this.INVALID_VALUE)
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
        if (type !== this.FRAGMENT_SHADER &&
            type !== this.VERTEX_SHADER) {
            this.setError(this.INVALID_ENUM)
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
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (this._vertexGlobalState._arrayBufferBinding === buffer) {
            this.bindBuffer(this.ARRAY_BUFFER, null)
        }
        if (this._vertexObjectState._elementArrayBufferBinding === buffer) {
            this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null)
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
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (this._activeFramebuffer === framebuffer) {
            this.bindFramebuffer(this.FRAMEBUFFER, null)
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
        this.setError(this.INVALID_OPERATION)
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
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (this._activeRenderbuffer === renderbuffer) {
            this.bindRenderbuffer(this.RENDERBUFFER, null)
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
                this.setError(this.INVALID_OPERATION)
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
                this.activeTexture(this.TEXTURE0 + i)
                this.bindTexture(this.TEXTURE_2D, null)
            } else if (unit._bindCube === texture) {
                this.activeTexture(this.TEXTURE0 + i)
                this.bindTexture(this.TEXTURE_CUBE_MAP, null)
            }
        }
        this.activeTexture(this.TEXTURE0 + curActive)

        // FIXME: Does the texture get unbound from *all* framebuffers, or just the
        // active FBO?
        const ctx = this
        const activeFramebuffer = this._activeFramebuffer
        const tryDetach = (framebuffer: WebGLFramebuffer | null) => {
            if (framebuffer && framebuffer._linked(texture)) {
                const attachments = ctx._getAttachments()
                for (let i = 0; i < attachments.length; ++i) {
                    const attachment = attachments[i]
                    if (framebuffer._attachments[attachment] === texture) {
                        ctx.framebufferTexture2D(
                            this.FRAMEBUFFER,
                            attachment,
                            this.TEXTURE_2D,
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
            case this.NEVER:
            case this.LESS:
            case this.EQUAL:
            case this.LEQUAL:
            case this.GREATER:
            case this.NOTEQUAL:
            case this.GEQUAL:
            case this.ALWAYS:
                return this._native.depthFunc(func)
            default:
                this.setError(this.INVALID_ENUM)
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
        this.setError(this.INVALID_OPERATION)
    }

    destroy() {
        warnNotImplemented('destroy');
        // this._native.destroy()
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
                this.setError(this.INVALID_OPERATION)
            }
        }
    }

    disable(cap: GLenum = 0): void {
        this._native.disable(cap);
        if (cap === this.TEXTURE_2D ||
            cap === this.TEXTURE_CUBE_MAP) {
            const active = this._getActiveTextureUnit()
            if (active._mode === cap) {
                active._mode = 0
            }
        }
    }

    disableVertexAttribArray(index: GLuint = 0): void {
        // return this._native.disableVertexAttribArray(index);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE)
            return
        }
        this._native.disableVertexAttribArray(index)
        this._vertexObjectState._attribs[index]._isPointer = false
    }

    drawArrays(mode: GLenum = 0, first: GLint = 0, count: GLsizei = 0): void {
        // return this._native.drawArrays(mode, first, count);

        if (first < 0 || count < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const reducedCount = vertexCount(this, mode, count)
        if (reducedCount < 0) {
            this.setError(this.INVALID_ENUM)
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
                // this._native.drawArrays(mode, first, reducedCount)
                // TODO: ?
                this._beginAttrib0Hack()
                this._native._drawArraysInstanced(mode, first, reducedCount, 1)
                this._endAttrib0Hack()
            }
        }
    }

    drawElements(mode: GLenum = 0, count: GLsizei = 0, type: GLenum = 0, ioffset: GLintptr = 0): void {
        // return this._native.drawElements(mode, count, type, offset);

        if (count < 0 || ioffset < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (!this._checkStencilState()) {
            return
        }

        const elementBuffer = this._vertexObjectState._elementArrayBufferBinding
        if (!elementBuffer) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        // Unpack element data
        let elementData = null
        let offset = ioffset
        if (type === this.UNSIGNED_SHORT) {
            if (offset % 2) {
                this.setError(this.INVALID_OPERATION)
                return
            }
            offset >>= 1
            elementData = new Uint16Array(elementBuffer._elements.buffer)
        } else if (this._extensions.oes_element_index_uint && type === this.UNSIGNED_INT) {
            if (offset % 4) {
                this.setError(this.INVALID_OPERATION)
                return
            }
            offset >>= 2
            elementData = new Uint32Array(elementBuffer._elements.buffer)
        } else if (type === this.UNSIGNED_BYTE) {
            elementData = elementBuffer._elements
        } else {
            this.setError(this.INVALID_ENUM)
            return
        }

        let reducedCount = count
        switch (mode) {
            case this.TRIANGLES:
                if (count % 3) {
                    reducedCount -= (count % 3)
                }
                break
            case this.LINES:
                if (count % 2) {
                    reducedCount -= (count % 2)
                }
                break
            case this.POINTS:
                break
            case this.LINE_LOOP:
            case this.LINE_STRIP:
                if (count < 2) {
                    this.setError(this.INVALID_OPERATION)
                    return
                }
                break
            case this.TRIANGLE_FAN:
            case this.TRIANGLE_STRIP:
                if (count < 3) {
                    this.setError(this.INVALID_OPERATION)
                    return
                }
                break
            default:
                this.setError(this.INVALID_ENUM)
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
            this.setError(this.INVALID_OPERATION)
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
                    // this._native.drawElements(mode, reducedCount, type, ioffset);
                    // TODO: ?
                    this._beginAttrib0Hack()
                    this._native._drawElementsInstanced(mode, reducedCount, type, ioffset, 1)
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
            this.setError(this.INVALID_VALUE)
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

        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment) ||
            renderbufferTarget !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION)
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
        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (level !== 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        // Check object ownership
        if (texture && !this._checkWrapper(texture, WebGLTexture)) {
            return
        }

        // Check texture target is ok
        if (textarget === this.TEXTURE_2D) {
            if (texture && texture._binding !== this.TEXTURE_2D) {
                this.setError(this.INVALID_OPERATION)
                return
            }
        } else if (this._validCubeTarget(textarget)) {
            if (texture && texture._binding !== this.TEXTURE_CUBE_MAP) {
                this.setError(this.INVALID_OPERATION)
                return
            }
        } else {
            this.setError(this.INVALID_ENUM)
            return
        }

        // Check a framebuffer is actually bound
        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION)
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
            this.setError(this.INVALID_VALUE)
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
            this.setError(this.INVALID_VALUE)
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
            this.setError(this.INVALID_VALUE)
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
            this.setError(this.INVALID_VALUE)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            return this._native.getAttribLocation(program._ | 0, name + '')
        }
        return -1
    }

    getBufferParameter(target: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getBufferParameter(target, pname);
        if (target !== this.ARRAY_BUFFER &&
            target !== this.ELEMENT_ARRAY_BUFFER) {
            this.setError(this.INVALID_ENUM)
            return null
        }

        switch (pname) {
            case this.BUFFER_SIZE:
            case this.BUFFER_USAGE:
                return this._native.getBufferParameteriv(target | 0, pname | 0)
            default:
                this.setError(this.INVALID_ENUM)
                return null
        }
    }

    getError(): GLenum {
        return this._native.getError();
    }

    setError(error: GLenum) {
        if(error > 0) {
            console.error("setError", error);
        }
        this._native.setError(error);
    }

    getFramebufferAttachmentParameter(target: GLenum = 0, attachment: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getFramebufferAttachmentParameter(target, attachment, pname);
        if (target !== this.FRAMEBUFFER ||
            !this._validFramebufferAttachment(attachment)) {
            this.setError(this.INVALID_ENUM)
            return null
        }

        const framebuffer = this._activeFramebuffer
        if (!framebuffer) {
            this.setError(this.INVALID_OPERATION)
            return null
        }

        const object = framebuffer._attachments[attachment]
        if (object === null) {
            if (pname === this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) {
                return this.NONE
            }
        } else if (object instanceof WebGLTexture) {
            switch (pname) {
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return this.TEXTURE
                case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:
                    return framebuffer._attachmentLevel[attachment]
                case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: {
                    const face = framebuffer._attachmentFace[attachment]
                    if (face === this.TEXTURE_2D) {
                        return 0
                    }
                    return face
                }
            }
        } else if (object instanceof WebGLRenderbuffer) {
            switch (pname) {
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
                    return object
                case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
                    return this.RENDERBUFFER
            }
        }

        this.setError(this.INVALID_ENUM)
        return null
    }

    getParameter(pname: GLenum = 0): any {
        // return this._native.getParameterx(pname)?.deepUnpack() || null;
        switch (pname) {
            case this.ARRAY_BUFFER_BINDING:
                return this._vertexGlobalState._arrayBufferBinding
            case this.ELEMENT_ARRAY_BUFFER_BINDING:
                return this._vertexObjectState._elementArrayBufferBinding
            case this.CURRENT_PROGRAM:
                return this._activeProgram
            case this.FRAMEBUFFER_BINDING:
                return this._activeFramebuffer
            case this.RENDERBUFFER_BINDING:
                return this._activeRenderbuffer
            case this.TEXTURE_BINDING_2D:
                return this._getActiveTextureUnit()._bind2D
            case this.TEXTURE_BINDING_CUBE_MAP:
                return this._getActiveTextureUnit()._bindCube
            case this.VERSION:
                return 'WebGL 1.0 Gjsify ' + VERSION
            case this.VENDOR:
                return 'Gjsify'
            case this.RENDERER:
                return 'ANGLE'
            case this.SHADING_LANGUAGE_VERSION:
                return 'WebGL GLSL ES 1.0 Gjsify'

            case this.COMPRESSED_TEXTURE_FORMATS:
                return new Uint32Array(0)

            // Int arrays
            case this.MAX_VIEWPORT_DIMS:
            case this.SCISSOR_BOX:
            case this.VIEWPORT:
                return new Int32Array(this._getParameterDirect(pname))

            // Float arrays
            case this.ALIASED_LINE_WIDTH_RANGE:
            case this.ALIASED_POINT_SIZE_RANGE:
            case this.DEPTH_RANGE:
            case this.BLEND_COLOR:
            case this.COLOR_CLEAR_VALUE:
                return new Float32Array(this._getParameterDirect(pname))

            case this.COLOR_WRITEMASK:
                // return this._getParameterDirect(pname);
                return this._native.getParameterbv(pname, 16)
            // return boolArray(this._native.getParameterbv(pname, 16));

            case this.DEPTH_CLEAR_VALUE:
            case this.LINE_WIDTH:
            case this.POLYGON_OFFSET_FACTOR:
            case this.POLYGON_OFFSET_UNITS:
            case this.SAMPLE_COVERAGE_VALUE:
                return +this._getParameterDirect(pname);

            case this.BLEND:
            case this.CULL_FACE:
            case this.DEPTH_TEST:
            case this.DEPTH_WRITEMASK:
            case this.DITHER:
            case this.POLYGON_OFFSET_FILL:
            case this.SAMPLE_COVERAGE_INVERT:
            case this.SCISSOR_TEST:
            case this.STENCIL_TEST:
            case this.UNPACK_FLIP_Y_WEBGL:
            case this.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
                return !!this._getParameterDirect(pname);

            case this.ACTIVE_TEXTURE:
            case this.ALPHA_BITS:
            case this.BLEND_DST_ALPHA:
            case this.BLEND_DST_RGB:
            case this.BLEND_EQUATION_ALPHA:
            case this.BLEND_EQUATION_RGB:
            case this.BLEND_SRC_ALPHA:
            case this.BLEND_SRC_RGB:
            case this.BLUE_BITS:
            case this.CULL_FACE_MODE:
            case this.DEPTH_BITS:
            case this.DEPTH_FUNC:
            case this.FRONT_FACE:
            case this.GENERATE_MIPMAP_HINT:
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
            case this.STENCIL_BACK_FAIL:
            case this.STENCIL_BACK_FUNC:
            case this.STENCIL_BACK_PASS_DEPTH_FAIL:
            case this.STENCIL_BACK_PASS_DEPTH_PASS:
            case this.STENCIL_BACK_REF:
            case this.STENCIL_BACK_VALUE_MASK:
            case this.STENCIL_BACK_WRITEMASK:
            case this.STENCIL_BITS:
            case this.STENCIL_CLEAR_VALUE:
            case this.STENCIL_FAIL:
            case this.STENCIL_FUNC:
            case this.STENCIL_PASS_DEPTH_FAIL:
            case this.STENCIL_PASS_DEPTH_PASS:
            case this.STENCIL_REF:
            case this.STENCIL_VALUE_MASK:
            case this.STENCIL_WRITEMASK:
            case this.SUBPIXEL_BITS:
            case this.UNPACK_ALIGNMENT:
            case this.UNPACK_COLORSPACE_CONVERSION_WEBGL:
                return this._getParameterDirect(pname) | 0;

            case this.IMPLEMENTATION_COLOR_READ_FORMAT:
            case this.IMPLEMENTATION_COLOR_READ_TYPE:
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
                            if (ext._buffersState.length === 1 && ext._buffersState[0] === this.BACK) {
                                return this.BACK
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

                this.setError(this.INVALID_ENUM)
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
                case this.DELETE_STATUS:
                    return program._pendingDelete

                case this.LINK_STATUS:
                    return program._linkStatus

                case this.VALIDATE_STATUS:
                    return !!this._native.getProgramParameter(program._, pname)

                case this.ATTACHED_SHADERS:
                case this.ACTIVE_ATTRIBUTES:
                case this.ACTIVE_UNIFORMS:
                    return this._native.getProgramParameter(program._, pname)
            }
            this.setError(this.INVALID_ENUM)
        }
        return null
    }

    getRenderbufferParameter(target: GLenum = 0, pname: GLenum = 0): any {
        // return this._native.getProgramParameter(target, pname);
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM)
            return null
        }
        const renderbuffer = this._activeRenderbuffer
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION)
            return null
        }
        switch (pname) {
            case this.RENDERBUFFER_INTERNAL_FORMAT:
                return renderbuffer._format
            case this.RENDERBUFFER_WIDTH:
                return renderbuffer._width
            case this.RENDERBUFFER_HEIGHT:
                return renderbuffer._height
            case this.MAX_RENDERBUFFER_SIZE: // TODO?
            case this.RENDERBUFFER_RED_SIZE:
            case this.RENDERBUFFER_GREEN_SIZE:
            case this.RENDERBUFFER_BLUE_SIZE:
            case this.RENDERBUFFER_ALPHA_SIZE:
            case this.RENDERBUFFER_DEPTH_SIZE:
            case this.RENDERBUFFER_STENCIL_SIZE:
                return this._native.getRenderbufferParameter(target, pname)
        }
        this.setError(this.INVALID_ENUM)
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
                case this.DELETE_STATUS:
                    return shader._pendingDelete
                case this.COMPILE_STATUS:
                    return shader._compileStatus
                case this.SHADER_TYPE:
                    return shader._type
            }
            this.setError(this.INVALID_ENUM)
        }
        return null
    }

    getShaderPrecisionFormat(shaderType: GLenum = 0, precisionType: GLenum = 0): WebGLShaderPrecisionFormat | null {
        // return this._native.getShaderPrecisionFormat(shaderType, precisionType);
        if (!(shaderType === this.FRAGMENT_SHADER ||
            shaderType === this.VERTEX_SHADER) ||
            !(precisionType === this.LOW_FLOAT ||
                precisionType === this.MEDIUM_FLOAT ||
                precisionType === this.HIGH_FLOAT ||
                precisionType === this.LOW_INT ||
                precisionType === this.MEDIUM_INT ||
                precisionType === this.HIGH_INT)) {
            this.setError(this.INVALID_ENUM)
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
        if ((target === this.TEXTURE_2D && !unit._bind2D) ||
            (target === this.TEXTURE_CUBE_MAP && !unit._bindCube)) {
            this.setError(this.INVALID_OPERATION)
            return null
        }

        switch (pname) {
            case this.TEXTURE_MAG_FILTER:
            case this.TEXTURE_MIN_FILTER:
            case this.TEXTURE_WRAP_S:
            case this.TEXTURE_WRAP_T:
                return this._getTexParameterDirect(target, pname)
        }

        if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
            return this._getTexParameterDirect(target, pname)
        }

        this.setError(this.INVALID_ENUM)
        return null
    }

    getUniform(program: WebGLProgram, location: WebGLUniformLocation): any {
        // return this._native.getUniform(program._, location._);
        if (!checkObject(program) ||
            !checkObject(location)) {
            throw new TypeError('getUniform(WebGLProgram, WebGLUniformLocation)')
        } else if (!program) {
            this.setError(this.INVALID_VALUE)
            return null
        } else if (!location) {
            return null
        } else if (this._checkWrapper(program, WebGLProgram)) {
            if (!checkUniform(program, location)) {
                this.setError(this.INVALID_OPERATION)
                return null
            }
            const data = this._native.getUniform(program._ | 0, location._ | 0)
            if (!data) {
                return null
            }
            switch (location._activeInfo.type) {
                case this.FLOAT:
                    return data[0]
                case this.FLOAT_VEC2:
                    return new Float32Array(data.slice(0, 2))
                case this.FLOAT_VEC3:
                    return new Float32Array(data.slice(0, 3))
                case this.FLOAT_VEC4:
                    return new Float32Array(data.slice(0, 4))
                case this.INT:
                    return data[0] | 0
                case this.INT_VEC2:
                    return new Int32Array(data.slice(0, 2))
                case this.INT_VEC3:
                    return new Int32Array(data.slice(0, 3))
                case this.INT_VEC4:
                    return new Int32Array(data.slice(0, 4))
                case this.BOOL:
                    return !!data[0]
                case this.BOOL_VEC2:
                    return [!!data[0], !!data[1]]
                case this.BOOL_VEC3:
                    return [!!data[0], !!data[1], !!data[2]]
                case this.BOOL_VEC4:
                    return [!!data[0], !!data[1], !!data[2], !!data[3]]
                case this.FLOAT_MAT2:
                    return new Float32Array(data.slice(0, 4))
                case this.FLOAT_MAT3:
                    return new Float32Array(data.slice(0, 9))
                case this.FLOAT_MAT4:
                    return new Float32Array(data.slice(0, 16))
                case this.SAMPLER_2D:
                case this.SAMPLER_CUBE:
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
            this.setError(this.INVALID_VALUE)
            return null
        }

        if (this._checkWrapper(program, WebGLProgram)) {
            const loc = this._native.getUniformLocation(program._ | 0, name);
            if (loc !== null && loc >= 0) {
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
                    for (let i = 0; this.getError() === this.NO_ERROR; ++i) {
                        const xloc = this._native.getUniformLocation(
                            program._ | 0,
                            baseName + '[' + i + ']')
                        if (this.getError() !== this.NO_ERROR || !xloc || xloc < 0) {
                            break
                        }
                        arrayLocs.push(xloc)
                    }
                    this._restoreError(this.NO_ERROR)

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
            this.setError(this.INVALID_VALUE)
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
            case this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
                return attrib._pointerBuffer
            case this.VERTEX_ATTRIB_ARRAY_ENABLED:
                return attrib._isPointer
            case this.VERTEX_ATTRIB_ARRAY_SIZE:
                return attrib._inputSize
            case this.VERTEX_ATTRIB_ARRAY_STRIDE:
                return attrib._inputStride
            case this.VERTEX_ATTRIB_ARRAY_TYPE:
                return attrib._pointerType
            case this.VERTEX_ATTRIB_ARRAY_NORMALIZED:
                return attrib._pointerNormal
            case this.CURRENT_VERTEX_ATTRIB:
                return new Float32Array(vertexAttribValue)
            default:
                this.setError(this.INVALID_ENUM)
                return null
        }
    }

    getVertexAttribOffset(index: GLuint = 0, pname: GLenum = 0): GLintptr {
        // return this._native.getVertexAttribOffset(index, pname);
        if (index < 0 || index >= this._vertexObjectState._attribs.length) {
            this.setError(this.INVALID_VALUE)
            return -1
        }
        if (pname === this.VERTEX_ATTRIB_ARRAY_POINTER) {
            return this._vertexObjectState._attribs[index]._pointerOffset
        } else {
            this.setError(this.INVALID_ENUM)
            return -1
        }
    }

    hint(target: GLenum = 0, mode: GLenum = 0): void {
        // return this._native.hint(target, mode);
        if (!(
            target === this.GENERATE_MIPMAP_HINT ||
            (
                this._extensions.oes_standard_derivatives && target === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES
            )
        )) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (mode !== this.FASTEST &&
            mode !== this.NICEST &&
            mode !== this.DONT_CARE) {
            this.setError(this.INVALID_ENUM)
            return
        }

        return this._native.hint(target, mode)
    }

    isBuffer(buffer: WebGLBuffer): GLboolean {
        // return this._native.isBuffer(buffer?._ || null);
        if (!this._isObject(buffer, 'isBuffer', WebGLBuffer)) return false
        return this._native.isBuffer(buffer?._);
    }

    isContextLost(): boolean {
        return false;
    }

    isEnabled(cap: GLenum = 0): GLboolean {
        return this._native.isEnabled(cap);
    }

    isFramebuffer(framebuffer: WebGLShader): GLboolean {
        if (!this._isObject(framebuffer, 'isFramebuffer', WebGLFramebuffer)) return false
        return this._native.isFramebuffer(framebuffer?._)
    }

    isProgram(program: WebGLProgram): GLboolean {
        if (!this._isObject(program, 'isProgram', WebGLProgram)) return false
        return this._native.isProgram(program?._)
    }

    isRenderbuffer(renderbuffer: WebGLRenderbuffer): GLboolean {
        if (!this._isObject(renderbuffer, 'isRenderbuffer', WebGLRenderbuffer)) return false
        return this._native.isRenderbuffer(renderbuffer?._);
    }

    isShader(shader: WebGLShader): GLboolean {
        if (!this._isObject(shader, 'isShader', WebGLShader)) return false
        return this._native.isShader(shader?._);
    }

    isTexture(texture: WebGLTexture): GLboolean {
        if (!this._isObject(texture, 'isTexture', WebGLTexture)) return false
        return this._native.isTexture(texture?._);
    }

    lineWidth(width: GLfloat): void {
        if (isNaN(width)) {
            this.setError(this.INVALID_VALUE)
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
            if (error === this.NO_ERROR) {
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
        if (pname === this.UNPACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._unpackAlignment = param
            } else {
                this.setError(this.INVALID_VALUE)
                return
            }
        } else if (pname === this.PACK_ALIGNMENT) {
            if (param === 1 ||
                param === 2 ||
                param === 4 ||
                param === 8) {
                this._packAlignment = param
            } else {
                this.setError(this.INVALID_VALUE)
                return
            }
        } else if (pname === this.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
            if (!(param === this.NONE || param === this.BROWSER_DEFAULT_WEBGL)) {
                this.setError(this.INVALID_VALUE)
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
        if (target !== this.RENDERBUFFER) {
            this.setError(this.INVALID_ENUM)
            return
        }

        const renderbuffer = this._activeRenderbuffer
        if (!renderbuffer) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        if (internalFormat !== this.RGBA4 &&
            internalFormat !== this.RGB565 &&
            internalFormat !== this.RGB5_A1 &&
            internalFormat !== this.DEPTH_COMPONENT16 &&
            internalFormat !== this.STENCIL_INDEX &&
            internalFormat !== this.STENCIL_INDEX8 &&
            internalFormat !== this.DEPTH_STENCIL) {
            this.setError(this.INVALID_ENUM)
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
        if (error !== this.NO_ERROR) {
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
            // this.drawingBufferWidth = width
            // this.drawingBufferHeight = height
            // warnNotImplemented('resize');
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
            this.setError(this.INVALID_VALUE)
            return
        }
        // source += ''

        if (!isValidString(source)) {
            this.setError(this.INVALID_VALUE)
        } else if (this._checkWrapper(shader, WebGLShader)) {
            source = this._wrapShader(shader._type, source);
            this._native.shaderSource(shader._ | 0, source)
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
                case this.TEXTURE_MIN_FILTER:
                case this.TEXTURE_MAG_FILTER:
                case this.TEXTURE_WRAP_S:
                case this.TEXTURE_WRAP_T:
                    return this._native.texParameterf(target, pname, param)
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                return this._native.texParameterf(target, pname, param)
            }

            this.setError(this.INVALID_ENUM)
        }
    }
    texParameteri(target: GLenum = 0, pname: GLenum = 0, param: GLint = 0): void {
        // return this._native.texParameteri(target, pname, param);
        if (this._checkTextureTarget(target)) {
            this._verifyTextureCompleteness(target, pname, param)
            switch (pname) {
                case this.TEXTURE_MIN_FILTER:
                case this.TEXTURE_MAG_FILTER:
                case this.TEXTURE_WRAP_S:
                case this.TEXTURE_WRAP_T:
                    return this._native.texParameteri(target, pname, param)
            }

            if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
                return this._native.texParameteri(target, pname, param)
            }

            this.setError(this.INVALID_ENUM)
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
        if (!this._checkUniformValid(location, x, 'uniform4f', 4, 'f')) {
            console.error("uniform4f is not valid!");
            return
        }
        return this._native.uniform4f(location?._ || 0, x, y, z, w);
    }
    uniform4i(location: WebGLUniformLocation | null, x: GLint, y: GLint, z: GLint, w: GLint): void {
        if (!this._checkUniformValid(location, x, 'uniform4i', 4, 'i')) return
        return this._native.uniform4i(location?._ || 0, x, y, z, w);
    }
    useProgram(program: WebGLProgram): void {
        // return this._native.useProgram(program._);
        if (!checkObject(program)) {
            throw new TypeError('useProgram(WebGLProgram)')
        } else if (!program) {
            this._switchActiveProgram(this._activeProgram)
            this._activeProgram = null
            return this._native.useProgram(0)
        } else if (this._checkWrapper(program, WebGLProgram)) {
            if (this._activeProgram !== program) {
                this._switchActiveProgram(this._activeProgram)
                this._activeProgram = program
                program._refCount += 1
            }
            return this._native.useProgram(program._ | 0)
        }
    }
    validateProgram(program: WebGLProgram): void {
        if (this._checkWrapper(program, WebGLProgram)) {
            this._native.validateProgram(program._ | 0)
            const error = this.getError()
            if (error === this.NO_ERROR) {
                program._linkInfoLog = this._native.getProgramInfoLog(program._ | 0)
            }
            this.getError()
            this.setError(error)
        }
    }

    vertexAttrib1f(index: GLuint, x: GLfloat): void {
        // return this._native.vertexAttrib1f(index, x);
        index |= 0
        if (!this._checkVertexIndex(index)) return
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[1] = data[2] = 0
        data[0] = x
        return this._native.vertexAttrib1f(index | 0, +x)
    }
    vertexAttrib1fv(index: GLuint, values: Float32List): void {
        // return this._native.vertexAttrib1fv(index, listToArray(values));
        if (typeof values !== 'object' || values === null || values.length < 1) {
            this.setError(this.INVALID_OPERATION)
            return
        }
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[2] = 0
        data[1] = 0
        data[0] = values[0]
        return this._native.vertexAttrib1f(index | 0, +values[0])
    }
    vertexAttrib2f(index: GLuint, x: GLfloat, y: GLfloat): void {
        // return this._native.vertexAttrib2f(index, x, y);
        index |= 0
        if (!this._checkVertexIndex(index)) return
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[2] = 0
        data[1] = y
        data[0] = x
        return this._native.vertexAttrib2f(index | 0, +x, +y)
    }
    vertexAttrib2fv(index: GLuint, values: Float32List): void {
        // return this._native.vertexAttrib2fv(index, listToArray(values));
        if (typeof values !== 'object' || values === null || values.length < 2) {
            this.setError(this.INVALID_OPERATION)
            return
        }
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[2] = 0
        data[1] = values[1]
        data[0] = values[0]
        return this._native.vertexAttrib2f(index | 0, +values[0], +values[1])
    }
    vertexAttrib3f(index: GLuint, x: GLfloat, y: GLfloat, z: GLfloat): void {
        // return this._native.vertexAttrib3f(index, x, y, z);
        index |= 0
        if (!this._checkVertexIndex(index)) return
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[2] = z
        data[1] = y
        data[0] = x
        return this._native.vertexAttrib3f(index | 0, +x, +y, +z)
    }
    vertexAttrib3fv(index: GLuint, values: Float32List): void {
        // return this._native.vertexAttrib3fv(index, listToArray(values));
        if (typeof values !== 'object' || values === null || values.length < 3) {
            this.setError(this.INVALID_OPERATION)
            return
        }
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = 1
        data[2] = values[2]
        data[1] = values[1]
        data[0] = values[0]
        return this._native.vertexAttrib3f(index | 0, +values[0], +values[1], +values[2])
    }
    vertexAttrib4f(index: GLuint = 0, x: GLfloat, y: GLfloat, z: GLfloat, w: GLfloat): void {
        // return this._native.vertexAttrib4f(index, x, y, z, w);
        if (!this._checkVertexIndex(index)) return
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = w
        data[2] = z
        data[1] = y
        data[0] = x
        return this._native.vertexAttrib4f(index | 0, +x, +y, +z, +w)
    }
    vertexAttrib4fv(index: GLuint, values: Float32List): void {
        // return this._native.vertexAttrib4fv(index, listToArray(values));
        if (typeof values !== 'object' || values === null || values.length < 4) {
            this.setError(this.INVALID_OPERATION)
            return
        }
        const data = this._vertexGlobalState._attribs[index]._data
        data[3] = values[3]
        data[2] = values[2]
        data[1] = values[1]
        data[0] = values[0]
        return this._native.vertexAttrib4f(index | 0, +values[0], +values[1], +values[2], +values[3])
    }
    vertexAttribPointer(index: GLuint = 0, size: GLint = 0, type: GLenum = 0, normalized: GLboolean = false, stride: GLsizei = 0, offset: GLintptr = 0): void {

        if (stride < 0 || offset < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (stride < 0 ||
            offset < 0 ||
            index < 0 || index >= this._vertexObjectState._attribs.length ||
            !(size === 1 || size === 2 || size === 3 || size === 4)) {
            this.setError(this.INVALID_VALUE)
            return
        }

        if (this._vertexGlobalState._arrayBufferBinding === null) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        // fixed, int and unsigned int aren't allowed in WebGL
        const byteSize = typeSize(this, type)
        if (byteSize === 0 ||
            type === this.INT ||
            type === this.UNSIGNED_INT) {
            this.setError(this.INVALID_ENUM)
            return
        }

        if (stride > 255 || stride < 0) {
            this.setError(this.INVALID_VALUE)
            return
        }

        // stride and offset must be multiples of size
        if ((stride % byteSize) !== 0 ||
            (offset % byteSize) !== 0) {
            this.setError(this.INVALID_OPERATION)
            return
        }

        // Call vertex attrib pointer
        this._native.vertexAttribPointer(index, size, type, normalized, stride, offset)

        // Update the vertex state object and references.
        this._vertexObjectState.setVertexAttribPointer(
            /* buffer */ this._vertexGlobalState._arrayBufferBinding,
            /* index */ index,
            /* pointerSize */ size * byteSize,
            /* pointerOffset */ offset,
            /* pointerStride */ stride || (size * byteSize),
            /* pointerType */ type,
            /* pointerNormal */ normalized,
            /* inputStride */ stride,
            /* inputSize */ size
        )
    }
    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        return this._native.viewport(x, y, width, height);
    }
}

export { GjsifyWebGLRenderingContext as WebGLRenderingContext }