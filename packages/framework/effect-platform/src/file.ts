// SPDX-License-Identifier: MIT
//
// `effect/FileSystem`'s `File` handle over GIO's streams.
//
// ONE POSITION, TWO CURSORS. Node's `a`/`a+` modes keep the WRITE position pinned
// to the end of the file while the READ position moves independently. A
// `Gio.FileIOStream` has one `Gio.Seekable` position shared by both directions, so
// the two cannot be represented directly. `GioFile` therefore keeps the read
// position itself and, in append mode, seeks to the end before every write. It does
// not seek back: `readBytes` seeks to the tracked read position before every read,
// so the two never observe each other's seeks. That is emulation, written out here
// rather than left as a surprise, and the upstream conformance suite asks about
// exactly it ("should maintain a read cursor in append mode").
//
// WHY `read_bytes_async` AND NOT `read_async`. `read_async` fills a caller-supplied
// buffer, and GJS marshals that as an out-parameter copy rather than writing into
// the `Uint8Array` the caller holds — so `file.read(buffer)` could not honour its
// contract. `read_bytes_async` returns a `GLib.Bytes`, which is copied into the
// caller's buffer here where the copy is visible.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { Effect, Option } from 'effect';
import type * as Scope from 'effect/Scope';
import * as FileSystem from 'effect/FileSystem';
import type { PlatformError } from 'effect/PlatformError';

import { toPlatformError } from './errors.js';
import { gioAsync } from './gio-async.js';

/** How a flag maps onto GIO: which streams it opens, and whether writes append. */
export interface OpenPlan {
    readonly readable: boolean;
    readonly writable: boolean;
    /** Writes go to the end of the file regardless of the read position. */
    readonly append: boolean;
}

const PLANS: Readonly<Record<FileSystem.OpenFlag, OpenPlan>> = {
    r: { readable: true, writable: false, append: false },
    'r+': { readable: true, writable: true, append: false },
    w: { readable: false, writable: true, append: false },
    'w+': { readable: true, writable: true, append: false },
    wx: { readable: false, writable: true, append: false },
    'wx+': { readable: true, writable: true, append: false },
    a: { readable: false, writable: true, append: true },
    'a+': { readable: true, writable: true, append: true },
    ax: { readable: false, writable: true, append: true },
    'ax+': { readable: true, writable: true, append: true },
};

/** The GIO streams behind one open file, plus what the flag asked for. */
interface Streams {
    readonly input: Gio.InputStream | null;
    readonly output: Gio.OutputStream | null;
    readonly seekable: Gio.Seekable;
    readonly closable: Gio.IOStream | Gio.InputStream | Gio.OutputStream;
    readonly plan: OpenPlan;
}

/**
 * Create the file if it is missing, then open it read-write; truncate on request.
 *
 * `w`/`w+` truncate, `a+` does not. Both need the create, because
 * `g_file_open_readwrite` refuses a path that does not exist while POSIX `w`, `w+`
 * and `a+` all create one — measured: without it, `a+` on a missing file answered
 * `NotFound` where Node creates the file.
 *
 * `g_file_create` raises `EXISTS` on an existing file, which here is the ordinary
 * case rather than a failure, so it is discarded.
 */
const openOrCreate = (
    file: Gio.File,
    path: string,
    plan: OpenPlan,
    truncate: boolean,
): Effect.Effect<Streams, PlatformError> =>
    Effect.gen(function* () {
        yield* Effect.ignore(
            gioAsync({
                method: 'open',
                path,
                source: file,
                start: (f, cancellable, done) =>
                    f.create_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                        done(result),
                    ),
                finish: (f, result) => f.create_finish(result),
            }),
        );
        const stream = yield* gioAsync({
            method: 'open',
            path,
            source: file,
            start: (f, cancellable, done) =>
                f.open_readwrite_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
            finish: (f, result) => f.open_readwrite_finish(result),
        });
        if (truncate) {
            yield* Effect.try({
                try: () => stream.truncate(0, null),
                catch: (error) => toPlatformError({ method: 'open', pathOrDescriptor: path, error }),
            });
        }
        return {
            input: plan.readable ? stream.get_input_stream() : null,
            output: stream.get_output_stream(),
            seekable: stream,
            closable: stream,
            plan,
        };
    });

const openStreams = (path: string, flag: FileSystem.OpenFlag): Effect.Effect<Streams, PlatformError> => {
    const plan = PLANS[flag];
    const file = Gio.File.new_for_path(path);
    const method = 'open';
    const io = (stream: Gio.FileIOStream): Streams => ({
        input: stream.get_input_stream(),
        output: stream.get_output_stream(),
        seekable: stream,
        closable: stream,
        plan,
    });

    switch (flag) {
        case 'r':
            return Effect.map(
                gioAsync({
                    method,
                    path,
                    source: file,
                    start: (f, cancellable, done) =>
                        f.read_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                    finish: (f, result) => f.read_finish(result),
                }),
                (stream) => ({ input: stream, output: null, seekable: stream, closable: stream, plan }),
            );
        case 'r+':
            return Effect.map(
                gioAsync({
                    method,
                    path,
                    source: file,
                    start: (f, cancellable, done) =>
                        f.open_readwrite_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                    finish: (f, result) => f.open_readwrite_finish(result),
                }),
                io,
            );
        case 'w':
        case 'w+':
            // NOT `g_file_replace*`, which is GIO's ATOMIC-REPLACE: it writes to a
            // temporary file and moves it into place on close, so until then the
            // path still holds the OLD content. POSIX `w`/`w+` truncate the file in
            // place and every write is immediately visible at the path — which is
            // what `effect/FileSystem`'s `File` is modelled on and what the upstream
            // conformance case "should track the cursor position when writing"
            // reads back mid-stream. Measured: with `replace_readwrite_async` that
            // case saw an empty file after three writes.
            return openOrCreate(file, path, plan, true);
        case 'wx':
        case 'ax':
            return Effect.map(
                gioAsync({
                    method,
                    path,
                    source: file,
                    start: (f, cancellable, done) =>
                        f.create_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                            done(result),
                        ),
                    finish: (f, result) => f.create_finish(result),
                }),
                (stream) => ({ input: null, output: stream, seekable: stream, closable: stream, plan }),
            );
        case 'wx+':
        case 'ax+':
            return Effect.map(
                gioAsync({
                    method,
                    path,
                    source: file,
                    start: (f, cancellable, done) =>
                        f.create_readwrite_async(
                            Gio.FileCreateFlags.NONE,
                            GLib.PRIORITY_DEFAULT,
                            cancellable,
                            (_s, result) => done(result),
                        ),
                    finish: (f, result) => f.create_readwrite_finish(result),
                }),
                io,
            );
        case 'a':
            return Effect.map(
                gioAsync({
                    method,
                    path,
                    source: file,
                    start: (f, cancellable, done) =>
                        f.append_to_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                            done(result),
                        ),
                    finish: (f, result) => f.append_to_finish(result),
                }),
                (stream) => ({ input: null, output: stream, seekable: stream, closable: stream, plan }),
            );
        case 'a+':
            // `g_file_append_to` gives no input stream, so `a+` opens read-write and
            // the append behaviour is this module's own (see the header). It must
            // CREATE a missing file, which `g_file_open_readwrite` does not.
            return openOrCreate(file, path, plan, false);
    }
};

/** Build the `File` handle Effect's `open` promises. */
export const makeFile = (path: string, streams: Streams, stat: Effect.Effect<FileSystem.File.Info, PlatformError>) => {
    /** The READ position. In append mode it is independent of where writes land. */
    let cursor = 0;

    const fail = (method: string) => (error: unknown) =>
        toPlatformError({ method, pathOrDescriptor: path, error, module: 'FileSystem' });

    const seekTo = (offset: number, from: GLib.SeekType) =>
        Effect.try({
            try: () => {
                streams.seekable.seek(offset, from, null);
                return streams.seekable.tell();
            },
            catch: fail('seek'),
        });

    const readBytes = (size: number): Effect.Effect<Uint8Array, PlatformError> => {
        const input = streams.input;
        if (input === null) {
            return Effect.fail(
                toPlatformError({
                    method: 'read',
                    pathOrDescriptor: path,
                    module: 'FileSystem',
                    error: GLib.Error.new_literal(
                        Gio.io_error_quark(),
                        Gio.IOErrorEnum.PERMISSION_DENIED,
                        'file was not opened for reading',
                    ),
                }),
            );
        }
        return Effect.gen(function* () {
            yield* seekTo(cursor, GLib.SeekType.SET);
            const bytes = yield* gioAsync({
                method: 'read',
                path,
                source: input,
                start: (source, cancellable, done) =>
                    source.read_bytes_async(size, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                finish: (source, result) => source.read_bytes_finish(result),
            });
            const data = bytes.toArray();
            cursor += data.length;
            return data;
        });
    };

    const writeBytes = (buffer: Uint8Array): Effect.Effect<number, PlatformError> => {
        const output = streams.output;
        if (output === null) {
            return Effect.fail(
                toPlatformError({
                    method: 'write',
                    pathOrDescriptor: path,
                    module: 'FileSystem',
                    error: GLib.Error.new_literal(
                        Gio.io_error_quark(),
                        Gio.IOErrorEnum.PERMISSION_DENIED,
                        'file was not opened for writing',
                    ),
                }),
            );
        }
        return Effect.gen(function* () {
            // Append mode pins writes to the end and leaves the read cursor where it
            // was; every other mode writes at the shared position, which for a
            // read-write stream IS the read cursor.
            yield* seekTo(
                streams.plan.append ? 0 : cursor,
                streams.plan.append ? GLib.SeekType.END : GLib.SeekType.SET,
            );
            const written = yield* gioAsync({
                method: 'write',
                path,
                source: output,
                start: (source, cancellable, done) =>
                    source.write_bytes_async(new GLib.Bytes(buffer), GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                        done(result),
                    ),
                finish: (source, result) => source.write_bytes_finish(result),
            });
            // FLUSH, EVERY TIME. A `GFileOutputStream` buffers; a POSIX descriptor,
            // which is what `effect/FileSystem`'s `File` is modelled on, does not. So
            // without this a write is invisible to anything that opens the path
            // again — measured against the upstream conformance case "should track
            // the cursor position when writing", where three writes were followed by
            // a `readFileString` that came back empty.
            yield* gioAsync({
                method: 'write',
                path,
                source: output,
                start: (source, cancellable, done) =>
                    source.flush_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                finish: (source, result) => source.flush_finish(result),
            });
            if (!streams.plan.append) cursor += written;
            return written;
        });
    };

    const handle: FileSystem.File = {
        [FileSystem.FileTypeId]: FileSystem.FileTypeId,
        stat,
        seek: (offset, from) =>
            Effect.sync(() => {
                cursor = from === 'start' ? Number(offset) : cursor + Number(offset);
                return FileSystem.Size(cursor);
            }),
        sync: Effect.gen(function* () {
            const output = streams.output;
            if (output === null) return;
            yield* gioAsync({
                method: 'sync',
                path,
                source: output,
                start: (source, cancellable, done) =>
                    source.flush_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                finish: (source, result) => source.flush_finish(result),
            });
        }),
        read: (buffer) =>
            Effect.map(readBytes(buffer.length), (data) => {
                buffer.set(data);
                return FileSystem.Size(data.length);
            }),
        readAlloc: (size) =>
            Effect.map(readBytes(Number(size)), (data) => (data.length === 0 ? Option.none() : Option.some(data))),
        truncate: (length) =>
            Effect.gen(function* () {
                const to = length === undefined ? 0 : Number(length);
                yield* Effect.try({
                    try: () => streams.seekable.truncate(to, null),
                    catch: fail('truncate'),
                });
                // Node clamps a cursor that now points past the end; one that does not
                // is left alone. The conformance suite asks about both.
                if (cursor > to) cursor = to;
            }),
        write: (buffer) => Effect.map(writeBytes(buffer), FileSystem.Size),
        writeAll: (buffer) =>
            Effect.gen(function* () {
                let written = 0;
                while (written < buffer.length) {
                    written += yield* writeBytes(buffer.subarray(written));
                }
            }),
    };
    return handle;
};

/** Open `path` and close its streams when the scope closes. */
export const openFile = (
    path: string,
    options: { readonly flag?: FileSystem.OpenFlag | undefined; readonly mode?: number | undefined } | undefined,
    stat: (path: string) => Effect.Effect<FileSystem.File.Info, PlatformError>,
): Effect.Effect<FileSystem.File, PlatformError, Scope.Scope> =>
    Effect.acquireRelease(
        Effect.map(openStreams(path, options?.flag ?? 'r'), (streams) => ({
            streams,
            file: makeFile(path, streams, stat(path)),
        })),
        // `g_io_stream_close` is `throws="1"`, and this runs during scope release: a
        // throw there becomes a defect that REPLACES whatever the body was reporting.
        ({ streams }) => Effect.ignore(Effect.try(() => streams.closable.close(null))),
    ).pipe(Effect.map(({ file }) => file));
