
namespace Gwebgl {

    using GL;

    public errordomain TypeError {
        CODE
    }

    // WebGL constants
    // See https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Constants#pixel_storage_modes

    // Pixel storage modes
    public const int UNPACK_FLIP_Y_WEBGL = 0x9240;
    public const int UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
    public const int UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;

    // WebGL constants which are not part of OpenGL ES
    public const int CONTEXT_LOST_WEBGL = 0x9242;
    public const int BROWSER_DEFAULT_WEBGL = 0x9244;

    // ANGLE_instanced_arrays

    /** Describes the frequency divisor used for instanced rendering. */
    public const int VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE = 0x88FE;

    // WEBGL_debug_renderer_info

    /** Passed to `getParameter` to get the vendor string of the graphics driver. */
    public const int UNMASKED_VENDOR_WEBGL = 0x9245;
    /** Passed to `getParameter` to get the renderer string of the graphics driver. */
    public const int UNMASKED_RENDERER_WEBGL = 0x9246;

    // WebGL Extensions

    /** Maximum number of draw buffers */
    public const int MAX_DRAW_BUFFERS_WEBGL = 0x8824;
    /** Returns the maximum available anisotropy. */
    public const int MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF;
    /** Passed to texParameter to set the desired maximum anisotropy for a texture. */
    public const int TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE;

    public const int STENCIL_INDEX = 0x1901;
    public const int VERSION = 0x1F02;
    public const int IMPLEMENTATION_COLOR_READ_TYPE = 0x8B9A;
    public const int IMPLEMENTATION_COLOR_READ_FORMAT = 0x8B9B;

    public class WebGLRenderingContextBase: Object {
        HashTable<string, int> webgl_constants = new HashTable<string, int> (str_hash, str_equal);

        protected bool unpack_flip_y = false;
        protected bool unpack_premultiply_alpha = false;
        protected int unpack_colorspace_conversion = 0x9244;
        protected int unpack_alignment = 4;
        protected int lastError = GL_NO_ERROR;


        public WebGLRenderingContextBase() {

        }

        /* Constructor */
        construct {

            this.webgl_constants.insert("UNPACK_FLIP_Y_WEBGL", UNPACK_FLIP_Y_WEBGL);
            this.webgl_constants.insert("UNPACK_PREMULTIPLY_ALPHA_WEBGL", UNPACK_PREMULTIPLY_ALPHA_WEBGL);
            this.webgl_constants.insert("UNPACK_COLORSPACE_CONVERSION_WEBGL", UNPACK_COLORSPACE_CONVERSION_WEBGL);
            this.webgl_constants.insert("CONTEXT_LOST_WEBGL", CONTEXT_LOST_WEBGL);
            this.webgl_constants.insert("BROWSER_DEFAULT_WEBGL", BROWSER_DEFAULT_WEBGL);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE", VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE);
            this.webgl_constants.insert("UNMASKED_VENDOR_WEBGL", UNMASKED_VENDOR_WEBGL);
            this.webgl_constants.insert("UNMASKED_RENDERER_WEBGL", UNMASKED_RENDERER_WEBGL);
            this.webgl_constants.insert("MAX_DRAW_BUFFERS_WEBGL", MAX_DRAW_BUFFERS_WEBGL);
            this.webgl_constants.insert("MAX_TEXTURE_MAX_ANISOTROPY_EXT", MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            this.webgl_constants.insert("TEXTURE_MAX_ANISOTROPY_EXT", TEXTURE_MAX_ANISOTROPY_EXT);
            this.webgl_constants.insert("STENCIL_INDEX", STENCIL_INDEX);
            this.webgl_constants.insert("VERSION", VERSION);
            this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_TYPE", IMPLEMENTATION_COLOR_READ_TYPE);
            this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_FORMAT", IMPLEMENTATION_COLOR_READ_FORMAT);
            this.webgl_constants.insert("DEPTH_STENCIL", GL_DEPTH_STENCIL_OES);

            // Also part of OpenGL ES
            this.webgl_constants.insert("ACTIVE_ATTRIBUTES", GL_ACTIVE_ATTRIBUTES);
            this.webgl_constants.insert("ACTIVE_TEXTURE", GL_ACTIVE_TEXTURE);
            this.webgl_constants.insert("ACTIVE_UNIFORMS", GL_ACTIVE_UNIFORMS);
            this.webgl_constants.insert("ALIASED_LINE_WIDTH_RANGE", GL_ALIASED_LINE_WIDTH_RANGE);
            this.webgl_constants.insert("ALIASED_POINT_SIZE_RANGE", GL_ALIASED_POINT_SIZE_RANGE);
            this.webgl_constants.insert("ALPHA", GL_ALPHA);
            this.webgl_constants.insert("ALPHA_BITS", GL_ALPHA_BITS);
            this.webgl_constants.insert("ALWAYS", GL_ALWAYS);
            this.webgl_constants.insert("ARRAY_BUFFER", GL_ARRAY_BUFFER);
            this.webgl_constants.insert("ARRAY_BUFFER_BINDING", GL_ARRAY_BUFFER_BINDING);
            this.webgl_constants.insert("ATTACHED_SHADERS", GL_ATTACHED_SHADERS);
            this.webgl_constants.insert("BACK", GL_BACK);
            this.webgl_constants.insert("BLEND", GL_BLEND);
            this.webgl_constants.insert("BLEND_COLOR", GL_BLEND_COLOR);
            this.webgl_constants.insert("BLEND_DST_ALPHA", GL_BLEND_DST_ALPHA);
            this.webgl_constants.insert("BLEND_DST_RGB", GL_BLEND_DST_RGB);
            this.webgl_constants.insert("BLEND_EQUATION", GL_BLEND_EQUATION);
            this.webgl_constants.insert("BLEND_EQUATION_ALPHA", GL_BLEND_EQUATION_ALPHA);
            this.webgl_constants.insert("BLEND_EQUATION_RGB", GL_BLEND_EQUATION_RGB);
            this.webgl_constants.insert("BLEND_SRC_ALPHA", GL_BLEND_SRC_ALPHA);
            this.webgl_constants.insert("BLEND_SRC_RGB", GL_BLEND_SRC_RGB);
            this.webgl_constants.insert("BLUE_BITS", GL_BLUE_BITS);
            this.webgl_constants.insert("BOOL", GL_BOOL);
            this.webgl_constants.insert("BOOL_VEC2", GL_BOOL_VEC2);
            this.webgl_constants.insert("BOOL_VEC3", GL_BOOL_VEC3);
            this.webgl_constants.insert("BOOL_VEC4", GL_BOOL_VEC4);
            this.webgl_constants.insert("BUFFER_SIZE", GL_BUFFER_SIZE);
            this.webgl_constants.insert("BUFFER_USAGE", GL_BUFFER_USAGE);
            this.webgl_constants.insert("BYTE", GL_BYTE);
            this.webgl_constants.insert("CCW", GL_CCW);
            this.webgl_constants.insert("CLAMP_TO_EDGE", GL_CLAMP_TO_EDGE);
            this.webgl_constants.insert("COLOR_ATTACHMENT0", GL_COLOR_ATTACHMENT0);
            this.webgl_constants.insert("COLOR_BUFFER_BIT", GL_COLOR_BUFFER_BIT);
            this.webgl_constants.insert("COLOR_CLEAR_VALUE", GL_COLOR_CLEAR_VALUE);
            this.webgl_constants.insert("COLOR_WRITEMASK", GL_COLOR_WRITEMASK);
            this.webgl_constants.insert("COMPILE_STATUS", GL_COMPILE_STATUS);
            this.webgl_constants.insert("COMPRESSED_TEXTURE_FORMATS", GL_COMPRESSED_TEXTURE_FORMATS);
            this.webgl_constants.insert("CONSTANT_ALPHA", GL_CONSTANT_ALPHA);
            this.webgl_constants.insert("CONSTANT_COLOR", GL_CONSTANT_COLOR);
            this.webgl_constants.insert("CULL_FACE", GL_CULL_FACE);
            this.webgl_constants.insert("CULL_FACE_MODE", GL_CULL_FACE_MODE);
            this.webgl_constants.insert("CURRENT_PROGRAM", GL_CURRENT_PROGRAM);
            this.webgl_constants.insert("CURRENT_VERTEX_ATTRIB", GL_CURRENT_VERTEX_ATTRIB);
            this.webgl_constants.insert("CW", GL_CW);
            this.webgl_constants.insert("DECR", GL_DECR);
            this.webgl_constants.insert("DECR_WRAP", GL_DECR_WRAP);
            this.webgl_constants.insert("DELETE_STATUS", GL_DELETE_STATUS);
            this.webgl_constants.insert("DEPTH_ATTACHMENT", GL_DEPTH_ATTACHMENT);
            this.webgl_constants.insert("DEPTH_BITS", GL_DEPTH_BITS);
            this.webgl_constants.insert("DEPTH_BUFFER_BIT", GL_DEPTH_BUFFER_BIT);
            this.webgl_constants.insert("DEPTH_CLEAR_VALUE", GL_DEPTH_CLEAR_VALUE);
            this.webgl_constants.insert("DEPTH_COMPONENT", GL_DEPTH_COMPONENT);
            this.webgl_constants.insert("DEPTH_COMPONENT16", GL_DEPTH_COMPONENT16);
            this.webgl_constants.insert("DEPTH_FUNC", GL_DEPTH_FUNC);
            this.webgl_constants.insert("DEPTH_RANGE", GL_DEPTH_RANGE);
            this.webgl_constants.insert("DEPTH_TEST", GL_DEPTH_TEST);
            this.webgl_constants.insert("DEPTH_WRITEMASK", GL_DEPTH_WRITEMASK);
            this.webgl_constants.insert("DITHER", GL_DITHER);
            this.webgl_constants.insert("DONT_CARE", GL_DONT_CARE);
            this.webgl_constants.insert("DST_ALPHA", GL_DST_ALPHA);
            this.webgl_constants.insert("DST_COLOR", GL_DST_COLOR);
            this.webgl_constants.insert("DYNAMIC_DRAW", GL_DYNAMIC_DRAW);
            this.webgl_constants.insert("ELEMENT_ARRAY_BUFFER", GL_ELEMENT_ARRAY_BUFFER);
            this.webgl_constants.insert("ELEMENT_ARRAY_BUFFER_BINDING", GL_ELEMENT_ARRAY_BUFFER_BINDING);
            this.webgl_constants.insert("EQUAL", GL_EQUAL);
            this.webgl_constants.insert("FASTEST", GL_FASTEST);
            this.webgl_constants.insert("FLOAT", GL_FLOAT);
            this.webgl_constants.insert("FLOAT_MAT2", GL_FLOAT_MAT2);
            this.webgl_constants.insert("FLOAT_MAT3", GL_FLOAT_MAT3);
            this.webgl_constants.insert("FLOAT_MAT4", GL_FLOAT_MAT4);
            this.webgl_constants.insert("FLOAT_VEC2", GL_FLOAT_VEC2);
            this.webgl_constants.insert("FLOAT_VEC3", GL_FLOAT_VEC3);
            this.webgl_constants.insert("FLOAT_VEC4", GL_FLOAT_VEC4);
            this.webgl_constants.insert("FRAGMENT_SHADER", GL_FRAGMENT_SHADER);
            this.webgl_constants.insert("FRAMEBUFFER", GL_FRAMEBUFFER);
            this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_OBJECT_NAME", GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
            this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE", GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
            this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE", GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE);
            this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL", GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL);
            this.webgl_constants.insert("FRAMEBUFFER_BINDING", GL_FRAMEBUFFER_BINDING);
            this.webgl_constants.insert("FRAMEBUFFER_COMPLETE", GL_FRAMEBUFFER_COMPLETE);
            this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_ATTACHMENT", GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
            this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_DIMENSIONS", GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS_OES);
            this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT", GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
            this.webgl_constants.insert("FRAMEBUFFER_UNSUPPORTED", GL_FRAMEBUFFER_UNSUPPORTED);
            this.webgl_constants.insert("FRONT", GL_FRONT);
            this.webgl_constants.insert("FRONT_AND_BACK", GL_FRONT_AND_BACK);
            this.webgl_constants.insert("FRONT_FACE", GL_FRONT_FACE);
            this.webgl_constants.insert("FUNC_ADD", GL_FUNC_ADD);
            this.webgl_constants.insert("FUNC_REVERSE_SUBTRACT", GL_FUNC_REVERSE_SUBTRACT);
            this.webgl_constants.insert("FUNC_SUBTRACT", GL_FUNC_SUBTRACT);
            this.webgl_constants.insert("GENERATE_MIPMAP_HINT", GL_GENERATE_MIPMAP_HINT);
            this.webgl_constants.insert("GEQUAL", GL_GEQUAL);
            this.webgl_constants.insert("GREATER", GL_GREATER);
            this.webgl_constants.insert("GREEN_BITS", GL_GREEN_BITS);
            this.webgl_constants.insert("HIGH_FLOAT", GL_HIGH_FLOAT);
            this.webgl_constants.insert("HIGH_INT", GL_HIGH_INT);
            this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_FORMAT", GL_IMPLEMENTATION_COLOR_READ_FORMAT);
            this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_TYPE", GL_IMPLEMENTATION_COLOR_READ_TYPE);
            this.webgl_constants.insert("INCR", GL_INCR);
            this.webgl_constants.insert("INCR_WRAP", GL_INCR_WRAP);
            this.webgl_constants.insert("INT", GL_INT);
            this.webgl_constants.insert("INT_VEC2", GL_INT_VEC2);
            this.webgl_constants.insert("INT_VEC3", GL_INT_VEC3);
            this.webgl_constants.insert("INT_VEC4", GL_INT_VEC4);
            this.webgl_constants.insert("INVALID_ENUM", GL_INVALID_ENUM);
            this.webgl_constants.insert("INVALID_FRAMEBUFFER_OPERATION", GL_INVALID_FRAMEBUFFER_OPERATION);
            this.webgl_constants.insert("INVALID_OPERATION", GL_INVALID_OPERATION);
            this.webgl_constants.insert("INVALID_VALUE", GL_INVALID_VALUE);
            this.webgl_constants.insert("INVERT", GL_INVERT);
            this.webgl_constants.insert("KEEP", GL_KEEP);
            this.webgl_constants.insert("LEQUAL", GL_LEQUAL);
            this.webgl_constants.insert("LESS", GL_LESS);
            this.webgl_constants.insert("LINEAR", GL_LINEAR);
            this.webgl_constants.insert("LINEAR_MIPMAP_LINEAR", GL_LINEAR_MIPMAP_LINEAR);
            this.webgl_constants.insert("LINEAR_MIPMAP_NEAREST", GL_LINEAR_MIPMAP_NEAREST);
            this.webgl_constants.insert("LINES", GL_LINES);
            this.webgl_constants.insert("LINE_LOOP", GL_LINE_LOOP);
            this.webgl_constants.insert("LINE_STRIP", GL_LINE_STRIP);
            this.webgl_constants.insert("LINE_WIDTH", GL_LINE_WIDTH);
            this.webgl_constants.insert("LINK_STATUS", GL_LINK_STATUS);
            this.webgl_constants.insert("LOW_FLOAT", GL_LOW_FLOAT);
            this.webgl_constants.insert("LOW_INT", GL_LOW_INT);
            this.webgl_constants.insert("LUMINANCE", GL_LUMINANCE);
            this.webgl_constants.insert("LUMINANCE_ALPHA", GL_LUMINANCE_ALPHA);
            this.webgl_constants.insert("MAX_COMBINED_TEXTURE_IMAGE_UNITS", GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS);
            this.webgl_constants.insert("MAX_CUBE_MAP_TEXTURE_SIZE", GL_MAX_CUBE_MAP_TEXTURE_SIZE);
            this.webgl_constants.insert("MAX_FRAGMENT_UNIFORM_VECTORS", GL_MAX_FRAGMENT_UNIFORM_VECTORS);
            this.webgl_constants.insert("MAX_RENDERBUFFER_SIZE", GL_MAX_RENDERBUFFER_SIZE);
            this.webgl_constants.insert("MAX_TEXTURE_IMAGE_UNITS", GL_MAX_TEXTURE_IMAGE_UNITS);
            this.webgl_constants.insert("MAX_TEXTURE_SIZE", GL_MAX_TEXTURE_SIZE);
            this.webgl_constants.insert("MAX_VARYING_VECTORS", GL_MAX_VARYING_VECTORS);
            this.webgl_constants.insert("MAX_VERTEX_ATTRIBS", GL_MAX_VERTEX_ATTRIBS);
            this.webgl_constants.insert("MAX_VERTEX_TEXTURE_IMAGE_UNITS", GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS);
            this.webgl_constants.insert("MAX_VERTEX_UNIFORM_VECTORS", GL_MAX_VERTEX_UNIFORM_VECTORS);
            this.webgl_constants.insert("MAX_VIEWPORT_DIMS", GL_MAX_VIEWPORT_DIMS);
            this.webgl_constants.insert("MEDIUM_FLOAT", GL_MEDIUM_FLOAT);
            this.webgl_constants.insert("MEDIUM_INT", GL_MEDIUM_INT);
            this.webgl_constants.insert("MIRRORED_REPEAT", GL_MIRRORED_REPEAT);
            this.webgl_constants.insert("NEAREST", GL_NEAREST);
            this.webgl_constants.insert("NEAREST_MIPMAP_LINEAR", GL_NEAREST_MIPMAP_LINEAR);
            this.webgl_constants.insert("NEAREST_MIPMAP_NEAREST", GL_NEAREST_MIPMAP_NEAREST);
            this.webgl_constants.insert("NEVER", GL_NEVER);
            this.webgl_constants.insert("NICEST", GL_NICEST);
            this.webgl_constants.insert("NONE", GL_NONE);
            this.webgl_constants.insert("NOTEQUAL", GL_NOTEQUAL);
            this.webgl_constants.insert("NO_ERROR", GL_NO_ERROR);
            this.webgl_constants.insert("ONE", GL_ONE);
            this.webgl_constants.insert("ONE_MINUS_CONSTANT_ALPHA", GL_ONE_MINUS_CONSTANT_ALPHA);
            this.webgl_constants.insert("ONE_MINUS_CONSTANT_COLOR", GL_ONE_MINUS_CONSTANT_COLOR);
            this.webgl_constants.insert("ONE_MINUS_DST_ALPHA", GL_ONE_MINUS_DST_ALPHA);
            this.webgl_constants.insert("ONE_MINUS_DST_COLOR", GL_ONE_MINUS_DST_COLOR);
            this.webgl_constants.insert("ONE_MINUS_SRC_ALPHA", GL_ONE_MINUS_SRC_ALPHA);
            this.webgl_constants.insert("ONE_MINUS_SRC_COLOR", GL_ONE_MINUS_SRC_COLOR);
            this.webgl_constants.insert("OUT_OF_MEMORY", GL_OUT_OF_MEMORY);
            this.webgl_constants.insert("PACK_ALIGNMENT", GL_PACK_ALIGNMENT);
            this.webgl_constants.insert("POINTS", GL_POINTS);
            this.webgl_constants.insert("POLYGON_OFFSET_FACTOR", GL_POLYGON_OFFSET_FACTOR);
            this.webgl_constants.insert("POLYGON_OFFSET_FILL", GL_POLYGON_OFFSET_FILL);
            this.webgl_constants.insert("POLYGON_OFFSET_UNITS", GL_POLYGON_OFFSET_UNITS);
            this.webgl_constants.insert("RED_BITS", GL_RED_BITS);
            this.webgl_constants.insert("RENDERBUFFER", GL_RENDERBUFFER);
            this.webgl_constants.insert("RENDERBUFFER_ALPHA_SIZE", GL_RENDERBUFFER_ALPHA_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_BINDING", GL_RENDERBUFFER_BINDING);
            this.webgl_constants.insert("RENDERBUFFER_BLUE_SIZE", GL_RENDERBUFFER_BLUE_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_DEPTH_SIZE", GL_RENDERBUFFER_DEPTH_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_GREEN_SIZE", GL_RENDERBUFFER_GREEN_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_HEIGHT", GL_RENDERBUFFER_HEIGHT);
            this.webgl_constants.insert("RENDERBUFFER_INTERNAL_FORMAT", GL_RENDERBUFFER_INTERNAL_FORMAT);
            this.webgl_constants.insert("RENDERBUFFER_RED_SIZE", GL_RENDERBUFFER_RED_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_STENCIL_SIZE", GL_RENDERBUFFER_STENCIL_SIZE);
            this.webgl_constants.insert("RENDERBUFFER_WIDTH", GL_RENDERBUFFER_WIDTH);
            this.webgl_constants.insert("RENDERER", GL_RENDERER);
            this.webgl_constants.insert("REPEAT", GL_REPEAT);
            this.webgl_constants.insert("REPLACE", GL_REPLACE);
            this.webgl_constants.insert("RGB", GL_RGB);
            this.webgl_constants.insert("RGB565", GL_RGB565);
            this.webgl_constants.insert("RGB5_A1", GL_RGB5_A1);
            this.webgl_constants.insert("RGBA", GL_RGBA);
            this.webgl_constants.insert("RGBA4", GL_RGBA4);
            this.webgl_constants.insert("SAMPLER_2D", GL_SAMPLER_2D);
            this.webgl_constants.insert("SAMPLER_CUBE", GL_SAMPLER_CUBE);
            this.webgl_constants.insert("SAMPLES", GL_SAMPLES);
            this.webgl_constants.insert("SAMPLE_ALPHA_TO_COVERAGE", GL_SAMPLE_ALPHA_TO_COVERAGE);
            this.webgl_constants.insert("SAMPLE_BUFFERS", GL_SAMPLE_BUFFERS);
            this.webgl_constants.insert("SAMPLE_COVERAGE", GL_SAMPLE_COVERAGE);
            this.webgl_constants.insert("SAMPLE_COVERAGE_INVERT", GL_SAMPLE_COVERAGE_INVERT);
            this.webgl_constants.insert("SAMPLE_COVERAGE_VALUE", GL_SAMPLE_COVERAGE_VALUE);
            this.webgl_constants.insert("SCISSOR_BOX", GL_SCISSOR_BOX);
            this.webgl_constants.insert("SCISSOR_TEST", GL_SCISSOR_TEST);
            this.webgl_constants.insert("SHADER_TYPE", GL_SHADER_TYPE);
            this.webgl_constants.insert("SHADING_LANGUAGE_VERSION", GL_SHADING_LANGUAGE_VERSION);
            this.webgl_constants.insert("SHORT", GL_SHORT);
            this.webgl_constants.insert("SRC_ALPHA", GL_SRC_ALPHA);
            this.webgl_constants.insert("SRC_ALPHA_SATURATE", GL_SRC_ALPHA_SATURATE);
            this.webgl_constants.insert("SRC_COLOR", GL_SRC_COLOR);
            this.webgl_constants.insert("STATIC_DRAW", GL_STATIC_DRAW);
            this.webgl_constants.insert("STENCIL_ATTACHMENT", GL_STENCIL_ATTACHMENT);
            this.webgl_constants.insert("STENCIL_BACK_FAIL", GL_STENCIL_BACK_FAIL);
            this.webgl_constants.insert("STENCIL_BACK_FUNC", GL_STENCIL_BACK_FUNC);
            this.webgl_constants.insert("STENCIL_BACK_PASS_DEPTH_FAIL", GL_STENCIL_BACK_PASS_DEPTH_FAIL);
            this.webgl_constants.insert("STENCIL_BACK_PASS_DEPTH_PASS", GL_STENCIL_BACK_PASS_DEPTH_PASS);
            this.webgl_constants.insert("STENCIL_BACK_REF", GL_STENCIL_BACK_REF);
            this.webgl_constants.insert("STENCIL_BACK_VALUE_MASK", GL_STENCIL_BACK_VALUE_MASK);
            this.webgl_constants.insert("STENCIL_BACK_WRITEMASK", GL_STENCIL_BACK_WRITEMASK);
            this.webgl_constants.insert("STENCIL_BITS", GL_STENCIL_BITS);
            this.webgl_constants.insert("STENCIL_BUFFER_BIT", GL_STENCIL_BUFFER_BIT);
            this.webgl_constants.insert("STENCIL_CLEAR_VALUE", GL_STENCIL_CLEAR_VALUE);
            this.webgl_constants.insert("STENCIL_FAIL", GL_STENCIL_FAIL);
            this.webgl_constants.insert("STENCIL_FUNC", GL_STENCIL_FUNC);
            this.webgl_constants.insert("STENCIL_INDEX8", GL_STENCIL_INDEX8);
            this.webgl_constants.insert("STENCIL_PASS_DEPTH_FAIL", GL_STENCIL_PASS_DEPTH_FAIL);
            this.webgl_constants.insert("STENCIL_PASS_DEPTH_PASS", GL_STENCIL_PASS_DEPTH_PASS);
            this.webgl_constants.insert("STENCIL_REF", GL_STENCIL_REF);
            this.webgl_constants.insert("STENCIL_TEST", GL_STENCIL_TEST);
            this.webgl_constants.insert("STENCIL_VALUE_MASK", GL_STENCIL_VALUE_MASK);
            this.webgl_constants.insert("STENCIL_WRITEMASK", GL_STENCIL_WRITEMASK);
            this.webgl_constants.insert("STREAM_DRAW", GL_STREAM_DRAW);
            this.webgl_constants.insert("SUBPIXEL_BITS", GL_SUBPIXEL_BITS);
            this.webgl_constants.insert("TEXTURE", GL_TEXTURE);
            this.webgl_constants.insert("TEXTURE0", GL_TEXTURE0);
            this.webgl_constants.insert("TEXTURE1", GL_TEXTURE1);
            this.webgl_constants.insert("TEXTURE10", GL_TEXTURE10);
            this.webgl_constants.insert("TEXTURE11", GL_TEXTURE11);
            this.webgl_constants.insert("TEXTURE12", GL_TEXTURE12);
            this.webgl_constants.insert("TEXTURE13", GL_TEXTURE13);
            this.webgl_constants.insert("TEXTURE14", GL_TEXTURE14);
            this.webgl_constants.insert("TEXTURE15", GL_TEXTURE15);
            this.webgl_constants.insert("TEXTURE16", GL_TEXTURE16);
            this.webgl_constants.insert("TEXTURE17", GL_TEXTURE17);
            this.webgl_constants.insert("TEXTURE18", GL_TEXTURE18);
            this.webgl_constants.insert("TEXTURE19", GL_TEXTURE19);
            this.webgl_constants.insert("TEXTURE2", GL_TEXTURE2);
            this.webgl_constants.insert("TEXTURE20", GL_TEXTURE20);
            this.webgl_constants.insert("TEXTURE21", GL_TEXTURE21);
            this.webgl_constants.insert("TEXTURE22", GL_TEXTURE22);
            this.webgl_constants.insert("TEXTURE23", GL_TEXTURE23);
            this.webgl_constants.insert("TEXTURE24", GL_TEXTURE24);
            this.webgl_constants.insert("TEXTURE25", GL_TEXTURE25);
            this.webgl_constants.insert("TEXTURE26", GL_TEXTURE26);
            this.webgl_constants.insert("TEXTURE27", GL_TEXTURE27);
            this.webgl_constants.insert("TEXTURE28", GL_TEXTURE28);
            this.webgl_constants.insert("TEXTURE29", GL_TEXTURE29);
            this.webgl_constants.insert("TEXTURE3", GL_TEXTURE3);
            this.webgl_constants.insert("TEXTURE30", GL_TEXTURE30);
            this.webgl_constants.insert("TEXTURE31", GL_TEXTURE31);
            this.webgl_constants.insert("TEXTURE4", GL_TEXTURE4);
            this.webgl_constants.insert("TEXTURE5", GL_TEXTURE5);
            this.webgl_constants.insert("TEXTURE6", GL_TEXTURE6);
            this.webgl_constants.insert("TEXTURE7", GL_TEXTURE7);
            this.webgl_constants.insert("TEXTURE8", GL_TEXTURE8);
            this.webgl_constants.insert("TEXTURE9", GL_TEXTURE9);
            this.webgl_constants.insert("TEXTURE_2D", GL_TEXTURE_2D);
            this.webgl_constants.insert("TEXTURE_BINDING_2D", GL_TEXTURE_BINDING_2D);
            this.webgl_constants.insert("TEXTURE_BINDING_CUBE_MAP", GL_TEXTURE_BINDING_CUBE_MAP);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP", GL_TEXTURE_CUBE_MAP);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_X", GL_TEXTURE_CUBE_MAP_NEGATIVE_X);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_Y", GL_TEXTURE_CUBE_MAP_NEGATIVE_Y);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_Z", GL_TEXTURE_CUBE_MAP_NEGATIVE_Z);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_X", GL_TEXTURE_CUBE_MAP_POSITIVE_X);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_Y", GL_TEXTURE_CUBE_MAP_POSITIVE_Y);
            this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_Z", GL_TEXTURE_CUBE_MAP_POSITIVE_Z);
            this.webgl_constants.insert("TEXTURE_MAG_FILTER", GL_TEXTURE_MAG_FILTER);
            this.webgl_constants.insert("TEXTURE_MIN_FILTER", GL_TEXTURE_MIN_FILTER);
            this.webgl_constants.insert("TEXTURE_WRAP_S", GL_TEXTURE_WRAP_S);
            this.webgl_constants.insert("TEXTURE_WRAP_T", GL_TEXTURE_WRAP_T);
            this.webgl_constants.insert("TRIANGLES", GL_TRIANGLES);
            this.webgl_constants.insert("TRIANGLE_FAN", GL_TRIANGLE_FAN);
            this.webgl_constants.insert("TRIANGLE_STRIP", GL_TRIANGLE_STRIP);
            this.webgl_constants.insert("UNPACK_ALIGNMENT", GL_UNPACK_ALIGNMENT);
            this.webgl_constants.insert("UNSIGNED_BYTE", GL_UNSIGNED_BYTE);
            this.webgl_constants.insert("UNSIGNED_INT", GL_UNSIGNED_INT);
            this.webgl_constants.insert("UNSIGNED_SHORT", GL_UNSIGNED_SHORT);
            this.webgl_constants.insert("UNSIGNED_SHORT_4_4_4_4", GL_UNSIGNED_SHORT_4_4_4_4);
            this.webgl_constants.insert("UNSIGNED_SHORT_5_5_5_1", GL_UNSIGNED_SHORT_5_5_5_1);
            this.webgl_constants.insert("UNSIGNED_SHORT_5_6_5", GL_UNSIGNED_SHORT_5_6_5);
            this.webgl_constants.insert("VALIDATE_STATUS", GL_VALIDATE_STATUS);
            this.webgl_constants.insert("VENDOR", GL_VENDOR);
            this.webgl_constants.insert("VERSION", GL_VERSION);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_BUFFER_BINDING", GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_ENABLED", GL_VERTEX_ATTRIB_ARRAY_ENABLED);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_NORMALIZED", GL_VERTEX_ATTRIB_ARRAY_NORMALIZED);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_POINTER", GL_VERTEX_ATTRIB_ARRAY_POINTER);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_SIZE", GL_VERTEX_ATTRIB_ARRAY_SIZE);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_STRIDE", GL_VERTEX_ATTRIB_ARRAY_STRIDE);
            this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_TYPE", GL_VERTEX_ATTRIB_ARRAY_TYPE);
            this.webgl_constants.insert("VERTEX_SHADER", GL_VERTEX_SHADER);
            this.webgl_constants.insert("VIEWPORT", GL_VIEWPORT);
            this.webgl_constants.insert("ZERO", GL_ZERO);           
        }

        public HashTable<string, int> get_webgl_constants()  {
            return this.webgl_constants;
        }

        public void _vertexAttribDivisor(uint index, uint divisor) {
            glVertexAttribDivisor(index, divisor);
        }

        public void activeTexture(int texture) {
            glActiveTexture(texture);
        }

        public void attachShader(/*WebGLProgram*/ uint program, /*WebGLShader*/ uint shader) {
            glAttachShader(program, shader);
        }
        
        public void bindAttribLocation(/*WebGLProgram*/ uint program, uint index, string name) {
            glBindAttribLocation(program, index, name);
        }
        
        public void bindBuffer(uint target, /*WebGLBuffer*/ uint buffer) {
            glBindBuffer((GL.GLenum) target, (GLuint) buffer);
        }

        public void bindFramebuffer(int target, /*WebGLFramebuffer*/ uint framebuffer) {
            glBindFramebuffer(target, framebuffer);
        }

        public void bindRenderbuffer(int target, /*WebGLFramebuffer*/ uint renderbuffer) {
            glBindRenderbuffer(target, renderbuffer);
        }

        public void bindTexture(int target, /*WebGLTexture*/ uint texture) {
            glBindTexture(target, texture);
        }

        public void blendColor(float red, float green, float blue, float alpha) {
            glBlendColor(red, green, blue, alpha);
        }

        public void blendEquation(int mode) {
            glBlendEquation(mode);
        }

        public void blendEquationSeparate(int modeRGB, int modeAlpha) {
            glBlendEquationSeparate(modeRGB, modeAlpha);
        }

        public void blendFunc(int sfactor, int dfactor) {
            glBlendFunc(sfactor, dfactor);
        }

        public void blendFuncSeparate(int srcRGB, int dstRGB, int srcAlpha, int dstAlpha) {
            glBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
        }

        public uint checkFramebufferStatus(uint target) {
            return glCheckFramebufferStatus(target);
        }

        public void clear(uint mask) {
            glClear(mask);
        }

        public void clearColor(float red, float green, float blue, float alpha) {
            glClearColor(red, green, blue, alpha);
        }

        public void clearDepth(float depth) {
            glClearDepthf(depth);
        }

        public void clearStencil(int s) {
            glClearStencil(s);
        }

        public void colorMask(bool red, bool green, bool blue, bool alpha) {
            glColorMask((uint8) red, (uint8) green, (uint8) blue, (uint8) alpha);
        }

        public void compileShader(/*WebGLShader*/ uint shader) {
            glCompileShader(shader);
        }

        public void copyTexImage2D(int target, int level, int internalFormat, int x, int y, int width, int height, int border) {
            glCopyTexImage2D(target, level, internalFormat, x, y, width, height, border);
        }

        public void copyTexSubImage2D(int target, int level, int xoffset, int yoffset, int x, int y, int width, int height) {
            glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
        }

        public /*WebGLBuffer*/ uint createBuffer() {
            uint[] buffers = new uint[1]; 
            glGenBuffers(1, buffers);
            return buffers[0];
        }

        public /*WebGLFramebuffer*/ uint createFramebuffer() {
            uint[] frameBuffers = new uint[1]; 
            glGenFramebuffers(1, frameBuffers);
            return frameBuffers[0];
        }

        public /*WebGLProgram*/ uint createProgram() {
            return glCreateProgram();
        }

        public /*WebGLFramebuffer*/ uint createRenderbuffer() {
            /*WebGLFramebuffer*/ uint[] renderbuffer = new uint[1];
            glGenRenderbuffers(1, renderbuffer);
            return renderbuffer[0];
        }

        public uint createShader(int type) {
            return glCreateShader(type);
        }

        public /*WebGLTexture*/ uint createTexture() {
            // https://github.com/smx-smx/openSage/blob/518dc958156acf2f8bf58f29a35bd2aa89fd1355/src/GLEventHandler.vala#L20
            /*WebGLTexture*/ uint[] textures = new uint[1];
            glGenTextures(1, textures);
            return textures[0];
        }

        public void cullFace(int mode) {
            glCullFace(mode);
        }

        public void deleteBuffer(/*WebGLBuffer*/ uint buffer) {
            uint[] buffers = new uint[1]{buffer};
            glDeleteBuffers(1, buffers);
        }

        public void deleteFramebuffer(/*WebGLFramebuffer*/ uint framebuffer) {
            uint[] framebuffers = new uint[1]{framebuffer};
            glDeleteFramebuffers(1, framebuffers);
        }

        public void deleteProgram(/*WebGLProgram*/ uint program) {
            glDeleteProgram(program);
        }

        public void deleteRenderbuffer(/*WebGLFramebuffer*/ uint renderbuffer) {
            uint[] renderbuffers = new uint[1]{renderbuffer};
            glDeleteRenderbuffers(1, renderbuffers);
        }

        public void deleteShader(/*WebGLShader*/ uint shader) {
            glDeleteShader(shader);
        }

        public void deleteTexture(/*WebGLTexture*/ uint texture) {
            uint[] textures = new uint[1]{texture};
            glDeleteTextures(1, textures);
        }

        public void depthFunc(int func) {
            glDepthFunc(func);
        }

        public void depthMask(bool flag) {
            glDepthMask((GLboolean) flag);
        }

        public void depthRange(float zNear, float zFar) {
            glDepthRangef(zNear, zFar);
        }

        //  public void destroy() {
        //      dispose();
        //  }

        public void detachShader(/*WebGLProgram*/ uint program, /*WebGLShader*/ uint shader) {
            glDetachShader(program, shader);
        }

        public void disable(int cap) {
            glDisable(cap);
        }

        public void disableVertexAttribArray(uint index) {
            glDisableVertexAttribArray(index);
        }

        public void drawArrays(int mode, int first, int count) {
            glDrawArrays(mode, first, count);
        }

        public void _drawArraysInstanced(int mode, int first, int count, int instancecount) {
            glDrawArraysInstanced(mode, first, count, instancecount);
        }

        public void drawElements(int mode, int count, int type, size_t offset) {
            size_t[] offsets = new size_t[1]{offset};
            glDrawElements(mode, count, type, (GL.GLvoid[]) offsets);
        }

        public void _drawElementsInstanced(int mode, int count, int type, size_t offset, int instancecount) {
            size_t[] offsets = new size_t[1]{offset};
            glDrawElementsInstanced(mode, count, type, (GL.GLvoid[]) offsets, instancecount);
        }

        public void enable(int cap) {
            glEnable(cap);
        }

        public void enableVertexAttribArray(uint index) {
            glEnableVertexAttribArray(index);
        }

        public void finish() {
            glFinish();
        }

        public void flush() {
            glFlush();
        }

        public void framebufferRenderbuffer(int target, int attachment, int renderbufferTarget, /*WebGLFramebuffer*/ uint renderbuffer) {
            glFramebufferRenderbuffer(target, attachment, renderbufferTarget, renderbuffer);
        }

        public void framebufferTexture2D(int target, int attachment, int textarget, /*WebGLTexture*/ uint texture, int level) {
            glFramebufferTexture2D(target, attachment, textarget, texture, level);
        }

        public void frontFace(int mode) {
            glFrontFace(mode);
        }

        public void generateMipmap(int target) {
            glGenerateMipmap(target);
        }

        public WebGLActiveInfo getActiveAttrib(/*WebGLProgram*/ uint program, uint index) {
            int[] bufSize = new int[1];
            // TODO
            GLsizei[] bufLength = new GLsizei[1];
            // TODO
            int[] size = new int[1];
            // TODO
            GLenum[] type = new GLenum[1];



            glGetProgramiv(program, GL_ACTIVE_ATTRIBUTE_MAX_LENGTH, bufSize);
            uint8[] name = new uint8[bufSize[0] + 1];
            glGetActiveAttrib(program, index, bufSize[0], bufLength, size, type, name);

            var res = WebGLActiveInfo() {
                name = (string) name,
                size = (int) size,
                type = (int) type,
            };

            return res;
        }

        public WebGLActiveInfo getActiveUniform(/*WebGLProgram*/ uint program, uint index)
        {
            int[] bufSize = new int[1];
            // TODO
            GLsizei[] bufLength = new GLsizei[1];
            // TODO
            int[] size = new int[1];
            // TODO
            GLenum[] type = new GLenum[1];

            glGetProgramiv(program, GL_ACTIVE_UNIFORM_MAX_LENGTH, bufSize);
            GLubyte[] name = new GLubyte[bufSize[0] + 1];
            glGetActiveUniform(program, index, bufSize[0], bufLength, size, type, name);

            var res = WebGLActiveInfo() {
                name = (string) name,
                size = (int) size,
                type = (int) type,
            };

            return res;
        }

        public /*WebGLShader*/ uint[] getAttachedShaders(/*WebGLProgram*/ uint program) {
            int[] bufSize = new int[1];
            // TODO
            GLsizei[] bufLength = new GLsizei[1];

            glGetProgramiv(program, GL_ATTACHED_SHADERS, bufSize);
            GLuint[] buf = new GLuint[bufSize[0] + 1]; //  malloc((bufSize + 1) * sizeof(GLuint));
            glGetAttachedShaders(program, bufSize[0], bufLength, buf);

            if (bufLength[0] < bufSize[0]) {
                buf.resize(bufLength[0] + 1);
            }
            buf[bufLength[0]] = 0;
            return buf;
        }

        public int getAttribLocation(/*WebGLProgram*/ uint program, string name) {
            return glGetAttribLocation(program, name);
        }

        public int[] getBufferParameteriv(int target, int pname) {
            // TODO this is not an array?
            int[] result = new int[0];
            glGetBufferParameteriv(target, pname, result);
            return result;
        }

        public int getError() {
            GLenum error = glGetError();
            if (this.lastError != GL_NO_ERROR) {
              error = lastError;
            }
            lastError = GL_NO_ERROR;
            return (int) error;
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L164
        public void setError(int error) {
            if (error == GL_NO_ERROR || this.lastError != GL_NO_ERROR) {
                return;
            }
            GLenum prevError = this.getError();
            if (prevError == GL_NO_ERROR) {
                lastError = error;
            }
        }

        public int getFramebufferAttachmentParameter(
            int target,
            int attachment,
            int pname)
        {
            int[] result = new int[1];
            glGetFramebufferAttachmentParameteriv(target, attachment, pname, result);
            return result[0];
        }

        // Credits
        // * https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1745
        // * https://github.com/mikeseven/node-webgl/blob/a918e74acc7860db1bb63029934e8f54a2730ce2/src/webgl.cc#L1502
        public Variant getParameterx(int pname) {
            switch(pname) {
                case UNPACK_FLIP_Y_WEBGL: {
                    return new Variant("b", unpack_flip_y);
                }
                
                case UNPACK_PREMULTIPLY_ALPHA_WEBGL: {
                    return new Variant("b", unpack_premultiply_alpha);
                }
            
                case UNPACK_COLORSPACE_CONVERSION_WEBGL: {
                    return new Variant("i", unpack_colorspace_conversion);
                }

                case GL_BLEND:
                case GL_CULL_FACE:
                case GL_DEPTH_TEST:
                case GL_DEPTH_WRITEMASK:
                case GL_DITHER:
                case GL_POLYGON_OFFSET_FILL:
                case GL_SAMPLE_COVERAGE_INVERT:
                case GL_SCISSOR_TEST:
                case GL_STENCIL_TEST:
                {
                    GLboolean[] params = new GLboolean[1];
                    glGetBooleanv(pname, params);
                    return new Variant("b", (bool) params[0]);
                }
            
                case GL_DEPTH_CLEAR_VALUE:
                case GL_LINE_WIDTH:
                case GL_POLYGON_OFFSET_FACTOR:
                case GL_POLYGON_OFFSET_UNITS:
                case GL_SAMPLE_COVERAGE_VALUE:
                case MAX_TEXTURE_MAX_ANISOTROPY_EXT:
                {
                    float[] params = new float[1];
                    glGetFloatv(pname, params);
                    return new Variant("f", (float) params[0]);
                }
            
                case GL_RENDERER:
                case GL_SHADING_LANGUAGE_VERSION:
                case GL_VENDOR:
                case GL_VERSION:
                case GL_EXTENSIONS:
                {
                    var str = glGetString(pname);
                    return new Variant("s", str);
                }
            
                case GL_MAX_VIEWPORT_DIMS:
                {
                    int[] params = new int[2];
                    glGetIntegerv(pname, params);
                    return new Variant("ai", (int[]) params);
                }
            
                case GL_SCISSOR_BOX:
                case GL_VIEWPORT:
                {
                    int[] params = new int[4];
                    glGetIntegerv(pname, params);
                    return new Variant("ai", (int[]) params);
                }
            
                case GL_ALIASED_LINE_WIDTH_RANGE:
                case GL_ALIASED_POINT_SIZE_RANGE:
                case GL_DEPTH_RANGE:
                {
                    float[] params = new float[2];
                    glGetFloatv(pname, params);
                    return new Variant("af", (float[]) params);
                }
            
                case GL_BLEND_COLOR:
                case GL_COLOR_CLEAR_VALUE:
                {
                    float[] params = new float[4];
                    glGetFloatv(pname, params);        
                    return new Variant("af", (float[]) params);
                }
            
                case GL_COLOR_WRITEMASK:
                {
                    GLboolean[] params = new GLboolean[4];
                    glGetBooleanv(pname, params);
                    return new Variant("ab", (bool[]) params);
                }
            
                default:
                {
                    int[] params = new int[1];
                    glGetIntegerv(pname, params);
                    return new Variant("i", (int) params[0]);
                }
            }
        }

        public bool getParameterb(int pname) {
            GLboolean[] result = new GLboolean[1];
            glGetBooleanv(pname, result);
            return (bool) result[0];
        }

        public bool[] getParameterbv(int pname, int resultSize) {
            GLboolean[] data = new GLboolean[resultSize];
            glGetBooleanv(pname, data);
            return (bool[]) data;
        }

        public float getParameterf(int pname) {
            float[] data = new float[1];
            glGetFloatv(pname, data);
            return data[0];
        }

        public float[] getParameterfv(int pname, int resultSize) {
            float[] data = new float[resultSize];
            glGetFloatv(pname, data);
            return data;
        }

        public int getParameteri(int pname) {
            int[] data = new int[1];
            glGetIntegerv(pname, data);
            return data[0];
        }

        public int[] getParameteriv(int pname, int resultSize) {
            // gpointer data = malloc(resultSize);
            int[] data = new int[resultSize];
            glGetIntegerv(pname, data);
            return data;
        }

        public string getProgramInfoLog(/*WebGLProgram*/ uint program) {
            GL.GLint[] params = new GL.GLint[1];
            // TODO bufLength shoult not be an array?!
            GLsizei[] bufLength = new GLsizei[1];
            glGetProgramiv(program, GL_INFO_LOG_LENGTH, params);
            int bufSize = params[0];
            GLubyte[] infoLog = new GLubyte[bufSize + 1];
            glGetProgramInfoLog(program, bufSize, bufLength, infoLog);
            if (bufLength[0] < bufSize) {
                infoLog.resize(bufLength[0] + 1);
            }
            infoLog[bufLength[0]] = 0;
            return (string) infoLog;
        }

        public int getProgramParameter(/*WebGLProgram*/ uint program, int pname) {
            GL.GLint[] params = new GL.GLint[1];
            glGetProgramiv(program, pname, params);
            int result = params[0];
            return result;
        }

        public int getRenderbufferParameter(int target, int pname) {
            int[] result = new int[1];
            glGetRenderbufferParameteriv(target, pname, result);
            return result[0];
        }

        public string getShaderInfoLog(/*WebGLShader*/ uint shader) {
            int[] bufSize = new int[1];
            GLsizei[] bufLength = new GLsizei[1];
            glGetShaderiv(shader, GL_INFO_LOG_LENGTH, bufSize);
            // char *buf = malloc((bufSize + 1) * sizeof(char));
            GLubyte[] buf = new GLubyte[bufSize[0] + 1];
            glGetShaderInfoLog(shader, bufSize[0], bufLength, buf);
            if (bufLength[0] < bufSize[0])
            {
                // buf = realloc(buf, (bufLength + 1) * sizeof(char));
                buf.resize(bufLength[0] + 1);
            }
            buf[bufLength[0]] = 0;
            return (string) buf;
        }

        public int getShaderParameter(/*WebGLShader*/ uint shader, int pname) {
            int[] result = new int[1];
            glGetShaderiv(shader, pname, result);
            return result[0];
        }

        public WebGLShaderPrecisionFormat getShaderPrecisionFormat(int shadertype, int precisiontype) {
            int[] precision = new int[2];
            int[] range = new int[2];

            glGetShaderPrecisionFormat(shadertype, precisiontype, range, precision);

            var res = WebGLShaderPrecisionFormat() {
                precision = (int) precision[0],
                rangeMin = (int) range[0],
                rangeMax = (int) range[1],
            };
            return res;
        }

        public string getShaderSource(/*WebGLShader*/ uint shader) {
            int[] bufSize = new int[1];
            GLsizei[] bufLength = new GLsizei[1];
            glGetShaderiv(shader, GL_SHADER_SOURCE_LENGTH, bufSize);
            GLubyte[] buf = new GLubyte[bufSize[0] + 1];
            glGetShaderSource(shader, bufSize[0], bufLength, buf);
            if (bufLength[0] < bufSize[0]) {
                buf.resize(bufLength[0] + 1);
            }
            buf[bufLength[0]] = 0;
            return (string) buf;
        }

        public string getString(int pname) {
            return glGetString(pname);
        }

        public string[] getSupportedExtensions() {
            string result = glGetString(GL_EXTENSIONS);
            string[] sp = result.split(" ", 0);
            // char **sp = strsplit((const char *) result, " ", 0);
            return sp;
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1637
        public Variant getTexParameterx(int target, int pname) {
            if (pname == 0x84FE /* GL_TEXTURE_MAX_ANISOTROPY_EXT */) {
                float[] param_value = new float[1];
                glGetTexParameterfv(target, pname, param_value);
                return new Variant("f", param_value[0]);
            } else {
                int[] param_value = new int[1];
                glGetTexParameteriv(target, pname, param_value);
                return new Variant("i", param_value[0]);
            }
        }

        public float getTexParameterfv(int target, int pname) {
            float[] result = new float[1];
            glGetTexParameterfv(target, pname, result);
            return result[0];
        }

        public int getTexParameteriv(int target, int pname) {
            int[] result = new int[0];
            glGetTexParameteriv(target, pname, result);
            return result[0];
        }

        public /*WebGLUniformLocation*/ int getUniformLocation(/*WebGLProgram*/ uint program, string name) {
            print("getUniformLocation %u %s", program, name);
            return glGetUniformLocation(program, name);
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1976
        public float[] getUniform(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
            float[] result = new float[16];
            glGetUniformfv(program, location, result);
            return result;
        }
        
        public float[] getUniformf(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
            float[] result = new float[0];
            glGetUniformfv(program, location, result);
            return result;
        }

        public float[] getUniformfv(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location, int resultSize) {
            float[] data = new float[resultSize];
            glGetUniformfv(program, location, data);
            return data;
        }

        public int[] getUniformi(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
            int[] result = new int[0];
            glGetUniformiv(program, location, result);
            return result;
        }

        public int[] getUniformiv(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location, int resultSize) {
            int[] data = new int[resultSize];
            glGetUniformiv(program, location, data);
            return data;
        }

        public intptr getVertexAttribOffset(uint index, int pname) {
            long[] result = new long[1];
            // TODO result should not be an array?!
            glGetVertexAttribPointerv(index, pname, (GL.GLvoid[]) result);
            return (intptr) result[0];
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1993
        public Variant getVertexAttrib(uint index, int pname) throws TypeError {
            int[] value = new int[1];
            switch (pname) {
                case GL_VERTEX_ATTRIB_ARRAY_ENABLED:
                case GL_VERTEX_ATTRIB_ARRAY_NORMALIZED: {
                    glGetVertexAttribiv(index, pname, value);
                    return new Variant("b", value[0] != 0);
                }
            
                case GL_VERTEX_ATTRIB_ARRAY_SIZE:
                case GL_VERTEX_ATTRIB_ARRAY_STRIDE:
                case GL_VERTEX_ATTRIB_ARRAY_TYPE:
                case GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: {
                    glGetVertexAttribiv(index, pname, value);
                    return new Variant("i", value[0]);
                }
            
                case GL_CURRENT_VERTEX_ATTRIB: {
                    float[] vextex_attribs = new float[4];
                    glGetVertexAttribfv(index, pname, vextex_attribs);
                    return new Variant("af", vextex_attribs);
                }
                default: {
                    throw new TypeError.CODE("GL_INVALID_ENUM %i", GL_INVALID_ENUM);
                }
            }
        }

        public float[] getVertexAttribf(uint index, int pname) {
            float[] result = new float[0];
            glGetVertexAttribfv(index, pname, result);
            return result;
        }

        public float[] getVertexAttribfv(uint index, int pname, int resultSize) {
            float[] data = new float[resultSize];
            glGetVertexAttribfv(index, pname, data);
            return data;
        }

        public int[] getVertexAttribi(uint index, int pname) {
            int[] result = new int[0];
            glGetVertexAttribiv(index, pname, result);
            return result;
        }

        public void hint(int target, int mode) {
            glHint(target, mode);
        }

        public bool isBuffer(/*WebGLBuffer*/ uint buffer) {
            return (bool) glIsBuffer(buffer);
        }

        public bool isEnabled(int cap) {
            return (bool) glIsEnabled(cap);
        }

        public bool isFramebuffer(/*WebGLFramebuffer*/ uint framebuffer) {
            return (bool)  glIsFramebuffer(framebuffer);
        }

        public bool isProgram(/*WebGLProgram*/ uint program) {
            return (bool) glIsProgram(program);
        }

        public bool isRenderbuffer(/*WebGLFramebuffer*/ uint renderbuffer) {
            return (bool) glIsRenderbuffer(renderbuffer);
        }

        public bool isShader(/*WebGLShader*/ uint shader) {
            return (bool) glIsShader(shader);
        }

        public bool isTexture(/*WebGLTexture*/ uint texture) {
            return (bool) glIsTexture(texture);
        }

        public void lineWidth(float width) {
            glLineWidth(width);
        }

        public void linkProgram(/*WebGLProgram*/ uint program) {
            glLinkProgram(program);
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L374
        public void pixelStorei(int pname, int param) {

            // Handle WebGL specific extensions
            switch(pname) {
                case UNPACK_FLIP_Y_WEBGL:
                this.unpack_flip_y = param != 0;
                break;

                case UNPACK_PREMULTIPLY_ALPHA_WEBGL:
                this.unpack_premultiply_alpha = param != 0;
                break;

                case UNPACK_COLORSPACE_CONVERSION_WEBGL:
                this.unpack_colorspace_conversion = param;
                break;

                case GL_UNPACK_ALIGNMENT:
                this.unpack_alignment = param;
                glPixelStorei(pname, param);
                break;

                case MAX_DRAW_BUFFERS_WEBGL:
                glPixelStorei(pname, param);
                break;

                default:
                glPixelStorei(pname, param);
                break;
            }

        }

        public void polygonOffset(float factor, float units) {
            glPolygonOffset(factor, units);
        }

        public void renderbufferStorage(int target, int internalFormat, int width, int height) {
            glRenderbufferStorage(target, internalFormat, width, height);
        }

        public void sampleCoverage(float value, bool invert) {
            glSampleCoverage(value, (GLboolean) invert);
        }

        public void scissor(int x, int y, int width, int height) {
            glScissor(x, y, width, height);
        }

        public void shaderSource(/*WebGLShader*/ uint shader, string source) {
            string[] sources = new string[]{ source };
            int[] length = new int[1]{ source.length };
            glShaderSource(shader, 1, sources, length);
        }

        public void stencilFunc(int func, int ref_, uint mask) {
            glStencilFunc(func, ref_, mask);
        }

        public void stencilFuncSeparate(int face, int func, int ref_, uint mask) {
            glStencilFuncSeparate(face, func, ref_, mask);
        }

        public void stencilMask(uint mask) {
            glStencilMask(mask);
        }

        public void stencilMaskSeparate(int face, uint mask) {
            glStencilMaskSeparate(face, mask);
        }

        public void stencilOp(int fail, int zfail, int zpass) {
            glStencilOp(fail, zfail, zpass);
        }

        public void stencilOpSeparate(int face, int fail, int zfail, int zpass) {
            glStencilOpSeparate(face, fail, zfail, zpass);
        }

        public void texParameterf(int target, int pname, float param) {
            glTexParameterf(target, pname, param);
        }

        public void texParameteri(int target, int pname, int param) {
            glTexParameteri(target, pname, param);
        }

        public void uniform1f(/*WebGLUniformLocation*/ int location, float x) {
            glUniform1f(location, x);
        }

        public void uniform1i(/*WebGLUniformLocation*/ int location, int x) {
            glUniform1i(location, x);
        }

        public void uniform2f(/*WebGLUniformLocation*/ int location, float x, float y) {
            glUniform2f(location, x, y);
        }

        public void uniform2i(/*WebGLUniformLocation*/ int location, int x, int y) {
            glUniform2i(location, x, y);
        }

        public void uniform3f(/*WebGLUniformLocation*/ int location, float x, float y, float z) {
            glUniform3f(location, x, y, z);
        }

        public void uniform3i(/*WebGLUniformLocation*/ int location, int x, int y, int z) {
            glUniform3i(location, x, y, z);
        }

        public void uniform4f(/*WebGLUniformLocation*/ int location, float x, float y, float z, float w) {
            glUniform4f(location, x, y, z, w);
        }

        public void uniform4i(/*WebGLUniformLocation*/ int location, int x, int y, int z, int w) {
            glUniform4i(location, x, y, z, w);
        }

        public void useProgram(/*WebGLProgram*/ uint program) {
            glUseProgram(program);
        }

        public void validateProgram(/*WebGLProgram*/ uint program) {
            glValidateProgram(program);
        }

        public void vertexAttrib1f(uint index, float x) {
            glVertexAttrib1f(index, x);
        }

        public void vertexAttrib1fv(uint index, float[] v) {
            glVertexAttrib1fv(index, v);
        }

        public void vertexAttrib2f(uint index, float x, float y) {
            glVertexAttrib2f(index, x, y);
        }

        public void vertexAttrib2fv(uint index, float[] values) {
            glVertexAttrib2fv(index, values);
        }
        
        public void vertexAttrib3f(uint index, float x, float y, float z) {
            glVertexAttrib3f(index, x, y, z);
        }

        public void vertexAttrib3fv(uint index, float[] values) {
            glVertexAttrib3fv(index, values);
        }

        public void vertexAttrib4f(uint index, float x, float y, float z, float w) {
            glVertexAttrib4f(index, x, y, z, w);
        }

        public void vertexAttrib4fv(uint index, float[] values) {
            glVertexAttrib4fv(index, values);
        }

        public void vertexAttribPointer(uint index, int size, int type, bool _normalized, int stride, long offset) {
            uint8 normalized = (uint8) _normalized;
            // TODO offset should not be an array?!
            glVertexAttribPointer(index, size, type, normalized, stride, (void*) offset);
        }

        public void viewport(int x, int y, int width, int height) {
            glViewport(x, y, width, height);
        }

    }
}
