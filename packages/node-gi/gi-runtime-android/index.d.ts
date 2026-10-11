// SPDX-License-Identifier: MIT

/** One file inside the payload, as the build recorded it. */
export interface RuntimeEntry {
    name: string;
    bytes: number;
    sha256: string;
}

/** The build's own record of the payload (`platforms/android/gi-runtime.json`). */
export interface RuntimeManifest {
    builtAt: string;
    abis: string[];
    giSysroot: string;
    /** ABI → the native libraries packaged for it, `libnode_gi.so` included. */
    libraries: Record<string, RuntimeEntry[]>;
    typelibs: RuntimeEntry[];
    aar: { bytes: number; sha256: string };
}

/** The NativeScript plugin directory — what the NS gradle scans for `**\/*.aar`. */
export const platformsDir: string;
/** The AAR carrying both ABIs' native libraries and the shared typelibs. */
export const aarPath: string;
/** Sidecar written beside the AAR by the build: what went in, with sizes and digests. */
export const manifestPath: string;
/** Where the typelibs sit inside the AAR (`assets/app/girepository-1.0`). */
export const typelibAssetDir: string;
/** The device path the above lands at, relative to the app's files dir. */
export const deviceTypelibSubdir: string;
/** Whether the payload is actually on disk (it is built, never committed). */
export const isPresent: boolean;
/** The build's own record of the payload, or `null` when it was never built. */
export function readRuntimeManifest(): RuntimeManifest | null;

declare const _default: {
    platformsDir: string;
    aarPath: string;
    manifestPath: string;
    typelibAssetDir: string;
    deviceTypelibSubdir: string;
    isPresent: boolean;
    readRuntimeManifest: typeof readRuntimeManifest;
};
export default _default;
