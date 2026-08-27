/**
 * Rule `portable-scripts` — no package script may shell out to a POSIX binary.
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
 * WHY IT NOW CHECKS EVERY SCRIPT
 *
 * It shipped scoped to `clear` alone, with the reason written here: the other 37
 * occurrences — `build:assets` (24), `build:public` (5), and one each of
 * `build:views`, `sync:theme`, `check`, `test`, `prebuild:test`,
 * `prebuild:test:fixtures` — were not fixed yet, and widening the rule then would
 * have meant shipping it with a 37-entry exemption ledger. A check that starts
 * life mostly-exempted teaches everyone to add the next exemption.
 *
 * Those 37 are now fixed: 34 onto `gjsify copy` (the sibling of `gjsify clear`,
 * added for exactly this), the three `"check": "true"` stubs onto `echo`, and
 * `cli-gio-cat`'s `test` onto a committed fixture instead of an `rm -f` + `echo >`
 * dance in `/tmp`. So the scope is once again exactly what has been fixed, and
 * the rule still carries ZERO exemptions — which is the property that makes it
 * worth having.
 *
 * The trigger for finishing it was not tidiness. `showcases/node/express-webserver`
 * is the one showcase that runs on Windows (its `--app node` bundle needs no gjs),
 * and `build:public` is what stages the frontend beside the bundle. Without it the
 * server starts and serves 404s for its own pages — a worse failure than not
 * building.
 *
 * WHAT COUNTS AS A VIOLATION
 *
 * A leading command — at the start of the script or after `&&`, `||`, `;` or `|`
 * — that names a POSIX utility `cmd.exe` does not provide. Matching on the
 * COMMAND POSITION rather than anywhere in the string is what keeps
 * `gjsify clear dist/rm-cache` from being flagged for containing "rm".
 *
 * `echo` is deliberately absent from the list: cmd.exe has it, and the
 * `"clear": "echo 'nothing to do'"` stubs in the tree work there — they merely
 * print the quotes, since cmd.exe does not treat `'` as quoting. Cosmetic, not
 * broken, and inventing a violation for it would be the kind of noise that gets a
 * rule disabled.
 *
 * WHAT IT STILL CANNOT SEE
 *
 * Shell SYNTAX, as opposed to shell commands: a redirect (`> file`), a
 * `VAR=x cmd` prefix, a `$(…)` substitution and a backslash line-continuation are
 * all equally unavailable or differently-spelled under cmd.exe, and none of them
 * puts a POSIX utility in command position. None is present in the tree today.
 * Add them here on sight, not speculatively — every pattern in this list has a
 * package behind it.
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

/**
 * The portable replacement to suggest, keyed by the utility that was found.
 * Naming the specific command is what turns a rejection into an edit — the
 * author of a `cp -r` does not necessarily know `gjsify copy` exists.
 */
const REPLACEMENTS = {
    rm: 'gjsify clear <paths…>   (recursive, ignores a missing path, so no `|| exit 0` tail)',
    cp: 'gjsify copy <sources…> <dest>   (recursive, creates the destination, overwrites)',
    mkdir: 'gjsify copy <sources…> <dest>/   (the destination is created for you)',
    true: 'echo <why there is nothing to do>   (cmd.exe has echo; it has no `true`)',
};

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
function auditScripts(ctx) {
    const failures = [];
    let checked = 0;
    let packages = 0;
    for (const pkg of ctx.packages) {
        const scripts = pkg.manifest.scripts ?? {};
        let touched = false;
        for (const [name, script] of Object.entries(scripts)) {
            if (typeof script !== 'string' || script.length === 0) continue;
            checked++;
            touched = true;
            const bad = unportableCommands(script);
            if (bad.length === 0) continue;
            const hints = bad.filter((b) => REPLACEMENTS[b]).map((b) => `\n      use:  ${REPLACEMENTS[b]}`);
            failures.push(
                `${pkg.rel}/package.json: "${name}" shells out to ${bad.map((b) => `\`${b}\``).join(', ')}, which ` +
                    `cmd.exe does not have — the script cannot run on Windows, where npm executes it through cmd.exe.\n` +
                    `      got:  ${script}${hints.join('')}`,
            );
        }
        if (touched) packages++;
    }
    return { failures, stats: { checked, packages } };
}

export const portableScriptsRule = defineRule({
    id: 'portable-scripts',
    scope: 'portable',
    fields: ['scripts'],
    description:
        'every package script is portable — no `rm`/`cp`/… that cmd.exe lacks (use `gjsify clear` / `gjsify copy`)',
    run(ctx) {
        const { failures, stats } = auditScripts(ctx);
        return {
            failures,
            stats,
            summary: `${stats.checked} package script(s) across ${stats.packages} package(s) are cmd.exe-safe`,
        };
    },
});
