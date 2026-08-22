// Which file lands where — decided without touching the filesystem, so every
// case (including the ones that must be REFUSED) is unit-testable. Same split
// as `utils/copy-targets.ts`, and for the same reason: a stager that discovers
// its own inputs can only be tested by building a real project.

import { renderMimePackage } from './mime.js';
import { basename, extname, posix } from 'node:path';

import type { FormatDescriptor, ShipSettings, StagedFile } from './types.js';

/** Everything the planner needs that it cannot derive from the settings alone. */
export interface StageInputs {
    /** Paths inside `settings.bundleDir`, relative and POSIX-separated. */
    bundleFiles: readonly string[];
    /** The rendered launcher script. */
    launcher: string;
    /** The rendered AppStream MetaInfo XML. */
    metainfo: string;
    /** The rendered desktop entry — required for `kind: 'app'`, unused for `'cli'`. */
    desktopEntry?: string;
    /** Contents of the project's licence file, when one was found. */
    licenseText?: string;
}

/**
 * Build the prefix-relative payload.
 *
 * The result is deduplicated by path (last write wins, so `extraFiles` can
 * override anything the defaults staged) and sorted, which makes the tree —
 * and therefore every artifact built from it — deterministic.
 */
export function planStage(settings: ShipSettings, inputs: StageInputs): StagedFile[] {
    const files: StagedFile[] = [];
    const libDir = `lib/${settings.binaryName}`;

    files.push({ path: `bin/${settings.binaryName}`, mode: 0o755, source: { kind: 'text', text: inputs.launcher } });

    for (const rel of inputs.bundleFiles) {
        files.push({
            path: posix.join(libDir, rel),
            mode: isExecutableAsset(rel) ? 0o755 : 0o644,
            source: { kind: 'file', path: posix.join(settings.bundleDir, rel) },
        });
    }

    files.push({
        path: `share/metainfo/${settings.appId}.metainfo.xml`,
        mode: 0o644,
        source: { kind: 'text', text: inputs.metainfo },
    });

    if (settings.kind === 'app') {
        if (inputs.desktopEntry === undefined) {
            throw new Error('gjsify ship: internal error — a desktop entry is required for `kind: "app"`.');
        }
        files.push({
            path: `share/applications/${settings.appId}.desktop`,
            mode: 0o644,
            source: { kind: 'text', text: inputs.desktopEntry },
        });
        for (const icon of planIcons(settings)) files.push(icon);
    }

    for (const schema of settings.schemaFiles) {
        const name = basename(schema);
        // Every installed schema shares ONE system directory
        // (`/usr/share/glib-2.0/schemas`), so a generic name is a collision
        // with whatever else the distro installed there — and the loser is
        // decided by install order.
        if (!name.startsWith(settings.appId)) {
            throw new Error(
                `gjsify ship: the GSettings schema ${name} must be named \`${settings.appId}[.…].gschema.xml\`. ` +
                    'Every installed schema shares one system directory, so the app id is what keeps it unique.',
            );
        }
        files.push({
            path: `share/glib-2.0/schemas/${name}`,
            mode: 0o644,
            source: { kind: 'file', path: schema },
        });
    }

    // The typelibs the package carries itself, beside the bundle in `gi/`. The launcher points
    // GI_TYPELIB_PATH and LD_LIBRARY_PATH here — see renderLauncher.
    for (const file of settings.typelibFiles) {
        files.push({
            path: posix.join(libDir, 'gi', basename(file)),
            // A shared library must be executable; a typelib need not be, but one mode for both
            // keeps the staged tree free of a distinction nothing downstream reads.
            mode: 0o755,
            source: { kind: 'file', path: file },
        });
    }
    // A shared-mime-info document, when the project DEFINES a type rather than only handling one.
    // `share/mime/packages/` is shared between packages, so the app id is the filename for the same
    // reason it is for the GSettings schema: a generic name collides with another package's file.
    if (settings.mimeTypes.length > 0) {
        files.push({
            path: `share/mime/packages/${settings.appId}.xml`,
            mode: 0o644,
            source: { kind: 'text', text: renderMimePackage(settings.mimeTypes) },
        });
    }

    // Compiled gettext catalogues, layout preserved: `share/locale/<lang>/LC_MESSAGES/<domain>.mo`
    // is where `bindtextdomain` looks, and nowhere else.
    for (const locale of settings.localeFiles) {
        files.push({
            path: posix.join('share/locale', locale.rel),
            mode: 0o644,
            source: { kind: 'file', path: locale.abs },
        });
    }

    for (const [dest, source] of Object.entries(settings.extraFiles)) {
        files.push({ path: assertInsidePrefix(dest), mode: 0o644, source: { kind: 'file', path: source } });
    }

    return normalise(files);
}

/**
 * The per-format additions. Only the licence differs today, and it differs in
 * BOTH place and shape: Debian policy wants a machine-readable `copyright` in
 * `share/doc/<pkg>/`, RPM wants the licence text under `share/licenses/<pkg>/`.
 */
export function planOverlay(settings: ShipSettings, format: FormatDescriptor, inputs: StageInputs): StagedFile[] {
    if (inputs.licenseText === undefined) return [];
    const text =
        format.licenseKind === 'debian-copyright'
            ? renderDebianCopyright(settings, inputs.licenseText)
            : inputs.licenseText;
    return [{ path: format.licenseDest(settings.binaryName), mode: 0o644, source: { kind: 'text', text } }];
}

/**
 * Debian machine-readable copyright, format 1.0. The licence text is indented
 * by one space and its blank lines become ` .` — a bare blank line ends the
 * field, which silently truncates the licence to its first paragraph.
 */
function renderDebianCopyright(settings: ShipSettings, licenseText: string): string {
    const body = licenseText
        .trimEnd()
        .split('\n')
        .map((line) => (line.trim() === '' ? ' .' : ` ${line}`))
        .join('\n');
    return [
        'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
        `Upstream-Name: ${settings.name}`,
        ...(settings.homepage ? [`Source: ${settings.homepage}`] : []),
        '',
        'Files: *',
        `Copyright: ${settings.maintainer}`,
        `License: ${settings.license}`,
        body,
        '',
    ].join('\n');
}

/**
 * Icons land in the hicolor theme, named after the app id — that name is what
 * the desktop entry's `Icon=` and the MetaInfo `<id>` both point at, so a file
 * keeping its source basename installs an icon nothing ever looks up.
 */
function planIcons(settings: ShipSettings): StagedFile[] {
    const out: StagedFile[] = [];
    const seen = new Map<string, string>();
    for (const icon of settings.iconFiles) {
        const ext = extname(icon);
        const dir = iconSizeDir(icon);
        const path = `share/icons/hicolor/${dir}/apps/${settings.appId}${ext}`;
        const previous = seen.get(path);
        if (previous !== undefined) {
            throw new Error(
                `gjsify ship: ${icon} and ${previous} both install as ${path}. ` +
                    'Icon size is read from the path (`.../128x128/...`) or the filename (`icon-128.png`); ' +
                    'give them distinguishable sizes or point `gjsify.ship.icon` at a single file.',
            );
        }
        seen.set(path, icon);
        out.push({ path, mode: 0o644, source: { kind: 'file', path: icon } });
    }
    return out;
}

/**
 * The hicolor subdirectory for an icon: `scalable` for SVG, otherwise the
 * pixel size read from a `<n>x<n>` path component or a trailing number in the
 * filename.
 */
export function iconSizeDir(iconPath: string): string {
    if (extname(iconPath).toLowerCase() === '.svg') return 'scalable';
    const square = /(?:^|[\\/])(\d{1,4})x\1(?:[\\/]|$)/.exec(iconPath);
    if (square) return `${square[1]}x${square[1]}`;
    const tokens = basename(iconPath, extname(iconPath)).split(/[-_.]/);
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token !== undefined && /^\d{1,4}$/.test(token)) return `${token}x${token}`;
    }
    throw new Error(
        `gjsify ship: cannot tell what size ${iconPath} is. ` +
            'Put it in a `<size>x<size>/` directory, end its name with the size (`icon-128.png`), or ship an SVG.',
    );
}

/** A staged path must stay under the prefix — no absolute paths, no `..`. */
function assertInsidePrefix(dest: string): string {
    const normalised = posix.normalize(dest);
    if (posix.isAbsolute(normalised) || normalised === '..' || normalised.startsWith('../')) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.extraFiles\` destination "${dest}" escapes the install prefix. ` +
                'Destinations are relative to the prefix, e.g. `share/applications/extra.desktop`.',
        );
    }
    return normalised;
}

/**
 * A native module inside the payload has to keep its executable bit.
 *
 * By NAME here, unlike `isArchIndependent`, which reads the file's magic: the
 * planner is pure and has no bytes to look at. The two answer different
 * questions — "should this be 0755" versus "is this package portable" — and
 * getting this one wrong costs a mode bit, not an unusable package.
 */
function isExecutableAsset(rel: string): boolean {
    return /\.(so|node|dylib)(\.\d+)*$/.test(rel);
}

/** Last write wins, then sort — deterministic output for a deterministic artifact. */
function normalise(files: readonly StagedFile[]): StagedFile[] {
    const byPath = new Map<string, StagedFile>();
    for (const file of files) byPath.set(file.path, file);
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
