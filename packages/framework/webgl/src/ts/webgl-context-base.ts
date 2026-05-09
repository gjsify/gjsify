// WebGLContextBase — composition root for the GJS WebGL implementation.
// Reference: refs/headless-gl/src/javascript/webgl-rendering-context.js,
//            refs/webgl/specs/latest/1.0/, refs/webgl/specs/latest/2.0/
// Reimplemented for GJS using @girs/gwebgl-0.1 (libgwebgl Vala bindings).
//
// The class itself owns: fields, abstract members, the constructor, `_init` and
// `_initGLConstants`, and a small set of foundational helpers used across every
// split module. The actual WebGL method implementations live in `./context/*.ts`
// modules — those modules use TypeScript declaration merging plus prototype
// assignment to attach methods to this class without growing the file.
//
// The split is purely organisational: every method is still a regular method on
// `WebGLContextBase.prototype`, and external consumers (`WebGLRenderingContext`,
// `WebGL2RenderingContext`, application code) do not need to change anything.

import '@girs/gdkpixbuf-2.0';

import * as bits from 'bit-twiddle';
import Gwebgl from '@girs/gwebgl-0.1';
import { WebGLContextAttributes } from './webgl-context-attributes.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { flag } from './utils.js';

// Extension factories
// import { getANGLEInstancedArrays } from './extensions/angle-instanced-arrays.js';
import { getOESElementIndexUint } from './extensions/oes-element-index-unit.js';
import { getOESStandardDerivatives } from './extensions/oes-standard-derivatives.js';
import { getOESTextureFloat } from './extensions/oes-texture-float.js';
import { getOESTextureFloatLinear } from './extensions/oes-texture-float-linear.js';
import { getSTACKGLDestroyContext } from './extensions/stackgl-destroy-context.js';
import { getSTACKGLResizeDrawingBuffer } from './extensions/stackgl-resize-drawing-buffer.js';
// import { getWebGLDrawBuffers } from './extensions/webgl-draw-buffers.js';
import { getEXTBlendMinMax } from './extensions/ext-blend-minmax.js';
import { getEXTColorBufferFloat } from './extensions/ext-color-buffer-float.js';
import { getEXTColorBufferHalfFloat } from './extensions/ext-color-buffer-half-float.js';
import { getEXTTextureFilterAnisotropic } from './extensions/ext-texture-filter-anisotropic.js';
import { getOESTextureHalfFloat } from './extensions/oes-texture-half-float.js';
// import { getOESVertexArrayObject } from './extensions/oes-vertex-array-object.js';

import { WebGLBuffer } from './webgl-buffer.js';
import { WebGLDrawingBufferWrapper } from './webgl-drawing-buffer-wrapper.js';
import { WebGLFramebuffer } from './webgl-framebuffer.js';
import { WebGLProgram } from './webgl-program.js';
import { WebGLRenderbuffer } from './webgl-renderbuffer.js';
import { WebGLShader } from './webgl-shader.js';
import { WebGLTexture } from './webgl-texture.js';
import { WebGLTextureUnit } from './webgl-texture-unit.js';
import { WebGLVertexArrayObjectState, WebGLVertexArrayGlobalState } from './webgl-vertex-attribute.js';

import type { ExtensionFactory, WebGLConstants } from './types/index.js';
import { warnNotImplemented } from '@gjsify/utils';

const VERSION = '0.0.1';

let CONTEXT_COUNTER = 0;

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
    ext_color_buffer_float: getEXTColorBufferFloat,
    ext_color_buffer_half_float: getEXTColorBufferHalfFloat,
    ext_texture_filter_anisotropic: getEXTTextureFilterAnisotropic,
    oes_texture_half_float: getOESTextureHalfFloat,
};

/**
 * Per-extension structural type. The original code typed this as `Record<string, any>`;
 * since each extension is created by an `ExtensionFactory` and exposes a heterogenous
 * set of GL constants and instance state, `Record<string, unknown>` plus a string index
 * preserves "anything can be on it" without losing call-site safety entirely.
 */
type WebGLExtensionLike = Record<string, unknown>;

export interface WebGLContextBase extends WebGLConstants { }

export abstract class WebGLContextBase {
    canvas: HTMLCanvasElement;

    /**
     * STATUS.md "Open TODOs" — Web platform parity:
     *   "WebGL: drawingBufferColorSpace currently a static field; needs colorimetry
     *    plumbing into Cairo/GTK GL output to honour 'srgb' vs 'display-p3'."
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace
     */
    drawingBufferColorSpace: PredefinedColorSpace;

    unpackColorSpace: PredefinedColorSpace = 'srgb';

    readonly RGBA8 = 0x8058 as const;

    get drawingBufferHeight(): number {
        return this.canvas.height || 0;
    }

    get drawingBufferWidth(): number {
        return this.canvas.width || 0;
    }

    DEFAULT_ATTACHMENTS: number[] = [];

    DEFAULT_COLOR_ATTACHMENTS: number[] = [];

    /** context counter */
    _ = 0;

    abstract get _gl(): Gwebgl.WebGLRenderingContextBase;

    _contextAttributes: WebGLContextAttributes;

    /**
     * Map of active GL extension instances. Keys are lowercase extension names
     * (e.g. `oes_texture_float`); values are returned by the `ExtensionFactory`
     * for that name. Each extension has its own surface area, so we keep this
     * loose-typed but no longer `any`.
     */
    _extensions: Record<string, WebGLExtensionLike & any> = {};
    _programs: Record<number, WebGLProgram> = {};
    _shaders: Record<number, WebGLShader> = {};
    _textures: Record<number, WebGLTexture> = {};
    _framebuffers: Record<number, WebGLFramebuffer> = {};
    _renderbuffers: Record<number, WebGLRenderbuffer> = {};
    _buffers: Record<number, WebGLBuffer> = {};

    _activeProgram: WebGLProgram | null = null;
    _activeFramebuffer: WebGLFramebuffer | null = null;
    _activeRenderbuffer: WebGLRenderbuffer | null = null;
    _checkStencil = false;
    _stencilState = true;

    _activeTextureUnit = 0;
    _errorStack: GLenum[] = [];
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
    _unpackAlignment = 4;
    _packAlignment = 4;
    _unpackFlipY = false;
    _unpackPremultAlpha = false;

    // Viewport and scissor — tracked in JS to avoid crashing native getParameterx for array returns
    _viewport: Int32Array = new Int32Array([0, 0, 0, 0]);
    _scissorBox: Int32Array = new Int32Array([0, 0, 0, 0]);

    // GTK's own FBO ID (not FBO 0). GtkGLArea renders into a custom FBO, not the
    // default surface FBO. Captured once at _init() time before any rebinding so
    // that bindFramebuffer(target, null) can restore the correct FBO.
    _gtkFboId = 0;

    _textureUnits: WebGLTextureUnit[] = [];
    _drawingBuffer: WebGLDrawingBufferWrapper | null = null;

    protected constructor(canvas: HTMLCanvasElement | null, options: Partial<Gwebgl.WebGLRenderingContext.ConstructorProps> & WebGLContextAttributes = {} as never) {
        this.canvas = canvas;

        this._contextAttributes = new WebGLContextAttributes(
            flag(options, 'alpha', true),
            flag(options, 'depth', true),
            flag(options, 'stencil', false),
            false, // flag(options, 'antialias', true),
            flag(options, 'premultipliedAlpha', true),
            flag(options, 'preserveDrawingBuffer', false),
            flag(options, 'preferLowPowerToHighPerformance', false),
            flag(options, 'failIfMajorPerformanceCaveat', false),
        );

        // Can only use premultipliedAlpha if alpha is set
        this._contextAttributes.premultipliedAlpha = this._contextAttributes.premultipliedAlpha && this._contextAttributes.alpha;
    }

    /**
     * Must be called by subclass constructors AFTER setting up the native GL object
     * so that `this._gl` is available for GL-dependent initialization.
     */
    protected _init(): void {
        // Capture GTK's FBO ID before any rebinding. At this point GtkGLArea's render
        // signal has already bound its own FBO (never FBO 0). We need this ID so that
        // bindFramebuffer(target, null) restores the right FBO instead of binding 0.
        // 0x8CA6 = GL_DRAW_FRAMEBUFFER_BINDING / GL_FRAMEBUFFER_BINDING (same enum value).
        const gtkFboVariant = this._gl.getParameterx(0x8CA6);
        this._gtkFboId = (gtkFboVariant?.deepUnpack() as number) | 0;

        this._initGLConstants();

        this.DEFAULT_ATTACHMENTS = [
            this.COLOR_ATTACHMENT0,
            this.DEPTH_ATTACHMENT,
            this.STENCIL_ATTACHMENT,
            this.DEPTH_STENCIL_ATTACHMENT,
        ];

        this.DEFAULT_COLOR_ATTACHMENTS = [this.COLOR_ATTACHMENT0];

        const width = this.drawingBufferWidth || 0;
        const height = this.drawingBufferHeight || 0;

        this._ = CONTEXT_COUNTER++;

        // Initialize texture units
        const numTextures = this.getParameter(this.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
        this._textureUnits = new Array(numTextures);
        for (let i = 0; i < numTextures; ++i) {
            this._textureUnits[i] = new WebGLTextureUnit(this, i);
        }

        this.activeTexture(this.TEXTURE0);

        // Vertex array attributes that are in vertex array objects.
        this._defaultVertexObjectState = new WebGLVertexArrayObjectState(this);
        this._vertexObjectState = this._defaultVertexObjectState;

        // Vertex array attributes that are not in vertex array objects.
        this._vertexGlobalState = new WebGLVertexArrayGlobalState(this);

        // Store limits
        this._maxTextureSize = this.getParameter(this.MAX_TEXTURE_SIZE) as number;
        this._maxTextureLevel = bits.log2(bits.nextPow2(this._maxTextureSize));
        this._maxCubeMapSize = this.getParameter(this.MAX_CUBE_MAP_TEXTURE_SIZE) as number;
        this._maxCubeMapLevel = bits.log2(bits.nextPow2(this._maxCubeMapSize));

        // Unpack alignment
        this._unpackAlignment = 4;
        this._packAlignment = 4;
        this._unpackFlipY = false;
        this._unpackPremultAlpha = false;

        // STATUS.md "Open TODOs": optional drawing-buffer pre-allocation.
        // Headless-gl-style allocation is not currently used because GtkGLArea owns the
        // surface; revisit if/when we add non-GTK output paths.
        // this._allocateDrawingBuffer(width, height)

        // Initialize defaults
        this.bindBuffer(this.ARRAY_BUFFER, null);
        this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null);
        this.bindFramebuffer(this.FRAMEBUFFER, null);
        this.bindRenderbuffer(this.RENDERBUFFER, null);

        // Set viewport and scissor
        this.viewport(0, 0, width, height);
        this.scissor(0, 0, width, height);

        // Clear buffers
        this.clearDepth(1);
        this.clearColor(0, 0, 0, 0);
        this.clearStencil(0);
        this.clear(this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT | this.STENCIL_BUFFER_BIT);

        // Enforce WebGL spec initial state that GtkGLArea (with has_depth_buffer=true)
        // may override during context setup.
        this.disable(this.DEPTH_TEST);
        this.disable(this.STENCIL_TEST);
        this.disable(this.BLEND);
        this.disable(this.CULL_FACE);
        this.disable(this.POLYGON_OFFSET_FILL);
        this.disable(this.SCISSOR_TEST);
        this._gl.colorMask(true, true, true, true);
    }

    _initGLConstants(): void {
        const giBaseClass = new Gwebgl.WebGLRenderingContextBase();
        const hash = giBaseClass.get_webgl_constants();
        for (const [k, v] of Object.entries(hash)) {
            Object.defineProperty(this, k, { value: v });
        }
    }

    _getGlslVersion(es: boolean): string {
        return es ? '100' : '120';
    }

    // ─── Foundational helpers used across multiple split modules ──────────

    _checkOwns(object: unknown): boolean {
        return typeof object === 'object' && object !== null &&
            (object as { _ctx?: unknown })._ctx === this;
    }

    _checkValid(object: unknown, Type: { new (...args: unknown[]): unknown }): boolean {
        return object instanceof Type && (object as { _: number })._ !== 0;
    }

    _checkWrapper(object: unknown, Wrapper: { new (...args: unknown[]): unknown }): boolean {
        if (!this._checkValid(object, Wrapper)) {
            this.setError(this.INVALID_VALUE);
            return false;
        } else if (!this._checkOwns(object)) {
            this.setError(this.INVALID_OPERATION);
            return false;
        }
        return true;
    }

    _isObject(object: unknown, method: string, Wrapper: { new (...args: unknown[]): unknown }): boolean {
        if (!(object === null || object === undefined) &&
            !(object instanceof Wrapper)) {
            throw new TypeError(method + '(' + Wrapper.name + ')');
        }
        if (this._checkValid(object, Wrapper) && this._checkOwns(object)) {
            return true;
        }
        return false;
    }

    _checkStencilState(): boolean {
        if (!this._checkStencil) {
            return this._stencilState;
        }
        this._checkStencil = false;
        this._stencilState = true;
        if (this.getParameter(this.STENCIL_WRITEMASK) !==
            this.getParameter(this.STENCIL_BACK_WRITEMASK) ||
            this.getParameter(this.STENCIL_VALUE_MASK) !==
            this.getParameter(this.STENCIL_BACK_VALUE_MASK) ||
            this.getParameter(this.STENCIL_REF) !==
            this.getParameter(this.STENCIL_BACK_REF)) {
            this.setError(this.INVALID_OPERATION);
            this._stencilState = false;
        }
        return this._stencilState;
    }

    _validGLSLIdentifier(str: string): boolean {
        return !(str.indexOf('webgl_') === 0 ||
            str.indexOf('_webgl_') === 0 ||
            str.length > 256);
    }

    _getParameterDirect(pname: GLenum): unknown {
        return this._gl.getParameterx(pname)?.deepUnpack();
    }

    // ─── Public surface kept on the class itself ──────────────────────────

    /**
     * The `WebGLRenderingContext.getContextAttributes()` method returns a `WebGLContextAttributes`
     * object that contains the actual context parameters. Might return `null`, if the context is lost.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes
     */
    getContextAttributes(): WebGLContextAttributes | null {
        return this._contextAttributes;
    }

    getExtension(name: string): unknown {
        const str = name.toLowerCase();
        if (str in this._extensions) {
            return this._extensions[str];
        }
        const ext = availableExtensions[str] ? availableExtensions[str](this) : null;
        if (ext) {
            this._extensions[str] = ext;
        }
        return ext;
    }

    getSupportedExtensions(): string[] {
        const exts = [
            'ANGLE_instanced_arrays',
            'STACKGL_resize_drawingbuffer',
            'STACKGL_destroy_context',
        ];

        const supportedExts = this._gl.getSupportedExtensions();

        if (!supportedExts) {
            return exts;
        }

        if (supportedExts.indexOf('GL_OES_element_index_uint') >= 0) exts.push('OES_element_index_uint');
        if (supportedExts.indexOf('GL_OES_standard_derivatives') >= 0) exts.push('OES_standard_derivatives');
        if (supportedExts.indexOf('GL_OES_texture_float') >= 0) exts.push('OES_texture_float');
        if (supportedExts.indexOf('GL_OES_texture_float_linear') >= 0) exts.push('OES_texture_float_linear');
        if (supportedExts.indexOf('GL_OES_texture_half_float') >= 0 ||
            supportedExts.indexOf('GL_ARB_half_float_pixel') >= 0) exts.push('OES_texture_half_float');
        if (supportedExts.indexOf('GL_EXT_color_buffer_float') >= 0 ||
            supportedExts.indexOf('GL_ARB_color_buffer_float') >= 0) exts.push('EXT_color_buffer_float');
        if (supportedExts.indexOf('GL_EXT_color_buffer_half_float') >= 0) exts.push('EXT_color_buffer_half_float');
        if (supportedExts.indexOf('EXT_draw_buffers') >= 0) exts.push('WEBGL_draw_buffers');
        if (supportedExts.indexOf('EXT_blend_minmax') >= 0) exts.push('EXT_blend_minmax');
        if (supportedExts.indexOf('EXT_texture_filter_anisotropic') >= 0) exts.push('EXT_texture_filter_anisotropic');
        if (supportedExts.indexOf('GL_OES_vertex_array_object') >= 0) exts.push('OES_vertex_array_object');

        return exts;
    }

    getParameter(pname: GLenum = 0): unknown {
        switch (pname) {
            case this.ARRAY_BUFFER_BINDING:
                return this._vertexGlobalState._arrayBufferBinding;
            case this.ELEMENT_ARRAY_BUFFER_BINDING:
                return this._vertexObjectState._elementArrayBufferBinding;
            case this.CURRENT_PROGRAM:
                return this._activeProgram;
            case this.FRAMEBUFFER_BINDING:
                return this._activeFramebuffer;
            case this.RENDERBUFFER_BINDING:
                return this._activeRenderbuffer;
            case this.TEXTURE_BINDING_2D:
                return this._getActiveTextureUnit()._bind2D;
            case this.TEXTURE_BINDING_CUBE_MAP:
                return this._getActiveTextureUnit()._bindCube;
            case this.VERSION:
                return 'WebGL 1.0  ' + VERSION;
            case this.VENDOR:
                return '';
            case this.RENDERER:
                return 'ANGLE';
            case this.SHADING_LANGUAGE_VERSION:
                return 'WebGL GLSL ES 1.0 ';

            case this.COMPRESSED_TEXTURE_FORMATS:
                return new Uint32Array(0);

            // Int arrays — tracked in JS (native getParameterx crashes for array returns)
            case this.SCISSOR_BOX:
                return new Int32Array(this._scissorBox);
            case this.VIEWPORT:
                return new Int32Array(this._viewport);
            case this.MAX_VIEWPORT_DIMS:
                return new Int32Array([32767, 32767]);

            // Float arrays
            case this.ALIASED_LINE_WIDTH_RANGE:
            case this.ALIASED_POINT_SIZE_RANGE:
                return new Float32Array([1, 1]);
            case this.DEPTH_RANGE:
                return new Float32Array([0, 1]);
            case this.BLEND_COLOR:
            case this.COLOR_CLEAR_VALUE:
                return new Float32Array(this._gl.getParameterfv(pname, 4));

            case this.COLOR_WRITEMASK: {
                // Use getParameteriv: GLboolean/uint8 → bool/gint cast in Vala has a size
                // mismatch (1 byte vs 4 bytes per element), making getParameterbv unreliable.
                const iv = this._gl.getParameteriv(pname, 4);
                return [!!iv[0], !!iv[1], !!iv[2], !!iv[3]];
            }

            case this.DEPTH_CLEAR_VALUE:
            case this.LINE_WIDTH:
            case this.POLYGON_OFFSET_FACTOR:
            case this.POLYGON_OFFSET_UNITS:
            case this.SAMPLE_COVERAGE_VALUE:
                return this._gl.getParameterf(pname);

            case this.BLEND:
            case this.CULL_FACE:
            case this.DEPTH_TEST:
            case this.DEPTH_WRITEMASK:
            case this.DITHER:
            case this.POLYGON_OFFSET_FILL:
            case this.SAMPLE_COVERAGE_INVERT:
            case this.SCISSOR_TEST:
            case this.STENCIL_TEST:
            case this.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
                // Use getParameteri (0/1) rather than getParameterb: the Vala GLboolean/bool
                // cast has a size mismatch that causes getParameterb to return wrong values.
                return !!this._gl.getParameteri(pname);

            case this.UNPACK_FLIP_Y_WEBGL:
                return this._unpackFlipY;

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
                // Use getParameteri to avoid stale GL errors from getParameterx GVariant
                // conversion for pnames that the Vala switch doesn't explicitly handle.
                return this._gl.getParameteri(pname);

            case this.IMPLEMENTATION_COLOR_READ_FORMAT:
            case this.IMPLEMENTATION_COLOR_READ_TYPE:
                return this._getParameterDirect(pname);

            default:
                if (this._extensions.webgl_draw_buffers) {
                    const ext = this._extensions.webgl_draw_buffers;
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
                                return this.BACK;
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
                    return this._extensions.oes_vertex_array_object._activeVertexArrayObject;
                }

                this.setError(this.INVALID_ENUM);
                return null;
        }
    }

    destroy(): void {
        warnNotImplemented('destroy');
        // this._gl.destroy()
    }
}

// Wire focused method groups into WebGLContextBase.prototype.
// Imported eagerly so the augmentation interfaces in each module merge into
// `WebGLContextBase` at type-check time. The actual prototype assignment runs
// after the class is fully declared, sidestepping the circular-import trap that
// would leave `WebGLContextBase` undefined inside the split modules.
import { installAllContextMethods } from './context/index.js';
installAllContextMethods(WebGLContextBase.prototype);
