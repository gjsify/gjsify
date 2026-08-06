// Misc system helpers — kill, memoryUsage, cpuUsage. All graceful: GJS
// path tried first, native `globalThis.process.*` as the fallback. The
// fallback is gated on `!isGjs` because under GJS our `@gjsify/process`
// IS `globalThis.process` after register, so delegating to it would
// infinite-recurse.

import { readProcessMemory } from '@gjsify/utils/core';

import { getGjsGlobal } from './gjs.js';

/** True when running under GJS (so `globalThis.process` is our own instance). */
function isGjs(): boolean {
    return getGjsGlobal().imports?.gi?.GLib !== undefined;
}

export function killPid(pid: number, signal?: string | number): boolean {
    // GJS path first (GLib spawn).
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            const sig = typeof signal === 'number' ? String(signal) : signal || 'SIGTERM';
            const sigArg = sig.startsWith('SIG') ? `-${sig.slice(3)}` : `-${sig}`;
            GLib.spawn_command_line_sync(`kill ${sigArg} ${pid}`);
            return true;
        }
    } catch {
        /* ignore */
    }

    if (!isGjs()) {
        const nativeProcess = globalThis.process;
        if (nativeProcess && typeof nativeProcess.kill === 'function') {
            return nativeProcess.kill(pid, signal);
        }
    }
    throw new Error('process.kill() is not supported in this environment');
}

export interface MemoryUsage {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
}

/**
 * Node-shaped `process.memoryUsage()`.
 *
 * SpiderMonkey exposes no per-heap accounting to JS, so `heapTotal`/`heapUsed`
 * are approximated from the OS's view of the whole process — the same
 * approximation `@gjsify/v8`'s `getHeapStatistics()` makes, from the same
 * reader, which is why the reader lives in `@gjsify/utils/core` and not here.
 * Before that lift this function read `/proc/self/status` inline and therefore
 * reported `rss: 0` on every macOS host.
 */
export function memoryUsage(): MemoryUsage {
    const mem = readProcessMemory();
    if (mem) {
        return { rss: mem.resident, heapTotal: mem.resident, heapUsed: mem.resident, external: 0, arrayBuffers: 0 };
    }

    // Delegate to native process.memoryUsage on Node.js. Gated on !isGjs
    // because globalThis.process IS this module under GJS — would recurse.
    if (!isGjs()) {
        const nativeProcess = globalThis.process;
        if (nativeProcess && typeof nativeProcess.memoryUsage === 'function') {
            return nativeProcess.memoryUsage();
        }
    }

    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
}

export interface CpuUsage {
    user: number;
    system: number;
}

export function cpuUsage(previousValue?: CpuUsage): CpuUsage {
    // Delegate to native process.cpuUsage on Node.js. No GJS equivalent yet —
    // returns zeros there. Gated on !isGjs to avoid recursion under GJS.
    if (!isGjs()) {
        const nativeProcess = globalThis.process;
        if (nativeProcess && typeof nativeProcess.cpuUsage === 'function') {
            return nativeProcess.cpuUsage(previousValue);
        }
    }
    return { user: 0, system: 0 };
}
