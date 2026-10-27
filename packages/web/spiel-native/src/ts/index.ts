// @gjsify/spiel-native — make `gi://Spiel?version=1.0` importable, and say where it
// came from.
//
// This package contains no speech API. It ships libspiel (LGPL-2.1-or-later) as an
// ADR 0017 prebuild and exposes exactly two things to the package that does — the
// sibling `@gjsify/speech-synthesis`: {@link probeSpiel}, which answers
// system / prebuild / absent with a reason, and {@link requireSpiel}, which is the
// same answer as a namespace or a throw. Nothing else here is public API.
//
// ── WHY A PROBE AND NOT AN IMPORT ─────────────────────────────────────────────
//
// A static `import Spiel from 'gi://Spiel'` fails the whole module when the typelib
// is absent, and "absent" is an ORDINARY state here: this prebuild exists only for
// linux-x64 and linux-arm64, and even on those a consumer may have installed the
// bridge without its optional per-target package. A speech API that cannot be
// imported on a machine with no speech is the wrong failure — the W3C surface it
// backs answers with an empty voice list, which needs the module to load.
//
// ── SYSTEM BEFORE PREBUILD, AND WHY IT TAKES WORK ─────────────────────────────
//
// A host libspiel wins over ours. It is the distribution's, it is the one a
// provider package was built against, and it gets security updates we do not ship.
//
// That is NOT the default, and that is the whole reason this function exists.
// Every mechanism that registers an ADR 0017 prebuild PREPENDS it —
// `activateNativePrebuilds()` (`@gjsify/cli`) calls `prepend_search_path`, the
// `--app gjs` bundle prologue (`gi-runtime-paths.ts`) emits the same call, and the
// `gjsify` launcher puts the directory at the FRONT of `GI_TYPELIB_PATH`. All three
// are right for a bridge whose library exists nowhere else (ADR 0023's
// bundle-before-system precedence); for a library the host may genuinely have, the
// precedence is backwards. So the system directory is prepended AGAIN, after them,
// and therefore ahead of them.
//
// WHERE "the system directory" comes from, without guessing: the directory the
// RUNNING process loaded `GLib-2.0.typelib` from. GJS has GLib loaded before any
// of our code runs and its typelib is never a prebuild, so that directory is the
// host's own `girepository-1.0` — the compile-time default, or whatever
// `GI_TYPELIB_PATH` the user set, with no table of `/usr/lib64`-shaped candidates
// to keep current per architecture and distribution.
//
// ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────
//
// It does not start a `Spiel.Speaker`, which would open the session bus and
// D-Bus-ACTIVATE every installed speech provider. `probeSpiel()` is a capability
// query, in the shape `hasGamepadBackend()` established: it says the namespace is
// usable, not that this host has a voice. Whether any provider answers is a
// separate question, and on a Flatpak-sandboxed host the answer is usually no —
// README.md § Provider discovery has the measurement.

import { loadOptionalNativeModule, type GiImportsView } from '@gjsify/utils/core';

import type { SpielNamespace } from './namespace.js';

export type {
    SpielListModel,
    SpielNamespace,
    SpielProvider,
    SpielSpeaker,
    SpielSpeakerSignals,
    SpielUtterance,
    SpielVoice,
} from './namespace.js';

/** The GI namespace this package makes importable. */
export const SPIEL_NAMESPACE = 'Spiel';

/** The only version libspiel has ever published a typelib for. */
export const SPIEL_VERSION = '1.0';

/** The typelib file name both halves of the search look for. */
const SPIEL_TYPELIB = `${SPIEL_NAMESPACE}-${SPIEL_VERSION}.typelib`;

/** The namespace whose loaded typelib locates the host's own `girepository-1.0`. */
const ANCHOR_NAMESPACE = 'GLib';

/**
 * Where the `Spiel` typelib came from.
 *
 * - `system`   — the host's own libspiel, on the directory its GLib typelib lives in.
 *   Preferred: it is the build every installed speech provider was made against.
 * - `prebuild` — this package's `@gjsify/spiel-native-<target>` artifact, or any other
 *   directory a caller put on girepository's search path.
 * - `absent`   — no typelib, or one whose library will not open. {@link SpielProbe.reason}
 *   says which.
 */
export type SpielSource = 'system' | 'prebuild' | 'absent';

/** What {@link probeSpiel} found. */
export interface SpielProbe {
    readonly source: SpielSource;
    /** The namespace, or `null` exactly when `source` is `absent`. */
    readonly module: SpielNamespace | null;
    /** The directory the typelib was loaded from; `null` when none was. */
    readonly typelibDir: string | null;
    /**
     * One sentence naming what is missing — `null` exactly when `source` is not
     * `absent`. Safe to show a user: it names the file and, for a library that was
     * found and refused, the dependency the loader could not resolve.
     */
    readonly reason: string | null;
    /** The underlying error behind `reason`, for a caller that wants to log a cause. */
    readonly error: Error | null;
}

/** Overrides. Tests only — every default here reads the running GJS host. */
export interface ProbeSpielOptions {
    /** The `imports.gi` to use. */
    readonly gi?: GiImportsView | undefined;
    /** Skip the memo, so a spec can drive more than one outcome per process. */
    readonly fresh?: boolean;
}

/** girepository's two writable search paths, plus the reader the probe needs. */
interface RepositoryPaths {
    get_typelib_path(namespace: string): string | null;
    prepend_search_path(directory: string): void;
    prepend_library_path(directory: string): void;
}

interface GiWithRepository extends GiImportsView {
    readonly versions?: Record<string, string>;
}

/** The host's `imports.gi`, or `undefined` off GJS. */
function hostGi(): GiWithRepository | undefined {
    return (globalThis as { imports?: { gi?: GiWithRepository } }).imports?.gi;
}

/** Directory part of a HOST path — both separators, since a win32 host uses `\`. */
function directoryOf(path: string): string | null {
    return /^(.*)[\\/][^\\/]*$/.exec(path)?.[1] ?? null;
}

function defaultRepository(gi: GiImportsView | undefined): RepositoryPaths | null {
    try {
        // `dup_default()` is GLib >= 2.86, probed as a capability: an older host
        // simply keeps whatever precedence its environment already gives it, which
        // is the behaviour before this module existed.
        return (gi?.GIRepository?.Repository?.dup_default?.() as RepositoryPaths | undefined) ?? null;
    } catch {
        // `imports.gi.GIRepository` LOADS a namespace, and distributions ship that
        // typelib apart from the girepository library GJS links against (Debian's
        // `gir1.2-girepository-3.0` vs `libgirepository-2.0-0`).
        return null;
    }
}

/**
 * Put the host's own typelib directory ahead of every prepended prebuild, when a
 * system `Spiel-1.0.typelib` is really there.
 *
 * Conditional on the FILE, not on the directory: prepending unconditionally would
 * reorder the search path for every other namespace in the process to no purpose,
 * and a change with no effect is one nobody can reason about later.
 *
 * @returns the system typelib directory when it holds Spiel, else `null`
 */
function preferSystemSpiel(gi: GiImportsView | undefined, repository: RepositoryPaths | null): string | null {
    const glib = gi?.GLib;
    if (!repository || !glib) return null;
    try {
        const anchor = repository.get_typelib_path(ANCHOR_NAMESPACE);
        const dir = anchor ? directoryOf(anchor) : null;
        if (!dir) return null;
        const separator = anchor?.includes('\\') && !anchor.includes('/') ? '\\' : '/';
        if (!glib.file_test(`${dir}${separator}${SPIEL_TYPELIB}`, glib.FileTest.EXISTS)) return null;
        repository.prepend_search_path(dir);
        // The library too: a system libspiel in the default libdir resolves through
        // ld.so anyway, but a host whose GI stack sits under its own prefix
        // (`/opt/…`, jhbuild) has that libdir on neither path. `girLibraryDir` is
        // the INSTALL layout — `<libdir>/girepository-1.0/` beside `<libdir>/`.
        const libDir = directoryOf(dir);
        if (libDir) repository.prepend_library_path(libDir);
        return dir;
    } catch {
        // Every call is girepository reading state this process already holds; a
        // host where it throws has no system preference to express, which leaves
        // the prebuild — the state before this call.
        return null;
    }
}

let memo: SpielProbe | null = null;

/**
 * Find `Spiel`, system first, and say what was found.
 *
 * Memoized: the answer cannot change within a process (girepository caches a loaded
 * typelib, and the directories were decided at the first call), and the search path
 * must not be rewritten on every query. Never throws — `absent` is an answer, not a
 * fault, and a caller deciding how to degrade must not have to guard the question.
 */
export function probeSpiel(options: ProbeSpielOptions = {}): SpielProbe {
    if (memo && !options.fresh) return memo;

    // `GiWithRepository` rather than `GiImportsView`: `imports.gi.versions` is a GJS
    // property the shared view does not model, and an injected `gi` from a test is
    // allowed to carry it too.
    const gi: GiWithRepository | undefined = options.gi ?? hostGi();
    const repository = defaultRepository(gi);
    const systemDir = preferSystemSpiel(gi, repository);

    // Pin the version before the namespace resolves. libspiel has published exactly
    // one typelib version, so today this changes nothing; it is here so that a host
    // which later has two does not silently get the other one, which is the failure
    // `gi://Ns` without `?version=` is known for.
    try {
        if (gi?.versions) gi.versions[SPIEL_NAMESPACE] = SPIEL_VERSION;
    } catch {
        // A frozen or absent `versions` table is not a reason to stop looking.
    }

    const loaded = loadOptionalNativeModule<SpielNamespace>(
        SPIEL_NAMESPACE,
        // Touched after the library opens, so a namespace that resolved while its
        // library did not reads as absent here rather than throwing at first use.
        ['Speaker', 'Utterance'],
        gi,
    );

    const typelibDir = (() => {
        try {
            const path = repository?.get_typelib_path(SPIEL_NAMESPACE) ?? null;
            return path ? directoryOf(path) : null;
        } catch {
            return null;
        }
    })();

    const probe: SpielProbe = loaded.module
        ? {
              // Compared against the directory we prepended, not against a path
              // shape: "system" means THIS host's girepository-1.0, and that is the
              // only directory anything here can say that about.
              source: systemDir !== null && typelibDir === systemDir ? 'system' : 'prebuild',
              module: loaded.module,
              typelibDir,
              reason: null,
              error: null,
          }
        : {
              source: 'absent',
              module: null,
              typelibDir,
              reason: absentReason(loaded.error),
              error: loaded.error,
          };

    if (!options.fresh) memo = probe;
    return probe;
}

/**
 * One sentence a user can act on.
 *
 * Three causes, and they need different sentences: not on GJS at all, no typelib
 * anywhere, and a typelib whose library was found and refused. The third already
 * carries the loader's own text (`NativeLibraryLoadError`), so it is passed through
 * rather than summarised — the dependency it names is the actionable part.
 */
function absentReason(error: Error | null): string {
    if (!error) return `${SPIEL_NAMESPACE}: not available, and nothing was measurable about why.`;
    if (error.name === 'NativeLibraryLoadError') return error.message;
    if (error.message.includes('imports.gi')) {
        return `${SPIEL_NAMESPACE}: no GObject-Introspection in this process — @gjsify/spiel-native needs GJS or @gjsify/node-gi.`;
    }
    return (
        `${SPIEL_NAMESPACE}-${SPIEL_VERSION}.typelib was not found. Install libspiel, or the ` +
        '`@gjsify/spiel-native-<os>-<arch>` package for this machine — it is an optional ' +
        'dependency and exists for linux-x64 and linux-arm64 only.'
    );
}

/**
 * {@link probeSpiel} as a namespace or a throw — for a caller that has already
 * decided Spiel is required and wants the reason in the stack trace.
 *
 * The `cause` carries the original error, so a loader fault keeps the file and the
 * missing dependency the probe measured.
 */
export function requireSpiel(options: ProbeSpielOptions = {}): SpielNamespace {
    const probe = probeSpiel(options);
    if (probe.module) return probe.module;
    throw new Error(probe.reason ?? `${SPIEL_NAMESPACE}: not available.`, { cause: probe.error ?? undefined });
}
