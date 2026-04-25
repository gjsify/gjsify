import type { WebGLContextBase } from '../webgl-context-base.js';

export class OESTextureFloat {}

export function getOESTextureFloat (context: WebGLContextBase) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_texture_float') >= 0) {
    result = new OESTextureFloat()
  }

  return result
}
