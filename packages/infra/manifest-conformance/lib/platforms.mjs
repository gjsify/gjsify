/**
 * The `<os>-<arch>` vocabulary shared by every prebuild-facing rule.
 *
 * There is exactly ONE spelling for a target: `${process.platform}-${process.arch}`.
 * It is what a running process computes about itself, so resolution needs no
 * translation. A declaration in the old uname style (`linux-x86_64`,
 * `linux-aarch64`) is REJECTED rather than silently canonicalised, so the
 * invariant fails on the package.json that is wrong instead of hours later as a
 * "typelib not found" at some consumer's runtime.
 */

export const PLATFORM_RE = /^(linux|darwin|win32)-(x64|arm64|ppc64|s390x|riscv64)$/;

/**
 * Legacy uname-style arch spellings folded onto the node one. Kept ONLY so a
 * workflow that still says `arch: x86_64` and a pre-rename tarball's shipped
 * directory both compare equal to the canonical declaration. Mirrors
 * `ARCH_ALIASES` in `packages/infra/cli/src/utils/detect-native-packages.ts`;
 * a divergence would let a package pass the audit while the CLI misses its dir.
 */
export const ARCH_ALIASES = { x86_64: 'x64', amd64: 'x64', aarch64: 'arm64' };

/**
 * Every token the CI-matrix parser accepts as naming a CPU — the canonical
 * `process.arch` spellings plus the legacy aliases above.
 */
export const KNOWN_ARCH_TOKENS = new Set(['x64', 'arm64', 'ppc64', 's390x', 'riscv64', ...Object.keys(ARCH_ALIASES)]);

/** Canonical (node-spelling) form so `linux-x86_64` and `linux-x64` compare equal. */
export function canonicalPlatform(token) {
    const [os, arch] = String(token).split('-');
    return `${os}-${ARCH_ALIASES[arch] ?? arch}`;
}

/** Shared-library file extension per `process.platform` token. */
export const LIB_EXT = { linux: '.so', darwin: '.dylib', win32: '.dll' };

/** `${process.platform}-${process.arch}` — the one target this host can load. */
export const HOST_TARGET = `${process.platform}-${process.arch}`;
