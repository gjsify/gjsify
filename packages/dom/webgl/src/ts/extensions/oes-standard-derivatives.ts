import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class OESStandardDerivatives {
  FRAGMENT_SHADER_DERIVATIVE_HINT_OES = 0x8B8B
  constructor () {}
}

export function getOESStandardDerivatives (context: GjsifyWebGLRenderingContext) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_standard_derivatives') >= 0) {
    result = new OESStandardDerivatives()
  }

  return result
}
