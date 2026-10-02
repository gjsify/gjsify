// Finding the `.oxfmtrc` a sidecar has to be written for — the one part of the formatter contract
// that touches the filesystem, and therefore a SUBPATH rather than part of the barrel.
//
// WHY IT IS NOT IN THE BARREL, WHICH IS THE WHOLE ARGUMENT
//
// `@gjsify/blueprint` is imported by `packages/web/adwaita-web`, which is the BROWSER side of a
// `.blp` (`parseBlueprint` + `projectToSharedNode` are what `?shared-tree` is made of). A barrel
// that reached `node:fs` would pull the filesystem polyfill into every browser bundle that so
// much as parses a `.blp`, for a function no browser calls: the three callers that DO need it —
// the drift gate, `gjsify blueprint types`, and the bundler plugin — all run in Node. So the
// walk lives behind `@gjsify/blueprint/oxfmt`, and the pure mapping (`emitFormatFor`,
// `parseOxfmtrc`) is re-exported from here so a Node-side caller needs one specifier rather than
// two and cannot end up importing the mapping from one place and the walk from another.
//
// This is the same split the root AGENTS.md records for a pure-JS path and its native
// counterpart: the pure half stays reachable everywhere, the host half is named.
//
// ONE WALK, AND WHY IT IS HERE RATHER THAN IN EACH CALLER
//
// The three callers had three ideas of where to look — the CLI a `findOxfmtConfig` helper, the
// gate a copy of it, the plugin nothing at all — and three walks mean three answers to "which
// file does the formatter read". The third answer is the one that silently emits 4-space
// sidecars into a `tabWidth: 2` tree. This is the ONE walk, and it reproduces the CLI's exactly.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { emitFormatFor, parseOxfmtrc } from './oxfmt-config.mjs';

export { emitFormatFor, parseOxfmtrc } from './oxfmt-config.mjs';

/** The two names an oxfmt config answers to, in the order `findOxfmtConfig` looks for them. */
const RC_NAMES = Object.freeze(['.oxfmtrc', '.oxfmtrc.json']);

/** How far up the walk goes: `findConfigFile`'s budget in the CLI, so both reach the same file. */
const RC_WALK_LEVELS = 12;

/**
 * The emitter options for the tree `from` belongs to, from the nearest `.oxfmtrc` above it.
 *
 * THE FORMATTER'S OWN ANSWER, which is the whole point: `gjsify format` resolves the config with
 * `findOxfmtConfig` — these same two names, in the same order, up to the same 12 levels — and
 * runs oxfmt with it. A sidecar written against a DIFFERENT file is one that formatter reflows on
 * sight, so this reproduces that walk rather than inventing a narrower one.
 *
 * NEAREST wins, which is what makes a monorepo correct: a package carrying its own
 * `.oxfmtrc.json` gets that package's width, and a `.blp` under it gets that package's indent even
 * when the command was run from the repository root.
 *
 * No `.oxfmtrc` anywhere above `from` is oxfmt's OWN defaults, never a copied constant — the
 * same answer `emitFormatFor()` gives for no config, and the exact opposite of the 4-space
 * literal that put `tabWidth: 2` consumers in ADR 0088 § Consequences.
 *
 * @param {string} from a directory inside the tree, usually the one beside the `.blp`
 * @returns {import('./oxfmt-config.d.mts').EmitFormat}
 */
export function emitFormatForTree(from) {
    let dir = resolve(from);
    for (let level = 0; level < RC_WALK_LEVELS; level += 1) {
        for (const name of RC_NAMES) {
            const path = join(dir, name);
            if (existsSync(path)) return emitFormatFor(parseOxfmtrc(readFileSync(path, 'utf8')));
        }
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return emitFormatFor();
}
