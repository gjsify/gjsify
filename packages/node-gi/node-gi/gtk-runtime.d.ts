// SPDX-License-Identifier: MIT
/** A resolved GTK runtime bundle: relocated dylib dir + typelib dir. */
export interface GtkRuntimeBundle {
    dir: string;
    libDir: string;
    typelibDir: string;
}
/** Resolve the GTK runtime bundle directory for this platform, or null. */
export function resolveGtkRuntimeBundle(): GtkRuntimeBundle | null;
/** Activate the bundled GTK runtime for the native engine, if one is present. */
export function activateBundledGtkRuntime(native: { prependSearchPath: (p: string) => void }): GtkRuntimeBundle | null;
