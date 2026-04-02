// OES_texture_half_float — enables half-float (16-bit) texture formats.
// Exposes HALF_FLOAT_OES constant (0x8D61) used by Three.js.

import type { WebGLRenderingContext } from '../webgl-rendering-context.js';

export class OESTextureHalfFloat {
    readonly HALF_FLOAT_OES = 0x8D61;
}

export function getOESTextureHalfFloat(context: WebGLRenderingContext) {
    const exts = context.getSupportedExtensions();
    if (exts && exts.indexOf('OES_texture_half_float') >= 0) {
        return new OESTextureHalfFloat();
    }
    // WebGL2 contexts always support half-float — return extension even if
    // the native driver doesn't advertise the WebGL1 extension name.
    if ((context as any)._native2) {
        return new OESTextureHalfFloat();
    }
    return null;
}
