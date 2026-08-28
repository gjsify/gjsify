// The one place that knows WHICH Node release the three `@gjsify/node-runtime-*`
// packages ship, and what a correct payload looks like. Imported by the fetcher
// and by the verifier, so the two cannot disagree about the release they are
// talking about — the same reason `verify-bundle-manifest.mjs` exists beside
// `build-gtk-runtime-darwin.mjs` instead of being an inline `node -e`.

/**
 * The pinned release, as a `vX.Y.Z` tag.
 *
 * A TAG, never `main` and never a floating `latest`: `deps/sqlite` is compiled
 * into the binary and is not listed in `LICENSE`, which proves the file is a
 * curated notice rather than a generated inventory. On `main`, `deps/libffi`
 * and `deps/perfetto` are also unlisted and DO require attribution — so the
 * licence obligation is only discharged by a release whose `LICENSE` upstream
 * has actually curated.
 *
 * v24.20.0 is the current Node 24 LTS ("Krypton", released 2026-08-26). Bumping
 * it means re-measuring {@link EXPECTED_LICENSE_BYTES} — see that constant.
 */
export const NODE_VERSION = 'v24.20.0';

/**
 * `https://nodejs.org/dist` — overridable for a mirror, never for a different
 * project. Kept a constant rather than a flag: the digest check below only means
 * something because `SHASUMS256.txt` comes from the same directory as the
 * archive, and a per-call base would let those two drift apart.
 */
export const NODE_DIST_BASE = process.env.GJSIFY_NODE_DIST_BASE ?? 'https://nodejs.org/dist';

/**
 * The two byte-lengths `LICENSE` has in ONE Node release, and the reason this is
 * a Set rather than a number.
 *
 * Measured on v24.20.0, on this workstation, from the official archives:
 *
 *   node-v24.20.0-darwin-arm64.tar.xz  LICENSE  157,609 B   0 CR    (LF)
 *   node-v24.20.0-win-x64.zip          LICENSE  160,555 B   2,946 CR (CRLF)
 *
 * 160,555 − 157,609 = 2,946, i.e. exactly one added CR per line. A single-value
 * check written from whichever archive the author happened to open first passes
 * two of the three targets and fails the third, and the failure reads as a
 * corrupt download rather than as a line-ending convention.
 *
 * HARD, and version-pinned on purpose. A Node bump that changes `LICENSE` fails
 * here with a message telling the maintainer to re-measure — which is the moment
 * to actually re-read what is being redistributed, not a moment to skip.
 */
export const EXPECTED_LICENSE_BYTES = new Set([157609, 160555]);

/**
 * The first line of Node's `LICENSE`, used as a shape check on the extracted
 * file.
 *
 * Cheap, but it is the assertion that distinguishes "we extracted the licence"
 * from "we extracted 157 KB of something". The digest check above proves the
 * ARCHIVE is authentic; nothing else proves the member picked out of it is the
 * one intended.
 */
export const LICENSE_FIRST_LINE = 'Node.js is licensed for use as follows:';

/**
 * A target's coordinates on `nodejs.org/dist` and in the published package.
 *
 * `target` is the npm spelling (`process.platform`-`process.arch`, so `win32`);
 * `distTag` is nodejs.org's (`win`). They differ, and conflating them is how a
 * fetcher ends up requesting a directory that does not exist.
 *
 * ⚠️ `archive` is deliberately the `.tar.xz` / `.zip` and NEVER the bare-binary
 * path `https://nodejs.org/dist/<v>/win-x64/`. Measured on v24.20.0, that
 * directory contains `node.exe`, `node.lib`, `node_pdb.7z`, `node_pdb.zip` —
 * and NO `LICENSE`. It is the convenient route (93 MB, no unzip) and it is the
 * one that silently drops the redistribution obligation: nothing errors, the
 * package just ships someone else's binary with no terms attached. The `.zip`
 * costs one extra extraction and carries the licence.
 */
export const TARGETS = {
    'darwin-arm64': {
        target: 'darwin-arm64',
        distTag: 'darwin-arm64',
        archive: (v) => `node-${v}-darwin-arm64.tar.xz`,
        kind: 'tar.xz',
        member: 'bin/node',
        binaryName: 'node',
        /** Mach-O 64, little-endian on disk (`cf fa ed fe`). */
        magic: [0xcf, 0xfa, 0xed, 0xfe],
        os: 'darwin',
        cpu: 'arm64',
    },
    'darwin-x64': {
        target: 'darwin-x64',
        distTag: 'darwin-x64',
        archive: (v) => `node-${v}-darwin-x64.tar.xz`,
        kind: 'tar.xz',
        member: 'bin/node',
        binaryName: 'node',
        magic: [0xcf, 0xfa, 0xed, 0xfe],
        os: 'darwin',
        cpu: 'x64',
    },
    'win32-x64': {
        target: 'win32-x64',
        distTag: 'win-x64',
        archive: (v) => `node-${v}-win-x64.zip`,
        kind: 'zip',
        member: 'node.exe',
        binaryName: 'node.exe',
        /** PE/COFF — `MZ`. */
        magic: [0x4d, 0x5a],
        os: 'win32',
        cpu: 'x64',
    },
};

/** The npm package name for a target. One spelling, derived, never typed twice. */
export function packageName(target) {
    return `@gjsify/node-runtime-${target}`;
}

/**
 * The smallest a real Node binary is, in bytes.
 *
 * 50 MB. Measured on v24.20.0: darwin-arm64 121,911,744 · darwin-x64
 * 124,285,824 · win32-x64 93,381,448. The check exists to catch an extraction
 * that produced a truncated file or an error page, not to pin a size — a
 * tolerance narrow enough to pin would fail on the next release for no reason.
 */
export const MIN_BINARY_BYTES = 50 * 1024 * 1024;
