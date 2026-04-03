import type { WebGLContextBase } from '../webgl-context-base.js';

export class EXTTextureFilterAnisotropic {
  TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE
  MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF
  constructor () {}
}

export function getEXTTextureFilterAnisotropic (context: WebGLContextBase) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('EXT_texture_filter_anisotropic') >= 0) {
    result = new EXTTextureFilterAnisotropic()
  }

  return result
}
