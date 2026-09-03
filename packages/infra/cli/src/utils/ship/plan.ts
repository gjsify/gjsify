// Which file lands where — decided without touching the filesystem, so every
// case (including the ones that must be REFUSED) is unit-testable. Same split
// as `utils/copy-targets.ts`, and for the same reason: a stager that discovers
// its own inputs can only be tested by building a real project.

import { renderMimePackage } from './mime.js';
import { SHARE } from './share-dirs.js';
import { basename, extname, posix } from 'node:path';

import type { FormatDescriptor, FormatId, ShipSettings, StagedFile } from './types.js';

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
 *
 * ONE plan, in the Linux/XDG shape, for every OS. Where those paths end up is
 * `utils/ship/layout.ts`'s `placeStage`, applied afterwards by the caller, and
 * keeping the two steps apart is what makes ADR 0024 § 2's "one payload, a
 * handful of layouts" checkable: `tests/e2e/ship-layout` asserts the three
 * staged trees agree modulo that map. A planner that took the layout would have
 * three code paths to keep in agreement instead.
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
        path: `${SHARE.metainfo}/${settings.appId}.metainfo.xml`,
        mode: 0o644,
        source: { kind: 'text', text: inputs.metainfo },
    });

    if (settings.kind === 'app') {
        if (inputs.desktopEntry === undefined) {
            throw new Error('gjsify ship: internal error — a desktop entry is required for `kind: "app"`.');
        }
        files.push({
            path: `${SHARE.applications}/${settings.appId}.desktop`,
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
            path: `${SHARE.schemas}/${name}`,
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
            path: `${SHARE.mime}/${settings.appId}.xml`,
            mode: 0o644,
            source: { kind: 'text', text: renderMimePackage(settings.mimeTypes) },
        });
    }

    // Compiled gettext catalogues, layout preserved: `share/locale/<lang>/LC_MESSAGES/<domain>.mo`
    // is where `bindtextdomain` looks, and nowhere else.
    for (const locale of settings.localeFiles) {
        files.push({
            path: posix.join(SHARE.locale, locale.rel),
            mode: 0o644,
            source: { kind: 'file', path: locale.abs },
        });
    }

    for (const font of planFonts(settings)) files.push(font);

    for (const [dest, source] of Object.entries(settings.extraFiles)) {
        files.push({ path: assertInsidePrefix(dest), mode: 0o644, source: { kind: 'file', path: source } });
    }

    return normalise(files);
}

/**
 * Font faces, under a directory named after the app id (ADR 0038).
 *
 * `share/fonts` is shared with every other package on a `/usr` prefix, exactly as
 * `share/glib-2.0/schemas` and `share/mime/packages` are — so the app id is what
 * keeps a face called `Regular.ttf` from being one of two files claiming the same
 * path, with install order deciding the winner. Unlike those two the collision is
 * not refused by NAME: a font's filename is the foundry's and there is no
 * convention to hold it to, so the directory carries the id and the basenames are
 * left alone. fontconfig scans recursively, so nesting them costs nothing —
 * measured across fontconfig 2.14.1 → 2.18.3.
 *
 * A basename appearing twice IS refused, for the reason `planIcons` refuses one:
 * two source files installing as one path means one of them is silently not
 * shipped, and a missing face is a substituted typeface rather than an error.
 */
function planFonts(settings: ShipSettings): StagedFile[] {
    const out: StagedFile[] = [];
    const seen = new Map<string, string>();
    for (const font of settings.fontFiles) {
        const path = `${SHARE.fonts}/${settings.appId}/${basename(font)}`;
        const previous = seen.get(path);
        if (previous !== undefined) {
            throw new Error(
                `gjsify ship: ${font} and ${previous} both install as ${path}. ` +
                    'Two faces cannot share one filename — one would silently not ship, and a missing face ' +
                    'is a substituted typeface rather than an error. Rename one, or point ' +
                    '`gjsify.ship.fonts` at a directory holding only the faces you mean to ship.',
            );
        }
        seen.set(path, font);
        out.push({ path, mode: 0o644, source: { kind: 'file', path: font } });
    }
    return out;
}

/**
 * The per-format additions. Only the licence differs today, and it differs in
 * BOTH place and shape: Debian policy wants a machine-readable `copyright` in
 * `share/doc/<pkg>/`, RPM wants the licence text under `share/licenses/<pkg>/`.
 *
 * A project with no licence file is REFUSED here rather than packaged without
 * one. Debian Policy § 12.5 makes the copyright file mandatory and lintian
 * raises `no-copyright-file` as an error, but nothing between this function and
 * the installed package says so: an empty overlay produced a `.deb` whose
 * control file `dpkg-deb --info` prints cleanly, that `dpkg -i` installs, and
 * that is simply unlicensed. That is what gjsify's own package was, every
 * release of it, until the first CI leg that read one with a real `dpkg` said
 * so on its eighth assertion.
 *
 * It throws on the host that can act on it. This runs during `--stage` as well
 * as during a one-shot `ship`, so the refusal lands where the project — and the
 * missing `LICENSE` — actually is; {@link assertOverlayIsLicensed} repeats it at
 * pack time for a stage that arrived from somewhere else.
 */
export function planOverlay(settings: ShipSettings, format: FormatDescriptor, inputs: StageInputs): StagedFile[] {
    if (inputs.licenseText === undefined) {
        throw new Error(
            `gjsify ship: no licence file found, so the ${format.id} package would ship no ` +
                `${format.licenseDest(settings.binaryName)}. Debian Policy § 12.5 requires it and lintian ` +
                'errors without it, and neither dpkg nor rpm will tell you it is missing. Add a LICENSE file ' +
                `to ${settings.projectDir} or to the root of its repository, or point ` +
                '`gjsify.ship.licenseFile` at the one this package ships under.',
        );
    }
    const text =
        format.licenseKind === 'debian-copyright'
            ? renderDebianCopyright(settings, inputs.licenseText)
            : inputs.licenseText;
    return [{ path: format.licenseDest(settings.binaryName), mode: 0o644, source: { kind: 'text', text } }];
}

/**
 * The same refusal, at pack time.
 *
 * `planOverlay` cannot cover `--from-stage`: that path never plans anything, it
 * rehydrates the closure the assembling host wrote. A manifest whose
 * `overlay.deb` is `[]` passes every structural check in `readStageManifest`
 * — the key is present, the value is an array of the right shape — and the
 * silent unlicensed package comes back. The stage manifest's own header lists
 * "no `overlay`" among the omissions that fail at exit 0 with an artifact that
 * installs; this is where that stops being a comment.
 *
 * Cheap enough to run on both paths, so it does, and a stage written by this
 * version can no longer reach it.
 */
export function assertOverlayIsLicensed(formatId: FormatId, binaryName: string, overlay: readonly StagedFile[]): void {
    if (overlay.length > 0) return;
    throw new Error(
        `gjsify ship: this stage carries no ${formatId} licence overlay, so the package would ship no ` +
            `licence file for ${binaryName} — Debian Policy § 12.5 requires one and lintian errors without ` +
            'it. The fix is on the assembling host, not this one: give that project a LICENSE (or set ' +
            '`gjsify.ship.licenseFile`) and re-run the `--stage` phase.',
    );
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
        const path = `${SHARE.icons}/${dir}/apps/${settings.appId}${ext}`;
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
 *
 * EXPORTED for `utils/ship/app-runtime.ts`, which stages a relocated GTK closure
 * that never passes through this plan and needs the same answer for the same
 * files. A second copy of the pattern there would be a second answer to "is this
 * a shared library", and the drifted one is the one that stages a `.dylib` 0644.
 */
export function isExecutableAsset(rel: string): boolean {
    return /\.(so|node|dylib)(\.\d+)*$/.test(rel);
}

/** Last write wins, then sort — deterministic output for a deterministic artifact. */
function normalise(files: readonly StagedFile[]): StagedFile[] {
    const byPath = new Map<string, StagedFile>();
    for (const file of files) byPath.set(file.path, file);
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
