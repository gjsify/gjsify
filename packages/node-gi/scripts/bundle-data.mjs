// SPDX-License-Identifier: MIT
// Shared by BOTH batteries-included GTK-runtime builders: the bundle's runtime DATA
// must be REAL FILES, not links into the machine that built it.
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
