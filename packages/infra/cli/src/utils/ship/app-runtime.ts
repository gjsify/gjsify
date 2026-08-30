// The runtime a self-contained `<App>.app` CARRIES — found, then staged with its
// tree intact (#1354 M2b, ADR 0024 stage 4).
//
// WHAT M2a LEFT. `gjsify ship darwin` produced a real bundle — `Info.plist`,
// `PkgInfo`, a compiled schema cache — whose launcher still `exec`ed the bare
// name `node` off `PATH` and whose GI namespaces still expected a GTK on the
// machine. macOS ships neither. So the artifact was an application in shape and
// not in behaviour, and `formats.ts`'s `macos-app` row says so in as many words:
// "whatever the bundle does not carry, it finds on the machine or it does not
// run — which is what makes M2b (staging a runtime) the milestone that matters".
// This module is that staging.
//
// FOUR PIECES, THREE OWNERS — `@gjsify/node-gi` supplies two of them — and none
// is a dependency of anything here:
//
//   * the interpreter — `@gjsify/node-runtime-<target>`, resolved by
//     {@link resolveNodeRuntime} in `node-runtime.ts`. This module is the caller
//     that module was written for, and #1354 M3 gave it a second layout to serve.
//   * the relocated GTK closure — `@gjsify/gtk-runtime-<target>`'s `gtk/`.
//   * the node-gi addon built against that closure —
//     `@gjsify/node-gi`'s `prebuilds/<target>/node_gi.node`, whose `@rpath` is
//     `@loader_path/gtk/lib`.
//   * node-gi's own JAVASCRIPT, which is a fourth piece and not an afterthought:
//     `@gjsify/node-gi/*` is EXTERNAL in every `--app node` bundle by design
//     (`rolldown-plugin-gjsify/src/app/node.ts`: the reverse-bridge modules
//     "must resolve at runtime against the consumer's node_modules"), so a
//     `gi://Gtk` import compiles to `require('@gjsify/node-gi/gi')` in the
//     shipped file. Measured on the `.app` fixture's own bundle. A `.app` has no
//     consumer node_modules, so the package is staged into one the bundle's
//     directory owns.
//
// THE LAYOUT IS NOT OURS TO CHOOSE. `resolveGtkRuntimeBundle()` in
// `packages/node-gi/node-gi/gtk-runtime.js` walks four candidates and probes each
// for `<dir>/lib` + `<dir>/girepository-1.0`; the addon's `@rpath` reaches its
// dylibs as `@loader_path/gtk/lib`; `loaders.cache` names each gdk-pixbuf loader
// `@loader_path/../../..`-relative; `GST_PLUGIN_SCANNER` is an executable under
// `libexec/gstreamer-1.0`. Every one of those relations is RELATIVE, so the whole
// tree survives a copy — as long as it is copied as a tree. Hence
// {@link appRuntimePaths}: the staged shape is node-gi's own sibling layout,
// `prebuilds/<target>/{node_gi.node, gtk/}`, the same one
// `.github/workflows/node-gi.yml`'s macOS legs assemble by hand before they run
// the conformance.
//
// AND THAT SPLIT IS WHY THE TWO ENVIRONMENT VARIABLES ARE LOAD-BEARING rather
// than belt-and-braces. Once node-gi's JS sits at
// `Contents/Resources/lib/node_modules/@gjsify/node-gi`, its `packageRoot` is
// THAT directory — so `prebuildAddonPath()` looks for
// `…/node_modules/@gjsify/node-gi/prebuilds/<target>/node_gi.node` and
// `resolveGtkRuntimeBundle()`'s candidate 2 for `…/prebuilds/<target>/gtk`, and
// neither is where a `.app` may keep loadable code: `Contents/Frameworks` is, and
// it is what `codesign` now reaches (ADR 0024 § A4) — M6 landed, and
// `utils/ship/signing.ts` re-signs every Mach-O in the payload by magic number,
// which is most of this closure. Putting it under `Resources` to save two
// `export` lines would trade a correct bundle for a shorter launcher.
//
// WHY NOT `gjsify.ship.bundledTypelibs`. Because it FLATTENS. `plan.ts` stages
// each such file as `posix.join(libDir, 'gi', basename(file))`, and
// `discoverTypelibs` walks the directory recursively — so three inputs at three
// depths collapse into one directory. Measured on this tree, through the built
// planner:
//
//     gi/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so → lib/demo/gi/libpixbufloader-svg.so
//     gi/loaders.cache                                        → lib/demo/gi/loaders.cache
//     gi/Gtk-4.0.typelib                                      → lib/demo/gi/Gtk-4.0.typelib
//
// That destroys the loader paths `loaders.cache` records, and it leaves a
// directory with no `lib/` and no `girepository-1.0/` — so
// `resolveGtkRuntimeBundle()`'s existence probe rejects it and node-gi falls back
// to a GTK the machine does not have. `bundledTypelibs` stays what it is (a FLAT
// pair of a typelib and its backer, which is all it ever claimed to be); a
// relocated closure needs its own stager, and this is it.
//
// `null`-not-throw, like `node-runtime.ts`, and for the same reason: whether a
// missing piece is fatal depends on what the caller is building. `assemble` in
// `commands/ship.ts` stages what was found, names what was not, and keeps
// `Layout.runtimeGap` for exactly the case where the interpreter is still absent.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, sep } from 'node:path';

import { listFilesRecursive } from './discover.js';
import type { Layout, LayoutIdentity } from './layout.js';
import { nodeRuntimeBinaryName } from './node-runtime.js';
import { isExecutableAsset } from './plan.js';
import { resolveInstalledPackage, type ResolveInstalledPackageOptions } from '../resolve-npm-package.js';
import type { StagedFile } from './types.js';

/**
 * The targets a relocated GTK closure is published for.
 *
 * The same three `@gjsify/gtk-runtime-*` packages node-gi resolves, and
 * deliberately NOT derived from {@link NODE_RUNTIME_TARGETS}: the two lists agree
 * today by coincidence of which platforms lack a dependable system stack, and
 * deriving one from the other would make a future Linux GTK bundle silently imply
 * a bundled Linux interpreter (which `node-runtime.ts` refuses on purpose).
 */
export const GTK_RUNTIME_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const;

export type GtkRuntimeTarget = (typeof GTK_RUNTIME_TARGETS)[number];

/** Is this `<platform>-<arch>` one of the published GTK-closure targets? */
export function isGtkRuntimeTarget(target: string): target is GtkRuntimeTarget {
    return (GTK_RUNTIME_TARGETS as readonly string[]).includes(target);
}

/** The npm name carrying the relocated closure for a target. One spelling, derived. */
export function gtkRuntimePackageName(target: GtkRuntimeTarget): string {
    return `@gjsify/gtk-runtime-${target}`;
}

/** The addon's filename, node-gi's `ADDON_FILENAME`. Identical in every prebuild. */
export const NODE_GI_ADDON_FILENAME = 'node_gi.node';

/** The package whose `prebuilds/<target>/` holds the addon and, in CI, the closure beside it. */
export const NODE_GI_PACKAGE = '@gjsify/node-gi';

/** Where the relocated GTK closure is, once found. */
export interface ResolvedGtkRuntime {
    /** What produced the hit — an env var name, or the npm name it was resolved from. */
    source: string;
    /** The bundle directory: the one holding `lib/`, `girepository-1.0/`, `share/`. */
    dir: string;
    /** `<dir>/lib` on darwin, `<dir>/bin` on win32 — the loadable-code directory. */
    libDir: string;
    /** `<dir>/girepository-1.0`. */
    typelibDir: string;
}

/** Where the node-gi addon is, once found. */
export interface ResolvedNodeGiAddon {
    /** The npm name it was resolved from. */
    source: string;
    /** Absolute path to `node_gi.node`. */
    addonPath: string;
}

export interface ResolveRuntimeOptions {
    /** Project directory to resolve from — the consumer's, not gjsify's. */
    cwd?: string;
    /** Environment to read the overrides from. Injected so it is testable. */
    env?: Record<string, string | undefined>;
    /**
     * TEST SEAM, passed through to {@link resolveInstalledPackage} — resolve a
     * specifier from one anchor. A fake answering the SAME path for both anchors
     * is Bun's global-cache behaviour, which is otherwise unreachable from Node.
     */
    resolve?: ResolveInstalledPackageOptions['resolve'];
}

/**
 * Locate the relocated GTK closure for `target`, or `null`.
 *
 * The search order MIRRORS `resolveGtkRuntimeBundle()` rather than inventing a
 * second one, because the two have to agree: this function decides what gets
 * copied into the bundle, and that function decides what the bundle finds at
 * runtime. Four candidates, first complete hit wins:
 *
 *  1. `GJSIFY_GTK_RUNTIME` — an explicit bundle directory, for a maintainer
 *     holding an unpublished or patched closure. The same variable the launcher
 *     later EXPORTS, and the same precedence it has there.
 *  2. `@gjsify/node-gi`'s own `prebuilds/<target>/gtk`. This is the layout the
 *     macOS CI legs stage by hand (`node-gi.yml`: download the bundle artifact
 *     into `prebuilds/darwin-<arch>/gtk`, the addon beside it), so a job that has
 *     prepared node-gi for a conformance run has, by that act alone, prepared it
 *     for a ship run.
 *  3. the sibling monorepo directory `../gtk-runtime-<target>/gtk`, which is what
 *     an in-repo `npm run build:bundle` writes.
 *  4. the published `@gjsify/gtk-runtime-<target>` package's `gtk/`.
 *
 * A candidate counts only when it holds BOTH the loadable-code directory and the
 * typelib directory — node-gi's own probe, restated here rather than weakened,
 * because a directory that passes here and fails there is a `.app` that ships
 * 200 MB and still cannot open a window.
 */
export function resolveGtkRuntime(
    target: GtkRuntimeTarget,
    options: ResolveRuntimeOptions = {},
): ResolvedGtkRuntime | null {
    const env = options.env ?? process.env;
    // `bin` on win32, `lib` everywhere else — the NAME differs, the ROLE does not
    // (`gtk-runtime.js`'s `nativeSubdir`). Read off the TARGET and never
    // `process.platform`: assembling a win32 tree from Linux is a supported path.
    const nativeSubdir = target.startsWith('win32-') ? 'bin' : 'lib';
    const candidates: { source: string; dir: string }[] = [];

    const override = env['GJSIFY_GTK_RUNTIME'];
    if (override) candidates.push({ source: 'GJSIFY_GTK_RUNTIME', dir: override });

    const nodeGiRoot = resolveNodeGiRoot(options);
    if (nodeGiRoot !== null) {
        candidates.push({
            source: `${NODE_GI_PACKAGE}/prebuilds/${target}`,
            dir: join(nodeGiRoot, 'prebuilds', target, 'gtk'),
        });
        candidates.push({
            source: `${NODE_GI_PACKAGE} sibling`,
            dir: join(nodeGiRoot, '..', `gtk-runtime-${target}`, 'gtk'),
        });
    }

    const packageName = gtkRuntimePackageName(target);
    const entry = resolveStagedPackage(packageName, options);
    if (entry !== null) candidates.push({ source: packageName, dir: join(dirname(entry), 'gtk') });

    for (const candidate of candidates) {
        const libDir = join(candidate.dir, nativeSubdir);
        const typelibDir = join(candidate.dir, 'girepository-1.0');
        if (!existsSync(libDir) || !existsSync(typelibDir)) continue;
        return { source: candidate.source, dir: candidate.dir, libDir, typelibDir };
    }
    return null;
}

/**
 * Locate the node-gi addon built for `target`, or `null`.
 *
 * ONE source, and no override. The addon and the closure ship as a matched pair —
 * the addon's `@rpath` is `@loader_path/gtk/lib`, so it names the very directory
 * the closure occupies — and `@gjsify/node-gi` publishes `prebuilds/` for all five
 * of its platforms in ONE package, so resolving the package by name is already
 * enough to reach a foreign target's binary from a Linux host. A second
 * environment knob here would be a way to pair an addon with a closure it was not
 * built against, which is #910's failure shape wearing a convenience.
 */
export function resolveNodeGiAddon(
    target: GtkRuntimeTarget,
    options: ResolveRuntimeOptions = {},
): ResolvedNodeGiAddon | null {
    const root = resolveNodeGiRoot(options);
    if (root === null) return null;
    const addonPath = join(root, 'prebuilds', target, NODE_GI_ADDON_FILENAME);
    // A package resolved but not POPULATED is `null`, not a path — `prebuilds/` is
    // gitignored, so an in-repo checkout is exactly what that looks like, and a
    // path to a file that is not there fails later, in a copy, with the target's
    // name nowhere in the message. Same rule as `node-runtime.ts`'s `complete()`.
    return existsSync(addonPath) ? { source: NODE_GI_PACKAGE, addonPath } : null;
}

/** `@gjsify/node-gi`'s package root, or `null` when it is not resolvable from here. */
function resolveNodeGiRoot(options: ResolveRuntimeOptions): string | null {
    const entry = resolveStagedPackage(NODE_GI_PACKAGE, options);
    return entry === null ? null : dirname(entry);
}

/**
 * Resolve a package whose BYTES this module stages into a redistributed artifact.
 *
 * `resolveInstalledPackage`, never `resolveNpmPackage`: under Bun the latter
 * answers from the runtime's global install cache for a project that merely has a
 * `package.json` and no `node_modules`, which would put files the author never
 * declared inside a `.app`. See that function for the measurement.
 */
function resolveStagedPackage(specifier: string, options: ResolveRuntimeOptions): string | null {
    const opts: ResolveInstalledPackageOptions = { bundleUrl: import.meta.url };
    if (options.cwd !== undefined) opts.cwd = options.cwd;
    if (options.resolve !== undefined) opts.resolve = options.resolve;
    return resolveInstalledPackage(specifier, opts);
}

/** node-gi's JavaScript, as package-relative paths. */
export interface ResolvedNodeGiPackage {
    source: string;
    /** The package root the files are relative to. */
    root: string;
    /** POSIX-separated, package-relative — `package.json`, the root `.js`, `overrides/**`. */
    files: string[];
}

/**
 * The files a SHIPPED `.app` needs from `@gjsify/node-gi`, or `null`.
 *
 * NOT the published tarball. `files` in node-gi's manifest also lists `src/`,
 * `binding.gyp` and `scripts/install.mjs` — the inputs to `node-gyp`, which a
 * `.app` never runs — and the `.d.ts` declarations, which nothing inside a bundle
 * compiles against. And it lists `prebuilds/`, which this module stages into
 * `Contents/Frameworks` instead, where a `.app` keeps loadable code.
 *
 * So the rule is what `require('@gjsify/node-gi/<subpath>')` can REACH:
 * `package.json` (the `exports` map is what resolves every subpath), every `.js`
 * at the package root (every `exports` target is one), and `overrides/`, which
 * `gi.js` loads at runtime. `tests/e2e/ship-macos` holds that rule against the
 * REAL package's `exports` map, so a node-gi release that adds an entry outside
 * this set fails there rather than in a `.app` a stranger downloaded.
 */
export function resolveNodeGiPackage(options: ResolveRuntimeOptions = {}): ResolvedNodeGiPackage | null {
    const root = resolveNodeGiRoot(options);
    if (root === null) return null;
    const files: string[] = ['package.json'];
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.isFile() && entry.name.endsWith('.js')) files.push(entry.name);
    }
    const overrides = join(root, 'overrides');
    if (existsSync(overrides)) {
        for (const rel of listFilesRecursive(overrides)) files.push(posix.join('overrides', rel));
    }
    // One `.js` is the floor: a package whose root holds only `package.json` is a
    // directory that resolved and a runtime that is not there, and staging it would
    // produce a `.app` failing at `require` with node-gi's name in the message and
    // nothing to act on.
    return files.length > 1 ? { source: NODE_GI_PACKAGE, root, files: files.sort() } : null;
}

/**
 * Where each piece of the runtime lands inside the bundle — STAGE-relative.
 *
 * PURE, and derived from `Layout.dirs` rather than from a second set of string
 * literals, so the paths the launcher exports and the paths the stager writes
 * cannot drift: they are computed here once and both callers read this result.
 *
 * `Contents/Frameworks/node-gi/prebuilds/<target>/` is node-gi's OWN sibling
 * layout reproduced verbatim inside `dirs.native`. It is not a naming preference:
 * `resolveGtkRuntimeBundle()` probes `<dir>/lib` and `<dir>/girepository-1.0`,
 * the addon's `@rpath` is `@loader_path/gtk/lib`, and `loaders.cache` addresses
 * each pixbuf loader relative to the bundle toplevel. Reproducing the shape is
 * what makes every one of those relations still true after the copy.
 */
export interface AppRuntimePaths {
    /** `<App>.app/Contents/Frameworks/node-gi` — the package root the layout imitates. */
    nodeGiRoot: string;
    /**
     * `<App>.app/Contents/Resources/lib/node_modules/@gjsify/node-gi` — where
     * node-gi's JAVASCRIPT goes.
     *
     * Not a preference: `require('@gjsify/node-gi/gi')` from the staged bundle at
     * `Contents/Resources/lib/<bundle>.mjs` walks `node_modules` upward from that
     * file's own directory, and this is the FIRST directory that walk visits. Any
     * other location works only by accident of what sits above the bundle.
     */
    nodeGiPackageDir: string;
    /** `<nodeGiRoot>/prebuilds/<target>` — the addon and the closure, siblings. */
    prebuildDir: string;
    /** `<prebuildDir>/gtk` — what `GJSIFY_GTK_RUNTIME` names. */
    gtkDir: string;
    /** `<prebuildDir>/node_gi.node` — what `NODE_GI_NATIVE` pins. */
    addonPath: string;
    /**
     * `<App>.app/Contents/MacOS/node`, or `<program dir>/node.exe` — beside the
     * launcher that execs it, under the name the target's own release uses.
     */
    interpreterPath: string;
    /** Node's own LICENSE, under `Contents/Resources` (macOS) or `share/` (Windows). */
    interpreterLicensePath: string;
}

export function appRuntimePaths(layout: Layout, identity: LayoutIdentity, target: GtkRuntimeTarget): AppRuntimePaths {
    const dirs = layout.dirs(identity);
    const nodeGiRoot = posix.join(dirs.native, 'node-gi');
    const prebuildDir = posix.join(nodeGiRoot, 'prebuilds', target);
    return {
        nodeGiRoot,
        nodeGiPackageDir: posix.join(dirs.bundle, 'node_modules', NODE_GI_PACKAGE),
        prebuildDir,
        gtkDir: posix.join(prebuildDir, 'gtk'),
        addonPath: posix.join(prebuildDir, NODE_GI_ADDON_FILENAME),
        // `Contents/MacOS`, because that is where a `.app` keeps executables and
        // because `$here` — which the launcher already computes — is then the whole
        // path expression. `Contents/Frameworks` would work for dyld and would make
        // the launcher walk back up for the one file it execs. On Windows
        // `dirs.launcher` is the program directory itself, so the interpreter lands
        // beside the `.cmd` for the same reason.
        //
        // THE LEAF COMES FROM `node-runtime.ts`, which is the module that already
        // decided it for the SOURCE file — `node.exe` on win32, `node` elsewhere,
        // read off the TARGET and never `process.platform` (assembling a Windows
        // program directory on Linux is the supported path). Restating the rule here
        // would let the two drift into a stage that copies `node.exe` to `node` and a
        // launcher that execs neither.
        interpreterPath: posix.join(dirs.launcher, nodeRuntimeBinaryName(target)),
        // rpm's `share/licenses/<name>/LICENSE` shape, which the `macos-app` row
        // already uses for the app's own licence — one layout for a reader to learn,
        // and `node` is a name no `binaryName` can collide with silently: `placeStage`
        // refuses the collision by name.
        interpreterLicensePath: posix.join(dirs.data, 'licenses', 'node', 'LICENSE'),
    };
}

/** What the launcher must export and exec, once the runtime is staged. Absent member = not staged. */
export interface LauncherRuntime {
    /** Stage-relative path of the interpreter the bundle carries. */
    interpreter?: string;
    /** Stage-relative path of the GTK closure — `GJSIFY_GTK_RUNTIME`. */
    gtkRuntimeDir?: string;
    /** Stage-relative path of the node-gi addon — `NODE_GI_NATIVE`. */
    nodeGiAddon?: string;
}

/** The staged runtime, and an account of what was and was not found. */
export interface StagedAppRuntime {
    /** Stage-relative files, already placed — they never passed through the prefix-relative plan. */
    files: StagedFile[];
    /** What the launcher can now name. */
    launcher: LauncherRuntime;
    /** One line per piece that WAS found, naming where it came from. */
    found: string[];
    /** One line per piece that was not, naming the package to install. */
    missing: string[];
}

export interface StageAppRuntimeInput {
    layout: Layout;
    identity: LayoutIdentity;
    /** `${layout.os}-${settings.arch}` — the target the payload was built for. */
    target: GtkRuntimeTarget;
    /** Project directory the three packages are resolved from. */
    cwd: string;
    /** Injected so the overrides are testable. */
    env?: Record<string, string | undefined>;
    /** Passed to every discovery below — see {@link ResolveRuntimeOptions.resolve}. */
    resolve?: ResolveRuntimeOptions['resolve'];
    /** The interpreter, already resolved — see `node-runtime.ts`. `null` when absent. */
    interpreter: { source: string; nodePath: string; licensePath: string } | null;
}

/**
 * Stage the interpreter, the GTK closure and the addon into one bundle.
 *
 * PARTIAL BY DESIGN, and reported. An all-or-nothing rule would drop a 200 MB
 * closure that IS present because an interpreter that is not shares the milestone
 * with it, and would do it at exit 0 — while a bundle carrying the closure and no
 * interpreter is a real, useful intermediate (it runs wherever a Node is on
 * `PATH`, which is every developer's machine and no stranger's). So each piece is
 * staged when found and named when not, and `commands/ship.ts` keeps
 * `Layout.runtimeGap` for precisely the case where the interpreter is still
 * missing.
 *
 * TREE-PRESERVING for the closure and FLAT for the other two, which is the whole
 * distinction this module exists to draw: `listFilesRecursive` walks the bundle
 * and every relative path is carried through unchanged, so
 * `lib/gdk-pixbuf-2.0/2.10.0/loaders/libpixbufloader-svg.so` is still four levels
 * under `gtk/` on the other side of the copy.
 */
export function stageAppRuntime(input: StageAppRuntimeInput): StagedAppRuntime {
    const paths = appRuntimePaths(input.layout, input.identity, input.target);
    const files: StagedFile[] = [];
    const launcher: LauncherRuntime = {};
    const found: string[] = [];
    const missing: string[] = [];

    if (input.interpreter !== null) {
        files.push({
            path: paths.interpreterPath,
            mode: 0o755,
            source: { kind: 'file', path: input.interpreter.nodePath },
        });
        // The licence travels with the binary or neither does — `ResolvedNodeRuntime`
        // makes that a property of the RESULT for this reason, and this is the caller
        // that would otherwise have been free to forget it.
        files.push({
            path: paths.interpreterLicensePath,
            mode: 0o644,
            source: { kind: 'file', path: input.interpreter.licensePath },
        });
        launcher.interpreter = paths.interpreterPath;
        found.push(`interpreter from ${input.interpreter.source}`);
    } else {
        missing.push(
            `no bundled interpreter — install \`@gjsify/node-runtime-${input.target}\` (or point ` +
                '`GJSIFY_NODE_RUNTIME` at a `bin/` directory holding `node` and its `LICENSE`)',
        );
    }

    const gtk = resolveGtkRuntime(input.target, discoveryOptions(input));
    if (gtk !== null) {
        for (const rel of listFilesRecursive(gtk.dir)) {
            const abs = join(gtk.dir, rel.split('/').join(sep));
            files.push({
                path: posix.join(paths.gtkDir, rel),
                mode: stagedMode(rel, abs),
                source: { kind: 'file', path: abs },
            });
        }
        launcher.gtkRuntimeDir = paths.gtkDir;
        found.push(`GTK closure from ${gtk.source}`);
    } else {
        missing.push(
            `no GTK closure — install \`${gtkRuntimePackageName(input.target)}\` (or point ` +
                '`GJSIFY_GTK_RUNTIME` at a bundle directory holding `lib/` and `girepository-1.0/`)',
        );
    }

    // node-gi's JavaScript, which the bundle `require`s by name. Staged whenever
    // the package is resolvable and reported separately from the addon: a bundle
    // that carries the JS and no addon fails with node-gi's own diagnosis
    // (`load-diagnostics.js`), while one that carries the addon and no JS fails at
    // `require` before anything of node-gi's has run.
    const js = resolveNodeGiPackage(discoveryOptions(input));
    if (js !== null) {
        for (const rel of js.files) {
            files.push({
                path: posix.join(paths.nodeGiPackageDir, rel),
                mode: 0o644,
                source: { kind: 'file', path: join(js.root, rel.split('/').join(sep)) },
            });
        }
        found.push(`node-gi runtime (${js.files.length} file(s)) from ${js.source}`);
    } else {
        missing.push(
            `no node-gi JavaScript — install \`${NODE_GI_PACKAGE}\`; a \`--app node\` bundle keeps ` +
                '`@gjsify/node-gi/*` external, so the staged bundle would `require` a package the artifact ' +
                'does not carry',
        );
    }

    const addon = resolveNodeGiAddon(input.target, discoveryOptions(input));
    if (addon !== null) {
        files.push({ path: paths.addonPath, mode: 0o755, source: { kind: 'file', path: addon.addonPath } });
        launcher.nodeGiAddon = paths.addonPath;
        found.push(`node-gi addon from ${addon.source}`);
    } else {
        missing.push(
            `no node-gi addon — install \`${NODE_GI_PACKAGE}\`, whose \`prebuilds/${input.target}/` +
                `${NODE_GI_ADDON_FILENAME}\` is the binary built against that closure`,
        );
    }

    return { files, launcher, found, missing };
}

/**
 * The discovery options every piece is looked up with.
 *
 * ONE function, so a field added to {@link StageAppRuntimeInput} cannot reach two
 * of the three lookups and miss the third. It missed all three once already:
 * `resolve` was declared on the input, spelled correctly at the call site in the
 * spec, and silently dropped here — `packages/infra/cli/tsconfig.json` excludes
 * `src/**` + `.spec.ts`, so no excess-property check ever ran on it and the test
 * that was supposed to red the global-cache guard passed with the guard removed.
 */
function discoveryOptions(input: StageAppRuntimeInput): ResolveRuntimeOptions {
    const options: ResolveRuntimeOptions = {};
    if (input.cwd !== undefined) options.cwd = input.cwd;
    if (input.env !== undefined) options.env = input.env;
    if (input.resolve !== undefined) options.resolve = input.resolve;
    return options;
}

/**
 * The mode one staged closure file gets.
 *
 * THREE tests, and each covers a case the others do not:
 *
 *  * the source's own execute bit — the truth when the closure came off a real
 *    filesystem, and the ONLY thing that knows `libexec/gstreamer-1.0/gst-plugin-scanner`
 *    is a program (it has no extension, and GStreamer forks it out-of-process so a
 *    plugin that crashes on load cannot take the app down with it);
 *  * the shared-library spelling, shared with `plan.ts` rather than restated —
 *    load-bearing because `actions/upload-artifact` stores NO POSIX mode, so a
 *    closure that arrived through a CI artifact has 0644 on every file and the
 *    source-mode test above is blind on exactly the path this milestone's own CI
 *    leg takes;
 *  * `libexec/` and `bin/`, for the same reason applied to the extensionless
 *    programs the artifact round trip flattened.
 *
 * A dylib does not need the execute bit to be `dlopen`'d, so this is not about
 * making the closure loadable — it is about the two files that are EXEC'd.
 */
function stagedMode(rel: string, abs: string): number {
    if (isExecutableAsset(rel)) return 0o755;
    if (rel.startsWith('libexec/') || rel.startsWith('bin/')) return 0o755;
    try {
        if ((statSync(abs).mode & 0o111) !== 0) return 0o755;
    } catch {
        // Unreadable here means unreadable in the copy too, and `writeStage` is
        // where that gets reported against the path it happened on.
    }
    return 0o644;
}
