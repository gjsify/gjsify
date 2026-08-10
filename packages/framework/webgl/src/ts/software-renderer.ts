// Answers "is this GL context rasterised on the CPU?" from the unmasked
// `RENDERER` string. Pure — no GTK, no typelib — so it is testable on Node.

/**
 * Substrings that identify a CPU rasteriser in a GL `RENDERER` string.
 *
 * Matched case-insensitively. Every entry is a name a real implementation
 * reports, not a guess:
 *
 * - `apple software renderer` — macOS with no usable GPU (VMs, headless hosts)
 * - `llvmpipe`, `softpipe`, `swrast` — Mesa's three software drivers
 * - `swiftshader` — Chrome/ANGLE's software backend
 * - `microsoft basic render driver` — Windows without a graphics driver
 * - `mesa offscreen` — OSMesa
 *
 * Substring matching is what the ecosystem does (Chrome's GPU blocklist,
 * three.js, Babylon) because the strings carry vendor/version noise around the
 * driver name: Mesa reports `llvmpipe (LLVM 15.0.7, 256 bits)`.
 */
const SOFTWARE_RENDERER_MARKERS = [
    'apple software renderer',
    'llvmpipe',
    'softpipe',
    'swrast',
    'swiftshader',
    'microsoft basic render driver',
    'mesa offscreen',
] as const;

/**
 * True when `renderer` names a GL implementation that rasterises on the CPU.
 *
 * This is a DIAGNOSTIC, not a capability check, and deliberately so: a software
 * renderer is not by itself a reason to change behaviour. Measured on one
 * GPU-less macOS host, the same `Apple Software Renderer` draws a demand-driven
 * three.js scene and a flat-shaded full-screen quad without trouble (1.2 ms per
 * frame) while a continuously animating, fill-heavy 2D game needs 1.1 s for a
 * single textured full-screen draw. What separates them is the workload, not the
 * driver — so key any fallback on a MEASURED frame budget and use this only to
 * name the cause.
 *
 * @param renderer The unmasked `RENDERER` string, e.g. from
 *   `gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)`.
 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
    if (!renderer) return false;
    const haystack = renderer.toLowerCase();
    return SOFTWARE_RENDERER_MARKERS.some((marker) => haystack.includes(marker));
}
