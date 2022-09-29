import Gwebgl from '@gjsify/types/Gwebgl-0.1';
import type { WebGLConstants } from './types/index.js'

const gl = new Gwebgl.WebGLRenderingContext() as Gwebgl.WebGLRenderingContext & WebGLConstants;

const hash = gl.get_webgl_constants();
for (const [k, v] of Object.entries(hash)) {
    Object.defineProperty(gl, k, { value: v });
}

export { gl }