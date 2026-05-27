// Runtime detection helpers — version, platform, arch, pid, ppid.
// All graceful: each function falls back to a sane default when the
// underlying source (GLib, /proc, globalThis.process) is unavailable.

import { getGjsGlobal } from './gjs.js';

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

export function detectPlatform(): ProcessPlatform {
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (GLib) {
            const osInfo = GLib.get_os_info('ID');
            if (osInfo) return 'linux';
        }
    } catch {
        /* ignore */
    }

    if (typeof getGjsGlobal().imports?.system !== 'undefined') {
        return 'linux';
    }

    if (typeof globalThis.process?.platform === 'string') {
        return globalThis.process.platform as ProcessPlatform;
    }

    return 'linux';
}

export function detectArch(): ProcessArch {
    if (typeof globalThis.process?.arch === 'string') {
        return globalThis.process.arch as ProcessArch;
    }
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
