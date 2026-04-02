// EXT_color_buffer_half_float — enables rendering to 16-bit half-float textures and renderbuffers.
// This extension is a pure capability flag with no additional methods.

import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class EXTColorBufferHalfFloat {}

export function getEXTColorBufferHalfFloat(context: WebGLRenderingContext) {
    const exts = context.getSupportedExtensions();
    if (exts && exts.indexOf('EXT_color_buffer_half_float') >= 0) {
        return new EXTColorBufferHalfFloat();
    }
    return null;
}
