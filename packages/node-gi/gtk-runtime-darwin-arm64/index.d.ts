// SPDX-License-Identifier: MIT
/** Absolute path to the bundle root (contains `lib/` + `girepository-1.0/`). */
export const bundleDir: string;
/** Absolute path to the relocated dylib dir (`@loader_path`-linked). */
export const libDir: string;
/** Absolute path to the typelib dir (feed to GIRepository.prepend_search_path). */
export const typelibDir: string;
/** Whether the bundle payload is actually present on disk (it is built on CI). */
export const isPresent: boolean;
declare const _default: { bundleDir: string; libDir: string; typelibDir: string; isPresent: boolean };
export default _default;
