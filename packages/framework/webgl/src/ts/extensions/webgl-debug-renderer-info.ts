import type { WebGLContextBase } from '../webgl-context-base.js';

/**
 * `WEBGL_debug_renderer_info` — the two `getParameter` pnames that return the
 * UNMASKED driver strings instead of the spec's deliberately vague defaults.
 *
 * Browsers mask `VENDOR`/`RENDERER` for fingerprinting reasons and we match that
 * (`RENDERER` answers `'ANGLE'`), so without this extension there is NO way for a
 * consumer to learn which GL implementation it actually got. That mattered: a
 * GPU-less host silently hands out a CPU rasteriser, every draw call still
 * succeeds, and the only symptom is a frame budget 1000x over — indistinguishable
 * from an application bug until someone reaches into the private native handle.
 *
 * The masking rationale does not apply here: a GJS/GTK app is not a web origin,
 * so the extension is always available rather than gated on a permission.
 *
 * @see https://registry.khronos.org/webgl/extensions/WEBGL_debug_renderer_info/
 */
export class WEBGLDebugRendererInfo {
    readonly UNMASKED_VENDOR_WEBGL = 0x9245;
    readonly UNMASKED_RENDERER_WEBGL = 0x9246;
}

export function getWEBGLDebugRendererInfo(_context: WebGLContextBase): WEBGLDebugRendererInfo {
    return new WEBGLDebugRendererInfo();
}
