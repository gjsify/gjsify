// SPDX-License-Identifier: MIT
// "Which library could not be loaded, and what is it missing?" — asked once,
// here, for every typelib-backed native bridge (`@gjsify/rolldown-native`,
// `tls-native`, `http2-native`, `terminal-native`, `webrtc-native`, …).
//
// A bridge whose typelib resolves but whose shared library cannot be opened
// fails at the first class access with GJS's "Unsupported type void, deriving
// from fundamental void", which names nothing. The loader DID know the answer
// (`Library not loaded: @rpath/libjson-glib-1.0.0.dylib`), but it is lost twice
// before it reaches JavaScript:
//
//  1. `GModule.Module.open` is not introspectable, so JS cannot dlopen a path
//     and read the error itself.
//  2. girepository tries every library-path directory and then the bare leaf
//     name, and reports `g_module_error()` of its LAST attempt. The leaf lookup
//     fails with "no such file" in the cwd and the system dirs, so its warning
//     describes the fallback rather than the file that was found and refused.
//
// The measured way around both: load a copy of the namespace's typelib into a
// PRIVATE repository with its shared-library entry rewritten to the absolute
// path of the colocated library. girepository opens an absolute entry directly,
// with no fallback, so the error `GModule.module_error()` then holds is the
// loader's own for exactly that file.

/** What {@link probeNativeLibrary} measured about a library that would not load. */
export interface NativeLibraryFailure {
    /** The GI namespace whose library failed, e.g. `GjsifyRolldown`. */
    namespace: string;
    /** The library file that failed — absolute when it sits beside its typelib, else the typelib's leaf. */
    library: string;
    /** The host loader's own message (dlerror / dyld / LoadLibrary), or a fixed text when none was readable. */
    reason: string;
    /** Leaf name of the dependency the loader could not find, when its message names one. */
    missingDependency?: string;
}

interface RegisteredInfoView {
    get_type_init_function_name?(): string | null;
    get_symbol?(): string | null;
    get_typelib(): { symbol(name: string): [boolean, unknown] };
}

interface RepositoryView {
    get_typelib_path(namespace: string): string | null;
    get_shared_libraries(namespace: string): string[] | null;
    get_n_infos(namespace: string): number;
    get_info(namespace: string, index: number): RegisteredInfoView;
    load_typelib(typelib: unknown, flags: number): string;
}

/** Structural view of `imports.gi` — only the slots this module reads. */
export interface NativeLibraryGiView {
    readonly GIRepository?: {
        Repository?: { dup_default?: () => RepositoryView | null; new (): RepositoryView };
        Typelib?: { new_from_bytes(bytes: unknown): unknown };
    };
    readonly GLib?: {
        file_get_contents(path: string): [boolean, Uint8Array];
        file_test(path: string, test: number): boolean;
        Bytes: new (data: Uint8Array) => unknown;
        FileTest: { EXISTS: number };
    };
    readonly GModule?: { module_error(): string | null };
}

// GITypelib header (girepository/gitypelib-internal.h, format 4.x — unchanged
// since 2008): `size` at byte 40, `shared_library` (a string-pool offset) at 52.
const HEADER_SIZE_OFFSET = 40;
const HEADER_SHARED_LIBRARY_OFFSET = 52;

/**
 * Force `namespace`'s shared library to load and, when it cannot, say which file
 * failed and why.
 *
 * Call it after the namespace resolved (`imports.gi.<Ns>` loads the typelib
 * only) and before relying on its classes. On success it has done what the first
 * class access would have done anyway — girepository opens a typelib's library
 * once — so a caller pays nothing extra.
 *
 * Returns `null` when the library loads AND when nothing can be measured (not on
 * GJS, GLib without GIRepository 3, a namespace the repository has not loaded):
 * this answers "did it fail", never "is it present". Never throws: callers run
 * it while deciding how to report another failure.
 *
 * @param gi the `imports.gi` to use — defaults to the running GJS host's; a
 *   parameter so the spec can drive the unmeasurable branches with a stub
 */
export function probeNativeLibrary(
    namespace: string,
    gi: NativeLibraryGiView | undefined = (globalThis as { imports?: { gi?: NativeLibraryGiView } }).imports?.gi,
): NativeLibraryFailure | null {
    try {
        const repository = gi?.GIRepository?.Repository?.dup_default?.();
        const typelibPath = repository?.get_typelib_path(namespace);
        if (!gi || !repository || !typelibPath) return null;
        const symbol = firstSymbol(repository, namespace);
        if (!symbol) return null;
        // Read before the probe: GModule's first call opens libgmodule, and a
        // successful open clears the per-thread error this module reads.
        gi.GModule?.module_error();
        if (symbol.info.get_typelib().symbol(symbol.name)[0]) return null;

        const dir = /^(.*)[\\/][^\\/]*$/.exec(typelibPath)?.[1] ?? '.';
        const separator = typelibPath.includes('\\') && !typelibPath.includes('/') ? '\\' : '/';
        for (const leaf of repository.get_shared_libraries(namespace) ?? []) {
            const colocated = `${dir}${separator}${leaf}`;
            const library = gi.GLib?.file_test(colocated, gi.GLib.FileTest.EXISTS) ? colocated : leaf;
            const reason = loaderError(gi, namespace, typelibPath, library, symbol.name);
            if (reason === undefined) continue;
            return { namespace, library, reason, missingDependency: missingLibraryDependency(reason, library) };
        }
        const libraries = (repository.get_shared_libraries(namespace) ?? []).join(', ') || '(none named)';
        return {
            namespace,
            library: libraries,
            reason: `symbol ${symbol.name} not found in ${libraries}, and the loader reported no error`,
        };
    } catch {
        // Every call above is girepository/GLib reading a file this process
        // already loaded once; a host whose bindings differ (no GIRepository 3,
        // no GModule typelib) has nothing to measure, which is `null`, not a
        // second error on top of the one being explained.
        return null;
    }
}

/** First symbol the namespace's library must export: a type-init function, else a plain function. */
function firstSymbol(repository: RepositoryView, namespace: string): { info: RegisteredInfoView; name: string } | null {
    const count = repository.get_n_infos(namespace);
    let fallback: { info: RegisteredInfoView; name: string } | null = null;
    for (let i = 0; i < count; i++) {
        const info = repository.get_info(namespace, i);
        const typeInit = info.get_type_init_function_name?.();
        if (typeInit) return { info, name: typeInit };
        const fn = info.get_symbol?.();
        if (fn && !fallback) fallback = { info, name: fn };
    }
    return fallback;
}

/**
 * Open `library` through a private repository whose typelib names it by absolute
 * path, and return the loader's message — `undefined` when it opens.
 */
function loaderError(
    gi: NativeLibraryGiView,
    namespace: string,
    typelibPath: string,
    library: string,
    symbol: string,
): string | undefined {
    const { GIRepository, GLib, GModule } = gi;
    if (!GIRepository?.Repository || !GIRepository.Typelib || !GLib || !GModule) return undefined;
    const [, original] = GLib.file_get_contents(typelibPath);
    const entry = new TextEncoder().encode(`${library}\0`);
    const patched = new Uint8Array(original.length + entry.length);
    patched.set(original);
    patched.set(entry, original.length);
    const header = new DataView(patched.buffer);
    header.setUint32(HEADER_SIZE_OFFSET, patched.length, true);
    header.setUint32(HEADER_SHARED_LIBRARY_OFFSET, original.length, true);

    const privateRepository = new GIRepository.Repository();
    const loaded = privateRepository.load_typelib(GIRepository.Typelib.new_from_bytes(new GLib.Bytes(patched)), 0);
    const probe = firstSymbol(privateRepository, loaded);
    if (!probe) return undefined;
    GModule.module_error();
    if (probe.info.get_typelib().symbol(symbol)[0]) return undefined;
    return GModule.module_error() ?? `${namespace}: ${library} could not be opened (the loader reported no error)`;
}

/**
 * The leaf name of the dependency a loader message says is missing, or
 * `undefined` when it names none (win32's LoadLibrary never does) or names the
 * library itself (then the library is what is missing, not a dependency).
 *
 * Pure — the three message shapes are the loaders' own, captured verbatim in
 * the spec.
 */
export function missingLibraryDependency(reason: string, library?: string): string | undefined {
    const named =
        // dyld: `Library not loaded: @rpath/libjson-glib-1.0.0.dylib`
        /Library not loaded: (\S+)/.exec(reason)?.[1] ??
        // musl: `Error loading shared library libjson-glib-1.0.so.0: No such file … (needed by /…/lib.so)`
        /Error loading shared library ([^\s:]+): .*\(needed by /.exec(reason)?.[1] ??
        // glibc: `libjson-glib-1.0.so.0: cannot open shared object file: No such file or directory`
        /(?:^|\s)([^\s:]+): cannot open shared object file/.exec(reason)?.[1];
    if (!named) return undefined;
    const leaf = named.replace(/^.*[\\/]/, '');
    if (library && leaf === library.replace(/^.*[\\/]/, '')) return undefined;
    return leaf;
}

/**
 * A native bridge's library could not be loaded. The message names the file, the
 * missing dependency and what to do — the text GJS's own "Unsupported type void"
 * leaves out.
 */
export class NativeLibraryLoadError extends Error {
    readonly failure: NativeLibraryFailure;

    /**
     * @param installHint how to install what is missing, when the caller knows
     *   (the CLI derives it from its system-dependency table); otherwise the
     *   message points at `gjsify system-check`, which reads that same table
     */
    constructor(failure: NativeLibraryFailure, installHint?: string) {
        const needs = failure.missingDependency
            ? `It needs ${failure.missingDependency}, which the loader could not find: not installed, ` +
              'or not on its search path.'
            : 'The loader could not open it.';
        super(
            `${failure.namespace}: the native library ${failure.library} could not be loaded. ${needs}\n` +
                `Loader: ${failure.reason.trim()}\n` +
                (installHint ??
                    '`gjsify system-check` lists the system libraries the installed @gjsify packages need, ' +
                        'with the install command for this host.'),
        );
        this.name = 'NativeLibraryLoadError';
        this.failure = failure;
    }
}
