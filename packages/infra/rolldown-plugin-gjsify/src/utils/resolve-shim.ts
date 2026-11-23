import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const _shimDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve one of this package's bundled shims to an absolute path.
 *
 * `createRequire` is used only for its `exports`-map-aware RESOLVER; nothing is
 * loaded through it (this source is ESM — see AGENTS.md "no bare `require`").
 */
export function resolveShim(shimName: string): string {
    // Normal Node consumption: `_shimDir` = `<pkg>/lib/utils/`.
    const relative = resolve(_shimDir, `../shims/${shimName}.js`);
    if (existsSync(relative)) return relative;
    // Fallback for the bundled-orchestrator case (GJS-CLI self-host loop):
    // `_shimDir` collapses to the bundle's own directory and the relative lookup
    // misses. Every shim MUST therefore be a `./shims/<name>` subpath export in
    // package.json.
    try {
        return createRequire(import.meta.url).resolve(`@gjsify/rolldown-plugin-gjsify/shims/${shimName}`);
    } catch (cause) {
        // Throw rather than return the unverified `relative`: a non-existent
        // path in the alias map resurfaces much later as an unrelated "could not
        // resolve" naming a path nobody wrote.
        throw new Error(
            `@gjsify/rolldown-plugin-gjsify: cannot locate the "${shimName}" shim. ` +
                `Tried ${relative} and the "./shims/${shimName}" subpath export.`,
            { cause },
        );
    }
}
