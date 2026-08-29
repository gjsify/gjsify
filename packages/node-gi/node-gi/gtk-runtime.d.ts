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
/** Windows: wire the env for a full-windowing bundle's runtime data — GSettings schemas, gdk-pixbuf loaders, icon themes, fontconfig (no-op off win32 / for a display-free bundle). */
export function maybeWireGtkWindowingEnv(): void;
/** Activate the bundled GTK runtime for the native engine, if one is present. */
export function activateBundledGtkRuntime(native: {
    prependSearchPath: (p: string) => void;
    prependLibraryPath?: (p: string) => void;
}): GtkRuntimeBundle | null;

/** Absolute directories from `GJSIFY_GI_LIBRARY_PATH` — where an app carries its OWN GI libraries. */
export function appGiLibraryDirs(opts?: { platform?: NodeJS.Platform | string; env?: NodeJS.ProcessEnv }): string[];

/** Prepend GI's shared-library search path: the app's own dirs, then the GTK the policy chose. */
export function activateGiLibraryPath(native: { prependLibraryPath?: (p: string) => void }): string[];
/** TEST-ONLY: allow the activation to run again. */
export function resetGiLibraryPathForTests(): void;
