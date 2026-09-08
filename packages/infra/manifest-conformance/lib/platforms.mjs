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

/**
 * `-musl` rides on LINUX ONLY, and the alternation says so rather than a
 * trailing optional group: npm's `libc` field is documented Linux-only, and
 * musl targets no other kernel, so `darwin-arm64-musl` is a malformed token
 * rather than a musl build of a mac binary. Accepting it here would mint a
 * platform package nothing can install.
 */
export const PLATFORM_RE =
    /^(?:linux-(?:x64|arm64|ppc64|s390x|riscv64)(?:-musl)?|(?:darwin|win32)-(?:x64|arm64|ppc64|s390x|riscv64))$/;

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

/**
 * Canonical (node-spelling) form so `linux-x86_64` and `linux-x64` compare equal.
 *
 * The `-musl` suffix SURVIVES. This used to keep the first two dash-parts and
 * nothing else, which folded `linux-x64-musl` onto `linux-x64` and made a musl
 * target compare equal to the glibc one in every set operation the prebuild
 * rules perform — two different binaries reading as one target. That was
 * unreachable while nothing declared a musl target; `@gjsify/lightningcss-native`
 * and `@gjsify/sab-native` now do, so the suffix has to be carried here, as
 * `prebuild-libc.mjs`'s `canonicalPrebuildTarget` note asked for.
 */
export function canonicalPlatform(token) {
    const [os, arch] = String(token).split('-');
    const canonical = `${os}-${ARCH_ALIASES[arch] ?? arch}`;
    return String(token).endsWith('-musl') ? `${canonical}-musl` : canonical;
}

/** Shared-library file extension per `process.platform` token. */
export const LIB_EXT = { linux: '.so', darwin: '.dylib', win32: '.dll' };

/** `${process.platform}-${process.arch}` — the one target this host can load. */
export const HOST_TARGET = `${process.platform}-${process.arch}`;
