// Process — composes the per-concern modules into the singleton class that
// `index.ts` instantiates + exports.
//
// Reference: Node.js lib/internal/process/* (init, signal, per_thread, ...).

import { EventEmitter } from '@gjsify/events';
import { detectArch, detectPlatform, detectPpid, detectVersionInfo, getPid } from './internal/detect.js';
import { chdir, getArgv, getCwd, getEnvProxy, getExecPath } from './internal/env.js';
import { exitProcess } from './internal/exit.js';
import { hrtime as hrtimeImpl, hrtimeBigint } from './internal/hrtime.js';
import { cpuUsage, killPid, memoryUsage, readUmask, type CpuUsage, type MemoryUsage } from './internal/system.js';
import { armSignal, disarmSignal, isDeliverableSignal } from './internal/signals.js';
import { ProcessReadStream, ProcessWriteStream } from './streams.js';

type ProcessPlatform = NodeJS.Platform;
type ProcessArch = NodeJS.Architecture;

const startTime = Date.now();

/**
 * Install `key` as a lazily-computed OWN property.
 *
 * `platform` and `arch` are answered by one `uname -sm` spawn under GJS, which
 * measured at ~2.5 ms — cheap once, but wasted on every bundle that never asks
 * (most of them), and paid at import time by everything that pulls in
 * `@gjsify/process`. Computing on first read moves that cost to the callers
 * who actually want it.
 *
 * Deliberately an own property rather than a prototype getter: Node exposes
 * `process.platform` as an own enumerable property, so `Object.keys(process)`
 * and spreads must keep seeing it. The accessor replaces itself with a plain
 * value on first read, so repeat access costs nothing and the shape settles.
 */
function defineLazy<T>(target: object, key: string, compute: () => T): void {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get(): T {
            const value = compute();
            Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: false });
            return value;
        },
    });
}

export class Process extends EventEmitter {
    readonly platform!: ProcessPlatform;
    readonly arch!: ProcessArch;
    readonly env: Record<string, string | undefined>;
    readonly argv: string[];
    readonly argv0: string;
    readonly execPath: string;
    readonly pid: number;
    readonly ppid: number;
    readonly version: string;
    readonly versions: Record<string, string>;
    title: string;
    readonly execArgv: string[];
    readonly config: Record<string, unknown>;
    exitCode: number | undefined;

    constructor() {
        super();

        defineLazy(this, 'platform', detectPlatform);
        defineLazy(this, 'arch', detectArch);
        this.env = getEnvProxy();
        this.argv = getArgv();
        this.argv0 = this.argv[0] || 'gjs';
        this.execPath = getExecPath();
        this.execArgv = globalThis.process?.execArgv ?? [];
        this.config = (globalThis.process?.config as unknown as Record<string, unknown>) ?? {
            target_defaults: {},
            variables: {},
        };
        this.pid = getPid();
        this.ppid = detectPpid();
        const versionInfo = detectVersionInfo();
        this.version = versionInfo.version;
        this.versions = versionInfo.versions;
        this.title = versionInfo.title;

        // Signals are armed on DEMAND, through the emitter's own meta-events, so
        // a process that never asks for one keeps the default disposition and
        // costs no GLib source. `newListener` fires BEFORE the listener is
        // added, `removeListener` after removal — which is what makes
        // "the last one just went" answerable.
        this.on('newListener', (type: string | symbol) => {
            if (isDeliverableSignal(type)) armSignal(type, (signal) => this.emit(signal, signal));
        });
        this.on('removeListener', (type: string | symbol) => {
            if (isDeliverableSignal(type) && this.listenerCount(type) === 0) disarmSignal(type);
        });
    }

    cwd(): string {
        return getCwd();
    }

    chdir(directory: string): void {
        chdir(directory);
    }

    kill(pid: number, signal?: string | number): boolean {
        return killPid(pid, signal);
    }

    exit(code?: number): never {
        this.exitCode = code ?? this.exitCode ?? 0;
        this.emit('exit', this.exitCode);
        return exitProcess(this.exitCode);
    }

    nextTick(callback: Function, ...args: unknown[]): void {
        // GTK interleaving is handled at the stream level (@gjsify/utils nextTick → GLib.idle_add).
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => callback(...args));
        } else {
            Promise.resolve().then(() => callback(...args));
        }
    }

    hrtime(time?: [number, number]): [number, number] {
        return hrtimeImpl(time);
    }

    uptime(): number {
        return (Date.now() - startTime) / 1000;
    }

    memoryUsage(): MemoryUsage {
        return memoryUsage();
    }

    cpuUsage(previousValue?: CpuUsage): CpuUsage {
        return cpuUsage(previousValue);
    }

    // Note: Cannot check globalThis.process.stdout here — on GJS globalThis.process
    // IS this instance, so that would cause infinite recursion.
    readonly stdout = new ProcessWriteStream(1);
    readonly stderr = new ProcessWriteStream(2);
    readonly stdin = new ProcessReadStream(0);

    abort(): void {
        this.exit(1);
    }

    /**
     * The file-creation mask. READING it is real; SETTING it is not possible.
     *
     * The getter used to return a hardcoded `0o22` — right only on a 022
     * machine and wrong in the PERMISSIVE direction everywhere else: on a 002
     * host a caller computing `0o666 & ~process.umask()` believes it produced
     * 0644 while the file is group-writable 0664. Linux publishes the live
     * value in `/proc/self/status`, race-free, so it is read rather than
     * guessed.
     *
     * The setter cannot be implemented: GJS has no `umask(2)` binding, and the
     * mask is per-process kernel state that a library cannot emulate. It stays
     * a no-op for that reason — but not a SILENT one. `process.umask(0o077)`
     * before writing a secret is a standard idiom, and here it changes nothing;
     * a caller who believes it tightened the mask is precisely the
     * "more permissive than requested" failure this package's fs work exists to
     * remove, so the attempt warns once instead of being swallowed. It does not
     * throw: that would break the equally common read-modify-restore pattern,
     * and the real fix for a caller is an explicit `mode`, which now works.
     */
    umask(mask?: number): number {
        const live = readUmask();
        if (mask !== undefined && !this._umaskWarned) {
            this._umaskWarned = true;
            this.emitWarning(
                `process.umask(0${mask.toString(8)}) cannot change the file-creation mask under GJS — there is no ` +
                    'umask(2) binding, so the mask is UNCHANGED. Pass an explicit `mode` to open/mkdir/writeFile ' +
                    'instead; the kernel applies it atomically at creation.',
                'UnsupportedWarning',
            );
        }
        return live;
    }
    private _umaskWarned = false;

    emitWarning(warning: string | Error, name?: string): void {
        if (typeof warning === 'string') {
            console.warn(`(${name || 'Warning'}): ${warning}`);
        } else {
            console.warn(warning.message);
        }
    }
}

// Attach `.bigint` to Process.prototype.hrtime so
// `import { hrtime } from 'node:process'; hrtime.bigint()` works after
// `index.ts` re-binds the method.
(Process.prototype.hrtime as unknown as Record<string, () => bigint>).bigint = function (): bigint {
    return hrtimeBigint();
};
