// @gjsify/terminal-native — optional GjsifyTerminal GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// because terminal properties like process.stdout.columns must be readable
// synchronously at construction time.  The try/catch provides the same
// graceful degradation: if the typelib is not in GI_TYPELIB_PATH, or its library
// cannot be opened, the module simply isn't available and callers fall back to
// the existing env/GLib paths.

import { colocateNativeLibrary } from '@gjsify/utils/core';

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

/** Module-local typed view of the GJS legacy `imports.gi` host slot. */
interface _GjsImportsHost {
    imports?: { gi?: Record<string, unknown> };
}

const _gi = (globalThis as unknown as _GjsImportsHost).imports?.gi;
if (_gi) {
    try {
        // Resolving the namespace loads the TYPELIB only; the library opens on
        // the first class access below, so the library directory goes on
        // girepository's path in between. Without it a SIP `/bin/sh` (which
        // strips `DYLD_*`) made the CLI die while its modules evaluated:
        // `process.stdout.columns` → "Unsupported type void" — measured with the
        // `cli` template's own `gjsify run build`.
        const ns = _gi['GjsifyTerminal'] as GjsifyTerminalModule;
        colocateNativeLibrary('GjsifyTerminal');
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
