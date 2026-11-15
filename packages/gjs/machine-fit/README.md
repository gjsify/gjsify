# @gjsify/machine-fit

Will a model run on this machine, and on which backend? A static memory check that can rule a model out before it is downloaded, and the probe that decides speed once the work starts. Pure TypeScript on `node:*` APIs: it runs under plain Node as well as under GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**: tested against made-up machines (a fake `/sys`, a fake `nvidia-smi`); no test reads real hardware. Design: ADR 0127 decisions 11–12, ADR 0136.

## Installation

```bash
gjsify install @gjsify/machine-fit
```

## Usage

```typescript
import { checkFit, estimateFootprint, probeBackends, readMachineMemory } from '@gjsify/machine-fit';

// Before download: rule out what cannot fit. Only `none` is a verdict.
const required = estimateFootprint({
    weightsBytes: 4.9e9, // the model file
    contextTokens: 8192,
    kvBytesPerToken: 2 * 32 * 8 * 128 * 2, // 2 × layers × kvHeads × headDim × bytes
    overheadBytes: 512 * 1024 ** 2,
});
const fit = checkFit(required, readMachineMemory());
if (fit.placement === 'none') offerSmallerModel();

// When the work starts: measure. The candidates and the budget are yours.
const result = await probeBackends(
    [
        { id: 'vulkan', run: (signal) => engine.tryOnce('vulkan', signal) },
        { id: 'cpu', run: (signal) => engine.tryOnce('cpu', signal) },
    ],
    3000,
    { setting: process.env.MYAPP_BACKEND || undefined },
);
```

## What the memory check reads

| | RAM | GPU memory |
|---|---|---|
| Linux | `os.totalmem()` / `os.freemem()` (`MemAvailable`) | AMD: sysfs `mem_info_vram_*`; NVIDIA: `nvidia-smi`; integrated Intel: bounded by RAM |
| macOS | same | Apple silicon: `iogpu.wired_limit_mb`, else 75 % of RAM (`APPLE_DEFAULT_GPU_SHARE`); Intel Macs: unknown |
| Windows | same | NVIDIA via `nvidia-smi`; others unknown |

The check uses FREE GPU memory: a model another server already holds (Ollama, LM Studio) counts as used. A GPU whose memory cannot be read is "cannot rule out", never zero.

`checkFit` answers `gpu`, `gpu+cpu` (split onto RAM, dedicated GPUs only), `cpu`, `unknown` or `none`. Speed is not its business: that is what `probeBackends` measures.

### Device memory and streamable memory

Some engines keep the weights in RAM and stream them to the GPU in blocks (stable-diffusion.cpp, llama.cpp with partial offload); only the compute buffers must sit on the device. For those, pass a `FitRequirement` instead of a number (ADR 0145):

```typescript
checkFit({ deviceBytes: 1.2e9, streamableBytes: 12.7e9, diskBacked: true }, readMachineMemory());
```

- `deviceBytes` must sit on the device that computes (compute buffers, activations).
- `streamableBytes` may live in RAM and move to the device as needed (the weights).
- `diskBacked: true`: the engine maps the weights from disk when RAM is short, so RAM is not a limit for them.

`gpu`: one GPU holds both parts. `gpu+cpu`: a dedicated GPU holds `deviceBytes`, RAM (or disk) the rest. `cpu`: RAM holds the device part and the rest. `FitResult.requiredBytes` is the sum. A plain number means what it always meant.

## The probe and its guards

- `probeBackends(candidates, budgetMs, options)` runs the candidates in order and returns the first that finishes within the budget. An explicit `setting` wins without measuring; on battery it returns `on-battery` without running anything.
- `createGpuGuard({ dir: defaultGuardDir('myapp') })` writes a marker around each GPU call. A driver that `abort()`s the process leaves the marker behind, and the next start reads it as a pin to the CPU. `clear()` lifts the pin.
- `hasVulkan()`, `onBattery()` and `parseGpuSetting()` are hints for choosing the candidates.

## License

MIT
