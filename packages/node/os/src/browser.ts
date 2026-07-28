// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by CoderPuppy/os-browserify (MIT).
//
// NOTE: importing `./constants.js` here is deliberate — it is a pure data
// table (plain integers, no Node/GI imports), so it costs the browser bundle
// nothing but the numbers themselves.
//
// Reference: refs/node/lib/os.js (surface mirror)
// Inspiration: os-browserify, Copyright (c) CoderPuppy. MIT.
//
// Browser has no POSIX uname / sysctl / /proc surface, so every reading is a
// constant ("browser" platform/arch, /tmp as tmpdir, localhost hostname, no
// cpus, no mem). Mirrors what `node-stdlib-browser` exposes plus a few extras
// (`availableParallelism`, `machine`, `version`) so npm packages probing
// recent Node APIs don't trip.

import osConstants from './constants.js';

export const EOL = '\n';
export const devNull = '/dev/null';

export const homedir = (): string => '/';
export const hostname = (): string => 'localhost';
export const tmpdir = (): string => '/tmp';
export const release = (): string => '';
export const type = (): string => 'Browser';
export const version = (): string => '';
export const machine = (): string => 'browser';
export const platform = (): NodeJS.Platform => 'browser' as NodeJS.Platform;
export const arch = (): NodeJS.Architecture => 'browser' as NodeJS.Architecture;

export const endianness = (): 'BE' | 'LE' => {
    // Probe the host's endianness via a Uint16/Uint8 view. SpiderMonkey + V8 + JSC
    // are all little-endian on every platform we care about, but the probe makes
    // this future-proof at near-zero cost.
    const buf = new ArrayBuffer(2);
    new DataView(buf).setInt16(0, 256, true);
    return new Int16Array(buf)[0] === 256 ? 'LE' : 'BE';
};

// Use structural shapes rather than NodeJS.* namespace types — `@types/node`
// is `--app browser`-resolved through the same alias chain as everything
// else, and pinning to namespaced types couples the browser entry to a Node
// types dep that the audit's strict-probe forbids. The shapes mirror Node's
// public os.* return types exactly.
interface CpuInfo {
    model: string;
    speed: number;
    times: { user: number; nice: number; sys: number; idle: number; irq: number };
}
interface NetworkInterfaceInfo {
    address: string;
    netmask: string;
    family: string;
    mac: string;
    internal: boolean;
    cidr: string | null;
    scopeid?: number;
}

export const cpus = (): CpuInfo[] => [];
export const totalmem = (): number => 0;
export const freemem = (): number => 0;
export const loadavg = (): [number, number, number] => [0, 0, 0];
export const uptime = (): number => 0;
export const networkInterfaces = (): Record<string, NetworkInterfaceInfo[] | undefined> => ({});

export const availableParallelism = (): number => {
    // navigator.hardwareConcurrency is widely available; fall back to 1 in
    // environments where it isn't (older WebViews, very locked-down workers).
    const nav = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
    return nav?.hardwareConcurrency && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : 1;
};

export const userInfo = (): {
    uid: number;
    gid: number;
    username: string;
    homedir: string;
    shell: string;
} => ({
    uid: -1,
    gid: -1,
    username: 'browser',
    homedir: '/',
    shell: '',
});

export const getPriority = (_pid?: number): number => 0;
export const setPriority = (_pidOrPriority: number, _priority?: number): void => {
    // Best-effort no-op (Node throws on permission errors; the browser has no
    // priority concept). Returning early matches what a browserify-compatible
    // shim does and avoids breaking callers that just want a guarded probe.
};

export const constants = {
    UV_UDP_REUSEADDR: 4,
    // errno + signal numbers are PLATFORM DATA, not a runtime capability —
    // they are the same integers in a browser tab as anywhere else, and
    // `constants-browserify` (the ecosystem's reference browser shim) ships
    // them in full. They were `{}` here, which is why `@gjsify/constants`
    // — whose whole job is to flatten `os.constants` — resolved `ENOENT`,
    // `SIGINT` and friends to `undefined` in the browser build.
    //
    // Reuse the single source of truth in `./constants.js` rather than
    // duplicating the tables; a second copy is a table that drifts.
    errno: osConstants.errno,
    signals: osConstants.signals,
    // `dlopen` stays empty on purpose: unlike errno/signals it describes a
    // dynamic linker, which a browser genuinely does not have.
    priority: {
        PRIORITY_LOW: 19,
        PRIORITY_BELOW_NORMAL: 10,
        PRIORITY_NORMAL: 0,
        PRIORITY_ABOVE_NORMAL: -7,
        PRIORITY_HIGH: -14,
        PRIORITY_HIGHEST: -20,
    },
    dlopen: {},
} as const;

export default {
    EOL,
    devNull,
    arch,
    availableParallelism,
    constants,
    cpus,
    endianness,
    freemem,
    getPriority,
    homedir,
    hostname,
    loadavg,
    machine,
    networkInterfaces,
    platform,
    release,
    setPriority,
    tmpdir,
    totalmem,
    type,
    uptime,
    userInfo,
    version,
};
