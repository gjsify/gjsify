// SPDX-License-Identifier: MIT
// WHAT gvsbuild CAN BUILD, snapshotted — the upstream half of ADR 0056.
//
// The Windows runtime bundle's audio payload is bounded by ONE external fact: gvsbuild
// carries a project definition for a library, or it does not. ADR 0056 § 1 makes that the
// first of three questions asked of any codec request, and § 3 answers it for MP3 and FLAC
// with "no project, therefore a gap".
//
// THAT ANSWER WAS PROSE ABOUT A MOVING ARTIFACT. `GVSBUILD_VERSION` is a pin, it is spelled
// in eight `env:` blocks across four workflows, and a newer gvsbuild release exists at every
// moment. The day upstream adds `flac.py` the gap's own `why` becomes false, and nothing in
// this repository is arranged to notice: the payload check compares the manifest to the bundle, the element
// test compares the manifest to a running registry, and BOTH stay green over a gap that
// could have been closed. That is #1544's class with the sign flipped — there, a decoder
// was absent and nothing said so; here, a REASON expires and nothing says so.
//
// So the catalogue is data in the tree, read back by `gvsbuild-catalogue` in
// `scripts/manifest-conformance/rules/`. The rule needs no network: it holds the snapshot
// against the pin the workflows carry, and the declarations against the snapshot. Fetching
// is this file's `--update`, which a person runs when moving the pin — and the diff it
// produces is where a newly available library becomes visible.
//
// MODULE BASENAMES, NOT PROJECT NAMES, and the difference is deliberate. `gvsbuild list`
// prints project names, of which `gstreamer.py` alone defines eleven; deriving them means
// parsing Python, and a first attempt at that regex silently missed `opus`, `cairo` and
// `dav1d` — a parser that under-reports turns every absence assertion below into a pass.
// A directory listing cannot be wrong in that direction, and it answers the question ADR
// 0056 § 1 actually asks: a library that gvsbuild learns to build arrives as its own module
// (`libvorbis.py`, `ogg.py`, `opus.py`, `dav1d.py`, `x264.py` are each one).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The snapshot, beside the builders whose payload it bounds. */
export const CATALOGUE_PATH = join(HERE, 'gvsbuild-catalogue.json');

/** Where the projects directory is read from, for a given tag. */
export function catalogueSourceUrl(version) {
    return `https://api.github.com/repos/wingtk/gvsbuild/contents/gvsbuild/projects?ref=${version}`;
}

/** Where one project's patch directory is read from, for a given tag. */
export function patchSourceUrl(version, project) {
    return `https://api.github.com/repos/wingtk/gvsbuild/contents/gvsbuild/patches/${project}?ref=${version}`;
}

/**
 * The committed snapshot.
 *
 * THROWS rather than answering a default. An unreadable catalogue makes every "gvsbuild has
 * no project for this" assertion vacuously true, which is the one direction this file
 * exists to keep shut.
 *
 * @param {string} [path]
 * @returns {{version: string, readAt: string, source: string, modules: string[],
 *   patches: Record<string, string[]>}}
 */
export function readGvsbuildCatalogue(path = CATALOGUE_PATH) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw?.version !== 'string' || !Array.isArray(raw?.modules)) {
        throw new Error(`gvsbuild-catalogue: ${path} has no \`version\` string and \`modules\` array`);
    }
    // `patches` defaults to an EMPTY OBJECT, never to "no patch list here means no patches":
    // a gap whose project is missing from it is reported as uncompared by
    // `gapUpstreamProblems`, which is the one answer that cannot be wrong in the quiet
    // direction. A missing entry must never read as "upstream stopped patching".
    return { patches: {}, ...raw };
}

/**
 * The spelling two names are compared in: lower case, with the separators gvsbuild itself
 * mixes removed. `adwaita_icon_theme.py` is the project `adwaita-icon-theme`, and a caller
 * asking about `libFLAC` must match a `libflac.py` that upstream has not written yet.
 */
export function normalizeProject(name) {
    return String(name).toLowerCase().replace(/[-_.]/g, '');
}

/**
 * Every catalogue module whose name CONTAINS the library, normalised.
 *
 * A substring and not an equality, because the one thing that cannot be known in advance is
 * how upstream will spell the file: libvorbis is `libvorbis.py` and opus is `opus.py`, so a
 * future FLAC project is `flac.py` or `libflac.py` with equal likelihood and an exact match
 * would answer "still absent" to one of them.
 *
 * @param {string[]} modules
 * @param {string} library
 * @returns {string[]} the matching module names, in the catalogue's spelling
 */
export function matchLibrary(modules, library) {
    const needle = normalizeProject(library);
    if (needle.length === 0) return [];
    return modules.filter((module) => normalizeProject(module).includes(needle));
}

/**
 * Fetch the projects directory at `version` and return the module basenames.
 *
 * The GitHub contents API rather than the PyPI wheel `pipx install gvsbuild==<version>`
 * actually unpacks, because reading a zip needs a zip reader and reading this needs
 * `fetch`. The two were cross-read at 2026.6.0 and produced byte-identical 95-entry lists,
 * which is what makes the cheaper oracle usable — the wheel is built from this tag.
 */
export async function fetchCatalogueModules(version) {
    const response = await fetch(catalogueSourceUrl(version), {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'gjsify-gvsbuild-catalogue' },
    });
    if (!response.ok) {
        throw new Error(`gvsbuild-catalogue: ${catalogueSourceUrl(version)} answered ${response.status}`);
    }
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error(`gvsbuild-catalogue: ${catalogueSourceUrl(version)} listed no entry`);
    }
    return entries
        .map((entry) => String(entry.name))
        .filter((name) => name.endsWith('.py') && name !== '__init__.py')
        .map((name) => name.slice(0, -'.py'.length))
        .sort();
}

/**
 * The patch file names gvsbuild applies to one project at `version`, sorted.
 *
 * An ABSENT patch directory answers `[]` and nothing else: a project upstream patches today
 * and stops patching tomorrow loses its directory entirely, and that is exactly the event a
 * gap resting on a patch has to notice. Every other non-OK status throws, because "could not
 * read it" must not be spelled the same way as "there are none".
 */
export async function fetchProjectPatches(version, project) {
    const url = patchSourceUrl(version, project);
    const response = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'gjsify-gvsbuild-catalogue' },
    });
    if (response.status === 404) return [];
    if (!response.ok) {
        throw new Error(`gvsbuild-catalogue: ${url} answered ${response.status}`);
    }
    const entries = await response.json();
    if (!Array.isArray(entries)) {
        throw new Error(`gvsbuild-catalogue: ${url} did not list a directory`);
    }
    return entries
        .filter((entry) => entry.type === 'file')
        .map((entry) => String(entry.name))
        .sort();
}

/**
 * The projects whose patch list the snapshot carries.
 *
 * A SECOND KIND OF UPSTREAM BOUND. `modules` answers "can gvsbuild build this library at
 * all", which is what the MP3/FLAC gaps rest on. It cannot answer the question the Adw
 * appdata gap rests on: gvsbuild builds libadwaita perfectly and then applies a patch that
 * compiles two entry points out on Windows (`typelib-symbols.mjs` § THE CAUSE IS UPSTREAM).
 * So the patch directory is read too — for the projects a declared gap actually blames, not
 * for all 94, because every extra entry is a request `--update` makes and a line somebody has
 * to believe.
 *
 * A LIST HERE RATHER THAN A DERIVATION FROM `TYPELIB_API_GAPS`, which is the direction that
 * reads better and does not work: that module imports this one, and a dynamic import back
 * closes the cycle around this file's own top-level `await main()` — measured, the process
 * printed "Detected unsettled top-level await" and wrote nothing. The un-forgettable half is
 * kept by a test instead (`every declared typelib-API gap names a project the snapshot
 * covers`), which fails on a gap naming a project absent from here.
 */
export const PATCHED_PROJECTS = ['libadwaita'];

/** `--update <version>`: re-read the catalogue and print what moved. */
async function main(argv) {
    const current = readGvsbuildCatalogue();
    const version = argv.find((a) => !a.startsWith('--')) ?? current.version;
    const modules = await fetchCatalogueModules(version);

    const before = new Set(current.modules);
    const after = new Set(modules);
    const added = modules.filter((m) => !before.has(m));
    const removed = current.modules.filter((m) => !after.has(m));

    const patches = {};
    const patchMoves = [];
    for (const project of PATCHED_PROJECTS) {
        const key = normalizeProject(project);
        const list = await fetchProjectPatches(version, project);
        patches[key] = list;
        const was = current.patches?.[key] ?? [];
        const gone = was.filter((p) => !list.includes(p));
        const arrived = list.filter((p) => !was.includes(p));
        if (gone.length || arrived.length) {
            patchMoves.push(`  ${project}: -${gone.join(' -') || '(none)'} +${arrived.join(' +') || '(none)'}`);
        }
    }

    writeFileSync(
        CATALOGUE_PATH,
        `${JSON.stringify(
            {
                version,
                readAt: new Date().toISOString().slice(0, 10),
                source: catalogueSourceUrl(version),
                modules,
                patches,
            },
            null,
            4,
        )}\n`,
    );

    console.log(`gvsbuild ${current.version} → ${version}: ${modules.length} project module(s)`);
    console.log(added.length === 0 ? '  added:   (none)' : `  added:   ${added.join(', ')}`);
    console.log(removed.length === 0 ? '  removed: (none)' : `  removed: ${removed.join(', ')}`);
    console.log(
        patchMoves.length === 0
            ? `  patches: unchanged for ${Object.keys(patches).join(', ') || '(no project)'}`
            : `  patches moved:\n${patchMoves.join('\n')}`,
    );
    console.log(
        '\nEvery `GVSBUILD_VERSION` in .github/workflows/ must now name this version, and a module that\n' +
            'ARRIVED may retire a declared gap in packages/node-gi/gtk-runtime-win32-x64/package.json —\n' +
            'the `gvsbuild-catalogue` rule fails on both until they agree (ADR 0056 § 1).\n' +
            'A PATCH that DISAPPEARED may retire a TYPELIB_API_GAPS entry in\n' +
            'packages/node-gi/scripts/typelib-symbols.mjs the same way: rebuild the bundle and let the\n' +
            'floor say whether the entry points are there now.',
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main(process.argv.slice(2));
}
