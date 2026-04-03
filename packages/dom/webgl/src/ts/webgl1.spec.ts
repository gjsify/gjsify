// WebGL1 tests — exercises WebGLRenderingContext (WebGL 1.0) backed by GTK GLArea.
// Reference: refs/headless-gl/test/ (buffers, programs, simple-shader, extensions, textures)
// Ported from headless-gl. Copyright (c) stackgl contributors. MIT license.
// Modifications: Uses @gjsify/unit, CanvasWebGLWidget widget, GTK-backed context instead of EGL headless.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';

import { WebGLRenderingContext, CanvasWebGLWidget } from '@gjsify/webgl';
import { makeProgram, drawTriangle, readPixel, pixelClose,
         makeTestFBO, destroyTestFBO, makeTestFBOWithDepth, destroyTestFBOWithDepth } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

const GL_CONSTANT_NAMES = ['ACTIVE_ATTRIBUTES', 'ACTIVE_TEXTURE', 'ACTIVE_UNIFORMS', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE', 'ALPHA', 'ALPHA_BITS', 'ALWAYS', 'ARRAY_BUFFER', 'ARRAY_BUFFER_BINDING', 'ATTACHED_SHADERS', 'BACK', 'BLEND', 'BLEND_COLOR', 'BLEND_DST_ALPHA', 'BLEND_DST_RGB', 'BLEND_EQUATION', 'BLEND_EQUATION_ALPHA', 'BLEND_EQUATION_RGB', 'BLEND_SRC_ALPHA', 'BLEND_SRC_RGB', 'BLUE_BITS', 'BOOL', 'BOOL_VEC2', 'BOOL_VEC3', 'BOOL_VEC4', 'BROWSER_DEFAULT_WEBGL', 'BUFFER_SIZE', 'BUFFER_USAGE', 'BYTE', 'CCW', 'CLAMP_TO_EDGE', 'COLOR_ATTACHMENT0', 'COLOR_BUFFER_BIT', 'COLOR_CLEAR_VALUE', 'COLOR_WRITEMASK', 'COMPILE_STATUS', 'COMPRESSED_TEXTURE_FORMATS', 'CONSTANT_ALPHA', 'CONSTANT_COLOR', 'CONTEXT_LOST_WEBGL', 'CULL_FACE', 'CULL_FACE_MODE', 'CURRENT_PROGRAM', 'CURRENT_VERTEX_ATTRIB', 'CW', 'DECR', 'DECR_WRAP', 'DELETE_STATUS', 'DEPTH_ATTACHMENT', 'DEPTH_BITS', 'DEPTH_BUFFER_BIT', 'DEPTH_CLEAR_VALUE', 'DEPTH_COMPONENT', 'DEPTH_COMPONENT16', 'DEPTH_FUNC', 'DEPTH_RANGE', 'DEPTH_STENCIL', 'DEPTH_STENCIL_ATTACHMENT', 'DEPTH_TEST', 'DEPTH_WRITEMASK', 'DITHER', 'DONT_CARE', 'DST_ALPHA', 'DST_COLOR', 'DYNAMIC_DRAW', 'ELEMENT_ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER_BINDING', 'EQUAL', 'FASTEST', 'FLOAT', 'FLOAT_MAT2', 'FLOAT_MAT3', 'FLOAT_MAT4', 'FLOAT_VEC2', 'FLOAT_VEC3', 'FLOAT_VEC4', 'FRAGMENT_SHADER', 'FRAMEBUFFER', 'FRAMEBUFFER_ATTACHMENT_OBJECT_NAME', 'FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE', 'FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE', 'FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL', 'FRAMEBUFFER_BINDING', 'FRAMEBUFFER_COMPLETE', 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT', 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS', 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT', 'FRAMEBUFFER_UNSUPPORTED', 'FRONT', 'FRONT_AND_BACK', 'FRONT_FACE', 'FUNC_ADD', 'FUNC_REVERSE_SUBTRACT', 'FUNC_SUBTRACT', 'GENERATE_MIPMAP_HINT', 'GEQUAL', 'GREATER', 'GREEN_BITS', 'HIGH_FLOAT', 'HIGH_INT', 'IMPLEMENTATION_COLOR_READ_FORMAT', 'IMPLEMENTATION_COLOR_READ_TYPE', 'INCR', 'INCR_WRAP', 'INT', 'INT_VEC2', 'INT_VEC3', 'INT_VEC4', 'INVALID_ENUM', 'INVALID_FRAMEBUFFER_OPERATION', 'INVALID_OPERATION', 'INVALID_VALUE', 'INVERT', 'KEEP', 'LEQUAL', 'LESS', 'LINEAR', 'LINEAR_MIPMAP_LINEAR', 'LINEAR_MIPMAP_NEAREST', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'LINE_WIDTH', 'LINK_STATUS', 'LOW_FLOAT', 'LOW_INT', 'LUMINANCE', 'LUMINANCE_ALPHA', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_RENDERBUFFER_SIZE', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_SIZE', 'MAX_VARYING_VECTORS', 'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VIEWPORT_DIMS', 'MEDIUM_FLOAT', 'MEDIUM_INT', 'MIRRORED_REPEAT', 'NEAREST', 'NEAREST_MIPMAP_LINEAR', 'NEAREST_MIPMAP_NEAREST', 'NEVER', 'NICEST', 'NONE', 'NOTEQUAL', 'NO_ERROR', 'ONE', 'ONE_MINUS_CONSTANT_ALPHA', 'ONE_MINUS_CONSTANT_COLOR', 'ONE_MINUS_DST_ALPHA', 'ONE_MINUS_DST_COLOR', 'ONE_MINUS_SRC_ALPHA', 'ONE_MINUS_SRC_COLOR', 'OUT_OF_MEMORY', 'PACK_ALIGNMENT', 'POINTS', 'POLYGON_OFFSET_FACTOR', 'POLYGON_OFFSET_FILL', 'POLYGON_OFFSET_UNITS', 'RED_BITS', 'RENDERBUFFER', 'RENDERBUFFER_ALPHA_SIZE', 'RENDERBUFFER_BINDING', 'RENDERBUFFER_BLUE_SIZE', 'RENDERBUFFER_DEPTH_SIZE', 'RENDERBUFFER_GREEN_SIZE', 'RENDERBUFFER_HEIGHT', 'RENDERBUFFER_INTERNAL_FORMAT', 'RENDERBUFFER_RED_SIZE', 'RENDERBUFFER_STENCIL_SIZE', 'RENDERBUFFER_WIDTH', 'RENDERER', 'REPEAT', 'REPLACE', 'RGB', 'RGB565', 'RGB5_A1', 'RGBA', 'RGBA4', 'SAMPLER_2D', 'SAMPLER_CUBE', 'SAMPLES', 'SAMPLE_ALPHA_TO_COVERAGE', 'SAMPLE_BUFFERS', 'SAMPLE_COVERAGE', 'SAMPLE_COVERAGE_INVERT', 'SAMPLE_COVERAGE_VALUE', 'SCISSOR_BOX', 'SCISSOR_TEST', 'SHADER_TYPE', 'SHADING_LANGUAGE_VERSION', 'SHORT', 'SRC_ALPHA', 'SRC_ALPHA_SATURATE', 'SRC_COLOR', 'STATIC_DRAW', 'STENCIL_ATTACHMENT', 'STENCIL_BACK_FAIL', 'STENCIL_BACK_FUNC', 'STENCIL_BACK_PASS_DEPTH_FAIL', 'STENCIL_BACK_PASS_DEPTH_PASS', 'STENCIL_BACK_REF', 'STENCIL_BACK_VALUE_MASK', 'STENCIL_BACK_WRITEMASK', 'STENCIL_BITS', 'STENCIL_BUFFER_BIT', 'STENCIL_CLEAR_VALUE', 'STENCIL_FAIL', 'STENCIL_FUNC', 'STENCIL_INDEX8', 'STENCIL_PASS_DEPTH_FAIL', 'STENCIL_PASS_DEPTH_PASS', 'STENCIL_REF', 'STENCIL_TEST', 'STENCIL_VALUE_MASK', 'STENCIL_WRITEMASK', 'STREAM_DRAW', 'SUBPIXEL_BITS', 'TEXTURE', 'TEXTURE0', 'TEXTURE1', 'TEXTURE10', 'TEXTURE11', 'TEXTURE12', 'TEXTURE13', 'TEXTURE14', 'TEXTURE15', 'TEXTURE16', 'TEXTURE17', 'TEXTURE18', 'TEXTURE19', 'TEXTURE2', 'TEXTURE20', 'TEXTURE21', 'TEXTURE22', 'TEXTURE23', 'TEXTURE24', 'TEXTURE25', 'TEXTURE26', 'TEXTURE27', 'TEXTURE28', 'TEXTURE29', 'TEXTURE3', 'TEXTURE30', 'TEXTURE31', 'TEXTURE4', 'TEXTURE5', 'TEXTURE6', 'TEXTURE7', 'TEXTURE8', 'TEXTURE9', 'TEXTURE_2D', 'TEXTURE_BINDING_2D', 'TEXTURE_BINDING_CUBE_MAP', 'TEXTURE_CUBE_MAP', 'TEXTURE_CUBE_MAP_NEGATIVE_X', 'TEXTURE_CUBE_MAP_NEGATIVE_Y', 'TEXTURE_CUBE_MAP_NEGATIVE_Z', 'TEXTURE_CUBE_MAP_POSITIVE_X', 'TEXTURE_CUBE_MAP_POSITIVE_Y', 'TEXTURE_CUBE_MAP_POSITIVE_Z', 'TEXTURE_MAG_FILTER', 'TEXTURE_MIN_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TRIANGLES', 'TRIANGLE_FAN', 'TRIANGLE_STRIP', 'UNPACK_ALIGNMENT', 'UNPACK_COLORSPACE_CONVERSION_WEBGL', 'UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL', 'UNSIGNED_BYTE', 'UNSIGNED_INT', 'UNSIGNED_SHORT', 'UNSIGNED_SHORT_4_4_4_4', 'UNSIGNED_SHORT_5_5_5_1', 'UNSIGNED_SHORT_5_6_5', 'VALIDATE_STATUS', 'VENDOR', 'VERSION', 'VERTEX_ATTRIB_ARRAY_BUFFER_BINDING', 'VERTEX_ATTRIB_ARRAY_ENABLED', 'VERTEX_ATTRIB_ARRAY_NORMALIZED', 'VERTEX_ATTRIB_ARRAY_POINTER', 'VERTEX_ATTRIB_ARRAY_SIZE', 'VERTEX_ATTRIB_ARRAY_STRIDE', 'VERTEX_ATTRIB_ARRAY_TYPE', 'VERTEX_SHADER', 'VIEWPORT', 'ZERO'];

export default async () => {

	await on('Display', async () => {

	Gtk.init();

	let glArea!: CanvasWebGLWidget;
	let gl!: WebGLRenderingContext;

	// Use a bare Gtk.Window + GLib.MainLoop to obtain the GL context.
	// This avoids nesting Gtk.Application.run() inside @gjsify/unit's mainloop, which
	// prevents microtask continuations (await describe/it) from draining properly.
	const readyLoop = new GLib.MainLoop(null, false);

	const win = new Gtk.Window({});
	win.set_default_size(200, 200);

	glArea = new CanvasWebGLWidget();
	glArea.onReady((_c: globalThis.HTMLCanvasElement, g: globalThis.WebGLRenderingContext) => {
		gl = g as unknown as WebGLRenderingContext;
		readyLoop.quit();  // Release the setup loop; tests will run after it returns.
	});

	win.set_child(glArea);
	win.present();

	// Safety net: give up if GL context never becomes ready (e.g. compositor unavailable).
	const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
		readyLoop.quit();
		return GLib.SOURCE_REMOVE;
	});

	// Blocks until onReady fires (or 10s timeout).
	// After this returns, gl is set and the window is still alive with a valid GL context.
	readyLoop.run();
	GLib.source_remove(giveUpId);

	if (!gl) {
		console.warn('WebGL context not available after 10s — skipping tests');
		win.destroy();
		return;
	}

	// Re-bind the GL context for calls outside the render signal.
	// This must be called before any GL functions below.
	glArea.make_current();

	// -- WebGL Constants --

	await describe('WebGLRenderingContext constants', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('should have all standard WebGL constants as numbers', async () => {
			for (const name of GL_CONSTANT_NAMES) {
				const value = (gl as any)?.[name];
				expect(typeof value).toBe('number');
				if (name === 'NONE' || name === 'ZERO' || name === 'NO_ERROR' || name === 'POINTS') {
					expect(value === 0).toBeTruthy();
				} else {
					expect(value > 0).toBeTruthy();
				}
			}
		});
	});

	// -- Buffers (ported from refs/headless-gl/test/buffers.js) --

	await describe('Buffers', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('createBuffer returns a WebGLBuffer', async () => {
			const buf = gl.createBuffer();
			expect(buf).toBeDefined();
			expect(buf).not.toBeNull();
		});

		await it('bindBuffer + bufferData with Float32Array', async () => {
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			const data = new Float32Array([1, 2, 3, 4]);
			expect(() => gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)).not.toThrow();
		});

		await it('getBufferParameter returns buffer size', async () => {
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			const data = new Float32Array([1, 2, 3, 4]);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			const size = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
			expect(size).toBe(data.byteLength);
		});

		await it('bufferSubData updates buffer data', async () => {
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			const data = new Float32Array([1, 2, 3, 4]);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
			expect(() => gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([9, 9]))).not.toThrow();
		});

		await it('deleteBuffer cleans up', async () => {
			const buf = gl.createBuffer();
			expect(() => gl.deleteBuffer(buf)).not.toThrow();
		});
	});

	// -- Shaders (ported from refs/headless-gl/test/simple-shader.js, programs.js) --

	await describe('Shaders', async () => {
		beforeEach(async () => { glArea.make_current(); });
		const vertSrc = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
		const fragSrc = 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }';

		await it('createShader returns a WebGLShader', async () => {
			const shader = gl.createShader(gl.VERTEX_SHADER);
			expect(shader).toBeDefined();
			expect(shader).not.toBeNull();
		});

		await it('vertex shader compiles successfully', async () => {
			const shader = gl.createShader(gl.VERTEX_SHADER)!;
			gl.shaderSource(shader, vertSrc);
			gl.compileShader(shader);
			const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
			if (!status) {
				console.error('Vertex shader log:', gl.getShaderInfoLog(shader));
			}
			expect(status).toBeTruthy();
		});

		await it('fragment shader compiles successfully', async () => {
			const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
			gl.shaderSource(shader, fragSrc);
			gl.compileShader(shader);
			const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
			if (!status) {
				console.error('Fragment shader log:', gl.getShaderInfoLog(shader));
			}
			expect(status).toBeTruthy();
		});

		await it('program links successfully', async () => {
			const vert = gl.createShader(gl.VERTEX_SHADER)!;
			gl.shaderSource(vert, vertSrc);
			gl.compileShader(vert);

			const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
			gl.shaderSource(frag, fragSrc);
			gl.compileShader(frag);

			const prog = gl.createProgram()!;
			gl.attachShader(prog, vert);
			gl.attachShader(prog, frag);
			gl.linkProgram(prog);

			const status = gl.getProgramParameter(prog, gl.LINK_STATUS);
			if (!status) {
				console.error('Program log:', gl.getProgramInfoLog(prog));
			}
			expect(status).toBeTruthy();
		});
	});

	// -- Textures --

	await describe('Textures', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('createTexture returns a WebGLTexture', async () => {
			const tex = gl.createTexture();
			expect(tex).toBeDefined();
			expect(tex).not.toBeNull();
		});

		await it('bindTexture + texImage2D with Uint8Array', async () => {
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			const pixels = new Uint8Array([255, 0, 0, 255]); // 1x1 red pixel
			expect(() => gl.texImage2D(
				gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels
			)).not.toThrow();
		});

		await it('texParameteri sets filter params without error', async () => {
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			expect(() => {
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			}).not.toThrow();
		});

		await it('deleteTexture cleans up', async () => {
			const tex = gl.createTexture();
			expect(() => gl.deleteTexture(tex)).not.toThrow();
		});
	});

	// -- Draw calls --

	await describe('Draw', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('clearColor + clear does not throw', async () => {
			expect(() => {
				gl.clearColor(0, 0, 0, 1);
				gl.clear(gl.COLOR_BUFFER_BIT);
			}).not.toThrow();
			expect(gl.getError()).toBe(gl.NO_ERROR);
		});

		await it('viewport does not throw', async () => {
			expect(() => gl.viewport(0, 0, 200, 200)).not.toThrow();
		});

		await it('drawArrays (triangle) produces no GL error', async () => {
			const vertSrc = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
			const fragSrc = 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }';

			const vert = gl.createShader(gl.VERTEX_SHADER)!;
			gl.shaderSource(vert, vertSrc);
			gl.compileShader(vert);
			const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
			gl.shaderSource(frag, fragSrc);
			gl.compileShader(frag);
			const prog = gl.createProgram()!;
			gl.attachShader(prog, vert);
			gl.attachShader(prog, frag);
			gl.linkProgram(prog);
			gl.useProgram(prog);

			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 0, -1, 1, 1]), gl.STATIC_DRAW);

			const loc = gl.getAttribLocation(prog, 'position');
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			expect(() => gl.drawArrays(gl.TRIANGLES, 0, 3)).not.toThrow();
			expect(gl.getError()).toBe(gl.NO_ERROR);
		});
	});

	// -- Extensions --

	await describe('Extensions', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('OES_texture_float is supported', async () => {
			const ext = gl.getExtension('OES_texture_float');
			expect(ext).not.toBeNull();
		});

		await it('OES_standard_derivatives is supported', async () => {
			const ext = gl.getExtension('OES_standard_derivatives');
			expect(ext).not.toBeNull();
		});

		await it('OES_element_index_uint is supported', async () => {
			const ext = gl.getExtension('OES_element_index_uint');
			expect(ext).not.toBeNull();
		});

		await it('getSupportedExtensions returns an array', async () => {
			const exts = gl.getSupportedExtensions();
			expect(Array.isArray(exts)).toBeTruthy();
			expect((exts?.length ?? 0) > 0).toBeTruthy();
		});
	});

	// -- Native Gwebgl bindings --

	await describe('Gwebgl.WebGLRenderingContext native bindings', async () => {
		beforeEach(async () => { glArea.make_current(); });
		await it('getParameterb returns a boolean', async () => {
			const res = (gl as any)?._native.getParameterb((gl as any)?.BLEND);
			expect(typeof res).toBe('boolean');
		});

		await it('getParameterbv returns an array of booleans', async () => {
			const results = (gl as any)?._native.getParameterbv((gl as any)?.COLOR_WRITEMASK, 16);
			expect(Array.isArray(results)).toBeTruthy();
			if (Array.isArray(results)) {
				for (const r of results) expect(typeof r).toBe('boolean');
			}
		});

		await it('getParameterf returns a float', async () => {
			const result = (gl as any)?._native.getParameterf((gl as any)?.SAMPLE_COVERAGE_VALUE);
			expect(typeof result).toBe('number');
		});

		await it('getParameterfv returns an array of floats', async () => {
			const results = (gl as any)?._native.getParameterfv((gl as any)?.DEPTH_RANGE, 8);
			expect(Array.isArray(results)).toBeTruthy();
			if (Array.isArray(results)) {
				for (const r of results) expect(typeof r).toBe('number');
			}
		});

		await it('getParameteri returns an integer', async () => {
			const result = (gl as any)?._native.getParameteri((gl as any)?.ARRAY_BUFFER_BINDING);
			expect(typeof result).toBe('number');
		});

		await it('getParameteriv returns an array of integers', async () => {
			const results = (gl as any)?._native.getParameteriv((gl as any)?.MAX_VIEWPORT_DIMS, 8);
			expect(Array.isArray(results)).toBeTruthy();
			if (Array.isArray(results)) {
				for (const r of results) expect(typeof r).toBe('number');
			}
		});
	});

	// -- Simple-shader rendering (ported from refs/headless-gl/test/simple-shader.js) --
	// Uses a custom RGBA FBO so readPixels works outside the GTK render signal.

	await describe('simple-shader rendering', async () => {
		beforeEach(async () => { glArea.make_current(); });

		const VS = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
		const FS = 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }';

		await it('renders a green triangle — all pixels (0,255,0,255)', async () => {
			const fbo = makeTestFBO(gl, 8, 8);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const prog = makeProgram(gl, VS, FS);
			expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
			gl.useProgram(prog);
			drawTriangle(gl);
			expect(gl.getError()).toBe(gl.NO_ERROR);
			const pixels = new Uint8Array(fbo.width * fbo.height * 4);
			gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			let allGreen = true;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] !== 0 || pixels[i+1] !== 255 || pixels[i+2] !== 0 || pixels[i+3] !== 255) {
					allGreen = false; break;
				}
			}
			expect(allGreen).toBeTruthy();
			gl.deleteProgram(prog);
			destroyTestFBO(gl, fbo);
		});
	});

	// -- clearColor + readPixels (ported from refs/headless-gl/test/clear-color.js) --

	await describe('clearColor', async () => {
		beforeEach(async () => { glArea.make_current(); });

		await it('clears to black (0,0,0,0)', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[0]).toBe(0); expect(p[1]).toBe(0); expect(p[2]).toBe(0); expect(p[3]).toBe(0);
		});
		await it('clears to white (255,255,255,255)', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(1, 1, 1, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[0]).toBe(255); expect(p[1]).toBe(255); expect(p[2]).toBe(255); expect(p[3]).toBe(255);
		});
		await it('clears to green (0,255,0,255)', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(0, 1, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[0]).toBe(0); expect(p[1]).toBe(255); expect(p[2]).toBe(0); expect(p[3]).toBe(255);
		});
		await it('clears to magenta (255,0,255,255)', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(1, 0, 1, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[0]).toBe(255); expect(p[1]).toBe(0); expect(p[2]).toBe(255); expect(p[3]).toBe(255);
		});
	});

	// -- Blending (ported from refs/headless-gl/test/blending.js) --

	await describe('blending', async () => {
		beforeEach(async () => { glArea.make_current(); });

		const VS_BLEND = [
			'precision mediump float;',
			'attribute vec2 position;',
			'void main() { gl_Position = vec4(position, 0.0, 1.0); }',
		].join('\n');

		interface BlendCase {
			name: string;
			equn: number;
			func1: number;
			func2: number;
			dstColor: [number, number, number, number];
			srcColor: [number, number, number, number];
			expected: [number, number, number, number]; // 0-255
		}

		// Expected pixel values computed from blend equations (tolerance ±3).
		// ADD ONE ONE:            src(0.5,0.5,0.5,1) + dst(0.5,0.5,0.5,1)   → (255,255,255,255) clamped
		// ADD ONE ZERO:           src(0.2,0.2,0.2,1) + 0·dst                 → ( 51, 51, 51,255)
		// ADD ZERO SRC_COLOR:     0·src + dst·src.rgba                        → (102,102,102,128)
		// ADD DST_COLOR ZERO:     src·dst + 0·dst                             → (102,102,102,128)
		// ADD SRC_ALPHA ONE_MINUS_SRC_ALPHA: src·a + dst·(1-a)                → (127,127, 64,191)
		const blendTests: BlendCase[] = [
			{ name: 'ADD ONE ONE',
			  equn: gl.FUNC_ADD, func1: gl.ONE, func2: gl.ONE,
			  dstColor: [0.5, 0.5, 0.5, 1], srcColor: [0.5, 0.5, 0.5, 1],
			  expected: [255, 255, 255, 255] },
			{ name: 'ADD ONE ZERO',
			  equn: gl.FUNC_ADD, func1: gl.ONE, func2: gl.ZERO,
			  dstColor: [0.5, 0.5, 0.5, 0.5], srcColor: [0.2, 0.2, 0.2, 1],
			  expected: [51, 51, 51, 255] },
			{ name: 'ADD ZERO SRC_COLOR',
			  equn: gl.FUNC_ADD, func1: gl.ZERO, func2: gl.SRC_COLOR,
			  dstColor: [0.8, 0.8, 0.8, 1], srcColor: [0.5, 0.5, 0.5, 0.5],
			  expected: [102, 102, 102, 128] },
			{ name: 'ADD DST_COLOR ZERO',
			  equn: gl.FUNC_ADD, func1: gl.DST_COLOR, func2: gl.ZERO,
			  dstColor: [0.8, 0.8, 0.8, 1], srcColor: [0.5, 0.5, 0.5, 0.5],
			  expected: [102, 102, 102, 128] },
			{ name: 'ADD SRC_ALPHA ONE_MINUS_SRC_ALPHA',
			  equn: gl.FUNC_ADD, func1: gl.SRC_ALPHA, func2: gl.ONE_MINUS_SRC_ALPHA,
			  dstColor: [0.5, 0, 0.5, 1], srcColor: [0.5, 1, 0, 0.5],
			  expected: [127, 127, 64, 191] },
		];

		for (const tc of blendTests) {
			const { name, equn, func1, func2, dstColor, srcColor, expected } = tc;
			const FS_BLEND = [
				'precision mediump float;',
				`void main() { gl_FragColor = vec4(${srcColor[0]},${srcColor[1]},${srcColor[2]},${srcColor[3]}); }`,
			].join('\n');
			await it(name, async () => {
				const fbo = makeTestFBO(gl);
				gl.clearColor(dstColor[0], dstColor[1], dstColor[2], dstColor[3]);
				gl.clear(gl.COLOR_BUFFER_BIT);
				const prog = makeProgram(gl, VS_BLEND, FS_BLEND);
				gl.useProgram(prog);
				gl.enable(gl.BLEND);
				gl.blendEquation(equn);
				gl.blendFunc(func1, func2);
				drawTriangle(gl);
				expect(gl.getError()).toBe(gl.NO_ERROR);
				gl.disable(gl.BLEND);
				const p = readPixel(gl, 0, 0);
				gl.deleteProgram(prog);
				destroyTestFBO(gl, fbo);
				expect(pixelClose(p, expected)).toBeTruthy();
			});
		}
	});

	// -- drawElements (ported from refs/headless-gl/test/draw-indexed.js) --

	await describe('drawElements (indexed drawing)', async () => {
		beforeEach(async () => { glArea.make_current(); });

		await it('draws a quad via index buffer — all pixels green', async () => {
			const fbo = makeTestFBO(gl, 8, 8);
			const VS = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
			const FS = 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }';

			gl.clearColor(1, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);

			const prog = makeProgram(gl, VS, FS);
			gl.useProgram(prog);

			const vbuf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

			const ebuf = gl.createBuffer();
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebuf);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 2,1,3]), gl.STATIC_DRAW);

			gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
			expect(gl.getError()).toBe(gl.NO_ERROR);

			const pixels = new Uint8Array(fbo.width * fbo.height * 4);
			gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			let allGreen = true;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] !== 0 || pixels[i+1] !== 255 || pixels[i+2] !== 0 || pixels[i+3] !== 255) {
					allGreen = false; break;
				}
			}
			expect(allGreen).toBeTruthy();

			gl.disableVertexAttribArray(0);
			gl.deleteBuffer(vbuf);
			gl.deleteBuffer(ebuf);
			gl.deleteProgram(prog);
			destroyTestFBO(gl, fbo);
		});
	});

	// -- readPixels format --

	await describe('readPixels', async () => {
		beforeEach(async () => { glArea.make_current(); });

		await it('RGBA + UNSIGNED_BYTE returns correct data size', async () => {
			const fbo = makeTestFBO(gl, 4, 4);
			gl.clearColor(1, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const pixels = new Uint8Array(fbo.width * fbo.height * 4);
			gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			expect(gl.getError()).toBe(gl.NO_ERROR);
			expect(pixels.length).toBe(fbo.width * fbo.height * 4);
			destroyTestFBO(gl, fbo);
		});

		await it('pixel values match the clear color', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(0, 0, 1, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[0]).toBe(0);
			expect(p[1]).toBe(0);
			expect(p[2]).toBe(255);
			expect(p[3]).toBe(255);
		});

		await it('readPixels reads a single red pixel', async () => {
			const fbo = makeTestFBO(gl);
			gl.clearColor(1, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const buf = new Uint8Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			destroyTestFBO(gl, fbo);
			expect(buf[0]).toBe(255); // red
			expect(buf[1]).toBe(0);
			expect(buf[2]).toBe(0);
			expect(buf[3]).toBe(255);
		});
	});

	// -- Depth buffer (ported from refs/headless-gl/test/depth-buffer.js) --

	await describe('depth buffer', async () => {
		beforeEach(async () => { glArea.make_current(); });

		await it('depth test (LESS) — nearer triangle occludes farther one', async () => {
			const VS = [
				'attribute vec2 position;',
				'uniform float depth;',
				'void main() { gl_Position = vec4(position, depth, 1.0); }',
			].join('\n');
			const FS = [
				'precision mediump float;',
				'uniform vec4 color;',
				'void main() { gl_FragColor = color; }',
			].join('\n');

			const fbo = makeTestFBOWithDepth(gl, 4, 4);
			gl.clearColor(0, 0, 0, 1);
			gl.clearDepth(1.0);
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			gl.enable(gl.DEPTH_TEST);
			gl.depthFunc(gl.LESS);

			const prog = makeProgram(gl, VS, FS);
			gl.useProgram(prog);

			// Draw red at z=0.0 (NDC), window depth=0.5 — passes LESS against 1.0
			gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.0);
			gl.uniform4f(gl.getUniformLocation(prog, 'color'), 1, 0, 0, 1);
			drawTriangle(gl);

			// Draw blue at z=0.5 (NDC), window depth=0.75 — fails LESS against 0.5
			gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.5);
			gl.uniform4f(gl.getUniformLocation(prog, 'color'), 0, 0, 1, 1);
			drawTriangle(gl);

			expect(gl.getError()).toBe(gl.NO_ERROR);
			gl.disable(gl.DEPTH_TEST);

			// Red should win (nearer, drawn first)
			const p = readPixel(gl, 0, 0);
			gl.deleteProgram(prog);
			destroyTestFBOWithDepth(gl, fbo);
			expect(p[0]).toBe(255); // red
			expect(p[1]).toBe(0);
			expect(p[2]).toBe(0);
		});
	});

	// -- uniform1fv regression (inverted validation check) --
	// Regression: uniform1fv had an inverted validation guard that caused it to
	// return immediately when the value was valid, so uniform float arrays were
	// never actually sent to the shader.  This broke Three.js morph targets
	// (morphTargetInfluences is set via uniform1fv).

	await describe('uniform1fv regression', async () => {
		beforeEach(async () => { glArea.make_current(); });

		const VS_U1FV = [
			'attribute vec2 position;',
			'void main() { gl_Position = vec4(position, 0.0, 1.0); }',
		].join('\n');

		await it('uniform1fv sets a float uniform and affects rendering', async () => {
			// Fragment shader that uses a uniform float to choose the red channel.
			// If uniform1fv works, we can set it to 1.0 and read back red pixels.
			const FS = [
				'precision mediump float;',
				'uniform float uRed;',
				'void main() { gl_FragColor = vec4(uRed, 0.0, 0.0, 1.0); }',
			].join('\n');

			const prog = makeProgram(gl, VS_U1FV, FS);
			expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
			gl.useProgram(prog);

			const loc = gl.getUniformLocation(prog, 'uRed');
			expect(loc).not.toBeNull();

			// Set via uniform1fv (the previously broken path)
			gl.uniform1fv(loc, new Float32Array([1.0]));
			expect(gl.getError()).toBe(gl.NO_ERROR);

			const fbo = makeTestFBO(gl, 4, 4);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			drawTriangle(gl);

			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			// Red channel must be 255 — proves uniform1fv actually set the value
			expect(p[0]).toBe(255);
			expect(p[1]).toBe(0);
			expect(p[2]).toBe(0);

			gl.deleteProgram(prog);
		});

		await it('uniform1fv sets each array element individually', async () => {
			// Shader with a float array — Three.js sets morphTargetInfluences
			// by calling uniform1fv for each element individually.
			const FS_ARR = [
				'precision mediump float;',
				'uniform float uWeights[3];',
				'void main() { gl_FragColor = vec4(uWeights[0], uWeights[1], uWeights[2], 1.0); }',
			].join('\n');

			const prog = makeProgram(gl, VS_U1FV, FS_ARR);
			expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
			gl.useProgram(prog);

			// Set each element individually via uniform1fv (the pattern Three.js uses)
			const loc0 = gl.getUniformLocation(prog, 'uWeights[0]');
			const loc1 = gl.getUniformLocation(prog, 'uWeights[1]');
			const loc2 = gl.getUniformLocation(prog, 'uWeights[2]');
			expect(loc0).not.toBeNull();
			expect(loc1).not.toBeNull();
			expect(loc2).not.toBeNull();

			gl.uniform1fv(loc0, new Float32Array([0.0]));
			gl.uniform1fv(loc1, new Float32Array([1.0]));
			gl.uniform1fv(loc2, new Float32Array([0.0]));
			expect(gl.getError()).toBe(gl.NO_ERROR);

			const fbo = makeTestFBO(gl, 4, 4);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			drawTriangle(gl);

			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			// Green channel must be 255, proving uniform1fv set each value
			expect(p[0]).toBe(0);
			expect(p[1]).toBe(255);
			expect(p[2]).toBe(0);

			gl.deleteProgram(prog);
		});
	});

	// -- linkProgram with inactive attributes regression --
	// Regression: _fixupLink passed getAttribLocation() return value (-1 for
	// inactive attributes) directly to the native bindAttribLocation() which
	// expects a uint32, causing "value is out of range for uint32".

	await describe('linkProgram with inactive attributes', async () => {
		beforeEach(async () => { glArea.make_current(); });

		await it('links a program whose vertex shader declares but does not use an attribute', async () => {
			// 'unused' is declared but never referenced in the shader body,
			// so the driver may optimize it away → getAttribLocation returns -1.
			const VS = [
				'attribute vec2 position;',
				'attribute vec3 unused;',
				'void main() { gl_Position = vec4(position, 0.0, 1.0); }',
			].join('\n');
			const FS = [
				'precision mediump float;',
				'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }',
			].join('\n');

			const prog = makeProgram(gl, VS, FS);
			expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
			expect(gl.getError()).toBe(gl.NO_ERROR);

			// The program must still be usable for rendering
			gl.useProgram(prog);
			const fbo = makeTestFBO(gl, 4, 4);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			drawTriangle(gl);
			expect(gl.getError()).toBe(gl.NO_ERROR);

			const p = readPixel(gl, 0, 0);
			destroyTestFBO(gl, fbo);
			expect(p[1]).toBe(255); // green

			gl.deleteProgram(prog);
		});
	});

	// All tests complete. Destroy the window to release the GL context and remove it from screen.
	win.destroy();

	}); // on('Display')
};
