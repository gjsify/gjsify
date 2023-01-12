import { describe, it, expect } from '@gjsify/unit';

import { GjsifyWebGLRenderingContext, HTMLCanvasElement } from './index.js';
import Gtk from '@gjsify/types/Gtk-4.0';
import Gio from '@gjsify/types/Gio-2.0';

const GL_CONSTANT_NAMES = ['ACTIVE_ATTRIBUTES', 'ACTIVE_TEXTURE', 'ACTIVE_UNIFORMS', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE', 'ALPHA', 'ALPHA_BITS', 'ALWAYS', 'ARRAY_BUFFER', 'ARRAY_BUFFER_BINDING', 'ATTACHED_SHADERS', 'BACK', 'BLEND', 'BLEND_COLOR', 'BLEND_DST_ALPHA', 'BLEND_DST_RGB', 'BLEND_EQUATION', 'BLEND_EQUATION_ALPHA', 'BLEND_EQUATION_RGB', 'BLEND_SRC_ALPHA', 'BLEND_SRC_RGB', 'BLUE_BITS', 'BOOL', 'BOOL_VEC2', 'BOOL_VEC3', 'BOOL_VEC4', 'BROWSER_DEFAULT_WEBGL', 'BUFFER_SIZE', 'BUFFER_USAGE', 'BYTE', 'CCW', 'CLAMP_TO_EDGE', 'COLOR_ATTACHMENT0', 'COLOR_BUFFER_BIT', 'COLOR_CLEAR_VALUE', 'COLOR_WRITEMASK', 'COMPILE_STATUS', 'COMPRESSED_TEXTURE_FORMATS', 'CONSTANT_ALPHA', 'CONSTANT_COLOR', 'CONTEXT_LOST_WEBGL', 'CULL_FACE', 'CULL_FACE_MODE', 'CURRENT_PROGRAM', 'CURRENT_VERTEX_ATTRIB', 'CW', 'DECR', 'DECR_WRAP', 'DELETE_STATUS', 'DEPTH_ATTACHMENT', 'DEPTH_BITS', 'DEPTH_BUFFER_BIT', 'DEPTH_CLEAR_VALUE', 'DEPTH_COMPONENT', 'DEPTH_COMPONENT16', 'DEPTH_FUNC', 'DEPTH_RANGE', 'DEPTH_STENCIL', 'DEPTH_STENCIL_ATTACHMENT', 'DEPTH_TEST', 'DEPTH_WRITEMASK', 'DITHER', 'DONT_CARE', 'DST_ALPHA', 'DST_COLOR', 'DYNAMIC_DRAW', 'ELEMENT_ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER_BINDING', 'EQUAL', 'FASTEST', 'FLOAT', 'FLOAT_MAT2', 'FLOAT_MAT3', 'FLOAT_MAT4', 'FLOAT_VEC2', 'FLOAT_VEC3', 'FLOAT_VEC4', 'FRAGMENT_SHADER', 'FRAMEBUFFER', 'FRAMEBUFFER_ATTACHMENT_OBJECT_NAME', 'FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE', 'FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE', 'FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL', 'FRAMEBUFFER_BINDING', 'FRAMEBUFFER_COMPLETE', 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT', 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS', 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT', 'FRAMEBUFFER_UNSUPPORTED', 'FRONT', 'FRONT_AND_BACK', 'FRONT_FACE', 'FUNC_ADD', 'FUNC_REVERSE_SUBTRACT', 'FUNC_SUBTRACT', 'GENERATE_MIPMAP_HINT', 'GEQUAL', 'GREATER', 'GREEN_BITS', 'HIGH_FLOAT', 'HIGH_INT', 'IMPLEMENTATION_COLOR_READ_FORMAT', 'IMPLEMENTATION_COLOR_READ_TYPE', 'INCR', 'INCR_WRAP', 'INT', 'INT_VEC2', 'INT_VEC3', 'INT_VEC4', 'INVALID_ENUM', 'INVALID_FRAMEBUFFER_OPERATION', 'INVALID_OPERATION', 'INVALID_VALUE', 'INVERT', 'KEEP', 'LEQUAL', 'LESS', 'LINEAR', 'LINEAR_MIPMAP_LINEAR', 'LINEAR_MIPMAP_NEAREST', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'LINE_WIDTH', 'LINK_STATUS', 'LOW_FLOAT', 'LOW_INT', 'LUMINANCE', 'LUMINANCE_ALPHA', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_RENDERBUFFER_SIZE', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_SIZE', 'MAX_VARYING_VECTORS', 'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VIEWPORT_DIMS', 'MEDIUM_FLOAT', 'MEDIUM_INT', 'MIRRORED_REPEAT', 'NEAREST', 'NEAREST_MIPMAP_LINEAR', 'NEAREST_MIPMAP_NEAREST', 'NEVER', 'NICEST', 'NONE', 'NOTEQUAL', 'NO_ERROR', 'ONE', 'ONE_MINUS_CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_COLOR', 'ONE_MINUS_DST_ALPHA', 'ONE_MINUS_DST_COLOR', 'ONE_MINUS_SRC_ALPHA', 'ONE_MINUS_SRC_COLOR', 'OUT_OF_MEMORY', 'PACK_ALIGNMENT', 'POINTS', 'POLYGON_OFFSET_FACTOR', 'POLYGON_OFFSET_FILL', 'POLYGON_OFFSET_UNITS', 'RED_BITS', 'RENDERBUFFER', 'RENDERBUFFER_ALPHA_SIZE', 'RENDERBUFFER_BINDING', 'RENDERBUFFER_BLUE_SIZE', 'RENDERBUFFER_DEPTH_SIZE', 'RENDERBUFFER_GREEN_SIZE', 'RENDERBUFFER_HEIGHT', 'RENDERBUFFER_INTERNAL_FORMAT', 'RENDERBUFFER_RED_SIZE', 'RENDERBUFFER_STENCIL_SIZE', 'RENDERBUFFER_WIDTH', 'RENDERER', 'REPEAT', 'REPLACE', 'RGB', 'RGB565', 'RGB5_A1', 'RGBA', 'RGBA4', 'SAMPLER_2D', 'SAMPLER_CUBE', 'SAMPLES', 'SAMPLE_ALPHA_TO_COVERAGE', 'SAMPLE_BUFFERS', 'SAMPLE_COVERAGE', 'SAMPLE_COVERAGE_INVERT', 'SAMPLE_COVERAGE_VALUE', 'SCISSOR_BOX', 'SCISSOR_TEST', 'SHADER_TYPE', 'SHADING_LANGUAGE_VERSION', 'SHORT', 'SRC_ALPHA', 'SRC_ALPHA_SATURATE', 'SRC_COLOR', 'STATIC_DRAW', 'STENCIL_ATTACHMENT', 'STENCIL_BACK_FAIL', 'STENCIL_BACK_FUNC', 'STENCIL_BACK_PASS_DEPTH_FAIL', 'STENCIL_BACK_PASS_DEPTH_PASS', 'STENCIL_BACK_REF', 'STENCIL_BACK_VALUE_MASK', 'STENCIL_BACK_WRITEMASK', 'STENCIL_BITS', 'STENCIL_BUFFER_BIT', 'STENCIL_CLEAR_VALUE', 'STENCIL_FAIL', 'STENCIL_FUNC', 'STENCIL_INDEX8', 'STENCIL_PASS_DEPTH_FAIL', 'STENCIL_PASS_DEPTH_PASS', 'STENCIL_REF', 'STENCIL_TEST', 'STENCIL_VALUE_MASK', 'STENCIL_WRITEMASK', 'STREAM_DRAW', 'SUBPIXEL_BITS', 'TEXTURE', 'TEXTURE0', 'TEXTURE1', 'TEXTURE10', 'TEXTURE11', 'TEXTURE12', 'TEXTURE13', 'TEXTURE14', 'TEXTURE15', 'TEXTURE16', 'TEXTURE17', 'TEXTURE18', 'TEXTURE19', 'TEXTURE2', 'TEXTURE20', 'TEXTURE21', 'TEXTURE22', 'TEXTURE23', 'TEXTURE24', 'TEXTURE25', 'TEXTURE26', 'TEXTURE27', 'TEXTURE28', 'TEXTURE29', 'TEXTURE3', 'TEXTURE30', 'TEXTURE31', 'TEXTURE4', 'TEXTURE5', 'TEXTURE6', 'TEXTURE7', 'TEXTURE8', 'TEXTURE9', 'TEXTURE_2D', 'TEXTURE_BINDING_2D', 'TEXTURE_BINDING_CUBE_MAP', 'TEXTURE_CUBE_MAP', 'TEXTURE_CUBE_MAP_NEGATIVE_X', 'TEXTURE_CUBE_MAP_NEGATIVE_Y', 'TEXTURE_CUBE_MAP_NEGATIVE_Z', 'TEXTURE_CUBE_MAP_POSITIVE_X', 'TEXTURE_CUBE_MAP_POSITIVE_Y', 'TEXTURE_CUBE_MAP_POSITIVE_Z', 'TEXTURE_MAG_FILTER', 'TEXTURE_MIN_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TRIANGLES', 'TRIANGLE_FAN', 'TRIANGLE_STRIP', 'UNPACK_ALIGNMENT', 'UNPACK_COLORSPACE_CONVERSION_WEBGL', 'UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNSIGNED_BYTE', 'UNSIGNED_INT', 'UNSIGNED_SHORT', 'UNSIGNED_SHORT_4_4_4_4', 'UNSIGNED_SHORT_5_5_5_1', 'UNSIGNED_SHORT_5_6_5', 'VALIDATE_STATUS', 'VENDOR', 'VERSION', 'VERTEX_ATTRIB_ARRAY_BUFFER_BINDING', 'VERTEX_ATTRIB_ARRAY_ENABLED', 'VERTEX_ATTRIB_ARRAY_NORMALIZED', 'VERTEX_ATTRIB_ARRAY_POINTER', 'VERTEX_ATTRIB_ARRAY_SIZE', 'VERTEX_ATTRIB_ARRAY_STRIDE', 'VERTEX_ATTRIB_ARRAY_TYPE', 'VERTEX_SHADER', 'VIEWPORT', 'ZERO'];




export default async () => {

	let app: Gtk.Application;
	let win: Gtk.ApplicationWindow;
	let glArea: Gtk.GLArea;
	let canvas: HTMLCanvasElement;
	let ctx: GjsifyWebGLRenderingContext | null;

	const initApp = async () => {
		Gtk.init();
	
		app = new Gtk.Application({
			application_id: 'gjsify.webgl.index.spec.ts',
			flags: Gio.ApplicationFlags.FLAGS_NONE,
		});

		const p = new Promise<Gtk.Application>((resolve) => {
			app.connect('activate', () => {
				resolve(app);
			});
		});
	
		win = new Gtk.ApplicationWindow(app);
		win.set_default_size(800, 600);

		app.run([]);

		return p;
	}

	const initGLArea = async () => {
		glArea = new Gtk.GLArea({});

		const p = new Promise<Gtk.GLArea>((resolve, reject) => {
			glArea.connect('realize', () => {
				glArea.make_current();
				const error = glArea.get_error();
				if (error) {
					reject(error);
				}
				resolve(glArea);
			});
		});

		glArea.set_use_es(true);
		glArea.set_has_depth_buffer(true);
		glArea.set_has_stencil_buffer(true);
		glArea.set_required_version(3, 2);
		
		win.set_child(glArea);
		win.present();

		return p;
	}

	await describe('Gtk.ApplicationWindow', async () => {
		await it('should be able to create a new instance', async () => {
			app = await initApp();
			expect(app).toBeDefined();
		});
	})

	await describe('Gtk.GLArea', async () => {
		await it('should be able to create a new instance', async () => {
			glArea = await initGLArea();
			expect(glArea).toBeDefined();
		});
	})

	await describe('HTMLCanvasElement', async () => {
		await it('should be defined', async () => {
			expect(HTMLCanvasElement).toBeDefined();
		});

		await it('should be able to create a new instance', async () => {
			
			expect(() => {
				canvas = new HTMLCanvasElement(glArea);
			}).not.toThrow();

			expect(canvas).toBeDefined();
		});

		await it('should be able to get a webgl context', async () => {
			expect(() => {
				ctx = canvas.getContext("webgl");
			}).not.toThrow();

			expect(ctx).toBeDefined();
		});
	});

	await describe('WebGLRenderingContext', async () => {
		await it('should have defined WebGL constants', async () => {

			for (const GL_CONSTANT_NAME of GL_CONSTANT_NAMES) {
				const constant = ctx?.[GL_CONSTANT_NAME];
				console.log(GL_CONSTANT_NAME, constant)
				expect(typeof constant).toBe("number");
				if(GL_CONSTANT_NAME === 'NONE' || GL_CONSTANT_NAME === 'ZERO' || GL_CONSTANT_NAME === 'NO_ERROR' || GL_CONSTANT_NAME === 'POINTS') {
					expect(constant === 0).toBeTruthy();
				} else {
					expect(constant > 0).toBeTruthy();
				}
			}
		});
	});

	await describe('Gwebgl.WebGLRenderingContext', async () => {
		await it('getParameterb should return a boolean', async () => {
			const res = ctx?._native.getParameterb(ctx?.BLEND)
			console.log("res", res);
			expect(typeof res).toBe("boolean");
		});

		await it('getParameterbv should return an array of boolean', async () => {
			const results = ctx?._native.getParameterbv(ctx?.COLOR_WRITEMASK, 16)
			console.log("results", results);

			expect(Array.isArray(results)).toBeTruthy();

			if(Array.isArray(results)) {
				for (const res of results) {
					expect(typeof res).toBe("boolean");
				}
			}
		});

		await it('getParameterf should return a float number', async () => {
			const result = ctx?._native.getParameterf(ctx?.SAMPLE_COVERAGE_VALUE)
			console.log("result", result);
			
			expect(typeof result).toBe("number");
		});

		await it('getParameterfv should return an array of float numbers', async () => {
			const results = ctx?._native.getParameterfv(ctx?.DEPTH_RANGE, 8)
			console.log("results", results);
			
			expect(Array.isArray(results)).toBeTruthy();

			if(Array.isArray(results)) {
				for (const res of results) {
					expect(typeof res).toBe("number");
				}
			}
		});

		await it('getParameteri should return a integer number', async () => {
			const result = ctx?._native.getParameteri(ctx?.ARRAY_BUFFER_BINDING)
			console.log("result", result);
			
			expect(typeof result).toBe("number");
		});

		await it('getParameteriv should return an array of integer numbers', async () => {
			const results = ctx?._native.getParameteriv(ctx?.MAX_VIEWPORT_DIMS, 8)
			console.log("results", results, typeof (results));
			
			expect(Array.isArray(results)).toBeTruthy();

			if(Array.isArray(results)) {
				for (const res of results) {
					expect(typeof res).toBe("number");
				}
			}
		});
	});


}
