// The platform VOCABULARY shared by the two halves of ADR 0084: the build enumerates
// every `.node` an addon package ships, keyed by platform; the bundle picks one at run
// time from the host it finds itself on. Both halves must spell a platform the same way
// or the lookup silently misses, so the spelling lives here — a pure module with no
// `node:` imports, because the runtime half (`shims/addon-resolve.ts`) is bundled into
// user output and must not drag the filesystem in.
//
// The key is node-gyp-build's tuple (`<platform>-<arch>`) plus a `-musl` suffix, NOT
// napi-rs' triple: napi-rs spells the same platform `linux-x64-gnu` / `win32-x64-msvc`
// while prebuildify spells it `linux-x64`, and one bundle can carry addons of both
// conventions. {@link normalizeNapiRsTriple} folds the second spelling into the first.

/** The one spelling: `linux-x64`, `linux-x64-musl`, `darwin-arm64`, `win32-x64`. */
export function addonPlatformKey(platform: string, arch: string, libc?: string): string {
    return libc === 'musl' ? `${platform}-${arch}-musl` : `${platform}-${arch}`;
}

/**
 * A napi-rs triple as an {@link addonPlatformKey}. The ABI token napi-rs appends is
 * either implied by the platform (`gnu` on linux, `msvc` on win32, the arm eabi
 * flavours) or a real axis (`musl`) — only the latter survives into the key.
 */
export function normalizeNapiRsTriple(triple: string): string {
    if (triple.endsWith('-musl')) return triple;
    return triple.replace(/-(?:gnu|msvc|eabi|eabihf|gnueabihf|androideabi)$/, '');
}

/**
 * The keys to try for a host, most specific first.
 *
 * A musl host also accepts the UNTAGGED key, because that is what node-gyp-build's own
 * untagged prebuilds mean — "no libc claim" — and a musl-only tree would otherwise find
 * nothing. A glibc host does NOT accept the musl key: loading a musl binary against
 * glibc is the failure this selection exists to avoid, and a missing entry with a clear
 * message beats a `dlopen` crash.
 *
 * `*` is last and is not host-specific: it is the entry a DIRECTLY imported `.node`
 * writes, where the source named one file and there is no selection to make.
 */
export function hostAddonKeys(platform: string, arch: string, libc?: string): string[] {
    const base = addonPlatformKey(platform, arch);
    return libc === 'musl' ? [`${base}-musl`, base, '*'] : [base, '*'];
}

/** The first key of `keys` present in `targets`, or null. */
export function selectAddonTarget(targets: Record<string, string>, keys: string[]): string | null {
    for (const key of keys) {
        const hit = targets[key];
        if (typeof hit === 'string' && hit.length > 0) return hit;
    }
    return null;
}
