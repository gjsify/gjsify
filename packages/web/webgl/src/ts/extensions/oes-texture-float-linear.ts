import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class OESTextureFloatLinear {}

export function getOESTextureFloatLinear (context: GjsifyWebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_texture_float_linear') >= 0) {
    result = new OESTextureFloatLinear()
  }

  return result
}
