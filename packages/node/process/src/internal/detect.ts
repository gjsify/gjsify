// Runtime detection helpers — version, platform, arch, pid, ppid.
// All graceful: each function falls back to a sane default when the
// underlying source (GLib, /proc, globalThis.process) is unavailable.

import { getGjsGlobal } from './gjs.js';
import { probeUname } from './uname.js';

type ProcessPlatform = NodeJS.Platform;
type ProcessArch = NodeJS.Architecture;

export function detectGjsVersion(): string | undefined {
    try {
        const system = getGjsGlobal().imports?.system;
        if (system?.version !== undefined) {
            const v = Number(system.version);
            const major = Math.floor(v / 10000);
            const minor = Math.floor((v % 10000) / 100);
            const patch = v % 100;
            return `${major}.${minor}.${patch}`;
        }
    } catch {
        /* ignore */
    }
    return undefined;
}

export function detectNodeVersion(): string | undefined {
    if (typeof globalThis.process?.versions?.node === 'string') {
        return globalThis.process.versions.node;
    }
    return undefined;
}

export interface VersionInfo {
    version: string;
    versions: Record<string, string>;
    title: string;
}

export function detectVersionInfo(): VersionInfo {
    const nodeVersion = detectNodeVersion();

    if (nodeVersion) {
        // Running on Node.js — use native values
        return {
            version: globalThis.process.version,
            versions: { ...globalThis.process.versions } as Record<string, string>,
            title: globalThis.process?.title || 'node',
        };
    }

    // Running on GJS
    const gjsVersion = detectGjsVersion();
    const versions: Record<string, string> = {
        node: '20.0.0', // Compatibility version — many npm packages check process.versions.node
    };
    if (gjsVersion) versions.gjs = gjsVersion;

    return {
        version: 'v20.0.0', // Compatibility version for Node.js API level checks
        versions,
        title: 'gjs',
    };
}

export function detectPpid(): number {
    if (typeof globalThis.process?.ppid === 'number') {
        return globalThis.process.ppid;
    }
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            const [, contents] = GLib.file_get_contents('/proc/self/status');
            if (contents) {
                const str = new TextDecoder().decode(contents);
                const match = str.match(/PPid:\s+(\d+)/);
                if (match) return parseInt(match[1], 10);
            }
        }
    } catch {
        /* ignore */
    }
    return 0;
}

/**
 * Is `globalThis.process` a REAL Node process, or our own bootstrap stub?
 *
 * This distinction is load-bearing. The GJS bundle banner installs a minimal
 * `globalThis.process` at byte 1 (see `process-stub.ts`) whose `platform` and
 * `arch` are provisional placeholders. Reading them back here would be
 * circular: we would "detect" our own guess and then adopt it as the answer —
 * which is exactly why `process.arch` reported `x64` on aarch64. The stub
 * carries an empty `versions`, so a `versions.node` string is a reliable
 * marker of the genuine article.
 */
function realNodeProcess(): NodeJS.Process | undefined {
    const p = globalThis.process as NodeJS.Process | undefined;
    return typeof p?.versions?.node === 'string' ? p : undefined;
}

export function detectPlatform(): ProcessPlatform {
    // Node / Bun / Deno: the host already knows, and it is authoritative.
    const node = realNodeProcess();
    if (typeof node?.platform === 'string') return node.platform;

    // GJS: ask the kernel. `GLib.get_os_info('ID')` is NOT usable for this —
    // it answers with the distribution id (`fedora`), not the OS family.
    const uname = probeUname();
    if (uname) return uname.platform;

    // Probe unavailable. Linux is the overwhelmingly common GJS host and the
    // only one with a CI-verified toolchain, so it stays the fallback — but it
    // is now a fallback, not an assertion.
    return 'linux';
}

export function detectArch(): ProcessArch {
    const node = realNodeProcess();
    if (typeof node?.arch === 'string') return node.arch;

    const uname = probeUname();
    if (uname) return uname.arch;

    return 'x64';
}

export function getPid(): number {
    if (typeof globalThis.process?.pid === 'number') {
        return globalThis.process.pid;
    }
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            // GLib doesn't have a direct getpid, read from /proc/self
            const [, contents] = GLib.file_get_contents('/proc/self/stat');
            if (contents) {
                const str = new TextDecoder().decode(contents);
                const pid = parseInt(str, 10);
                if (!isNaN(pid)) return pid;
            }
        }
    } catch {
        /* ignore */
    }
    return 0;
}
