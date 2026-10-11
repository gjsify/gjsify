// SPDX-License-Identifier: MIT
// @gjsify/gi-runtime-android — host-side view of the NativeScript plugin payload.
//
// The payload is consumed by GRADLE, not by this file: NativeScript's build scans every
// dependency's `platforms/android` for `**/*.aar` and adds each as an `implementation`
// dependency, after which AGP packages `jni/<abi>/*.so` into the APK and merges
// `assets/**` into it. Nothing has to import this module for the plugin to work.
//
// What it is for is the HOST side of that: a build script, a device harness or a report
// that wants to know whether the payload is present and what is in it — before spending
// a gradle run to find out. The payload is built by scripts/build-gi-runtime-android.mjs
// and is gitignored, so `isPresent` is false in a fresh checkout.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The NativeScript plugin directory — what the NS gradle scans for `**\/*.aar`. */
export const platformsDir = join(here, 'platforms', 'android');

/** The AAR carrying both ABIs' native libraries and the shared typelibs. */
export const aarPath = join(platformsDir, 'gi-runtime-android.aar');

/** Sidecar written beside the AAR by the build: what went in, with sizes and digests. */
export const manifestPath = join(platformsDir, 'gi-runtime.json');

/**
 * Where the typelibs sit INSIDE the AAR, and where NativeScript therefore extracts them
 * on the device: it copies the APK's `assets/app/**` to `<filesDir>/app`, which makes
 * {@link deviceTypelibSubdir} the device path. That is `host.nativescript.js`'s default
 * for `__NODE_GI_TYPELIB_PATH` — the two agree on purpose, so an app that installs this
 * plugin needs no typelib configuration at all, and
 * `packages/node-gi/node-gi/test/gi-runtime-android.test.mjs` holds the agreement — both
 * directions, so moving either string alone fails a test instead of a device run.
 */
export const typelibAssetDir = 'assets/app/girepository-1.0';

/** The device path the above lands at, relative to the app's files dir. */
export const deviceTypelibSubdir = 'app/girepository-1.0';

/** Whether the payload is actually on disk (it is built, never committed). */
export const isPresent = existsSync(aarPath);

/**
 * The build's own record of the payload, or `null` when it was never built.
 *
 * @returns {{
 *   builtAt: string,
 *   abis: string[],
 *   giSysroot: string,
 *   libraries: Record<string, { name: string, bytes: number, sha256: string }[]>,
 *   typelibs: { name: string, bytes: number, sha256: string }[],
 *   aar: { bytes: number, sha256: string },
 * } | null}
 */
export function readRuntimeManifest() {
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export default {
    platformsDir,
    aarPath,
    manifestPath,
    typelibAssetDir,
    deviceTypelibSubdir,
    isPresent,
    readRuntimeManifest,
};
