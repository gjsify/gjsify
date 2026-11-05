import { systemProbe, type MachineProbe } from './machine-probe.js';

const LIBRARY_DIRS = [
    '/usr/lib',
    '/usr/lib64',
    '/lib',
    '/lib64',
    '/usr/lib/x86_64-linux-gnu',
    '/lib/x86_64-linux-gnu',
    '/usr/lib/aarch64-linux-gnu',
    '/lib/aarch64-linux-gnu',
];

function pathList(value: string | undefined): string[] {
    return (value ?? '').split(':').filter((entry) => entry !== '');
}

/**
 * Is there a Vulkan loader AND a driver for it? Linux only; `false` everywhere else.
 *
 * The loader alone is on every desktop (Mesa and the browsers pull it in); the ICD manifest is
 * what says a driver is installed. Both are only a HINT: whether the device works is decided by
 * loading something on it, which is what {@link probeBackends} is for.
 */
export function hasVulkan(probe: MachineProbe = systemProbe()): boolean {
    if (probe.platform !== 'linux') return false;
    const { env } = probe;
    const libraryDirs = [...pathList(env.LD_LIBRARY_PATH), ...LIBRARY_DIRS];
    if (!libraryDirs.some((dir) => probe.exists(`${dir}/libvulkan.so.1`))) return false;
    // The loader's own overrides name the driver directly.
    if (pathList(env.VK_DRIVER_FILES).length > 0 || pathList(env.VK_ICD_FILENAMES).length > 0) return true;
    const dataDirs = [
        env.XDG_DATA_HOME ?? (env.HOME ? `${env.HOME}/.local/share` : ''),
        ...pathList(env.XDG_DATA_DIRS),
        '/usr/local/share',
        '/usr/share',
    ].filter((dir) => dir !== '');
    const icdDirs = [
        '/etc/vulkan/icd.d',
        ...dataDirs.map((dir) => `${dir}/vulkan/icd.d`),
        // The freedesktop Flatpak runtime keeps its GL extension's drivers here.
        '/usr/lib/x86_64-linux-gnu/GL/vulkan/icd.d',
        '/usr/lib/aarch64-linux-gnu/GL/vulkan/icd.d',
    ];
    return icdDirs.some((dir) => probe.list(dir).some((name) => name.endsWith('.json')));
}

export type GpuSetting = 'off' | 'on' | 'auto';

const GPU_OFF_VALUES = new Set(['off', '0', 'false', 'no', 'cpu']);
const GPU_ON_VALUES = new Set(['on', '1', 'true', 'yes', 'gpu']);

/**
 * Read a user's GPU switch, from whichever variable the app names (`MYAPP_GPU=off`).
 *
 * `off` is the escape hatch from a misbehaving driver; `on` is its counterpart and also the
 * "I fixed the driver" signal that lifts a {@link GpuGuard} pin. Anything else is `auto`.
 */
export function parseGpuSetting(value: string | undefined): GpuSetting {
    const normalized = (value ?? '').trim().toLowerCase();
    if (GPU_OFF_VALUES.has(normalized)) return 'off';
    return GPU_ON_VALUES.has(normalized) ? 'on' : 'auto';
}
