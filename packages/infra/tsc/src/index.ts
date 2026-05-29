// @gjsify/tsc — TypeScript compiler for GJS.
//
// The actual `tsc` runtime is the committed bundle at `dist/tsc.gjs.mjs`,
// built from upstream `typescript`'s `_tsc.js` via `gjsify build --app gjs`.
// That bundle is wired up as the `gjsify-tsc` bin and as the `./bundle`
// export — those are the entry points consumers reach for.
//
// This module is metadata-only. It exists so the package has a non-bundle
// TypeScript surface for things like `import { TSC_BUNDLE_PATH } from
// '@gjsify/tsc'` from helper scripts and for future programmatic API
// re-exports (e.g. once we ship a `typescript.gjs.mjs` library bundle, the
// `createProgram` / `createCompilerHost` re-exports land here).
//
// Reference: Adapted from typescript (refs/typescript). Copyright (c) Microsoft Corporation.
// Modifications: bundled for GJS via @gjsify/cli; this metadata stub is original gjsify code.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Absolute path to the bundled `tsc` GJS module, relative to this file. */
export const TSC_BUNDLE_PATH: string = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'dist',
    'tsc.gjs.mjs',
);

/** Pinned upstream TypeScript version the shipped bundle was built from. */
export const TYPESCRIPT_VERSION = '5.9.3' as const;
