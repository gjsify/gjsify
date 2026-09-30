// @gjsify/terminal-native — optional GjsifyTerminal GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// because terminal properties like process.stdout.columns must be readable
// synchronously at construction time. If the typelib is not in GI_TYPELIB_PATH,
// or its library cannot be opened, the module simply isn't available and callers
// fall back to the existing env/GLib paths.

import { loadOptionalNativeModule } from '@gjsify/utils/core';

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

/** The native GjsifyTerminal module, or null if not installed. */
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
