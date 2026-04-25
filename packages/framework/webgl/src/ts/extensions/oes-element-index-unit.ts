import type { WebGLContextBase } from '../webgl-context-base.js';

export class OESElementIndexUint {}

export function getOESElementIndexUint (context: WebGLContextBase) {
  let result = null
  const exts = context.getSupportedExtensions()

  if (exts && exts.indexOf('OES_element_index_uint') >= 0) {
    result = new OESElementIndexUint()
  }

  return result
}
