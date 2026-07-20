// SPDX-License-Identifier: MIT
// @gjsify/gtk-runtime-win32-x64 — path helpers for the bundled GTK runtime.
// @gjsify/node-gi resolves this package (optional, os/cpu-gated) to find the
// bundled typelib + DLL dirs when no gvsbuild/system GTK is present. Unlike
// macOS, Windows needs NO relocation: DLLs resolve by SEARCH PATH at LoadLibrary
// time, so node-gi just prepends `gtk/bin` to PATH before the addon loads. The
// heavy `gtk/` payload is produced by scripts/build-gtk-runtime.mjs on a Windows
// runner.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundle root (contains `bin/` + `girepository-1.0/`). */
export const bundleDir = join(here, 'gtk');

/** Absolute path to the bundled DLL dir (prepend to PATH so LoadLibrary finds it). */
export const binDir = join(bundleDir, 'bin');

/** Absolute path to the typelib dir (feed to GIRepository.prepend_search_path). */
export const typelibDir = join(bundleDir, 'girepository-1.0');

/** Whether the bundle payload is actually present on disk (it is built on CI). */
export const isPresent = existsSync(typelibDir) && existsSync(binDir);

export default { bundleDir, binDir, typelibDir, isPresent };
