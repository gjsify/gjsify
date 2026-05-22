// Environment variable proxy. On Node.js, just returns `process.env`.
// On GJS, builds a Proxy that round-trips reads/writes through GLib's
// `getenv`/`setenv`/`unsetenv`/`listenv`.

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
    } catch { /* ignore */ }

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
    } catch { /* ignore */ }
    return ['gjs'];
}

export function getExecPath(): string {
    if (typeof globalThis.process?.execPath === 'string') {
        return globalThis.process.execPath;
    }
    try {
        const system = getGjsGlobal().imports?.system;
        if (system?.programInvocationName) return system.programInvocationName;
    } catch { /* ignore */ }
    return '/usr/bin/gjs';
}

export function getCwd(): string {
    // Try GLib first to avoid recursion — under GJS, globalThis.process.cwd
    // is our own method which calls getCwd(), causing infinite recursion.
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib?.get_current_dir) return GLib.get_current_dir();
    } catch { /* ignore */ }
    return '/';
}

export function chdir(directory: string): void {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    try {
        if (GLib?.chdir) {
            // Check if directory exists first
            if (!GLib.file_test(directory, 16 /* G_FILE_TEST_EXISTS */)) {
                const err = new Error(`ENOENT: no such file or directory, chdir '${directory}'`) as NodeJS.ErrnoException;
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
