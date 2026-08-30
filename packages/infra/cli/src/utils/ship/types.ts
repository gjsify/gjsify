// The vocabulary `gjsify ship` is written in (ADR 0024).
//
// ONE payload, one layout per OS, one packer per format. Everything that
// differs between a `.deb` and an `.rpm` is a {@link FormatDescriptor} field or
// a {@link StagedFile} in that format's overlay — never a branch in the
// staging code. The reference implementation this design is taken from
// (`refs/gtkx`, MPL-2.0, reimplemented not copied) expresses the same
// distinction as `if (target === 'deb')` inside its stager, and pays for it:
// adding a fifth target there means editing six files.
//
// ADR 0024 § A2 splits the command in two — `--stage` assembles anywhere,
// `--from-stage` packs on the host that owns the format — and that split shows
// up here as the {@link PackSettings} / {@link ShipSettings} pair. Read the
// comment on {@link PackSettings} before adding a field to either.

/** One planned path and the mode the PLAN gives it. */
export interface StagedMode {
    /** Prefix-relative path, e.g. `bin/learn6502`, `share/applications/x.desktop`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
}

/** One file in the payload, addressed relative to the install prefix. */
export interface StagedFile extends StagedMode {
    /** Where the bytes come from. */
    source: { kind: 'text'; text: string } | { kind: 'file'; path: string };
}

/**
 * What {@link readStage} checks a staged tree against.
 *
 * `bytes` is present only when the plan came from a stage manifest, i.e. when
 * the tree travelled between hosts and there is something to compare against.
 * The single-host run plans and writes in one process, so there is no transfer
 * to check and no second opinion to check it with.
 */
export interface StagePlanEntry extends StagedMode {
    /** Size the manifest recorded for this path, when one was recorded. */
    bytes?: number;
}

/** A packed artifact on disk. */
export interface ShipArtifact {
    format: FormatId;
    /** Absolute path to the written file. */
    path: string;
    /** Size in bytes. */
    size: number;
}

/**
 * The closed vocabulary of formats.
 *
 * The two macOS members are spelled `macos-…` rather than `app` / `app-zip`, and
 * the reason is collision rather than length: the bare word `app` is already
 * taken three times over in this subsystem — the `gjsify.app` config key,
 * `ShipSettings.app`, `PackSettings.app` — and every one of them means the
 * INTERPRETER. A member of this union is also a directory name (`overlay/<id>/`)
 * and a `--target` value a user types, so the ambiguity would have reached both a
 * path and a command line.
 *
 * `scripts/check-ship-format-vocabulary.mjs` reads the declaration below
 * TEXTUALLY and fails if a comment gives it a second match, which is why this one
 * describes the union without quoting its head.
 */
export type FormatId =
    | 'deb'
    | 'rpm'
    | 'flatpak'
    | 'macos-app'
    | 'macos-app-zip'
    | 'macos-app-dmg'
    | 'windows-dir'
    | 'windows-dir-zip';

/**
 * The formats whose ARTIFACT carries a distro dependency list.
 *
 * Not every `FormatId`, and this is where the difference is written down once
 * instead of being rediscovered per call site. A `.deb` says
 * `Depends: gir1.2-gtk-4.0`, an `.rpm` says `Requires: gtk4`, and both are
 * package names in a distribution's namespace. A Flatpak has no such field: it
 * declares ONE dependency, its runtime (`org.gnome.Platform//50`), in the
 * manifest — and inside that runtime a typelib is either present or nothing on
 * the system provides it, so there is no package to name and no gap a name
 * could close.
 *
 * `Extract<…>` rather than a fresh literal union, so this cannot outlive
 * `FormatId`: dropping a member there shrinks this and reds every table keyed on
 * it. The other direction is covered by {@link FormatDescriptor.depends} being
 * REQUIRED — a new format cannot be added without saying which side it is on.
 */
export type DistroFormatId = Extract<FormatId, 'deb' | 'rpm'>;

/** An operating system in the repo-wide `process.platform` spelling (root AGENTS.md § Runtime & platform model). */
export type HostOs = 'linux' | 'darwin' | 'win32';

/**
 * Where a format can be FINISHED, and who can read the result back (ADR 0024 § A3).
 *
 * Three fields rather than one `hostOs`, because the three questions have
 * different answers. `finishOn` is not the LAYOUT — a `<App>.app` tree is
 * assembled anywhere while the `.dmg` around it needs macOS. `requiredTools` is
 * not implied by `finishOn` — `.deb` and `.rpm` are written by this tree and
 * exec nothing, which is the whole reason `rpm` could become an independent
 * oracle and catch the dpkg-`$1` defect in the first artifact. And `oracle` is
 * derivable from neither: a format built by the platform's own tool forfeits
 * that independence unless a reader from a DIFFERENT implementation family
 * exists, which is exactly what `selfReading` is the honest confession of.
 */
export interface HostRequirement {
    /** OSes whose tooling can finish this format. `'any'` = pure JS, under GJS, offline. */
    finishOn: 'any' | readonly HostOs[];
    /** Commands the packer EXECS. Empty iff this tree writes the format itself. */
    requiredTools: readonly string[];
    /**
     * How to install {@link requiredTools}, in this format's own words.
     *
     * DATA, because the refusal that names it is one generic function. The
     * first cut hardcoded `sudo dnf install flatpak flatpak-builder` inside
     * `assertToolsInstalled`, which is correct for exactly one format and would
     * have told the first `.dmg` or `.msi` user to install flatpak — from the
     * same branchless dispatch this whole table exists to keep branchless.
     * Required whenever `requiredTools` is non-empty; `flatpak.spec.ts` holds
     * that, the same way it holds `selfReading`.
     */
    installHint?: string;
    oracle: {
        /** Readers from a DIFFERENT implementation family than the packer. */
        readWith: readonly string[];
        /** Where each reader runs. A Linux-runnable reader is worth more — every CI leg has one. */
        readOn: readonly HostOs[];
        /**
         * No independent discriminator yet. Legal to DECLARE while a format is
         * being built; illegal to release — `flatpak.spec.ts` is what turns that
         * sentence into a red test, so flipping it is a decision somebody makes
         * rather than a field nobody reads.
         */
        selfReading: boolean;
    };
}

/**
 * Everything that is per-FORMAT, as data.
 *
 * `prefix` is the one value the payload itself cannot be blind to — a launcher
 * derives it at runtime (ADR 0024 § 3), but a D-Bus service file and an RPM's
 * directory ownership need it spelled out.
 */
export interface FormatDescriptor {
    id: FormatId;
    /**
     * The OS whose LAYOUT this format wraps.
     *
     * Not `host.finishOn`, and the two must not be collapsed: `finishOn` says
     * where the container can be PRODUCED, this says which staged tree it is a
     * container FOR. A `.dmg` is `finishOn: ['darwin']` and `layoutOs: 'darwin'`,
     * which makes them look like one field — but the `.app` zip beside it is
     * `finishOn: 'any'` with the same `layoutOs`, and that is the pair that
     * proves they are different questions.
     *
     * This is what gives `defaultFormatIds` its second criterion. Without it, a
     * `.app` and a Windows program directory — both `finishOn: 'any'` — would
     * make a bare `gjsify ship` on Linux emit five artifacts, three of which are
     * for operating systems the caller did not ask about.
     */
    layoutOs: HostOs;
    /** Install prefix the format's contents hang under. */
    prefix: string;
    /** Where this format can be packed, what it execs, and who reads it back. */
    host: HostRequirement;
    /**
     * The key this format's dependency list is spelled under, or `null` when its
     * dependencies are not a package list at all — see {@link DistroFormatId}.
     */
    depends: DistroFormatId | null;
    /**
     * The interpreters this format's runtime can actually provide at RUN time.
     *
     * A list and not a boolean, and on the descriptor rather than in a branch,
     * because the answer is a property of the format's runtime and nothing else
     * can be asked for it. `deb`/`rpm` carry both: a distribution ships `gjs` and
     * `nodejs`, and the package declares whichever it execs.
     *
     * ⚠️ `flatpak` carries `gjs` ALONE, and that is a measured limit rather than
     * a conservative default. `org.gnome.Platform` ships `gjs` and no `node`;
     * Node exists only as `org.freedesktop.Sdk.Extension.node2x`, which puts
     * `/usr/lib/sdk/node24/bin` on the **build** PATH — this repo's own
     * `guides/flatpak-cli-tool.md` says so in those words. So a `--app node`
     * Flatpak would install and die at `exec node`.
     *
     * That case was reachable: `assertLauncherMatchesInterpreter` is about the
     * launcher agreeing with the DEPENDENCY, and a Flatpak has no dependency
     * list, so the check is vacuous here — it compares `settings.app` against a
     * launcher rendered from `settings.app`. Only the RUNTIME knows, and only
     * this row can say.
     */
    interpreters: readonly ('gjs' | 'node')[];
    /**
     * Why this format's runtime provides {@link interpreters} and no more — the
     * body of the refusal a project on the wrong interpreter gets.
     *
     * On the row rather than inside the refusal, and the incident is one line
     * old: the refusal carried Flatpak's paragraph about `org.gnome.Platform`
     * hardcoded, and the first macOS row printed it — telling somebody shipping a
     * `.app` that `org.freedesktop.Sdk.Extension.node2x` puts node on the build
     * path. Exactly the shape `installHint` moved out of `assertToolsInstalled`
     * for, one field over.
     *
     * REQUIRED, including on the two rows that accept both interpreters and can
     * therefore never print it. A row that answers "nothing here is restricted,
     * and this is why" has ANSWERED; an optional field is one a sixth format can
     * leave undefined while restricting `interpreters`, and the refusal would go
     * back to having nothing to say.
     */
    interpreterGap: string;
    /** Where the project's licence text goes in this format's overlay. */
    licenseDest: (binaryName: string) => string;
    /**
     * `debian-copyright` renders the machine-readable copyright 1.0 format
     * Debian policy asks for; `plain` copies the licence file verbatim.
     */
    licenseKind: 'debian-copyright' | 'plain';
    /**
     * This format's spelling of the architecture.
     *
     * `archIndependent` is DERIVED from the payload, not configured: a
     * `--app gjs` bundle is JavaScript and a shell launcher, so it really does
     * install everywhere, and saying `amd64` would make apt refuse it on an
     * arm64 machine it runs on perfectly. One `.so` in the payload flips it.
     */
    archName: (arch: string, archIndependent: boolean) => string;
    /** Artifact filename, given the pack-time settings and the resolved arch label. */
    fileName: (settings: PackSettings, archLabel: string) => string;
    /**
     * Whether {@link fileName} names a FILE or a DIRECTORY.
     *
     * A `.deb`, an `.rpm` and a `.flatpak` are single files; a `<App>.app` is a
     * directory that macOS treats as one object, and it is the first artifact in
     * this table that is not a file. Recorded rather than inferred from the
     * suffix, because `packOne` reports a SIZE and `statSync` on a directory
     * answers 4096 on ext4 — a `.app` carrying a 20 MiB bundle would be printed
     * as "4096 bytes", which is not a rounding error but a different number
     * entirely. A `.dmg` will be `'file'` again, so this is not "macOS is
     * special", it is a property of the container.
     */
    artifactKind: 'file' | 'directory';
}

/** One shared-mime-info type definition (`gjsify.ship.mimeTypes`). */
export interface ShipMimeType {
    type: string;
    comment: string;
    globs?: string[];
    subClassOf?: string;
    genericIcon?: string;
}

/**
 * The half of the configuration that survives the host boundary.
 *
 * `gjsify ship --from-stage` runs on a machine that has the staged tree and
 * NOTHING else: no project directory, no `package.json`, no built bundle. So
 * the two phases exchange exactly this object, serialised into the stage's
 * `.gjsify-ship-stage.json`, and that is why the split is a TYPE rather than a
 * convention — the packers take a `PackSettings`, so a `settings.bundlePath`
 * read added to `deb.ts` or `rpm.ts` is a compile error until the field is
 * moved here, and moving it here is what puts it in the manifest.
 *
 * Every field below has a MEASURED reader in the pack path
 * (`deb.ts`, `rpm.ts`, `depends.ts`, `formats.ts#fileName`). Nothing is here
 * "because ship needs it": a settings dump is what ADR 0024 § A2 rejects, and
 * a dumped field that happens to be an absolute path is a path the packing host
 * cannot open.
 *
 * NOT here, deliberately, and each with the reason it is not:
 *  - `projectDir`, `outDir` — nothing in the pack path reads either; the
 *    finishing host has its own output root.
 *  - `bundlePath`, `bundleDir` — build-tree paths. Their three readers are all
 *    phase 1: the build stamp (carried as the manifest's `mtime`), the
 *    launcher's exec target (already rendered into the staged `bin/<name>`),
 *    and the GI-namespace scan (carried as the manifest's `namespaces`).
 *  - `iconFiles`, `schemaFiles`, `typelibFiles` — the pack path reads them only
 *    to ask what the PAYLOAD contains, which the payload answers itself; see
 *    `readPayloadFacts`.
 *  - `licenseFile`, `extraFiles` — phase 1 reads their bytes into the plan.
 *  - `localeFiles` — same, and the reason is worth stating because the field
 *    arrived (#1263) AFTER this split was written and carries a build-host
 *    `abs` path: `planStage` reads each catalogue into the staged tree at
 *    `share/locale/<rel>`, and no packer reads the field. So translations
 *    cross in the payload, where they belong, and the `abs` path does not
 *    cross at all. This list being explicit is what caught that.
 *  - `kind`, `execArgs` — read by the planner and the metadata renderers, all of
 *    which have run by the time a stage exists. `appId` was on this line and
 *    MOVED: the Flatpak packer needs it at pack time twice over — it is the
 *    manifest's `id` and the ref `flatpak build-bundle` exports — and neither is
 *    derivable from the payload, because the desktop entry that carries the id
 *    is only staged for `kind: 'app'`. `name` was on it too and moved for the
 *    same kind of reason one milestone later: the macOS artifact IS
 *    `<name>.app`, so the packing host has to be able to NAME it, and no other
 *    field in this object can spell it (`binaryName` is the executable inside
 *    the bundle, not the bundle).
 *  - `arch` — carried by the manifest's `target`, which is also the value a
 *    mismatched stage is refused on, so it lives in exactly one place.
 *  - `mimeTypes` — phase 1 renders the shared-mime-info document into the
 *    staged tree, and the one pack-time reader asks whether that FILE is in the
 *    payload (`readPayloadFacts#hasMimeTypes`), which is the same question one
 *    host later. Carrying the declarations would put the answer in two places.
 */
export interface PackSettings {
    /** Package name: the `bin/` entry, the deb `Package:`, the rpm `Name:`. */
    binaryName: string;
    /** Reverse-DNS application id — the Flatpak manifest's `id` and the exported ref. */
    appId: string;
    /**
     * Human-readable display name — and, on macOS, the `<App>.app` directory itself.
     *
     * On this side of the host boundary because the darwin packers cannot work
     * without it: `macos-app`'s artifact is a directory called `${name}.app` and
     * `macos-app-zip` wraps that directory, so a finishing host with the stage and
     * nothing else still has to be able to spell it. Also what `Info.plist`'s
     * `CFBundleName`/`CFBundleDisplayName` carry — see `layout.ts`'s
     * `LayoutMetadataInput`.
     */
    name: string;
    /** Upstream version, normalised for package managers. */
    version: string;
    /** Package revision within one upstream version (deb revision / rpm release). */
    release: string;
    /** `Maintainer:` / `Packager:`, `Name <email>`. */
    maintainer: string;
    /** One-line summary. */
    summary: string;
    /** Multi-paragraph description, already split. */
    description: string[];
    /** SPDX identifier of the project licence. */
    license: string;
    homepage?: string;
    /** deb `Section:`. */
    section: string;
    /** rpm `Group:`. */
    group: string;
    /** Extra runtime dependencies per format, appended to the derived set. */
    extraDepends: Record<DistroFormatId, string[]>;
    /** Project-supplied GI-namespace → package rows, filling gaps in the built-in table. */
    typelibPackages: Record<string, Record<DistroFormatId, string>>;
    /**
     * The interpreter the launcher execs, and therefore the one the package
     * depends on. From `gjsify.app`; default `'gjs'`.
     *
     * ON `PackSettings`, not on `ShipSettings` alone, because BOTH halves need it
     * and they must not answer it differently: `renderLauncher` writes
     * `exec gjs -m` or `exec node` from this field, and `deriveDepends` seeds
     * `gjs >= …` or `nodejs >= …` from the same one. Two sources here is the
     * defect this field replaces — a filename heuristic once produced
     * `Depends: gjs (>= 1.86), nodejs (>= 24)` on a package whose launcher execed
     * gjs.
     */
    app: 'gjs' | 'node';
    /** Minimum GJS the emitted dependency asks for. Used only for `app: 'gjs'`. */
    minGjsVersion: string;
    /** Minimum Node major. Used only for `app: 'node'`. */
    minNodeVersion: string;
    /** The Flatpak manifest's non-payload half, fully defaulted at stage time. */
    flatpak: ShipFlatpakSettings;
}

/**
 * What the generated Flatpak manifest says about everything that is not the payload.
 *
 * Resolved — defaults applied — while the project is still in reach, because
 * the defaults depend on `kind` and on `gjsify.flatpak`/`gjsify.ship.flatpak`,
 * and the finishing host has neither.
 *
 * There is deliberately no `modules` / `extraModules` here. Under `ship` the
 * module list IS the staged payload (ADR 0024 § 2: "a target that needs an
 * extra file gets an overlay, never a branch in the staging code"), and an
 * escape hatch that injects arbitrary build modules would put a second staging
 * model back in the tree — which is the one thing § 8 gates the whole migration
 * on. A project that genuinely needs to BUILD something inside the sandbox
 * still has `gjsify flatpak init` + `gjsify flatpak build`, unchanged.
 */
export interface ShipFlatpakSettings {
    /** Runtime id, e.g. `org.gnome.Platform`. */
    runtime: string;
    /** Runtime/SDK version, e.g. `50`. */
    runtimeVersion: string;
    /** SDK id, e.g. `org.gnome.Sdk`. */
    sdk: string;
    /** The branch the app is exported under — the last segment of `app/<id>/<arch>/<branch>`. */
    branch: string;
    sdkExtensions: string[];
    /** Path components prepended to `PATH` inside the build sandbox. */
    appendPath: string[];
    /** Capabilities the finished app is granted. */
    finishArgs: string[];
    /** Cleanup globs applied to `/app` after the module has run. */
    cleanup: string[];
}

/** The resolved, fully defaulted configuration for one `gjsify ship` run. */
export interface ShipSettings extends PackSettings {
    /** Absolute path to the project being shipped. */
    projectDir: string;
    /** Absolute path to the licence file, when one was found. */
    licenseFile?: string;
    /** `'app'` stages a desktop entry and an icon; `'cli'` stages neither. */
    kind: 'app' | 'cli';
    /** Absolute path to the built bundle that `bin/<binaryName>` executes. */
    bundlePath: string;
    /** Absolute path of the directory staged wholesale into `lib/<binaryName>/`. */
    bundleDir: string;
    /** Absolute paths of the icon files to install, largest-first is not required. */
    iconFiles: string[];
    /** Absolute paths of `*.gschema.xml` files to install. */
    schemaFiles: string[];
    /**
     * File types this package defines system-wide (shared-mime-info). Empty for a package that only
     * HANDLES existing types — that needs no document of its own.
     */
    mimeTypes: ShipMimeType[];
    /**
     * Typelibs + shared libraries the package carries itself (`gjsify.ship.bundledTypelibs`).
     *
     * gjsify's own GI libraries arrive as npm prebuilds, not distro packages, so an app using one
     * has nothing to depend on and must ship the files — with the launcher pointing GI at them.
     */
    typelibFiles: string[];
    /**
     * Compiled gettext catalogues (`gjsify.ship.localeDir`), each keeping its
     * `<lang>/LC_MESSAGES/<domain>.mo` path so `share/locale/` comes out in the layout
     * `bindtextdomain` reads.
     *
     * `rel` rather than a bare list of absolute paths, because the LAYOUT is the whole point here:
     * a `.mo` staged by basename alone lands where no catalogue lookup will ever look at it.
     */
    localeFiles: { rel: string; abs: string }[];
    /** `<dest relative to prefix>` → absolute source path. */
    extraFiles: Record<string, string>;
    /** Arguments appended to the launcher's `exec` line. */
    execArgs: string[];
    /** Output root; `stage/`, `overlay/` and `out/` hang under it. */
    outDir: string;
    /** Target architecture in `process.arch` spelling. */
    arch: string;
    /**
     * The OS whose LAYOUT this run assembles, from the `gjsify ship <os>`
     * positional (ADR 0024 § A2).
     *
     * Beside `arch` and for the same reason: together they are the stage's
     * `target`, the string `--expect-target <os>-<arch>` is compared against, and
     * the pair a matrix leg is identified by. Deliberately NOT in
     * {@link PackSettings} — the manifest's `target` carries it, so it lives in
     * exactly one place on the far side of the host boundary.
     */
    layoutOs: HostOs;
}
