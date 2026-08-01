// Random-byte filling with an explicit, ordered source chain — the ONE place
// this workspace decides where random bytes come from.
//
// It lives HERE, in the package that owns `crypto.getRandomValues`, rather than
// in a shared utility bag: picking an entropy source IS the WebCrypto
// implementation, and AGENTS.md's first question for any new code is which
// package owns the behaviour. `@gjsify/crypto` reaches it through the dedicated
// `@gjsify/webcrypto/random` subpath (a leaf module — no `SubtleCrypto`, no
// `@gjsify/dom-exception`), which is also what keeps that edge acyclic and
// cheap to bundle.
//
// The chain existed in two copies before, and both were wrong in a way that
// only shows up in the composition:
//
//   • `@gjsify/webcrypto`'s `CryptoPolyfill.getRandomValues()` — the polyfill
//     that PROVIDES `crypto.getRandomValues` on GJS — carried the comment
//     "Fallback: use GLib or Math.random" above a loop that only ever called
//     `Math.random()`. GLib was never reached.
//   • `@gjsify/crypto`'s `randomBytes()` prefers `globalThis.crypto`. On GJS
//     that IS the polyfill above, so the "WebCrypto" tier resolved to
//     `Math.random()` — while looking, at every call site, like WebCrypto.
//
// So `randomBytes()` handed out non-cryptographic bytes on GJS and nothing in
// either package could see it: each half was locally defensible.
//
// ## The chain
//
//   1. WebCrypto `getRandomValues`   CSPRNG. Native on Node/bun/deno/browser.
//   2. `/dev/urandom` via Gio        CSPRNG. The real entropy source on GJS.
//   3. `GLib.random_int_range`       NOT cryptographic — a Mersenne-Twister
//                                    PRNG (see the g_random_* docs). Kept only
//                                    as a better-distributed stand-in.
//   4. `Math.random()`               NOT cryptographic. Last resort.
//
// Tiers 3 and 4 are a degradation, so they say so ONCE on stderr instead of
// being silently indistinguishable from tier 1 — the failure above was exactly
// a silent, plausible-looking wrong answer. The return value names the tier
// that actually ran, so a caller (or a test) can assert it rather than assume.
//
// GJS access goes through the guarded `globalThis.imports?.gi` probe, the same
// shape `@gjsify/utils`' `ensureMainLoop()` uses. This package declares
// `node`/`browser`/`nativescript` as `native`, so the module must stay loadable
// on all of them: no top-level `gi://` or `@girs/*` VALUE import. Off GJS the
// probe is `undefined` and tiers 2–3 are skipped — which costs nothing, because
// every non-GJS runtime we target ships WebCrypto natively at tier 1.

import type GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

/** Which source filled the buffer. Tiers 3–4 are NOT cryptographically secure. */
export type RandomSource = 'webcrypto' | 'urandom' | 'glib' | 'math';

/**
 * The minimal WebCrypto surface this module needs.
 *
 * Deliberately NARROWER than the DOM `Crypto` interface — it takes the one
 * concrete view type the chain ever passes, so a real `Crypto` (whose
 * `getRandomValues` is generic over `Exclude<BufferSource, ArrayBuffer>`)
 * satisfies it by instantiation, and a hand-rolled source does not have to
 * reproduce that generic signature to be usable.
 */
export interface WebCryptoRandomSource {
    getRandomValues(array: Uint8Array<ArrayBuffer>): unknown;
}

export interface FillRandomBytesOptions {
    /**
     * WebCrypto source for tier 1. Defaults to `globalThis.crypto`.
     *
     * Pass `null` to SKIP the tier — that is how `@gjsify/webcrypto`'s own
     * polyfill uses this without recursing into itself.
     */
    webcrypto?: WebCryptoRandomSource | null;
}

/** The GI namespaces this module reaches for on GJS. */
interface _GjsGi {
    GLib?: typeof GLib;
    Gio?: typeof Gio;
}

/** GJS runtime bootstrap shape read here — see the module header. */
interface _GjsImports {
    imports?: { gi?: _GjsGi };
}

/** `getRandomValues` is specified to reject buffers larger than this. */
const WEBCRYPTO_QUOTA = 65536;

/** Sources that are cryptographically secure. */
const SECURE_SOURCES: readonly RandomSource[] = ['webcrypto', 'urandom'];

let warnedInsecure = false;
/** `null` = not tried yet, `false` = unavailable on this host. */
let urandomStream: Gio.InputStream | null | false = null;

function gjsGi(): _GjsGi | undefined {
    return (globalThis as unknown as _GjsImports).imports?.gi;
}

/** Whether bytes from `source` are suitable for cryptographic use. */
export function isSecureRandomSource(source: RandomSource): boolean {
    return SECURE_SOURCES.includes(source);
}

function fillFromWebCrypto(view: Uint8Array, webcrypto: WebCryptoRandomSource): void {
    // WebCrypto refuses more than 64 KiB per call — chunk larger requests.
    for (let offset = 0; offset < view.length; offset += WEBCRYPTO_QUOTA) {
        const length = Math.min(view.length - offset, WEBCRYPTO_QUOTA);
        webcrypto.getRandomValues(new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset + offset, length));
    }
}

/**
 * The `/dev/urandom` read stream, opened once and kept — a CSPRNG handle, not a
 * file whose contents change. `false` once we know this host has no readable
 * `/dev/urandom` (non-Unix, or a sandbox that hides it), so the failure is paid
 * for at most once.
 */
function openUrandom(): Gio.InputStream | false {
    if (urandomStream !== null) return urandomStream;
    const Gio = gjsGi()?.Gio;
    if (!Gio) {
        urandomStream = false;
        return false;
    }
    try {
        urandomStream = Gio.File.new_for_path('/dev/urandom').read(null);
    } catch {
        urandomStream = false;
    }
    return urandomStream;
}

function fillFromUrandom(view: Uint8Array): boolean {
    const stream = openUrandom();
    if (!stream) return false;
    try {
        let offset = 0;
        while (offset < view.length) {
            const bytes = stream.read_bytes(view.length - offset, null);
            const chunk = bytes.toArray();
            // A short read is normal on a character device; a ZERO-length one
            // means the stream is done, which /dev/urandom never is — treat it
            // as unusable rather than spinning.
            if (chunk.length === 0) return false;
            view.set(chunk, offset);
            offset += chunk.length;
        }
        return true;
    } catch {
        // Leave the stream cached: a transient read error should not disable the
        // whole tier, and a permanently broken one fails the same way next time.
        return false;
    }
}

function fillFromGLib(view: Uint8Array): boolean {
    const GLib = gjsGi()?.GLib;
    if (!GLib?.random_int_range) return false;
    for (let i = 0; i < view.length; i++) view[i] = GLib.random_int_range(0, 256);
    return true;
}

function fillFromMath(view: Uint8Array): void {
    for (let i = 0; i < view.length; i++) view[i] = Math.floor(Math.random() * 256);
}

function warnInsecureOnce(source: RandomSource): void {
    if (warnedInsecure) return;
    warnedInsecure = true;
    console.warn(
        `[@gjsify/webcrypto] No cryptographically secure random source available — falling back to "${source}". ` +
            'Neither GLib.Random nor Math.random is suitable for keys, tokens or IVs. ' +
            'Expected sources: WebCrypto (globalThis.crypto) or /dev/urandom via Gio on GJS.',
    );
}

/**
 * Fill `view` with random bytes from the best available source.
 *
 * @returns the source that produced the bytes — check it with
 *          {@link isSecureRandomSource} when the caller needs a CSPRNG.
 */
export function fillRandomBytes(view: Uint8Array, options: FillRandomBytesOptions = {}): RandomSource {
    if (view.length === 0) return 'webcrypto';

    const webcrypto =
        options.webcrypto === undefined
            ? ((globalThis as { crypto?: WebCryptoRandomSource }).crypto ?? null)
            : options.webcrypto;
    if (webcrypto && typeof webcrypto.getRandomValues === 'function') {
        fillFromWebCrypto(view, webcrypto);
        return 'webcrypto';
    }

    if (fillFromUrandom(view)) return 'urandom';

    if (fillFromGLib(view)) {
        warnInsecureOnce('glib');
        return 'glib';
    }

    fillFromMath(view);
    warnInsecureOnce('math');
    return 'math';
}

/** Reset the cached probes — tests only. */
export function _resetRandomSourceCache(): void {
    urandomStream = null;
    warnedInsecure = false;
}
