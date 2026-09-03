// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders. Two rules about the bundle's
// runtime DATA, both asserted on the FINISHED bundle:
//
//   1. it must be REAL FILES, not links into the machine that built it (findSymlinks);
//   2. every data set the bundle DECLARES must actually be in it (verifyWindowingData).
//
// Rule 1 is why the builders copy with copyTreeDereferenced() below: Homebrew links a keg's tree
// into `$(brew --prefix)` by SYMLINK, and `cpSync(…, { dereference: true })` DOES NOT dereference
// it — measured on node 24.15 and on the macOS runner, the flag governs only the stat of the path
// handed to `cpSync`, so every NESTED link stays a link (the first attempt at this fix passed it
// and left 859 links under `share/icons/Adwaita` pointing into `…/Cellar/adwaita-icon-theme/…`).
// `npm pack` archives a symlink as a symlink, so those ship dangling, while
// `actions/upload-artifact`, `statSync` and `test -d` all FOLLOW links — which is why the
// artifact, the manifest's size and the CI check all looked healthy over 0.2 MiB of links where
// the icon theme is 22 MB of files.
//
// Rule 2 exists because every data step in both builders used to warn-and-continue, which is how
// `"dataBytes": 0` reached npm in 0.27.1. The requirement is DERIVED, not a second list to
// maintain: a set is required iff the bundle ships the namespace it belongs to (read off the
// bundle's own typelib dir) — the data-side twin of the typelib/library rule in
// typelib-backers.mjs. It cannot be dodged by declaring less, since `--windowing`'s namespace
// floor (WINDOWING_REQUIRED_NAMESPACES) forces Adw + GtkSource and REQUIRED_NAMESPACES forces
// Gio + Gtk. The display-free variant needs no relaxed copy of the gate: it declares no data at
// all and the backer filter has already dropped the namespaces whose data would be required, so
// the rule simply has no subject there.
//
// Background: docs/node-gi-platform-notes.md.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy a directory tree so the RESULT contains no symlinks: every link is replaced by the bytes
 * (or the directory) it pointed at.
 *
 * A DANGLING link in the source prefix is skipped and reported rather than fatal — it cannot be
 * shipped in any correct form, and skipping it leaves one alias missing instead of a link that
 * resolves nowhere. Directory cycles are impossible: a directory is entered at most once per
 * realpath.
 * @param {string} src
 * @param {string} dest
 * @returns {{ files: number, dereferenced: number, dangling: string[] }}
 */
export function copyTreeDereferenced(src, dest) {
    const stats = { files: 0, dereferenced: 0, dangling: [] };
    const seen = new Set();
    const walk = (from, to) => {
        const real = realpathSync(from);
        if (seen.has(real)) return; // a link back into an ancestor — do not loop
        seen.add(real);
        mkdirSync(to, { recursive: true });
        for (const entry of readdirSync(from, { withFileTypes: true })) {
            const source = join(from, entry.name);
            const target = join(to, entry.name);
            let stat;
            try {
                stat = statSync(source); // FOLLOWS links — that is the whole point
            } catch {
                stats.dangling.push(source);
                continue;
            }
            if (entry.isSymbolicLink()) stats.dereferenced++;
            if (stat.isDirectory()) {
                walk(source, target);
            } else if (stat.isFile()) {
                copyFileSync(source, target); // copies CONTENT, links included
                stats.files++;
            }
        }
    };
    walk(src, dest);
    return stats;
}

/**
 * Walk `root` and return every symlink under it. After copyTreeDereferenced() the result must be
 * empty; a non-empty result means some part of the bundle resolves only on the build machine.
 * @param {string} root
 * @returns {{ path: string, target: string }[]} bundle-relative paths + link targets
 */
export function findSymlinks(root) {
    const found = [];
    const walk = (dir, relative) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const abs = join(dir, entry.name);
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) {
                let target = '(unreadable)';
                try {
                    target = readlinkSync(abs);
                } catch {
                    // a dangling or racing link still counts as a finding
                }
                found.push({ path: rel, target });
            } else if (entry.isDirectory()) {
                walk(abs, rel);
            }
        }
    };
    walk(root, '');
    return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * One shared operator message, so the remedy is written once for both builders.
 * @param {{ path: string, target: string }[]} links
 * @param {{ root: string }} opts
 * @returns {string}
 */
export function formatSymlinkProblems(links, { root }) {
    return (
        `BUNDLE DATA IS NOT SELF-CONTAINED — ${links.length} symlink(s) under ${root}:\n  ` +
        links.map((l) => `${l.path} -> ${l.target}`).join('\n  ') +
        '\nThese resolve on the build machine and nowhere else: `npm pack` archives a symlink as a symlink, so the ' +
        'published tarball would carry a dangling link (an icon theme or schema set that exists only in CI). Copy ' +
        'the tree with copyTreeDereferenced() from this module — NOT with `cpSync(…, { dereference: true })`, whose ' +
        'flag only governs the top-level path and leaves every nested link a link.'
    );
}

/**
 * The runtime data a `--windowing` bundle declares, keyed to the NAMESPACE whose presence makes it
 * required (read off the finished bundle's typelib dir, so a set cannot be required for a
 * namespace the bundle does not ship — and cannot be skipped for one it does).
 *
 * Only sets whose absence is SILENT belong here. `etc/fonts` deliberately does not: a gvsbuild
 * prefix without it means pango uses the win32/DirectWrite backend, which is the normal
 * configuration rather than a defect, and the builder logs "skipping" not a warning.
 *
 * ONE list, BOTH builders, no platform exception: the gdk-pixbuf loaders lived in a win32-only
 * sibling array while the darwin builder shipped none, which is how a bundle with a 22 MB icon
 * theme and no decoder for any of it passed green.
 */
export const WINDOWING_DATA_SETS = [
    {
        id: 'schemas',
        namespace: 'Gio',
        what: 'compiled GSettings schemas',
        // Also the marker node-gi's loader keys the whole windowing env on, so its absence
        // downgrades the bundle to display-free without saying so.
        why: 'Gio.Settings aborts the process when a schema is not installed; every GTK/Adwaita startup reads org.gnome.desktop.interface',
        requires: [{ file: 'share/glib-2.0/schemas/gschemas.compiled' }],
        remedy: 'install gsettings-desktop-schemas / glib into the build prefix and make sure glib-compile-schemas ran',
    },
    {
        id: 'icons',
        namespace: 'Gtk',
        what: 'at least one icon theme (Adwaita/hicolor)',
        why: 'GTK resolves every icon NAME through an icon theme; with none, lookups fail silently and widgets render blank',
        // Both halves matter: a theme dir with an index and nothing in it satisfies
        // `test -d share/icons`.
        requires: [{ glob: 'share/icons/*/index.theme' }, { tree: 'share/icons' }],
        remedy: "brew install adwaita-icon-theme (darwin) / ship the prefix's share/icons (win32)",
    },
    {
        // Directly after `icons`, because it is that set's DECODER: an icon theme without the
        // loaders is 22 MB of files nothing in the bundle can read — measured on the published
        // @gjsify/gtk-runtime-darwin-x64@0.28.0, where `GdkPixbuf.Pixbuf.new_from_file()` on that
        // bundle's own `open-menu-symbolic.svg` returned NULL.
        id: 'pixbuf-loaders',
        namespace: 'GdkPixbuf',
        what: 'the gdk-pixbuf image loaders + their cache',
        why: 'without loaders.cache gdk-pixbuf decodes nothing, so PNG/SVG icons fail to load with no diagnostic — the failure reads as a theming bug rather than a missing decoder',
        requires: [
            { file: 'lib/gdk-pixbuf-2.0/2.10.0/loaders.cache' },
            { glob: 'lib/gdk-pixbuf-2.0/2.10.0/loaders/*' },
        ],
        remedy: 'check the prefix ships lib/gdk-pixbuf-2.0/2.10.0/loaders and that gdk-pixbuf-query-loaders was found; the SVG decoder comes from librsvg, which on darwin must also be a seed of the dylib closure',
    },
    {
        id: 'gtksource',
        namespace: 'GtkSource',
        what: "GtkSourceView's data tree (share/gtksourceview-5)",
        // What this tree is NOT: GtkSourceView 5 compiles its built-in language-specs, styles and
        // snippets into a GResource inside libgtksourceview-5.0 (measured: 198 resources via
        // `gresource list`), so the built-in highlighting travels with the dylib. `share/` carries
        // only the RNG/DTD schemas validating USER-supplied .lang/.snippets files plus
        // BuilderBlocks.ttf — 4 files on both brew and gvsbuild, small and silently absent.
        why: 'a bundle that advertises the GtkSource namespace must carry its data tree; a consumer .lang or .snippets file fails to validate without the RNG/DTD schemas',
        requires: [{ tree: 'share/gtksourceview-5' }],
        remedy: 'brew install gtksourceview5 (darwin) / use a gvsbuild prefix that ships share/gtksourceview-5 (win32)',
    },
    {
        // The `pixbuf-loaders` shape one layer down: a bundle that brings its OWN libgio brings
        // its own GIO module dir, and shipped nothing to put in it. GIO resolves
        // `GTlsBackend` by g_module_open out of that dir, so with no module every https request
        // in a bundle-activated process gets the DUMMY backend — `souphttpsrc` on an https URL
        // fails as "Internal data stream error", and so does anything else on Gio/Soup TLS.
        // Measured on darwin-x64 by emptying the module dir; see gst-plugins.mjs § soup.
        id: 'tls-backend',
        namespace: 'Gio',
        what: 'a GIO TLS backend module (glib-networking)',
        why: 'GTlsConnection is a g_module_open-ed implementation, so a bundle with its own libgio and no module answers every https request with the dummy backend — the failure reads as a network error rather than a missing module',
        requires: [{ glob: 'lib/gio/modules/*' }],
        remedy: 'brew install glib-networking (darwin) / add glib-networking to the gvsbuild build (win32), then re-run the builder — the module dir is lib/gio/modules and node-gi points GIO_MODULE_DIR at it',
    },
];

/**
 * Count the non-empty regular files under `dir`, recursively. A zero-byte file does not count: a
 * truncated `gschemas.compiled` is the same missing signal as an absent one.
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) total += countFiles(abs);
        else if (entry.isFile() && statSync(abs).size > 0) total += 1;
    }
    return total;
}

/**
 * @param {string} abs
 * @returns {boolean} true only for a regular file with bytes in it
 */
function isNonEmptyFile(abs) {
    if (!existsSync(abs)) return false;
    const stat = statSync(abs);
    return stat.isFile() && stat.size > 0;
}

/**
 * Expand a bundle-relative pattern with at most ONE `*` segment (`share/icons/*​/index.theme`)
 * and return the matches that are non-empty files.
 * @param {string} root
 * @param {string} pattern
 * @returns {string[]} bundle-relative matches
 */
function matchGlob(root, pattern) {
    const segments = pattern.split('/');
    const star = segments.indexOf('*');
    if (star < 0) return isNonEmptyFile(join(root, pattern)) ? [pattern] : [];
    const parent = join(root, ...segments.slice(0, star));
    if (!existsSync(parent)) return [];
    const rest = segments.slice(star + 1);
    const matches = [];
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
        const candidate = [...segments.slice(0, star), entry.name, ...rest].join('/');
        if (isNonEmptyFile(join(root, candidate))) matches.push(candidate);
    }
    return matches;
}

/**
 * Assert the DECLARED runtime data of a `--windowing` bundle, off the finished bundle.
 *
 * A set applies iff the bundle ships its namespace; an applied set must resolve every one of its
 * requirements to at least one non-empty file. An EMPTY applied list is itself a problem — under
 * `--windowing` the namespace floor guarantees subjects, so "nothing applied" means the caller
 * passed the wrong namespace list and the gate would otherwise pass vacuously.
 * @param {{ bundleDir: string, shippedNamespaces: string[], sets?: object[] }} opts
 * @returns {{ applied: {id: string, files: number}[], skipped: {id: string, namespace: string}[],
 *   problems: string[] }}
 */
export function verifyWindowingData({ bundleDir, shippedNamespaces, sets = WINDOWING_DATA_SETS }) {
    const shipped = new Set(shippedNamespaces);
    const applied = [];
    const skipped = [];
    const problems = [];
    for (const set of sets) {
        if (!shipped.has(set.namespace)) {
            skipped.push({ id: set.id, namespace: set.namespace });
            continue;
        }
        let files = 0;
        for (const requirement of set.requires) {
            if (requirement.file) {
                if (!isNonEmptyFile(join(bundleDir, requirement.file))) {
                    problems.push(
                        `${set.id}: ${requirement.file} is missing or empty — ${set.what} not bundled (${set.why}). ` +
                            `Repair: ${set.remedy}`,
                    );
                } else files += 1;
            } else if (requirement.glob) {
                const matches = matchGlob(bundleDir, requirement.glob);
                if (matches.length === 0) {
                    problems.push(
                        `${set.id}: nothing matches ${requirement.glob} — ${set.what} not bundled (${set.why}). ` +
                            `Repair: ${set.remedy}`,
                    );
                } else files += matches.length;
            } else if (requirement.tree) {
                const count = countFiles(join(bundleDir, requirement.tree));
                if (count === 0) {
                    problems.push(
                        `${set.id}: ${requirement.tree}/ holds no non-empty file — ${set.what} not bundled ` +
                            `(${set.why}). Repair: ${set.remedy}`,
                    );
                } else files += count;
            } else {
                throw new Error(`windowing data set ${set.id}: unsupported requirement ${JSON.stringify(requirement)}`);
            }
        }
        applied.push({ id: set.id, files });
    }
    if (applied.length === 0) {
        problems.push(
            `no windowing data set applied to ${bundleDir} — the bundle ships none of ` +
                `${sets.map((s) => s.namespace).join('/')}, so nothing was verified`,
        );
    }
    return { applied, skipped, problems };
}

/**
 * One shared operator message, so the remedy is written once for both builders.
 * @param {string[]} problems
 * @param {{ bundleDir: string }} opts
 * @returns {string}
 */
export function formatWindowingDataProblems(problems, { bundleDir }) {
    return (
        `DECLARED WINDOWING DATA IS MISSING FROM ${bundleDir} — ${problems.length} problem(s):\n  ` +
        problems.join('\n  ') +
        '\nThis is the PUBLISHED shape (release.yml builds both bundles with --windowing), and every set above is ' +
        'required because the bundle ships the namespace it belongs to. Shipping without it is the 0.27.1 defect ' +
        'again: a tarball whose manifest advertises a runtime it does not contain, failing silently in the ' +
        'consumer. Fix the build prefix (see the per-set repair) — do NOT downgrade the step back to a warning.'
    );
}

/**
 * Rule 3, asserted on the finished bundle by both builders: a LOADABLE MODULE MUST NOT
 * ALSO BE A FLAT LIBRARY ENTRY.
 *
 * The builders have two different placements. The flat library dir (`lib/` on darwin,
 * `bin/` on win32) holds the linked closure; a plugin, an image loader or a GIO module
 * is placed in its OWN directory by the section that owns it, because it needs a
 * different relocation prefix and is never resolved by leaf from the library path. A
 * leaf that appears in both was pulled into the closure by a reference that NAMES it,
 * and it then ships twice.
 *
 * This is a class, not an incident. The instance that produced it: `otool -L` prints a
 * dylib's own install name among its dependencies, and once the darwin closure walk
 * began resolving whole references (for keg-only formulas) that id — an absolute path
 * into the Cellar — resolved to the plugin itself, so all 24 GStreamer plugins were
 * copied into flat `lib/` as well, +3.4 MiB. The duplicate is inert (nothing resolves a
 * plugin by leaf), which is exactly why nothing noticed: every existing gate counts
 * files or verifies relocation, and both are happy with a correct extra copy.
 * @param {Iterable<string>} flatLeaves leaf names in the bundle's flat library dir
 * @param {Iterable<string>} modulePaths paths of the modules the builder PLACED
 * @param {{ caseInsensitive?: boolean }} [opts] fold case, as win32's `bin/` requires
 * @returns {string[]} leaves that are in both, sorted
 */
export function duplicatedModuleLeaves(flatLeaves, modulePaths, { caseInsensitive = false } = {}) {
    const fold = (s) => (caseInsensitive ? s.toLowerCase() : s);
    const flat = new Set();
    for (const entry of flatLeaves) flat.add(fold(entry.replace(/^.*[\\/]/, '')));
    const dupes = new Set();
    for (const p of modulePaths) {
        const leaf = p.replace(/^.*[\\/]/, '');
        if (flat.has(fold(leaf))) dupes.add(leaf);
    }
    return [...dupes].sort();
}

/**
 * One shared operator message for {@link duplicatedModuleLeaves}, so both builders
 * spell the repair the same way.
 * @param {string[]} leaves
 * @param {{ flatDir: string }} opts
 * @returns {string}
 */
export function formatDuplicatedModuleProblems(leaves, { flatDir }) {
    return (
        `MODULES DUPLICATED INTO ${flatDir} — ${leaves.length} leaf/leaves:\n  ${leaves.join('\n  ')}\n` +
        'Each of these is placed in its own module directory by the builder AND was copied into the flat ' +
        'library dir by the closure walk, so the bundle ships two copies of it. A module reaches the closure ' +
        "only through a reference that names it — an image's own install name (LC_ID_DYLIB), or a real link " +
        'against a module, which is itself a defect. Repair: find the reference that queued it and drop it at ' +
        'the walk, not here. Do NOT delete the flat copy as a post-step: that hides the reference and the next ' +
        'module directory added to the bundle repeats it.'
    );
}
