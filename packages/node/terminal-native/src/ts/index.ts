// @gjsify/terminal-native — optional GjsifyTerminal GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// because terminal properties like process.stdout.columns must be readable
// synchronously at construction time.  The try/catch provides the same
// graceful degradation: if the typelib is not in GI_TYPELIB_PATH the module
// simply isn't available and callers fall back to the existing env/GLib paths.

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
    new(): NativeResizeWatcher;
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
// Calling imports.gi.GjsifyTerminal throws if the typelib is not found,
// which the try/catch catches gracefully.
let _mod: GjsifyTerminalModule | null = null;

const _gi: Record<string, unknown> | undefined = (globalThis as any).imports?.gi;
if (_gi) {
    try {
        _mod = _gi['GjsifyTerminal'] as GjsifyTerminalModule;
    } catch {
        // GjsifyTerminal typelib not installed — fallback paths active in tty/process
    }
}

/** The native GjsifyTerminal module, or null if not installed. */
export const nativeTerminal: GjsifyTerminalModule | null = _mod;

/** Returns true when the GjsifyTerminal native library is available. */
export function hasNativeTerminal(): boolean {
    return _mod !== null;
}
