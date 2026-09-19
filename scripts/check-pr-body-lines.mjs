#!/usr/bin/env node
// The PR body must satisfy commitlint, because a squash merge writes it as the commit
// BODY and `main` lints what lands.
//
// THE ASYMMETRY, third instalment. `commitlint.yml`'s first step lints the PR's
// COMMITS; a squash merge composes the message from the PR title and the PR body
// instead. `check-pr-title-subject.mjs` closed the title half after four merges paid
// for it. The body half stayed open and has cost more:
//
//   MEASURED 2026-09-08, real commitlint (19.x, this repo's resolved config) over the
//   last 600 first-parent commits on `main`: TEN fail, every one of them on
//   `body-max-line-length`, two also on `footer-max-line-length`. The longest body
//   line in that window is 739 characters. Seven predate the day this was written:
//   e1f087e221 (739), 4fb741b163 (728), d44050e51b (538), 4aebe98fa0 (535),
//   8877d84a12 (330), 400bd42d96 (304), b213221aa7 (200). Three are the day itself:
//   03c49edc5f (458), 1cbac2d035 (215), 45adbdaa36 (102) — each one a markdown table
//   pasted into the description just before merging.
//
// So this is not a hypothetical, and it is the same shape as the title: green on the
// PR, red on `main`, on a message nobody can edit afterwards. The release cut then
// walks a commit that failed the lint that gates it.
//
// WHY EVERY LINE, RATHER THAN BODY AND FOOTER SEPARATELY. commitlint splits a message
// into body and footer with `conventional-commits-parser`, and the two limits it
// applies are BOTH 100. A line over 100 therefore fails whichever half it lands in,
// so the verdict does not depend on the split and reproducing that parser here would
// buy nothing but a second place for it to drift. If an override ever makes the two
// limits differ, this script refuses rather than checking the wrong one — the same
// arrangement `check-pr-title-subject.mjs` uses for `subject-case`.
//
// ALSO CHECKS two lines the length rule cannot see, because they are short enough to
// pass it and permanent for the same reason as the lines above: a `claude.ai/code/
// session_…` URL, and a `Co-Authored-By: Claude …` trailer. Both are the same class of
// bug as everything above — a body GitHub accepts becomes a commit body nobody can
// edit — and #1699 is the proof: it merged GREEN (every line under 100 characters) and
// commit b3590e8fec still carries the session URL on `main` forever. See the comment
// at the checks themselves for what is and is not allowed.
//
// Usage (in a pull_request job):
//   PR_BODY=… node scripts/check-pr-body-lines.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * `@commitlint/config-conventional`'s `body-max-line-length` and
 * `footer-max-line-length`, which are the same number.
 *
 * Mirrored ON PURPOSE, as in `check-pr-title-subject.mjs`: the repo does not depend on
 * `@commitlint/config-conventional` — the linting ACTION brings its own — so there is
 * no resolved config to read them from, and this constant IS the claim being checked.
 */
const CONVENTIONAL_MAX_LINE_LENGTH = 100;

const body = process.env.PR_BODY ?? '';

const ourRules = require('../commitlint.config.cjs').rules ?? {};

/** An explicit override in our own config wins over the inherited default. */
const limitOf = (name) => {
    const rule = ourRules[name];
    return Array.isArray(rule) && typeof rule[2] === 'number' ? rule[2] : CONVENTIONAL_MAX_LINE_LENGTH;
};

const bodyLimit = limitOf('body-max-line-length');
const footerLimit = limitOf('footer-max-line-length');

if (bodyLimit !== footerLimit) {
    // The single-limit simplification above is now false, and guessing which half a
    // line lands in is exactly what this script declines to do.
    console.error(
        '::error::commitlint.config.cjs now gives `body-max-line-length` and `footer-max-line-length` ' +
            `different values (${bodyLimit} and ${footerLimit}). This script checks every line against one ` +
            'limit because the two were equal. Split the check, or drop the differing override.',
    );
    process.exit(1);
}

if (!body.trim()) {
    // A squash body may legitimately be empty; there is nothing here to be too long.
    console.log('pr-body-lines: the PR body is empty — nothing to check.');
    process.exit(0);
}

// GitHub writes the body verbatim, `\r\n` included, and a stray `\r` would otherwise
// count toward the length of every line in a CRLF description.
const lines = body.replaceAll('\r\n', '\n').split('\n');
const over = lines
    .map((text, index) => ({ number: index + 1, length: text.length, text }))
    .filter((line) => line.length > bodyLimit);

if (over.length > 0) {
    console.error(
        `::error::The PR body will not survive commitlint: ${over.length} line(s) over ${bodyLimit} characters.`,
    );
    for (const line of over) {
        const preview = line.text.length > 80 ? `${line.text.slice(0, 77)}…` : line.text;
        console.error(`::error::  line ${line.number}: ${line.length} characters — ${preview}`);
    }
    console.error(
        '::error::Wrap the prose. A markdown table is the usual cause and the usual fix is to move it into a PR ' +
            'COMMENT, which is not part of the commit. This is the string that becomes history: a merge with a ' +
            'body commitlint rejects turns `main` red and cannot be fixed without rewriting history.',
    );
}

// SECOND CLASS OF THE SAME BUG, found 2026-09-19: a line can be under the length limit
// and still be a permanent liability once it is the squash body. #1699 merged GREEN —
// every line fit 100 characters — and commit b3590e8fec carries
// `https://claude.ai/code/session_01EsCgGTiQa1JB2rxg25zxHH` at line 150 of `main`'s
// history forever, because nothing checked for it. The repo's own rule (see
// `AGENTS.md` / commit convention) is narrower than "no AI attribution": the line
// `🤖 Generated with [Claude Code](https://claude.com/claude-code)` is fine and stays
// fine — it is the one PER-SESSION link and the `Co-Authored-By: Claude …` trailer
// that must not become part of `main`, because a session link is only useful to the
// person who had that session open and a co-author trailer misattributes authorship
// of a squash commit nobody but the PR author wrote.
const sessionLinkLines = lines
    .map((text, index) => ({ number: index + 1, text }))
    .filter((line) => /claude\.ai\/code\/session_/.test(line.text));
const coAuthorLines = lines
    .map((text, index) => ({ number: index + 1, text }))
    .filter((line) => /^Co-Authored-By:\s*Claude\b/i.test(line.text.trim()));

if (sessionLinkLines.length > 0) {
    console.error(
        `::error::The PR body carries a claude.ai/code/session_… URL on ${sessionLinkLines.length} line(s). ` +
            'That URL becomes part of the squash commit body and is permanent on `main` — it is only useful to ' +
            'whoever had that session open, so it does not belong in history. Remove the line; keep ' +
            '`🤖 Generated with [Claude Code](https://claude.com/claude-code)`, which is allowed.',
    );
    for (const line of sessionLinkLines) {
        console.error(`::error::  line ${line.number}: ${line.text}`);
    }
}

if (coAuthorLines.length > 0) {
    console.error(
        `::error::The PR body carries a \`Co-Authored-By: Claude …\` trailer on ${coAuthorLines.length} line(s). ` +
            'That trailer becomes part of the permanent squash commit body and misattributes authorship — remove it.',
    );
    for (const line of coAuthorLines) {
        console.error(`::error::  line ${line.number}: ${line.text}`);
    }
}

if (over.length === 0 && sessionLinkLines.length === 0 && coAuthorLines.length === 0) {
    const longest = Math.max(...lines.map((l) => l.length));
    console.log(`pr-body-lines: ${lines.length} line(s), longest ${longest}/${bodyLimit} — fits the squash body.`);
    process.exit(0);
}

process.exit(1);
