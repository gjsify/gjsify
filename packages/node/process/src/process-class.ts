// Process — composes the per-concern modules into the singleton class that
// `index.ts` instantiates + exports.
//
// Reference: Node.js lib/internal/process/* (init, signal, per_thread, ...).

import { EventEmitter } from '@gjsify/events';
import { detectArch, detectPlatform, detectPpid, detectVersionInfo, getPid } from './internal/detect.js';
import { chdir, getArgv, getCwd, getEnvProxy, getExecPath } from './internal/env.js';
import { exitProcess } from './internal/exit.js';
import { hrtime as hrtimeImpl, hrtimeBigint } from './internal/hrtime.js';
import { cpuUsage, killPid, memoryUsage, type CpuUsage, type MemoryUsage } from './internal/system.js';
import { ProcessReadStream, ProcessWriteStream } from './streams.js';

type ProcessPlatform = NodeJS.Platform;
type ProcessArch = NodeJS.Architecture;

const startTime = Date.now();

export class Process extends EventEmitter {
    readonly platform: ProcessPlatform;
    readonly arch: ProcessArch;
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

        this.platform = detectPlatform();
        this.arch = detectArch();
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

    // no-op stubs for compatibility
    umask(_mask?: number): number {
        return 0o22;
    }
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
