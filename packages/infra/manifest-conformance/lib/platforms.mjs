/**
 * The `<os>-<arch>[-musl]` vocabulary shared by every prebuild-facing rule.
 *
 * There is exactly ONE spelling for a target: `${process.platform}-${process.arch}`,
 * plus the libc suffix below on Linux. It is what a running process computes about
 * itself, so resolution needs no translation. A declaration in the old uname style
 * (`linux-x86_64`, `linux-aarch64`) is REJECTED rather than silently canonicalised,
 * so the invariant fails on the package.json that is wrong instead of hours later as
 * a "typelib not found" at some consumer's runtime.
 */

/**
 * The canonical arch spellings, as a LIST rather than inline in the pattern below.
 * `PLATFORM_RE` has to be an alternation because the libc suffix rides on linux
 * only, and an alternation written out by hand carries the arch vocabulary twice
 * inside one expression — where adding an arch to one branch and not the other
 * mints a token that is valid on darwin and malformed on linux, or the reverse.
 * `KNOWN_ARCH_TOKENS` is the third reader of the same list.
 */
const CANONICAL_ARCHES = ['x64', 'arm64', 'ppc64', 's390x', 'riscv64'];

/**
 * The one libc suffix the grammar spells out, and the reason it is asymmetric:
 * an UNSUFFIXED token means "the default build", not "the glibc build", so
 * `-glibc` would rename every committed directory for no new expressiveness.
 * `prebuild-libc.mjs`'s `parsePrebuildTarget` carries that argument in full.
 */
export const MUSL_SUFFIX = '-musl';

/**
 * `-musl` rides on LINUX ONLY, and the alternation says so rather than a
 * trailing optional group: npm's `libc` field is documented Linux-only, and
 * musl targets no other kernel, so `darwin-arm64-musl` is a malformed token
 * rather than a musl build of a mac binary. Accepting it here would mint a
 * platform package nothing can install.
 */
export const PLATFORM_RE = new RegExp(
    `^(?:linux-(?:${CANONICAL_ARCHES.join('|')})(?:${MUSL_SUFFIX})?` +
        `|(?:darwin|win32)-(?:${CANONICAL_ARCHES.join('|')}))$`,
);

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
export const KNOWN_ARCH_TOKENS = new Set([...CANONICAL_ARCHES, ...Object.keys(ARCH_ALIASES)]);

/**
 * Canonical (node-spelling) form so `linux-x86_64` and `linux-x64` compare equal.
 *
 * The `-musl` suffix SURVIVES, and that is load-bearing rather than tidy. This
 * used to keep the first two dash-parts and nothing else, which folded
 * `linux-x64-musl` onto `linux-x64` and made a musl target compare EQUAL to the
 * glibc one in every set operation the prebuild rules perform — two different
 * binaries reading as one target. It was unreachable only for as long as nothing
 * declared a musl target.
 *
 * A token with no arch half comes back UNTOUCHED. The split that produced
 * `${os}-undefined` for one turned a malformed declaration into a different
 * malformed one, so the audit that rejects it named a token nobody had written.
 *
 * The `.ts` twin is `canonicalPlatformToken` in
 * `packages/infra/cli/src/utils/detect-native-packages.ts`; the two must agree or
 * a package passes the audit while the CLI resolves a different directory.
 */
export function canonicalPlatform(token) {
    const target = String(token);
    const musl = target.endsWith(MUSL_SUFFIX);
    const base = musl ? target.slice(0, -MUSL_SUFFIX.length) : target;
    const dash = base.indexOf('-');
    if (dash < 0 || dash === base.length - 1) return target;
    const arch = base.slice(dash + 1);
    return `${base.slice(0, dash)}-${ARCH_ALIASES[arch] ?? arch}${musl ? MUSL_SUFFIX : ''}`;
}

/** Shared-library file extension per `process.platform` token. */
export const LIB_EXT = { linux: '.so', darwin: '.dylib', win32: '.dll' };

/**
 * `${process.platform}-${process.arch}` — the one target this host can load.
 *
 * Libc-BLIND, unlike every other name in this module, and that is now a gap rather
 * than a simplification: `prebuild-artifacts` compares a directory against this to
 * decide what to `dlopen`, so on a musl host it functionally loads the glibc
 * directory (which cannot load there) and skips the `-musl` one (which can). It was
 * unreachable while no `-musl` directory could exist. Closing it needs a host-libc
 * probe here plus a CI leg that runs the audit on musl, neither of which this module
 * has; see `status/open-todos.md`, "HOST_TARGET is libc-blind".
 */
export const HOST_TARGET = `${process.platform}-${process.arch}`;
