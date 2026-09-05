/**
 * Base64 for the CLI's own Node entry, which may not reach `@gjsify/buffer`.
 *
 * `@gjsify/buffer` exports exactly these two functions and this file duplicates
 * them — deliberately, and the reason is a LAYER, not taste. The CLI's Node entry
 * is the bootstrap artifact (ADR 0002): `gjsify install` links it before anything
 * in this tree is built. `scripts/bootstrap-native-facades.mjs` emits `lib/esm`
 * for its link-time runtime deps with plain `tsc`, and `buildCliRuntimeDeps()`
 * resolves each one under `packages/infra/<name>`. `@gjsify/buffer` lives under
 * `packages/node/` and its own `build` is `gjsify run build:gjsify && …`, i.e. it
 * needs the BUNDLER — the artifact the bootstrap exists to produce. Importing it
 * from here inverts that order, and the failure is not a type error: the ESM link
 * fails at `bootstrap-native-facades`, so `build:infra` dies on every host before
 * a single test runs.
 *
 * Measured: with `import { base64Encode } from '@gjsify/buffer'` in the CLI's Node
 * entry, ten CI legs failed identically — "Missing at ESM link time:
 * packages/infra/cli/node_modules/@gjsify/buffer/lib/esm/index.js, imported from
 * lib/utils/ship/stage-manifest.js" — while all three REQUIRED checks stayed green,
 * because `check-build-infra-order` holds the declaration order for TYPES and this
 * is a runtime edge.
 *
 * So: one copy inside the CLI, imported by both call sites, rather than the two
 * that prompted the deduplication in the first place. If the CLI ever gains a
 * general way to reach `packages/node/*` at bootstrap time, this file is what
 * should go.
 */

/**
 * Chunked because `String.fromCharCode(...bytes)` is a spread: a tarball-sized
 * array blows the argument limit and throws `RangeError: Maximum call stack size
 * exceeded`. 0x8000 is the size the CLI's publish path has always used.
 */
export function base64Encode(bytes: Uint8Array): string {
    let str = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        str += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(str);
}

export function base64Decode(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
