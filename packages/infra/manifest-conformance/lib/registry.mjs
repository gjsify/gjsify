/**
 * The manifest-conformance rule registry.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * A `package.json` is a set of PROMISES: `exports`/`main`/`types`/`bin` promise
 * files exist, `gjsify.platforms` promises a prebuild per target,
 * `gjsify.headless` promises the root entry reaches no typelib, `gjsify.tier`
 * promises a stability level. Every one of those promises can be false while the
 * build exits 0, and each false one was historically found by an INCIDENT, then
 * closed by a fresh standalone script. Five scripts accumulated that way; none
 * of them knew the others existed, and nothing made adding a SIXTH kind of
 * declaration force a sixth check.
 *
 * The registry is the fix for that last part, and it is the point of this
 * module. A rule declares the manifest FIELDS it governs. `fieldCoverageRule`
 * (rules/field-coverage.mjs) then derives the set of `gjsify.*` keys actually
 * declared anywhere in the tree and fails on any key no rule claims. Adding a
 * declaration kind without a rule is therefore not a thing you can forget — it
 * is a red build with the file to edit named in the message.
 *
 * SCOPE — the one axis that decides where a rule may live
 *
 * `scope: 'portable'` — the rule reads only what any npm package can have: the
 *   manifest itself, files on disk, binaries. No knowledge of THIS repository's
 *   directory layout, package names, CI workflows or internal data tables. These
 *   are the rules `gjsify manifest-check` exposes to consumers.
 *
 * `scope: 'repo'` — the rule knows about gjsify's own artifacts or its own CI
 *   (`prebuilds.yml`'s matrix, `@gjsify/resolve-npm`'s alias table,
 *   `packages/node/*` as an axis, curated package-name allowlists). Correct
 *   here, actively misleading anywhere else. These stay in `scripts/` and are
 *   registered from there — they are still in the registry, because field
 *   coverage must see the fields they govern.
 *
 * A rule's scope is NOT a quality judgement. `runtimes-drift` is the most
 * battle-tested check in the set and is firmly `repo`: it re-derives a
 * suggestion from path-based axis classification (`packages/node/*`,
 * `packages/web/adwaita*`) plus five curated package-NAME allowlists, none of
 * which exist in a consumer's tree.
 *
 * RESULT SHAPE
 *
 * A rule returns `{ failures, notes, stats }`:
 *   - `failures` — strings. Each one FAILS the run. Write them the way the five
 *     originals do: state what is wrong, why it matters, and the exact command
 *     or edit that fixes it. That is why they work.
 *   - `notes` — strings printed on success as well as failure. This is where a
 *     check states what it did NOT verify (a cross-arch prebuild that cannot be
 *     loaded here, an explicitly-deferred target). A check that claims more than
 *     it did is worse than no check.
 *   - `stats` — free-form, rendered by the rule's own summary line.
 */

/**
 * @typedef {object} RuleResult
 * @property {string[]} [failures] Findings that fail the run.
 * @property {string[]} [notes] Always-printed caveats / deferrals.
 * @property {Record<string, unknown>} [stats] Rule-specific counters.
 * @property {string} [summary] One line printed when the rule passes.
 */

/**
 * @typedef {object} Rule
 * @property {string} id Stable kebab-case identifier, used by `--only`.
 * @property {'portable'|'repo'} scope Where the rule may legitimately run.
 * @property {string[]} fields Manifest fields it governs. `gjsify.*` keys are
 *   spelled with the prefix (`gjsify.platforms`); plain npm fields are spelled
 *   bare (`exports`, `bin`). Field coverage reads the `gjsify.` ones.
 * @property {string} description One line, shown by `--list`.
 * @property {(ctx: import('./context.mjs').ConformanceContext) => Promise<RuleResult>|RuleResult} run
 */

/** @type {Map<string, Rule>} */
const RULES = new Map();

/**
 * Register a rule. Idempotent per id so a module imported twice (the scripts
 * and the CLI can both pull the portable set) does not double-register, but a
 * DIFFERENT rule reusing an id is a programming error and throws — two rules
 * under one id would make `--only` ambiguous and field coverage wrong.
 *
 * @param {Rule} rule
 * @returns {Rule}
 */
export function defineRule(rule) {
    for (const key of ['id', 'scope', 'description']) {
        if (typeof rule[key] !== 'string' || rule[key].length === 0) {
            throw new TypeError(`manifest-conformance: rule is missing a non-empty \`${key}\``);
        }
    }
    if (rule.scope !== 'portable' && rule.scope !== 'repo') {
        throw new TypeError(
            `manifest-conformance: rule "${rule.id}" has scope "${rule.scope}" (expected portable|repo)`,
        );
    }
    if (!Array.isArray(rule.fields)) {
        throw new TypeError(
            `manifest-conformance: rule "${rule.id}" must declare the manifest \`fields\` it governs — that list is what ` +
                'makes a new declaration kind impossible to add without a check. An empty array is legal for a rule ' +
                'that governs no declaration (it will simply never satisfy field coverage for anything).',
        );
    }
    if (typeof rule.run !== 'function') {
        throw new TypeError(`manifest-conformance: rule "${rule.id}" must provide a \`run(ctx)\` function`);
    }
    const existing = RULES.get(rule.id);
    if (existing && existing !== rule) {
        throw new Error(
            `manifest-conformance: duplicate rule id "${rule.id}". Ids are how \`--only\` selects a rule and how field ` +
                'coverage attributes a declaration; two rules cannot share one.',
        );
    }
    RULES.set(rule.id, rule);
    return rule;
}

/** Every registered rule, in registration order. */
export function allRules() {
    return [...RULES.values()];
}

/** Registered rules with `scope === 'portable'` — what the CLI exposes. */
export function portableRules() {
    return allRules().filter((r) => r.scope === 'portable');
}

/** @param {string} id */
export function getRule(id) {
    return RULES.get(id);
}

/**
 * Every `gjsify.*` field any registered rule claims to govern, without the
 * `gjsify.` prefix. Consumed by field coverage.
 */
export function claimedGjsifyFields() {
    const out = new Set();
    for (const rule of RULES.values()) {
        for (const field of rule.fields) {
            if (field.startsWith('gjsify.')) out.add(field.slice('gjsify.'.length));
        }
    }
    return out;
}

/** Which rule ids claim a given `gjsify.<key>` — used in coverage messages. */
export function rulesClaimingField(key) {
    const want = `gjsify.${key}`;
    return allRules()
        .filter((r) => r.fields.includes(want))
        .map((r) => r.id);
}

/**
 * Run a selection of rules and aggregate their results.
 *
 * Rules are run SEQUENTIALLY and in registration order. That is deliberate:
 * several of them shell out (`dlopen` probes, `git`) and the output of a failing
 * run is read top to bottom by a human, so a stable order is worth more than the
 * parallelism.
 *
 * A rule that THROWS is converted into a failure rather than crashing the run —
 * a checker that dies on one malformed package.json and reports nothing about
 * the other 250 is the worst possible outcome for a gate.
 *
 * @param {Rule[]} rules
 * @param {import('./context.mjs').ConformanceContext} ctx
 * @returns {Promise<{results: Array<{rule: Rule, result: RuleResult}>, failures: string[], notes: string[], ok: boolean}>}
 */
export async function runRules(rules, ctx) {
    const results = [];
    const failures = [];
    const notes = [];
    for (const rule of rules) {
        /** @type {RuleResult} */
        let result;
        try {
            result = (await rule.run(ctx)) ?? {};
        } catch (err) {
            result = {
                failures: [
                    `rule "${rule.id}" threw while running: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
                ],
            };
        }
        const ruleFailures = result.failures ?? [];
        const ruleNotes = result.notes ?? [];
        results.push({ rule, result });
        for (const f of ruleFailures) failures.push(`[${rule.id}] ${f}`);
        for (const n of ruleNotes) notes.push(`[${rule.id}] ${n}`);
    }
    return { results, failures, notes, ok: failures.length === 0 };
}

/**
 * Select rules by id / scope, with an actionable error on an unknown id — a
 * typo in `--only` must not silently run nothing and exit 0.
 *
 * @param {{only?: string[], scope?: 'portable'|'repo'}} [selection]
 */
export function selectRules(selection = {}) {
    let rules = allRules();
    if (selection.scope) rules = rules.filter((r) => r.scope === selection.scope);
    if (selection.only && selection.only.length > 0) {
        const known = new Set(rules.map((r) => r.id));
        const unknown = selection.only.filter((id) => !known.has(id));
        if (unknown.length > 0) {
            throw new Error(
                `unknown rule id(s): ${unknown.join(', ')}. Available${selection.scope ? ` (scope=${selection.scope})` : ''}: ` +
                    `${[...known].sort().join(', ')}`,
            );
        }
        rules = rules.filter((r) => selection.only.includes(r.id));
    }
    return rules;
}
