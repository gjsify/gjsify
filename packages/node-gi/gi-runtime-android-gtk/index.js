// SPDX-License-Identifier: MIT
// @gjsify/gi-runtime-android-gtk — host-side view of the add-on's NativeScript plugin payload.
//
// Like the core, the payload is consumed by GRADLE (see @gjsify/gi-runtime-android/index.js):
// this file is for build scripts and device harnesses that want to know whether the AAR is
// present and what is in it. The add-on carries only what the core does not: GTK 4,
// libadwaita, Pango, HarfBuzz, Graphene and their typelibs.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The NativeScript plugin directory — what the NS gradle scans for `**\/*.aar`. */
export const platformsDir = join(here, 'platforms', 'android');

/** The AAR carrying both ABIs' GTK libraries and the add-on's typelibs. */
export const aarPath = join(platformsDir, 'gi-runtime-android-gtk.aar');

/** Sidecar written beside the AAR by the build: what went in, with sizes and digests. */
export const manifestPath = join(platformsDir, 'gi-runtime-gtk.json');

/**
 * Where the add-on's runtime manifest sits INSIDE the AAR, and where it lands on the device.
 * `host.nativescript.js` reads it at startup and compares its sysroot pin with the core's.
 */
export const deviceManifestSubdir = 'app/gi-runtime/gi-runtime-android-gtk.json';

/** Whether the payload is actually on disk (it is built, never committed). */
export const isPresent = existsSync(aarPath);

/** The build's own record of the payload, or `null` when it was never built. */
export function readRuntimeManifest() {
    if (!existsSync(manifestPath)) return null;
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export default {
    platformsDir,
    aarPath,
    manifestPath,
    deviceManifestSubdir,
    isPresent,
    readRuntimeManifest,
};
