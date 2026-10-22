// Shared by `commands/devtools.ts` + `commands/debug.ts`: both generate an entry that
// imports `@gjsify/devtools-mcp` from the CONSUMER's node_modules by design (the CLI
// keeps no dependency on it — see devtools.ts's header comment), so a consumer that
// never installed it gets `rolldown-plugin-gjsify`'s unresolved-workspace-import error,
// which names the right package but not the right remedy ("add it" rather than "run
// this install command"). Mirrors `commands/site.ts`'s `resolveSitePackage`.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The `name` package reachable from `cwd`, walking the node_modules chain upwards. */
export function resolveProjectPackage(cwd: string, name: string): string | undefined {
    let dir = resolve(cwd);
    for (;;) {
        const candidate = join(dir, 'node_modules', ...name.split('/'));
        if (existsSync(join(candidate, 'package.json'))) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}
