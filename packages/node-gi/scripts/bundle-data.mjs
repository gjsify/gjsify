// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders. Two rules about the bundle's
// runtime DATA, both asserted on the FINISHED bundle:
//
//   1. it must be REAL FILES, not links into the machine that built it (findSymlinks);
//   2. every data set the bundle DECLARES must actually be in it (verifyWindowingData).
//
// THE DEFECT THIS EXISTS FOR — measured on PR #977's own CI (node-gi.yml run
// 30890804400, macos-gtk-windowing-runtime): the darwin `--windowing` bundle reported
// `share/` at 0.2 MiB while the uploaded artifact of the same directory unpacked to
// 22 MB. Both numbers were right. Homebrew links a keg's tree into `$(brew --prefix)`
// by SYMLINK, `cpSync` defaults to `dereference: false`, so `share/icons/Adwaita`
// was copied AS A LINK pointing back into `…/Cellar/adwaita-icon-theme/…`.
// `actions/upload-artifact` follows symlinks, which is why the artifact looked
// complete; `npm pack` does NOT, so the published tarball would have shipped a
// dangling link — an icon theme that exists only on the build machine.
//
// It stayed invisible for two reasons worth naming, because both are the same shape
// as the rest of this PR: the size the manifest reported came from `statSync`, which
// FOLLOWS links, so the number said 19.4 MiB and agreed with nobody; and the CI check
// was `test -d "$B/share/icons"`, which a link to an existing directory satisfies on
// the build host.
//
// So the builders copy the data with copyTreeDereferenced() below, and this module
// asserts the result: a windowing bundle contains NO symlinks at all. That is a
// POSITIVE, checkable fact about portability — the same one `verifyRelocation`
// establishes for the dylibs — and it cannot be satisfied vacuously, since the same
// build also asserts the tree is present.
//
// AND `cpSync`'s `dereference: true` IS NOT THAT COPY. Measured (node 24.15, and on
// the macOS runner): the flag only governs the stat of the path handed to `cpSync`,
// so a nested link is still copied AS A LINK — the first attempt at this fix passed
// `dereference: true` and the gate below still found 859 links under
// `share/icons/Adwaita`, each pointing at `/opt/homebrew/Cellar/adwaita-icon-theme/…`.
// The walk below uses `statSync` per entry, which follows, and `copyFileSync`, which
// copies bytes.
//
// RULE 2 — AND THE DECLARED DATA MUST BE THERE. Every data step in both builders was
// warn-and-continue: a missing tree in the source prefix printed `WARNING — … NOT
// bundled` and the build went on to publish. That is exactly how `"dataBytes": 0`
// reached npm in 0.27.1, so leaving it in place would let the defect this whole change
// exists to close recur THROUGH the fix. verifyWindowingData() therefore re-reads the
// finished bundle and FAILS the build when a declared set is absent or empty.
//
// The requirement is DERIVED, not a second list to maintain: a data set is required iff
// the bundle actually ships the namespace it belongs to (read off the bundle's own
// typelib dir). So it is the data-side twin of the typelib/library rule in
// typelib-backers.mjs — "the bundle ships the closure of exactly what it ships" — and it
// cannot be dodged by declaring less: `--windowing`'s namespace floor
// (WINDOWING_REQUIRED_NAMESPACES) already forces Adw + GtkSource to be present, and
// REQUIRED_NAMESPACES forces Gio + Gtk.
//
// WHY THE DISPLAY-FREE VARIANT IS NOT THE SAME CASE, and why it keeps no relaxed copy of
// this gate: that bundle DECLARES no data. It writes no `share/` tree at all, its
// manifest says `windowing: false, dataBytes: 0`, node-gi's loader keys the entire
// windowing env on the `gschemas.compiled` marker and so wires none of it, and the
// backer filter has already dropped the namespaces whose data would be required
// (libadwaita/libgtksourceview are not in that closure, so Adw-1/GtkSource-5 are not in
// that bundle). The rule "ship the data of the namespaces you ship" holds there too — it
// simply has no subject. Under `--windowing` it always has one, which is why an empty
// applied-set list is itself reported as a failure below.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy a directory tree so the RESULT contains no symlinks: every link is replaced by
 * the bytes (or the directory) it pointed at.
 *
 * A DANGLING link in the source prefix is skipped and reported rather than fatal — it
 * cannot be shipped in any correct form (a broken icon alias in someone else's theme
 * is not this bundle's failure), and skipping it leaves one alias missing instead of
 * shipping a link that resolves nowhere. Directory cycles are impossible: a directory
 * is entered at most once per realpath.
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
 * Walk `root` and return every symlink under it. After copyTreeDereferenced() the
 * result must be empty; a non-empty result means some part of the bundle resolves
 * only on the build machine.
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
 * The runtime data a `--windowing` bundle declares, keyed to the NAMESPACE whose
 * presence makes it required (read off the finished bundle's typelib dir, so a set
 * cannot be required for a namespace the bundle does not ship — and cannot be skipped
 * for one it does).
 *
 * Only sets whose absence is SILENT belong here. `etc/fonts` deliberately does not: a
 * gvsbuild prefix without it means pango uses the win32/DirectWrite backend, which is
 * the normal configuration rather than a defect, and the builder logs "skipping" not a
 * warning. The gdk-pixbuf loaders are win32-only for the honest reason (below).
 */
export const WINDOWING_DATA_SETS = [
    {
        id: 'schemas',
        namespace: 'Gio',
        what: 'compiled GSettings schemas',
        // Also the marker node-gi's loader keys the whole windowing env on, so its
        // absence downgrades the bundle to display-free without saying so.
        why: 'Gio.Settings aborts the process when a schema is not installed; every GTK/Adwaita startup reads org.gnome.desktop.interface',
        requires: [{ file: 'share/glib-2.0/schemas/gschemas.compiled' }],
        remedy: 'install gsettings-desktop-schemas / glib into the build prefix and make sure glib-compile-schemas ran',
    },
    {
        id: 'icons',
        namespace: 'Gtk',
        what: 'at least one icon theme (Adwaita/hicolor)',
        why: 'GTK resolves every icon NAME through an icon theme; with none, lookups fail silently and widgets render blank',
        // Both halves matter: a theme dir with an index and nothing in it would satisfy
        // `test -d share/icons`, which is the check this replaces.
        requires: [{ glob: 'share/icons/*/index.theme' }, { tree: 'share/icons' }],
        remedy: "brew install adwaita-icon-theme (darwin) / ship the prefix's share/icons (win32)",
    },
    {
        id: 'gtksource',
        namespace: 'GtkSource',
        what: "GtkSourceView's data tree (share/gtksourceview-5)",
        // NB what this tree is and is NOT: GtkSourceView 5 compiles its built-in
        // language-specs, styles and snippets into a GResource inside
        // libgtksourceview-5.0 (measured: 198 resources via `gresource list`), so the
        // built-in highlighting travels with the dylib. What `share/` carries is the
        // RNG/DTD schemas that validate USER-supplied .lang/.snippets files plus
        // BuilderBlocks.ttf — 4 files on both brew and gvsbuild. Small, and silently
        // absent, which is exactly why it is asserted rather than warned about.
        why: 'a bundle that advertises the GtkSource namespace must carry its data tree; a consumer .lang or .snippets file fails to validate without the RNG/DTD schemas',
        requires: [{ tree: 'share/gtksourceview-5' }],
        remedy: 'brew install gtksourceview5 (darwin) / use a gvsbuild prefix that ships share/gtksourceview-5 (win32)',
    },
];

/**
 * win32-ONLY, and not because darwin does not need it: the darwin builder does not
 * bundle the gdk-pixbuf image loaders yet (they are dylibs in a NESTED dir and need
 * their own @loader_path pass, tracked in status/open-todos.md), so requiring them
 * there would assert something that builder does not do. The rule is "assert what you
 * ship" — the gap stays written down where it is, not hidden behind a green gate.
 */
export const WIN32_WINDOWING_DATA_SETS = [
    {
        id: 'pixbuf-loaders',
        namespace: 'GdkPixbuf',
        what: 'the gdk-pixbuf image loaders + their cache',
        why: 'without loaders.cache gdk-pixbuf decodes nothing, so PNG/SVG icons fail to load with no diagnostic',
        requires: [
            { file: 'lib/gdk-pixbuf-2.0/2.10.0/loaders.cache' },
            { glob: 'lib/gdk-pixbuf-2.0/2.10.0/loaders/*' },
        ],
        remedy: 'check the prefix ships lib/gdk-pixbuf-2.0/2.10.0/loaders and that gdk-pixbuf-query-loaders was found',
    },
];

/**
 * Count the non-empty regular files under `dir`, recursively. A zero-byte file does not
 * count: a truncated `gschemas.compiled` or an empty theme dir is the same missing
 * signal as an absent one.
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
 * A set applies iff the bundle ships its namespace; an applied set must resolve every
 * one of its requirements to at least one non-empty file. An EMPTY applied list is
 * itself a problem — under `--windowing` the namespace floor guarantees subjects, so
 * "nothing applied" means the caller passed the wrong namespace list and the gate would
 * otherwise pass vacuously.
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
