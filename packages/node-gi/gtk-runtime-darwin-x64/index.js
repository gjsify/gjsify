// SPDX-License-Identifier: MIT
// @gjsify/gtk-runtime-darwin-x64 — path helpers for the relocated GTK runtime bundle.
// @gjsify/node-gi resolves this package (optional, os/cpu-gated) to find the bundled typelib +
// dylib dirs when no Homebrew GTK is present. The heavy `gtk/` payload is produced by
// ../scripts/build-gtk-runtime-darwin.mjs on an Intel macOS runner.
//
// Byte-for-byte the same body as the darwin-arm64 sibling apart from this header (win32-x64
// exports `binDir` instead), deliberately NOT lifted into a shared module: this file IS the
// package entry (`require.resolve('@gjsify/gtk-runtime-<target>')`) and these tarballs are
// dependency-free, so a platform-gated install needs no resolution beyond itself. No
// arch-dependent logic to drift — every path is relative to this file.
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
