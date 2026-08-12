#!/usr/bin/env node
// The PR title must still fit `header-max-length` AFTER the squash suffix.
//
// THE INCIDENT. `#1125` and `#1127` both merged green and turned `main` red on
// Commitlint, because a squash merge makes the subject `<title> (#<number>)` and
// theirs came to 111 and 105 characters against a limit of 100. The PR run lints
// the branch COMMITS — all of which were short — so nothing looked at the string
// that actually became history. `check-pr-title-types.mjs` already guards the TYPE
// half of exactly this asymmetry (see its header, and #849); this is the LENGTH
// half, which was missing.
//
// WHY THE SUFFIX MATTERS MORE THAN IT LOOKS. #1127's title was 97 characters — it
// would have passed a check on the title alone and still broken `main`, because
// ` (#1127)` pushed it to 105. So the budget has to include the suffix GitHub will
// append, and the suffix grows with the issue number.
//
// `amannn/action-semantic-pull-request` validates the title's FORM and has no
// length rule, which is why this cannot simply be an input on that step.
//
// Usage (in a pull_request job):
//   PR_TITLE=… PR_NUMBER=… node scripts/check-pr-title-length.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * `@commitlint/config-conventional`'s `header-max-length`.
 *
 * Mirrored here ON PURPOSE, the same way `check-pr-title-types.mjs` mirrors the
 * action's default type list: this constant IS the claim being checked. The repo
 * does not depend on `@commitlint/config-conventional` — the linting ACTION brings
 * its own — so there is no resolved config to read it from, and a wrong value here
 * fails loudly on the next over-long title rather than silently.
 */
const CONVENTIONAL_HEADER_MAX_LENGTH = 100;

const title = process.env.PR_TITLE ?? '';
const number = process.env.PR_NUMBER ?? '';

if (!title) {
    console.error('::error::PR_TITLE is empty — this check must run in a pull_request job.');
    process.exit(1);
}

/** An explicit override in our own config wins over the inherited default. */
const ourRule = require('../commitlint.config.cjs').rules?.['header-max-length'];
const limit = Array.isArray(ourRule) && typeof ourRule[2] === 'number' ? ourRule[2] : CONVENTIONAL_HEADER_MAX_LENGTH;

// What GitHub will actually write as the subject. The number is appended even when
// the title already ends in something similar, so it is never optional.
const suffix = number ? ` (#${number})` : '';
const subject = `${title}${suffix}`;

if (subject.length <= limit) {
    console.log(`pr-title-length: "${subject}" is ${subject.length}/${limit} characters — fits the squash subject.`);
    process.exit(0);
}

console.error(
    `::error::The PR title will not fit the squash subject: ${subject.length} characters against a ` +
        `limit of ${limit}.`,
);
console.error(`::error::  subject would be: ${subject}`);
console.error(
    `::error::  the title itself is ${title.length}; the "${suffix}" GitHub appends adds ${suffix.length}. ` +
        `Shorten the title by at least ${subject.length - limit}.`,
);
console.error(
    '::error::This is the string that becomes history. A merge with an over-long subject turns `main` ' +
        'red on Commitlint and cannot be fixed without rewriting history.',
);
process.exit(1);
