export { systemProbe, type MachineProbe } from './machine-probe.js';
export { hasVulkan, parseGpuSetting, type GpuSetting } from './vulkan.js';
export {
    createGpuGuard,
    defaultGuardDir,
    processAlive,
    type GpuGuard,
    type GpuGuardOptions,
    type GpuPin,
} from './gpu-guard.js';
export { onBattery, onBatteryMac } from './power.js';
export {
    probeBackends,
    type BackendCandidate,
    type ProbeAttempt,
    type ProbeAttemptOutcome,
    type ProbeOptions,
    type ProbeReason,
    type ProbeResult,
} from './probe-backends.js';
export {
    APPLE_DEFAULT_GPU_SHARE,
    checkFit,
    estimateFootprint,
    parseNvidiaSmi,
    readMachineMemory,
    type FitPlacement,
    type FitResult,
    type FootprintInput,
    type GpuMemory,
    type GpuMemorySource,
    type GpuVendor,
    type MachineMemory,
} from './memory.js';
