// Finding the payload on disk.
//
// The half of `gjsify ship` that must touch the filesystem, kept in one module
// so `settings.ts` and `plan.ts` can stay pure. Every probe has a configured
// override; the probes exist so a project that follows the GNOME convention
// (`data/icons/hicolor/…`, `data/*.gschema.xml`) needs no configuration at all.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import type { ConfigDataShip } from '../../types/config-data.js';
import { LICENSE_FILE_NAMES, type DiscoveredPayload, type ShipPackageManifest } from './settings.js';

const ICON_EXTENSIONS = ['.svg', '.png'];

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
            if (/\.typelib$|\.so(\.\d+)*$/.test(file)) out.push(join(root, file));
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
    const prefix = `${rel.split(/[\\/]/).join('/')}/`;
    return bundleFiles.filter((file) => !`${file.split(/[\\/]/).join('/')}/`.startsWith(prefix));
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
        // POSIX separators: `listFilesRecursive` yields host-shaped paths, and the check is about
        // the gettext LAYOUT, which is the same on every host.
        const parts = rel.split(/[\\/]/);
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

function discoverLicense(projectDir: string, configured: string | undefined): string | undefined {
    if (configured !== undefined) {
        const target = resolve(projectDir, configured);
        if (!existsSync(target)) {
            throw new Error(`gjsify ship: the configured licence file ${configured} does not exist.`);
        }
        return target;
    }
    for (const name of LICENSE_FILE_NAMES) {
        const target = join(projectDir, name);
        if (existsSync(target)) return target;
    }
    return undefined;
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
