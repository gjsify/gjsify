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

/**
 * Resolve the right Gio-flavoured namespace. GJS ≥ 1.88 supersedes
 * `Gio.UnixInputStream` etc. with `GioUnix.InputStream`; we try the new
 * namespace first and fall back to the legacy one. Returns `null` when
 * neither is available (e.g. under Node).
 */
export function getGioNamespace(): any {
    const _gi: Record<string, unknown> | undefined = (globalThis as any).imports?.gi;
    if (!_gi) return null;
    let gio: any = null;
    try { gio = (_gi as any)['GioUnix']; } catch { /* try Gio */ }
    if (!gio) { try { gio = (_gi as any)['Gio']; } catch { /* absent */ } }
    return gio;
}
