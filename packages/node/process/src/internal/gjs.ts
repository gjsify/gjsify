// Runtime-aware GJS imports access. Used by every other module in
// @gjsify/process to reach `imports.gi.GLib` / `imports.system` without
// hard-failing under Node (where `globalThis.imports` is undefined).

/** Subset of globalThis we touch on GJS — typed loosely because we have to
 *  cohabit with Node's typed globals when this code is bundled cross-platform. */
export interface GjsGlobalThis {
    imports?: {
        gi?: {
            GLib?: Record<string, Function>;
            [key: string]: unknown;
        };
        system?: {
            programArgs?: string[];
            programInvocationName?: string;
            exit?: (code: number) => never;
            version?: number;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
}

/** Cast the global view to our loose shape — kept in one place. */
export function getGjsGlobal(): GjsGlobalThis {
    return globalThis as unknown as GjsGlobalThis;
}

/** Stream-class shape we use: only the static `new(fd, closeOnClose)` factory
 *  that the four GIO byte-stream classes share. */
export interface GioStreamCtor {
    new: (fd: number, closeOnClose: boolean) => unknown;
}

/** A loose view of the Gio/GioUnix namespace shape we touch: typed entries
 *  for the four byte-stream classes we care about, plus an index signature
 *  for dynamic access to anything else (most callers reach for the typed
 *  entries, the index signature keeps the door open without `as any` casts). */
export interface GioNamespaceLike {
    UnixOutputStream?: GioStreamCtor;
    OutputStream?: GioStreamCtor;
    UnixInputStream?: GioStreamCtor;
    InputStream?: GioStreamCtor;
    [key: string]: unknown;
}

/**
 * Resolve the right Gio-flavoured namespace. GJS ≥ 1.88 supersedes
 * `Gio.UnixInputStream` etc. with `GioUnix.InputStream`; we try the new
 * namespace first and fall back to the legacy one. Returns `null` when
 * neither is available (e.g. under Node).
 */
export function getGioNamespace(): GioNamespaceLike | null {
    const _gi = getGjsGlobal().imports?.gi;
    if (!_gi) return null;
    let gio: GioNamespaceLike | null = null;
    try { gio = (_gi['GioUnix'] as GioNamespaceLike | undefined) ?? null; } catch { /* try Gio */ }
    if (!gio) { try { gio = (_gi['Gio'] as GioNamespaceLike | undefined) ?? null; } catch { /* absent */ } }
    return gio;
}
