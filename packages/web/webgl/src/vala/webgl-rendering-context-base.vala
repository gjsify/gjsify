

namespace Gwebgl {



public class WebGLRenderingContextBase: Object {
    HashTable<string, int> webgl_constants = new HashTable<string, int> (str_hash, str_equal);

    public WebGLRenderingContextBase() {

    }

    /* Constructor */
    construct {
        this.webgl_constants.insert("ACTIVE_ATTRIBUTES", GLES2.GL_ACTIVE_ATTRIBUTES);
        this.webgl_constants.insert("ACTIVE_TEXTURE", GLES2.GL_ACTIVE_TEXTURE);
        this.webgl_constants.insert("ACTIVE_UNIFORMS", GLES2.GL_ACTIVE_UNIFORMS);
        this.webgl_constants.insert("ALIASED_LINE_WIDTH_RANGE", GLES2.GL_ALIASED_LINE_WIDTH_RANGE);
        this.webgl_constants.insert("ALIASED_POINT_SIZE_RANGE", GLES2.GL_ALIASED_POINT_SIZE_RANGE);
        this.webgl_constants.insert("ALPHA", GLES2.GL_ALPHA);
        this.webgl_constants.insert("ALPHA_BITS", GLES2.GL_ALPHA_BITS);
        this.webgl_constants.insert("ALWAYS", GLES2.GL_ALWAYS);
        this.webgl_constants.insert("ARRAY_BUFFER", GLES2.GL_ARRAY_BUFFER);
        this.webgl_constants.insert("ARRAY_BUFFER_BINDING", GLES2.GL_ARRAY_BUFFER_BINDING);
        this.webgl_constants.insert("ATTACHED_SHADERS", GLES2.GL_ATTACHED_SHADERS);
        this.webgl_constants.insert("BACK", GLES2.GL_BACK);
        this.webgl_constants.insert("BLEND", GLES2.GL_BLEND);
        this.webgl_constants.insert("BLEND_COLOR", GLES2.GL_BLEND_COLOR);
        this.webgl_constants.insert("BLEND_DST_ALPHA", GLES2.GL_BLEND_DST_ALPHA);
        this.webgl_constants.insert("BLEND_DST_RGB", GLES2.GL_BLEND_DST_RGB);
        this.webgl_constants.insert("BLEND_EQUATION", GLES2.GL_BLEND_EQUATION);
        this.webgl_constants.insert("BLEND_EQUATION_ALPHA", GLES2.GL_BLEND_EQUATION_ALPHA);
        this.webgl_constants.insert("BLEND_EQUATION_RGB", GLES2.GL_BLEND_EQUATION_RGB);
        this.webgl_constants.insert("BLEND_SRC_ALPHA", GLES2.GL_BLEND_SRC_ALPHA);
        this.webgl_constants.insert("BLEND_SRC_RGB", GLES2.GL_BLEND_SRC_RGB);
        this.webgl_constants.insert("BLUE_BITS", GLES2.GL_BLUE_BITS);
        this.webgl_constants.insert("BOOL", GLES2.GL_BOOL);
        this.webgl_constants.insert("BOOL_VEC2", GLES2.GL_BOOL_VEC2);
        this.webgl_constants.insert("BOOL_VEC3", GLES2.GL_BOOL_VEC3);
        this.webgl_constants.insert("BOOL_VEC4", GLES2.GL_BOOL_VEC4);
        this.webgl_constants.insert("BUFFER_SIZE", GLES2.GL_BUFFER_SIZE);
        this.webgl_constants.insert("BUFFER_USAGE", GLES2.GL_BUFFER_USAGE);
        this.webgl_constants.insert("BYTE", GLES2.GL_BYTE);
        this.webgl_constants.insert("CCW", GLES2.GL_CCW);
        this.webgl_constants.insert("CLAMP_TO_EDGE", GLES2.GL_CLAMP_TO_EDGE);
        this.webgl_constants.insert("COLOR_ATTACHMENT0", GLES2.GL_COLOR_ATTACHMENT0);
        this.webgl_constants.insert("COLOR_BUFFER_BIT", GLES2.GL_COLOR_BUFFER_BIT);
        this.webgl_constants.insert("COLOR_CLEAR_VALUE", GLES2.GL_COLOR_CLEAR_VALUE);
        this.webgl_constants.insert("COLOR_WRITEMASK", GLES2.GL_COLOR_WRITEMASK);
        this.webgl_constants.insert("COMPILE_STATUS", GLES2.GL_COMPILE_STATUS);
        this.webgl_constants.insert("COMPRESSED_TEXTURE_FORMATS", GLES2.GL_COMPRESSED_TEXTURE_FORMATS);
        this.webgl_constants.insert("CONSTANT_ALPHA", GLES2.GL_CONSTANT_ALPHA);
        this.webgl_constants.insert("CONSTANT_COLOR", GLES2.GL_CONSTANT_COLOR);
        this.webgl_constants.insert("CULL_FACE", GLES2.GL_CULL_FACE);
        this.webgl_constants.insert("CULL_FACE_MODE", GLES2.GL_CULL_FACE_MODE);
        this.webgl_constants.insert("CURRENT_PROGRAM", GLES2.GL_CURRENT_PROGRAM);
        this.webgl_constants.insert("CURRENT_VERTEX_ATTRIB", GLES2.GL_CURRENT_VERTEX_ATTRIB);
        this.webgl_constants.insert("CW", GLES2.GL_CW);
        this.webgl_constants.insert("DECR", GLES2.GL_DECR);
        this.webgl_constants.insert("DECR_WRAP", GLES2.GL_DECR_WRAP);
        this.webgl_constants.insert("DELETE_STATUS", GLES2.GL_DELETE_STATUS);
        this.webgl_constants.insert("DEPTH_ATTACHMENT", GLES2.GL_DEPTH_ATTACHMENT);
        this.webgl_constants.insert("DEPTH_BITS", GLES2.GL_DEPTH_BITS);
        this.webgl_constants.insert("DEPTH_BUFFER_BIT", GLES2.GL_DEPTH_BUFFER_BIT);
        this.webgl_constants.insert("DEPTH_CLEAR_VALUE", GLES2.GL_DEPTH_CLEAR_VALUE);
        this.webgl_constants.insert("DEPTH_COMPONENT", GLES2.GL_DEPTH_COMPONENT);
        this.webgl_constants.insert("DEPTH_COMPONENT16", GLES2.GL_DEPTH_COMPONENT16);
        this.webgl_constants.insert("DEPTH_FUNC", GLES2.GL_DEPTH_FUNC);
        this.webgl_constants.insert("DEPTH_RANGE", GLES2.GL_DEPTH_RANGE);
        this.webgl_constants.insert("DEPTH_TEST", GLES2.GL_DEPTH_TEST);
        this.webgl_constants.insert("DEPTH_WRITEMASK", GLES2.GL_DEPTH_WRITEMASK);
        this.webgl_constants.insert("DITHER", GLES2.GL_DITHER);
        this.webgl_constants.insert("DONT_CARE", GLES2.GL_DONT_CARE);
        this.webgl_constants.insert("DST_ALPHA", GLES2.GL_DST_ALPHA);
        this.webgl_constants.insert("DST_COLOR", GLES2.GL_DST_COLOR);
        this.webgl_constants.insert("DYNAMIC_DRAW", GLES2.GL_DYNAMIC_DRAW);
        this.webgl_constants.insert("ELEMENT_ARRAY_BUFFER", GLES2.GL_ELEMENT_ARRAY_BUFFER);
        this.webgl_constants.insert("ELEMENT_ARRAY_BUFFER_BINDING", GLES2.GL_ELEMENT_ARRAY_BUFFER_BINDING);
        this.webgl_constants.insert("EQUAL", GLES2.GL_EQUAL);
        this.webgl_constants.insert("FASTEST", GLES2.GL_FASTEST);
        this.webgl_constants.insert("FLOAT", GLES2.GL_FLOAT);
        this.webgl_constants.insert("FLOAT_MAT2", GLES2.GL_FLOAT_MAT2);
        this.webgl_constants.insert("FLOAT_MAT3", GLES2.GL_FLOAT_MAT3);
        this.webgl_constants.insert("FLOAT_MAT4", GLES2.GL_FLOAT_MAT4);
        this.webgl_constants.insert("FLOAT_VEC2", GLES2.GL_FLOAT_VEC2);
        this.webgl_constants.insert("FLOAT_VEC3", GLES2.GL_FLOAT_VEC3);
        this.webgl_constants.insert("FLOAT_VEC4", GLES2.GL_FLOAT_VEC4);
        this.webgl_constants.insert("FRAGMENT_SHADER", GLES2.GL_FRAGMENT_SHADER);
        this.webgl_constants.insert("FRAMEBUFFER", GLES2.GL_FRAMEBUFFER);
        this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_OBJECT_NAME", GLES2.GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
        this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE", GLES2.GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
        this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE", GLES2.GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE);
        this.webgl_constants.insert("FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL", GLES2.GL_FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL);
        this.webgl_constants.insert("FRAMEBUFFER_BINDING", GLES2.GL_FRAMEBUFFER_BINDING);
        this.webgl_constants.insert("FRAMEBUFFER_COMPLETE", GLES2.GL_FRAMEBUFFER_COMPLETE);
        this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_ATTACHMENT", GLES2.GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
        this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_DIMENSIONS", GLES2.GL_FRAMEBUFFER_INCOMPLETE_DIMENSIONS);
        this.webgl_constants.insert("FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT", GLES2.GL_FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
        this.webgl_constants.insert("FRAMEBUFFER_UNSUPPORTED", GLES2.GL_FRAMEBUFFER_UNSUPPORTED);
        this.webgl_constants.insert("FRONT", GLES2.GL_FRONT);
        this.webgl_constants.insert("FRONT_AND_BACK", GLES2.GL_FRONT_AND_BACK);
        this.webgl_constants.insert("FRONT_FACE", GLES2.GL_FRONT_FACE);
        this.webgl_constants.insert("FUNC_ADD", GLES2.GL_FUNC_ADD);
        this.webgl_constants.insert("FUNC_REVERSE_SUBTRACT", GLES2.GL_FUNC_REVERSE_SUBTRACT);
        this.webgl_constants.insert("FUNC_SUBTRACT", GLES2.GL_FUNC_SUBTRACT);
        this.webgl_constants.insert("GENERATE_MIPMAP_HINT", GLES2.GL_GENERATE_MIPMAP_HINT);
        this.webgl_constants.insert("GEQUAL", GLES2.GL_GEQUAL);
        this.webgl_constants.insert("GREATER", GLES2.GL_GREATER);
        this.webgl_constants.insert("GREEN_BITS", GLES2.GL_GREEN_BITS);
        this.webgl_constants.insert("HIGH_FLOAT", GLES2.GL_HIGH_FLOAT);
        this.webgl_constants.insert("HIGH_INT", GLES2.GL_HIGH_INT);
        this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_FORMAT", GLES2.GL_IMPLEMENTATION_COLOR_READ_FORMAT);
        this.webgl_constants.insert("IMPLEMENTATION_COLOR_READ_TYPE", GLES2.GL_IMPLEMENTATION_COLOR_READ_TYPE);
        this.webgl_constants.insert("INCR", GLES2.GL_INCR);
        this.webgl_constants.insert("INCR_WRAP", GLES2.GL_INCR_WRAP);
        this.webgl_constants.insert("INT", GLES2.GL_INT);
        this.webgl_constants.insert("INT_VEC2", GLES2.GL_INT_VEC2);
        this.webgl_constants.insert("INT_VEC3", GLES2.GL_INT_VEC3);
        this.webgl_constants.insert("INT_VEC4", GLES2.GL_INT_VEC4);
        this.webgl_constants.insert("INVALID_ENUM", GLES2.GL_INVALID_ENUM);
        this.webgl_constants.insert("INVALID_FRAMEBUFFER_OPERATION", GLES2.GL_INVALID_FRAMEBUFFER_OPERATION);
        this.webgl_constants.insert("INVALID_OPERATION", GLES2.GL_INVALID_OPERATION);
        this.webgl_constants.insert("INVALID_VALUE", GLES2.GL_INVALID_VALUE);
        this.webgl_constants.insert("INVERT", GLES2.GL_INVERT);
        this.webgl_constants.insert("KEEP", GLES2.GL_KEEP);
        this.webgl_constants.insert("LEQUAL", GLES2.GL_LEQUAL);
        this.webgl_constants.insert("LESS", GLES2.GL_LESS);
        this.webgl_constants.insert("LINEAR", GLES2.GL_LINEAR);
        this.webgl_constants.insert("LINEAR_MIPMAP_LINEAR", GLES2.GL_LINEAR_MIPMAP_LINEAR);
        this.webgl_constants.insert("LINEAR_MIPMAP_NEAREST", GLES2.GL_LINEAR_MIPMAP_NEAREST);
        this.webgl_constants.insert("LINES", GLES2.GL_LINES);
        this.webgl_constants.insert("LINE_LOOP", GLES2.GL_LINE_LOOP);
        this.webgl_constants.insert("LINE_STRIP", GLES2.GL_LINE_STRIP);
        this.webgl_constants.insert("LINE_WIDTH", GLES2.GL_LINE_WIDTH);
        this.webgl_constants.insert("LINK_STATUS", GLES2.GL_LINK_STATUS);
        this.webgl_constants.insert("LOW_FLOAT", GLES2.GL_LOW_FLOAT);
        this.webgl_constants.insert("LOW_INT", GLES2.GL_LOW_INT);
        this.webgl_constants.insert("LUMINANCE", GLES2.GL_LUMINANCE);
        this.webgl_constants.insert("LUMINANCE_ALPHA", GLES2.GL_LUMINANCE_ALPHA);
        this.webgl_constants.insert("MAX_COMBINED_TEXTURE_IMAGE_UNITS", GLES2.GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS);
        this.webgl_constants.insert("MAX_CUBE_MAP_TEXTURE_SIZE", GLES2.GL_MAX_CUBE_MAP_TEXTURE_SIZE);
        this.webgl_constants.insert("MAX_FRAGMENT_UNIFORM_VECTORS", GLES2.GL_MAX_FRAGMENT_UNIFORM_VECTORS);
        this.webgl_constants.insert("MAX_RENDERBUFFER_SIZE", GLES2.GL_MAX_RENDERBUFFER_SIZE);
        this.webgl_constants.insert("MAX_TEXTURE_IMAGE_UNITS", GLES2.GL_MAX_TEXTURE_IMAGE_UNITS);
        this.webgl_constants.insert("MAX_TEXTURE_SIZE", GLES2.GL_MAX_TEXTURE_SIZE);
        this.webgl_constants.insert("MAX_VARYING_VECTORS", GLES2.GL_MAX_VARYING_VECTORS);
        this.webgl_constants.insert("MAX_VERTEX_ATTRIBS", GLES2.GL_MAX_VERTEX_ATTRIBS);
        this.webgl_constants.insert("MAX_VERTEX_TEXTURE_IMAGE_UNITS", GLES2.GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS);
        this.webgl_constants.insert("MAX_VERTEX_UNIFORM_VECTORS", GLES2.GL_MAX_VERTEX_UNIFORM_VECTORS);
        this.webgl_constants.insert("MAX_VIEWPORT_DIMS", GLES2.GL_MAX_VIEWPORT_DIMS);
        this.webgl_constants.insert("MEDIUM_FLOAT", GLES2.GL_MEDIUM_FLOAT);
        this.webgl_constants.insert("MEDIUM_INT", GLES2.GL_MEDIUM_INT);
        this.webgl_constants.insert("MIRRORED_REPEAT", GLES2.GL_MIRRORED_REPEAT);
        this.webgl_constants.insert("NEAREST", GLES2.GL_NEAREST);
        this.webgl_constants.insert("NEAREST_MIPMAP_LINEAR", GLES2.GL_NEAREST_MIPMAP_LINEAR);
        this.webgl_constants.insert("NEAREST_MIPMAP_NEAREST", GLES2.GL_NEAREST_MIPMAP_NEAREST);
        this.webgl_constants.insert("NEVER", GLES2.GL_NEVER);
        this.webgl_constants.insert("NICEST", GLES2.GL_NICEST);
        this.webgl_constants.insert("NONE", GLES2.GL_NONE);
        this.webgl_constants.insert("NOTEQUAL", GLES2.GL_NOTEQUAL);
        this.webgl_constants.insert("NO_ERROR", GLES2.GL_NO_ERROR);
        this.webgl_constants.insert("ONE", GLES2.GL_ONE);
        this.webgl_constants.insert("ONE_MINUS_CONSTANT_ALPHA", GLES2.GL_ONE_MINUS_CONSTANT_ALPHA);
        this.webgl_constants.insert("ONE_MINUS_CONSTANT_COLOR", GLES2.GL_ONE_MINUS_CONSTANT_COLOR);
        this.webgl_constants.insert("ONE_MINUS_DST_ALPHA", GLES2.GL_ONE_MINUS_DST_ALPHA);
        this.webgl_constants.insert("ONE_MINUS_DST_COLOR", GLES2.GL_ONE_MINUS_DST_COLOR);
        this.webgl_constants.insert("ONE_MINUS_SRC_ALPHA", GLES2.GL_ONE_MINUS_SRC_ALPHA);
        this.webgl_constants.insert("ONE_MINUS_SRC_COLOR", GLES2.GL_ONE_MINUS_SRC_COLOR);
        this.webgl_constants.insert("OUT_OF_MEMORY", GLES2.GL_OUT_OF_MEMORY);
        this.webgl_constants.insert("PACK_ALIGNMENT", GLES2.GL_PACK_ALIGNMENT);
        this.webgl_constants.insert("POINTS", GLES2.GL_POINTS);
        this.webgl_constants.insert("POLYGON_OFFSET_FACTOR", GLES2.GL_POLYGON_OFFSET_FACTOR);
        this.webgl_constants.insert("POLYGON_OFFSET_FILL", GLES2.GL_POLYGON_OFFSET_FILL);
        this.webgl_constants.insert("POLYGON_OFFSET_UNITS", GLES2.GL_POLYGON_OFFSET_UNITS);
        this.webgl_constants.insert("RED_BITS", GLES2.GL_RED_BITS);
        this.webgl_constants.insert("RENDERBUFFER", GLES2.GL_RENDERBUFFER);
        this.webgl_constants.insert("RENDERBUFFER_ALPHA_SIZE", GLES2.GL_RENDERBUFFER_ALPHA_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_BINDING", GLES2.GL_RENDERBUFFER_BINDING);
        this.webgl_constants.insert("RENDERBUFFER_BLUE_SIZE", GLES2.GL_RENDERBUFFER_BLUE_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_DEPTH_SIZE", GLES2.GL_RENDERBUFFER_DEPTH_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_GREEN_SIZE", GLES2.GL_RENDERBUFFER_GREEN_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_HEIGHT", GLES2.GL_RENDERBUFFER_HEIGHT);
        this.webgl_constants.insert("RENDERBUFFER_INTERNAL_FORMAT", GLES2.GL_RENDERBUFFER_INTERNAL_FORMAT);
        this.webgl_constants.insert("RENDERBUFFER_RED_SIZE", GLES2.GL_RENDERBUFFER_RED_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_STENCIL_SIZE", GLES2.GL_RENDERBUFFER_STENCIL_SIZE);
        this.webgl_constants.insert("RENDERBUFFER_WIDTH", GLES2.GL_RENDERBUFFER_WIDTH);
        this.webgl_constants.insert("RENDERER", GLES2.GL_RENDERER);
        this.webgl_constants.insert("REPEAT", GLES2.GL_REPEAT);
        this.webgl_constants.insert("REPLACE", GLES2.GL_REPLACE);
        this.webgl_constants.insert("RGB", GLES2.GL_RGB);
        this.webgl_constants.insert("RGB565", GLES2.GL_RGB565);
        this.webgl_constants.insert("RGB5_A1", GLES2.GL_RGB5_A1);
        this.webgl_constants.insert("RGBA", GLES2.GL_RGBA);
        this.webgl_constants.insert("RGBA4", GLES2.GL_RGBA4);
        this.webgl_constants.insert("SAMPLER_2D", GLES2.GL_SAMPLER_2D);
        this.webgl_constants.insert("SAMPLER_CUBE", GLES2.GL_SAMPLER_CUBE);
        this.webgl_constants.insert("SAMPLES", GLES2.GL_SAMPLES);
        this.webgl_constants.insert("SAMPLE_ALPHA_TO_COVERAGE", GLES2.GL_SAMPLE_ALPHA_TO_COVERAGE);
        this.webgl_constants.insert("SAMPLE_BUFFERS", GLES2.GL_SAMPLE_BUFFERS);
        this.webgl_constants.insert("SAMPLE_COVERAGE", GLES2.GL_SAMPLE_COVERAGE);
        this.webgl_constants.insert("SAMPLE_COVERAGE_INVERT", GLES2.GL_SAMPLE_COVERAGE_INVERT);
        this.webgl_constants.insert("SAMPLE_COVERAGE_VALUE", GLES2.GL_SAMPLE_COVERAGE_VALUE);
        this.webgl_constants.insert("SCISSOR_BOX", GLES2.GL_SCISSOR_BOX);
        this.webgl_constants.insert("SCISSOR_TEST", GLES2.GL_SCISSOR_TEST);
        this.webgl_constants.insert("SHADER_TYPE", GLES2.GL_SHADER_TYPE);
        this.webgl_constants.insert("SHADING_LANGUAGE_VERSION", GLES2.GL_SHADING_LANGUAGE_VERSION);
        this.webgl_constants.insert("SHORT", GLES2.GL_SHORT);
        this.webgl_constants.insert("SRC_ALPHA", GLES2.GL_SRC_ALPHA);
        this.webgl_constants.insert("SRC_ALPHA_SATURATE", GLES2.GL_SRC_ALPHA_SATURATE);
        this.webgl_constants.insert("SRC_COLOR", GLES2.GL_SRC_COLOR);
        this.webgl_constants.insert("STATIC_DRAW", GLES2.GL_STATIC_DRAW);
        this.webgl_constants.insert("STENCIL_ATTACHMENT", GLES2.GL_STENCIL_ATTACHMENT);
        this.webgl_constants.insert("STENCIL_BACK_FAIL", GLES2.GL_STENCIL_BACK_FAIL);
        this.webgl_constants.insert("STENCIL_BACK_FUNC", GLES2.GL_STENCIL_BACK_FUNC);
        this.webgl_constants.insert("STENCIL_BACK_PASS_DEPTH_FAIL", GLES2.GL_STENCIL_BACK_PASS_DEPTH_FAIL);
        this.webgl_constants.insert("STENCIL_BACK_PASS_DEPTH_PASS", GLES2.GL_STENCIL_BACK_PASS_DEPTH_PASS);
        this.webgl_constants.insert("STENCIL_BACK_REF", GLES2.GL_STENCIL_BACK_REF);
        this.webgl_constants.insert("STENCIL_BACK_VALUE_MASK", GLES2.GL_STENCIL_BACK_VALUE_MASK);
        this.webgl_constants.insert("STENCIL_BACK_WRITEMASK", GLES2.GL_STENCIL_BACK_WRITEMASK);
        this.webgl_constants.insert("STENCIL_BITS", GLES2.GL_STENCIL_BITS);
        this.webgl_constants.insert("STENCIL_BUFFER_BIT", GLES2.GL_STENCIL_BUFFER_BIT);
        this.webgl_constants.insert("STENCIL_CLEAR_VALUE", GLES2.GL_STENCIL_CLEAR_VALUE);
        this.webgl_constants.insert("STENCIL_FAIL", GLES2.GL_STENCIL_FAIL);
        this.webgl_constants.insert("STENCIL_FUNC", GLES2.GL_STENCIL_FUNC);
        this.webgl_constants.insert("STENCIL_INDEX8", GLES2.GL_STENCIL_INDEX8);
        this.webgl_constants.insert("STENCIL_PASS_DEPTH_FAIL", GLES2.GL_STENCIL_PASS_DEPTH_FAIL);
        this.webgl_constants.insert("STENCIL_PASS_DEPTH_PASS", GLES2.GL_STENCIL_PASS_DEPTH_PASS);
        this.webgl_constants.insert("STENCIL_REF", GLES2.GL_STENCIL_REF);
        this.webgl_constants.insert("STENCIL_TEST", GLES2.GL_STENCIL_TEST);
        this.webgl_constants.insert("STENCIL_VALUE_MASK", GLES2.GL_STENCIL_VALUE_MASK);
        this.webgl_constants.insert("STENCIL_WRITEMASK", GLES2.GL_STENCIL_WRITEMASK);
        this.webgl_constants.insert("STREAM_DRAW", GLES2.GL_STREAM_DRAW);
        this.webgl_constants.insert("SUBPIXEL_BITS", GLES2.GL_SUBPIXEL_BITS);
        this.webgl_constants.insert("TEXTURE", GLES2.GL_TEXTURE);
        this.webgl_constants.insert("TEXTURE0", GLES2.GL_TEXTURE0);
        this.webgl_constants.insert("TEXTURE1", GLES2.GL_TEXTURE1);
        this.webgl_constants.insert("TEXTURE10", GLES2.GL_TEXTURE10);
        this.webgl_constants.insert("TEXTURE11", GLES2.GL_TEXTURE11);
        this.webgl_constants.insert("TEXTURE12", GLES2.GL_TEXTURE12);
        this.webgl_constants.insert("TEXTURE13", GLES2.GL_TEXTURE13);
        this.webgl_constants.insert("TEXTURE14", GLES2.GL_TEXTURE14);
        this.webgl_constants.insert("TEXTURE15", GLES2.GL_TEXTURE15);
        this.webgl_constants.insert("TEXTURE16", GLES2.GL_TEXTURE16);
        this.webgl_constants.insert("TEXTURE17", GLES2.GL_TEXTURE17);
        this.webgl_constants.insert("TEXTURE18", GLES2.GL_TEXTURE18);
        this.webgl_constants.insert("TEXTURE19", GLES2.GL_TEXTURE19);
        this.webgl_constants.insert("TEXTURE2", GLES2.GL_TEXTURE2);
        this.webgl_constants.insert("TEXTURE20", GLES2.GL_TEXTURE20);
        this.webgl_constants.insert("TEXTURE21", GLES2.GL_TEXTURE21);
        this.webgl_constants.insert("TEXTURE22", GLES2.GL_TEXTURE22);
        this.webgl_constants.insert("TEXTURE23", GLES2.GL_TEXTURE23);
        this.webgl_constants.insert("TEXTURE24", GLES2.GL_TEXTURE24);
        this.webgl_constants.insert("TEXTURE25", GLES2.GL_TEXTURE25);
        this.webgl_constants.insert("TEXTURE26", GLES2.GL_TEXTURE26);
        this.webgl_constants.insert("TEXTURE27", GLES2.GL_TEXTURE27);
        this.webgl_constants.insert("TEXTURE28", GLES2.GL_TEXTURE28);
        this.webgl_constants.insert("TEXTURE29", GLES2.GL_TEXTURE29);
        this.webgl_constants.insert("TEXTURE3", GLES2.GL_TEXTURE3);
        this.webgl_constants.insert("TEXTURE30", GLES2.GL_TEXTURE30);
        this.webgl_constants.insert("TEXTURE31", GLES2.GL_TEXTURE31);
        this.webgl_constants.insert("TEXTURE4", GLES2.GL_TEXTURE4);
        this.webgl_constants.insert("TEXTURE5", GLES2.GL_TEXTURE5);
        this.webgl_constants.insert("TEXTURE6", GLES2.GL_TEXTURE6);
        this.webgl_constants.insert("TEXTURE7", GLES2.GL_TEXTURE7);
        this.webgl_constants.insert("TEXTURE8", GLES2.GL_TEXTURE8);
        this.webgl_constants.insert("TEXTURE9", GLES2.GL_TEXTURE9);
        this.webgl_constants.insert("TEXTURE_2D", GLES2.GL_TEXTURE_2D);
        this.webgl_constants.insert("TEXTURE_BINDING_2D", GLES2.GL_TEXTURE_BINDING_2D);
        this.webgl_constants.insert("TEXTURE_BINDING_CUBE_MAP", GLES2.GL_TEXTURE_BINDING_CUBE_MAP);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP", GLES2.GL_TEXTURE_CUBE_MAP);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_X", GLES2.GL_TEXTURE_CUBE_MAP_NEGATIVE_X);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_Y", GLES2.GL_TEXTURE_CUBE_MAP_NEGATIVE_Y);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_NEGATIVE_Z", GLES2.GL_TEXTURE_CUBE_MAP_NEGATIVE_Z);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_X", GLES2.GL_TEXTURE_CUBE_MAP_POSITIVE_X);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_Y", GLES2.GL_TEXTURE_CUBE_MAP_POSITIVE_Y);
        this.webgl_constants.insert("TEXTURE_CUBE_MAP_POSITIVE_Z", GLES2.GL_TEXTURE_CUBE_MAP_POSITIVE_Z);
        this.webgl_constants.insert("TEXTURE_MAG_FILTER", GLES2.GL_TEXTURE_MAG_FILTER);
        this.webgl_constants.insert("TEXTURE_MIN_FILTER", GLES2.GL_TEXTURE_MIN_FILTER);
        this.webgl_constants.insert("TEXTURE_WRAP_S", GLES2.GL_TEXTURE_WRAP_S);
        this.webgl_constants.insert("TEXTURE_WRAP_T", GLES2.GL_TEXTURE_WRAP_T);
        this.webgl_constants.insert("TRIANGLES", GLES2.GL_TRIANGLES);
        this.webgl_constants.insert("TRIANGLE_FAN", GLES2.GL_TRIANGLE_FAN);
        this.webgl_constants.insert("TRIANGLE_STRIP", GLES2.GL_TRIANGLE_STRIP);
        this.webgl_constants.insert("UNPACK_ALIGNMENT", GLES2.GL_UNPACK_ALIGNMENT);
        this.webgl_constants.insert("UNSIGNED_BYTE", GLES2.GL_UNSIGNED_BYTE);
        this.webgl_constants.insert("UNSIGNED_INT", GLES2.GL_UNSIGNED_INT);
        this.webgl_constants.insert("UNSIGNED_SHORT", GLES2.GL_UNSIGNED_SHORT);
        this.webgl_constants.insert("UNSIGNED_SHORT_4_4_4_4", GLES2.GL_UNSIGNED_SHORT_4_4_4_4);
        this.webgl_constants.insert("UNSIGNED_SHORT_5_5_5_1", GLES2.GL_UNSIGNED_SHORT_5_5_5_1);
        this.webgl_constants.insert("UNSIGNED_SHORT_5_6_5", GLES2.GL_UNSIGNED_SHORT_5_6_5);
        this.webgl_constants.insert("VALIDATE_STATUS", GLES2.GL_VALIDATE_STATUS);
        this.webgl_constants.insert("VENDOR", GLES2.GL_VENDOR);
        this.webgl_constants.insert("VERSION", GLES2.GL_VERSION);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_BUFFER_BINDING", GLES2.GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_ENABLED", GLES2.GL_VERTEX_ATTRIB_ARRAY_ENABLED);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_NORMALIZED", GLES2.GL_VERTEX_ATTRIB_ARRAY_NORMALIZED);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_POINTER", GLES2.GL_VERTEX_ATTRIB_ARRAY_POINTER);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_SIZE", GLES2.GL_VERTEX_ATTRIB_ARRAY_SIZE);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_STRIDE", GLES2.GL_VERTEX_ATTRIB_ARRAY_STRIDE);
        this.webgl_constants.insert("VERTEX_ATTRIB_ARRAY_TYPE", GLES2.GL_VERTEX_ATTRIB_ARRAY_TYPE);
        this.webgl_constants.insert("VERTEX_SHADER", GLES2.GL_VERTEX_SHADER);
        this.webgl_constants.insert("VIEWPORT", GLES2.GL_VIEWPORT);
        this.webgl_constants.insert("ZERO", GLES2.GL_ZERO);
    }

    public HashTable<string, int> get_webgl_constants()  {
        return this.webgl_constants;
    }

    public void activeTexture(GLES2.GLenum texture) {
        GLES2.glActiveTexture(texture);
    }

    public void attachShader(
        GwebglWebGLProgram program,
        GLES2.GLuint shader)
    {
        GLES2.glAttachShader(program, shader);
    }
    
    public void bindAttribLocation(GwebglWebGLProgram program, uint index, string name)
    {
        GLES2.glBindAttribLocation(program, index, name);
    }
    
    public void bindBuffer(
        GLES2.GLenum target,
        GwebglWebGLBuffer buffer)
    {
        GLES2.glBindBuffer(target, buffer);
    }

    public void bindFramebuffer(GLES2.GLenum target, GwebglWebGLFramebuffer framebuffer)
    {
        GLES2.glBindFramebuffer(target, framebuffer);
    }

    public void bindRenderbuffer(
        GLES2.GLenum target,
        GLES2.GLuint renderbuffer)
    {
        GLES2.glBindRenderbuffer(target, renderbuffer);
    }

    public void bindTexture(
        GLES2.GLenum target,
        GLES2.GLuint texture)
    {
        GLES2.glBindTexture(target, texture);
    }

    public void blendColor(float red, float green, float blue, float alpha) {
        GLES2.glBlendColor(red, green, blue, alpha);
    }

    public void blendEquation(GLES2.GLenum mode) {
        GLES2.glBlendEquation(mode);
    }

    public void blendEquationSeparate(GLES2.GLenum modeRGB, GLES2.GLenum modeAlpha) {
        GLES2.glBlendEquationSeparate(modeRGB, modeAlpha);
    }

    public void blendFunc(
        GLES2.GLenum sfactor,
        GLES2.GLenum dfactor)
    {
        GLES2.glBlendFunc(sfactor, dfactor);
    }

    public void blendFuncSeparate(
        GLES2.GLenum srcRGB,
        GLES2.GLenum dstRGB,
        GLES2.GLenum srcAlpha,
        GLES2.GLenum dstAlpha)
    {
        GLES2.glBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
    }

    public GLES2.GLenum checkFramebufferStatus(GLES2.GLenum target) {
        return GLES2.glCheckFramebufferStatus(target);
    }

    public void clear(GLES2.GLbitfield mask) {
        GLES2.glClear(mask);
    }

    public void clearColor(GLES2.GLclampf red, GLES2.GLclampf green, GLES2.GLclampf blue, GLES2.GLclampf alpha) {
        GLES2.glClearColor(red, green, blue, alpha);
    }

    public void clearDepth(GLES2.GLclampf depth) {
        GLES2.glClearDepthf(depth);
    }

    public void clearStencil(GLES2.GLint s) {
        GLES2.glClearStencil(s);
    }

    public void colorMask(GLES2.GLboolean red, GLES2.GLboolean green, GLES2.GLboolean blue, GLES2.GLboolean alpha) {
        GLES2.glColorMask(red, green, blue, alpha);
    }

    public void compileShader(
        GLES2.GLuint shader)
    {
        GLES2.glCompileShader(shader);
    }

    public void copyTexImage2D(
        GLES2.GLenum target,
        GLES2.GLint level,
        GLES2.GLenum  internalformat,
        GLES2.GLint x,
        GLES2.GLint y,
        GLES2.GLint width,
        GLES2.GLint height,
        GLES2.GLint border)
    {
        GLES2.glCopyTexImage2D(target, level, internalformat, x, y, width, height, border);
    }

    public void copyTexSubImage2D(GLES2.GLenum target, GLES2.GLint level, GLES2.GLint xoffset, GLES2.GLint yoffset, GLES2.GLint x, GLES2.GLint y, GLES2.GLint width, GLES2.GLint height) {
        GLES2.glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
    }

    public GwebglWebGLBuffer[] createBuffer() {
        GwebglWebGLBuffer[] buffers = new GwebglWebGLBuffer[1];
        GLES2.glGenBuffers(1, buffers);
        return buffers;
    }

    public GwebglWebGLFramebuffer[] createFramebuffer() {
        GwebglWebGLFramebuffer[] frameBuffers = new GwebglWebGLFramebuffer[1];
        GLES2.glGenFramebuffers(1, frameBuffers);
        return frameBuffers;
    }

    public GwebglWebGLProgram createProgram() {
        return GLES2.glCreateProgram();
    }

    public GLES2.GLuint[] createRenderbuffer() {
        GLES2.GLuint[] renderbuffers = new GLES2.GLuint[1];
        GLES2.glGenRenderbuffers(1, renderbuffers);
        return renderbuffers;
    }

    public GLES2.GLuint createShader(GLES2.GLenum type) {
        return GLES2.glCreateShader(type);
    }

    public GLES2.GLuint createTexture() {
        // https://github.com/smx-smx/openSage/blob/518dc958156acf2f8bf58f29a35bd2aa89fd1355/src/GLEventHandler.vala#L20
        GLES2.GLuint textures = 1;
        GLES2.glGenTextures(1, &textures);
        return textures;
    }

    public void cullFace(GLES2.GLenum mode) {
        GLES2.glCullFace(mode);
    }

    public void deleteBuffer(GwebglWebGLBuffer[] buffers) {
        GLES2.glDeleteBuffers(1, buffers);
    }

    public void deleteFramebuffer(GwebglWebGLFramebuffer[] framebuffers) {
        GLES2.glDeleteFramebuffers(1, framebuffers);
    }

    public void deleteProgram(GwebglWebGLProgram program) {
        GLES2.glDeleteProgram(program);
    }

    public void deleteRenderbuffer(GLES2.GLuint[] renderbuffers) {
        GLES2.glDeleteRenderbuffers(1, renderbuffers);
    }

    public void deleteShader(GLES2.GLuint shader) {
        GLES2.glDeleteShader(shader);
    }

    public void deleteTexture(GLES2.GLuint[] textures) {
        GLES2.glDeleteTextures(1, textures);
    }

    public void depthFunc(GLES2.GLenum func) {
        GLES2.glDepthFunc(func);
    }

    public void depthMask(GLES2.GLboolean flag) {
        GLES2.glDepthMask(flag);
    }

    public void depthRange(float zNear, float zFar) {
        GLES2.glDepthRangef(zNear, zFar);
    }

    public void detachShader(GwebglWebGLProgram program, GLES2.GLuint shader) {
        GLES2.glDetachShader(program, shader);
    }

    public void disable(GLES2.GLenum cap) {
        GLES2.glDisable(cap);
    }

    public void disableVertexAttribArray(GLES2.GLuint index) {
        GLES2.glDisableVertexAttribArray(index);
    }

    public void drawArrays(GLES2.GLenum mode, GLES2.GLint first, GLES2.GLint count) {
        GLES2.glDrawArrays(mode, first, count);
    }

    public void drawElements(GLES2.GLenum mode, GLES2.GLsizei count, GLES2.GLenum type, GLES2.GLvoid[]? indices) {
        GLES2.glDrawElements(mode, count, type, indices);
    }

    public void enable(GLES2.GLenum cap) {
        GLES2.glEnable(cap);
    }

    public void enableVertexAttribArray(uint index) {
        GLES2.glEnableVertexAttribArray(index);
    }

    public void finish() {
        GLES2.glFinish();
    }

    public void flush() {
        GLES2.glFlush();
    }

    public void framebufferRenderbuffer(
        GLES2.GLenum target,
        GLES2.GLenum attachment,
        GLES2.GLenum renderbuffertarget,
        GLES2.GLuint renderbuffer)
    {
        GLES2.glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer);
    }

    public void framebufferTexture2D(GLES2.GLenum target, GLES2.GLenum attachment, GLES2.GLenum textarget, GLES2.GLuint texture, GLES2.GLint level) {
        GLES2.glFramebufferTexture2D(target, attachment, textarget, texture, level);
    }

    public void frontFace(GLES2.GLenum mode) {
        GLES2.glFrontFace(mode);
    }

    public void generateMipmap(GLES2.GLenum target) {
        GLES2.glGenerateMipmap(target);
    }

    public void getActiveAttrib(GwebglWebGLProgram program, uint index, GLES2.GLint size, GLES2.GLenum type, GLES2.GLchar name) {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei length = 0;

        // TODO

        GLES2.glGetProgramiv(program, GLES2.GL_ACTIVE_ATTRIBUTE_MAX_LENGTH, &bufSize);

        GLES2.glGetActiveAttrib(program, index, bufSize, &length, &size, &type, &name);

        //  if (name != null)
        //  {
        //      if (length < bufSize)
        //      {
        //          buf = realloc(buf, (bufLength + 1) * sizeof(GLES2.GLchar));
        //      }
        //      buf[bufLength] = 0;
        //      *name = buf;
        //  }
        //  else
        //  {
        //      g_free(buf);
        //  }
    }

    public void getActiveUniform(GwebglWebGLProgram program, uint index, GLES2.GLint size, GLES2.GLenum type, GLES2.GLchar name)
    {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei length = 0;

        GLES2.glGetProgramiv(program, GLES2.GL_ACTIVE_UNIFORM_MAX_LENGTH, &bufSize);
        GLES2.glGetActiveUniform(program, index, (GLES2.GLsizei) bufSize, &length, &size, &type, &name);

        // TODO
        //  if (name != null)
        //  {
        //      if (length < bufSize)
        //      {
        //          // buf = realloc(buf, (length + 1) * sizeof(GLES2.GLchar));
        //          buf.resite(length + 1)
        //      }
        //      buf[length] = 0;
        //      *name = buf;
        //  }
        //  else
        //  {
        //      g_free(buf);
        //  }
    }

    public GLES2.GLuint[] getAttachedShaders(GwebglWebGLProgram program) {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei bufLength = 0;

        GLES2.glGetProgramiv(program, GLES2.GL_ATTACHED_SHADERS, &bufSize);
        GLES2.GLuint[] buf = new GLES2.GLuint[bufSize + 1]; //  malloc((bufSize + 1) * sizeof(GLES2.GLuint));
        GLES2.glGetAttachedShaders(program, bufSize, &bufLength, buf);

        //  if (bufLength < bufSize)
        //  {
        //      // buf = realloc(buf, (bufLength + 1) * sizeof(GLES2.GLuint));
        //      buf.resize(bufLength + 1);
        //  }
        //  buf[bufLength] = 0;
        return buf;
    }

    public GLES2.GLint getAttribLocation(GwebglWebGLProgram program, string name) {
        return GLES2.glGetAttribLocation(program, name);
    }

    public GLES2.GLint getBufferParameteriv(
        GLES2.GLenum target,
        GLES2.GLenum pname)
    {
        // TODO this is not an array?
        GLES2.GLint result = 1;
        GLES2.glGetBufferParameteriv(target, pname, &result);
        return result;
    }

    public GLES2.GLint getError() {
        return GLES2.glGetError();
    }

    public GLES2.GLint getFramebufferAttachmentParameter(
        GLES2.GLenum target,
        GLES2.GLenum attachment,
        GLES2.GLenum pname)
    {
        GLES2.GLint result = 1;
        GLES2.glGetFramebufferAttachmentParameteriv(target, attachment, pname, &result);
        return result;
    }

    public GLES2.GLboolean getParameterb(GLES2.GLenum pname) {
        GLES2.GLboolean result = 0;
        GLES2.glGetBooleanv(pname, &result);
        return result;
    }

    public GLES2.GLboolean getParameterbv(GLES2.GLenum pname, int resultSize) {
        GLES2.GLboolean data = 0;
        GLES2.glGetBooleanv(pname, &data);
        return data;
    }

    public GLES2.GLfloat getParameterf(GLES2.GLenum pname) {
        GLES2.GLfloat result = 0;
        GLES2.glGetFloatv(pname, &result);
        return result;
    }

    public GLES2.GLfloat getParameterfv(GLES2.GLenum pname, int resultSize) {
        GLES2.GLfloat data = 0;
        GLES2.glGetFloatv(pname, &data);
        return data;
    }

    public GLES2.GLint getParameteri(GLES2.GLenum pname) {
        GLES2.GLint result = 0;
        GLES2.glGetIntegerv(pname, &result);
        return result;
    }

    public GLES2.GLint getParameteriv(GLES2.GLenum pname, int resultSize) {
        // gpointer data = malloc(resultSize);
        GLES2.GLint data = 0;
        GLES2.glGetIntegerv(pname, &data);
        return data;
    }

    public GLES2.GLchar[] getProgramInfoLog(GwebglWebGLProgram program) {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei bufLength = 0;
        GLES2.glGetProgramiv(program, GLES2.GL_INFO_LOG_LENGTH, &bufSize);
        GLES2.GLchar[] buf = new GLES2.GLchar[bufSize + 1];
        GLES2.glGetProgramInfoLog(program, bufSize, &bufLength, buf);
        if (bufLength < bufSize)
        {
            buf.resize(bufLength + 1);
            // buf = realloc(&buf, (bufLength + 1) * sizeof(char));
        }
        buf[bufLength] = 0;
        return buf;
    }

    public GLES2.GLint getProgramParameter(GwebglWebGLProgram program, GLES2.GLenum pname) {
        GLES2.GLint result = 1;
        GLES2.glGetProgramiv(program, pname, &result);
        return result;
    }

    public GLES2.GLint getRenderbufferParameter(GLES2.GLenum target, GLES2.GLenum pname) {
        GLES2.GLint result = 0;
        GLES2.glGetRenderbufferParameteriv(target, pname, &result);
        return result;
    }

    public GLES2.GLchar[] getShaderInfoLog(GLES2.GLuint shader) {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei bufLength = 0;
        GLES2.glGetShaderiv(shader, GLES2.GL_INFO_LOG_LENGTH, &bufSize);
        // char *buf = malloc((bufSize + 1) * sizeof(char));
        GLES2.GLchar[] buf = new GLES2.GLchar[bufSize + 1];
        GLES2.glGetShaderInfoLog(shader, bufSize, &bufLength, buf);
        if (bufLength < bufSize)
        {
            // buf = realloc(buf, (bufLength + 1) * sizeof(char));
            buf.resize(bufLength + 1);
        }
        buf[bufLength] = 0;
        return buf;
    }

    public GLES2.GLint getShaderParameter(GLES2.GLuint shader, GLES2.GLenum pname) {
        GLES2.GLint result = 1;
        GLES2.glGetShaderiv(shader, pname, &result);
        return result;
    }

    public void getShaderPrecisionFormat(
        GLES2.GLenum shadertype,
        GLES2.GLenum precisiontype,
        GLES2.GLint range_min,
        GLES2.GLint range_max,
        GLES2.GLint precision)
    {
        GLES2.GLint[] range = new GLES2.GLint[2];
        GLES2.glGetShaderPrecisionFormat(shadertype, precisiontype, range, &precision);
        //  if (range_min != null) { range_min = range[0]; }
        //  if (range_max != null) { range_max = range[1]; }
        range_min = range[0];
        range_max = range[1];
    }

    public GLES2.GLchar[] getShaderSource(GLES2.GLuint shader) {
        GLES2.GLint bufSize = 0;
        GLES2.GLsizei bufLength = 0;
        GLES2.glGetShaderiv(shader, GLES2.GL_SHADER_SOURCE_LENGTH, &bufSize);
        // char *buf = malloc((bufSize + 1) * sizeof(char));
        GLES2.GLchar[] buf = new GLES2.GLchar[bufSize + 1];
        GLES2.glGetShaderSource(shader, bufSize, &bufLength, buf);
        // TODO
        //  if (bufLength < bufSize)
        //  {
        //      // buf = realloc(buf, (bufLength + 1) * sizeof(char));
        //      buf.resize(bufLength + 1);
        //  }
        //  buf[bufLength] = 0;
        return buf;
    }

    public string getString(GLES2.GLenum pname) {
        // return (const char *) 
        return GLES2.glGetString(pname);
    }

    public string[] getSupportedExtensions() {
        string result = GLES2.glGetString(GLES2.GL_EXTENSIONS);
        string[] sp = result.split(" ", 0);
        // char **sp = strsplit((const char *) result, " ", 0);
        return sp;
    }

    public GLES2.GLfloat[] getTexParameterfv(GLES2.GLenum target, GLES2.GLenum pname) {
        GLES2.GLfloat[] result = new GLES2.GLfloat[1];
        GLES2.glGetTexParameterfv(target, pname, result);
        return result;
    }

    public GLES2.GLint[] getTexParameteriv(GLES2.GLenum target, GLES2.GLenum pname) {
        GLES2.GLint[] result = new GLES2.GLint[1];
        GLES2.glGetTexParameteriv(target, pname, result);
        return result;
    }

    public GwebglWebGLUniformLocation getUniformLocation(GwebglWebGLProgram program, string name) {
        return GLES2.glGetUniformLocation(program, name);
    }

    public GLES2.GLfloat[] getUniformf(GwebglWebGLProgram program, GwebglWebGLUniformLocation location) {
        GLES2.GLfloat[] result = new GLES2.GLfloat[1];
        GLES2.glGetUniformfv(program, location, result);
        return result;
    }

    public GLES2.GLfloat[] getUniformfv(
        GwebglWebGLProgram program,
        GwebglWebGLUniformLocation location,
        int resultSize)
    {
        // gpointer data = malloc(resultSize);
        GLES2.GLfloat[] data = new GLES2.GLfloat[resultSize];
        GLES2.glGetUniformfv(program, location, data);
        return data;
    }

    public GLES2.GLint[] getUniformi(
        GwebglWebGLProgram program,
        GwebglWebGLUniformLocation location)
    {
        GLES2.GLint[] result = new GLES2.GLint[1];
        GLES2.glGetUniformiv(program, location, result);
        return result;
    }

    public GLES2.GLint[] getUniformiv(
        GwebglWebGLProgram program,
        GwebglWebGLUniformLocation location,
        int resultSize)
    {
        // gpointer data = malloc(resultSize);
        GLES2.GLint[] data = new GLES2.GLint[resultSize];
        GLES2.glGetUniformiv(program, location, data);
        // return new ByteArray.take(data);
        return data;
    }

    public GLES2.GLvoid[] getVertexAttribOffset(
        uint index,
        GLES2.GLenum pname)
    {
        GLES2.GLvoid[] result = new GLES2.GLvoid[0];
        GLES2.glGetVertexAttribPointerv(index, pname, result);
        return result;
    }

    public GLES2.GLfloat[] getVertexAttribf(
        uint index,
        GLES2.GLenum pname)
    {
        GLES2.GLfloat[] result = new GLES2.GLfloat[1];
        GLES2.glGetVertexAttribfv(index, pname, result);
        return result;
    }

    public GLES2.GLfloat[] getVertexAttribfv(
        uint index,
        GLES2.GLenum pname,
        int resultSize)
    {
        // gpointer data = malloc(resultSize);
        GLES2.GLfloat[] data = new GLES2.GLfloat[resultSize];
        GLES2.glGetVertexAttribfv(index, pname, data);
        // return g_byte_array_new_take(data, resultSize);
        return data;
    }

    public GLES2.GLint[] getVertexAttribi(
        GLES2.GLuint index,
        GLES2.GLenum pname)
    {
        GLES2.GLint[] result = new GLES2.GLint[1];
        GLES2.glGetVertexAttribiv(index, pname, result);
        return result;
    }

    public void hint(
        GLES2.GLenum target,
        GLES2.GLenum mode)
    {
        GLES2.glHint(target, mode);
    }

    public GLES2.GLboolean isBuffer(GwebglWebGLBuffer buffer) {
        return GLES2.glIsBuffer(buffer);
    }

    public GLES2.GLboolean isEnabled(GLES2.GLenum cap) {
        return GLES2.glIsEnabled(cap);
    }

    public GLES2.GLboolean isFramebuffer(GwebglWebGLFramebuffer framebuffer) {
        return GLES2.glIsFramebuffer(framebuffer);
    }

    public GLES2.GLboolean isProgram(
        GwebglWebGLProgram program)
    {
        return GLES2.glIsProgram(program);
    }

    public GLES2.GLboolean isRenderbuffer(
        GLES2.GLuint renderbuffer)
    {
        return GLES2.glIsRenderbuffer(renderbuffer);
    }

    public GLES2.GLboolean isShader(
        GLES2.GLuint shader)
    {
        return GLES2.glIsShader(shader);
    }

    public GLES2.GLboolean isTexture(
        GLES2.GLuint texture)
    {
        return GLES2.glIsTexture(texture);
    }

    public void lineWidth(
        float width)
    {
        GLES2.glLineWidth(width);
    }

    public void linkProgram(
        GwebglWebGLProgram program)
    {
        GLES2.glLinkProgram(program);
    }

    public void pixelStorei(
        GLES2.GLenum pname,
        int param)
    {
        GLES2.glPixelStorei(pname, param);
    }

    public void polygonOffset(
        float factor,
        float units)
    {
        GLES2.glPolygonOffset(factor, units);
    }

    public void renderbufferStorage(
        GLES2.GLenum target,
        GLES2.GLenum internalformat,
        GLES2.GLsizei width,
        GLES2.GLsizei height)
    {
        GLES2.glRenderbufferStorage(target, internalformat, width, height);
    }

    public void sampleCoverage(
        GLES2.GLclampf value,
        GLES2.GLboolean invert)
    {
        GLES2.glSampleCoverage(value, invert);
    }

    public void scissor(
        int x,
        int y,
        int width,
        int height)
    {
        GLES2.glScissor(x, y, width, height);
    }

    public void shaderSource(
        GLES2.GLuint shader,
        string[] source)
    {
        stderr.printf("Not implemented shaderSource");
        // TODO GLES2.glShaderSource(shader, source, source.length);
    }

    public void stencilFunc(
        GLES2.GLenum func,
        GLES2.GLint ref_,
        GLES2.GLuint mask)
    {
        GLES2.glStencilFunc(func, ref_, mask);
    }

    public void stencilFuncSeparate(
        GLES2.GLenum face,
        GLES2.GLenum func,
        GLES2.GLint ref_,
        GLES2.GLuint mask)
    {
        GLES2.glStencilFuncSeparate(face, func, ref_, mask);
    }

    public void stencilMask(
        GLES2.GLuint mask)
    {
        GLES2.glStencilMask(mask);
    }

    public void stencilMaskSeparate(
        GLES2.GLenum face,
        GLES2.GLuint mask)
    {
        GLES2.glStencilMaskSeparate(face, mask);
    }

    public void stencilOp(
        GLES2.GLenum fail,
        GLES2.GLenum zfail,
        GLES2.GLenum zpass)
    {
        GLES2.glStencilOp(fail, zfail, zpass);
    }

    public void stencilOpSeparate(
        GLES2.GLenum face,
        GLES2.GLenum fail,
        GLES2.GLenum zfail,
        GLES2.GLenum zpass)
    {
        GLES2.glStencilOpSeparate(face, fail, zfail, zpass);
    }

    public void texParameterf(
        GLES2.GLenum target,
        GLES2.GLenum pname,
        GLES2.GLfloat param)
    {
        GLES2.glTexParameterf(target, pname, param);
    }

    public void texParameteri(
        GLES2.GLenum target,
        GLES2.GLenum pname,
        GLES2.GLint param)
    {
        GLES2.glTexParameteri(target, pname, param);
    }

    public void uniform1f(
        GwebglWebGLUniformLocation location,
        float x)
    {
        GLES2.glUniform1f(location, x);
    }

    public void uniform1i(
        GwebglWebGLUniformLocation location,
        int x)
    {
        GLES2.glUniform1i(location, x);
    }

    public void uniform2f(
        GwebglWebGLUniformLocation location,
        float x,
        float y)
    {
        GLES2.glUniform2f(location, x, y);
    }

    public void uniform2i(
        GwebglWebGLUniformLocation location,
        int x,
        int y)
    {
        GLES2.glUniform2i(location, x, y);
    }

    public void uniform3f(
        GwebglWebGLUniformLocation location,
        float x,
        float y,
        float z)
    {
        GLES2.glUniform3f(location, x, y, z);
    }

    public void uniform3i(
        GwebglWebGLUniformLocation location,
        int x,
        int y,
        int z)
    {
        GLES2.glUniform3i(location, x, y, z);
    }

    public void uniform4f(
        GwebglWebGLUniformLocation location,
        float x,
        float y,
        float z,
        float w)
    {
        GLES2.glUniform4f(location, x, y, z, w);
    }

    public void uniform4i(
        GwebglWebGLUniformLocation location,
        int x,
        int y,
        int z,
        int w)
    {
        GLES2.glUniform4i(location, x, y, z, w);
    }

    public void useProgram(
        GwebglWebGLProgram program)
    {
        GLES2.glUseProgram(program);
    }

    public void validateProgram(
        GwebglWebGLProgram program)
    {
        GLES2.glValidateProgram(program);
    }

    public void vertexAttrib1f(
        uint index,
        float x)
    {
        GLES2.glVertexAttrib1f(index, x);
    }

    public void vertexAttrib1fv(
        uint index,
        GLES2.GLfloat[]? v)
    {
        GLES2.glVertexAttrib1fv(index, v);
    }

    public void vertexAttrib2f(
        uint index,
        float x,
        float y)
    {
        GLES2.glVertexAttrib2f(index, x, y);
    }

    public void vertexAttrib2fv(
        uint index,
        GLES2.GLfloat[]? v)
    {
        GLES2.glVertexAttrib2fv(index, v);
    }
    

    public void vertexAttrib3f(
        GLES2.GLuint index,
        GLES2.GLfloat x,
        GLES2.GLfloat y,
        GLES2.GLfloat z)
    {
        GLES2.glVertexAttrib3f(index, x, y, z);
    }

    public void vertexAttrib3fv(
        GLES2.GLuint index,
        GLES2.GLfloat[]? v)
    {
        GLES2.glVertexAttrib3fv(index, v);
    }

    public void vertexAttrib4f(
        GLES2.GLuint index,
        GLES2.GLfloat x,
        GLES2.GLfloat y,
        GLES2.GLfloat z,
        GLES2.GLfloat w)
    {
        GLES2.glVertexAttrib4f(index, x, y, z, w);
    }

    public void vertexAttrib4fv(
        GLES2.GLuint index,
        GLES2.GLfloat[]? v)
    {
        GLES2.glVertexAttrib4fv(index, v);
    }

    public void vertexAttribPointer(
        GLES2.GLuint index,
        GLES2.GLint size,
        GLES2.GLenum type,
        GLES2.GLboolean normalized,
        GLES2.GLint stride,
        GLES2.GLvoid[]? offset)
    {
        GLES2.glVertexAttribPointer(index, size, type, normalized, stride, offset);
    }

    public void viewport(
        GLES2.GLint x,
        GLES2.GLint y,
        GLES2.GLint width,
        GLES2.GLint height)
    {
        GLES2.glViewport(x, y, width, height);
    }

}
}