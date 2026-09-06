#!/usr/bin/env node
// The PR title must satisfy commitlint AFTER the squash suffix, because that string
// IS the commit that lands on `main`.
//
// THE ASYMMETRY. `commitlint.yml`'s first step lints the PR's COMMITS; a squash merge
// writes `<title> (#<number>)` instead, so the one string that becomes history is the
// one string nothing looked at. `amannn/action-semantic-pull-request` closes the FORM
// half (type, scope, non-empty subject) and carries no other rule, which is why the
// rest cannot be an input on that step. Every hole here has been paid for twice:
//
//   header-max-length  #1125 and #1127 merged GREEN and turned `main` red, at 111 and
//                      105 characters against a limit of 100. #1127's title was 97 —
//                      under the limit on its own, and over it the moment GitHub
//                      appended ` (#1127)`. So the budget has to include the suffix,
//                      and the suffix grows with the issue number.
//   subject-case       #1275 ("… : Blueprint in libraries") and #1590 ("feat: Effect
//                      on GJS, and a GNOME platform layer") did the same. Both branch
//                      histories were lowercase and passed; the title was capitalised
//                      and `main` went red on the merge commit — which cannot be fixed
//                      without rewriting history, so the next release cut walks a
//                      commit that failed the lint that gates it.
//
// THOSE TWO ARE THE WHOLE ASYMMETRY, MEASURED. Real commitlint (19.x, this repo's
// resolved config) over the last 600 first-parent subjects on `main`, 2026-09-06:
// exactly 4 fail, and they are the four named above. No subject in that window
// violates `subject-full-stop`, `type-case`, `type-empty` or `subject-empty` — the
// action's form check and ordinary habit already cover them, so guarding them here
// would be a rule with no incident behind it. Re-measure before adding a third.
//
// WHY THE RULES ARE MIRRORED RATHER THAN READ. The repo does not depend on
// `@commitlint/config-conventional` — the linting ACTION brings its own — so there is
// no resolved config to read them from, and this file is where the claim lives, the
// same arrangement `check-pr-title-types.mjs` uses for the action's type list. An
// override in `commitlint.config.cjs` beats the mirror, and for `subject-case`, where
// a mirror cannot be derived from an arbitrary override, one is refused outright
// rather than silently ignored.
//
// Usage (in a pull_request job):
//   PR_TITLE=… PR_NUMBER=… node scripts/check-pr-title-subject.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * `@commitlint/config-conventional`'s `header-max-length`.
 *
 * Mirrored ON PURPOSE (see the header): this constant IS the claim being checked, and
 * a wrong value fails loudly on the next over-long title rather than silently.
 */
const CONVENTIONAL_HEADER_MAX_LENGTH = 100;

/**
 * `conventional-changelog-conventionalcommits`' `headerPattern`, verbatim, whose third
 * group is the `subject` that `subject-case` is about. Mirrored for the same reason as
 * the length above; a header that does not match it is the PR-title action's finding,
 * not this script's, so the case rule is skipped rather than guessed at.
 */
const CONVENTIONAL_HEADER_PATTERN = /^(\w*)(?:\((.*)\))?!?: (.*)$/;

/**
 * `subject-case` is `[2, 'never', ['sentence-case', 'start-case', 'pascal-case',
 * 'upper-case']]`, and those four reduce to ONE test: the subject must not begin with
 * an upper-case letter.
 *
 * The derivation, against `@commitlint/rules`' `subject-case` and `@commitlint/ensure`'s
 * `case`/`to-case` (19.x, read rather than assumed):
 *
 *   - The rule returns early unless the subject starts with a cased letter, so every
 *     branch below sees one. `ensure` strips `` `…` ``/"…"/'…' spans before comparing,
 *     and a span can only start AT a quote character — so the first character survives
 *     the strip, and `ensure`'s empty/digit escape hatches are unreachable from here.
 *   - `sentence-case` compares `upperFirst(input)` with `input`, which for a cased
 *     first letter is equality exactly when that letter is already upper-case.
 *   - `upper-case`, `start-case` and `pascal-case` each upper-case the first letter on
 *     the way to their own form, so each IMPLIES the sentence-case answer and none can
 *     be the only one that matches.
 *
 * Hence: flagged iff the first character is upper-case. A title-case letter (`\p{Lt}`,
 * e.g. `ǅ`) is upper-cased BY `upperFirst` into a different character and so is not
 * flagged, which this predicate reproduces by asking about the character itself rather
 * than matching `\p{Lu}`.
 */
const startsUpperCase = (subject) => {
    const first = [...subject][0] ?? '';
    return first.toUpperCase() === first && first.toLowerCase() !== first;
};

const title = process.env.PR_TITLE ?? '';
const number = process.env.PR_NUMBER ?? '';

if (!title) {
    console.error('::error::PR_TITLE is empty — this check must run in a pull_request job.');
    process.exit(1);
}

const ourRules = require('../commitlint.config.cjs').rules ?? {};

// An explicit override in our own config wins over the inherited default.
const ourLengthRule = ourRules['header-max-length'];
const limit =
    Array.isArray(ourLengthRule) && typeof ourLengthRule[2] === 'number'
        ? ourLengthRule[2]
        : CONVENTIONAL_HEADER_MAX_LENGTH;

// What GitHub will actually write as the subject. The number is appended even when
// the title already ends in something similar, so it is never optional.
const suffix = number ? ` (#${number})` : '';
const subject = `${title}${suffix}`;

/** Every problem, so one run names all of them rather than the first. */
const problems = [];

if (subject.length > limit) {
    problems.push(
        `The PR title will not fit the squash subject: ${subject.length} characters against a limit of ${limit}.\n` +
            `  subject would be: ${subject}\n` +
            `  the title itself is ${title.length}; the "${suffix}" GitHub appends adds ${suffix.length}. ` +
            `Shorten the title by at least ${subject.length - limit}.`,
    );
} else {
    console.log(`pr-title-subject: "${subject}" is ${subject.length}/${limit} characters — fits the squash subject.`);
}

if (ourRules['subject-case']) {
    // The mirror above describes the INHERITED rule. An override could invert it,
    // narrow it, or name a case this derivation says nothing about, so the honest
    // answer is to stop rather than to check the wrong thing.
    console.error(
        '::error::commitlint.config.cjs now overrides `subject-case`, which this script mirrors from ' +
            '`@commitlint/config-conventional`. Re-derive `startsUpperCase` against the override (its header ' +
            'shows the derivation) and update this guard.',
    );
    process.exit(1);
}

const parsed = CONVENTIONAL_HEADER_PATTERN.exec(subject);
if (!parsed) {
    // No conventional header at all: `amannn/action-semantic-pull-request` fails the
    // same title one step earlier, and reporting it twice would name the wrong rule.
    console.log('pr-title-subject: not a conventional header — the PR-title step owns that; skipping subject-case.');
} else if (startsUpperCase(parsed[3])) {
    problems.push(
        `The squash subject would fail commitlint's \`subject-case\`: "${parsed[3]}" starts upper-case.\n` +
            `  subject would be: ${subject}\n` +
            '  Lower-case the first word of the title. A capitalised proper noun later in the subject is fine, ' +
            'and one in FIRST position can be quoted (`Effect`) — commitlint strips quoted spans before ' +
            'deciding.',
    );
} else {
    console.log(`pr-title-subject: subject "${parsed[3]}" does not start upper-case — passes \`subject-case\`.`);
}

if (problems.length === 0) process.exit(0);

for (const problem of problems) {
    for (const line of problem.split('\n')) console.error(`::error::${line}`);
}
console.error(
    '::error::This is the string that becomes history. A merge with a subject commitlint rejects turns `main` ' +
        'red and cannot be fixed without rewriting history.',
);
process.exit(1);
