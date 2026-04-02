// EXT_color_buffer_float — enables rendering to 32-bit float textures and renderbuffers.
// Reference: refs/headless-gl/src/javascript/extensions/ext-color-buffer-float.js
// This extension is a pure capability flag with no additional methods.

import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class EXTColorBufferFloat {}

export function getEXTColorBufferFloat(context: WebGLRenderingContext) {
    const exts = context.getSupportedExtensions();
    if (exts && exts.indexOf('EXT_color_buffer_float') >= 0) {
        return new EXTColorBufferFloat();
    }
    return null;
}
