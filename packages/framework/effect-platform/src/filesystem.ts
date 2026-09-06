// SPDX-License-Identifier: MIT
//
// `effect/FileSystem` over `Gio.File`.
//
// WHY A SECOND FILESYSTEM AT ALL, when `@effect/platform-node-shared`'s
// `NodeFileSystem.layer` already runs on GJS through @gjsify/fs — and this repo's
// integration suite holds it there. Two reasons, and neither is "because we can":
//
//   1. THE MAIN LOOP. `@gjsify/fs`'s async calls are async in JavaScript; GIO's are
//      async in the GLib main loop. In a GTK application that is the difference
//      between a read that shares the loop with the frame clock and one that does
//      not, and it is why a GNOME app reaches for `Gio.File` in the first place.
//   2. CANCELLATION HAS AN ADDRESSEE. `Effect.callback` hands the register function
//      an `AbortSignal`; every GIO async call takes a `Gio.Cancellable`. Wiring one
//      to the other means interrupting a fiber STOPS the in-flight I/O rather than
//      only abandoning its result, which no promise-based layer can offer.
//
// WHAT IS AND IS NOT HERE. Reading, writing, directories, temp files, attributes,
// rename, copy, symlink and `watch` are implemented over GIO. Three methods raise a
// DEFECT because GIO has no equivalent: `realPath` (no symlink-resolving
// canonicalizer), `link` (no hard-link call) and `glob` (no matcher). Effect derives
// `exists` from `access`, `readFileString` from `readFile`, and `stream`/`sink` from
// `open`, so those four come out right for free.
//
// A DEFECT, NOT A FAILURE, and that is the whole reason this file spells out the
// complete interface instead of taking `FileSystem.makeNoop`'s defaults. `makeNoop`
// answers `remove()` with `Effect.void`, a SILENT SUCCESS: a caller deleting a file
// through it would be told it worked. Its other defaults fail with `NotFound`, which
// is worse than useless here — it is the tag a real missing file carries, so
// `Effect.catchTag` on it swallows "this layer cannot do that" as "the file is not
// there". The absence is a property of the LAYER, not of the path, so it is
// unrecoverable by definition.
//
// The `_tag` a failure carries comes from `errors.ts`, so consumer code reads the
// same `error.reason._tag === 'NotFound'` here as against the Node layer. That
// interchangeability is the point, and `tests/integration/effect` holds it: upstream's
// own layer-parameterised conformance suite runs over both layers, and both pass all
// of it.
//
// `mode` IS IGNORED by `open`, `writeFile` and `makeDirectory`. GIO's creation calls
// take `GFileCreateFlags`, which carries `PRIVATE` and `REPLACE_DESTINATION` and no
// permission bits; setting a mode means a `chmod` after the fact, which is not the
// same thing as creating with it and would race. Callers that need a mode should
// call `chmod`.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { Effect, Layer, Option, Result, type Scope, Stream } from 'effect';
import * as Queue from 'effect/Queue';
import * as FileSystem from 'effect/FileSystem';
import type { PlatformError } from 'effect/PlatformError';

import { isIoError, toPlatformError } from './errors.js';
import { badArgument } from 'effect/PlatformError';
import { gioAsync } from './gio-async.js';
import { openFile } from './file.js';

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
    Effect.scoped(readDirectoryScoped(path));

const readDirectoryScoped = (path: string): Effect.Effect<Array<string>, PlatformError, Scope.Scope> =>
    Effect.gen(function* () {
        const enumerator = yield* openEnumerator(path);
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
        return names;
    });

/**
 * The enumerator as a SCOPED resource.
 *
 * `g_file_enumerator_close` is `throws="1"`, and the walk above can be interrupted
 * between batches — a bare `close()` at the end of the loop is therefore both an
 * unguarded throw and a leak on the path that does not reach it.
 */
const openEnumerator = (path: string): Effect.Effect<Gio.FileEnumerator, PlatformError, Scope.Scope> =>
    Effect.acquireRelease(
        gioAsync({
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
        }),
        // Release must not fail: a close that throws during scope teardown becomes a
        // defect, and it would replace whatever the body was already reporting.
        (enumerator) => Effect.ignore(Effect.try(() => enumerator.close(null))),
    );

/** `g_path_get_dirname`, needed by the scoped temp-file finalizer. */
const dirnameOf = (path: string): string => GLib.path_get_dirname(path);

/** One temp DIRECTORY per temp file, so removing the directory removes the file. */
const makeTempDirectory = (options?: {
    readonly directory?: string | undefined;
    readonly prefix?: string | undefined;
}): Effect.Effect<string, PlatformError> =>
    Effect.try({
        try: () => {
            const template = `${options?.prefix ?? 'effect-platform-'}XXXXXX`;
            if (options?.directory === undefined) return GLib.Dir.make_tmp(template);
            // `g_dir_make_tmp` always uses $TMPDIR, so honouring `directory` means
            // building the name here. `g_file_make_directory` and NOT
            // `..._with_parents`: the latter SUCCEEDS on an existing directory, so two
            // callers could be handed the same one and the first scoped finalizer
            // would then delete the other's tree. Failing on EXISTS is what makes the
            // retry mean something.
            for (let attempt = 0; attempt < 64; attempt++) {
                const dir = GLib.build_filenamev([
                    options.directory,
                    template.replace('XXXXXX', String(GLib.random_int())),
                ]);
                try {
                    Gio.File.new_for_path(dir).make_directory(null);
                    return dir;
                } catch (error) {
                    if (!isIoError(error) || error.code !== Gio.IOErrorEnum.EXISTS) throw error;
                }
            }
            throw new Error('no unused temporary directory name after 64 attempts');
        },
        catch: (error) => toPlatformError({ method: 'makeTempDirectory', error }),
    });

const makeTempFile = (options?: {
    readonly directory?: string | undefined;
    readonly prefix?: string | undefined;
    readonly suffix?: string | undefined;
}): Effect.Effect<string, PlatformError> =>
    Effect.flatMap(makeTempDirectory({ directory: options?.directory, prefix: options?.prefix }), (dir) =>
        Effect.try({
            try: () => {
                const name = `${options?.prefix ?? 'effect-platform-'}${GLib.random_int()}${options?.suffix ?? ''}`;
                const path = GLib.build_filenamev([dir, name]);
                Gio.File.new_for_path(path).create(Gio.FileCreateFlags.NONE, null).close(null);
                return path;
            },
            catch: (error) => toPlatformError({ method: 'makeTempFile', error }),
        }),
    );

/** Delete one entry, or a whole tree when `recursive`. */
const remove = (
    path: string,
    options?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
): Effect.Effect<void, PlatformError> =>
    Effect.gen(function* () {
        if (options?.recursive === true) {
            const info = yield* Effect.result(queryInfo(path, 'remove', false));
            if (Result.isSuccess(info) && info.success.get_file_type() === Gio.FileType.DIRECTORY) {
                for (const name of yield* readDirectory(path)) {
                    yield* remove(GLib.build_filenamev([path, name]), options);
                }
            }
        }
        const deleted = yield* Effect.result(
            Effect.asVoid(
                gioAsync({
                    method: 'remove',
                    path,
                    source: fileFor(path),
                    start: (file, cancellable, done) =>
                        file.delete_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) => done(result)),
                    finish: (file, result) => file.delete_finish(result),
                }),
            ),
        );
        if (Result.isFailure(deleted)) {
            const missing = deleted.failure.reason._tag === 'NotFound';
            if (!(missing && (options?.force === true || options?.recursive === true))) {
                return yield* Effect.fail(deleted.failure);
            }
        }
    });

const copy = (
    from: string,
    to: string,
    options:
        | { readonly overwrite?: boolean | undefined; readonly preserveTimestamps?: boolean | undefined }
        | undefined,
    method: string,
): Effect.Effect<void, PlatformError> =>
    Effect.gen(function* () {
        // A DIRECTORY IS A TREE WALK. `g_file_copy` refuses one with `WOULD_RECURSE`,
        // while `effect/FileSystem`'s `copy` is contractually recursive and the Node
        // layer passes `recursive: true`. Without this a caller swapping the layers
        // gets a failure where it had a copy.
        // Copying a tree INTO itself would descend into the destination this call
        // just made and recurse to PATH_MAX. Node's `fs.cp` refuses it outright
        // (`ERR_FS_CP_EINVAL`) and so does this.
        if (to === from || to.startsWith(`${from}${GLib.DIR_SEPARATOR_S}`)) {
            return yield* Effect.fail(
                badArgument({
                    module: 'FileSystem',
                    method,
                    description: 'cannot copy a path into itself',
                }),
            );
        }
        // NOFOLLOW, so a directory SYMLINK is a symlink to copy and not a tree to
        // walk. Without it `get_file_type()` says `SymbolicLink`, `copyOne` follows
        // it, and `g_file_copy` refuses the directory behind it with WOULD_RECURSE —
        // so any tree containing one failed.
        const info = yield* queryInfo(from, method, false);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            yield* Effect.try({
                try: () => {
                    fileFor(to).make_directory_with_parents(null);
                },
                catch: (error) => toPlatformError({ method, pathOrDescriptor: to, error }),
            }).pipe(
                // An existing destination directory is the ordinary case when copying
                // INTO a tree that already partly exists; a real failure resurfaces on
                // the first child copy, which reports the child's own path.
                Effect.catchTag('PlatformError', (error) =>
                    error.reason._tag === 'AlreadyExists' ? Effect.void : Effect.fail(error),
                ),
            );
            for (const name of yield* readDirectory(from)) {
                yield* copy(GLib.build_filenamev([from, name]), GLib.build_filenamev([to, name]), options, method);
            }
            return;
        }
        yield* copyOne(from, to, options, method);
    });

const copyOne = (
    from: string,
    to: string,
    options:
        | { readonly overwrite?: boolean | undefined; readonly preserveTimestamps?: boolean | undefined }
        | undefined,
    method: string,
): Effect.Effect<void, PlatformError> =>
    Effect.try({
        try: () => {
            let flags = Gio.FileCopyFlags.NONE;
            // `overwrite` DEFAULTS TO FALSE, as it does in the Node layer
            // (`force: options?.overwrite ?? false`). An earlier version read
            // `!== false`, which turned an unqualified `copy` into a clobber — and
            // the conformance case only passes `{ overwrite: false }`, so the default
            // was untested in both directions.
            if (options?.overwrite === true) flags |= Gio.FileCopyFlags.OVERWRITE;
            // `TARGET_DEFAULT_MODIFIED_TIME` off is what "preserve timestamps" means;
            // `ALL_METADATA` would also carry uid, gid, mode and xattrs, which is more
            // than the option asks for.
            if (options?.preserveTimestamps !== true) flags |= Gio.FileCopyFlags.TARGET_DEFAULT_MODIFIED_TIME;
            // A symlink is copied AS a symlink, which is Node's default
            // (`dereference: false`) and the only reading under which the tree walk
            // above terminates.
            flags |= Gio.FileCopyFlags.NOFOLLOW_SYMLINKS;
            fileFor(from).copy(fileFor(to), flags, null, null);
        },
        // The path Effect reports is the SOURCE, which is what the conformance suite
        // asserts and what a `g_file_copy` GError names in its message.
        catch: (error) => toPlatformError({ method, pathOrDescriptor: from, error }),
    });

/** `Gio.FileMonitor` as a `Stream` of Effect's own `WatchEvent`s. */
const watch = (path: string): Stream.Stream<FileSystem.WatchEvent, PlatformError> =>
    Stream.callback<FileSystem.WatchEvent, PlatformError>((queue) =>
        Effect.gen(function* () {
            const monitor = yield* Effect.try({
                try: () => fileFor(path).monitor(Gio.FileMonitorFlags.WATCH_MOVES, null),
                catch: (error) => toPlatformError({ method: 'watch', pathOrDescriptor: path, error }),
            });
            const handler = monitor.connect('changed', (_m, file, _other, event) => {
                const target = file.get_path() ?? path;
                const mapped = WATCH_EVENTS.get(event);
                if (mapped !== undefined) Queue.offerUnsafe(queue, mapped(target));
            });
            yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                    monitor.disconnect(handler);
                    monitor.cancel();
                }),
            );
        }),
    );

/**
 * The GIO events Effect's three `WatchEvent` shapes can carry.
 *
 * What is DROPPED, and one of them matters: `PRE_UNMOUNT`, `UNMOUNTED` and
 * `CHANGES_DONE_HINT` have no counterpart, and neither does `RENAMED` — which
 * `WATCH_MOVES` is what PRODUCES. Asking for `WATCH_MOVES` replaces a
 * delete-then-create pair with one `RENAMED` for an in-directory rename, so a rename
 * inside the watched directory currently surfaces as nothing at all. Reporting it as
 * a `Remove` of the old name plus a `Create` of the new one needs the event's second
 * file argument, which is why it is named here rather than quietly approximated.
 */
const WATCH_EVENTS: ReadonlyMap<number, (path: string) => FileSystem.WatchEvent> = new Map<
    number,
    (path: string) => FileSystem.WatchEvent
>([
    [Gio.FileMonitorEvent.CREATED, (path) => ({ _tag: 'Create', path })],
    [Gio.FileMonitorEvent.CHANGED, (path) => ({ _tag: 'Update', path })],
    [Gio.FileMonitorEvent.ATTRIBUTE_CHANGED, (path) => ({ _tag: 'Update', path })],
    [Gio.FileMonitorEvent.DELETED, (path) => ({ _tag: 'Remove', path })],
    [Gio.FileMonitorEvent.MOVED_OUT, (path) => ({ _tag: 'Remove', path })],
    [Gio.FileMonitorEvent.MOVED_IN, (path) => ({ _tag: 'Create', path })],
]);

/** Read-modify-write one `Gio.FileInfo` attribute set. */
const setAttribute = (
    path: string,
    method: string,
    probe: string,
    mutate: (info: Gio.FileInfo) => void,
): Effect.Effect<void, PlatformError> =>
    Effect.gen(function* () {
        const info = yield* gioAsync({
            method,
            path,
            source: fileFor(path),
            start: (file, cancellable, done) =>
                file.query_info_async(probe, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_s, r) =>
                    done(r),
                ),
            finish: (file, result) => file.query_info_finish(result),
        });
        mutate(info);
        yield* gioAsync({
            method,
            path,
            source: fileFor(path),
            start: (file, cancellable, done) =>
                file.set_attributes_async(
                    info,
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (_s, r) => done(r),
                ),
            finish: (file, result) => file.set_attributes_finish(result)[1],
        });
    });

/**
 * A method this layer does not provide.
 *
 * `Effect.die` and not `Effect.fail`: the absence is a property of the LAYER, not
 * of the path it was handed, so it is unrecoverable by definition. Failing would
 * put it in the same channel as a missing file and invite a `catchTag` to hide it.
 */
const unimplemented = (method: string) =>
    Effect.die(new Error(`@gjsify/effect-platform: FileSystem.${method} has no GIO equivalent`));

/**
 * The Gio implementation.
 *
 * `FileSystem.make` and not `makeNoop`: `make` demands the COMPLETE interface, so a
 * method added upstream cannot arrive here as a silent default. It derives `exists`
 * from `access`, `readFileString` from `readFile`, and `stream`/`sink` from `open`,
 * all four of which are implemented — so those derivations are correct here for
 * free rather than inheriting a stub.
 */
export const makeGioFileSystem = (): FileSystem.FileSystem =>
    FileSystem.make({
        access: (path, options) =>
            Effect.gen(function* () {
                // `query_info` succeeding IS the existence check, which is what
                // `ok` (POSIX `F_OK`) asks for — so it needs no branch of its own.
                // An earlier version mapped `ok` onto `ACCESS_CAN_EXECUTE`, which
                // is `X_OK`: it would have refused every readable non-executable
                // file, and `exists` is derived from this method.
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
            }),

        stat: (path) => Effect.map(queryInfo(path, 'stat'), toInfo),

        readFile,

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

        // The three GIO simply does not have. `realPath`: no symlink-resolving
        // canonicalizer — `g_file_resolve_relative_path` and `g_canonicalize_filename`
        // are both pure string work, so one built on either returns a plausible answer
        // for a path whose components are links, the quiet wrong answer this layer
        // exists to avoid. `link`: `g_file_make_symbolic_link` has no hard-link
        // sibling. `glob`: no matcher.
        realPath: () => unimplemented('realPath'),

        // GIO exposes no hard-link call at all (`g_file_make_symbolic_link` has no
        // hard-link sibling), and no glob matcher.
        link: () => unimplemented('link'),
        glob: () => unimplemented('glob'),

        open: (path, options) => openFile(path, options, (p) => Effect.map(queryInfo(p, 'stat'), toInfo)),

        makeDirectory: (path, options) =>
            options?.recursive === true
                ? Effect.try({
                      // `g_file_make_directory_with_parents` has no async form.
                      try: () => {
                          fileFor(path).make_directory_with_parents(null);
                      },
                      catch: (error) => toPlatformError({ method: 'makeDirectory', pathOrDescriptor: path, error }),
                  })
                : Effect.asVoid(
                      gioAsync({
                          method: 'makeDirectory',
                          path,
                          source: fileFor(path),
                          start: (file, cancellable, done) =>
                              file.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                                  done(result),
                              ),
                          finish: (file, result) => file.make_directory_finish(result),
                      }),
                  ),

        remove: (path, options) => remove(path, options),

        // `g_file_move`/`g_file_copy` DO have async forms, and this layer does not
        // use them: `@girs` types their progress and ready parameters as
        // `GObject.Closure`, which is the GIR's shape for a callback with user data
        // and is not constructible from GJS in any reasonable way.
        //
        // SO THESE TWO ARE NOT INTERRUPTIBLE, and the earlier wording here claimed
        // otherwise. The synchronous call would take a `Gio.Cancellable`, but there
        // is nothing to cancel it FROM: `Effect.try` hands no `AbortSignal`, and the
        // call blocks the fiber for its whole duration, so an interrupt cannot be
        // delivered until after it returns. Every other method in this layer goes
        // through `gioAsync` and is interruptible; these two are the exception.
        rename: (from, to) =>
            Effect.try({
                try: () => {
                    fileFor(from).move(fileFor(to), Gio.FileCopyFlags.OVERWRITE, null, null);
                },
                catch: (error) => toPlatformError({ method: 'rename', pathOrDescriptor: from, error }),
            }),

        copy: (from, to, options) => copy(from, to, options, 'copy'),
        copyFile: (from, to) => copy(from, to, undefined, 'copyFile'),

        symlink: (target, path) =>
            Effect.asVoid(
                gioAsync({
                    method: 'symlink',
                    path,
                    source: fileFor(path),
                    start: (file, cancellable, done) =>
                        file.make_symbolic_link_async(target, GLib.PRIORITY_DEFAULT, cancellable, (_s, result) =>
                            done(result),
                        ),
                    finish: (file, result) => file.make_symbolic_link_finish(result),
                }),
            ),

        truncate: (path, length) =>
            Effect.scoped(
                Effect.flatMap(
                    openFile(path, { flag: 'r+' }, (p) => Effect.map(queryInfo(p, 'stat'), toInfo)),
                    (file) => file.truncate(length),
                ),
            ),

        chmod: (path, mode) =>
            setAttribute(path, 'chmod', Gio.FILE_ATTRIBUTE_UNIX_MODE, (info) => {
                info.set_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE, mode);
            }),

        chown: (path, uid, gid) =>
            setAttribute(path, 'chown', Gio.FILE_ATTRIBUTE_UNIX_UID, (info) => {
                info.set_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_UID, uid);
                info.set_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_GID, gid);
            }),

        utimes: (path, atime, mtime) =>
            setAttribute(path, 'utimes', Gio.FILE_ATTRIBUTE_TIME_MODIFIED, (info) => {
                const seconds = (value: Date | number) =>
                    BigInt(Math.floor(Number(value instanceof Date ? value.getTime() : value) / 1000));
                info.set_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_ACCESS, seconds(atime));
                info.set_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED, seconds(mtime));
            }),

        makeTempDirectory: (options) => makeTempDirectory(options),
        makeTempDirectoryScoped: (options) =>
            Effect.acquireRelease(makeTempDirectory(options), (dir) => Effect.ignore(remove(dir, { recursive: true }))),
        makeTempFile: (options) => makeTempFile(options),
        makeTempFileScoped: (options) =>
            Effect.acquireRelease(makeTempFile(options), (file) =>
                // Node's implementation removes the whole directory the temp file was
                // put in, and the conformance suite asserts that; `makeTempFile` makes
                // one directory per file for exactly that reason.
                Effect.ignore(remove(dirnameOf(file), { recursive: true })),
            ),

        writeFile: (path, data, options) =>
            Effect.scoped(
                Effect.flatMap(
                    openFile(path, { flag: options?.flag ?? 'w' }, (p) => Effect.map(queryInfo(p, 'stat'), toInfo)),
                    (file) => file.writeAll(data),
                ),
            ).pipe(
                // `writeFile` is built out of `open` + `writeAll`, and those name
                // themselves in the error they raise. The CONTRACT says the method a
                // caller asked for, so the label is restored here — the conformance
                // case "writeFile with r rejects writes" reads it.
                Effect.mapError((error) =>
                    error.reason._tag === 'BadArgument'
                        ? error
                        : toPlatformError({
                              method: 'writeFile',
                              pathOrDescriptor: path,
                              error: error.reason.cause ?? error,
                          }),
                ),
            ),

        watch: (path) => watch(path),
    });

/** Provide the Gio-backed `FileSystem` to a program. */
export const layer: Layer.Layer<FileSystem.FileSystem> = Layer.sync(FileSystem.FileSystem)(makeGioFileSystem);
