// Environment variable proxy. On Node.js, just returns `process.env`.
// On GJS, builds a Proxy that round-trips reads/writes through GLib's
// `getenv`/`setenv`/`unsetenv`/`listenv`.

import { hostExecPath } from '@gjsify/utils/core';

import { getGjsGlobal } from './gjs.js';

export function getEnvProxy(): Record<string, string | undefined> {
    // On Node.js, just return process.env
    if (typeof globalThis.process?.env === 'object') {
        return globalThis.process.env;
    }

    // On GJS, create a Proxy that uses GLib.getenv/setenv
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            return new Proxy({} as Record<string, string | undefined>, {
                get(_target, prop: string) {
                    if (typeof prop !== 'string') return undefined;
                    return GLib.getenv(prop) ?? undefined;
                },
                set(_target, prop: string, value: string) {
                    if (typeof prop !== 'string') return false;
                    GLib.setenv(prop, String(value), true);
                    return true;
                },
                deleteProperty(_target, prop: string) {
                    if (typeof prop !== 'string') return false;
                    GLib.unsetenv(prop);
                    return true;
                },
                has(_target, prop: string) {
                    if (typeof prop !== 'string') return false;
                    return GLib.getenv(prop) !== null;
                },
                ownKeys(_target) {
                    const envp: string[] = GLib.listenv();
                    return envp;
                },
                getOwnPropertyDescriptor(_target, prop: string) {
                    if (typeof prop !== 'string') return undefined;
                    const val = GLib.getenv(prop);
                    if (val === null) return undefined;
                    return { configurable: true, enumerable: true, writable: true, value: val };
                },
            });
        }
    } catch {
        /* ignore */
    }

    return {};
}

export function getArgv(): string[] {
    if (typeof globalThis.process?.argv !== 'undefined') {
        return globalThis.process.argv;
    }
    try {
        const system = getGjsGlobal().imports?.system;
        if (system?.programArgs) {
            // Node.js convention: argv = [executable, script, ...userArgs].
            // GJS `system.programInvocationName` holds the script path, so prepend
            // 'gjs' so consumers like yargs' `hideBin()` (which slices(2)) work.
            return ['gjs', system.programInvocationName || '', ...system.programArgs];
        }
    } catch {
        /* ignore */
    }
    return ['gjs'];
}

/**
 * Node's `process.execPath` — the absolute path of the INTERPRETER, not of the
 * script it is running.
 *
 * This used to return `imports.system.programInvocationName`, which is the
 * ENTRY MODULE (the same value `getArgv()` above puts in `argv[1]`, and says so).
 * The two are different questions and the wrong answer is load-bearing:
 * `spawn(process.execPath, […])` is the documented portable way to start a
 * second copy of the current runtime, and against a bundle path it fails
 * `ENOENT` — or, because `g_spawn` retries a non-executable text file through
 * `/bin/sh`, hands a megabyte of JavaScript to the shell.
 *
 * Nor is `/usr/bin/gjs` a defensible fallback: no macOS host has that path
 * (Homebrew installs to `/usr/local/bin` or `/opt/homebrew/bin`), so the
 * "default" was a Linux literal wearing a default's clothes. `hostExecPath()`
 * resolves the real one; the literal remains only as the last resort for a host
 * that answers nothing at all, where any string is equally wrong and Node's
 * type says it must be a string.
 */
export function getExecPath(): string {
    // Off GJS the host's own answer is authoritative — and under GJS
    // `globalThis.process` is OUR object, so reading it here would return the
    // value we are computing.
    const host = globalThis.process as { execPath?: unknown } | undefined;
    if (!isGjsHost() && typeof host?.execPath === 'string') return host.execPath;

    return hostExecPath() ?? '/usr/bin/gjs';
}

/** Is there a GJS host under this process? */
function isGjsHost(): boolean {
    try {
        return getGjsGlobal().imports?.gi !== undefined;
    } catch {
        return false;
    }
}

export function getCwd(): string {
    // Try GLib first to avoid recursion — under GJS, globalThis.process.cwd
    // is our own method which calls getCwd(), causing infinite recursion.
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib?.get_current_dir) return GLib.get_current_dir();
    } catch {
        /* ignore */
    }
    return '/';
}

export function chdir(directory: string): void {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    try {
        if (GLib?.chdir) {
            // Check if directory exists first
            if (!GLib.file_test(directory, 16 /* G_FILE_TEST_EXISTS */)) {
                const err = new Error(
                    `ENOENT: no such file or directory, chdir '${directory}'`,
                ) as NodeJS.ErrnoException;
                err.code = 'ENOENT';
                err.syscall = 'chdir';
                err.path = directory;
                throw err;
            }
            GLib.chdir(directory);
            return;
        }
    } catch (e) {
        // Re-throw our own ENOENT errors
        if (e && typeof e === 'object' && (e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
    }

    // Fallback to native process.chdir — gated on !GLib because globalThis.process
    // IS our Process instance under GJS, so unconditional delegation would recurse.
    if (!GLib) {
        const nativeProcess = globalThis.process;
        if (nativeProcess && typeof nativeProcess.chdir === 'function') {
            nativeProcess.chdir(directory);
            return;
        }
    }

    throw new Error('process.chdir() is not supported in this environment');
}
