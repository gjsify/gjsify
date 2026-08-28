// SPDX-License-Identifier: MIT
// @gjsify/node-runtime-darwin-x64 — where the bundled Node interpreter is.
//
// A path helper and nothing else. Whoever SHIPS an application resolves this
// package by name and copies `nodePath` into the artifact (`gjsify ship`'s macOS
// .app bundle / Windows program directory); this file never spawns anything and
// never reads a global.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The platform-arch this package carries an interpreter for. */
export const target = 'darwin-x64';

/**
 * The interpreter's filename — a per-package CONSTANT, never derived from
 * `process.platform`.
 *
 * Deriving it would be wrong exactly where it matters: assembling a Windows
 * artifact from a Linux or macOS host is a supported path (ADR 0024 § A1 — the
 * packers are pure JavaScript and run anywhere), and a `process.platform`-derived
 * name would look for `node` inside the win32 package and find nothing, with the
 * failure reading as a missing payload.
 */
export const binaryName = 'node';

/** Absolute path to the payload directory (contains the interpreter + LICENSE). */
export const binDir = join(here, 'bin');

/** Absolute path to the bundled Node interpreter. */
export const nodePath = join(binDir, binaryName);

/**
 * Absolute path to Node's own LICENSE, copied verbatim from the release.
 *
 * It must travel with the binary. One file discharges the whole set — MIT,
 * Apache-2.0, BSD-3, Unicode-3.0, zlib, Artistic-2.0, BlueOak-1.0.0, ISC — and
 * shipping the interpreter without it is redistribution with no terms attached.
 */
export const licensePath = join(binDir, 'LICENSE');

/** Whether the payload is actually present (it is fetched on CI, not committed). */
export const isPresent = existsSync(nodePath) && existsSync(licensePath);

export default { target, binaryName, binDir, nodePath, licensePath, isPresent };
