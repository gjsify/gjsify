// Getting the GTK closure for a ship run when the project does not carry it.
//
// WHY IT IS FETCHED AND NOT INSTALLED. `@gjsify/gtk-runtime-<target>` is 100 MB of
// GLib, GObject, GTK and friends, and a project that lists it — as
// `optionalDependencies`, which the `os`/`cpu` gate turns into "installed on every
// Mac" — gets it into its own `node_modules`. On macOS that breaks every build and
// every run that goes through a Homebrew GJS. Every darwin prebuild
// carries the rpath `@loader_path` → `…/gtk-runtime-darwin-<arch>/gtk/lib` →
// `<brew>/lib` (ADR 0023: bundle before system, `docs/prebuilds.md`), so the first
// `dlopen` out of `node_modules/@gjsify/*-native-darwin-*` finds the bundle's
// GLib/GObject beside the one `gjs` already loaded from Homebrew: two GObject type
// registries in one process, which shows as `No signal 'context_response' on
// object 'GVolumeMonitor'` and a segfault, or as `GNotificationCenterDelegate is
// implemented in both …`. The invariant ADR 0023 names — one registry per process
// — is violated by the dev tree itself.
//
// The closure is only ever needed at the moment it is COPIED into a bundle, so it
// is acquired then: into the dlx cache (`ensurePkgDir`, the same machinery
// `gjsify showcase` already uses for the same package), never into the project.
// What this does NOT change: the search order in `resolveGtkRuntime()` keeps its
// four existing candidates, so a project that still installs the package ships
// exactly as before — it merely stays exposed to the dev-tree failure above until
// it drops the dependency.
//
// EXACT VERSION, no range and no fallback. The addon's `@rpath` is
// `@loader_path/gtk/lib` — addon and closure are a matched pair published from the
// same release — so "the nearest published version" would be a guess about GTK ABI
// that `assertPayloadMatchesArch` cannot check. A CLI version with no published
// runtime (a dev or `next` build) fails with the reason named, and
// `GJSIFY_GTK_RUNTIME` is the way past it.

import {
    gtkRuntimePackageName,
    resolveGtkRuntime,
    type GtkRuntimeTarget,
    type ResolveRuntimeOptions,
} from './app-runtime.js';

export type AcquiredGtkRuntime =
    /** Something already resolves — nothing was fetched, and nothing will be. */
    | { kind: 'present' }
    /** Fetched; `dir` is the PACKAGE directory, holding `gtk/`. */
    | { kind: 'fetched'; dir: string }
    /** Could not be had; `reason` is what to tell the person, verbatim. */
    | { kind: 'failed'; reason: string };

export interface AcquireGtkRuntimeInput {
    target: GtkRuntimeTarget;
    /** The version to fetch: the CLI's own, because addon and closure are a matched pair. */
    version: string;
    /** The same discovery options the staging step will use — so "present" means what it will mean there. */
    discovery?: ResolveRuntimeOptions;
    /**
     * Fetch a package spec into a cache and return its directory. Injected: the
     * real one is `ensurePkgDir`, and a test must not touch a registry.
     */
    ensure: (spec: string) => Promise<string>;
    /** One progress line. The closure is ~100 MB, so a silent first run looks like a hang. */
    log?: (message: string) => void;
}

/**
 * Make sure a GTK closure is reachable for `target`, fetching it only if nothing
 * else provides one. Never throws: a ship run with no closure is a PARTIAL result
 * that `stageAppRuntime` reports, not an error (see its doc).
 */
export async function acquireGtkRuntime(input: AcquireGtkRuntimeInput): Promise<AcquiredGtkRuntime> {
    const discovery = input.discovery ?? {};
    if (resolveGtkRuntime(input.target, discovery) !== null) return { kind: 'present' };

    const name = gtkRuntimePackageName(input.target);
    const spec = `${name}@${input.version}`;
    // An offline build, or a suite that must not download 100 MB per run, stages what is
    // reachable and nothing more. The e2e suites that assert "a project without the packages
    // stages no runtime" held only while the fetch failed on Linux for every foreign target.
    if ((discovery.env ?? process.env)['GJSIFY_GTK_RUNTIME_FETCH'] === '0') {
        return { kind: 'failed', reason: `GJSIFY_GTK_RUNTIME_FETCH=0 turned off the fetch of ${spec}` };
    }
    input.log?.(
        `${name} is not installed here, and is not meant to be — fetching ${spec} into the cache ` +
            '(about 100 MB, once)',
    );

    let dir: string;
    try {
        dir = await input.ensure(spec);
    } catch (error) {
        return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }

    // The same completeness probe the staging step applies, so a package that
    // resolved but holds no `gtk/` (an unpopulated checkout, a truncated cache
    // entry) is reported HERE, with its name, instead of as a bare "no GTK closure".
    if (resolveGtkRuntime(input.target, { ...discovery, fetchedGtkRuntimeDir: dir }) === null) {
        return { kind: 'failed', reason: `${spec} was fetched to ${dir} but holds no complete gtk/ closure` };
    }
    return { kind: 'fetched', dir };
}
