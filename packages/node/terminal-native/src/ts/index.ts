// @gjsify/terminal-native — optional GjsifyTerminal GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// because terminal properties like process.stdout.columns must be readable
// synchronously at construction time. If the typelib is not in GI_TYPELIB_PATH,
// or its library cannot be opened, the module simply isn't available and callers
// fall back to the existing env/GLib paths.

import { loadOptionalNativeModule } from '@gjsify/utils/core';

// The raw-mode claim ledger, shared with @gjsify/process and @gjsify/tty: the
// debt a raw-mode transition creates is owed to the terminal, and this is the
// one package both of them already depend on. See ./raw-mode.ts.
export * from './raw-mode.js';

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

// Synchronous optional load via GJS legacy imports API. Opening the library
// here, before the first class access, matters twice: its directory goes on
// girepository's path first (without that a SIP `/bin/sh`, which strips
// `DYLD_*`, made the CLI die while its modules evaluated: `process.stdout.columns`
// → "Unsupported type void" — measured with the `cli` template's own
// `gjsify run build`), and a typelib found without a loadable library reads as
// absent instead of an "available" module whose every class access throws.
const _load = loadOptionalNativeModule<GjsifyTerminalModule>('GjsifyTerminal', ['Terminal', 'ResizeWatcher']);
const _mod: GjsifyTerminalModule | null = _load.module;

/**
 * The native GjsifyTerminal module, or null if not installed.
 *
 * READING this namespace proves less than it looks: girepository opens the
 * shared library at the first member CALL, not at the load, so a namespace
 * that resolved can still raise on every call (see {@link callableModule}).
 * Prefer the `native*` accessors below — they carry that one step and return
 * `null` instead of throwing, which is what an optional prebuild owes a caller
 * that already has a fallback.
 */
export const nativeTerminal: GjsifyTerminalModule | null = _mod;

/** Returns true when the GjsifyTerminal native library is available. */
export function hasNativeTerminal(): boolean {
    return _mod !== null;
}

/**
 * Why {@link nativeTerminal} is `null`: girepository's "not found" when the
 * prebuild is not installed, a `NativeLibraryLoadError` naming the missing
 * dependency when it is installed but its library will not open.
 */
export function getNativeTerminalLoadError(): Error | null {
    return _load.error;
}

/**
 * The module, or `null` when its classes cannot actually be CALLED.
 *
 * {@link loadOptionalNativeModule} establishes that the classes can be READ,
 * which is a weaker property than calling them. It is weaker on a host whose
 * GLib predates GIRepository 3, where `probeNativeLibrary` can measure nothing
 * and the class touch is the whole check — and that touch reads a name, while
 * girepository opens the shared library at the first member call. So a
 * namespace that resolved and whose name reads back can still raise on the
 * first CALL, with GJS's own "Unsupported type void, deriving from fundamental
 * void" and no hint of which library failed.
 *
 * Measured on gjs 1.88.1 / macOS arm64, in the `gjsify` CLI bundle: the
 * bundled `cliui` shim evaluates `process.stdout.columns` at module init,
 * which reached `Terminal.get_size` through an unresolvable
 * `libgjsifyterminal.dylib` and killed the whole process before any command
 * ran. Every consumer of this package reads a value it already has a fallback
 * for, so the access belongs here, once, rather than as a try/catch at each of
 * them — the fallback is the point of an OPTIONAL prebuild.
 *
 * @returns the module when its calls work, else `null`
 */
function callableModule(): GjsifyTerminalModule | null {
    if (!_mod) return null;
    try {
        // A call, not a read: `is_tty` is the cheapest of the three (a
        // `isatty(2)` on the fd, no allocation) and it is the one every
        // consumer reaches first. `nativeTerminal` stays the raw namespace so
        // a host that CAN call pays this probe once per process, not per read.
        _mod.Terminal.is_tty(2);
        return _mod;
    } catch {
        return null;
    }
}

/**
 * `Terminal.is_tty(fd)`, or `null` when the native module is absent or its
 * calls throw. `null` is distinct from `false`: a caller that owns a fallback
 * (`process.stdout.isTTY` → GLib's `log_writer_supports_color`) must take it
 * on `null` and answer `false` itself on a real answer.
 */
export function nativeIsTty(fd: number): boolean | null {
    try {
        return callableModule()?.Terminal.is_tty(fd) ?? null;
    } catch {
        return null;
    }
}

/**
 * `Terminal.get_size(fd)` as `[rows, columns]`, or `null` when the native
 * module is absent, its calls throw, or the ioctl reports no size. The last
 * collapse is deliberate: every consumer asks the same question — "how wide is
 * this fd, if I can really tell?" — and answered `ok && cols > 0` itself.
 * Returns columns second, matching the bridge's own tuple order.
 */
export function nativeTerminalSize(fd: number): { rows: number; columns: number } | null {
    try {
        const size = callableModule()?.Terminal.get_size(fd);
        const [ok, rows, columns] = size ?? [false, 0, 0];
        if (!ok || columns <= 0) return null;
        return { rows, columns };
    } catch {
        return null;
    }
}

/**
 * `Terminal.set_raw_mode(fd, enable)`, or `null` when the native module is
 * absent or its calls throw. The caller keeps its own `isRaw` bookkeeping, so
 * the return value is only ever read as "did the native call happen".
 */
export function nativeSetRawMode(fd: number, enable: boolean): boolean | null {
    try {
        return callableModule()?.Terminal.set_raw_mode(fd, enable) ?? null;
    } catch {
        return null;
    }
}
