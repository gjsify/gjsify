import { describe, it, expect } from '@gjsify/unit';

import { fakeMachine } from './fake-machine.js';
import { checkFit, estimateFootprint, parseNvidiaSmi, readMachineMemory, type MachineMemory } from './index.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const SMI = 'nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits';
const card = (n: number) => `/sys/class/drm/card${n}/device`;

const machine = (ramAvailable: number, gpus: MachineMemory['gpus']): MachineMemory => ({
    ramTotalBytes: 64 * GIB,
    ramAvailableBytes: ramAvailable,
    gpus,
});

export default async () => {
    await describe('parseNvidiaSmi', async () => {
        await it('reads one GPU per line, in MiB', async () => {
            expect(parseNvidiaSmi('NVIDIA GeForce RTX 4090, 24564, 1023\nTesla T4, 15360, 0\n')).toStrictEqual([
                {
                    vendor: 'nvidia',
                    name: 'NVIDIA GeForce RTX 4090',
                    totalBytes: 24564 * MIB,
                    usedBytes: 1023 * MIB,
                    unified: false,
                    source: 'nvidia-smi',
                },
                {
                    vendor: 'nvidia',
                    name: 'Tesla T4',
                    totalBytes: 15360 * MIB,
                    usedBytes: 0,
                    unified: false,
                    source: 'nvidia-smi',
                },
            ]);
        });
        await it('says nothing for a missing tool or an error message', async () => {
            expect(parseNvidiaSmi(undefined)).toBe(undefined);
            expect(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the driver.')).toBe(
                undefined,
            );
            expect(parseNvidiaSmi('GPU, [N/A], [N/A]')).toBe(undefined);
        });
    });

    await describe('readMachineMemory', async () => {
        await it('reads an AMD card from sysfs and skips connectors', async () => {
            const memory = readMachineMemory(
                fakeMachine({
                    files: {
                        [`${card(0)}/vendor`]: '0x1002',
                        [`${card(0)}/mem_info_vram_total`]: String(16 * GIB),
                        [`${card(0)}/mem_info_vram_used`]: String(2 * GIB),
                        '/sys/class/drm/card0-DP-1/status': 'connected',
                    },
                    totalmem: 32 * GIB,
                    freemem: 20 * GIB,
                }),
            );
            expect(memory.ramTotalBytes).toBe(32 * GIB);
            expect(memory.ramAvailableBytes).toBe(20 * GIB);
            expect(memory.gpus).toStrictEqual([
                {
                    vendor: 'amd',
                    name: undefined,
                    totalBytes: 16 * GIB,
                    usedBytes: 2 * GIB,
                    unified: false,
                    source: 'sysfs',
                },
            ]);
        });
        await it('asks nvidia-smi for an NVIDIA card, and keeps it unknown without it', async () => {
            const files = { [`${card(1)}/vendor`]: '0x10de' };
            const withSmi = readMachineMemory(fakeMachine({ files, commands: { [SMI]: 'RTX 3060, 12288, 512' } }));
            expect(withSmi.gpus[0].totalBytes).toBe(12288 * MIB);
            const without = readMachineMemory(fakeMachine({ files }));
            expect(without.gpus).toStrictEqual([{ vendor: 'nvidia', unified: false, source: 'none' }]);
        });
        await it('marks an integrated Intel GPU unified with unknown size', async () => {
            const memory = readMachineMemory(fakeMachine({ files: { [`${card(0)}/vendor`]: '0x8086' } }));
            expect(memory.gpus[0].vendor).toBe('intel');
            expect(memory.gpus[0].unified).toBe(true);
            expect(memory.gpus[0].totalBytes).toBe(undefined);
        });
        await it("takes Apple silicon's wired limit, else its default share of RAM", async () => {
            const raised = fakeMachine({
                platform: 'darwin',
                arch: 'arm64',
                commands: { '/usr/sbin/sysctl -n iogpu.wired_limit_mb': '28000\n' },
            });
            expect(readMachineMemory(raised).gpus[0].totalBytes).toBe(28000 * MIB);
            const stock = fakeMachine({
                platform: 'darwin',
                arch: 'arm64',
                totalmem: 16 * GIB,
                commands: { '/usr/sbin/sysctl -n iogpu.wired_limit_mb': '0' },
            });
            expect(readMachineMemory(stock).gpus[0]).toStrictEqual({
                vendor: 'apple',
                totalBytes: 12 * GIB,
                unified: true,
                source: 'sysctl',
            });
        });
        await it('reports an unknown GPU on Windows without nvidia-smi and on Intel Macs', async () => {
            expect(readMachineMemory(fakeMachine({ platform: 'win32' })).gpus[0].source).toBe('none');
            expect(readMachineMemory(fakeMachine({ platform: 'darwin' })).gpus[0].vendor).toBe('unknown');
        });
    });

    await describe('estimateFootprint', async () => {
        await it('adds weights, KV cache and overhead', async () => {
            // 8 B weights at 4.5 bits, 4096 tokens × 128 KiB, 512 MiB overhead.
            const bytes = estimateFootprint({
                parameters: 8e9,
                bitsPerWeight: 4.5,
                contextTokens: 4096,
                kvBytesPerToken: 128 * 1024,
                overheadBytes: 512 * MIB,
            });
            expect(bytes).toBe(4.5e9 + 512 * MIB + 512 * MIB);
        });
        await it('prefers the file size over the parameter count', async () => {
            expect(estimateFootprint({ weightsBytes: 100, parameters: 1e9, bitsPerWeight: 16 })).toBe(100);
        });
        await it('refuses to guess the weights', async () => {
            let error: unknown;
            try {
                estimateFootprint({ parameters: 1e9 });
            } catch (err) {
                error = err;
            }
            expect(error instanceof TypeError).toBe(true);
        });
    });

    await describe('checkFit', async () => {
        const amd = (total: number, used: number) =>
            ({ vendor: 'amd', totalBytes: total, usedBytes: used, unified: false, source: 'sysfs' }) as const;

        await it('places a model on the GPU with enough FREE memory', async () => {
            const memory = machine(4 * GIB, [amd(8 * GIB, 6 * GIB), amd(24 * GIB, 1 * GIB)]);
            expect(checkFit(10 * GIB, memory)).toStrictEqual({ placement: 'gpu', requiredBytes: 10 * GIB, gpu: 1 });
        });
        await it('counts memory a running server already holds as used', async () => {
            // 24 GiB card, 20 GiB taken by another server's model: 6 GiB only fits split.
            const memory = machine(8 * GIB, [amd(24 * GIB, 20 * GIB)]);
            expect(checkFit(6 * GIB, memory).placement).toBe('gpu+cpu');
        });
        await it('falls back to RAM, then rules out', async () => {
            expect(checkFit(6 * GIB, machine(8 * GIB, [])).placement).toBe('cpu');
            expect(checkFit(20 * GIB, machine(8 * GIB, [amd(8 * GIB, 0)])).placement).toBe('none');
        });
        await it('never splits onto RAM for unified memory', async () => {
            const apple = { vendor: 'apple', totalBytes: 12 * GIB, unified: true, source: 'sysctl' } as const;
            expect(checkFit(14 * GIB, machine(15 * GIB, [apple])).placement).toBe('cpu');
            // Unified memory is capped by what RAM still has.
            expect(checkFit(10 * GIB, machine(6 * GIB, [apple])).placement).toBe('none');
        });
        await it('does not rule out what an unreadable GPU might hold', async () => {
            const unknown = { vendor: 'nvidia', unified: false, source: 'none' } as const;
            expect(checkFit(40 * GIB, machine(8 * GIB, [unknown])).placement).toBe('unknown');
            expect(checkFit(4 * GIB, machine(8 * GIB, [unknown])).placement).toBe('cpu');
        });
        await it('bounds an integrated GPU of unknown size by RAM', async () => {
            const intel = { vendor: 'intel', unified: true, source: 'none' } as const;
            expect(checkFit(6 * GIB, machine(8 * GIB, [intel]))).toStrictEqual({
                placement: 'gpu',
                requiredBytes: 6 * GIB,
                gpu: 0,
            });
            expect(checkFit(40 * GIB, machine(8 * GIB, [intel])).placement).toBe('none');
        });
    });
};
