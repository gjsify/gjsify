// SPDX-License-Identifier: MIT
//
// A READ-ONLY `effect/FileSystem` over `Gio.File`.
//
// WHY A SECOND FILESYSTEM AT ALL, when `@effect/platform-node-shared`'s
// `NodeFileSystem.layer` already runs on GJS through @gjsify/fs — and this repo's
// own integration suite proves it against 21 upstream conformance cases. Two
// reasons, and neither is "because we can":
//
//   1. THE MAIN LOOP. `@gjsify/fs`'s async calls are async in JavaScript; GIO's are
//      async in the GLib main loop. In a GTK application that is the difference
//      between a read that shares the loop with the frame clock and one that does
//      not, and it is the reason a GNOME app reaches for `Gio.File` in the first
//      place.
//   2. CANCELLATION HAS AN ADDRESSEE. `Effect.callback` hands the register function
//      an `AbortSignal` that fires when the fiber is interrupted, and GIO takes a
//      `Gio.Cancellable` on every async call. Wiring one to the other means
//      interrupting a fiber actually stops the in-flight I/O rather than only
//      abandoning its result — which is what closing a window mid-read should do,
//      and what no promise-based layer can offer.
//
// SCOPE, STATED PLAINLY. `FileSystem.makeNoop` fills the ~30 methods this does not
// implement with failures, so an unimplemented call reports itself instead of
// quietly returning a wrong answer. Implemented: access, exists, stat, readFile,
// readFileString, readDirectory, realPath, readLink. Everything that WRITES is
// deliberately absent — a showcase that could delete files is a showcase nobody
// runs twice, and the read surface is where the interesting mapping lives anyway.
//
// The `_tag` a failure carries comes from `errors.ts`, so consumer code reads the
// same `error.reason._tag === 'NotFound'` here as against the Node layer. That
// interchangeability is the point of the exercise; see `app.ts`, which asserts it
// by running the same program against both layers.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type GObject from 'gi://GObject?version=2.0';

import { Effect, Layer, Option } from 'effect';
import * as FileSystem from 'effect/FileSystem';
import type { PlatformError } from 'effect/PlatformError';

import { toPlatformError } from './errors.js';

/** Attributes one `query_info` has to fetch to fill Effect's `File.Info`. */
const INFO_ATTRIBUTES = [
    Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
    Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FILE_ATTRIBUTE_STANDARD_NAME,
    Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
    Gio.FILE_ATTRIBUTE_TIME_ACCESS,
    Gio.FILE_ATTRIBUTE_TIME_CREATED,
    Gio.FILE_ATTRIBUTE_UNIX_MODE,
    Gio.FILE_ATTRIBUTE_UNIX_INODE,
    Gio.FILE_ATTRIBUTE_UNIX_NLINK,
    Gio.FILE_ATTRIBUTE_UNIX_UID,
    Gio.FILE_ATTRIBUTE_UNIX_GID,
    Gio.FILE_ATTRIBUTE_UNIX_DEVICE,
    Gio.FILE_ATTRIBUTE_UNIX_BLOCK_SIZE,
    Gio.FILE_ATTRIBUTE_UNIX_BLOCKS,
    Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ,
    Gio.FILE_ATTRIBUTE_ACCESS_CAN_WRITE,
    Gio.FILE_ATTRIBUTE_ACCESS_CAN_EXECUTE,
].join(',');

/**
 * The one adapter every method below goes through: a GIO async pair
 * (`x_async`/`x_finish`) as an interruptible Effect.
 *
 * `Effect.callback`'s `signal` is what makes it interruptible for real. Aborting it
 * cancels the `Gio.Cancellable`, GIO completes the operation with
 * `Gio.IOErrorEnum.CANCELLED`, and the `finish` call throws it — at which point
 * nobody is listening, because `resume` after an interrupt is a no-op. So the
 * catch is not swallowing an error, it is declining to report one for work whose
 * requester is gone; anything else would be a defect raised in a dead fiber.
 *
 * `source` IS A PARAMETER, and it has to be. `g_task_is_valid(result, source)`
 * checks that the object finishing an operation is the object that started it, and
 * `Gio.File.new_for_path(p)` returns a NEW GFile every call — two files for the
 * same path are not the same source. Measured on the first run of this showcase:
 * a `finish` on a freshly constructed GFile logged
 * `g_file_real_enumerate_children_finish: assertion 'g_task_is_valid (res, file)'
 * failed`, returned `null`, and the failure surfaced one call later as
 * `can't access property "next_files_async", r is null` — a null-dereference that
 * names nothing about the actual mistake.
 */
export const gioAsync = <A, S extends GObject.Object>(options: {
    readonly method: string;
    readonly path: string;
    /** The object the operation is started ON, and finished on. */
    readonly source: S;
    readonly start: (source: S, cancellable: Gio.Cancellable, done: (result: Gio.AsyncResult) => void) => void;
    readonly finish: (source: S, result: Gio.AsyncResult) => A;
}): Effect.Effect<A, PlatformError> =>
    Effect.callback<A, PlatformError>((resume, signal) => {
        const cancellable = new Gio.Cancellable();
        const onAbort = () => cancellable.cancel();
        signal.addEventListener('abort', onAbort);

        options.start(options.source, cancellable, (result) => {
            signal.removeEventListener('abort', onAbort);
            if (cancellable.is_cancelled()) return;
            try {
                resume(Effect.succeed(options.finish(options.source, result)));
            } catch (error) {
                resume(Effect.fail(toPlatformError({ method: options.method, pathOrDescriptor: options.path, error })));
            }
        });
    });

const fileFor = (path: string): Gio.File => Gio.File.new_for_path(path);

const queryInfo = (path: string, method: string, followSymlinks = true): Effect.Effect<Gio.FileInfo, PlatformError> =>
    gioAsync({
        method,
        path,
        source: fileFor(path),
        start: (file, cancellable, done) =>
            file.query_info_async(
                INFO_ATTRIBUTES,
                followSymlinks ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (_source, result) => done(result),
            ),
        finish: (file, result) => file.query_info_finish(result),
    });

/** `GLib.DateTime | null` → the `Option<Date>` Effect's `File.Info` declares. */
const toDate = (value: GLib.DateTime | null): Option.Option<Date> =>
    value === null ? Option.none() : Option.some(new Date(value.to_unix() * 1000));

const toNumber = (value: number): Option.Option<number> => (value === 0 ? Option.none() : Option.some(value));

const FILE_TYPES: ReadonlyMap<number, FileSystem.File.Type> = new Map<number, FileSystem.File.Type>([
    [Gio.FileType.REGULAR, 'File'],
    [Gio.FileType.DIRECTORY, 'Directory'],
    [Gio.FileType.SYMBOLIC_LINK, 'SymbolicLink'],
    [Gio.FileType.SPECIAL, 'Unknown'],
    [Gio.FileType.SHORTCUT, 'Unknown'],
    [Gio.FileType.MOUNTABLE, 'Unknown'],
    [Gio.FileType.UNKNOWN, 'Unknown'],
]);

const toInfo = (info: Gio.FileInfo): FileSystem.File.Info => ({
    type: FILE_TYPES.get(info.get_file_type()) ?? 'Unknown',
    mtime: toDate(info.get_modification_date_time()),
    atime: toDate(info.get_access_date_time()),
    birthtime: toDate(info.get_creation_date_time()),
    dev: info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_DEVICE),
    ino: toNumber(Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_UNIX_INODE))),
    mode: info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE),
    nlink: toNumber(info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_NLINK)),
    uid: toNumber(info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_UID)),
    gid: toNumber(info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_GID)),
    rdev: Option.none(),
    size: FileSystem.Size(info.get_size()),
    blksize: Option.some(FileSystem.Size(info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_BLOCK_SIZE))),
    blocks: toNumber(Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_UNIX_BLOCKS))),
});

const readFile = (path: string): Effect.Effect<Uint8Array, PlatformError> =>
    gioAsync({
        method: 'readFile',
        path,
        source: fileFor(path),
        start: (file, cancellable, done) => file.load_contents_async(cancellable, (_source, result) => done(result)),
        finish: (file, result) => {
            // `load_contents_finish` returns `[ok, contents, etag]`; a `false` here
            // cannot happen without a GError having been thrown first, so the guard
            // exists to make the tuple destructuring total rather than to handle a
            // reachable case.
            const [ok, contents] = file.load_contents_finish(result);
            if (!ok) throw new Error('load_contents reported failure without raising');
            return contents;
        },
    });

const readDirectory = (path: string): Effect.Effect<Array<string>, PlatformError> =>
    Effect.gen(function* () {
        const enumerator = yield* gioAsync({
            method: 'readDirectory',
            path,
            source: fileFor(path),
            start: (file, cancellable, done) =>
                file.enumerate_children_async(
                    Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (_source, result) => done(result),
                ),
            finish: (file, result) => file.enumerate_children_finish(result),
        });

        // A batch at a time, because `next_files_async` is how GIO paginates and a
        // directory with 100k entries should not become one 100k-element callback.
        const names: Array<string> = [];
        for (;;) {
            const batch = yield* gioAsync({
                method: 'readDirectory',
                path,
                source: enumerator,
                start: (source, cancellable, done) =>
                    source.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => done(result)),
                finish: (source, result) => source.next_files_finish(result),
            });
            if (batch.length === 0) break;
            for (const info of batch) names.push(info.get_name());
        }
        enumerator.close(null);
        return names;
    });

/**
 * The read-only Gio implementation.
 *
 * `makeNoop` rather than `make`: `make` demands the complete interface, and a
 * complete interface built out of thirty `Effect.die('not implemented')` lines is
 * thirty lines of noise around the eight that mean something.
 */
export const makeGioFileSystem = (): FileSystem.FileSystem =>
    FileSystem.makeNoop({
        access: (path, options) =>
            Effect.gen(function* () {
                const info = yield* queryInfo(path, 'access');
                const denied = (what: string) =>
                    Effect.fail(
                        toPlatformError({
                            method: 'access',
                            pathOrDescriptor: path,
                            error: GLib.Error.new_literal(
                                Gio.io_error_quark(),
                                Gio.IOErrorEnum.PERMISSION_DENIED,
                                `not ${what}`,
                            ),
                        }),
                    );
                if (options?.readable === true && !info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ)) {
                    return yield* denied('readable');
                }
                if (options?.writable === true && !info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_ACCESS_CAN_WRITE)) {
                    return yield* denied('writable');
                }
                if (options?.ok === true && !info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_ACCESS_CAN_EXECUTE)) {
                    return yield* denied('executable');
                }
            }),

        // NOT inherited from `makeNoop`, which answers `false` for everything: a
        // stub that always says "no" is the one wrong answer this method can give
        // that no caller checks for.
        exists: (path) =>
            queryInfo(path, 'exists').pipe(
                Effect.as(true),
                Effect.catchTag('PlatformError', (error) =>
                    error.reason._tag === 'NotFound' ? Effect.succeed(false) : Effect.fail(error),
                ),
            ),

        stat: (path) => Effect.map(queryInfo(path, 'stat'), toInfo),

        readFile,
        readFileString: (path, encoding) =>
            Effect.map(readFile(path), (bytes) => new TextDecoder(encoding ?? 'utf-8').decode(bytes)),

        readDirectory,

        readLink: (path) =>
            Effect.flatMap(queryInfo(path, 'readLink', false), (info) => {
                const target = info.get_symlink_target();
                return target === null
                    ? Effect.fail(
                          toPlatformError({
                              method: 'readLink',
                              pathOrDescriptor: path,
                              error: GLib.Error.new_literal(
                                  Gio.io_error_quark(),
                                  Gio.IOErrorEnum.INVALID_ARGUMENT,
                                  'not a symbolic link',
                              ),
                          }),
                      )
                    : Effect.succeed(target);
            }),

        // Synchronous on purpose: `g_file_resolve_relative_path` and the parsed-name
        // round trip are pure string work with no I/O, so there is no async pair to
        // wrap and no cancellation to honour.
        realPath: (path) =>
            Effect.try({
                try: () => {
                    const resolved = fileFor(path).resolve_relative_path('.');
                    const result = resolved.get_path();
                    if (result === null) throw new Error('path does not resolve to a local file');
                    return result;
                },
                catch: (error) => toPlatformError({ method: 'realPath', pathOrDescriptor: path, error }),
            }),
    });

/** Provide the Gio-backed `FileSystem` to a program. */
export const layer: Layer.Layer<FileSystem.FileSystem> = Layer.sync(FileSystem.FileSystem)(makeGioFileSystem);
