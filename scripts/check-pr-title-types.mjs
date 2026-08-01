#!/usr/bin/env node
// Hold the PR-title linter's implicit type list to the one commitlint enforces.
//
// WHY A CHECK RATHER THAN A SECOND LIST. With squash merges, what lands on
// `main` is the PR TITLE, not the commits — and `commitlint.yml` lints the
// COMMITS. So the string that becomes history is the one string nothing looks
// at: #849 merged as "Run the transparent addon matrix in CI (#849)" with no
// conventional prefix and is therefore absent from the v0.26.1 CHANGELOG
// entirely. The work shipped with no release note.
//
// The title step fixes that, and it needs a type list. Passing one would put a
// SECOND copy of `type-enum` in a workflow file, where it drifts silently — the
// failure mode this repo keeps paying for. It happens that our list is exactly
// the conventional-commit default, so the step passes NO `types` input and
// inherits it. That is only safe while the two agree, which is what this
// asserts: add a type to commitlint.config.cjs and this fails, telling you to
// make the workflow's list explicit instead of letting the two diverge unseen.
//
// Usage: node scripts/check-pr-title-types.mjs

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

// The default of `amannn/action-semantic-pull-request`, which takes it from
// `conventional-commit-types`. Mirrored here ON PURPOSE: this constant IS the
// claim being checked, not a duplicate of our own configuration.
const ACTION_DEFAULT_TYPES = [
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'build',
    'ci',
    'chore',
    'revert',
];

const WORKFLOW = '.github/workflows/commitlint.yml';

const rule = require('../commitlint.config.cjs').rules?.['type-enum'];
const ours = rule?.[2];
if (!Array.isArray(ours)) {
    console.error('::error::commitlint.config.cjs declares no `type-enum` list — nothing to compare.');
    process.exit(1);
}

const workflow = readFileSync(WORKFLOW, 'utf8');
const stepDeclaresTypes = /^\s*types:\s*\|/m.test(workflow);

const norm = (xs) => [...xs].sort().join(',');
const agree = norm(ours) === norm(ACTION_DEFAULT_TYPES);

if (agree) {
    console.log(`pr-title-types: commitlint's ${ours.length} types match the action default — no second list needed.`);
    if (stepDeclaresTypes) {
        console.error(
            `::error::${WORKFLOW} passes an explicit \`types:\` while the lists agree. ` +
                `Drop it — a second copy only exists to drift.`,
        );
        process.exit(1);
    }
    process.exit(0);
}

const onlyOurs = ours.filter((t) => !ACTION_DEFAULT_TYPES.includes(t));
const onlyDefault = ACTION_DEFAULT_TYPES.filter((t) => !ours.includes(t));

if (stepDeclaresTypes) {
    console.log(`pr-title-types: lists differ and ${WORKFLOW} declares its own — consistent.`);
    process.exit(0);
}

console.error('::error::commitlint.config.cjs no longer matches the PR-title action default.');
if (onlyOurs.length) console.error(`::error::  only in commitlint.config.cjs: ${onlyOurs.join(', ')}`);
if (onlyDefault.length) console.error(`::error::  only in the action default: ${onlyDefault.join(', ')}`);
console.error(
    `::error::The title step inherits the default, so a title using one of ours would be ` +
        `rejected (or one of theirs accepted). Pass an explicit \`types:\` in ${WORKFLOW}.`,
);
process.exit(1);
