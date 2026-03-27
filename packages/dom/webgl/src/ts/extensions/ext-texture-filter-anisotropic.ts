import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class EXTTextureFilterAnisotropic {
  TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE
  MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF
  constructor () {}
}

export function getEXTTextureFilterAnisotropic (context: GjsifyWebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('EXT_texture_filter_anisotropic') >= 0) {
    result = new EXTTextureFilterAnisotropic()
  }

  return result
}
