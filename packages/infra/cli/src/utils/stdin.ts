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
function readStdinTextGioUnix(): string {
    const gi = giNamespace() as { GioUnix?: GioUnixLike } | undefined;
    const GioUnix = gi?.GioUnix;
    if (typeof GioUnix?.InputStream !== 'function') {
        throw new Error('GioUnix.InputStream is unavailable');
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

/** Minimal structural view of the `Gio` bits the second GJS reader uses. */
interface GioLike {
    File: { new_for_path(path: string): { load_contents(cancellable: null): [boolean, Uint8Array] } };
}

/**
 * Read stdin under GJS through Gio ALONE, without GioUnix.
 *
 * `/dev/stdin` is fd 0 by another name, and `Gio` is present in every bundle
 * that can reach this code at all. This exists because the GioUnix route has
 * been observed to be unavailable on a host where it should have worked, and a
 * second independent mechanism is cheaper than another round of guessing.
 */
function readStdinTextGioFile(): string {
    const gi = giNamespace() as { Gio?: GioLike } | undefined;
    const Gio = gi?.Gio;
    if (!Gio?.File) throw new Error('Gio.File is unavailable');
    const [ok, contents] = Gio.File.new_for_path('/dev/stdin').load_contents(null);
    if (!ok) throw new Error('Gio.File.load_contents("/dev/stdin") returned false');
    return new TextDecoder().decode(contents);
}

/** The GJS `imports.gi` namespace, or `undefined` when not running on GJS. */
function giNamespace(): Record<string, unknown> | undefined {
    try {
        return (globalThis as unknown as { imports?: { gi?: Record<string, unknown> } }).imports?.gi;
    } catch {
        return undefined;
    }
}

/**
 * Read the whole of stdin as UTF-8. Works on Node and under the GJS bundle.
 *
 * Branches on WHICH RUNTIME CAN WORK, not on which capability is present. The
 * distinction matters because the two branches are not interchangeable:
 * `readFileSync(0)` is correct on Node/Bun/Deno and can NEVER work under GJS —
 * `@gjsify/fs` has no numeric-fd path, so the `0` is coerced to a relative
 * PATH and the call opens `./0`. A GJS run that reaches that line is already
 * lost, so using it as GJS's fallback only converts a clear failure into
 * `ENOENT … read '0'`, which is what a capability probe returning a false
 * negative did.
 *
 * So: the presence of `imports.gi` decides. On GJS both GJS readers are tried
 * and a failure THROWS with what was attempted; the Node reader is never
 * reached. Off GJS there is no gi namespace and `readFileSync(0)` is the only
 * and correct answer.
 */
export function readStdinText(): string {
    if (!giNamespace()) return readFileSync(0, 'utf-8');

    const attempts: string[] = [];
    for (const read of [readStdinTextGioUnix, readStdinTextGioFile]) {
        try {
            return read();
        } catch (err) {
            attempts.push(`${read.name}: ${(err as Error).message}`);
        }
    }
    throw new Error(
        `gjsify: cannot read stdin under GJS. Tried ${attempts.join('; ')}. ` +
            'Pass the input as an argument instead (e.g. --base <ref> rather than --changed-from-stdin).',
    );
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
