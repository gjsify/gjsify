/**
 * Rule `node-script-globals` — a declared `gjsify.nodeScript` policy names globals that
 * EXIST and governs a script that is actually reachable.
 *
 * WHY THIS EXISTS. `gjsify run --node-script <file>` bundles for GJS with `--globals auto`,
 * which is a syntactic answer to a runtime question: it injects a register for every global
 * the bundled code MENTIONS and cannot tell a live branch from a dead one. The package that
 * owns the script corrects it through `gjsify.nodeScript.{globals,excludeGlobals}`
 * (`Config.forNodeScript`) — a declaration, and therefore a promise that can be false while
 * every build exits 0.
 *
 * Two ways it can be false, both silent:
 *
 *   1. A MISSPELLED identifier. `excludeGlobals` is a filter over the detected set, so
 *      `documnt` removes nothing and reports nothing. The failure surfaces far away, as a
 *      bundle demanding `gi://Gdk` at load on a host that has no display — which is the
 *      shape #1053 spent its time on.
 *   2. A declaration governing NOTHING. `--node-script` is reached from a package script
 *      spelling `node <file>` (through the shim `writeNodeShim()` writes) or from the flag
 *      directly. A package with no such script has written a policy nothing consults, and
 *      the next reader will take it for a working example.
 *
 * REPO-SCOPED because the identifier authority is this tree's `@gjsify/resolve-npm`
 * globals table, read by relative path. The QUESTION is portable — a consumer declaring
 * `nodeScript` wants the same check — but `@gjsify/manifest-conformance` is deliberately
 * dependency-free, and buying a dependency for one rule is the wrong trade. If a consumer
 * ever needs it, move the rule and give the package the dep then.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import { GJS_GLOBALS_GROUPS, GJS_GLOBALS_MAP } from '../../../packages/infra/resolve-npm/lib/globals-map.mjs';

/** Tokens `--globals` accepts that are not identifiers. `parseGlobalsValue` handles both. */
const GLOBALS_TOKENS = new Set(['auto', 'none']);

/** A `node <file>` in a package script — the only way the shim path reaches `--node-script`. */
const NODE_SCRIPT_CALL = /(^|[;&|]|\s)node\s+(?![-<])\S+\.(mjs|js|cjs)\b/;

/** Every spelling that resolves to a register: an identifier, or a group alias. */
function isKnownGlobal(id) {
    return Object.hasOwn(GJS_GLOBALS_MAP, id) || Object.hasOwn(GJS_GLOBALS_GROUPS, id);
}

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function auditNodeScriptGlobals(ctx) {
    const failures = [];
    let declared = 0;
    let identifiers = 0;

    for (const pkg of ctx.packages) {
        const block = pkg.manifest.gjsify?.nodeScript;
        if (block === undefined) continue;
        declared++;

        if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nodeScript\` must be an object (got ${
                    Array.isArray(block) ? 'an array' : typeof block
                }). It carries \`globals\` and/or \`excludeGlobals\`.`,
            );
            continue;
        }

        /** @type {string[]} */
        const named = [];

        if ('globals' in block) {
            if (typeof block.globals !== 'string') {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.nodeScript.globals\` must be a string ` +
                        `(got ${typeof block.globals}) — the same comma-separated form \`--globals\` takes.`,
                );
            } else {
                named.push(...block.globals.split(',').map((t) => t.trim()));
            }
        }

        if ('excludeGlobals' in block) {
            if (!Array.isArray(block.excludeGlobals)) {
                failures.push(
                    `${pkg.rel}/package.json: \`gjsify.nodeScript.excludeGlobals\` must be an array of ` +
                        `identifiers (got ${typeof block.excludeGlobals}).`,
                );
            } else {
                named.push(...block.excludeGlobals.map((t) => (typeof t === 'string' ? t.trim() : String(t))));
            }
        }

        for (const id of named) {
            if (id.length === 0 || GLOBALS_TOKENS.has(id)) continue;
            identifiers++;
            if (isKnownGlobal(id)) continue;
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nodeScript\` names "${id}", which is not a global gjsify ` +
                    `knows (\`GJS_GLOBALS_MAP\`) nor a group (${Object.keys(GJS_GLOBALS_GROUPS).join(', ')}). ` +
                    `\`excludeGlobals\` FILTERS the detected set, so a name nothing detects removes nothing and ` +
                    `says nothing — the declaration reads as applied while the register it meant to drop is ` +
                    `still injected.`,
            );
        }

        const scripts = pkg.manifest.scripts ?? {};
        const reaches = Object.values(scripts).some(
            (cmd) => typeof cmd === 'string' && (NODE_SCRIPT_CALL.test(cmd) || cmd.includes('--node-script')),
        );
        if (!reaches) {
            failures.push(
                `${pkg.rel}/package.json: \`gjsify.nodeScript\` is declared but no script in this package runs a ` +
                    `\`node <file>.mjs\` (or \`--node-script\`), so nothing consults it. Either drop the block or ` +
                    `move it to the package whose build script it governs.`,
            );
        }
    }

    return { failures, stats: { declared, identifiers } };
}

export const nodeScriptGlobalsRule = defineRule({
    id: 'node-script-globals',
    scope: 'repo',
    fields: ['gjsify.nodeScript'],
    description: 'every `gjsify.nodeScript` policy names real globals and governs a reachable node script',
    run(ctx) {
        const { failures, stats } = auditNodeScriptGlobals(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'node-script-globals: no package declares `gjsify.nodeScript`'
                    : `node-script-globals: ${stats.declared} package(s), ${stats.identifiers} identifier(s) checked`,
        };
    },
});
