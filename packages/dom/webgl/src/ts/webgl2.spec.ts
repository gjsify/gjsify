// WebGL2 tests — original implementation for @gjsify/webgl
// Exercises the WebGL2RenderingContext backed by OpenGL ES 3.0 via Gwebgl.WebGL2RenderingContext.
// Reference: refs/headless-gl/src/native/bindings.cc (BindWebGL2)

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';

import { WebGL2RenderingContext as OurWebGL2RenderingContext, CanvasWebGLWidget } from '@gjsify/webgl';
import { makeProgram, drawTriangle, readPixel, pixelClose,
         makeTestFBO, destroyTestFBO, makeTestFBOWithDepth,
         makeTestFBOFloat, makeTestFBOWithDepthTexture,
         TEXTURE_VS_300, TEXTURE_FS_300, CUBEMAP_FS_300,
         type TestFBOFloat, type TestFBOWithDepthTexture } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

export default async () => {

	await on('Display', async () => {

		Gtk.init();

		let glArea!: CanvasWebGLWidget;
		let gl2!: WebGL2RenderingContext;

		const readyLoop = new GLib.MainLoop(null, false);
		const win = new Gtk.Window({});
		win.set_default_size(200, 200);

		glArea = new CanvasWebGLWidget();
		glArea.onReady((c, _g) => {
			// Ask the canvas for a WebGL2 context instead of the default WebGL1
			gl2 = (c as any).getContext('webgl2') as WebGL2RenderingContext;
			readyLoop.quit();
		});

		win.set_child(glArea);
		win.present();

		const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
			readyLoop.quit();
			return GLib.SOURCE_REMOVE;
		});

		readyLoop.run();
		GLib.source_remove(giveUpId);

		if (!gl2) {
			console.warn('WebGL2 context not available — skipping WebGL2 tests');
			win.destroy();
			return;
		}

		glArea.make_current();

		// ── WebGL2 context ──────────────────────────────────────────────────────

		await describe('WebGL2 context', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('getContext("webgl2") returns a WebGL2RenderingContext', async () => {
				expect(gl2).toBeInstanceOf(OurWebGL2RenderingContext);
			});

			await it('VERSION is "WebGL 2.0"', async () => {
				expect(gl2.getParameter(gl2.VERSION)).toBe('WebGL 2.0');
			});

			await it('SHADING_LANGUAGE_VERSION is "WebGL GLSL ES 3.00"', async () => {
				expect(gl2.getParameter(gl2.SHADING_LANGUAGE_VERSION)).toBe('WebGL GLSL ES 3.00');
			});

			await it('drawingBufferWidth and drawingBufferHeight are positive', async () => {
				expect(gl2.drawingBufferWidth > 0).toBeTruthy();
				expect(gl2.drawingBufferHeight > 0).toBeTruthy();
			});

			await it('getError() returns NO_ERROR initially', async () => {
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
			});
		});

		// ── GLSL ES 3.00 compilation ────────────────────────────────────────────

		await describe('GLSL ES 3.00 compilation', async () => {
			beforeEach(async () => { glArea.make_current(); });

			const VS300 = [
				'#version 300 es',
				'in vec2 position;',
				'void main() { gl_Position = vec4(position, 0.0, 1.0); }',
			].join('\n');
			const FS300 = [
				'#version 300 es',
				'precision mediump float;',
				'out vec4 fragColor;',
				'void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }',
			].join('\n');

			await it('#version 300 es vertex shader compiles', async () => {
				const sh = gl2.createShader(gl2.VERTEX_SHADER)!;
				gl2.shaderSource(sh, VS300);
				gl2.compileShader(sh);
				if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) {
					console.error('VS300 log:', gl2.getShaderInfoLog(sh));
				}
				expect(gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)).toBeTruthy();
				gl2.deleteShader(sh);
			});

			await it('#version 300 es fragment shader compiles', async () => {
				const sh = gl2.createShader(gl2.FRAGMENT_SHADER)!;
				gl2.shaderSource(sh, FS300);
				gl2.compileShader(sh);
				if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) {
					console.error('FS300 log:', gl2.getShaderInfoLog(sh));
				}
				expect(gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)).toBeTruthy();
				gl2.deleteShader(sh);
			});

			await it('#version 300 es program links and renders green', async () => {
				// makeProgram works with WebGL2 context too — cast to WebGLRenderingContext
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS300, FS300);
				if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) {
					console.error('Program300 log:', gl2.getProgramInfoLog(prog));
				}
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();

				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				gl2.useProgram(prog);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
				expect(p[0]).toBe(0);
				expect(p[1]).toBe(255);
				expect(p[2]).toBe(0);
				expect(p[3]).toBe(255);

				gl2.deleteProgram(prog);
			});
		});

		// ── Vertex Array Objects ────────────────────────────────────────────────

		await describe('VAO', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('createVertexArray returns a non-null object', async () => {
				const vao = gl2.createVertexArray();
				expect(vao).not.toBeNull();
				expect(vao).toBeDefined();
				gl2.deleteVertexArray(vao);
			});

			await it('isVertexArray is true after creation, false after deletion', async () => {
				const vao = gl2.createVertexArray()!;
				gl2.bindVertexArray(vao);
				expect(gl2.isVertexArray(vao)).toBeTruthy();
				gl2.bindVertexArray(null);
				gl2.deleteVertexArray(vao);
				expect(gl2.isVertexArray(vao)).toBeFalsy();
			});

			await it('VAO preserves vertex attribute state', async () => {
				const VS = ['#version 300 es', 'in vec2 position;',
					'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
				const FS = ['#version 300 es', 'precision mediump float;', 'out vec4 c;',
					'void main() { c = vec4(0.0,1.0,0.0,1.0); }'].join('\n');

				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS);
				gl2.useProgram(prog);

				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);

				const vao = gl2.createVertexArray()!;
				gl2.bindVertexArray(vao);

				const buf = gl2.createBuffer();
				gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
				gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([-2,-2,-2,4,4,-2]), gl2.STREAM_DRAW);
				gl2.enableVertexAttribArray(0);
				gl2.vertexAttribPointer(0, 2, gl2.FLOAT, false, 0, 0);

				// Unbind VAO, then rebind — attrib state must be preserved
				gl2.bindVertexArray(null);
				gl2.bindVertexArray(vao);

				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				gl2.drawArrays(gl2.TRIANGLES, 0, 3);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
				expect(p[1]).toBe(255); // green

				gl2.bindVertexArray(null);
				gl2.deleteVertexArray(vao);
				gl2.deleteBuffer(buf);
				gl2.deleteProgram(prog);
			});
		});

		// ── getBufferSubData ────────────────────────────────────────────────────

		await describe('getBufferSubData', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('reads back float data written with bufferData', async () => {
				const src = new Float32Array([1.0, 2.0, 3.0, 4.0]);
				const buf = gl2.createBuffer()!;
				gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
				gl2.bufferData(gl2.ARRAY_BUFFER, src, gl2.STATIC_READ);

				const dst = new Float32Array(4);
				gl2.getBufferSubData(gl2.ARRAY_BUFFER, 0, dst);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				expect(dst[0]).toBe(1.0);
				expect(dst[1]).toBe(2.0);
				expect(dst[2]).toBe(3.0);
				expect(dst[3]).toBe(4.0);

				gl2.deleteBuffer(buf);
			});

			await it('reads a sub-range correctly', async () => {
				const src = new Float32Array([10, 20, 30, 40]);
				const buf = gl2.createBuffer()!;
				gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
				gl2.bufferData(gl2.ARRAY_BUFFER, src, gl2.STATIC_READ);

				const dst = new Float32Array(2);
				// offset = 8 bytes (2 floats), read 2 floats
				gl2.getBufferSubData(gl2.ARRAY_BUFFER, 8, dst);
				expect(dst[0]).toBe(30);
				expect(dst[1]).toBe(40);

				gl2.deleteBuffer(buf);
			});
		});

		// ── Sync objects ────────────────────────────────────────────────────────

		await describe('sync objects', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('fenceSync returns a non-null sync', async () => {
				const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
				expect(sync).not.toBeNull();
				gl2.deleteSync(sync);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
			});

			await it('isSync is true before deletion, false after', async () => {
				const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
				expect(gl2.isSync(sync)).toBeTruthy();
				gl2.deleteSync(sync);
				expect(gl2.isSync(sync)).toBeFalsy();
			});

			await it('clientWaitSync returns TIMEOUT_EXPIRED or CONDITION_SATISFIED', async () => {
				const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
				gl2.flush();
				const result = gl2.clientWaitSync(sync, 0, 0); // timeout=0 → immediate poll
				const valid = result === gl2.TIMEOUT_EXPIRED ||
				              result === gl2.CONDITION_SATISFIED ||
				              result === gl2.ALREADY_SIGNALED;
				expect(valid).toBeTruthy();
				gl2.deleteSync(sync);
			});
		});

		// ── uint uniforms ───────────────────────────────────────────────────────

		await describe('uint uniforms', async () => {
			beforeEach(async () => { glArea.make_current(); });

			const VS_U = ['#version 300 es', 'in vec2 position;',
				'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
			const FS_U = [
				'#version 300 es', 'precision mediump float;',
				'uniform uint uR; uniform uint uG; uniform uint uB;',
				'out vec4 c;',
				'void main() { c = vec4(float(uR)/255.0, float(uG)/255.0, float(uB)/255.0, 1.0); }',
			].join('\n');

			await it('uniform1ui sets an unsigned int uniform', async () => {
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS_U, FS_U);
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();
				gl2.useProgram(prog);
				const locR = gl2.getUniformLocation(prog, 'uR');
				const locG = gl2.getUniformLocation(prog, 'uG');
				const locB = gl2.getUniformLocation(prog, 'uB');
				gl2.uniform1ui(locR, 0);
				gl2.uniform1ui(locG, 255);
				gl2.uniform1ui(locB, 0);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				// Verify getUniform round-trips
				expect(gl2.getUniform(prog, locR!)).toBe(0);
				expect(gl2.getUniform(prog, locG!)).toBe(255);
				gl2.deleteProgram(prog);
			});

			await it('uniform2ui, uniform3ui, uniform4ui set without error', async () => {
				const FS2 = [
					'#version 300 es', 'precision mediump float;',
					'uniform uvec2 u2; uniform uvec3 u3; uniform uvec4 u4;',
					'out vec4 c;',
					'void main() { c = vec4(float(u2.x), float(u3.x), float(u4.x), 1.0)/255.0; }',
				].join('\n');
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS_U, FS2);
				gl2.useProgram(prog);
				gl2.uniform2ui(gl2.getUniformLocation(prog, 'u2'), 1, 2);
				gl2.uniform3ui(gl2.getUniformLocation(prog, 'u3'), 1, 2, 3);
				gl2.uniform4ui(gl2.getUniformLocation(prog, 'u4'), 1, 2, 3, 4);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteProgram(prog);
			});
		});

		// ── Non-square matrix uniforms ──────────────────────────────────────────

		await describe('non-square matrix uniforms', async () => {
			beforeEach(async () => { glArea.make_current(); });

			const VS_M = ['#version 300 es', 'in vec2 position;',
				'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');

			await it('uniformMatrix2x3fv sets a mat2x3 without error', async () => {
				const FS = [
					'#version 300 es', 'precision mediump float;',
					'uniform mat2x3 m; out vec4 c;',
					'void main() { c = vec4(m[0][0], m[0][1], m[0][2], 1.0); }',
				].join('\n');
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS_M, FS);
				gl2.useProgram(prog);
				gl2.uniformMatrix2x3fv(gl2.getUniformLocation(prog, 'm'), false,
					new Float32Array([1,0,0, 0,1,0]));
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteProgram(prog);
			});

			await it('uniformMatrix3x2fv sets a mat3x2 without error', async () => {
				const FS = [
					'#version 300 es', 'precision mediump float;',
					'uniform mat3x2 m; out vec4 c;',
					'void main() { c = vec4(m[0][0], m[0][1], 0.0, 1.0); }',
				].join('\n');
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS_M, FS);
				gl2.useProgram(prog);
				gl2.uniformMatrix3x2fv(gl2.getUniformLocation(prog, 'm'), false,
					new Float32Array([1,0, 0,1, 0,0]));
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteProgram(prog);
			});
		});

		// ── Uniform Buffer Objects ──────────────────────────────────────────────

		await describe('Uniform Buffer Objects', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('getUniformBlockIndex + uniformBlockBinding works', async () => {
				const VS = [
					'#version 300 es',
					'layout(std140) uniform Params { vec4 color; };',
					'in vec2 position;',
					'out vec4 vColor;',
					'void main() { vColor = color; gl_Position = vec4(position,0.0,1.0); }',
				].join('\n');
				const FS = [
					'#version 300 es', 'precision mediump float;',
					'in vec4 vColor; out vec4 c;',
					'void main() { c = vColor; }',
				].join('\n');

				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS);
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();

				const idx = gl2.getUniformBlockIndex(prog, 'Params');
				expect(idx).not.toBe(gl2.INVALID_INDEX);
				gl2.uniformBlockBinding(prog, idx, 0);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Upload data via UBO
				const ubo = gl2.createBuffer()!;
				gl2.bindBuffer(gl2.UNIFORM_BUFFER, ubo);
				gl2.bufferData(gl2.UNIFORM_BUFFER, new Float32Array([0, 1, 0, 1]), gl2.STATIC_DRAW);
				gl2.bindBufferBase(gl2.UNIFORM_BUFFER, 0, ubo);

				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				gl2.useProgram(prog);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Should render green (0,1,0,1)
				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
				expect(p[1]).toBe(255);

				gl2.deleteBuffer(ubo);
				gl2.deleteProgram(prog);
			});
		});

		// ── Instanced drawing ───────────────────────────────────────────────────

		await describe('instanced drawing', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('drawArraysInstanced renders without error', async () => {
				const VS = ['#version 300 es', 'in vec2 position;',
					'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
				const FS = ['#version 300 es', 'precision mediump float;', 'out vec4 c;',
					'void main() { c = vec4(0.0,1.0,0.0,1.0); }'].join('\n');

				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS);
				gl2.useProgram(prog);

				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);

				const buf = gl2.createBuffer();
				gl2.bindBuffer(gl2.ARRAY_BUFFER, buf);
				gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([-2,-2,-2,4,4,-2]), gl2.STREAM_DRAW);
				gl2.enableVertexAttribArray(0);
				gl2.vertexAttribPointer(0, 2, gl2.FLOAT, false, 0, 0);
				gl2.vertexAttribDivisor(0, 0); // per-vertex

				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				gl2.drawArraysInstanced(gl2.TRIANGLES, 0, 3, 1);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
				expect(p[1]).toBe(255); // green

				gl2.disableVertexAttribArray(0);
				gl2.deleteBuffer(buf);
				gl2.deleteProgram(prog);
			});
		});

		// ── drawBuffers (MRT) ───────────────────────────────────────────────────

		await describe('drawBuffers (MRT)', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('drawBuffers with 2 COLOR_ATTACHMENTs renders to both', async () => {
				const VS = ['#version 300 es', 'in vec2 position;',
					'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
				const FS = [
					'#version 300 es', 'precision mediump float;',
					'layout(location=0) out vec4 c0;',
					'layout(location=1) out vec4 c1;',
					'void main() { c0 = vec4(1.0,0.0,0.0,1.0); c1 = vec4(0.0,0.0,1.0,1.0); }',
				].join('\n');

				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS);
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();

				// Create FBO with 2 texture attachments (4×4 each)
				const fb = gl2.createFramebuffer()!;
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fb);

				const tex0 = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_2D, tex0);
				gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 4, 4, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, null);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, tex0, 0);

				const tex1 = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_2D, tex1);
				gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 4, 4, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, null);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT1, gl2.TEXTURE_2D, tex1, 0);

				const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				if (status !== gl2.FRAMEBUFFER_COMPLETE) {
					// Skip MRT verification if FBO incomplete (driver may not support it)
					console.warn('MRT framebuffer not complete:', status);
					gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
					gl2.deleteFramebuffer(fb);
					gl2.deleteTexture(tex0);
					gl2.deleteTexture(tex1);
					gl2.deleteProgram(prog);
					return;
				}

				gl2.drawBuffers([gl2.COLOR_ATTACHMENT0, gl2.COLOR_ATTACHMENT1]);
				gl2.viewport(0, 0, 4, 4);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				gl2.useProgram(prog);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Read attachment 0 — expect red
				gl2.readBuffer(gl2.COLOR_ATTACHMENT0);
				const p0 = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p0[0]).toBe(255); // red
				expect(p0[1]).toBe(0);

				// Read attachment 1 — expect blue
				gl2.readBuffer(gl2.COLOR_ATTACHMENT1);
				const p1 = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p1[0]).toBe(0);
				expect(p1[2]).toBe(255); // blue

				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteFramebuffer(fb);
				gl2.deleteTexture(tex0);
				gl2.deleteTexture(tex1);
				gl2.deleteProgram(prog);
			});
		});

		// ── 3D texture ──────────────────────────────────────────────────────────

		await describe('3D texture', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('createTexture + TEXTURE_3D binding works', async () => {
				const tex = gl2.createTexture();
				expect(tex).not.toBeNull();
				gl2.bindTexture(gl2.TEXTURE_3D, tex);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteTexture(tex);
			});

			await it('texImage3D uploads a 2×2×2 RGBA texture without error', async () => {
				const tex = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_3D, tex);
				gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
				gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
				gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
				gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
				gl2.texParameteri(gl2.TEXTURE_3D, gl2.TEXTURE_WRAP_R, gl2.CLAMP_TO_EDGE);
				const data = new Uint8Array(2 * 2 * 2 * 4).fill(128);
				gl2.texImage3D(gl2.TEXTURE_3D, 0, gl2.RGBA, 2, 2, 2, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, data);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteTexture(tex);
			});

			await it('texStorage3D allocates storage without error', async () => {
				const tex = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_3D, tex);
				gl2.texStorage3D(gl2.TEXTURE_3D, 1, gl2.RGBA8, 4, 4, 4);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);
				gl2.deleteTexture(tex);
			});
		});

		// ── Transform Feedback ──────────────────────────────────────────────────

		await describe('transform feedback', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('captures vertex shader output via transform feedback', async () => {
				const VS_TF = [
					'#version 300 es',
					'in float inVal;',
					'out float outVal;',
					'void main() { outVal = inVal * 2.0; gl_Position = vec4(0.0); }',
				].join('\n');
				const FS_TF = [
					'#version 300 es', 'precision mediump float;', 'out vec4 c;',
					'void main() { c = vec4(0.0); }',
				].join('\n');

				// Compile shaders manually so we can call transformFeedbackVaryings before linking
				const vert = gl2.createShader(gl2.VERTEX_SHADER)!;
				gl2.shaderSource(vert, VS_TF);
				gl2.compileShader(vert);
				if (!gl2.getShaderParameter(vert, gl2.COMPILE_STATUS)) {
					console.error('TF VS:', gl2.getShaderInfoLog(vert));
				}
				const frag = gl2.createShader(gl2.FRAGMENT_SHADER)!;
				gl2.shaderSource(frag, FS_TF);
				gl2.compileShader(frag);

				const prog = gl2.createProgram()!;
				gl2.attachShader(prog, vert);
				gl2.attachShader(prog, frag);
				gl2.transformFeedbackVaryings(prog, ['outVal'], gl2.SEPARATE_ATTRIBS);
				gl2.linkProgram(prog);
				if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) {
					console.error('TF prog:', gl2.getProgramInfoLog(prog));
				}
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();

				// Input buffer: [1, 2, 3, 4]
				const inBuf = gl2.createBuffer()!;
				gl2.bindBuffer(gl2.ARRAY_BUFFER, inBuf);
				gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([1, 2, 3, 4]), gl2.STATIC_DRAW);
				const attribLoc = gl2.getAttribLocation(prog, 'inVal');
				gl2.enableVertexAttribArray(attribLoc);
				gl2.vertexAttribPointer(attribLoc, 1, gl2.FLOAT, false, 0, 0);

				// Output buffer — same size
				const outBuf = gl2.createBuffer()!;
				gl2.bindBuffer(gl2.TRANSFORM_FEEDBACK_BUFFER, outBuf);
				gl2.bufferData(gl2.TRANSFORM_FEEDBACK_BUFFER, 4 * 4, gl2.STATIC_READ);

				const tf = gl2.createTransformFeedback()!;
				gl2.bindTransformFeedback(gl2.TRANSFORM_FEEDBACK, tf);
				gl2.bindBufferBase(gl2.TRANSFORM_FEEDBACK_BUFFER, 0, outBuf);

				// Bind a user FBO so the draw call has a complete framebuffer
				// (the default drawing-buffer FBO may be incomplete after the MRT test)
				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 1, 1);

				gl2.useProgram(prog);
				gl2.enable(gl2.RASTERIZER_DISCARD);
				gl2.beginTransformFeedback(gl2.POINTS);
				gl2.drawArrays(gl2.POINTS, 0, 4);
				gl2.endTransformFeedback();
				gl2.disable(gl2.RASTERIZER_DISCARD);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				gl2.bindTransformFeedback(gl2.TRANSFORM_FEEDBACK, null);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);

				// Read back results
				const result = new Float32Array(4);
				gl2.bindBuffer(gl2.TRANSFORM_FEEDBACK_BUFFER, outBuf);
				gl2.getBufferSubData(gl2.TRANSFORM_FEEDBACK_BUFFER, 0, result);
				expect(result[0]).toBe(2.0);
				expect(result[1]).toBe(4.0);
				expect(result[2]).toBe(6.0);
				expect(result[3]).toBe(8.0);

				gl2.disableVertexAttribArray(attribLoc);
				gl2.deleteBuffer(inBuf);
				gl2.deleteBuffer(outBuf);
				gl2.deleteTransformFeedback(tf);
				gl2.deleteProgram(prog);
			});
		});

		// ── getStringi ──────────────────────────────────────────────────────────

		await describe('getStringi', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('getStringi(EXTENSIONS, 0) returns a string', async () => {
				const numExts = gl2.getParameter(gl2.NUM_EXTENSIONS) as number;
				if (numExts > 0) {
					const ext = gl2.getStringi(gl2.EXTENSIONS, 0);
					expect(typeof ext).toBe('string');
					expect((ext as string).length > 0).toBeTruthy();
				}
			});
		});

		// ── Extensions ──────────────────────────────────────────────────────────

		await describe('WebGL2 extensions', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('supports EXT_color_buffer_float', async () => {
				const ext = gl2.getExtension('EXT_color_buffer_float');
				expect(ext).toBeTruthy();
			});

			await it('supports EXT_color_buffer_half_float', async () => {
				const ext = gl2.getExtension('EXT_color_buffer_half_float');
				expect(ext).toBeTruthy();
			});

			await it('supports OES_texture_half_float', async () => {
				const ext = gl2.getExtension('OES_texture_half_float');
				expect(ext).toBeTruthy();
			});

			await it('OES_texture_half_float exposes HALF_FLOAT_OES constant', async () => {
				const ext = gl2.getExtension('OES_texture_half_float') as any;
				expect(ext).toBeTruthy();
				expect(ext.HALF_FLOAT_OES).toBe(0x8D61);
			});
		});

		// ── renderbufferStorage formats ──────────────────────────────────────────

		await describe('WebGL2 renderbufferStorage formats', async () => {
			beforeEach(async () => { glArea.make_current(); });

			async function testRbFormat(internalFormat: GLenum) {
				const rb = gl2.createRenderbuffer();
				gl2.bindRenderbuffer(gl2.RENDERBUFFER, rb);
				gl2.renderbufferStorage(gl2.RENDERBUFFER, internalFormat, 64, 64);
				const err = gl2.getError();
				gl2.deleteRenderbuffer(rb);
				return err;
			}

			await it('accepts RGBA8 (0x8058)', async () => {
				expect(await testRbFormat(0x8058)).toBe(gl2.NO_ERROR);
			});

			await it('accepts DEPTH_COMPONENT24 (0x81A6)', async () => {
				expect(await testRbFormat(0x81A6)).toBe(gl2.NO_ERROR);
			});

			await it('accepts DEPTH24_STENCIL8 (0x88F0)', async () => {
				expect(await testRbFormat(0x88F0)).toBe(gl2.NO_ERROR);
			});
		});

		// ── Float render target pipeline (Three.js pattern) ─────────────────────

		await describe('WebGL2 float render target', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('can create RGBA16F texture and attach to FBO', async () => {
				const RGBA16F = 0x881A;
				const HALF_FLOAT = 0x140B;

				const tex = gl2.createTexture();
				gl2.bindTexture(gl2.TEXTURE_2D, tex);
				gl2.texImage2D(gl2.TEXTURE_2D, 0, RGBA16F, 64, 64, 0, gl2.RGBA, HALF_FLOAT, null);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const fbo = gl2.createFramebuffer();
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, tex, 0);

				const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status).toBe(gl2.FRAMEBUFFER_COMPLETE);

				// Clear to red — should not produce errors
				gl2.clearColor(1, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteFramebuffer(fbo);
				gl2.deleteTexture(tex);
			});

			await it('can create RGBA8 renderbuffer FBO', async () => {
				const RGBA8 = 0x8058;

				const rb = gl2.createRenderbuffer();
				gl2.bindRenderbuffer(gl2.RENDERBUFFER, rb);
				gl2.renderbufferStorage(gl2.RENDERBUFFER, RGBA8, 64, 64);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const fbo = gl2.createFramebuffer();
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
				gl2.framebufferRenderbuffer(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.RENDERBUFFER, rb);

				const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status).toBe(gl2.FRAMEBUFFER_COMPLETE);

				gl2.clearColor(0, 1, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteFramebuffer(fbo);
				gl2.deleteRenderbuffer(rb);
			});
		});

		// ── GLSL 1.0 compatibility in WebGL2 ───────────────────────────────────

		await describe('WebGL2 GLSL 1.0 compatibility', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('compiles versionless shaders with attribute/varying', async () => {
				const vs = 'attribute vec2 position;\nvarying vec2 vUv;\nvoid main() { vUv = position; gl_Position = vec4(position, 0.0, 1.0); }';
				const fs = 'precision mediump float;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }';
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, vs, fs);
				expect(prog).toBeTruthy();
				if (prog) {
					expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();
					gl2.deleteProgram(prog);
				}
			});
		});

		// ── Diagnostic: Textured rendering (texture sampling pipeline) ─────────

		await describe('WebGL2 textured rendering', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('samples a 2x2 RGBA texture to produce red output', async () => {
				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);

				// Create 2x2 texture: all red
				const tex = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_2D, tex);
				const pixels = new Uint8Array([
					255, 0, 0, 255,  255, 0, 0, 255,
					255, 0, 0, 255,  255, 0, 0, 255,
				]);
				gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 2, 2, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, pixels);
				gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
				gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);

				// Passthrough texture shader
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, TEXTURE_VS_300, TEXTURE_FS_300);
				expect(gl2.getProgramParameter(prog, gl2.LINK_STATUS)).toBeTruthy();

				gl2.useProgram(prog);
				const loc = gl2.getUniformLocation(prog, 'uTexture');
				gl2.uniform1i(loc, 0); // texture unit 0
				gl2.activeTexture(gl2.TEXTURE0);
				gl2.bindTexture(gl2.TEXTURE_2D, tex);

				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p[0]).toBe(255); // red
				expect(p[1]).toBe(0);
				expect(p[2]).toBe(0);
				expect(p[3]).toBe(255);

				gl2.deleteTexture(tex);
				gl2.deleteProgram(prog);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
			});
		});

		// ── Diagnostic: FBO chain (post-processing pattern) ─────────────────────

		await describe('WebGL2 FBO chain (post-processing)', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('renders green to FBO1, samples FBO1 texture into FBO2', async () => {
				const VS = ['#version 300 es', 'in vec2 position;',
					'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
				const FS_GREEN = ['#version 300 es', 'precision mediump float;', 'out vec4 c;',
					'void main() { c = vec4(0.0,1.0,0.0,1.0); }'].join('\n');

				// Pass 1: Render green into FBO1
				const fbo1 = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				const status1 = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status1).toBe(gl2.FRAMEBUFFER_COMPLETE);

				const progGreen = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS_GREEN);
				gl2.useProgram(progGreen);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Verify FBO1 has green
				const p1 = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p1[1]).toBe(255); // green channel

				// Pass 2: Sample FBO1 texture → render into FBO2
				const fbo2 = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				const status2 = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status2).toBe(gl2.FRAMEBUFFER_COMPLETE);

				const progTex = makeProgram(gl2 as unknown as WebGLRenderingContext, TEXTURE_VS_300, TEXTURE_FS_300);
				gl2.useProgram(progTex);
				const texLoc = gl2.getUniformLocation(progTex, 'uTexture');
				gl2.uniform1i(texLoc, 0);
				gl2.activeTexture(gl2.TEXTURE0);
				gl2.bindTexture(gl2.TEXTURE_2D, fbo1.colorTex);

				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Verify FBO2 has green (sampled from FBO1)
				const p2 = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p2[1]).toBe(255); // green channel from FBO1 texture

				gl2.deleteProgram(progGreen);
				gl2.deleteProgram(progTex);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo2);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo1);
			});
		});

		// ── Diagnostic: Float FBO chain (RGBA16F post-processing) ───────────────

		await describe('WebGL2 half-float FBO chain', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('renders green to RGBA16F FBO, samples into RGBA8 FBO', async () => {
				const VS = ['#version 300 es', 'in vec2 position;',
					'void main() { gl_Position = vec4(position,0.0,1.0); }'].join('\n');
				const FS_GREEN = ['#version 300 es', 'precision mediump float;', 'out vec4 c;',
					'void main() { c = vec4(0.0,1.0,0.0,1.0); }'].join('\n');

				// Pass 1: Render green → RGBA16F FBO
				const fboFloat = makeTestFBOFloat(gl2 as unknown as WebGL2RenderingContext, 4, 4);
				const status1 = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status1).toBe(gl2.FRAMEBUFFER_COMPLETE);

				const progGreen = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS_GREEN);
				gl2.useProgram(progGreen);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Pass 2: Sample RGBA16F texture → render to RGBA8 FBO
				const fbo2 = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				const progTex = makeProgram(gl2 as unknown as WebGLRenderingContext, TEXTURE_VS_300, TEXTURE_FS_300);
				gl2.useProgram(progTex);
				const texLoc = gl2.getUniformLocation(progTex, 'uTexture');
				gl2.uniform1i(texLoc, 0);
				gl2.activeTexture(gl2.TEXTURE0);
				gl2.bindTexture(gl2.TEXTURE_2D, fboFloat.colorTex);

				gl2.clearColor(0, 0, 0, 1);
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Verify: green survived float → uint8 conversion
				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p[1]).toBe(255);

				gl2.deleteProgram(progGreen);
				gl2.deleteProgram(progTex);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo2);
				// Clean up float FBO
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fboFloat.fb);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, null, 0);
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteTexture(fboFloat.colorTex);
				gl2.deleteFramebuffer(fboFloat.fb);
			});
		});

		// ── Diagnostic: Depth texture as FBO attachment ─────────────────────────

		await describe('WebGL2 depth texture FBO', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('creates FBO with depth texture and renders with depth test', async () => {
				const fbo = makeTestFBOWithDepthTexture(gl2 as unknown as WebGL2RenderingContext, 4, 4);
				const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status).toBe(gl2.FRAMEBUFFER_COMPLETE);

				const VS = ['#version 300 es', 'in vec2 position;', 'uniform float uDepth;',
					'void main() { gl_Position = vec4(position, uDepth, 1.0); }'].join('\n');
				const FS = ['#version 300 es', 'precision mediump float;', 'uniform vec4 uColor;', 'out vec4 c;',
					'void main() { c = uColor; }'].join('\n');

				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, VS, FS);
				gl2.useProgram(prog);

				gl2.enable(gl2.DEPTH_TEST);
				gl2.depthFunc(gl2.LESS);
				gl2.clearColor(0, 0, 0, 1);
				gl2.clearDepth(1.0);
				gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);

				// Draw red at z=0.5
				const colorLoc = gl2.getUniformLocation(prog, 'uColor');
				const depthLoc = gl2.getUniformLocation(prog, 'uDepth');
				gl2.uniform4f(colorLoc, 1, 0, 0, 1);
				gl2.uniform1f(depthLoc, 0.5);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);

				// Draw green at z=0.0 (nearer, should win)
				gl2.uniform4f(colorLoc, 0, 1, 0, 1);
				gl2.uniform1f(depthLoc, 0.0);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);

				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p[1]).toBe(255); // green (nearer)

				gl2.disable(gl2.DEPTH_TEST);
				// Cleanup
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo.fb);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, null, 0);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.DEPTH_ATTACHMENT, gl2.TEXTURE_2D, null, 0);
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteTexture(fbo.colorTex);
				gl2.deleteTexture(fbo.depthTex);
				gl2.deleteFramebuffer(fbo.fb);
				gl2.deleteProgram(prog);
			});
		});

		// ── Diagnostic: generateMipmap ──────────────────────────────────────────

		await describe('WebGL2 generateMipmap', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('generates mipmaps for a 4x4 texture without error', async () => {
				const tex = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_2D, tex);
				const data = new Uint8Array(4 * 4 * 4); // 4x4 RGBA
				for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i+3] = 255; } // red
				gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, 4, 4, 0, gl2.RGBA, gl2.UNSIGNED_BYTE, data);
				gl2.generateMipmap(gl2.TEXTURE_2D);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR_MIPMAP_LINEAR);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Sample the mipmapped texture
				const fbo = makeTestFBO(gl2 as unknown as WebGLRenderingContext, 4, 4);
				const prog = makeProgram(gl2 as unknown as WebGLRenderingContext, TEXTURE_VS_300, TEXTURE_FS_300);
				gl2.useProgram(prog);
				// makeTestFBO unbinds TEXTURE_2D; re-bind the mip-mapped texture before drawing
				gl2.bindTexture(gl2.TEXTURE_2D, tex);
				gl2.uniform1i(gl2.getUniformLocation(prog, 'uTexture'), 0);
				drawTriangle(gl2 as unknown as WebGLRenderingContext);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p[0]).toBeGreaterThan(200); // should be close to red

				gl2.deleteTexture(tex);
				gl2.deleteProgram(prog);
				destroyTestFBO(gl2 as unknown as WebGLRenderingContext, fbo);
			});
		});

		// ── Diagnostic: Cubemap texture ─────────────────────────────────────────

		await describe('WebGL2 cubemap texture', async () => {
			beforeEach(async () => { glArea.make_current(); });

			await it('creates cubemap and verifies FBO attachment', async () => {
				const tex = gl2.createTexture()!;
				gl2.bindTexture(gl2.TEXTURE_CUBE_MAP, tex);

				// Upload 6 faces (1x1 each) with different colors
				const faces = [
					gl2.TEXTURE_CUBE_MAP_POSITIVE_X,
					gl2.TEXTURE_CUBE_MAP_NEGATIVE_X,
					gl2.TEXTURE_CUBE_MAP_POSITIVE_Y,
					gl2.TEXTURE_CUBE_MAP_NEGATIVE_Y,
					gl2.TEXTURE_CUBE_MAP_POSITIVE_Z,
					gl2.TEXTURE_CUBE_MAP_NEGATIVE_Z,
				];
				const colors = [
					[255, 0, 0, 255],  // +X = red
					[0, 255, 0, 255],  // -X = green
					[0, 0, 255, 255],  // +Y = blue
					[255, 255, 0, 255], // -Y = yellow
					[255, 0, 255, 255], // +Z = magenta
					[0, 255, 255, 255], // -Z = cyan
				];

				for (let i = 0; i < 6; i++) {
					gl2.texImage2D(faces[i], 0, gl2.RGBA, 1, 1, 0, gl2.RGBA, gl2.UNSIGNED_BYTE,
						new Uint8Array(colors[i]));
				}
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				gl2.texParameteri(gl2.TEXTURE_CUBE_MAP, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
				gl2.texParameteri(gl2.TEXTURE_CUBE_MAP, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);

				// Attach +X face to FBO and render into it
				const fb = gl2.createFramebuffer()!;
				gl2.bindFramebuffer(gl2.FRAMEBUFFER, fb);
				gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0,
					gl2.TEXTURE_CUBE_MAP_POSITIVE_X, tex, 0);

				const status = gl2.checkFramebufferStatus(gl2.FRAMEBUFFER);
				expect(status).toBe(gl2.FRAMEBUFFER_COMPLETE);

				gl2.viewport(0, 0, 1, 1);
				gl2.clearColor(0, 1, 1, 1); // clear +X face to cyan (overwrite red)
				gl2.clear(gl2.COLOR_BUFFER_BIT);
				expect(gl2.getError()).toBe(gl2.NO_ERROR);

				// Read back: should be cyan
				const p = readPixel(gl2 as unknown as WebGLRenderingContext, 0, 0);
				expect(p[0]).toBe(0);
				expect(p[1]).toBe(255);
				expect(p[2]).toBe(255);

				gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
				gl2.deleteFramebuffer(fb);
				gl2.deleteTexture(tex);
			});
		});

		// All WebGL2 tests complete.
		win.destroy();

	}); // on('Display')
};
