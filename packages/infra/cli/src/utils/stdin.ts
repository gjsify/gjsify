// SPDX-License-Identifier: MIT
// Read ALL of stdin, on Node AND inside the committed GJS bundles.
//
// `readFileSync(0, 'utf-8')` is the Node idiom for "slurp stdin", and it is
// what `gjsify affected --changed-from-stdin` used. It does NOT survive the
// GJS bundle: `@gjsify/fs` has no numeric-file-descriptor path, so the `0` is
// coerced to a PATH and the call opens the relative file `./0` — every GJS
// caller died with
//
//     Error: ENOENT: … read '0'   (readStdinLines → readFileSync)
//
// which silently disabled the ONE fixture-driven entry point AGENTS.md
// documents for testing the CI classifier (`--changed-from-stdin`).
//
// Under GJS we therefore read fd 0 through `GioUnix.InputStream`. Two
// deliberate choices:
//
//   - `globalThis.imports.gi.GioUnix` rather than a `gi://GioUnix` import.
//     `packages/infra/cli/lib/**` is ALSO the Node entry point of
//     `@gjsify/cli` (`bin: lib/index.js`); a static `gi://` import anywhere
//     reachable from it breaks `gjsify` on Node, and a dynamic one would need
//     an `@girs/giounix-2.0` type dependency the CLI does not otherwise have.
//     The legacy `imports.gi` form is the sanctioned GJS-bootstrap escape
//     hatch (AGENTS.md "Reading globals", exception 4) and adds NO new typelib
//     to the classifier bundle — `gi://GioUnix?version=2.0` is already in its
//     import graph via `@gjsify/fs`.
//   - a synchronous read. The callers are CLI argument-parsing paths that run
//     before any main loop exists, and the async `process.stdin` route carries
//     the documented resume/pause races (see `utils/prompt.ts`).

import { readFileSync } from 'node:fs';

/** Minimal structural view of the bits of `GioUnix.InputStream` used here. */
interface GioUnixInputStreamLike {
    read_bytes(count: number, cancellable: null): { get_size(): number; toArray(): Uint8Array };
}
interface GioUnixLike {
    InputStream: new (props: { fd: number; close_fd: boolean }) => GioUnixInputStreamLike;
}

const CHUNK = 64 * 1024;

/** Read fd 0 to EOF under GJS via GioUnix (no `@gjsify/fs` fd support needed). */
function readStdinTextGjs(): string {
    const gi = (globalThis as unknown as { imports?: { gi?: { GioUnix?: GioUnixLike } } }).imports?.gi;
    const GioUnix = gi?.GioUnix;
    if (!GioUnix) {
        throw new Error(
            'gjsify: cannot read stdin under GJS — the GioUnix typelib is unavailable. ' +
                'Install gobject-introspection data for GLib/Gio (gjs ships it) or pass the input as an argument instead.',
        );
    }
    const stream = new GioUnix.InputStream({ fd: 0, close_fd: false });
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const bytes = stream.read_bytes(CHUNK, null);
        if (bytes.get_size() === 0) break;
        const arr = bytes.toArray();
        chunks.push(arr);
        total += arr.length;
    }
    if (total === 0) return '';
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        buf.set(c, offset);
        offset += c.length;
    }
    return new TextDecoder().decode(buf);
}

/**
 * Read the whole of stdin as UTF-8. Works on Node and under the GJS bundle.
 *
 * Branches on the CAPABILITY (is `GioUnix.InputStream` usable?) rather than on
 * the RUNTIME (`isGjs()`). The runtime probe was wrong in CI: the GJS leg took
 * the Node branch and died with `ENOENT … read '0'`, while the identical
 * committed bundle piped correctly on a developer machine — so the probe's
 * answer is not stable across hosts, and a wrong answer here is fatal rather
 * than merely slower.
 *
 * Asking about the capability cannot be wrong-footed that way, and it degrades
 * in the one direction that has a working fallback: a host where GioUnix is
 * absent or fails to load (Homebrew's macOS gjs cannot even dlopen the library
 * its own typelibs reference) falls back to `readFileSync(0)`, which is right
 * on every real Node/Bun/Deno host and merely fails the same way it did before
 * on a GJS host that has no fd support either.
 */
export function readStdinText(): string {
    if (hasGioUnixInputStream()) {
        try {
            return readStdinTextGjs();
        } catch (err) {
            // A GioUnix that is present but unusable must not be fatal when a
            // fallback exists — but do not hide it either.
            console.warn(`[gjsify] GioUnix stdin read failed (${(err as Error).message}); falling back to fd 0.`);
        }
    }
    return readFileSync(0, 'utf-8');
}

/** Is `GioUnix.InputStream` present AND constructible on this host? */
function hasGioUnixInputStream(): boolean {
    try {
        const gi = (globalThis as unknown as { imports?: { gi?: { GioUnix?: GioUnixLike } } }).imports?.gi;
        return typeof gi?.GioUnix?.InputStream === 'function';
    } catch {
        return false;
    }
}

/**
 * Read stdin and split it into trimmed, non-empty lines. Accepts LF and CRLF
 * so a `git diff --name-only` piped from any host works unchanged.
 */
export function readStdinLines(): string[] {
    return splitStdinLines(readStdinText());
}

/** Pure line-splitter behind {@link readStdinLines} — unit-testable without a pipe. */
export function splitStdinLines(text: string): string[] {
    return text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
}
