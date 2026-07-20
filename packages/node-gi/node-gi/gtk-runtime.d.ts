// SPDX-License-Identifier: MIT
/** A resolved GTK runtime bundle: native-code dir (dylibs on darwin, DLLs on win32) + typelib dir. */
export interface GtkRuntimeBundle {
    dir: string;
    libDir: string;
    typelibDir: string;
}
/** Resolve the GTK runtime bundle directory for this platform, or null. */
export function resolveGtkRuntimeBundle(): GtkRuntimeBundle | null;
/** macOS: re-exec once with DYLD_FALLBACK_LIBRARY_PATH set to the bundle (no-op off darwin). */
export function maybeReexecForGtkRuntime(): void;
/** Windows: prepend the bundle's gtk/bin DLL dir to process.env.PATH (no-op off win32). */
export function maybePrependGtkRuntimeDllPath(): void;
/** Activate the bundled GTK runtime for the native engine, if one is present. */
export function activateBundledGtkRuntime(native: { prependSearchPath: (p: string) => void }): GtkRuntimeBundle | null;
