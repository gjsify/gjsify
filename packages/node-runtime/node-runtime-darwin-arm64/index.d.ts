// SPDX-License-Identifier: MIT
/** The platform-arch this package carries an interpreter for. */
export const target: 'darwin-arm64';
/** The interpreter's filename — a package constant, not derived from `process.platform`. */
export const binaryName: 'node';
/** Absolute path to the payload directory (contains the interpreter + LICENSE). */
export const binDir: string;
/** Absolute path to the bundled Node interpreter. */
export const nodePath: string;
/** Absolute path to Node's own LICENSE, copied verbatim from the release. */
export const licensePath: string;
/** Whether the payload is actually present (it is fetched on CI, not committed). */
export const isPresent: boolean;
declare const _default: {
    target: 'darwin-arm64';
    binaryName: 'node';
    binDir: string;
    nodePath: string;
    licensePath: string;
    isPresent: boolean;
};
export default _default;
