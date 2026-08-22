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

export type FormatId = 'deb' | 'rpm';

/**
 * Everything that is per-FORMAT, as data.
 *
 * `prefix` is the one value the payload itself cannot be blind to — a launcher
 * derives it at runtime (ADR 0024 § 3), but a D-Bus service file and an RPM's
 * directory ownership need it spelled out.
 */
export interface FormatDescriptor {
    id: FormatId;
    /** Install prefix the format's contents hang under. */
    prefix: string;
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
 *  - `appId`, `name`, `kind`, `execArgs` — read by the planner and the metadata
 *    renderers, all of which have run by the time a stage exists.
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
    extraDepends: { deb: string[]; rpm: string[] };
    /** Project-supplied GI-namespace → package rows, filling gaps in the built-in table. */
    typelibPackages: Record<string, { deb: string; rpm: string }>;
    /** Minimum GJS the emitted dependency asks for. */
    minGjsVersion: string;
}

/** The resolved, fully defaulted configuration for one `gjsify ship` run. */
export interface ShipSettings extends PackSettings {
    /** Absolute path to the project being shipped. */
    projectDir: string;
    /** Reverse-DNS application id — desktop entry, metainfo and icon basename. */
    appId: string;
    /** Human-readable display name. */
    name: string;
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
}
