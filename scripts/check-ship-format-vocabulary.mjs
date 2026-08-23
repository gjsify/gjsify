#!/usr/bin/env node
// The `gjsify ship` format vocabulary must have ONE source of truth.
//
// THE GAP THIS CLOSES. `FormatId` in `packages/infra/cli/src/utils/ship/types.ts`
// is the vocabulary. Two consumers are already bound to it by the compiler —
// `FORMATS` is a `Record<FormatId, …>`, and the packer dispatch in `ship.ts` is a
// switch with a `never` guard — and `FORMAT_IDS` is now read back out of
// `FORMATS`. One consumer cannot be bound that way and is what this script is for:
//
//   packages/infra/manifest-conformance/lib/rules/ship.mjs
//     const TARGETS = new Set(['deb', 'rpm']);
//
// It lives in a DIFFERENT PACKAGE that must not import the CLI. That rule is
// documented `portable` on purpose — it reads a package's own `gjsify.ship` block
// and is meant to run in downstream trees, where `@gjsify/cli` is not a dependency
// and `src/` does not exist. An import would buy the binding by breaking the
// property the rule exists to have.
//
// WHY IT MATTERS, in the direction that is easy to miss: `auditShip` REFUSES a
// target it does not know ("…which `gjsify ship` cannot build"). So the failure of
// a stale `TARGETS` is not a missed check — it is `gjsify audit` rejecting the
// first CORRECT declaration of a newly supported format, in someone else's tree,
// with a message saying the format is unsupported. The two lists agreeing today is
// exactly why nothing has noticed.
//
// WHY TEXTUAL. Reading the two literals is the only way to compare them without
// creating the dependency edge the rule must not have. Both are single-line, both
// are asserted here to be findable — a parse that stops matching FAILS rather than
// reporting agreement, because "found nothing on both sides" would otherwise read
// as "the two agree".

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `--root <dir>` so the suite can point this at a fixture tree, the same knob
// `check-ci-image-packages.mjs` takes. A checker with no way to be aimed
// somewhere else is a checker with no test, which is how the last one in this
// family drifted for four commits without anyone noticing.
const rootFlag = process.argv.indexOf('--root');
if (rootFlag !== -1 && process.argv[rootFlag + 1] === undefined) {
    // Falling back to the real repo root here would answer a question about
    // ANOTHER tree, in green. A caller who typed `--root` wants a specific tree.
    console.error('  ✗ --root was given with no directory after it.');
    process.exit(2);
}
const ROOT = rootFlag !== -1 ? process.argv[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = 'packages/infra/cli/src/utils/ship/types.ts';
const RULE = 'packages/infra/manifest-conformance/lib/rules/ship.mjs';

// EXACTLY ONE match, never the first of several. A non-global `.exec()` returns
// the earliest match in the file, so a COMMENT quoting the declaration wins over
// the declaration — and this tree quotes code in comments constantly, including
// in the header above. Measured before this was tightened:
//
//     // Before dmg this was: export type FormatId = 'deb' | 'rpm';
//     export type FormatId = 'deb' | 'rpm' | 'dmg';
//
// with `TARGETS = new Set(['deb', 'rpm'])` reported "agree on deb, rpm", exit 0,
// while the rule was a whole format behind. That is the exact failure this
// script's header promises to prevent, produced by the script itself. Two
// matches now FAIL, because the checker cannot know which one is the live
// declaration and guessing is how it lies.
function soleMatch(text, pattern, what) {
    const all = [...text.matchAll(pattern)];
    if (all.length === 0) return { members: null, reason: `no \`${what}\` found` };
    if (all.length > 1) {
        return {
            members: null,
            reason:
                `\`${what}\` matches ${all.length} times, so this check cannot tell which is the live ` +
                `declaration — most likely a comment quotes it. Make the quoted copy unquotable ` +
                `(drop the \`=\`, or reword it) so exactly one match remains`,
        };
    }
    const members = [...all[0][1].matchAll(/'([^']+)'/g)].map((q) => q[1]);
    return members.length > 0 ? { members, reason: null } : { members: null, reason: `\`${what}\` names nothing` };
}

/** The members of `export type FormatId = 'a' | 'b';`. */
function formatIdUnion(text) {
    return soleMatch(text, /export type FormatId\s*=\s*([^;]+);/g, 'export type FormatId = …;');
}

/** The members of `const TARGETS = new Set([...]);`. */
function conformanceTargets(text) {
    return soleMatch(text, /const TARGETS\s*=\s*new Set\(\[([^\]]*)\]\)/g, 'const TARGETS = new Set([…])');
}

const problems = [];
const read = (rel) => {
    try {
        return readFileSync(join(ROOT, rel), 'utf8');
    } catch (error) {
        problems.push(`${rel} could not be read (${error.code ?? error.message}).`);
        return null;
    }
};

const typesText = read(TYPES);
const ruleText = read(RULE);

const typesParse = typesText === null ? null : formatIdUnion(typesText);
const ruleParse = ruleText === null ? null : conformanceTargets(ruleText);
const declared = typesParse?.members ?? null;
const known = ruleParse?.members ?? null;

// A parse that stops matching must FAIL. Silently comparing two nulls would report
// agreement forever after an unrelated refactor moved either literal.
if (typesParse !== null && declared === null) {
    problems.push(`${TYPES}: could not read the \`FormatId\` union — ${typesParse.reason}.`);
}
if (ruleParse !== null && known === null) {
    problems.push(`${RULE}: could not read the target set — ${ruleParse.reason}.`);
}

if (declared !== null && known !== null) {
    const missing = declared.filter((id) => !known.includes(id));
    const extra = known.filter((id) => !declared.includes(id));
    if (missing.length > 0) {
        problems.push(
            `${RULE}: \`TARGETS\` is missing ${missing.map((id) => `"${id}"`).join(', ')}, which \`FormatId\` ` +
                `declares. \`auditShip\` would REJECT a package that legitimately declares ` +
                `\`gjsify.ship.targets: [${missing.map((id) => `"${id}"`).join(', ')}]\`, telling its author ` +
                `the format cannot be built when it can.`,
        );
    }
    if (extra.length > 0) {
        problems.push(
            `${RULE}: \`TARGETS\` names ${extra.map((id) => `"${id}"`).join(', ')}, which \`FormatId\` does not. ` +
                `\`gjsify audit\` would accept a declaration \`gjsify ship\` then fails on.`,
        );
    }
}

if (problems.length > 0) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(`ship-format-vocabulary: ${problems.length} problem(s).`);
    process.exit(1);
}

console.log(`ship-format-vocabulary: FormatId and conformance TARGETS agree on ${declared.join(', ')}.`);
