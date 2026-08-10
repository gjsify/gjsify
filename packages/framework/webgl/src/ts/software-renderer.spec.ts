// Which RENDERER strings count as a CPU rasteriser.
//
// The strings below are verbatim from real implementations, not invented: the
// darwin one was measured on a GPU-less macOS 15.7 VM (QEMU VGA, 7 MB VRAM),
// where it took a single textured full-screen `drawArraysInstanced` 1.1 s and
// made a game look frozen rather than slow. Pinning the exact spellings is the
// point of this spec — the check is a substring match, so a marker that drifts
// out of a driver's string silently stops matching.

import { describe, expect, it } from '@gjsify/unit';
import { isSoftwareRenderer } from './software-renderer.js';

export default async () => {
    await describe('isSoftwareRenderer', async () => {
        await it('recognises the CPU rasterisers we have seen in the wild', async () => {
            expect(isSoftwareRenderer('Apple Software Renderer')).toBe(true);
            expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
            expect(isSoftwareRenderer('softpipe')).toBe(true);
            expect(isSoftwareRenderer('Gallium 0.4 on swrast')).toBe(true);
            expect(isSoftwareRenderer('Google SwiftShader')).toBe(true);
            expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
            expect(isSoftwareRenderer('Mesa OffScreen')).toBe(true);
        });

        await it('is case-insensitive', async () => {
            expect(isSoftwareRenderer('APPLE SOFTWARE RENDERER')).toBe(true);
            expect(isSoftwareRenderer('LLVMpipe')).toBe(true);
        });

        await it('leaves hardware renderers alone', async () => {
            expect(isSoftwareRenderer('Apple M1 Pro')).toBe(false);
            expect(isSoftwareRenderer('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe(false);
            expect(isSoftwareRenderer('NVIDIA GeForce RTX 3080/PCIe/SSE2')).toBe(false);
            expect(isSoftwareRenderer('AMD Radeon RX 6800 XT (radeonsi, navi21)')).toBe(false);
            // The masked default every browser reports — says nothing either way.
            expect(isSoftwareRenderer('ANGLE')).toBe(false);
        });

        await it('treats an absent string as unknown, not as software', async () => {
            expect(isSoftwareRenderer('')).toBe(false);
            expect(isSoftwareRenderer(null)).toBe(false);
            expect(isSoftwareRenderer(undefined)).toBe(false);
        });
    });
};
