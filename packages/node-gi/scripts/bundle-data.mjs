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
// So the builders now dereference when they copy, and this module asserts the result:
// a windowing bundle contains NO symlinks at all. That is a POSITIVE, checkable fact
// about portability — the same one `verifyRelocation` establishes for the dylibs — and
// it cannot be satisfied vacuously, since the caller also asserts the tree is there.
import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walk `root` and return every symlink under it. After a `dereference: true` copy the
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
        'the tree with `cpSync(src, dest, { recursive: true, dereference: true })` — Homebrew links a keg into its ' +
        'prefix, so the DEFAULT (dereference: false) reproduces the link farm instead of the files.'
    );
}
