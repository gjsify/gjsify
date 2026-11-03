// SPDX-License-Identifier: MIT

import type { RuntimeManifest } from '@gjsify/gi-runtime-android';

/** The NativeScript plugin directory — what the NS gradle scans for `**\/*.aar`. */
export const platformsDir: string;
/** The AAR carrying both ABIs' GTK libraries and the add-on's typelibs. */
export const aarPath: string;
/** Sidecar written beside the AAR by the build. */
export const manifestPath: string;
/** Device path of the add-on's runtime manifest, relative to the app's files dir. */
export const deviceManifestSubdir: string;
/** Whether the payload is actually on disk (it is built, never committed). */
export const isPresent: boolean;
/** The build's own record of the payload, or `null` when it was never built. */
export function readRuntimeManifest(): RuntimeManifest | null;

declare const _default: {
    platformsDir: string;
    aarPath: string;
    manifestPath: string;
    deviceManifestSubdir: string;
    isPresent: boolean;
    readRuntimeManifest: typeof readRuntimeManifest;
};
export default _default;
