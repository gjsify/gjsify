import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class OESTextureFloatLinear {}

export function getOESTextureFloatLinear (context: WebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_texture_float_linear') >= 0) {
    result = new OESTextureFloatLinear()
  }

  return result
}
