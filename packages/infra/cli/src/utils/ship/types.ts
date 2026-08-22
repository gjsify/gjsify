// The vocabulary `gjsify ship` is written in (ADR 0024).
//
// ONE payload, one layout per OS, one packer per format. Everything that
// differs between a `.deb` and an `.rpm` is a {@link FormatDescriptor} field or
// a {@link StagedFile} in that format's overlay — never a branch in the
// staging code. The reference implementation this design is taken from
// (`refs/gtkx`, MPL-2.0, reimplemented not copied) expresses the same
// distinction as `if (target === 'deb')` inside its stager, and pays for it:
// adding a fifth target there means editing six files.

/** One file in the payload, addressed relative to the install prefix. */
export interface StagedFile {
    /** Prefix-relative path, e.g. `bin/learn6502`, `share/applications/x.desktop`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
    /** Where the bytes come from. */
    source: { kind: 'text'; text: string } | { kind: 'file'; path: string };
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
    /** Artifact filename, given the resolved settings and the resolved arch label. */
    fileName: (settings: ShipSettings, archLabel: string) => string;
}

/** The resolved, fully defaulted configuration for one `gjsify ship` run. */
export interface ShipSettings {
    /** Absolute path to the project being shipped. */
    projectDir: string;
    /** Reverse-DNS application id — desktop entry, metainfo and icon basename. */
    appId: string;
    /** Human-readable display name. */
    name: string;
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
    /** Absolute path to the licence file, when one was found. */
    licenseFile?: string;
    homepage?: string;
    /** deb `Section:`. */
    section: string;
    /** rpm `Group:`. */
    group: string;
    /** `'app'` stages a desktop entry and an icon; `'cli'` stages neither. */
    kind: 'app' | 'cli';
    /** Extra runtime dependencies per format, appended to the derived set. */
    extraDepends: { deb: string[]; rpm: string[] };
    /** Project-supplied GI-namespace → package rows, filling gaps in the built-in table. */
    typelibPackages: Record<string, { deb: string; rpm: string }>;
    /** Absolute path to the built bundle that `bin/<binaryName>` executes. */
    bundlePath: string;
    /** Absolute path of the directory staged wholesale into `lib/<binaryName>/`. */
    bundleDir: string;
    /** Absolute paths of the icon files to install, largest-first is not required. */
    iconFiles: string[];
    /** Absolute paths of `*.gschema.xml` files to install. */
    schemaFiles: string[];
    /**
     * Typelibs + shared libraries the package carries itself (`gjsify.ship.bundledTypelibs`).
     *
     * gjsify's own GI libraries arrive as npm prebuilds, not distro packages, so an app using one
     * has nothing to depend on and must ship the files — with the launcher pointing GI at them.
     */
    typelibFiles: string[];
    /** `<dest relative to prefix>` → absolute source path. */
    extraFiles: Record<string, string>;
    /** Arguments appended to the launcher's `exec` line. */
    execArgs: string[];
    /** Output root; `stage/`, `overlay/` and `out/` hang under it. */
    outDir: string;
    /** Target architecture in `process.arch` spelling. */
    arch: string;
    /** Minimum GJS the emitted dependency asks for. */
    minGjsVersion: string;
}
