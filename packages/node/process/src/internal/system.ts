// Misc system helpers — kill, memoryUsage, cpuUsage. All graceful: GJS
// path tried first, native `globalThis.process.*` as the fallback. The
// fallback is gated on `!isGjs` because under GJS our `@gjsify/process`
// IS `globalThis.process` after register, so delegating to it would
// infinite-recurse.

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

export function memoryUsage(): MemoryUsage {
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            const [, contents] = GLib.file_get_contents('/proc/self/status');
            if (contents) {
                const str = new TextDecoder().decode(contents);
                const vmRSS = str.match(/VmRSS:\s+(\d+)/);
                const rss = vmRSS ? parseInt(vmRSS[1], 10) * 1024 : 0;
                return { rss, heapTotal: rss, heapUsed: rss, external: 0, arrayBuffers: 0 };
            }
        }
    } catch {
        /* ignore */
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
