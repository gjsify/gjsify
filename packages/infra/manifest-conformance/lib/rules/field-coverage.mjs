/**
 * Rule `field-coverage` — the rule that exists so the OTHER rules cannot be
 * forgotten.
 *
 * THE PROBLEM IT SOLVES
 *
 * Every conformance check in this repository was written in reaction to an
 * incident: a declared prebuild target with no artifact, a `types` entry point
 * that was never emitted, a "headless" package that dlopened GTK, a committed
 * bundle built from older source. Each incident produced a check. Nothing
 * produced a check for the NEXT declaration kind, because nothing connected
 * "we added a field to the manifest contract" to "therefore something must
 * verify it". Fields were added and simply had no checker; you could only find
 * that out by reading five scripts and noticing an absence.
 *
 * This rule turns that absence into a build failure. It DERIVES the set of
 * `gjsify.*` keys actually declared anywhere in the tree and compares it against
 * the set of keys the registered rules claim to govern. A key nobody claims is a
 * declaration nobody checks, and it fails with the file to edit named in the
 * message.
 *
 * Derived, never listed: a hand-maintained list of "fields we know about" is the
 * exact artefact that drifts and then lies — the same reasoning that makes the
 * CI coverage summary derive its rows from `needs.<job>.result` instead of
 * restating them.
 *
 * THE LEDGER
 *
 * Not every declaration can get a rule the day it is introduced, and pretending
 * otherwise would make this guard something people route around. So an honest
 * "declared, deliberately not checked yet" is available — and only that:
 *
 *     uncheckedFields: { "<key>": "<why, in a sentence>" }
 *
 * modelled directly on `gjsify.platformsUncommitted`, and awkward to abuse in
 * the same three ways: the reason is MANDATORY, every entry is PRINTED on every
 * run (a deferral nobody reads is a deferral that ossifies), and an entry
 * becomes a FAILURE the moment a rule does claim the key, so it cannot outlive
 * its cause. A key that no package declares any more is likewise a failure — a
 * ledger describing a field that no longer exists is misinformation.
 *
 * ENFORCE VS REPORT
 *
 * The guard is only meaningful when the WHOLE registry is loaded. In a
 * consumer's tree `gjsify manifest-check` loads the portable rules only, so keys
 * governed by repo-scoped rules (`gjsify.tier`, `gjsify.runtimes`, …) would be
 * unclaimed there through no fault of the consumer. The rule therefore reports
 * rather than fails unless the caller opts in with
 * `ctx.options.fieldCoverage = 'enforce'`, which the repo entry points do.
 */

import { defineRule, claimedGjsifyFields, rulesClaimingField } from '../registry.mjs';

/** Where a contributor adds the rule the failure message asks for. */
const RULES_DIR_HINT =
    'packages/infra/manifest-conformance/lib/rules/ (portable — checkable in any consumer tree) or ' +
    'scripts/manifest-conformance/rules/ (repo-scoped — needs this repository’s layout, CI or internal tables)';

/**
 * Every `gjsify.<key>` declared anywhere in scope, mapped to the package names
 * that declare it.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 * @returns {Map<string, string[]>}
 */
export function declaredGjsifyFields(ctx) {
    /** @type {Map<string, string[]>} */
    const out = new Map();
    for (const pkg of ctx.allPackages) {
        for (const key of Object.keys(pkg.gjsify)) {
            out.set(key, [...(out.get(key) ?? []), pkg.name]);
        }
    }
    return new Map([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

export const fieldCoverageRule = defineRule({
    id: 'field-coverage',
    scope: 'portable',
    // Deliberately empty: this rule governs no single field, it governs the
    // RELATION between the declared fields and the rules that claim them.
    fields: [],
    description: 'every `gjsify.*` declaration kind in the tree is claimed by a rule (or explicitly deferred)',
    run(ctx) {
        const mode = ctx.options?.fieldCoverage === 'enforce' ? 'enforce' : 'report';
        /** @type {Record<string,string>} */
        const ledger = ctx.options?.uncheckedFields ?? {};
        const declared = declaredGjsifyFields(ctx);
        const claimed = claimedGjsifyFields();

        const problems = [];
        const notes = [];

        const uncovered = [];
        for (const [key, packages] of declared) {
            if (claimed.has(key)) continue;
            const reason = ledger[key];
            if (typeof reason === 'string' && reason.trim().length > 0) {
                notes.push(
                    `\`gjsify.${key}\` (declared by ${packages.length} package(s), e.g. ${packages.slice(0, 3).join(', ')}) ` +
                        `is DECLARED but deliberately NOT CHECKED — ${reason.trim()}`,
                );
                continue;
            }
            if (key in ledger) {
                problems.push(
                    `\`gjsify.${key}\` is listed in the unchecked-field ledger with no reason. An unexplained deferral is ` +
                        'the silent gap the ledger exists to replace — write one sentence saying why no rule checks it yet.',
                );
                continue;
            }
            uncovered.push({ key, packages });
        }

        for (const { key, packages } of uncovered) {
            problems.push(
                `\`gjsify.${key}\` is declared by ${packages.length} package(s) (${packages.slice(0, 5).join(', ')}${packages.length > 5 ? `, +${packages.length - 5} more` : ''}) ` +
                    'but NO conformance rule claims it — a declaration nobody verifies is a promise that can be false ' +
                    'while every build exits 0, which is how every incident in this set started.\n' +
                    `    Fix by one of: (a) add a rule under ${RULES_DIR_HINT}, listing "gjsify.${key}" in its \`fields\`; ` +
                    `(b) extend an existing rule's \`fields\` if it already checks this declaration; ` +
                    `(c) if it genuinely cannot be checked yet, add it to the unchecked-field ledger WITH a reason — ` +
                    'an honest "not checked yet" is available, a silent gap is not.',
            );
        }

        // A ledger entry that has outlived its cause is misinformation, in both
        // directions. Same shape as `platformsUncommitted`: the exemption must
        // die the moment it stops being true.
        for (const key of Object.keys(ledger)) {
            if (claimed.has(key)) {
                problems.push(
                    `the unchecked-field ledger still defers \`gjsify.${key}\`, but rule(s) ${rulesClaimingField(key).join(', ')} ` +
                        'now claim it. Delete the ledger entry so the field is held to the rule.',
                );
            } else if (!declared.has(key)) {
                problems.push(
                    `the unchecked-field ledger defers \`gjsify.${key}\`, which no package declares any more. ` +
                        'Delete the entry — a ledger describing a field that does not exist tells the next reader something false.',
                );
            }
        }

        // A rule claiming a field nothing declares is not an error (a rule may
        // legitimately land before its first consumer), but it is worth saying
        // out loud so a typo in a `fields` list does not read as coverage.
        const unusedClaims = [...claimed].filter((k) => !declared.has(k)).sort();
        if (unusedClaims.length > 0) {
            notes.push(
                `rule(s) claim \`gjsify.${unusedClaims.join('`, `gjsify.')}\`, which no package in scope declares — ` +
                    'harmless, but check for a typo in the rule’s `fields` list, since a misspelt claim covers nothing.',
            );
        }

        const summary =
            `field coverage: OK. ${declared.size} \`gjsify.*\` declaration kind(s) in scope; ` +
            `${declared.size - uncovered.length - Object.keys(ledger).filter((k) => declared.has(k) && !claimed.has(k)).length} claimed by a rule, ` +
            `${Object.keys(ledger).filter((k) => declared.has(k) && !claimed.has(k)).length} explicitly deferred with a reason.`;

        if (mode === 'report') {
            return {
                failures: [],
                notes: [
                    ...notes,
                    ...problems.map(
                        (p) =>
                            `${p}\n    (reported, not enforced: only the portable rule set is loaded here, so a key governed by a ` +
                            'repo-scoped rule would look uncovered through no fault of this package.)',
                    ),
                ],
                stats: { declared: declared.size, uncovered: uncovered.length, deferred: Object.keys(ledger).length },
                summary,
            };
        }
        return {
            failures: problems,
            notes,
            stats: { declared: declared.size, uncovered: uncovered.length, deferred: Object.keys(ledger).length },
            summary,
        };
    },
});
