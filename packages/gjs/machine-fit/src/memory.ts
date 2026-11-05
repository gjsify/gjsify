/**
 * How much memory this machine has for a model, and where: RAM, and per GPU its dedicated or
 * unified memory (ADR 0136).
 *
 * RAM comes from `node:os`, which already answers it everywhere. The GPU side is what `os` lacks,
 * read without native code: sysfs for AMD on Linux, `nvidia-smi` for NVIDIA on Linux and Windows,
 * `sysctl` on Apple silicon. What none of them tells — an Intel GPU's share of RAM, any GPU on
 * Windows without `nvidia-smi` — stays `undefined`, and {@link checkFit} treats undefined as
 * "cannot rule out", never as zero.
 */

import { join } from 'node:path';

import { systemProbe, type MachineProbe } from './machine-probe.js';

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';

export type GpuMemorySource = 'sysfs' | 'nvidia-smi' | 'sysctl' | 'none';

export interface GpuMemory {
    readonly vendor: GpuVendor;
    readonly name?: string;
    /** Memory the GPU can use, in bytes; for unified memory the share of RAM it may wire. */
    readonly totalBytes?: number;
    /**
     * In use right now, by ANY process — a model another server holds (Ollama, LM Studio) counts.
     * Unknown for unified memory, where RAM availability says it.
     */
    readonly usedBytes?: number;
    /** The GPU shares system RAM (Apple silicon, an integrated GPU). */
    readonly unified: boolean;
    readonly source: GpuMemorySource;
}

export interface MachineMemory {
    readonly ramTotalBytes: number;
    readonly ramAvailableBytes: number;
    readonly gpus: readonly GpuMemory[];
}

const DRM = '/sys/class/drm';
const MIB = 1024 * 1024;

const PCI_VENDORS: Readonly<Record<string, GpuVendor>> = {
    '0x10de': 'nvidia',
    '0x1002': 'amd',
    '0x8086': 'intel',
};

/** Parse a sysfs number; `undefined` for anything that is not a non-negative integer. */
function bytes(text: string | undefined): number | undefined {
    if (text === undefined || !/^\d+$/.test(text)) return undefined;
    return Number(text);
}

/**
 * The GPUs `nvidia-smi` reports, or `undefined` when it is not there or says nothing usable.
 *
 * `--format=csv,noheader,nounits` prints one line per GPU, memory in MiB:
 * `NVIDIA GeForce RTX 4090, 24564, 1023`.
 */
export function parseNvidiaSmi(output: string | undefined): GpuMemory[] | undefined {
    if (output === undefined) return undefined;
    const gpus: GpuMemory[] = [];
    for (const line of output.split('\n')) {
        const fields = line.split(',').map((field) => field.trim());
        if (fields.length !== 3) continue;
        const [name, total, used] = fields;
        const totalMib = bytes(total);
        const usedMib = bytes(used);
        if (totalMib === undefined) continue;
        gpus.push({
            vendor: 'nvidia',
            name,
            totalBytes: totalMib * MIB,
            usedBytes: usedMib === undefined ? undefined : usedMib * MIB,
            unified: false,
            source: 'nvidia-smi',
        });
    }
    return gpus.length > 0 ? gpus : undefined;
}

function nvidiaSmi(probe: MachineProbe): GpuMemory[] | undefined {
    const output = probe.run(
        'nvidia-smi',
        ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'],
        3000,
    );
    return parseNvidiaSmi(output);
}

/** One entry per DRM card (`card0`, not its connectors `card0-DP-1`). */
function linuxGpus(probe: MachineProbe): GpuMemory[] {
    const gpus: GpuMemory[] = [];
    let nvidiaSeen = false;
    for (const card of probe
        .list(DRM)
        .filter((name) => /^card\d+$/.test(name))
        .sort()) {
        const device = join(DRM, card, 'device');
        const vendor = PCI_VENDORS[probe.read(join(device, 'vendor')) ?? ''] ?? 'unknown';
        if (vendor === 'nvidia') {
            // The proprietary driver has no memory files in sysfs; nvidia-smi answers below.
            nvidiaSeen = true;
            continue;
        }
        const totalBytes = bytes(probe.read(join(device, 'mem_info_vram_total')));
        const usedBytes = bytes(probe.read(join(device, 'mem_info_vram_used')));
        gpus.push({
            vendor,
            name: probe.read(join(device, 'product_name')) || undefined,
            totalBytes,
            usedBytes,
            // An Intel GPU without VRAM files is the integrated one, living in RAM.
            unified: vendor === 'intel' && totalBytes === undefined,
            source: totalBytes === undefined ? 'none' : 'sysfs',
        });
    }
    if (nvidiaSeen) gpus.push(...(nvidiaSmi(probe) ?? [{ ...UNKNOWN_GPU, vendor: 'nvidia' as const }]));
    return gpus;
}

/**
 * Apple silicon: the GPU may wire only part of RAM. `iogpu.wired_limit_mb` is that limit when
 * the user raised it (0 means "the default"); the default share is an approximation of Metal's
 * `recommendedMaxWorkingSetSize`, which is not readable without Metal.
 */
export const APPLE_DEFAULT_GPU_SHARE = 0.75;

function appleGpu(probe: MachineProbe): GpuMemory {
    const limitMib = bytes(probe.run('/usr/sbin/sysctl', ['-n', 'iogpu.wired_limit_mb'], 2000)?.trim());
    const totalBytes =
        limitMib !== undefined && limitMib > 0
            ? limitMib * MIB
            : Math.floor(probe.totalmem() * APPLE_DEFAULT_GPU_SHARE);
    return { vendor: 'apple', totalBytes, unified: true, source: 'sysctl' };
}

/** A GPU this package cannot see into; it may exist, so nothing is ruled out on its account. */
const UNKNOWN_GPU: GpuMemory = { vendor: 'unknown', unified: false, source: 'none' };

export function readMachineMemory(probe: MachineProbe = systemProbe()): MachineMemory {
    let gpus: GpuMemory[] = [];
    if (probe.platform === 'linux') gpus = linuxGpus(probe);
    else if (probe.platform === 'darwin') gpus = probe.arch === 'arm64' ? [appleGpu(probe)] : [UNKNOWN_GPU];
    // Windows: dedicated VRAM needs DXGI (native code), and WMI's AdapterRAM stops at 4 GiB.
    // nvidia-smi ships with the driver, so NVIDIA is the one vendor answered here.
    else gpus = (probe.platform === 'win32' && nvidiaSmi(probe)) || [UNKNOWN_GPU];
    return { ramTotalBytes: probe.totalmem(), ramAvailableBytes: probe.freemem(), gpus };
}

export interface FootprintInput {
    /** Weight count; with {@link bitsPerWeight}. Ignored when {@link weightsBytes} is given. */
    readonly parameters?: number;
    /** Average bits per weight of the quantization: ~4.8 for Q4_K_M, 8.5 for Q8_0, 16 for F16. */
    readonly bitsPerWeight?: number;
    /** The model file's size, when known: the most exact weight figure there is. */
    readonly weightsBytes?: number;
    readonly contextTokens?: number;
    /** KV cache per token of context: `2 × layers × kvHeads × headDim × bytesPerElement`. */
    readonly kvBytesPerToken?: number;
    /** Compute buffers and runtime; the caller knows its engine, this package does not. */
    readonly overheadBytes?: number;
}

/**
 * Weights + KV cache + overhead, in bytes. The numbers that make it right for one engine and one
 * model family come from the caller (ADR 0127 decision 12: the tables stay with the consumer).
 */
export function estimateFootprint(input: FootprintInput): number {
    const weights =
        input.weightsBytes ??
        (input.parameters !== undefined && input.bitsPerWeight !== undefined
            ? (input.parameters * input.bitsPerWeight) / 8
            : undefined);
    if (weights === undefined)
        throw new TypeError('estimateFootprint needs weightsBytes, or parameters and bitsPerWeight');
    const kv = (input.contextTokens ?? 0) * (input.kvBytesPerToken ?? 0);
    return Math.ceil(weights + kv + (input.overheadBytes ?? 0));
}

/**
 * Where a model of `requiredBytes` can live, judged by memory alone (ADR 0136):
 *
 *   • `gpu`     — one GPU has that much free.
 *   • `gpu+cpu` — only with layers split between a dedicated GPU's free memory and RAM.
 *   • `cpu`     — only RAM has room.
 *   • `unknown` — nothing known is big enough, but a GPU's memory could not be read.
 *   • `none`    — every pool is known and too small: ruled out, do not offer the download.
 *
 * Only `none` is a verdict. The others say "not ruled out"; whether it is fast enough is for
 * {@link probeBackends} to find out, when the work starts.
 */
export type FitPlacement = 'gpu' | 'gpu+cpu' | 'cpu' | 'unknown' | 'none';

export interface FitResult {
    readonly placement: FitPlacement;
    readonly requiredBytes: number;
    /** Index into {@link MachineMemory.gpus} for `gpu` and `gpu+cpu`. */
    readonly gpu?: number;
}

/**
 * What a GPU can still take. Used memory counts whoever holds it — another server's model too.
 * Unified memory is capped by what RAM has available, since both draw on the same pages.
 */
function freeGpuBytes(gpu: GpuMemory, ramAvailableBytes: number): number | undefined {
    if (gpu.totalBytes === undefined) return gpu.unified ? ramAvailableBytes : undefined;
    const free = Math.max(0, gpu.totalBytes - (gpu.usedBytes ?? 0));
    return gpu.unified ? Math.min(free, ramAvailableBytes) : free;
}

export function checkFit(requiredBytes: number, memory: MachineMemory): FitResult {
    const ram = memory.ramAvailableBytes;
    const free = memory.gpus.map((gpu) => freeGpuBytes(gpu, ram));
    const best = (fits: (bytes: number, index: number) => boolean) =>
        free.findIndex((bytes, index) => bytes !== undefined && fits(bytes, index));

    const whole = best((bytes) => bytes >= requiredBytes);
    if (whole >= 0) return { placement: 'gpu', requiredBytes, gpu: whole };
    // Splitting a model onto RAM only adds memory for a GPU that has its own.
    const split = best((bytes, index) => !memory.gpus[index].unified && bytes > 0 && bytes + ram >= requiredBytes);
    if (split >= 0) return { placement: 'gpu+cpu', requiredBytes, gpu: split };
    if (ram >= requiredBytes) return { placement: 'cpu', requiredBytes };
    if (free.some((bytes) => bytes === undefined)) return { placement: 'unknown', requiredBytes };
    return { placement: 'none', requiredBytes };
}
