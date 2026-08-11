// Answers "is this GL context rasterised on the CPU?" from the unmasked
// `RENDERER` string. Pure — no GTK, no typelib — so it is testable on Node.

/**
 * Substrings identifying a CPU rasteriser in a GL `RENDERER` string, matched
 * case-insensitively. Each is a name a real implementation reports: macOS without a
 * usable GPU, Mesa's three software drivers, ANGLE's SwiftShader, Windows without a
 * graphics driver, OSMesa.
 *
 * SUBSTRING matching, as Chrome's GPU blocklist and three.js do, because the strings
 * carry vendor noise around the driver name: Mesa reports `llvmpipe (LLVM 15.0.7,
 * 256 bits)`.
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
 * True when the unmasked `RENDERER` string names a GL implementation that rasterises on
 * the CPU.
 *
 * A DIAGNOSTIC, not a capability check: measured on one GPU-less macOS host, the same
 * `Apple Software Renderer` drew a demand-driven three.js scene at 1.2 ms per frame while
 * a fill-heavy animating 2D game needed 1.1 s for a single textured full-screen draw.
 * The workload separates them, not the driver, so key any fallback on a MEASURED frame
 * budget and use this only to name the cause.
 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
    if (!renderer) return false;
    const haystack = renderer.toLowerCase();
    return SOFTWARE_RENDERER_MARKERS.some((marker) => haystack.includes(marker));
}
