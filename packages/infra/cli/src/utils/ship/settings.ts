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

import { basename } from 'node:path';

import type { AppMetadata, ConfigDataFlatpak, ConfigDataShip, DescriptionBlock } from '../../types/config-data.js';
import { DEFAULT_GJS_FLOOR } from './depends.js';
import { assertRelease, normaliseVersion } from './version.js';
import type { ShipSettings } from './types.js';

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
    licenseFile?: string;
}

export interface SettingsInput {
    projectDir: string;
    pkg: ShipPackageManifest;
    ship: ConfigDataShip;
    /** Metadata fallback — `gjsify.flatpak` already carries these fields for many projects. */
    flatpak: ConfigDataFlatpak;
    cli: { outDir?: string; arch?: string };
    discovered: DiscoveredPayload;
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

    const binaryName = ship.binaryName ?? deriveBinaryName(pkg.name);
    const appId = ship.appId ?? flatpak.appId ?? reverseDnsOrThrow(pkg.name, binaryName);
    const name = metadata.name ?? titleCase(binaryName);
    const kind = metadata.kind ?? 'app';

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
        extraDepends: { deb: ship.depends?.deb ?? [], rpm: ship.depends?.rpm ?? [] },
        typelibPackages: ship.typelibPackages ?? {},
        bundlePath: discovered.bundlePath,
        bundleDir: discovered.bundleDir,
        iconFiles: discovered.iconFiles,
        schemaFiles: discovered.schemaFiles,
        typelibFiles: discovered.typelibFiles,
        extraFiles: ship.extraFiles ?? {},
        execArgs: ship.execArgs ?? [],
        outDir: input.cli.outDir ?? ship.outDir ?? 'ship',
        arch: input.cli.arch ?? process.arch,
        minGjsVersion: ship.minGjsVersion ?? DEFAULT_GJS_FLOOR,
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
