
namespace Gwebgl {

    using GLES2;

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
            this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_DIMENSIONS", GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS);
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

        // TODO
        //  public void vertexAttribDivisor(uint index, uint divisor) {
        //      glVertexAttribDivisor(index, divisor);
        //  }

        public void activeTexture(GLenum texture) {
            glActiveTexture(texture);
        }

        public void attachShader(/*WebGLProgram*/ uint program, /*WebGLShader*/ uint shader) {
            glAttachShader(program, shader);
        }
        
        public void bindAttribLocation(/*WebGLProgram*/ uint program, uint index, string name) {
            glBindAttribLocation(program, index, name);
        }
        
        public void bindBuffer(GLenum target, /*WebGLBuffer*/ uint? buffer) {
            if (buffer != null) {
                glBindBuffer(target, buffer);
            }
        }

        public void bindFramebuffer(GLenum target, /*WebGLFramebuffer*/ uint? framebuffer) {
            if (framebuffer != null) {
                glBindFramebuffer(target, framebuffer);
            }
        }

        public void bindRenderbuffer(GLenum target, /*WebGLFramebuffer*/ uint? renderbuffer) {
            if (renderbuffer != null) {
                glBindRenderbuffer(target, renderbuffer);
            }
        }

        public void bindTexture(GLenum target, /*WebGLTexture*/ uint? texture) {
            if (texture != null) {
                glBindTexture(target, texture);
            }
        }

        public void blendColor(float red, float green, float blue, float alpha) {
            glBlendColor(red, green, blue, alpha);
        }

        public void blendEquation(GLenum mode) {
            glBlendEquation(mode);
        }

        public void blendEquationSeparate(GLenum modeRGB, GLenum modeAlpha) {
            glBlendEquationSeparate(modeRGB, modeAlpha);
        }

        public void blendFunc(GLenum sfactor, GLenum dfactor) {
            glBlendFunc(sfactor, dfactor);
        }

        public void blendFuncSeparate(GLenum srcRGB, GLenum dstRGB, GLenum srcAlpha, GLenum dstAlpha) {
            glBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
        }

        public GLenum checkFramebufferStatus(GLenum target) {
            return glCheckFramebufferStatus(target);
        }

        public void clear(GLbitfield mask) {
            glClear(mask);
        }

        public void clearColor(GLclampf red, GLclampf green, GLclampf blue, GLclampf alpha) {
            glClearColor(red, green, blue, alpha);
        }

        public void clearDepth(GLclampf depth) {
            glClearDepthf(depth);
        }

        public void clearStencil(GLint s) {
            glClearStencil(s);
        }

        public void colorMask(GLboolean red, GLboolean green, GLboolean blue, GLboolean alpha) {
            glColorMask(red, green, blue, alpha);
        }

        public void compileShader(/*WebGLShader*/ uint shader) {
            glCompileShader(shader);
        }

        public void copyTexImage2D(GLenum target, GLint level, GLenum  internalformat, GLint x, GLint y, GLint width, GLint height, GLint border) {
            glCopyTexImage2D(target, level, internalformat, x, y, width, height, border);
        }

        public void copyTexSubImage2D(GLenum target, GLint level, GLint xoffset, GLint yoffset, GLint x, GLint y, GLint width, GLint height) {
            glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
        }

        public /*WebGLBuffer*/ uint createBuffer() {
            uint? buffer = 1;
            glGenBuffers(1, &buffer);
            return buffer;
        }

        public /*WebGLFramebuffer*/ uint createFramebuffer() {
            uint? frameBuffer = 1;
            glGenFramebuffers(1, &frameBuffer);
            return frameBuffer;
        }

        public /*WebGLProgram*/ uint createProgram() {
            return glCreateProgram();
        }

        public /*WebGLFramebuffer*/ uint createRenderbuffer() {
            /*WebGLFramebuffer*/ uint renderbuffer = 1;
            glGenRenderbuffers(1, &renderbuffer);
            return renderbuffer;
        }

        public GLuint createShader(GLenum type) {
            return glCreateShader(type);
        }

        public /*WebGLTexture*/ uint createTexture() {
            // https://github.com/smx-smx/openSage/blob/518dc958156acf2f8bf58f29a35bd2aa89fd1355/src/GLEventHandler.vala#L20
            /*WebGLTexture*/ uint textures = 1;
            glGenTextures(1, &textures);
            return textures;
        }

        public void cullFace(GLenum mode) {
            glCullFace(mode);
        }

        public void deleteBuffer(/*WebGLBuffer*/ uint? buffer) {
            if (buffer != null) {
                glDeleteBuffers(1, &buffer);
            }
        }

        public void deleteFramebuffer(/*WebGLFramebuffer*/ uint? framebuffer) {
            if (framebuffer != null) {
                glDeleteFramebuffers(1, &framebuffer);
            }
        }

        public void deleteProgram(/*WebGLProgram*/ uint? program) {
            if (program != null) {
                glDeleteProgram(program);
            }
        }

        public void deleteRenderbuffer(/*WebGLFramebuffer*/ uint? renderbuffers) {
            if (renderbuffers != null) {
                glDeleteRenderbuffers(1, &renderbuffers);
            }
        }

        public void deleteShader(/*WebGLShader*/ uint? shader) {
            if (shader != null) {
                glDeleteShader(shader);
            }
        }

        public void deleteTexture(/*WebGLTexture*/ uint? texture) {
            if(texture != null) {
                glDeleteTextures(1, &texture);
            }
        }

        public void depthFunc(GLenum func) {
            glDepthFunc(func);
        }

        public void depthMask(GLboolean flag) {
            glDepthMask(flag);
        }

        public void depthRange(float zNear, float zFar) {
            glDepthRangef(zNear, zFar);
        }

        public void detachShader(/*WebGLProgram*/ uint program, /*WebGLShader*/ uint shader) {
            glDetachShader(program, shader);
        }

        public void disable(GLenum cap) {
            glDisable(cap);
        }

        public void disableVertexAttribArray(GLuint index) {
            glDisableVertexAttribArray(index);
        }

        public void drawArrays(GLenum mode, GLint first, GLint count) {
            glDrawArrays(mode, first, count);
        }

        public void drawElements(GLenum mode, GLsizei count, GLenum type, GLintptr offset) {
            glDrawElements(mode, count, type, (GLvoid*) offset);
        }

        public void enable(GLenum cap) {
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

        public void framebufferRenderbuffer(GLenum target, GLenum attachment, GLenum renderbuffertarget, /*WebGLFramebuffer*/ uint? renderbuffer) {
            if(renderbuffer == null) {
                return;
            }
            glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer);
        }

        public void framebufferTexture2D(GLenum target, GLenum attachment, GLenum textarget, /*WebGLTexture*/ uint? texture, GLint level) {
            if (texture == null) {
                return;
            }
            glFramebufferTexture2D(target, attachment, textarget, texture, level);
        }

        public void frontFace(GLenum mode) {
            glFrontFace(mode);
        }

        public void generateMipmap(GLenum target) {
            glGenerateMipmap(target);
        }

        public WebGLActiveInfo getActiveAttrib(/*WebGLProgram*/ uint program, uint index) {
            GLint bufSize = 0;
            GLsizei bufLength = 0;
            GLint size = 0;
            GLenum? type = 0;
            GLchar[] name = new GLchar[bufSize + 1];


            glGetProgramiv(program, GL_ACTIVE_ATTRIBUTE_MAX_LENGTH, &bufSize);
            glGetActiveAttrib(program, index, bufSize, &bufLength, &size, &type, name);

            var res = WebGLActiveInfo() {
                name = (string) name,
                size = (int) size,
                type = (int) type,
            };

            return res;
        }

        public WebGLActiveInfo getActiveUniform(/*WebGLProgram*/ uint program, uint index)
        {
            GLint bufSize = 0;
            GLsizei bufLength = 0;
            GLint size = 0;
            GLenum? type = 0;
            GLchar[] name = new GLchar[bufSize + 1];

            glGetProgramiv(program, GL_ACTIVE_UNIFORM_MAX_LENGTH, &bufSize);
            glGetActiveUniform(program, index, (GLsizei) bufSize, &bufLength, &size, &type, name);

            var res = WebGLActiveInfo() {
                name = (string) name,
                size = (int) size,
                type = (int) type,
            };

            return res;
        }

        public /*WebGLShader*/ uint[] getAttachedShaders(/*WebGLProgram*/ uint program) {
            GLint bufSize = 0;
            GLsizei bufLength = 0;

            glGetProgramiv(program, GL_ATTACHED_SHADERS, &bufSize);
            GLuint[] buf = new GLuint[bufSize + 1]; //  malloc((bufSize + 1) * sizeof(GLuint));
            glGetAttachedShaders(program, bufSize, &bufLength, buf);

            if (bufLength < bufSize) {
                buf.resize(bufLength + 1);
            }
            buf[bufLength] = 0;
            return buf;
        }

        public GLint getAttribLocation(/*WebGLProgram*/ uint program, string name) {
            return glGetAttribLocation(program, name);
        }

        public GLint getBufferParameter(GLenum target, GLenum pname) {
            // TODO this is not an array?
            GLint[] result = new GLint[1];
            glGetBufferParameteriv(target, pname, result);
            return result[0];
        }

        public GLenum getError() {
            GLenum error = glGetError();
            if (this.lastError != GL_NO_ERROR) {
              error = lastError;
            }
            lastError = GL_NO_ERROR;
            return error;
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L164
        public void setError(GLenum error) {
            if (error == GL_NO_ERROR || this.lastError != GL_NO_ERROR) {
                return;
            }
            GLenum prevError = this.getError();
            if (prevError == GL_NO_ERROR) {
                lastError = error;
            }
        }

        public GLint getFramebufferAttachmentParameter(
            GLenum target,
            GLenum attachment,
            GLenum pname)
        {
            GLint result = 1;
            glGetFramebufferAttachmentParameteriv(target, attachment, pname, &result);
            return result;
        }

        // Credits
        // * https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1745
        // * https://github.com/mikeseven/node-webgl/blob/a918e74acc7860db1bb63029934e8f54a2730ce2/src/webgl.cc#L1502
        public Variant getParameterx(GLenum pname) {
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
                    GLboolean params = 0;
                    glGetBooleanv(pname, &params);
                    return new Variant("b", (bool) params);
                }
            
                case GL_DEPTH_CLEAR_VALUE:
                case GL_LINE_WIDTH:
                case GL_POLYGON_OFFSET_FACTOR:
                case GL_POLYGON_OFFSET_UNITS:
                case GL_SAMPLE_COVERAGE_VALUE:
                case MAX_TEXTURE_MAX_ANISOTROPY_EXT:
                {
                    GLfloat params = 1;
                    glGetFloatv(pname, &params);
                    return new Variant("f", (float) params);
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
                    GLint[] params = new GLint[2];
                    glGetIntegerv(pname, params);
                    return new Variant("ai", (int[]) params);
                }
            
                case GL_SCISSOR_BOX:
                case GL_VIEWPORT:
                {
                    GLint[] params = new GLint[4];
                    glGetIntegerv(pname, params);
                    return new Variant("ai", (int[]) params);
                }
            
                case GL_ALIASED_LINE_WIDTH_RANGE:
                case GL_ALIASED_POINT_SIZE_RANGE:
                case GL_DEPTH_RANGE:
                {
                    GLfloat[] params = new GLfloat[2];
                    glGetFloatv(pname, params);
                    return new Variant("af", (float[]) params);
                }
            
                case GL_BLEND_COLOR:
                case GL_COLOR_CLEAR_VALUE:
                {
                    GLfloat[] params = new GLfloat[4];
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
                    GLint params = 1;
                    glGetIntegerv(pname, &params);
                    return new Variant("i", (int) params);
                }
            }
        }

        public GLboolean getParameterb(GLenum pname) {
            GLboolean result = 0;
            glGetBooleanv(pname, &result);
            return result;
        }

        public GLboolean getParameterbv(GLenum pname, int resultSize) {
            GLboolean data = 0;
            glGetBooleanv(pname, &data);
            return data;
        }

        public GLfloat getParameterf(GLenum pname) {
            GLfloat result = 0;
            glGetFloatv(pname, &result);
            return result;
        }

        public GLfloat getParameterfv(GLenum pname, int resultSize) {
            GLfloat data = 0;
            glGetFloatv(pname, &data);
            return data;
        }

        public GLint getParameteri(GLenum pname) {
            GLint result = 0;
            glGetIntegerv(pname, &result);
            return result;
        }

        public GLint getParameteriv(GLenum pname, int resultSize) {
            // gpointer data = malloc(resultSize);
            GLint data = 0;
            glGetIntegerv(pname, &data);
            return data;
        }

        public string? getProgramInfoLog(/*WebGLProgram*/ uint program) {
            GLint bufSize = 0;
            GLsizei bufLength = 0;
            glGetProgramiv(program, GL_INFO_LOG_LENGTH, &bufSize);
            GLchar[] buf = new GLchar[bufSize + 1];
            glGetProgramInfoLog(program, bufSize, &bufLength, buf);
            if (bufLength < bufSize) {
                buf.resize(bufLength + 1);
            }
            buf[bufLength] = 0;
            return (string) buf;
        }

        public GLint getProgramParameter(/*WebGLProgram*/ uint program, GLenum pname) {
            GLint result = 1;
            glGetProgramiv(program, pname, &result);
            return result;
        }

        public GLint getRenderbufferParameter(GLenum target, GLenum pname) {
            GLint result = 0;
            glGetRenderbufferParameteriv(target, pname, &result);
            return result;
        }

        public string? getShaderInfoLog(/*WebGLShader*/ uint shader) {
            GLint bufSize = 0;
            GLsizei bufLength = 0;
            glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &bufSize);
            // char *buf = malloc((bufSize + 1) * sizeof(char));
            GLchar[] buf = new GLchar[bufSize + 1];
            glGetShaderInfoLog(shader, bufSize, &bufLength, buf);
            if (bufLength < bufSize)
            {
                // buf = realloc(buf, (bufLength + 1) * sizeof(char));
                buf.resize(bufLength + 1);
            }
            buf[bufLength] = 0;
            return (string) buf;
        }

        public GLint getShaderParameter(/*WebGLShader*/ uint shader, GLenum pname) {
            GLint result = 1;
            glGetShaderiv(shader, pname, &result);
            return result;
        }

        public WebGLShaderPrecisionFormat? getShaderPrecisionFormat(GLenum shadertype, GLenum precisiontype) {
            GLint precision = 0;
            GLint[] range = new GLint[2];

            glGetShaderPrecisionFormat(shadertype, precisiontype, range, &precision);

            var res = WebGLShaderPrecisionFormat() {
                precision = (int) precision,
                rangeMin = (int) range[0],
                rangeMax = (int) range[1],
            };
            return res;
        }

        public string? getShaderSource(/*WebGLShader*/ uint shader) {
            GLint bufSize = 0;
            GLsizei bufLength = 0;
            glGetShaderiv(shader, GL_SHADER_SOURCE_LENGTH, &bufSize);
            GLchar[] buf = new GLchar[bufSize + 1];
            glGetShaderSource(shader, bufSize, &bufLength, buf);
            if (bufLength < bufSize) {
                buf.resize(bufLength + 1);
            }
            buf[bufLength] = 0;
            return (string) buf;
        }

        public string getString(GLenum pname) {
            return glGetString(pname);
        }

        public string[]? getSupportedExtensions() {
            string result = glGetString(GL_EXTENSIONS);
            string[] sp = result.split(" ", 0);
            // char **sp = strsplit((const char *) result, " ", 0);
            return sp;
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1637
        public Variant getTexParameterx(GLenum target, GLenum pname) {
            if (pname == 0x84FE /* GL_TEXTURE_MAX_ANISOTROPY_EXT */) {
                GLfloat param_value = 0;
                glGetTexParameterfv(target, pname, &param_value);
                return new Variant("f", (float) param_value);
            } else {
                GLint param_value = 0;
                glGetTexParameteriv(target, pname, &param_value);
                return new Variant("i", (int) param_value);
            }
        }

        //  public GLfloat getTexParameterfv(GLenum target, GLenum pname) {
        //      GLfloat result = 0;
        //      glGetTexParameterfv(target, pname, &result);
        //      return result;
        //  }

        //  public GLint getTexParameteriv(GLenum target, GLenum pname) {
        //      GLint result = 0;
        //      glGetTexParameteriv(target, pname, &result);
        //      return result;
        //  }

        public /*WebGLUniformLocation*/ int? getUniformLocation(/*WebGLProgram*/ uint program, string name) {
            return glGetUniformLocation(program, name);
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1976
        public GLfloat[] getUniform(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
            GLfloat[] result = new GLfloat[16];
            glGetUniformfv(program, location, result);
            return result;
        }
        
        //  public GLfloat[] getUniformf(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
        //      GLfloat[] result = new GLfloat[1];
        //      glGetUniformfv(program, location, result);
        //      return result;
        //  }

        //  public GLfloat[] getUniformfv(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location, int resultSize) {
        //      // gpointer data = malloc(resultSize);
        //      GLfloat[] data = new GLfloat[resultSize];
        //      glGetUniformfv(program, location, data);
        //      return data;
        //  }

        public GLint[] getUniformi(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location) {
            GLint[] result = new GLint[1];
            glGetUniformiv(program, location, result);
            return result;
        }

        public GLint[] getUniformiv(/*WebGLProgram*/ uint program, /*WebGLUniformLocation*/ int location, int resultSize) {
            // gpointer data = malloc(resultSize);
            GLint[] data = new GLint[resultSize];
            glGetUniformiv(program, location, data);
            // return new ByteArray.take(data);
            return data;
        }

        public GLintptr getVertexAttribOffset(uint index, GLenum pname) {
            GLintptr result = 1;
            glGetVertexAttribPointerv(index, pname, (GLvoid**) &result);
            return result;
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L1993
        public Variant getVertexAttrib(uint index, GLenum pname) throws TypeError {
            GLint value = 0;
            switch (pname) {
                case GL_VERTEX_ATTRIB_ARRAY_ENABLED:
                case GL_VERTEX_ATTRIB_ARRAY_NORMALIZED: {
                    glGetVertexAttribiv(index, pname, &value);
                    return new Variant("b", value != 0);
                }
            
                case GL_VERTEX_ATTRIB_ARRAY_SIZE:
                case GL_VERTEX_ATTRIB_ARRAY_STRIDE:
                case GL_VERTEX_ATTRIB_ARRAY_TYPE:
                case GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: {
                    glGetVertexAttribiv(index, pname, &value);
                    return new Variant("i", value);
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

        public GLfloat[] getVertexAttribf(uint index, GLenum pname) {
            GLfloat[] result = new GLfloat[1];
            glGetVertexAttribfv(index, pname, result);
            return result;
        }

        public GLfloat[] getVertexAttribfv(uint index, GLenum pname, int resultSize) {
            GLfloat[] data = new GLfloat[resultSize];
            glGetVertexAttribfv(index, pname, data);
            return data;
        }

        public GLint[] getVertexAttribi(GLuint index, GLenum pname) {
            GLint[] result = new GLint[1];
            glGetVertexAttribiv(index, pname, result);
            return result;
        }

        public void hint(GLenum target, GLenum mode) {
            glHint(target, mode);
        }

        public GLboolean isBuffer(/*WebGLBuffer*/ uint? buffer) {
            if (buffer == null) {
                return (GLboolean) false;
            }
            return glIsBuffer(buffer);
        }

        public GLboolean isEnabled(GLenum cap) {
            return glIsEnabled(cap);
        }

        public GLboolean isFramebuffer(/*WebGLFramebuffer*/ uint? framebuffer) {
            if(framebuffer == null) {
                return (GLboolean) false;
            }
            return glIsFramebuffer(framebuffer);
        }

        public GLboolean isProgram(/*WebGLProgram*/ uint? program) {
            if(program == null) {
                return (GLboolean) false;
            }
            return glIsProgram(program);
        }

        public GLboolean isRenderbuffer(/*WebGLFramebuffer*/ uint? renderbuffer) {
            if(renderbuffer == null) {
                return (GLboolean) false;
            }
            return glIsRenderbuffer(renderbuffer);
        }

        public GLboolean isShader(/*WebGLShader*/ uint? shader) {
            if(shader == null) {
                return (GLboolean) false;
            }
            return glIsShader(shader);
        }

        public GLboolean isTexture(/*WebGLTexture*/ uint? texture) {
            if(texture == null) {
                return (GLboolean) false;
            }
            return glIsTexture(texture);
        }

        public void lineWidth(float width) {
            glLineWidth(width);
        }

        public void linkProgram(/*WebGLProgram*/ uint program) {
            glLinkProgram(program);
        }

        // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/native/webgl.cc#L374
        public void pixelStorei(GLenum pname, int param) {

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

        public void renderbufferStorage(GLenum target, GLenum internalformat, GLsizei width, GLsizei height) {
            glRenderbufferStorage(target, internalformat, width, height);
        }

        public void sampleCoverage(GLclampf value, GLboolean invert) {
            glSampleCoverage(value, invert);
        }

        public void scissor(int x, int y, int width, int height) {
            glScissor(x, y, width, height);
        }

        public void shaderSource(/*WebGLShader*/ uint shader, string source) {
            string[] sources = new string[]{ source };
            GLint[] length = new GLint[1]{ 1 };
            glShaderSource(shader, sources, length);
        }

        public void stencilFunc(GLenum func, GLint ref_, GLuint mask) {
            glStencilFunc(func, ref_, mask);
        }

        public void stencilFuncSeparate(GLenum face, GLenum func, GLint ref_, GLuint mask) {
            glStencilFuncSeparate(face, func, ref_, mask);
        }

        public void stencilMask(GLuint mask) {
            glStencilMask(mask);
        }

        public void stencilMaskSeparate(GLenum face, GLuint mask) {
            glStencilMaskSeparate(face, mask);
        }

        public void stencilOp(GLenum fail, GLenum zfail, GLenum zpass) {
            glStencilOp(fail, zfail, zpass);
        }

        public void stencilOpSeparate(GLenum face, GLenum fail, GLenum zfail, GLenum zpass) {
            glStencilOpSeparate(face, fail, zfail, zpass);
        }

        public void texParameterf(GLenum target, GLenum pname, GLfloat param) {
            glTexParameterf(target, pname, param);
        }

        public void texParameteri(GLenum target, GLenum pname, GLint param) {
            glTexParameteri(target, pname, param);
        }

        public void uniform1f(/*WebGLUniformLocation*/ int? location, float x) {
            if(location == null) {
                return;
            }
            glUniform1f(location, x);
        }

        public void uniform1i(/*WebGLUniformLocation*/ int? location, int x) {
            if(location == null) {
                return;
            }
            glUniform1i(location, x);
        }

        public void uniform2f(/*WebGLUniformLocation*/ int? location, float x, float y) {
            if(location == null) {
                return;
            }
            glUniform2f(location, x, y);
        }

        public void uniform2i(/*WebGLUniformLocation*/ int? location, int x, int y) {
            if(location == null) {
                return;
            }
            glUniform2i(location, x, y);
        }

        public void uniform3f(/*WebGLUniformLocation*/ int? location, float x, float y, float z) {
            if(location == null) {
                return;
            }
            glUniform3f(location, x, y, z);
        }

        public void uniform3i(/*WebGLUniformLocation*/ int? location, int x, int y, int z) {
            if(location == null) {
                return;
            }
            glUniform3i(location, x, y, z);
        }

        public void uniform4f(/*WebGLUniformLocation*/ int? location, float x, float y, float z, float w) {
            if(location == null) {
                return;
            }
            glUniform4f(location, x, y, z, w);
        }

        public void uniform4i(/*WebGLUniformLocation*/ int? location, int x, int y, int z, int w) {
            if(location == null) {
                return;
            }
            glUniform4i(location, x, y, z, w);
        }

        public void useProgram(/*WebGLProgram*/ uint? program) {
            if(program == null) {
                return;
            }
            glUseProgram(program);
        }

        public void validateProgram(/*WebGLProgram*/ uint? program) {
            if(program == null) {
                return;
            }
            glValidateProgram(program);
        }

        public void vertexAttrib1f(GLuint index, GLfloat x) {
            glVertexAttrib1f(index, x);
        }

        public void vertexAttrib1fv(GLuint index, GLfloat[] v) {
            glVertexAttrib1fv(index, v);
        }

        public void vertexAttrib2f(GLuint index, GLfloat x, GLfloat y) {
            glVertexAttrib2f(index, x, y);
        }

        public void vertexAttrib2fv(GLuint index, GLfloat[] values) {
            glVertexAttrib2fv(index, values);
        }
        

        public void vertexAttrib3f(GLuint index, GLfloat x, GLfloat y, GLfloat z) {
            glVertexAttrib3f(index, x, y, z);
        }

        public void vertexAttrib3fv(GLuint index, GLfloat[] values) {
            glVertexAttrib3fv(index, values);
        }

        public void vertexAttrib4f(GLuint index, GLfloat x, GLfloat y, GLfloat z, GLfloat w) {
            glVertexAttrib4f(index, x, y, z, w);
        }

        public void vertexAttrib4fv(GLuint index, GLfloat[] values) {
            glVertexAttrib4fv(index, values);
        }

        public void vertexAttribPointer(GLuint index, GLint size, GLenum type, GLboolean normalized, GLint stride, GLintptr offset) {
            glVertexAttribPointer(index, size, type, normalized, stride, (void*) offset);
        }

        public void viewport(GLint x, GLint y, GLint width, GLint height) {
            glViewport(x, y, width, height);
        }

    }
}
