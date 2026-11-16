// The compute estimate against what sd.cpp measured (ADR 0146), and the size check on made-up
// machines. The addon is never loaded here.

import { describe, expect, it } from '@gjsify/unit';

import type { GpuMemory, MachineMemory } from '@gjsify/machine-fit';

import {
    assertSdCppSizeFits,
    estimateSdCppRequirement,
    FLUX2_KLEIN_4B_COMPUTE,
    SDCPP_DEVICE_RESERVE_BYTES,
    sdCppDiffusionBytes,
} from './sdcpp-compute.js';

const MIB = 1024 * 1024;
const GIB = 1024 ** 3;

/** Measured on an 8 GB RX 6600: [side × side or w×h, flash attention MB, without MB]. */
const MEASURED: ReadonlyArray<{ width: number; height: number; flash: number; plain: number }> = [
    { width: 512, height: 512, flash: 329, plain: 491 },
    { width: 768, height: 768, flash: 598, plain: 1191 },
    { width: 1024, height: 1024, flash: 1120, plain: 2705 },
    { width: 1024, height: 1536, flash: 1489, plain: 5155 },
];

const card = (totalGib: number, usedGib: number): GpuMemory => ({
    vendor: 'amd',
    totalBytes: totalGib * GIB,
    usedBytes: usedGib * GIB,
    unified: false,
    source: 'sysfs',
});

const machine = (ramGib: number, gpus: GpuMemory[]): MachineMemory => ({
    ramTotalBytes: 32 * GIB,
    ramAvailableBytes: ramGib * GIB,
    gpus,
});

export default async () => {
    await describe('sd.cpp compute estimate', async () => {
        await it('stays within 15 % of the measured buffers, both ways', async () => {
            for (const point of MEASURED) {
                for (const [flashAttention, measured] of [
                    [true, point.flash],
                    [false, point.plain],
                ] as const) {
                    const estimate = sdCppDiffusionBytes({ width: point.width, height: point.height, flashAttention });
                    const deviation = estimate / MIB / measured - 1;
                    expect(Math.abs(deviation)).toBeLessThan(0.15);
                }
            }
        });

        await it('grows quadratically without flash attention and linearly with it', async () => {
            const at = (side: number, flashAttention: boolean) =>
                sdCppDiffusionBytes({ width: side, height: side, flashAttention });
            expect(at(1024, false)).toBeGreaterThan(at(1024, true));
            const flashGrowth = at(1024, true) - at(512, true);
            const plainGrowth = at(1024, false) - at(512, false);
            expect(plainGrowth).toBeGreaterThan(flashGrowth * 2);
        });

        await it('takes the largest phase plus sd.cpp reserve, and the files as streamable', async () => {
            const small = estimateSdCppRequirement({ width: 64, height: 64, weightsBytes: 12 * GIB });
            // At 64x64 the tiled VAE decode is the largest phase.
            expect(small.deviceBytes).toBe(FLUX2_KLEIN_4B_COMPUTE.vaeTiledBytes + SDCPP_DEVICE_RESERVE_BYTES);
            expect(small.streamableBytes).toBe(12 * GIB);
            expect(small.diskBacked).toBe(true);
            const large = estimateSdCppRequirement({ width: 1024, height: 1536, flashAttention: true });
            expect(large.deviceBytes).toBe(
                sdCppDiffusionBytes({ width: 1024, height: 1536, flashAttention: true }) + SDCPP_DEVICE_RESERVE_BYTES,
            );
        });

        await it('uses a model own profile', async () => {
            const profile = { ...FLUX2_KLEIN_4B_COMPUTE, baseBytes: 4 * GIB };
            const own = estimateSdCppRequirement({ width: 1024, height: 1024, flashAttention: true, profile });
            const shipped = estimateSdCppRequirement({ width: 1024, height: 1024, flashAttention: true });
            expect(own.deviceBytes - shipped.deviceBytes).toBe(4 * GIB - FLUX2_KLEIN_4B_COMPUTE.baseBytes);
        });
    });

    await describe('assertSdCppSizeFits', async () => {
        // 8 GiB card with 3.5 GiB held by the desktop: 4.5 GiB free, under what 1024x1536 needs without flash attention.
        const desktop = machine(2, [card(8, 3.5)]);
        const run = (check: Parameters<typeof assertSdCppSizeFits>[0]) => {
            try {
                assertSdCppSizeFits(check);
            } catch (error) {
                return error as DOMException;
            }
            return undefined;
        };

        await it('lets a size through that fits', async () => {
            expect(
                run({ width: 1024, height: 1024, flashAttention: true, weightsBytes: 12 * GIB, memory: desktop }),
            ).toBe(undefined);
        });

        await it('throws a QuotaExceededError naming the size, with the flash attention tip', async () => {
            const error = run({ width: 1024, height: 1536, weightsBytes: 12 * GIB, memory: desktop });
            expect(error?.name).toBe('QuotaExceededError');
            expect(error?.message).toContain('1024x1536');
            expect(error?.message).toContain('flash attention');
        });

        await it('does not give the tip when flash attention is already on', async () => {
            const tiny = machine(0.25, [card(1, 0.9)]);
            const error = run({ width: 1024, height: 1536, flashAttention: true, memory: tiny });
            expect(error?.name).toBe('QuotaExceededError');
            expect(error?.message.includes('flash attention')).toBe(false);
        });

        await it('never throws for GPU memory on a cpu-only run', async () => {
            const full = machine(16, [card(8, 8)]);
            expect(run({ width: 1024, height: 1536, memory: full, cpuOnly: true })).toBe(undefined);
            // Only RAM counts: a roomy GPU does not rescue a cpu-only run.
            const roomy = machine(2, [card(24, 0)]);
            expect(run({ width: 1024, height: 1536, memory: roomy })).toBe(undefined);
            expect(run({ width: 1024, height: 1536, memory: roomy, cpuOnly: true })?.name).toBe('QuotaExceededError');
        });
    });
};
