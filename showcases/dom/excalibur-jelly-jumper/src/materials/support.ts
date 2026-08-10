import type * as ex from 'excalibur';

/**
 * True when `ctx` can compile the shader an `ex.Material` is made of.
 *
 * `ex.Material` is WebGL-only. Handed the 2D Canvas context it logs "currently
 * only WebGL is supported" and then leaves its `_shader` undefined, and the very
 * next property read inside its own constructor throws — which aborts scene
 * initialization, so a game that creates one material never starts at all. That
 * turns the 2D Canvas renderer from a degraded mode into a dead one, and it is
 * only reachable once something actually falls back, which is why it went
 * unnoticed (gjsify#1107).
 *
 * Asks for `createShader` rather than sniffing the class name: it is the exact
 * capability a material needs, it survives minification, and `ExcaliburGraphics-
 * ContextWebGL` is not exported to `instanceof` against.
 */
export function supportsMaterials(ctx: ex.ExcaliburGraphicsContext): boolean {
    return typeof (ctx as { createShader?: unknown }).createShader === 'function';
}
