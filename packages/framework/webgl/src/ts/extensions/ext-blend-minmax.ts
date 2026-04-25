import type { WebGLContextBase } from '../webgl-context-base.js';

export class EXTBlendMinMax {
  MIN_EXT = 0x8007
  MAX_EXT = 0x8008
  constructor () {}
}

export function getEXTBlendMinMax (context: WebGLContextBase) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('EXT_blend_minmax') >= 0) {
    result = new EXTBlendMinMax()
  }

  return result
}
