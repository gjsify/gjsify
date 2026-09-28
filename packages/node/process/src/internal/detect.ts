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
    const host = runtimeProcess();
    if (host && typeof host.ppid === 'number') return host.ppid;
    // `hostPpid()` reads procfs where it exists and `ps -o ppid=` where it does
    // not — the inline `/proc/self/status` read this used to do reported `0` on
    // every macOS host. `0` stays the Node-shaped fallback for "no answer": the
    // field is typed `number` and Node never leaves it undefined.
    return hostPpid() ?? 0;
}

/**
 * The JS runtime's OWN `process` — Node's, Bun's or Deno's — or `undefined` when
 * `globalThis.process` is ours (or the GJS banner stub) or absent.
 *
 * Asked BEFORE {@link onGjs}, because `imports.gi` is not proof of GJS: node-gi
 * installs it on Node, Bun and Deno so GJS sources run there, and every question
 * below then took the GJS branch on a host that already knew the answer. On Windows
 * that answer was wrong, not merely slower — no `uname` on PATH, so `platform` fell
 * back to `linux` while Node's own `process.platform` said `win32`.
 *
 * `release` is the marker because all three runtimes set it (Bun and Deno report
 * `name: 'node'`, measured) and neither our `Process` nor the banner stub defines
 * it — a plain own-property read, so it cannot re-enter a lazy getter under GJS.
 */
function runtimeProcess(): NodeJS.Process | undefined {
    const proc = globalThis.process as NodeJS.Process | undefined;
    return typeof proc?.release?.name === 'string' ? proc : undefined;
}

/**
 * Are we running on GJS?
 *
 * Asked before `globalThis.process` is consulted for any lazy value (only
 * {@link runtimeProcess}'s plain `release` read precedes it), and that order
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
    const host = runtimeProcess();
    if (host) return host.platform;
    // GJS: ask the kernel. `GLib.get_os_info('ID')` is NOT usable for this —
    // it answers with the distribution id (measured: `fedora`), not the OS
    // family.
    if (onGjs()) {
        const uname = probeUname();
        if (uname) return uname.platform;
    }
    // Probe unavailable. Linux is the overwhelmingly common GJS host and the
    // only one with a CI-verified toolchain, so it stays the fallback — but it
    // is a fallback, not an assertion.
    return 'linux';
}

export function detectArch(): ProcessArch {
    const host = runtimeProcess();
    if (host) return host.arch;
    if (onGjs()) {
        const uname = probeUname();
        if (uname) return uname.arch;
    }
    return 'x64';
}

export function getPid(): number {
    // Only a runtime's OWN process is asked: under GJS, after register,
    // `globalThis.process` IS this object, and reading `pid` off it during
    // construction resolves against a half-built singleton.
    const host = runtimeProcess();
    if (host && typeof host.pid === 'number') return host.pid;
    // `hostPid()` reads `/proc/self/stat` where procfs exists and derives the
    // pid from a shell's `$PPID` where it does not. macOS has no procfs, so the
    // previous inline read reported `0` — a valid pid, and therefore a wrong
    // answer no consumer could detect.
    return hostPid() ?? 0;
}
