/**
 * Rule `portable-clear` — a `clear` script must not shell out to a POSIX binary.
 *
 * WHY THIS EXISTS
 *
 * npm runs package scripts through `cmd.exe` on Windows, which has no `rm`, no
 * `cp`, no `mkdir -p` semantics and does not expand a glob. Every `clear` script
 * in this repository was `rm -rf <dirs…> || exit 0` — 224 of them — so
 * `gjsify foreach clear`, and with it the documented full gate
 * (`gjsify install --immutable && gjsify run clear && gjsify run build …`), could
 * not run on win32 at all. That was found by a full toolchain run on the
 * `win11-gjsify` VM (issue #914, finding 3), not by any check here: 224 identical
 * broken lines are exactly the shape a reviewer stops seeing.
 *
 * They were replaced by one portable command, `gjsify clear <paths…>`. This rule
 * is the half that keeps them replaced. The failure mode it guards is not exotic
 * — a new package is scaffolded by copying a sibling's manifest, and the sibling
 * that gets copied is whichever one the author had open. One `rm -rf` copied back
 * in re-breaks that package on Windows, silently, until somebody runs the gate
 * there again.
 *
 * WHY IT CHECKS ONLY `clear`, AND SAYS SO
 *
 * The same hazard exists in other scripts — `build:assets`, `build:public` and a
 * handful of others still shell out to `cp`/`mkdir -p`, 38 occurrences across 9
 * script names when this rule was written. Widening the rule to all scripts today
 * would mean shipping it with a 38-entry exemption ledger, and a check that
 * starts life mostly-exempted teaches everyone to add the next exemption. So the
 * scope is exactly what has actually been fixed, which is a claim this rule can
 * make honestly and enforce with zero exemptions. The rest is tracked in
 * `status/open-todos.md`; widening this rule is what closes that TODO, and the
 * only edit needed is the script-name filter.
 *
 * WHAT COUNTS AS A VIOLATION
 *
 * A leading command — at the start of the script or after `&&`, `||`, `;` or `|`
 * — that names a POSIX utility `cmd.exe` does not provide. Matching on the
 * COMMAND POSITION rather than anywhere in the string is what keeps
 * `gjsify clear dist/rm-cache` from being flagged for containing "rm".
 *
 * `echo` is deliberately absent from the list: cmd.exe has it, and the three
 * `"clear": "echo 'nothing to do'"` stubs in the tree work there — they merely
 * print the quotes, since cmd.exe does not treat `'` as quoting. Cosmetic, not
 * broken, and inventing a violation for it would be the kind of noise that gets a
 * rule disabled.
 */

import { defineRule } from '../registry.mjs';

/**
 * POSIX utilities `cmd.exe` does not provide. Deliberately not exhaustive — it
 * covers what a build/clean script reaches for. Add on sight of a new one.
 */
const POSIX_ONLY = [
    'rm',
    'cp',
    'mv',
    'ln',
    'chmod',
    'chown',
    'touch',
    'mkdir',
    'rmdir',
    'cat',
    'sed',
    'awk',
    'grep',
    'find',
    'xargs',
    'basename',
    'dirname',
    'pwd',
    'which',
    'test',
    'tar',
    'unzip',
    'sleep',
    'kill',
    'true',
    'false',
    'source',
    'export',
];

/** A POSIX-only utility in COMMAND position: script start, or after `&& || ; |`. */
const COMMAND_POSITION = new RegExp(String.raw`(?:^|[|&;]\s*|\(\s*)(${POSIX_ONLY.join('|')})(?:\s|$)`);

/** The script names this rule governs. See the header for why it is not all of them. */
const GOVERNED = ['clear'];

/**
 * Which POSIX-only utilities a script invokes, in command position.
 *
 * @param {string} script
 * @returns {string[]}
 */
export function unportableCommands(script) {
    const found = new Set();
    // Walk every command-position match, not just the first — `rm -rf a && cp b c`
    // should name both so one fix pass is enough.
    const re = new RegExp(COMMAND_POSITION.source, 'g');
    for (const match of script.matchAll(re)) found.add(match[1]);
    return [...found];
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
function auditClearScripts(ctx) {
    const failures = [];
    let checked = 0;
    for (const pkg of ctx.packages) {
        const scripts = pkg.manifest.scripts ?? {};
        for (const name of GOVERNED) {
            const script = scripts[name];
            if (typeof script !== 'string' || script.length === 0) continue;
            checked++;
            const bad = unportableCommands(script);
            if (bad.length === 0) continue;
            failures.push(
                `${pkg.rel}/package.json: "${name}" shells out to ${bad.map((b) => `\`${b}\``).join(', ')}, which ` +
                    `cmd.exe does not have — the script cannot run on Windows, where npm executes it through cmd.exe.\n` +
                    `      got:  ${script}\n` +
                    `      use:  gjsify clear <paths…>   (recursive, ignores a missing path, so no \`|| exit 0\` tail)`,
            );
        }
    }
    return { failures, stats: { checked } };
}

export const portableClearRule = defineRule({
    id: 'portable-clear',
    scope: 'portable',
    fields: ['scripts.clear'],
    description: 'every `clear` script is portable — no `rm`/`cp`/… that cmd.exe lacks (use `gjsify clear`)',
    run(ctx) {
        const { failures, stats } = auditClearScripts(ctx);
        return {
            failures,
            stats,
            summary: `${stats.checked} clear script(s) are cmd.exe-safe`,
        };
    },
});
