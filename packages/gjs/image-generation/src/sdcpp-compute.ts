// What a request costs the device, and the check that runs before sd.cpp is asked (ADR 0146).
// Pure: bytes in, a FitRequirement out, so it is testable on a made-up machine.

import { checkFit, type FitRequirement, type MachineMemory } from '@gjsify/machine-fit';

const MIB = 1024 * 1024;

/**
 * How a model family's compute memory grows with the request. Measured with sd.cpp's log
 * (`SdCppCommonOptions.onLog` shows the buffer lines), one step per size. MB here is 1024², as
 * sd.cpp prints it.
 */
export interface SdCppComputeProfile {
    /** Diffusion compute buffer at zero tokens, in bytes. */
    readonly baseBytes: number;
    /** Added per latent token, in bytes (the part flash attention leaves). */
    readonly bytesPerToken: number;
    /** Added per latent token squared without flash attention: one f32 score per attention head. */
    readonly attentionBytesPerTokenSquared: number;
    /** Image pixels that make one latent token (patchified latent: 16 × 16 for Flux). */
    readonly pixelsPerToken: number;
    /** The text encoder's compute buffer, the floor of its phase. */
    readonly textEncoderBytes: number;
    /** The tiled VAE decode's compute buffer, the floor of its phase. */
    readonly vaeTiledBytes: number;
}

/**
 * FLUX.2 Klein 4B (Q8_0) with its Qwen3 4B text encoder and the Flux2 VAE, measured on an 8 GB
 * RX 6600 under Vulkan (2026-11-14). Larger models need more, so for them this is a lower bound.
 */
export const FLUX2_KLEIN_4B_COMPUTE: SdCppComputeProfile = {
    baseBytes: 100 * MIB,
    bytesPerToken: 240_000,
    attentionBytesPerTokenSquared: 93,
    pixelsPerToken: 256,
    textEncoderBytes: 51 * MIB,
    vaeTiledBytes: 416 * MIB,
};

/** sd.cpp keeps this much free on the device: its budget is the free memory minus this. */
export const SDCPP_DEVICE_RESERVE_BYTES = 512 * MIB;

export interface SdCppRequirementInput {
    readonly width: number;
    readonly height: number;
    /** Default off, as in the addon. */
    readonly flashAttention?: boolean;
    /** Size of the model files; they are streamed or mapped, so they count as streamable. */
    readonly weightsBytes?: number;
    readonly profile?: SdCppComputeProfile;
}

/** The diffusion model's compute buffer for one request. */
export function sdCppDiffusionBytes(input: SdCppRequirementInput): number {
    const profile = input.profile ?? FLUX2_KLEIN_4B_COMPUTE;
    const tokens = Math.ceil((input.width * input.height) / profile.pixelsPerToken);
    const attention = input.flashAttention ? 0 : profile.attentionBytesPerTokenSquared * tokens * tokens;
    return profile.baseBytes + profile.bytesPerToken * tokens + attention;
}

/**
 * What the device must hold for one request, and what may stream. The phases run one after
 * another, so the device part is the largest of them, plus sd.cpp's own reserve.
 */
export function estimateSdCppRequirement(input: SdCppRequirementInput): FitRequirement {
    const profile = input.profile ?? FLUX2_KLEIN_4B_COMPUTE;
    const deviceBytes =
        Math.max(sdCppDiffusionBytes(input), profile.textEncoderBytes, profile.vaeTiledBytes) +
        SDCPP_DEVICE_RESERVE_BYTES;
    return { deviceBytes, streamableBytes: input.weightsBytes ?? 0, diskBacked: true };
}

export interface SdCppSizeCheck extends SdCppRequirementInput {
    readonly memory: MachineMemory;
    /** Only RAM can be used: a GPU's memory is no reason to refuse. */
    readonly cpuOnly?: boolean;
}

/** Throws a `QuotaExceededError` naming the size when the machine cannot hold the request. */
export function assertSdCppSizeFits(check: SdCppSizeCheck): void {
    const memory = check.cpuOnly ? { ...check.memory, gpus: [] } : check.memory;
    const requirement = estimateSdCppRequirement(check);
    if (checkFit(requirement, memory).placement !== 'none') return;
    const needed = Math.ceil(requirement.deviceBytes / MIB);
    const tip = check.flashAttention ? '' : ' Turning flash attention on shrinks the compute buffer.';
    throw new DOMException(
        `A ${check.width}x${check.height} image needs about ${needed} MiB of device memory for its compute ` +
            `buffers, more than this machine has free.${tip}`,
        'QuotaExceededError',
    );
}
