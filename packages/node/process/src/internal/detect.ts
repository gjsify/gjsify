// Runtime detection helpers — version, platform, arch, pid, ppid.
// All graceful: each function falls back to a sane default when the
// underlying source (GLib, /proc, globalThis.process) is unavailable.

import { hostPid, hostPpid } from '@gjsify/utils/core';

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
    if (!onGjs() && typeof globalThis.process?.ppid === 'number') {
        return globalThis.process.ppid;
    }
    // `hostPpid()` reads procfs where it exists and `ps -o ppid=` where it does
    // not — the inline `/proc/self/status` read this used to do reported `0` on
    // every macOS host. `0` stays the Node-shaped fallback for "no answer": the
    // field is typed `number` and Node never leaves it undefined.
    return hostPpid() ?? 0;
}

/**
 * Are we running on GJS?
 *
 * Asked FIRST, before `globalThis.process` is consulted at all, and that order
 * is deliberate: under GJS `globalThis.process` eventually becomes THIS very
 * object (the register installs our singleton), and `platform` / `arch` are
 * lazy own properties on it. Consulting it from inside those getters is a
 * self-reference.
 *
 * It does not currently recurse — measured — but only because something in a
 * typical bundle reads `platform` during init, while `globalThis.process` is
 * still the byte-1 banner stub, which resolves the property to a plain value
 * before the register swaps the object in. That is read ORDER, not a
 * guarantee: a bundle whose first read lands after the swap would re-enter the
 * getter. Checking for GJS first removes the possibility by construction
 * rather than relying on the ordering holding.
 *
 * NB the obvious marker for "a real Node process" does NOT work here:
 * `@gjsify/process` deliberately reports `versions.node = '20.0.0'` for npm
 * packages that gate on it, so our own object answers to that test.
 */
function onGjs(): boolean {
    try {
        return getGjsGlobal().imports?.gi !== undefined;
    } catch {
        return false;
    }
}

export function detectPlatform(): ProcessPlatform {
    // GJS: ask the kernel. `GLib.get_os_info('ID')` is NOT usable for this —
    // it answers with the distribution id (measured: `fedora`), not the OS
    // family.
    if (onGjs()) {
        const uname = probeUname();
        if (uname) return uname.platform;
        // Probe unavailable. Linux is the overwhelmingly common GJS host and
        // the only one with a CI-verified toolchain, so it stays the fallback —
        // but it is now a fallback, not an assertion.
        return 'linux';
    }

    // Node / Bun / Deno: the host already knows, and it is authoritative.
    const host = globalThis.process as NodeJS.Process | undefined;
    return typeof host?.platform === 'string' ? host.platform : 'linux';
}

export function detectArch(): ProcessArch {
    if (onGjs()) {
        const uname = probeUname();
        if (uname) return uname.arch;
        return 'x64';
    }

    const host = globalThis.process as NodeJS.Process | undefined;
    return typeof host?.arch === 'string' ? host.arch : 'x64';
}

export function getPid(): number {
    // The GJS check comes FIRST for the same reason `detectPlatform()` gives:
    // after register, `globalThis.process` IS this object, and reading `pid`
    // off it during construction resolves against whichever object is installed
    // at that moment. Under GJS the answer must come from the host, not from a
    // half-built singleton.
    if (!onGjs() && typeof globalThis.process?.pid === 'number') {
        return globalThis.process.pid;
    }
    // `hostPid()` reads `/proc/self/stat` where procfs exists and derives the
    // pid from a shell's `$PPID` where it does not. macOS has no procfs, so the
    // previous inline read reported `0` — a valid pid, and therefore a wrong
    // answer no consumer could detect.
    return hostPid() ?? 0;
}
