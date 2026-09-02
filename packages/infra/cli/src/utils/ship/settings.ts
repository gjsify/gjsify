// Turning a project into a fully-defaulted {@link ShipSettings}.
//
// Kept free of the filesystem: the caller discovers the payload (bundle files,
// icons, schemas, licence) and hands the paths in, so every defaulting and
// every refusal is unit-testable without building an app first. The precedent
// is `utils/copy-targets.ts`, and the reason is the same — the cases worth
// testing are the ones that must FAIL.
//
// Precedence is uniform: CLI flag > `gjsify.ship` > `gjsify.flatpak` (metadata
// only) > derived from package.json. Never a yargs `default:`, which is
// indistinguishable from a value the user typed and would clobber the config.

import { validateMimeTypes } from './mime.js';
import { basename } from 'node:path';

import type {
    AppMetadata,
    ConfigDataFlatpak,
    ConfigDataShip,
    DescriptionBlock,
    ShipAppOptions,
} from '../../types/config-data.js';
import { DEFAULT_GJS_FLOOR, DEFAULT_NODE_FLOOR } from './depends.js';
import { resolveShipFlatpakSettings } from './flatpak-config.js';
import { assertRelease, normaliseVersion } from './version.js';
import type { HostOs, ShipSettings } from './types.js';

/** The subset of `package.json` the resolver reads. */
export interface ShipPackageManifest {
    name?: string;
    version?: string;
    description?: string;
    license?: string;
    homepage?: string;
    author?: string | { name?: string; email?: string; url?: string };
    main?: string;
    gjsify?: { main?: string };
}

/** Paths the caller has already found on disk. */
export interface DiscoveredPayload {
    /** Absolute path to the built bundle. */
    bundlePath: string;
    /** Absolute path to the directory staged into `lib/<binaryName>/`. */
    bundleDir: string;
    /** Bundle-dir-relative paths, POSIX-separated. */
    bundleFiles: string[];
    iconFiles: string[];
    schemaFiles: string[];
    /** Absolute paths of the typelibs + shared libraries the project ships itself. */
    typelibFiles: string[];
    /** Compiled gettext catalogues, each with its `<lang>/LC_MESSAGES/<domain>.mo` path. */
    localeFiles: { rel: string; abs: string }[];
    licenseFile?: string;
}

export interface SettingsInput {
    projectDir: string;
    pkg: ShipPackageManifest;
    ship: ConfigDataShip;
    /** Metadata fallback — `gjsify.flatpak` already carries these fields for many projects. */
    flatpak: ConfigDataFlatpak;
    /**
     * What the command line decided before any config was read.
     *
     * `layoutOs` is REQUIRED, unlike its two neighbours, and the asymmetry is the
     * point: `outDir` and `arch` have derived defaults that are correct when
     * nobody says anything, while the layout is chosen by `gjsify ship <os>` (or
     * by the host) before this function is reached. Making it optional would put
     * a fourth default for it in here, and a second place that decides the layout
     * is how the manifest's `target.os` and the staged paths come apart.
     */
    cli: { outDir?: string; arch?: string; layoutOs: HostOs };
    discovered: DiscoveredPayload;
    /**
     * The runtime {@link resolveShipApp} resolved for THIS run's target.
     *
     * Already resolved and already narrowed, never the raw `gjsify.app`. The type
     * is what enforces it: a caller handing the project field straight through
     * does not compile, which is the defect this field used to carry — every
     * generator downstream reads `settings.app`, so a project-wide value arriving
     * here made a macOS decision move the Linux `Depends:`.
     */
    app: 'gjs' | 'node';
}

/** The runtime one ship target runs, and which key decided it. */
export interface ResolvedShipApp {
    /** What the launcher execs, what the package depends on, and which formats can wrap it. */
    app: 'gjs' | 'node';
    /** The config key the answer came from — named in the refusal and in the notice. */
    key: string;
    /** Whether a per-target key overrode the project default. */
    overridden: boolean;
}

/**
 * The ONE place a ship target's runtime is decided: `gjsify.app` as the DEFAULT,
 * `gjsify.ship.app.<os>` as this target's override.
 *
 * Every generator reads the result and none reads the project field, because the
 * two are not the same question. `gjsify.app` says what the application was
 * BUILT as; a shipped artifact's runtime is per OS (ADR 0024 § 4), and stating
 * darwin's must not move Linux's. It did: with one field, `gjsify ship darwin`
 * refused its formats until `gjsify.app` was set to `"node"`, and setting it
 * turned the Linux `.deb`'s `Depends: gjs (>= 1.86)` into `Depends: nodejs
 * (>= 24)` — a package that then refuses to install on trixie, Ubuntu 24.04 and
 * Ubuntu 26.04, for a macOS decision.
 *
 * `browser` and `nativescript` are refused here rather than deeper down, and not
 * for want of a launcher line: a browser bundle has no process to start, and a
 * NativeScript app ships as an APK/IPA through a different pipeline entirely
 * (ADR 0024 § 4). The refusal names the KEY that carried the value, because with
 * two keys "this project declares" no longer locates it.
 *
 * NOT PER LAYOUT BY DEFAULT, and the first cut of the layout axis got this
 * exactly backwards. Reading ADR § 4's runtime table as a per-layout
 * REQUIREMENT refused `gjsify.app: "gjs"` for the macOS layout — the entire
 * audience of that command — while a project with no `gjsify.app` key sailed
 * through and staged a launcher naming `node` in front of a GJS bundle. § 4
 * derives the runtime a shipped artifact CARRIES, which is
 * `Layout.shippedRuntime`; what an artifact runs is what its author says, which
 * is this. So an absent override means the project field and never the layout's
 * derived answer.
 *
 * MUST NOT be fed `Config.forBuild`'s resolution, whose fallback is the HOST
 * runtime. That fallback is right for a build (`gjsify build` under Node should
 * produce a Node bundle by default) and catastrophic for a package: running this
 * command under Node would silently turn every undeclared GJS project into one
 * whose launcher execs `node`. An undeclared target is the common case for a GJS
 * app, and it means GJS.
 *
 * WHY THIS REFUSES WHERE `Layout.runtimeGap` ONLY WARNS, since the two describe
 * neighbouring predicaments and get opposite treatment. A runtime this command
 * cannot package would leave here as an ARTIFACT — a `.deb` a stranger installs,
 * which then fails at startup, with no gate between here and their machine. The
 * `runtimeGap` warns about something that is not an artifact: it is printed over
 * a staged tree, and only when that tree carries no interpreter of its own. The
 * per-FORMAT half of the same question is `assertFormatCanRunInterpreter`, which
 * asks what a container can EXECUTE rather than what an author declared.
 *
 * Until #1354 M0 the refusal read "only `gjs` can be packaged today", and that
 * was true: the launcher execed gjs unconditionally, so a `--app node` package
 * would have installed and died at startup. Both are packageable now —
 * `renderLauncher` execs the one this resolves to and `deriveDepends` declares
 * the same one, `gjs >= …` or `nodejs (>= 24)` / `nodejs(engine) >= 24`.
 *
 * Phase one only. `gjsify ship --from-stage` has no project to read either key
 * from and does not need one: the resolved value is what the stage manifest
 * records, so the packing host reads an answer rather than a default — and
 * `assertLauncherMatchesInterpreter` still compares the staged `bin/<name>`'s own
 * `exec` line against the dependency about to be written.
 */
export function resolveShipApp(input: {
    /** `gjsify.app` as DECLARED — `undefined` when the project declares nothing. */
    project?: string;
    /** `gjsify.ship.app`, the per-layout override table. */
    perTarget?: ShipAppOptions;
    /** The layout this run assembles. */
    layoutOs: HostOs;
}): ResolvedShipApp {
    const override = input.perTarget?.[input.layoutOs];
    const overridden = override !== undefined;
    const key = overridden ? `gjsify.ship.app.${input.layoutOs}` : 'gjsify.app';
    const declared = overridden ? override : input.project;
    if (declared !== undefined && declared !== 'gjs' && declared !== 'node') {
        throw new Error(
            `gjsify ship: \`${key}\` is "${declared}", and only \`gjs\` and \`node\` can be ` +
                'packaged. A browser bundle has no process to launch, and a NativeScript app ships as an APK/IPA ' +
                'through a different pipeline. ADR 0024 § 4 has the runtime-per-OS table.',
        );
    }
    return { app: declared === 'node' ? 'node' : 'gjs', key, overridden };
}

export interface ResolvedSettings {
    settings: ShipSettings;
    /** The merged metadata the renderers read. */
    metadata: AppMetadata;
    warnings: string[];
}

/** Freedesktop main category → deb `Section:` / rpm `Group:`. First match wins. */
const CATEGORY_SECTIONS: Array<[string, { section: string; group: string }]> = [
    ['Development', { section: 'devel', group: 'Development/Tools' }],
    ['Education', { section: 'education', group: 'Applications/Education' }],
    ['Game', { section: 'games', group: 'Amusements/Games' }],
    ['Graphics', { section: 'graphics', group: 'Applications/Multimedia' }],
    ['AudioVideo', { section: 'sound', group: 'Applications/Multimedia' }],
    ['Network', { section: 'net', group: 'Applications/Internet' }],
    ['Office', { section: 'text', group: 'Applications/Productivity' }],
    ['Science', { section: 'science', group: 'Applications/Engineering' }],
    ['System', { section: 'admin', group: 'Applications/System' }],
    ['Utility', { section: 'utils', group: 'Applications/System' }],
];

export function resolveShipSettings(input: SettingsInput): ResolvedSettings {
    const warnings: string[] = [];
    const { pkg, ship, flatpak, discovered } = input;

    // Both blocks extend AppMetadata, so `gjsify.ship` overriding
    // `gjsify.flatpak` key-by-key is exactly the fallback ADR 0024 § 8 asks
    // for. The non-metadata keys each block carries ride along unread.
    const metadata: AppMetadata = { ...flatpak, ...definedOnly(ship) };

    // A type this package DEFINES is also a type it handles. Folding it into `provides.mimetypes`
    // here means the desktop entry and the metainfo need no knowledge of `mimeTypes` at all: they
    // already render `MimeType=` (with the `%f` field code) and `<mediatype>` from that one field.
    // Doing it the other way — leaving the two lists independent — makes "defined but not handled"
    // a state you can reach by omission, and that state installs cleanly and does nothing.
    const mimeTypes = ship.mimeTypes ?? [];
    if (mimeTypes.length > 0) {
        validateMimeTypes(mimeTypes);
        const handled = new Set([...(metadata.provides?.mimetypes ?? []), ...mimeTypes.map((m) => m.type)]);
        metadata.provides = { ...metadata.provides, mimetypes: [...handled] };
    }

    const binaryName = ship.binaryName ?? deriveBinaryName(pkg.name);
    const appId = ship.appId ?? flatpak.appId ?? reverseDnsOrThrow(pkg.name, binaryName);
    const name = metadata.name ?? titleCase(binaryName);
    const kind = metadata.kind ?? 'app';
    // NOT resolved here. `resolveShipApp` above is the one place that turns
    // `gjsify.app` plus `gjsify.ship.app.<os>` into a runtime, and this function
    // is reached AFTER the format list has already been decided from it — a
    // second defaulting rule here would be the second path the two could disagree
    // on, which is precisely what a per-target runtime cannot afford.
    const app = input.app;

    const rawVersion = ship.version ?? pkg.version;
    if (!rawVersion) {
        throw new Error('gjsify ship: no version — set `version` in package.json or `gjsify.ship.version`.');
    }
    const normalised = normaliseVersion(rawVersion);
    warnings.push(...normalised.warnings);

    const license = metadata.license?.project ?? pkg.license;
    if (!license) {
        throw new Error(
            'gjsify ship: no licence — set `license` in package.json (an SPDX id, e.g. "MIT") ' +
                'or `gjsify.ship.license.project`. Both deb and rpm carry it as a required field.',
        );
    }

    const maintainer = ship.maintainer ?? formatAuthor(pkg.author) ?? formatDeveloper(metadata);
    if (!maintainer) {
        throw new Error(
            'gjsify ship: no maintainer — set `author` in package.json ("Name <you@example.com>"), ' +
                '`gjsify.ship.maintainer`, or `gjsify.ship.developer`. dpkg refuses a package without one.',
        );
    }

    const summary = metadata.summary ?? pkg.description ?? name;
    const description = descriptionParagraphs(metadata.description) ?? [summary];
    const sections = sectionsFor(metadata.categories);

    if (kind === 'app' && discovered.iconFiles.length === 0) {
        warnings.push(
            `gjsify ship: no icon found — the installed app will show a placeholder in menus and app stores. ` +
                'Point `gjsify.ship.icon` at an SVG (or a directory of sized PNGs).',
        );
    }

    // Resolved here rather than in the packer, because the packer may run on a
    // host with no `package.json` at all (ADR 0024 § A2) — and because the
    // finish-args default depends on `kind`, which is a project fact.
    const flatpakSettings = resolveShipFlatpakSettings({ ship, flatpak, kind });
    warnings.push(...flatpakSettings.warnings);

    const settings: ShipSettings = {
        projectDir: input.projectDir,
        appId,
        name,
        binaryName,
        version: normalised.version,
        release: assertRelease(ship.release ?? '1'),
        maintainer,
        summary,
        description,
        license,
        licenseFile: discovered.licenseFile,
        homepage: metadata.homepageUrl ?? pkg.homepage,
        section: ship.section ?? sections.section,
        group: ship.group ?? sections.group,
        kind,
        mimeTypes,
        extraDepends: { deb: ship.depends?.deb ?? [], rpm: ship.depends?.rpm ?? [] },
        typelibPackages: ship.typelibPackages ?? {},
        bundlePath: discovered.bundlePath,
        bundleDir: discovered.bundleDir,
        iconFiles: discovered.iconFiles,
        schemaFiles: discovered.schemaFiles,
        typelibFiles: discovered.typelibFiles,
        localeFiles: discovered.localeFiles,
        extraFiles: ship.extraFiles ?? {},
        execArgs: ship.execArgs ?? [],
        outDir: input.cli.outDir ?? ship.outDir ?? 'ship',
        arch: input.cli.arch ?? process.arch,
        app,
        layoutOs: input.cli.layoutOs,
        minGjsVersion: ship.minGjsVersion ?? DEFAULT_GJS_FLOOR,
        minNodeVersion: ship.minNodeVersion ?? DEFAULT_NODE_FLOOR,
        flatpak: flatpakSettings.settings,
    };

    return { settings, metadata, warnings };
}

/** The bundle path a project declares, in the order the rest of the CLI reads them. */
export function declaredBundlePath(pkg: ShipPackageManifest, ship: ConfigDataShip): string | undefined {
    return ship.bundle ?? pkg.gjsify?.main ?? pkg.main;
}

/** npm package name → a package/binary name both dpkg and rpm accept. */
export function deriveBinaryName(pkgName: string | undefined): string {
    if (!pkgName) {
        throw new Error('gjsify ship: no package name — set `name` in package.json or `gjsify.ship.binaryName`.');
    }
    const unscoped = pkgName.includes('/') ? (pkgName.split('/').pop() as string) : pkgName;
    const candidate = unscoped
        .toLowerCase()
        .replace(/[^a-z\d+.-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    // dpkg: at least two characters, starts alphanumeric, then [a-z0-9+.-].
    // rpm is looser, so satisfying dpkg satisfies both.
    if (!/^[a-z\d][a-z\d+.-]+$/.test(candidate)) {
        throw new Error(
            `gjsify ship: cannot derive a package name from "${pkgName}" (got "${candidate}"). ` +
                'Set `gjsify.ship.binaryName` to something matching `[a-z0-9][a-z0-9+.-]+`.',
        );
    }
    return candidate;
}

function reverseDnsOrThrow(pkgName: string | undefined, binaryName: string): string {
    if (pkgName && /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*){2,}$/.test(pkgName)) return pkgName;
    throw new Error(
        `gjsify ship: no application id. Set \`gjsify.ship.appId\` (or \`gjsify.flatpak.appId\`) to a ` +
            `reverse-DNS id such as "io.github.you.${titleCase(binaryName).replace(/\s+/g, '')}". ` +
            'It names the desktop entry, the AppStream component and the installed icon, so it cannot be guessed.',
    );
}

function definedOnly<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function titleCase(value: string): string {
    return value
        .split(/[-_.]+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function sectionsFor(categories: readonly string[] | undefined): { section: string; group: string } {
    for (const [category, mapped] of CATEGORY_SECTIONS) {
        if (categories?.includes(category)) return mapped;
    }
    return { section: 'misc', group: 'Applications/System' };
}

function formatAuthor(author: ShipPackageManifest['author']): string | undefined {
    if (typeof author === 'string') {
        // npm's shorthand is `Name <email> (url)`; the url has no place in
        // either package format's maintainer field.
        return author.replace(/\s*\([^)]*\)\s*$/, '').trim() || undefined;
    }
    if (author?.name) return author.email ? `${author.name} <${author.email}>` : author.name;
    return undefined;
}

function formatDeveloper(metadata: AppMetadata): string | undefined {
    const developer = metadata.developer;
    if (!developer?.name) return undefined;
    return developer.email ? `${developer.name} <${developer.email}>` : developer.name;
}

/** AppStream description (string or blocks) → plain paragraphs for deb/rpm. */
export function descriptionParagraphs(
    description: string | Array<DescriptionBlock | string> | undefined,
): string[] | undefined {
    if (description === undefined) return undefined;
    if (typeof description === 'string') {
        const paragraphs = description
            .trim()
            .split(/\n\n+/)
            .map((p) => p.trim().replace(/\s+/g, ' '))
            .filter((p) => p.length > 0);
        return paragraphs.length > 0 ? paragraphs : undefined;
    }
    const out: string[] = [];
    for (const block of description) {
        // A plain string in the array is what a person writes when they mean one paragraph, and it
        // used to reach `'p' in block` and throw a bare TypeError — "cannot use 'in' operator to
        // search for \"p\" in \"Bauplaner rechnet…\"", which names neither the field nor the fix.
        // Accepting it is unambiguous: the AppStream blocks are objects, so a string can only mean
        // a paragraph.
        if (typeof block === 'string') {
            const text = block.trim().replace(/\s+/g, ' ');
            if (text) out.push(text);
        } else if ('p' in block) {
            out.push(block.p.trim().replace(/\s+/g, ' '));
        } else {
            for (const item of block.ul) {
                out.push(`* ${(typeof item === 'string' ? item : item.item).trim().replace(/\s+/g, ' ')}`);
            }
        }
    }
    return out.length > 0 ? out : undefined;
}

/** `LICENSE`, `LICENSE.md`, … — the names a licence file actually has. */
export const LICENSE_FILE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'] as const;

/** The bundle's own basename, used as the launcher's exec target. */
export function bundleEntryName(bundlePath: string): string {
    return basename(bundlePath);
}
