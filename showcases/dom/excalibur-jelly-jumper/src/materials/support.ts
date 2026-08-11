import type * as ex from 'excalibur';

/**
 * True when `ctx` can compile the shader an `ex.Material` is made of.
 *
 * `ex.Material` is WebGL-only: handed the 2D Canvas context it warns, leaves `_shader` undefined,
 * and then throws on the next property read inside its own constructor — aborting scene init, so a
 * game that creates one material never starts. That makes the Canvas fallback dead rather than
 * degraded, and only a real fallback reaches it, which is why it went unnoticed (gjsify#1107).
 *
 * Probes `createShader` instead of the class name: it is the exact capability a material needs, it
 * survives minification, and `ExcaliburGraphicsContextWebGL` is not exported to `instanceof`.
 */
export function supportsMaterials(ctx: ex.ExcaliburGraphicsContext): boolean {
    return typeof (ctx as { createShader?: unknown }).createShader === 'function';
}
