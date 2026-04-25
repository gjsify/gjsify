// EXT_color_buffer_float — enables rendering to 32-bit float textures and renderbuffers.
// Reference: refs/headless-gl/src/javascript/extensions/ext-color-buffer-float.js
// This extension is a pure capability flag with no additional methods.

import type { WebGLContextBase } from '../webgl-context-base.js';

export class EXTColorBufferFloat {}

export function getEXTColorBufferFloat(context: WebGLContextBase) {
    const exts = context.getSupportedExtensions();
    if (exts && exts.indexOf('EXT_color_buffer_float') >= 0) {
        return new EXTColorBufferFloat();
    }
    return null;
}
