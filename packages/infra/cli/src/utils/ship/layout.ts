// WHERE a payload's files land, per operating system (ADR 0024 § 2, § A2).
//
// The payload is produced ONCE and is identical everywhere; what differs is the
// layout. Up to here that difference was a single string — `FormatDescriptor.prefix`,
// `/usr` for deb and rpm, `/app` for a Flatpak — because every Linux format keeps
// the same `bin/`, `lib/<name>/`, `share/…` shape underneath it. `Contents/MacOS`
// is the first layout that is NOT a prefix substitution: the launcher, the bundle,
// the shared libraries and the data tree each move somewhere different, and on
// macOS the native files leave the bundle directory altogether for
// `Contents/Frameworks`.
//
// So the layout is a MAP from the prefix-relative plan to a stage-relative path,
// and `planStage` keeps producing the prefix-relative plan for all three. That
// split is what makes the claim checkable: one payload, three layouts, and the
// file SET has to be identical modulo this map (`tests/e2e/ship-layout`).
//
// It also draws the line a third-party app author needs. Everything structural
// here belongs to the OS — `Contents/MacOS` is Apple's, `%~dp0` is cmd.exe's.
// Everything with a NAME in it comes from the consumer's own `gjsify.ship` block:
// the `<App>.app` directory is `name`, the launcher inside it is `binaryName`, and
// the data tree is addressed by `appId`. Nothing here is derived from gjsify's own
// tree, and nothing here has a gjsify-specific default.

import { posix } from 'node:path';

import type { HostOs, StagedFile } from './types.js';

/**
 * The positional `gjsify ship <os>` takes, in ADR 0024 § A2's spelling.
 *
 * NOT the same vocabulary as {@link HostOs}, and the difference is deliberate
 * rather than sloppy: § A2 writes `gjsify ship windows --stage`, while the
 * repo-wide target spelling is `${process.platform}-${process.arch}` and
 * therefore `win32-x64` (root AGENTS.md § Runtime & platform model). Both are
 * accepted on the command line and exactly one is ever RECORDED — the stage
 * manifest's `target.os` is a `HostOs`, so `--expect-target win32-x64` keeps
 * meaning what it meant.
 */
export type LayoutName = 'linux' | 'darwin' | 'windows';

/** The layout-affecting half of `ShipSettings` — a display name and a binary name, nothing else. */
export interface LayoutIdentity {
    /** Package name: the launcher's own filename. */
    binaryName: string;
    /** Human-readable display name — the `<App>.app` directory a user sees in Finder. */
    name: string;
}

/** The four places a payload file can belong, as stage-relative directories. */
export interface LayoutDirs {
    /** Where the launcher lives. */
    launcher: string;
    /** Where the app's own bundle tree lives. */
    bundle: string;
    /** Where the typelibs and shared libraries the app CARRIES live. */
    native: string;
    /** Where the XDG-shaped data tree lives (icons, schemas, metainfo, locale). */
    data: string;
    /**
     * Where a prefix-relative path that sorts into none of the above goes.
     *
     * Reachable only through `gjsify.ship.extraFiles`, whose destinations are
     * documented as prefix-relative and may name anything. On macOS that has to
     * land inside `Contents/`, or the file sits beside it where nothing in the
     * bundle can address it and `codesign` later refuses the bundle.
     */
    other: string;
}

/**
 * One operating system's layout.
 *
 * Data, not code: adding a fourth OS is a row here plus a launcher form, the same
 * way adding a format is a row in `FORMATS`. The one function is {@link place},
 * and it is shared by all three.
 */
export interface Layout {
    /** The positional that selects this layout. */
    name: LayoutName;
    /** The `process.platform` token recorded in the stage manifest's `target.os`. */
    os: HostOs;
    /**
     * The runtime ADR 0024 § 4 DERIVES for a shipped artifact on this OS.
     *
     * Recorded, not obeyed: it is what #1354 M0's platform packages implement,
     * and it is NOT what the staged launcher execs today. Linux takes GJS from
     * the distribution and the emitted `Depends: gjs` backs it; both other OSes
     * take Node, because Node + `@gjsify/node-gi` + `@gjsify/gtk-runtime-<os>-<arch>`
     * is the only combination either OS's CI proves.
     *
     * Keeping it as DATA rather than as a launcher decision is the whole of what
     * M1 may honestly claim. A layout with no packer produces no installable
     * artifact, so writing `exec node` into a stage assembled from a `--app gjs`
     * bundle would put a runtime that cannot read the payload in front of it —
     * the exact defect `assertShippableTarget` exists to prevent, produced by the
     * code meant to prevent it. Measured before this was data: `gjsify ship
     * darwin --stage` on a project with no `gjsify.app` key exited 0 and staged
     * `exec node "$contents/Resources/lib/gjs.js"` in front of a bundle whose
     * first line is `import Gtk from 'gi://Gtk?version=4.0'`.
     */
    shippedRuntime: 'gjs' | 'node';
    /**
     * Why the staged launcher cannot name {@link shippedRuntime} yet, or absent
     * when it already does.
     *
     * PRINTED at stage time rather than left as a comment: a tree whose launcher
     * execs an interpreter the target OS may not have is a fact its author has to
     * know, and it is the same fact that retires this field when M0 lands.
     */
    runtimeGap?: string;
    /** Suffix the launcher's filename carries, `''` where the OS needs none. */
    launcherExt: string;
    /**
     * The directory inside the STAGE that this layout hangs under, or `''` when
     * the stage root IS the layout root.
     *
     * The asymmetry is the OS's, not ours. A `<App>.app` is the artifact — it is
     * dragged to `/Applications` as one unit, so the stage has to carry the
     * directory itself. A Windows program directory is NOT: the installer chooses
     * `C:\Program Files\<Publisher>\<App>` and lays the stage's contents into it,
     * so a wrapper directory here would become a doubled path there.
     */
    root: (identity: LayoutIdentity) => string;
    /** The four destinations, resolved against one app's names. */
    dirs: (identity: LayoutIdentity) => LayoutDirs;
}

/**
 * Characters a `<App>.app` directory name may not contain.
 *
 * `/` is the POSIX separator and `:` is HFS+'s — the Finder shows a stored `:` as
 * a `/` and vice versa, so a name carrying either produces a bundle whose
 * directory is not the one its own metadata names. Refused here rather than at
 * `hdiutil` time, which is three milestones away and on another host.
 */
const BUNDLE_NAME_FORBIDDEN = /[/:\\]/;

function appBundleDir(identity: LayoutIdentity): string {
    if (BUNDLE_NAME_FORBIDDEN.test(identity.name)) {
        throw new Error(
            `gjsify ship: the macOS layout would put this app in "${identity.name}.app", and a bundle ` +
                'directory may contain no "/", "\\" or ":" — HFS+ and the Finder swap the first two, so the ' +
                'bundle would not be the one its own metadata names. Set `gjsify.ship.name` to the display ' +
                'name you want on disk.',
        );
    }
    return `${identity.name}.app`;
}

export const LAYOUTS: Record<LayoutName, Layout> = {
    linux: {
        name: 'linux',
        os: 'linux',
        shippedRuntime: 'gjs',
        launcherExt: '',
        root: () => '',
        // The app id in the directory name is what makes `/usr/lib/<pkg>/` a
        // directory the PACKAGE owns — the prefix is shared with every other
        // package on the system. Inside a `.app` or a program directory nothing
        // is shared, which is why the other two rows drop it.
        dirs: (identity) => ({
            launcher: 'bin',
            bundle: `lib/${identity.binaryName}`,
            native: `lib/${identity.binaryName}/gi`,
            data: 'share',
            other: '',
        }),
    },
    darwin: {
        name: 'darwin',
        os: 'darwin',
        shippedRuntime: 'node',
        // GJS does exist on macOS — Homebrew ships it and the `macos` CI leg runs
        // `test:gjs` on both arches — so a launcher naming it is true of a
        // developer's machine and NOT of a `.app` a stranger downloads:
        // `packages/node-gi/scripts/build-gtk-runtime-darwin.mjs` records that GJS
        // ships no relocation, which is why § 4 derives Node here.
        runtimeGap:
            'the staged launcher execs an interpreter off `PATH`, which a downloaded `.app` cannot assume — ' +
            'macOS ships no Node, and there is no RELOCATABLE GJS (`build-gtk-runtime-darwin.mjs`: "GJS ' +
            'ships no relocation"), so ADR 0024 § 4 derives Node here. A self-contained bundle needs `@gjsify/node-runtime-darwin-<arch>` and a ' +
            '`--app node` payload (#1354 M0), or `@gjsify/gjs-runtime-darwin-<arch>` (ADR 0024 stage 7).',
        launcherExt: '',
        root: appBundleDir,
        // Apple's, all four. `Contents/MacOS` holds executables, `Contents/Resources`
        // everything that is not, and `Contents/Frameworks` the dylibs — which is
        // the split that makes this more than a prefix: the `gi/` directory that
        // sits INSIDE `lib/<name>/` on Linux leaves the bundle directory entirely.
        dirs: (identity) => {
            const app = appBundleDir(identity);
            return {
                launcher: `${app}/Contents/MacOS`,
                bundle: `${app}/Contents/Resources/lib`,
                native: `${app}/Contents/Frameworks`,
                data: `${app}/Contents/Resources/share`,
                other: `${app}/Contents/Resources`,
            };
        },
    },
    windows: {
        name: 'windows',
        os: 'win32',
        shippedRuntime: 'node',
        // The stronger of the two gaps, and not a relocation question: there is
        // no GJS host on Windows AT ALL, so nothing on that OS can run a
        // `--app gjs` payload until M0's bundled Node exists and the payload is
        // built for it. Cited to ADR 0024 § 4, which is where the fact is
        // established — an earlier version of this string cited
        // `docs/ci-selective.md`, which contains no occurrence of it and whose
        // four `gjs` mentions are all about the affected-classifier bundle. The
        // bad citation came in from the ADR's own § 4 table and was promoted into
        // a user-visible string, which is the worst place for one.
        runtimeGap:
            'the staged launcher execs an interpreter off `PATH`, and Windows ships neither: there is NO ' +
            'GJS host on Windows at all (ADR 0024 § 4) — so this tree cannot run there yet. § 4 derives ' +
            'Node; it arrives with `@gjsify/node-runtime-win32-x64` and a `--app node` payload (#1354 M0).',
        // `.cmd`, not `.bat`: the two differ in whether a failing built-in (`set`,
        // `path`, `append`) sets ERRORLEVEL, and `.cmd` is the one where it does.
        launcherExt: '.cmd',
        root: () => '',
        // A program directory has no imposed shape, so this one is chosen for the
        // LOADER: `lib/` is what the launcher prepends to `PATH`, because Windows
        // has no rpath — a DLL is found on `PATH`, in the directory of the image
        // that loaded it, or not at all.
        dirs: () => ({ launcher: '', bundle: 'app', native: 'lib', data: 'share', other: '' }),
    },
};

/** Every layout name, derived from the table so a new row cannot be missed. */
export const LAYOUT_NAMES: LayoutName[] = Object.keys(LAYOUTS) as LayoutName[];

/**
 * `HostOs` → the layout for it.
 *
 * Derived rather than a second table: `LAYOUTS` is already total over
 * `LayoutName`, so reading its rows back means a fourth OS cannot be added to one
 * list and forgotten in the other.
 */
const BY_OS = new Map<HostOs, Layout>(LAYOUT_NAMES.map((name) => [LAYOUTS[name].os, LAYOUTS[name]]));

/** Stage-relative path of the launcher this layout puts in front of the app. */
export function launcherPath(layout: Layout, identity: LayoutIdentity): string {
    return posix.join(layout.dirs(identity).launcher, `${identity.binaryName}${layout.launcherExt}`);
}

/**
 * The layout for one `process.platform` token, refusing every alias.
 *
 * STRICT, and that is the difference from {@link resolveLayout}, which is for a
 * word a human typed. This one is for the stage manifest's `target.os` — a
 * cross-host WIRE FORMAT with exactly one legal spelling per OS. Accepting
 * `"windows"` there and silently comparing it as `win32` would mean
 * `--expect-target win32-x64` no longer compares against the file's content:
 * two manifests with different bytes in that field would both match, and the
 * flag's whole job is to catch a job that downloaded the wrong artifact.
 */
export function layoutForOs(os: string): Layout {
    const layout = BY_OS.get(os as HostOs);
    if (layout === undefined) {
        throw new Error(
            `"${os}" is not a \`process.platform\` token this gjsify has a layout for. ` +
                `Known: ${LAYOUT_NAMES.map((name) => LAYOUTS[name].os).join(', ')} — the ` +
                '`${process.platform}-${process.arch}` spelling, so `win32` and never `windows`.',
        );
    }
    return layout;
}

/**
 * Resolve the positional to a layout.
 *
 * Accepts BOTH vocabularies (`windows` and `win32`) for the reason
 * {@link LayoutName} records: the ADR writes one and `--expect-target` prints the
 * other, and refusing whichever the user has in front of them is a papercut with
 * no upside. The canonical answer is a single `Layout`, so nothing downstream has
 * two spellings to reconcile. NOT for the stage manifest — see {@link layoutForOs}.
 */
export function resolveLayout(raw: string): Layout {
    const name = raw.trim().toLowerCase();
    if (Object.hasOwn(LAYOUTS, name)) return LAYOUTS[name as LayoutName];
    const byOs = BY_OS.get(name as HostOs);
    if (byOs !== undefined) return byOs;
    throw new Error(
        `gjsify ship: "${raw}" is not an operating system this command has a layout for. ` +
            `Known: ${LAYOUT_NAMES.join(', ')} (\`win32\` is accepted for \`windows\`, because that is the ` +
            'spelling `--expect-target <os>-<arch>` uses).',
    );
}

/**
 * The layout for the host this process is running on.
 *
 * What `gjsify ship` picks when the positional is absent, so a bare `gjsify ship`
 * on Linux keeps assembling the Linux layout and packing `.deb` + `.rpm` exactly
 * as before. A host whose platform has no layout is refused BY NAME rather than
 * silently treated as Linux — a payload laid out for `/usr` and labelled for a
 * FreeBSD would install and not run.
 */
export function hostLayout(platform: string = process.platform): Layout {
    const layout = BY_OS.get(platform as HostOs);
    if (layout === undefined) {
        throw new Error(
            `gjsify ship: this host is ${platform}, which has no layout. Name the one you want — ` +
                `\`gjsify ship <${LAYOUT_NAMES.join('|')}> --stage\` — assembly is not host-bound ` +
                '(ADR 0024 § A1).',
        );
    }
    return layout;
}

/**
 * Map one PREFIX-RELATIVE planned path to where this layout keeps it.
 *
 * The plan is written once, in the Linux/XDG shape, and this is the only place
 * that knows any other. Order matters: `lib/<name>/gi/` is tested before
 * `lib/<name>/`, because on macOS those two go to different directories.
 */
export function place(layout: Layout, identity: LayoutIdentity, rel: string): string {
    const dirs = layout.dirs(identity);
    if (rel === `bin/${identity.binaryName}`) return launcherPath(layout, identity);

    const libPrefix = `lib/${identity.binaryName}/`;
    const giPrefix = `${libPrefix}gi/`;
    if (rel.startsWith(giPrefix)) return posix.join(dirs.native, rel.slice(giPrefix.length));
    if (rel.startsWith(libPrefix)) return posix.join(dirs.bundle, rel.slice(libPrefix.length));
    if (rel.startsWith('bin/')) return posix.join(dirs.launcher, rel.slice('bin/'.length));
    if (rel.startsWith('share/')) return posix.join(dirs.data, rel.slice('share/'.length));
    return posix.join(dirs.other, rel);
}

/**
 * Apply a layout to a whole planned payload.
 *
 * The uniqueness check is not decoration. `planStage` deduplicates on the
 * PREFIX-RELATIVE path — that is how `gjsify.ship.extraFiles` is documented to
 * override a default — but the MAP can bring two distinct prefix-relative paths
 * together: on Windows the launcher becomes `<binaryName>.cmd` at the program
 * root, which an `extraFiles` destination can name directly. Without this the
 * second one silently wins and which one that is depends on plan order — the
 * "installs cleanly, does nothing" class this command is built against.
 */
export function placeStage(layout: Layout, identity: LayoutIdentity, files: readonly StagedFile[]): StagedFile[] {
    const byPlaced = new Map<string, string>();
    const out: StagedFile[] = [];
    for (const file of files) {
        const path = place(layout, identity, file.path);
        const previous = byPlaced.get(path);
        if (previous !== undefined) {
            throw new Error(
                `gjsify ship: in the ${layout.name} layout both ${previous} and ${file.path} install as ` +
                    `${path}. Two payload files cannot share one destination — one would silently replace the ` +
                    'other. Rename the `gjsify.ship.extraFiles` destination that collides.',
            );
        }
        byPlaced.set(path, file.path);
        out.push({ ...file, path });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
