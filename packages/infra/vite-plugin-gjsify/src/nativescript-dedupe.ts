import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Names of the `@gjsify/*` packages installed in `<root>/node_modules` or in any
 * ancestor's, for `resolve.dedupe`.
 *
 * `gjsify install` links every workspace dep into the requester's own
 * `node_modules/` (`<pkg>/node_modules/@gjsify/<dep>`). Under `gjsify link`
 * the consumer reaches such a package through its symlink, and
 * `@nativescript/vite` sets `resolve.preserveSymlinks: true`, so the nested link
 * keeps its own path spelling: one package becomes TWO modules in the bundle
 * (`@gjsify/adwaita-core` twice, then "'gtk:Box' resolves to class GtkBox$1").
 * Deduping resolves every `@gjsify/*` import through the consumer instead, so
 * its copy is the only one.
 *
 * Walks UP, merging every level: in a workspace the app dir usually has no
 * `node_modules` of its own because deps are hoisted to the workspace root, and
 * a partly populated nearer level must not hide the root's packages.
 */
export function installedGjsifyPackages(root: string): string[] {
    const names = new Set<string>();
    let dir = resolve(root);
    while (true) {
        const scope = join(dir, 'node_modules', '@gjsify');
        if (existsSync(scope)) {
            for (const name of readdirSync(scope)) {
                if (!name.startsWith('.')) names.add(`@gjsify/${name}`);
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return [...names].sort();
}
