import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class EXTBlendMinMax {
  MIN_EXT = 0x8007
  MAX_EXT = 0x8008
  constructor () {}
}

export function getEXTBlendMinMax (context: GjsifyWebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('EXT_blend_minmax') >= 0) {
    result = new EXTBlendMinMax()
  }

  return result
}
