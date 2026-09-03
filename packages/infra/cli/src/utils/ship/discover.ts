// Finding the payload on disk.
//
// The half of `gjsify ship` that must touch the filesystem, kept in one module
// so `settings.ts` and `plan.ts` can stay pure. Every probe has a configured
// override; the probes exist so a project that follows the GNOME convention
// (`data/icons/hicolor/…`, `data/*.gschema.xml`) needs no configuration at all.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import type { ConfigDataShip } from '../../types/config-data.js';
import { LICENSE_FILE_NAMES, type DiscoveredPayload, type ShipPackageManifest } from './settings.js';

const ICON_EXTENSIONS = ['.svg', '.png'];

/**
 * The face formats every FreeType opens, with no build option deciding it.
 *
 * TrueType, OpenType and their collections. Deliberately short: the point of the
 * set is that a file in it resolves inside the app's OWN runtime closure as well
 * as it does on the machine that packaged it.
 */
const FONT_EXTENSIONS = ['.ttf', '.otf', '.ttc', '.otc'];

/**
 * Web-font wrappers, refused BY NAME rather than filtered away.
 *
 * They are the mistake worth a diagnostic. An `OFL.txt` beside the faces is
 * ignored the way a stray file in an icon directory is; a `.woff2` is a font
 * somebody put there on purpose, and dropping it silently costs the same as
 * staging it — the app ships without the family and Pango substitutes, at exit 0.
 *
 * Measured in BOTH directions, which is why this is a refusal rather than a
 * warning: `fc-query` reads a `.woff2`'s family fine on Fedora 44 (fontconfig
 * 2.17.0, FreeType built with brotli), and that support is
 * `FT_CONFIG_OPTION_USE_BROTLI` — a property of whichever FreeType the shipped
 * artifact loads, which for a `.app` or a Windows program directory is the one
 * inside `@gjsify/gtk-runtime-<target>` and not this host's.
 */
const WEB_FONT_EXTENSIONS = ['.woff', '.woff2', '.eot'];

export interface DiscoverInput {
    projectDir: string;
    pkg: ShipPackageManifest;
    ship: ConfigDataShip;
    /** `gjsify.flatpak.icon`, the pre-existing spelling of the same thing. */
    flatpakIcon?: string;
    /** The bundle path the project declares. */
    declaredBundle?: string;
}

export function discoverPayload(input: DiscoverInput): DiscoveredPayload {
    const { projectDir, ship } = input;
    const bundlePath = resolveBundle(input);
    const bundleDir = resolve(bundlePath, '..');

    const localeFiles = discoverLocales(projectDir, ship.localeDir);

    return {
        bundlePath,
        bundleDir,
        // Everything beside the bundle, MINUS the locale tree when it lives there.
        //
        // `dist/locale/` sits next to `dist/app.gjs.mjs` in the layout
        // `@gjsify/vite-plugin-gettext` writes by default, and the wholesale bundle staging would
        // then put every catalogue in `lib/<binary>/locale/` as well as in `share/locale/`.
        // Measured on a probe package: the same `.mo` appeared at both paths. The `lib/` copy is
        // dead weight — nothing looks there — and it is the same failure that once shipped the test
        // suite: whatever is beside the bundle gets carried whether or not it belongs in a package.
        bundleFiles: withoutLocaleTree(listFilesRecursive(bundleDir), bundleDir, projectDir, ship.localeDir),
        iconFiles: discoverIcons(projectDir, ship.icon ?? input.flatpakIcon),
        schemaFiles: discoverSchemas(projectDir, ship.schemas),
        typelibFiles: discoverTypelibs(projectDir, ship.bundledTypelibs),
        localeFiles,
        fontFiles: discoverFonts(projectDir, ship.fonts),
        licenseFile: discoverLicense(projectDir, ship.licenseFile),
    };
}

/**
 * Typelibs (and their shared libraries) the PROJECT ships itself.
 *
 * Necessary because gjsify's own GI libraries — `Gwebgl` for the WebGL bridge, the GTK runtime
 * bundles, the napi host — arrive as npm prebuilds, not as distro packages. An app using one has
 * no `gir1.2-…` to depend on: it must carry the files, and something must point GI at them.
 *
 * A directory rather than a list of files, because a typelib is never alone: `Gwebgl-0.1.typelib`
 * is useless without `libgwebgl.so`, and staging one without the other produces a package that
 * installs and then fails at the first import.
 */
function discoverTypelibs(projectDir: string, dirs: string[] | undefined): string[] {
    const out: string[] = [];
    for (const dir of dirs ?? []) {
        const root = resolve(projectDir, dir);
        if (!existsSync(root)) {
            throw new Error(
                `gjsify ship: \`gjsify.ship.bundledTypelibs\` names ${dir}, which does not exist. ` +
                    'A missing directory here means the package would install without the typelib it promises.',
            );
        }
        for (const file of listFilesRecursive(root)) {
            // Every shared-library spelling, not only ELF's. A typelib is
            // useless without its library on macOS and Windows too, and the
            // `.so`-only test dropped `libgwebgl.dylib` and `gwebgl-0.dll` while
            // staging the `.typelib` beside them — a package that installs and
            // dies at the first import, with nothing in the output saying so.
            // The layout axis (ADR 0024 § 2) is what put those two files in
            // reach: they land in `Contents/Frameworks` and in the program
            // directory's `lib\`.
            // Case-insensitive for the extensions that come off case-preserving-
            // but-INSENSITIVE filesystems — `LIBFOO.DLL` and `Foo.Dylib` are
            // ordinary names on macOS and Windows, and a lowercase-only test drops
            // them into exactly the silent failure the paragraph above describes.
            //
            // NOT for `.so`, and the asymmetry is the reason rather than an
            // oversight: ELF sonames come off case-SENSITIVE filesystems where
            // `libfoo.so` is the only spelling, and `/i` there additionally makes
            // `README.SO` a shared library. One rationale, one scope.
            if (/\.(typelib|dylib|dll)$/i.test(file) || /\.so(\.\d+)*$/.test(file)) out.push(join(root, file));
        }
    }
    return out;
}

/**
 * Drop the declared locale tree from the wholesale bundle staging.
 *
 * Only when it actually lies inside the bundle directory — a `localeDir` elsewhere in the project
 * was never part of `bundleFiles` and there is nothing to subtract.
 */
function withoutLocaleTree(
    bundleFiles: string[],
    bundleDir: string,
    projectDir: string,
    localeDir: string | undefined,
): string[] {
    if (localeDir === undefined) return bundleFiles;
    const localeRoot = resolve(projectDir, localeDir);
    const rel = relative(bundleDir, localeRoot);
    // Outside the bundle dir: `relative` climbs out (`..`) or returns an absolute path.
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return bundleFiles;
    // Only `rel` needs normalising: it comes from `relative`, so it is host-shaped, while
    // `bundleFiles` is POSIX by `listFilesRecursive`'s contract. Comparing a host-shaped prefix
    // against POSIX entries matches nothing on Windows — and matching nothing here means the
    // catalogues quietly ship twice again, on that platform only.
    const prefix = `${rel.split(sep).join(posix.sep)}${posix.sep}`;
    return bundleFiles.filter((file) => !`${file}${posix.sep}`.startsWith(prefix));
}

/**
 * Compiled gettext catalogues the project ships (`gjsify.ship.localeDir`).
 *
 * Only `.mo` files, and only in the layout `bindtextdomain` actually reads —
 * `<lang>/LC_MESSAGES/<domain>.mo`. Both refusals cover the same failure, which is the quiet kind:
 * a catalogue in the wrong place, or left as `.po`, installs perfectly and the app then shows the
 * untranslated msgid forever. That is indistinguishable from "no translation exists", so it is not
 * something a user or a maintainer would ever report as a packaging bug.
 */
function discoverLocales(projectDir: string, dir: string | undefined): { rel: string; abs: string }[] {
    if (dir === undefined) return [];
    const root = resolve(projectDir, dir);
    if (!existsSync(root)) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.localeDir\` names ${dir}, which does not exist. ` +
                'Compile the catalogues first (msgfmt, or @gjsify/vite-plugin-gettext) — a missing ' +
                'directory here means the package would install without the translations it promises.',
        );
    }
    const out: { rel: string; abs: string }[] = [];
    const strays: string[] = [];
    for (const rel of listFilesRecursive(root)) {
        if (rel.endsWith('.po') || rel.endsWith('.pot')) {
            strays.push(`${rel} (a .po source; bindtextdomain reads .mo only)`);
            continue;
        }
        if (!rel.endsWith('.mo')) continue;
        // `listFilesRecursive` normalises to POSIX, so one separator is all there is to split on.
        const parts = rel.split(posix.sep);
        if (parts.length !== 3 || parts[1] !== 'LC_MESSAGES') {
            strays.push(`${rel} (expected <lang>/LC_MESSAGES/<domain>.mo)`);
            continue;
        }
        out.push({ rel: parts.join('/'), abs: join(root, rel) });
    }
    if (strays.length > 0) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.localeDir\` (${dir}) holds files no catalogue lookup will find:\n` +
                strays.map((s) => `  ${s}`).join('\n') +
                '\nA misplaced catalogue installs and then shows nothing, which reads exactly like having ' +
                'no translation at all. Lay them out as <lang>/LC_MESSAGES/<domain>.mo.',
        );
    }
    if (out.length === 0) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.localeDir\` (${dir}) contains no \`.mo\` catalogue. ` +
                'Declaring a locale directory that ships nothing is a promise the package does not keep.',
        );
    }
    return out;
}

function resolveBundle(input: DiscoverInput): string {
    const declared = input.declaredBundle;
    if (declared === undefined) {
        throw new Error(
            'gjsify ship: no bundle to ship. Set `gjsify.main` (or `main`) in package.json to the built ' +
                'bundle, or `gjsify.ship.bundle` to override it.',
        );
    }
    const bundlePath = isAbsolute(declared) ? declared : resolve(input.projectDir, declared);
    if (!existsSync(bundlePath)) {
        throw new Error(
            `gjsify ship: the bundle ${declared} does not exist. Build it first (\`gjsify run build\`), ` +
                'or drop `--skip-build`.',
        );
    }
    return bundlePath;
}

/**
 * Icons: an explicit file, an explicit directory, or the GNOME convention.
 *
 * A directory is walked rather than globbed because the size lives in the PATH
 * (`hicolor/128x128/apps/…`) as often as in the filename.
 */
function discoverIcons(projectDir: string, configured: string | undefined): string[] {
    if (configured !== undefined) {
        const target = resolve(projectDir, configured);
        if (!existsSync(target)) {
            throw new Error(`gjsify ship: the configured icon path ${configured} does not exist.`);
        }
        return statSync(target).isDirectory() ? listIcons(target) : [target];
    }
    for (const candidate of ['data/icons', 'data/icons/hicolor']) {
        const target = join(projectDir, candidate);
        if (existsSync(target) && statSync(target).isDirectory()) {
            const icons = listIcons(target);
            if (icons.length > 0) return icons;
        }
    }
    return [];
}

function listIcons(dir: string): string[] {
    return listFilesRecursive(dir)
        .filter((rel) => ICON_EXTENSIONS.some((ext) => rel.toLowerCase().endsWith(ext)))
        .map((rel) => join(dir, rel.split('/').join(sep)))
        .sort();
}

/**
 * Font faces the application SHIPS (`gjsify.ship.fonts`), or the GNOME-shaped
 * default `data/fonts` when it exists.
 *
 * A FILE or a DIRECTORY, like `icon`, and a directory is walked rather than
 * globbed because a family arrives as several faces and often with its licence
 * beside them.
 *
 * The refusals are the interesting half, and both cover the same failure: a font
 * that installs and is never found. Pango does not report a missing family — it
 * substitutes, so the app renders in the wrong typeface with no error, no exit
 * code and nothing for CI to see. That is why a configured path holding no usable
 * face fails here rather than staging an empty directory, and why a web-font
 * wrapper is named rather than filtered (see {@link WEB_FONT_EXTENSIONS}).
 */
function discoverFonts(projectDir: string, configured: string | undefined): string[] {
    const declared = configured ?? 'data/fonts';
    const root = configured === undefined ? join(projectDir, 'data', 'fonts') : resolve(projectDir, configured);
    if (!existsSync(root)) {
        if (configured === undefined) return [];
        throw new Error(`gjsify ship: the configured font path ${configured} does not exist.`);
    }
    if (!statSync(root).isDirectory()) {
        assertNotWebFont(root, declared);
        if (!FONT_EXTENSIONS.some((ext) => root.toLowerCase().endsWith(ext))) {
            throw new Error(
                `gjsify ship: \`gjsify.ship.fonts\` names ${configured}, which is not a font face ` +
                    `fontconfig will open (${FONT_EXTENSIONS.join(', ')}). ` +
                    'A file it cannot read installs and is never found, and Pango substitutes a fallback ' +
                    'family rather than reporting anything.',
            );
        }
        return [root];
    }

    const out: string[] = [];
    for (const rel of listFilesRecursive(root)) {
        assertNotWebFont(rel, declared);
        if (FONT_EXTENSIONS.some((ext) => rel.toLowerCase().endsWith(ext))) {
            out.push(join(root, rel.split('/').join(sep)));
        }
    }
    if (out.length === 0 && configured !== undefined) {
        throw new Error(
            `gjsify ship: \`gjsify.ship.fonts\` (${configured}) holds no font face ` +
                `(${FONT_EXTENSIONS.join(', ')}). Declaring fonts that ship nothing is a promise the ` +
                'package does not keep — and its symptom is a substituted family, not an error.',
        );
    }
    return out.sort();
}

/** A `.woff`/`.woff2`/`.eot` is named, never dropped — {@link WEB_FONT_EXTENSIONS} carries the reason. */
function assertNotWebFont(path: string, where: string): void {
    const lower = path.toLowerCase();
    const wrapper = WEB_FONT_EXTENSIONS.find((ext) => lower.endsWith(ext));
    if (wrapper === undefined) return;
    throw new Error(
        `gjsify ship: \`gjsify.ship.fonts\` (${where}) carries ${path}, and \`${wrapper}\` is a web-font ` +
            'wrapper whose support is a FreeType BUILD option — brotli for woff2, zlib for woff. Whether it ' +
            'opens is therefore a property of the FreeType the SHIPPED artifact loads (inside ' +
            '`@gjsify/gtk-runtime-<target>` for a `.app` or a Windows program directory), not of the machine ' +
            `that packaged it. Ship the desktop face instead (${FONT_EXTENSIONS.join(', ')}); a font that ` +
            'fails to open is not an error, it is Pango quietly substituting a different typeface.',
    );
}

function discoverSchemas(projectDir: string, configured: string | undefined): string[] {
    const roots = configured !== undefined ? [resolve(projectDir, configured)] : [join(projectDir, 'data')];
    for (const root of roots) {
        if (!existsSync(root)) {
            if (configured !== undefined) {
                throw new Error(`gjsify ship: the configured schema path ${configured} does not exist.`);
            }
            continue;
        }
        if (!statSync(root).isDirectory()) return [root];
        const schemas = listFilesRecursive(root)
            .filter((rel) => rel.endsWith('.gschema.xml'))
            .map((rel) => join(root, rel.split('/').join(sep)))
            .sort();
        if (schemas.length > 0) return schemas;
    }
    return [];
}

/**
 * The licence text this package ships — searched UP the tree, not just beside
 * `package.json`.
 *
 * A monorepo package does not carry its own copy. `packages/infra/cli`
 * declares `"license": "MIT"` and the text lives one `LICENSE` up at the
 * repository root, shared by sixty-odd packages; searching `projectDir` alone
 * found nothing, `planOverlay` turned "nothing" into an empty overlay, and the
 * `.deb` shipped without the `/usr/share/doc/<pkg>/copyright` that Debian
 * Policy § 12.5 requires. Nothing downstream noticed: `dpkg-deb --info` prints
 * a clean control file and `dpkg -i` installs it. It took the first leg that
 * ran a real `lintian` to say so.
 *
 * WHERE THE SEARCH STOPS is the whole design. It climbs to the first ancestor
 * that is a project root — one holding `.git`, or a `package.json` declaring
 * `workspaces` — and searches that directory too, then stops. Above that line
 * a `LICENSE` belongs to some unrelated tree that happens to be a parent
 * directory (`~/Projekte/LICENSE` is not yours), and packaging its text would
 * make a specific false legal claim. When NO marker is found the search is the
 * project directory alone: without a marker there is no way to tell where the
 * project ends, and guessing wrong is the same false claim.
 *
 * What this cannot check is whether the inherited text is the RIGHT licence
 * for this package — an Apache-2.0 package inside an MIT monorepo would
 * inherit the wrong one. Reading an SPDX identifier out of licence prose is
 * not something to guess at, so the caller PRINTS the inherited path instead
 * (see `commands/ship.ts`), and `gjsify.ship.licenseFile` overrides it.
 */
function discoverLicense(projectDir: string, configured: string | undefined): string | undefined {
    if (configured !== undefined) {
        const target = resolve(projectDir, configured);
        if (!existsSync(target)) {
            throw new Error(`gjsify ship: the configured licence file ${configured} does not exist.`);
        }
        return target;
    }
    for (const dir of licenseSearchDirs(projectDir)) {
        for (const name of LICENSE_FILE_NAMES) {
            const target = join(dir, name);
            if (existsSync(target)) return target;
        }
    }
    return undefined;
}

/** `projectDir` first, then each ancestor up to and including the project root. */
function licenseSearchDirs(projectDir: string): string[] {
    const dirs: string[] = [];
    for (let current = projectDir; ;) {
        dirs.push(current);
        if (isProjectRoot(current)) return dirs;
        const parent = dirname(current);
        if (parent === current) return [projectDir];
        current = parent;
    }
}

/**
 * Is this the top of the tree the project belongs to?
 *
 * `.git` is tested with `existsSync` rather than `statSync().isDirectory()`
 * because in a git WORKTREE it is a file, and this repository is developed in
 * worktrees.
 */
function isProjectRoot(dir: string): boolean {
    if (existsSync(join(dir, '.git'))) return true;
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) return false;
    try {
        return (JSON.parse(readFileSync(manifest, 'utf-8')) as { workspaces?: unknown }).workspaces !== undefined;
    } catch {
        // A malformed `package.json` in some ancestor is not this command's
        // business, and it must not turn a licence search into a ship failure.
        // Not a root, then: the climb continues and `.git` still stops it.
        return false;
    }
}

/**
 * Every regular file under `dir`, as POSIX-separated relative paths.
 *
 * A symlink is refused rather than followed: both package formats can carry
 * one, but a symlink into the build tree would resolve to a path that does not
 * exist on the user's machine, and silently copying its TARGET turns one file
 * into an unexplained duplicate.
 */
export function listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isSymbolicLink()) {
                throw new Error(
                    `gjsify ship: ${full} is a symlink. The payload has to be self-contained — replace it ` +
                        'with the file it points at, or exclude it from the bundle directory.',
                );
            } else if (entry.isFile()) {
                out.push(posix.join(...relative(dir, full).split(sep)));
            }
        }
    };
    walk(dir);
    return out.sort();
}
