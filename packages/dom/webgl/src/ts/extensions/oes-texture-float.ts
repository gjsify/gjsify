import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class OESTextureFloat {}

export function getOESTextureFloat (context: GjsifyWebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_texture_float') >= 0) {
    result = new OESTextureFloat()
  }

  return result
}
