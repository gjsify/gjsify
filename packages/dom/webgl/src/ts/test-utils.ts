// GTK-backed WebGL test utilities for @gjsify/webgl — original implementation
// Ported from refs/headless-gl/test/util/{make-shader,make-program,draw-triangle}.js
// Original: MIT license, headless-gl contributors
// Modifications: TypeScript types; no context creation (context is provided by CanvasWebGLWidget);
//   makeTestFBO/destroyTestFBO helpers for off-screen rendering (FBO 0 is the Wayland
//   surface and is not readable outside the GTK render signal).

/** Compile a WebGL shader from source. Does not check compile status. */
export function makeShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
}

/**
 * Link a WebGL program from vertex + fragment source strings.
 * Binds attribute "position" to location 0 before linking so that drawTriangle() works
 * without an explicit getAttribLocation() call.
 * Does not check link status — call getProgramParameter(prog, LINK_STATUS) if needed.
 */
export function makeProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
    const frag = makeShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const vert = makeShader(gl, gl.VERTEX_SHADER, vsSrc);
    const program = gl.createProgram()!;
    gl.attachShader(program, frag);
    gl.attachShader(program, vert);
    // Pin 'position' attribute to location 0 so drawTriangle() can use vertexAttribPointer(0,...).
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    return program;
}

/**
 * Draw a fullscreen triangle using attribute location 0.
 * Covers the entire clip space: vertices at (-2,-2), (-2,4), (4,-2).
 * The active program must expose a vec2 attribute named "position" at location 0
 * (ensured by makeProgram's bindAttribLocation call).
 */
export function drawTriangle(gl: WebGLRenderingContext): void {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-2, -2, -2, 4, 4, -2]), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disableVertexAttribArray(0);
    gl.deleteBuffer(buffer);
}

/** Read a single RGBA pixel at (x, y). Defaults to (0, 0). */
export function readPixel(gl: WebGLRenderingContext, x = 0, y = 0): Uint8Array {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel;
}

/** Return true if |a[i] - b[i]| <= tolerance for every RGBA component. */
export function pixelClose(a: Uint8Array, b: number[], tolerance = 3): boolean {
    for (let i = 0; i < 4; i++) {
        if (Math.abs(a[i] - b[i]) > tolerance) return false;
    }
    return true;
}

// ─── Off-screen FBO helpers ────────────────────────────────────────────────────
//
// GtkGLArea renders into GTK's own FBO; FBO 0 (the Wayland surface) is not
// readable via readPixels outside the render signal. All pixel-verification
// tests must bind their own RGBA FBO before rendering and reading.

export interface TestFBO {
    fb: WebGLFramebuffer;
    colorTex: WebGLTexture;
    width: number;
    height: number;
}

export interface TestFBOWithDepth extends TestFBO {
    depthRb: WebGLRenderbuffer;
}

/**
 * Create a w×h RGBA8 FBO and bind it as the current framebuffer.
 * Also sets the viewport to (0, 0, w, h).
 * Call destroyTestFBO() when done.
 */
export function makeTestFBO(gl: WebGLRenderingContext, width = 4, height = 4): TestFBO {
    const fb = gl.createFramebuffer()!;
    const colorTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.viewport(0, 0, width, height);
    return { fb, colorTex, width, height };
}

/**
 * Create a w×h RGBA8 FBO with a DEPTH_COMPONENT16 renderbuffer and bind it.
 * Also sets the viewport to (0, 0, w, h).
 * Call destroyTestFBOWithDepth() when done.
 */
export function makeTestFBOWithDepth(gl: WebGLRenderingContext, width = 4, height = 4): TestFBOWithDepth {
    const base = makeTestFBO(gl, width, height);
    const depthRb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
    return { ...base, depthRb };
}

/** Unbind the FBO and delete the color texture. */
export function destroyTestFBO(gl: WebGLRenderingContext, fbo: TestFBO): void {
    // Detach the texture before deleting to avoid reference-counting recursion
    // in the Linkable system when deleteTexture is called on an attached texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(fbo.colorTex);
    gl.deleteFramebuffer(fbo.fb);
}

/** Unbind the FBO and delete both the color texture and depth renderbuffer. */
export function destroyTestFBOWithDepth(gl: WebGLRenderingContext, fbo: TestFBOWithDepth): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(fbo.colorTex);
    gl.deleteRenderbuffer(fbo.depthRb);
    gl.deleteFramebuffer(fbo.fb);
}

// ─── WebGL2 test helpers ──────────────────────────────────────────────────────

export interface TestFBOFloat {
    fb: WebGLFramebuffer;
    colorTex: WebGLTexture;
    width: number;
    height: number;
}

/**
 * Create a w×h RGBA16F FBO (half-float color texture) and bind it.
 * Used for testing Three.js post-processing render target patterns.
 */
export function makeTestFBOFloat(gl: WebGL2RenderingContext, width = 4, height = 4): TestFBOFloat {
    const RGBA16F = 0x881A;
    const HALF_FLOAT = 0x140B;
    const fb = gl.createFramebuffer()!;
    const colorTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, RGBA16F, width, height, 0, gl.RGBA, HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.viewport(0, 0, width, height);
    return { fb, colorTex, width, height };
}

export interface TestFBOWithDepthTexture extends TestFBO {
    depthTex: WebGLTexture;
}

/**
 * Create a w×h RGBA8 FBO with a DEPTH_COMPONENT24 texture attachment.
 * Three.js uses depth textures (not renderbuffers) for RenderPixelatedPass.
 */
export function makeTestFBOWithDepthTexture(gl: WebGL2RenderingContext, width = 4, height = 4): TestFBOWithDepthTexture {
    const DEPTH_COMPONENT24 = 0x81A6;
    const DEPTH_COMPONENT = 0x1902;
    const UNSIGNED_INT = 0x1405;

    const fb = gl.createFramebuffer()!;
    // Color attachment
    const colorTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Depth texture attachment
    const depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, DEPTH_COMPONENT24, width, height, 0, DEPTH_COMPONENT, UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.viewport(0, 0, width, height);
    return { fb, colorTex, depthTex, width, height };
}

/** WebGL2 passthrough texture shader (samples texture at UV and outputs it). */
export const TEXTURE_VS_300 = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

export const TEXTURE_FS_300 = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
in vec2 vUv;
out vec4 fragColor;
void main() {
    fragColor = texture(uTexture, vUv);
}`;

/** WebGL2 cubemap sampling shader. */
export const CUBEMAP_FS_300 = `#version 300 es
precision mediump float;
uniform samplerCube uCubemap;
uniform vec3 uDirection;
out vec4 fragColor;
void main() {
    fragColor = texture(uCubemap, uDirection);
}`;
