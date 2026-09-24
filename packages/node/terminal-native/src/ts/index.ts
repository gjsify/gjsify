// @gjsify/terminal-native — optional GjsifyTerminal GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// because terminal properties like process.stdout.columns must be readable
// synchronously at construction time.  The try/catch provides the same
// graceful degradation: if the typelib is not in GI_TYPELIB_PATH, or its library
// cannot be opened, the module simply isn't available and callers fall back to
// the existing env/GLib paths.

export interface NativeTerminal {
    /** Check whether fd is an interactive terminal (Posix.isatty). */
    is_tty(fd: number): boolean;
    /**
     * Get terminal dimensions via ioctl(TIOCGWINSZ).
     * Returns [success, rows, cols, xpixel, ypixel].
     */
    get_size(fd: number): [boolean, number, number, number, number];
    /** Enter/leave raw mode via termios (disables line-buffering + echo). */
    set_raw_mode(fd: number, enable: boolean): boolean;
}

export interface NativeResizeWatcherClass {
    new (): NativeResizeWatcher;
}

export interface NativeResizeWatcher {
    /** Start watching SIGWINCH.  Idempotent. */
    start(): void;
    connect(signal: 'resized', handler: (obj: NativeResizeWatcher, rows: number, cols: number) => void): number;
    disconnect(id: number): void;
}

export interface GjsifyTerminalModule {
    Terminal: NativeTerminal;
    ResizeWatcher: NativeResizeWatcherClass;
}

// Synchronous optional load via GJS legacy imports API.
let _mod: GjsifyTerminalModule | null = null;

/** The girepository calls {@link colocateLibrary} makes. */
interface _GiRepository {
    get_typelib_path(namespace: string): string | null;
    prepend_library_path(directory: string): void;
}

/** Module-local typed view of the GJS legacy `imports.gi` host slot. */
interface _GjsImportsHost {
    imports?: {
        gi?: Record<string, unknown> & {
            GIRepository?: { Repository?: { dup_default?: () => _GiRepository } };
        };
    };
}

/**
 * Put the directory the GjsifyTerminal TYPELIB was found in on girepository's
 * LIBRARY path, before anything makes it open the library.
 *
 * A prebuild ships typelib and dylib side by side, and the typelib names its
 * library by bare leaf. The `gjsify` launcher exports both halves —
 * `GI_TYPELIB_PATH` and the host library variable — but on macOS with SIP on
 * (every stock Mac; CI runners have it off) `/bin/sh` STRIPS every `DYLD_*`
 * variable and keeps `GI_TYPELIB_PATH`. So each compound package script
 * (`gjsify run a && gjsify run b`) started a GJS CLI that found this typelib,
 * could not open its library, and died while its modules evaluated:
 * `process.stdout.columns` → "Unsupported type void, deriving from fundamental
 * void". Measured with the `cli` template's own `gjsify run build`. The typelib's
 * location is the one fact that survives the shell, so it is what names the
 * library directory — the same repair ADR 0021 applies to the CLI's engines.
 *
 * Capability-probed rather than assumed: `dup_default()` is GLib >= 2.86, and an
 * older host simply keeps the environment-only behaviour.
 */
function colocateLibrary(gi: NonNullable<NonNullable<_GjsImportsHost['imports']>['gi']>): void {
    try {
        const repository = gi.GIRepository?.Repository?.dup_default?.();
        const typelib = repository?.get_typelib_path('GjsifyTerminal');
        const dir = typelib ? /^(.*)[\\/][^\\/]*$/.exec(typelib)?.[1] : undefined;
        if (repository && dir) repository.prepend_library_path(dir);
    } catch {
        // No GIRepository typelib on this host (distributions ship it apart from
        // the library GJS links against): the environment is all there is.
    }
}

const _gi = (globalThis as unknown as _GjsImportsHost).imports?.gi;
if (_gi) {
    try {
        // Resolving the namespace loads the TYPELIB only; the library opens on
        // the first class access below — after `colocateLibrary` had its say.
        const ns = _gi['GjsifyTerminal'] as GjsifyTerminalModule;
        colocateLibrary(_gi);
        // Touch both classes HERE, inside the try: with the typelib found and
        // the library not, girepository hands back a namespace whose every
        // class access throws, and "available" would be a lie told to every
        // caller of `nativeTerminal`.
        void ns.Terminal;
        void ns.ResizeWatcher;
        _mod = ns;
    } catch {
        // Typelib not installed, or its library cannot be opened — the
        // fallback paths in tty/process take over.
    }
}

/** The native GjsifyTerminal module, or null if not installed. */
export const nativeTerminal: GjsifyTerminalModule | null = _mod;

/** Returns true when the GjsifyTerminal native library is available. */
export function hasNativeTerminal(): boolean {
    return _mod !== null;
}
