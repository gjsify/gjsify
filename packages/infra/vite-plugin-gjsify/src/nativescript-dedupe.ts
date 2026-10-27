import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** A workspace link: a symlink whose target lies outside any `node_modules`. */
function isWorkspaceLink(path: string): boolean {
    try {
        if (!lstatSync(path).isSymbolicLink()) return false;
        return !`${sep}${realpathSync(path)}${sep}`.includes(`${sep}node_modules${sep}`);
    } catch {
        return false; // dangling link
    }
}

/**
 * Names of the packages in `<root>/node_modules` or in any ancestor's that
 * must resolve to ONE instance, for `resolve.dedupe`: every `@gjsify/*`
 * package, plus every workspace-linked package (scoped or not).
 *
 * `gjsify install` links every workspace dep into the requester's own
 * `node_modules/` (`<pkg>/node_modules/@gjsify/<dep>`). Under `gjsify link`
 * the consumer reaches such a package through its symlink, and
 * `@nativescript/vite` sets `resolve.preserveSymlinks: true`, so the nested link
 * keeps its own path spelling: one package becomes TWO modules in the bundle
 * (`@gjsify/adwaita-core` twice, then "'gtk:Box' resolves to class GtkBox$1").
 * Deduping resolves every such import through the consumer instead, so its
 * copy is the only one. Learn6502 hit the same with its own workspace packages
 * (`@learn6502/common-ui` twice, so two `EditorController` singletons), hence
 * the symlink check: a regular installed package is not linked per requester.
 *
 * Walks UP, merging every level: in a workspace the app dir usually has no
 * `node_modules` of its own because deps are hoisted to the workspace root, and
 * a partly populated nearer level must not hide the root's packages.
 */
export function installedGjsifyPackages(root: string): string[] {
    const names = new Set<string>();
    let dir = resolve(root);
    while (true) {
        const modules = join(dir, 'node_modules');
        if (existsSync(modules)) {
            for (const entry of readdirSync(modules)) {
                if (entry.startsWith('.')) continue;
                if (entry.startsWith('@')) {
                    for (const name of readdirSync(join(modules, entry))) {
                        if (name.startsWith('.')) continue;
                        if (entry === '@gjsify' || isWorkspaceLink(join(modules, entry, name))) {
                            names.add(`${entry}/${name}`);
                        }
                    }
                } else if (isWorkspaceLink(join(modules, entry))) {
                    names.add(entry);
                }
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return [...names].sort();
}
