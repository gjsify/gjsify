import type { WebGLContextBase } from '../webgl-context-base.js';

export class OESTextureFloatLinear {}

export function getOESTextureFloatLinear (context: WebGLContextBase) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_texture_float_linear') >= 0) {
    result = new OESTextureFloatLinear()
  }

  return result
}
