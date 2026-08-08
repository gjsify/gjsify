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

/**
 * The process's REAL file-creation mask.
 *
 * `process.umask()` returned a hardcoded `0o22`, which is right only on a
 * 022 machine and silently wrong in the PERMISSIVE direction everywhere else:
 * on a 002 host a consumer computing `0o666 & ~process.umask()` believes it
 * produced 0644 while the file is actually 0664, i.e. group-writable.
 *
 * Linux publishes the truth race-free in `/proc/self/status`, so the getter can
 * simply read it — there is no `umask(2)` binding to call, and the usual trick
 * of "set it and set it back" would be a data race against every other thread
 * creating a file. Off Linux there is no such file and the old constant is all
 * that is left; it is returned as a documented last resort rather than as an
 * answer.
 */
export function readUmask(): number {
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            const [ok, data] = GLib.file_get_contents('/proc/self/status');
            if (ok) {
                const match = /^Umask:\s*([0-7]+)/m.exec(new TextDecoder().decode(data));
                if (match) return parseInt(match[1], 8);
            }
        }
    } catch {
        // No procfs, or a kernel too old to publish the field (it landed in
        // 4.7). Both mean "cannot be read", and the fallback below says so.
    }
    return 0o022;
}
