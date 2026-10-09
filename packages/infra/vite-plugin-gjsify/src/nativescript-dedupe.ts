import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Names of the `@gjsify/*` packages installed in `<root>/node_modules`, for
 * `resolve.dedupe`.
 *
 * `gjsify install` links every workspace dep into the requester's own
 * `node_modules/` (`<pkg>/node_modules/@gjsify/<dep>`). Under `gjsify link`
 * the consumer reaches such a package through its symlink, and
 * `@nativescript/vite` sets `resolve.preserveSymlinks: true`, so the nested link
 * keeps its own path spelling: one package becomes TWO modules in the bundle
 * (`@gjsify/adwaita-core` twice, then "'gtk:Box' resolves to class GtkBox$1").
 * Deduping resolves every `@gjsify/*` import from the project root instead, so
 * the consumer's copy is the only one.
 */
export function installedGjsifyPackages(root: string): string[] {
    const scope = join(root, 'node_modules', '@gjsify');
    if (!existsSync(scope)) return [];
    return readdirSync(scope)
        .filter((name) => !name.startsWith('.'))
        .sort()
        .map((name) => `@gjsify/${name}`);
}
