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

/** Loose view of the GLib calls {@link killPid} makes — `gjs.ts` types GLib as a bag of Functions. */
interface KillGlib {
    get_environ(): string[];
    environ_setenv(envp: string[], variable: string, value: string, overwrite: boolean): string[];
    spawn_sync(
        workingDirectory: string | null,
        argv: string[],
        envp: string[] | null,
        flags: number,
        childSetup: null,
    ): [boolean, Uint8Array | null, Uint8Array | null, number];
    spawn_check_wait_status(waitStatus: number): boolean;
}

/** `G_SPAWN_SEARCH_PATH`. Spelled numerically — this module takes no `@girs/*` value import. */
const SPAWN_SEARCH_PATH = 1 << 2;

/**
 * Map a failed `kill(1)` to the errno Node's `process.kill` would have thrown.
 *
 * Returns `undefined` for a failure it cannot classify: the caller then throws
 * WITHOUT a code, so nobody reads "the process is gone" out of, say, a missing
 * `kill` binary. The two phrases are strerror(3)'s C-locale text, which is why
 * the child runs under `LC_ALL=C` — procps, util-linux, BusyBox and the BSD
 * `/bin/kill` on macOS all print them verbatim there.
 */
export function classifyKillFailure(stderr: string): 'ESRCH' | 'EPERM' | undefined {
    if (/No such process/i.test(stderr)) return 'ESRCH';
    if (/Operation not permitted/i.test(stderr)) return 'EPERM';
    return undefined;
}

export function killPid(pid: number, signal?: string | number): boolean {
    // GJS path first: GJS has no kill(2) binding and Gio.Subprocess can signal
    // only its OWN children, so this runs `kill(1)`. Its exit status is the
    // answer and is NOT discarded: this used to return `true` for every pid,
    // which made `process.kill(pid, 0)` — Node's documented liveness probe —
    // report every dead process as alive. Harmless on Linux, where the
    // callers that care probe `/proc/<pid>` first; on macOS there is no
    // procfs, so the probe WAS the answer and a crashed `gjsify install`'s
    // lock could never be stolen as dead-owner (only after the 35-min budget).
    const GLib = getGjsGlobal().imports?.gi?.GLib as unknown as KillGlib | undefined;
    if (GLib) {
        const sig = typeof signal === 'number' ? String(signal) : signal || 'SIGTERM';
        const sigArg = sig.startsWith('SIG') ? `-${sig.slice(3)}` : `-${sig}`;
        // argv, not a command line; `--` so a negative pid (a process GROUP)
        // is the operand it means rather than an option.
        const argv = ['kill', sigArg, '--', String(pid)];
        const envp = GLib.environ_setenv(GLib.get_environ(), 'LC_ALL', 'C', true);
        const [, , stderr, waitStatus] = GLib.spawn_sync(null, argv, envp, SPAWN_SEARCH_PATH, null);
        let exitedCleanly = false;
        try {
            exitedCleanly = GLib.spawn_check_wait_status(waitStatus);
        } catch {
            exitedCleanly = false;
        }
        if (exitedCleanly) return true;
        const text = stderr ? new TextDecoder().decode(stderr).trim() : '';
        const code = classifyKillFailure(text);
        const err = new Error(`kill ${code ?? 'failed'}${text ? `: ${text}` : ''}`) as NodeJS.ErrnoException;
        if (code) {
            err.code = code;
            err.errno = code === 'ESRCH' ? -3 : -1;
            err.syscall = 'kill';
        }
        throw err;
    }

    const nativeProcess = globalThis.process;
    if (nativeProcess && typeof nativeProcess.kill === 'function') {
        return nativeProcess.kill(pid, signal);
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
