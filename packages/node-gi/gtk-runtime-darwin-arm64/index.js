// SPDX-License-Identifier: MIT
// @gjsify/gtk-runtime-darwin-arm64 — path helpers for the relocated GTK runtime bundle.
// @gjsify/node-gi resolves this package (optional, os/cpu-gated) to find the bundled typelib +
// dylib dirs when no Homebrew GTK is present. The heavy `gtk/` payload is produced by
// ../scripts/build-gtk-runtime-darwin.mjs on an Apple-silicon macOS runner.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundle root (contains `lib/` + `girepository-1.0/`). */
export const bundleDir = join(here, 'gtk');

/** Absolute path to the relocated dylib dir (`@loader_path`-linked). */
export const libDir = join(bundleDir, 'lib');

/** Absolute path to the typelib dir (feed to GIRepository.prepend_search_path). */
export const typelibDir = join(bundleDir, 'girepository-1.0');

/** Whether the bundle payload is actually present on disk (it is built on CI). */
export const isPresent = existsSync(typelibDir) && existsSync(libDir);

export default { bundleDir, libDir, typelibDir, isPresent };
