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

import { BUNDLE_INFO_PLIST, BUNDLE_PKGINFO, renderInfoPlist, renderPkgInfo } from './plist.js';
import { SHARE } from './share-dirs.js';
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

/**
 * What a layout needs to render the metadata it OWNS.
 *
 * `LayoutIdentity` plus the three fields an `Info.plist` names the app by. It
 * EXTENDS the identity rather than sitting beside it so `placeStage` keeps taking
 * one argument and `ShipSettings` satisfies it structurally — no call site has to
 * assemble a second object, and adding a field here is a compile error at exactly
 * the rows that would have to answer for it.
 *
 * Everything here comes from the consumer's own `gjsify.ship` block. Nothing in
 * this file is derived from gjsify's tree and nothing has a gjsify-specific
 * default, which is the same line {@link LayoutDirs} draws for directories.
 */
export interface LayoutMetadataInput extends LayoutIdentity {
    /** Reverse-DNS application id — `CFBundleIdentifier`, and what the data tree is keyed on. */
    appId: string;
    /** Upstream version — `CFBundleShortVersionString`. */
    version: string;
    /** Packaging revision within one upstream version — the second half of `CFBundleVersion`. */
    release: string;
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
     * the exact defect `resolveShipApp`'s refusal exists to prevent, produced by the
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
    /**
     * Why a face in the payload's `share/fonts` may not be REACHED on this OS, or
     * absent where nothing stands in its way.
     *
     * Optional, mirroring {@link runtimeGap} rather than {@link metadata}'s
     * required-and-empty shape, because it asks the same kind of question: is there
     * something true about this OS that the staged tree cannot show? Linux answers
     * by having none.
     *
     * THE GAP IS NOT THE PATH (ADR 0038). The faces are STAGED identically on all
     * three layouts and `planStage` emits one plan for them; what differs is what
     * READS the directory. On Linux fontconfig does, expanding
     * `<dir prefix="xdg">fonts</dir>` over the `XDG_DATA_DIRS` every launcher
     * already exports — measured in eight independent fontconfigs — so that row has
     * nothing to report. On the other two the reader is a property of
     * `@gjsify/gtk-runtime-<target>` rather than of this payload, and it is not
     * fontconfig in either: CoreText on macOS, DirectWrite on Windows, the latter
     * measured on hardware (`LAYOUTS.windows.fontGap` carries the numbers).
     * `gjsify ship` prints this only when the payload actually carries a face, so a
     * project shipping none is told nothing.
     */
    fontGap?: string;
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
    /**
     * Files this layout OWNS, already in stage-relative form — `[]` where it owns none.
     *
     * The seam {@link place} structurally cannot provide, and that is why it is a
     * second function rather than another prefix rule. `Contents/Info.plist` has no
     * prefix-relative counterpart to be mapped FROM: `planStage` emits one plan in
     * the Linux/XDG shape, everything unmatched falls to `dirs.other`, and
     * `assertInsidePrefix` forbids a plan entry from escaping upward — so no
     * `gjsify.ship.extraFiles` value and no planner rule can put a file at the
     * bundle root. The layout has to add it.
     *
     * REQUIRED on every row, not optional. An optional field is one a fourth OS can
     * forget; a required one that returns `[]` is a row that has ANSWERED "this
     * layout owns nothing", which is a different statement and the one worth being
     * able to read. Linux and Windows both answer that today — a program directory
     * and a `/usr` prefix have no manifest of their own — so the whole difference
     * between "no metadata yet" and "no metadata ever" stays visible.
     *
     * The result is placed by `placeStage`, which applies the SAME uniqueness check
     * it applies to mapped files: an `extraFiles` destination that lands on
     * `Contents/Info.plist` is refused rather than silently replacing it.
     *
     * IT TAKES THE PAYLOAD, in the prefix-relative shape, because a manifest is a
     * statement ABOUT a tree and one key already has to be (ADR 0038):
     * `ATSApplicationFontsPath` names the directory the bundle's faces are in, and
     * emitting it over a bundle that carries none would point macOS at a path that
     * is not there. That is also the seam `CFBundleDocumentTypes` will need, which
     * is ADR 0024 stages 4 and 5 — so the parameter is the payload rather than a
     * `hasFonts` flag: the next key to need it will need a different question
     * answered about the same tree.
     */
    metadata: (input: LayoutMetadataInput, payload: readonly StagedFile[]) => StagedFile[];
    /**
     * The `process.arch` values this layout can be assembled for, or `null` when
     * it imposes no limit of its own.
     *
     * REQUIRED on every row, like {@link metadata}, and for the same reason: `null`
     * is an ANSWER ("this layout constrains nothing"), while an optional field is
     * one a fourth OS forgets and then silently inherits Linux's answer. Linux is
     * the `null` row — a `.deb` exists for every architecture Debian has, and
     * `DEBIAN_ARCH`/`RPM_ARCH` in `formats.ts` already refuse the ones this project
     * has no name for.
     *
     * WHY IT IS ON THE LAYOUT AND NOT ONLY ON THE FORMAT, since
     * {@link assertLayoutSupportsArch} runs in `packOne` — the same phase
     * `FormatDescriptor.archName` does, and this field buys neither an earlier
     * refusal nor a different one. It buys the two things a table lookup cannot:
     *
     *  * a REASON. `archName` answers "no Windows architecture is known for
     *    `process.arch` \"arm64\"", which reads as a gap in our table. The truth is
     *    that gvsbuild publishes no arm64 GTK, the blocker is upstream, and #1117
     *    is where it is tracked — and the difference between "unsupported" and
     *    "here is what would have to change" is the whole value of the message.
     *  * a STAGE-TIME warning at the flag that caused it (`commands/ship.ts`), for
     *    a phase that deliberately does not refuse — `tests/e2e/ship-layout`
     *    assembles all three layouts from ONE payload on purpose, and that
     *    payload's native file has an architecture.
     *
     * The constraint is also a fact about the layout's RUNTIME story — which GTK
     * closure and which interpreter exist for it — rather than about any one
     * container, which is why the format rows read it back instead of restating it.
     */
    arches: LayoutArches | null;
}

/** The architectures one layout is assemblable for, and why the others are not. */
export interface LayoutArches {
    /** `process.arch` spellings — the same vocabulary `--arch` takes. */
    only: readonly string[];
    /** What a reader must know to act on the refusal: who blocks it, and where it is tracked. */
    why: string;
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

/**
 * The value `ATSApplicationFontsPath` takes for this bundle, or nothing when the
 * payload carries no face (ADR 0038).
 *
 * DERIVED THROUGH `place()`, over a file the payload actually holds, rather than
 * written out as `share/fonts/<appId>`. The key is documented as a path relative
 * to `Contents/Resources`, which is this layout's `dirs.other` — so running the
 * real map on a real entry and taking the Resources prefix back off is the one
 * spelling that cannot come apart from where the faces were staged. A literal
 * would keep pointing at the old directory the day `dirs` changes, and macOS
 * reports an empty font directory the way it reports everything else here: not at
 * all.
 */
function darwinFontsPath(identity: LayoutMetadataInput, payload: readonly StagedFile[]): string | undefined {
    const dir = `${SHARE.fonts}/${identity.appId}`;
    const face = payload.find((file) => file.path.startsWith(`${dir}/`));
    if (face === undefined) return undefined;
    const dirs = LAYOUTS.darwin.dirs(identity);
    return posix.relative(dirs.other, posix.dirname(place(LAYOUTS.darwin, identity, face.path)));
}

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
        // A `/usr` prefix has no manifest of its own — everything a Linux package
        // says about itself is in the `.deb`/`.rpm` header or in the freedesktop
        // files the payload already carries.
        metadata: () => [],
        // Every architecture Debian and rpm have a name for, which is what
        // `DEBIAN_ARCH`/`RPM_ARCH` already enumerate — the layout adds nothing.
        arches: null,
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
        // THE ONE LAYOUT WHERE THE ENV VARIABLE IS NOT THE MECHANISM, and assuming it
        // was is the mistake this comment exists to stop being made again. macOS Pango
        // is CORETEXT, not fontconfig: GTK's own `meson.build` carries
        // `fontconfig_dep = []  # only used in x11 backend` and Homebrew's gtk4 formula
        // builds `-Dx11-backend=false -Dmacos-backend=true`, while cairo's `quartz`
        // option defaults to `auto` and auto-enables on darwin — so a `fonts.conf`
        // inside a `.app` would be inert twice over, wrong Pango backend AND no
        // GTK-side fontconfig. `XDG_DATA_DIRS` still carries the icons and the schemas
        // here; it does not carry the faces.
        //
        // What does is `ATSApplicationFontsPath`, emitted into `Info.plist` by
        // `metadata` above — Apple's own per-app activation, and the ORDERING is why it
        // beats a runtime call rather than merely being tidier:
        // `pango_core_text_font_map_changed()` only bumps a serial, there is no
        // `kCTFontManagerRegisteredFontsChangedNotification` observer and no re-scan
        // path in `pangocoretext-fontmap.c`, so a face registered after the font map
        // initialises is not recoverable by poking it. The system activates this key's
        // directory at LAUNCH, before any of the app's code runs.
        fontGap:
            'the faces are staged in `share/fonts/<appId>` and `Info.plist` carries `ATSApplicationFontsPath` ' +
            "at it, which is macOS's own per-app activation — NOT the XDG_DATA_DIRS path, because Pango on " +
            'macOS is CoreText-backed and GTK is not built against fontconfig there. That the activation ' +
            "reaches Pango's CoreText font map is UNVERIFIED: no leg in this repository runs a `.app`. " +
            'Confirm with `PangoCairo.FontMap.get_default().list_families()` in the shipped bundle, and ' +
            '`PANGOCAIRO_BACKEND=bogus` to print which backend it was built with.',
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
        // The two files that make the directory a BUNDLE. Without `Info.plist`
        // nothing tells LaunchServices which file under `Contents/MacOS` to exec,
        // and a `*.app` with no `Info.plist` is a folder with a suffix — which is
        // exactly what M1 staged. `plist.ts` carries the per-key citations.
        metadata: (input, payload) => [
            {
                path: `${appBundleDir(input)}/${BUNDLE_INFO_PLIST}`,
                mode: 0o644,
                source: { kind: 'text', text: renderInfoPlist(input, darwinFontsPath(input, payload)) },
            },
            {
                path: `${appBundleDir(input)}/${BUNDLE_PKGINFO}`,
                mode: 0o644,
                source: { kind: 'text', text: renderPkgInfo() },
            },
        ],
        // The two architectures macOS runs on, which is also exactly what
        // `@gjsify/gtk-runtime-darwin-*` and `@gjsify/node-runtime-darwin-*` are
        // published for. Nothing upstream blocks a third; there is no third.
        arches: {
            only: ['x64', 'arm64'],
            why:
                'macOS runs on x86_64 and Apple silicon and nothing else, so those are the two ' +
                '`@gjsify/gtk-runtime-darwin-*` and `@gjsify/node-runtime-darwin-*` targets that exist',
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
            'the staged launcher execs an interpreter off `PATH`, which a downloaded program directory ' +
            'cannot assume — Windows ships neither, and there is NO GJS host on Windows at all ' +
            '(ADR 0024 § 4), so § 4 derives Node here. A self-contained directory needs ' +
            '`@gjsify/node-runtime-win32-x64` and a `--app node` payload (#1354 M3).',
        // THE ONE LAYOUT WITH NO DECLARATIVE ANSWER AT ALL, and the three obvious
        // candidates are each dead for a different reason — written down because each
        // one looks right until it is read. The first is now dead by MEASUREMENT
        // rather than by reading (ADR 0038 § W1-W3, Windows 11 / GTK 4.22.4).
        //
        //  * FONTCONFIG. gvsbuild does build it and pango links it
        //    (`-Dfontconfig=enabled`), but `pangocairo-fontmap.c` picks the first
        //    backend COMPILED IN, in the order coretext → win32 → fc, and cairo's
        //    meson adds `cairo-win32` unconditionally on a Windows host. So the fc
        //    font map is built and never selected, and the whole `etc/fonts` +
        //    `FONTCONFIG_PATH` arrangement `@gjsify/gtk-runtime-win32-x64` ships is
        //    inert. `APPSHAREFONTDIR` even resolves to exactly this layout
        //    (`<exe dir>\..\share\fonts`) and feeds the map nothing reads. RUN: with
        //    a `FONTCONFIG_FILE` naming the face's directory beside WINDOWSFONTDIR
        //    the default map stays at 82 families without it — and stays at 82 when
        //    that directory is the ONLY one configured, which is the row that shows
        //    the map is not reading a misconfigured fontconfig but no fontconfig.
        //    The control that makes that a finding: a `PangoFT2.FontMap` from the
        //    SAME config in the SAME process goes 76 → 77 WITH the face, and to 5
        //    families exclusively. The bundle also ships no `fc-cache.exe`.
        //  * XDG_DATA_DIRS, which carries the faces on Linux. `FcConfigXdgDataDirs()`
        //    splits on a HARDCODED colon (its own comment says the spec asks for one),
        //    while `FC_SEARCH_PATH_SEPARATOR` is `;` here — so `C:\App\share` splits
        //    into `C` and `\App\share`. The Linux measurement does not carry over.
        //  * `AddFontResourceEx(..., FR_PRIVATE)`. It registers with GDI, and
        //    `pango_win32_font_map_init()` has exactly one population call —
        //    `pango_win32_dwrite_font_map_populate()` — with no `EnumFontFamilies` and
        //    no `AddFontResource` anywhere in the backend. A GDI-private font cannot
        //    reach GTK4 text.
        //
        // What is left is a runtime call, which a packaging command has no business
        // making inside somebody's application — so the launcher hands over the
        // directory (`GJSIFY_FONT_DIR`) and this string names the call. That the call
        // WORKS is measured too, and on GTK's own map rather than a loose Pango
        // object: `label.get_pango_context().get_font_map()` IS the default map
        // there, `add_font_file` on it answers true, families go 82 → 83 and the
        // family then loads. With the discriminator that keeps "resolved" honest — an
        // invented family renders as Tahoma at different metrics with a Pango
        // warning, which is exactly what the probe family did BEFORE the call.
        fontGap:
            'the faces are staged in `share/fonts/<appId>` and the launcher exports GJSIFY_FONT_DIR at it, ' +
            'but WINDOWS HAS NO DECLARATIVE FONT ACTIVATION and nothing here reaches a bundled face on its ' +
            'own: GTK4 uses pangowin32, whose font map is populated from DirectWrite and never from ' +
            'fontconfig or from GDI. MEASURED on Windows 11 / GTK 4.22.4 rather than inferred (ADR 0038 ' +
            'W1-W5): a FONTCONFIG_FILE naming the staged directory moves the default font map by nothing ' +
            'even when it is the ONLY configuration present — that map does not read fontconfig, and exposes ' +
            'no config_changed or set_config with which to make it — while add_font_file on the same map a ' +
            'Gtk.Label renders through does register the family. So register them at startup: ' +
            '`PangoCairo.FontMap.get_default().add_font_file(path)` (Pango 1.56+, in the typelib), or the ' +
            'app renders in a substituted family with no error.',
        // `.cmd`, not `.bat`: the two differ in whether a failing built-in (`set`,
        // `path`, `append`) sets ERRORLEVEL, and `.cmd` is the one where it does.
        launcherExt: '.cmd',
        root: () => '',
        // A program directory has no imposed shape, so this one is chosen for the
        // LOADER: `lib/` is what the launcher prepends to `PATH`, because Windows
        // has no rpath — a DLL is found on `PATH`, in the directory of the image
        // that loaded it, or not at all.
        dirs: () => ({ launcher: '', bundle: 'app', native: 'lib', data: 'share', other: '' }),
        // Nothing, and this is the row that shows the field is not a macOS detail
        // wearing a general name: a Windows installer's metadata lives in the
        // `.msi`'s own tables, not in a file inside the program directory. THREE
        // format rows wrap this layout now, and the installer — the one that could
        // have needed a file here — did not: `msi.ts` puts every such fact in the
        // `Product`/`Package` attributes of the document it renders. So the answer
        // held rather than the question going unasked, and if a fourth row ever
        // needs a file, THIS is where it goes — not a branch in the stager.
        metadata: () => [],
        // ONE, and the blocker is a project we do not own. `wingtk/gvsbuild`
        // hardcodes `self.platform = "x64"` in `utils/base_project.py` and its last
        // five releases publish exactly two assets each, both x64 — so there is no
        // arm64 GTK to build `@gjsify/gtk-runtime-win32-arm64` OUT OF, and on
        // Windows that bundle is the only GTK there is. `@gjsify/node-gi` declares
        // `win32-x64` only for the same reason. Tracked in #1117, which also
        // records why an exploratory arm64 leg must NOT be added: its first step
        // downloads a ZIP that does not exist, so it would be red by construction.
        arches: {
            only: ['x64'],
            why:
                'gvsbuild publishes no arm64 GTK (it hardcodes `self.platform = "x64"`), so there is nothing ' +
                'to build `@gjsify/gtk-runtime-win32-arm64` out of and no GTK for a Windows/ARM artifact to ' +
                'load — the blocker is upstream and is tracked in gjsify/gjsify#1117',
        },
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
 * Refuse an architecture this layout cannot be assembled for, naming the blocker.
 *
 * AT STAGE TIME, which is the whole point — see {@link Layout.arches}. The
 * message carries the row's own `why` rather than a generic "unsupported", because
 * the two refusals a reader can act on are different jobs: `x64` is what a Windows
 * artifact is built for TODAY, and `win32-arm64` is blocked in a repository we do
 * not own. Telling an author "unknown architecture" for the second one would send
 * them to look for a flag.
 *
 * `process.arch` spelling on both sides, so the value quoted back is the one the
 * user typed after `--arch`.
 */
export function assertLayoutSupportsArch(layout: Layout, arch: string): void {
    const arches = layout.arches;
    if (arches === null || arches.only.includes(arch)) return;
    throw new Error(
        `gjsify ship: the ${layout.name} layout is not assemblable for \`--arch ${arch}\` — ` +
            `${arches.only.length === 1 ? 'the only architecture it has' : 'the architectures it has'} ` +
            `${arches.only.length === 1 ? 'is' : 'are'} ${arches.only.join(', ')}.\n` +
            `    ${arches.why}.\n` +
            '    `--arch` names the architecture the PAYLOAD was built for and cross-compiles nothing, so ' +
            'there is no\n' +
            '    flag that makes this work — the artifact would carry a runtime that does not exist.',
    );
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
 * Apply a layout to a whole planned payload, and add what the layout itself owns.
 *
 * THREE SOURCES, one destination namespace. The mapped files come from
 * `planStage`'s prefix-relative plan; {@link Layout.metadata} adds the files that
 * have no prefix-relative counterpart at all (`Contents/Info.plist`); `carried`
 * adds the runtime the artifact ships inside itself (#1354 M2b — the interpreter,
 * the relocated GTK closure, the node-gi addon). All three go through the same
 * uniqueness check, which is what makes the other two safe: an `extraFiles`
 * destination that maps onto a metadata path is refused by name instead of
 * silently replacing the file that makes the bundle a bundle.
 *
 * `carried` is already stage-relative and deliberately NOT mapped. A relocated
 * closure's every internal relation is relative — `@loader_path/<leaf>` install
 * names, `@loader_path/../../..` in `loaders.cache`, `@loader_path/gtk/lib` on the
 * addon — so the tree survives the copy only if it is copied as a tree. Routing it
 * through the prefix-relative plan would put it through
 * `gjsify.ship.bundledTypelibs`'s flattening (`plan.ts`: `posix.join(libDir, 'gi',
 * basename(file))`), which destroys all three at once.
 *
 * The uniqueness check is not decoration for the mapped half either. `planStage`
 * deduplicates on the PREFIX-RELATIVE path — that is how `gjsify.ship.extraFiles`
 * is documented to override a default — but the MAP can bring two distinct
 * prefix-relative paths together: on Windows the launcher becomes
 * `<binaryName>.cmd` at the program root, which an `extraFiles` destination can
 * name directly. Without this the second one silently wins and which one that is
 * depends on plan order — the "installs cleanly, does nothing" class this command
 * is built against.
 */
export function placeStage(
    layout: Layout,
    identity: LayoutMetadataInput,
    files: readonly StagedFile[],
    carried: readonly StagedFile[] = [],
): StagedFile[] {
    const byPlaced = new Map<string, string>();
    const out: StagedFile[] = [];
    const claim = (path: string, from: string, file: StagedFile): void => {
        const previous = byPlaced.get(path);
        if (previous !== undefined) {
            throw new Error(
                `gjsify ship: in the ${layout.name} layout both ${previous} and ${from} install as ` +
                    `${path}. Two payload files cannot share one destination — one would silently replace the ` +
                    'other. Rename the `gjsify.ship.extraFiles` destination that collides.',
            );
        }
        byPlaced.set(path, from);
        out.push({ ...file, path });
    };
    for (const file of files) claim(place(layout, identity, file.path), file.path, file);
    // The layout's own files are ALREADY stage-relative — they were never in the
    // prefix-relative plan, so there is nothing to map. `<layout> metadata` rather
    // than a path as the origin label, because a collision message naming
    // `Contents/Info.plist` as both sides would say nothing.
    for (const file of layout.metadata(identity, files)) {
        claim(file.path, `the ${layout.name} layout's own metadata`, file);
    }
    // A THIRD source, and stage-relative like the second: the runtime the bundle
    // CARRIES (`utils/ship/app-runtime.ts`). It goes through `claim` for the reason
    // the metadata does — an `extraFiles` destination landing on a staged dylib
    // would otherwise replace it silently, and the bundle would look complete.
    for (const file of carried) claim(file.path, `the runtime staged into the ${layout.name} artifact`, file);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
