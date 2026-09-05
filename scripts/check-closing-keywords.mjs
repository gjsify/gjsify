#!/usr/bin/env node
// A closing keyword closes ONE issue. A comma after it closes nothing.
//
// THE INCIDENT. Three PR bodies written inside twenty minutes on 2026-09-04, all
// three merged into 0.48.0. #1567's opened with
// `Closes #1453, #1547, #1546, #1549, #1551, #1555.` and #1565's with
// `Closes #1556, #1550, #1516, #1529.`. Each merge closed the FIRST ref and no
// other — #1453 on 2026-09-04T20:26Z, #1556 on 2026-09-05T10:40Z — with one
// exception that is the whole reason both surfaces are read below: #1549 closed
// too, because a commit body inside #1567 happened to say `That closes #1549`
// mid-sentence. SEVEN stayed open while the work that fixed them was on `main`,
// in a release, and being read by whoever went looking for what was left to do.
// They were closed by hand on 2026-09-05, 14:47-14:48Z, each with the commit that
// had already fixed it. Every timestamp here is read off the issue timelines.
//
// THE CONTROL is the third of those bodies, same squash mechanics: #1568 closed
// all four of its issues at 2026-09-05T09:46Z. Its BODY carried the identical
// broken list — measured here, this check flags it — and what saved it was the
// other surface: four separate `Closes #N.` lines in its commit messages. So the
// variable is the SPELLING and not the merge, which is what makes this checkable
// at all; and a PR is only ever one surface away from the defect, which is why
// both are read below. GitHub's own rule: the keyword must be repeated before
// every reference.
//
// WHY THIS SHAPE OF DEFECT IS WORSE THAN A BROKEN LINK. It reports success. The
// body SAYS six issues are closed, the merge SAYS it succeeded, and the four
// that stayed open look — to anyone reading the issue list — like work nobody has
// done. That is the same class `check-pr-title-length.mjs` and
// `check-pr-title-types.mjs` were written for: a string that becomes history and
// that nothing looked at. Those two cover the PR title. This is the third string
// GitHub reads, and the only one that changes the state of OTHER records.
//
// WHERE IT RUNS, and why no new gate. `commitlint.yml` already owns "the strings
// that land on `main`" and is already one of the three required checks, so this
// is a step there rather than a fourth blocking workflow (AGENTS.md § Governance:
// a required check that does not RUN blocks the PR forever, and every guard's
// cost is the SUM).
//
// WHAT IT READS. The PR body — the surface both incidents were on — and every
// commit message in the PR, because a squash body is composed from those and
// #1568 proves a `Closes` line there does close. Code is exempt: fenced blocks
// and inline spans are blanked before the scan, so prose ABOUT this defect (this
// header included) can spell the broken form without tripping the check, and so
// a body quoting a log line is not read as an intent to close.
//
// WHERE "code is exempt" STOPS, and why it stops there. A four-space indented
// block and an `<!-- -->` comment are code in a rendered BODY; this check reads
// both as prose and flags a broken list in either. Deliberate: a commit message
// is not markdown, so blanking those shapes would open a blind spot on the very
// surface that does the closing — #1549 closed on a mid-sentence
// `That closes #1549` in one of #1567's commit bodies and on nothing else. Also
// unmatched, the other end of the same trade: `**Closes** #a, #b`, where emphasis
// splits the keyword off its space, and a bare issue URL after a keyword, which
// GitHub's documented syntax does not list as a closing reference at all.
//
// Usage (in a pull_request job):
//   PR_BODY=… PR_BASE_SHA=… PR_HEAD_SHA=… node scripts/check-closing-keywords.mjs

import { execFileSync } from 'node:child_process';

/**
 * GitHub's closing keywords, verbatim from its documentation on linking a pull
 * request to an issue. Mirrored here for the reason `check-pr-title-length.mjs`
 * mirrors `header-max-length`: this list IS the claim being checked, there is no
 * resolved config to read it from, and a missing entry fails open on exactly the
 * spelling it forgot.
 *
 * The same page: "The keywords can be followed by colons or in uppercase. For
 * example: `Closes: #10`, `CLOSES #10`, or `CLOSES: #10`." So the colon is part
 * of the keyword's grammar, not punctuation after it — hence the `:?` in CHAIN.
 * Without it `Closes: #a, #b` closed #a and this check called the body clean.
 */
const CLOSING_KEYWORDS = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];

/** `#123` or `owner/repo#123` — the two forms GitHub resolves. */
const REF = String.raw`(?:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#\d+`;

/**
 * Whitespace a list may span: at most ONE line break, never a blank one.
 * `Closes #10` followed by a paragraph opening `And #11 is a follow-up.` is two
 * paragraphs and closes nothing it did not mean to — with `\s*` on both sides of
 * the separator this check read it as a broken list and would have blocked a
 * correct merge, which is the one failure mode a REQUIRED check cannot have.
 */
const GAP = String.raw`[^\S\n]*(?:\n[^\S\n]*)?`;

/**
 * What separates a dangling reference from the one before it. The comma both
 * incidents used; `;` and `&`, which are what a hand reaching for "and one more"
 * types; and the `and` form, which reads even more like a list that works:
 * `Fixes #10 and #11`. A bare `and` has to stay on the reference's own line —
 * one line further down it is prose far more often than a list.
 */
const SEPARATOR = String.raw`(?:${GAP}[,;&]${GAP}(?:and[^\S\n]+)?|[^\S\n]+and[^\S\n]+)`;

const CHAIN = new RegExp(String.raw`\b(${CLOSING_KEYWORDS.join('|')}):?\s+(${REF})((?:${SEPARATOR}${REF})+)`, 'gi');

/** Every reference inside an already-matched tail. Each is keyword-less by construction. */
const TAIL_REF = new RegExp(REF, 'g');

/**
 * Blank out code, PRESERVING LENGTH so byte offsets still name the right line.
 *
 * Fenced blocks first, then inline spans — the other order would let a lone
 * backtick inside a fence eat the rest of the document. Only the CONTENT is
 * blanked; newlines and the delimiters themselves survive, so a fence is still a
 * fence to the line counter.
 *
 * The terminator is `\2` or END OF INPUT, spelled `$(?![\s\S])` and not `$`.
 * Under `m` a bare `$` matches every line end, and with a lazy body that is the
 * FIRST one — so a three-line fence had its first line blanked and the rest read
 * as prose. Measured while writing this: a fence containing the broken form
 * failed the check on line 3 of its own example. The single-line vector below
 * passed throughout, which is why there is now a multi-line one.
 */
function blankCode(text) {
    const blank = (match) => match.replace(/[^\n]/g, ' ');
    return text
        .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[^\n]*$|$(?![\s\S]))/gm, blank)
        .replace(/`+[^`\n]*`+/g, blank);
}

/** 1-based line number of `index` in `text`. */
function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
    return line;
}

/**
 * Every place a closing keyword is followed by references it does not close.
 *
 * Returns `{ keyword, closed, dangling[], line }` per chain. Pure over its input
 * so the self-test below can hand it bodies that were never written anywhere.
 * NOT exported: this module runs its CLI at import time and exits, so an exported
 * name would be one no caller can reach without terminating its own process.
 */
function danglingClosingRefs(text) {
    const scannable = blankCode(text ?? '');
    const findings = [];

    for (const match of scannable.matchAll(CHAIN)) {
        const dangling = match[3].match(TAIL_REF) ?? [];
        if (dangling.length === 0) continue;
        findings.push({
            keyword: match[1],
            closed: match[2],
            dangling,
            line: lineOf(scannable, match.index),
        });
    }

    return findings;
}

/** The form that works, ready to paste. */
function repaired({ keyword, closed, dangling }) {
    const capitalised = keyword[0].toUpperCase() + keyword.slice(1).toLowerCase();
    return [closed, ...dangling].map((ref) => `${capitalised} ${ref}.`).join(' ');
}

// ------------------------------------------------------------------ self-test

/**
 * The matrix. Two directions on purpose: a detector that stopped detecting and a
 * detector that flags everything both pass a one-sided suite, and the second is
 * what would make this check unusable — it sits on a required check, so a false
 * positive blocks a merge that is correct.
 *
 * `#99001` and its neighbours are deliberately outside this repository's issue
 * range: these strings end up in a commit message, and a vector that named a real
 * issue would ask GitHub to close it.
 */
const VECTORS = [
    // ── must be flagged ──────────────────────────────────────────────────────
    { name: 'the #1565 shape', text: 'Closes #99001, #99002, #99003, #99004.', expect: ['#99002', '#99003', '#99004'] },
    { name: 'the #1567 shape', text: 'Closes #99001, #99002, #99005.', expect: ['#99002', '#99005'] },
    { name: 'lowercase', text: 'closes #99001, #99002', expect: ['#99002'] },
    { name: 'and, not comma', text: 'Fixes #99001 and #99002', expect: ['#99002'] },
    { name: 'oxford and', text: 'Resolves #99001, #99002, and #99003', expect: ['#99002', '#99003'] },
    { name: 'cross-repo first', text: 'Closes gjsify/gjsify#99001, #99002', expect: ['#99002'] },
    {
        name: 'cross-repo dangling',
        text: 'Closes #99001, gjsify/ts-for-gir#99002',
        expect: ['gjsify/ts-for-gir#99002'],
    },
    { name: 'mid-sentence', text: 'This one closes #99001, #99002 for good.', expect: ['#99002'] },
    { name: 'past tense', text: 'Fixed #99001, #99002', expect: ['#99002'] },
    { name: 'chain resumes after a keyword', text: 'Closes #99001, #99002, closes #99003.', expect: ['#99002'] },
    { name: 'a colon, which GitHub documents', text: 'Closes: #99001, #99002', expect: ['#99002'] },
    { name: 'colon AND uppercase, both documented', text: 'FIXES: #99001, #99002', expect: ['#99002'] },
    { name: 'ampersand', text: 'Fixes #99001 & #99002', expect: ['#99002'] },
    { name: 'semicolon', text: 'Closes #99001; #99002', expect: ['#99002'] },
    { name: 'wrapped after the comma', text: 'Closes #99001,\n#99002', expect: ['#99002'] },
    { name: 'CRLF, the line ending GitHub sends', text: 'Closes #99001, #99002\r\n', expect: ['#99002'] },

    // ── must NOT be flagged ──────────────────────────────────────────────────
    { name: 'one ref', text: 'Closes #99001.', expect: [] },
    { name: 'a keyword each', text: 'Closes #99001, closes #99002.', expect: [] },
    { name: 'a line each', text: 'Closes #99001.\n\nCloses #99002.', expect: [] },
    { name: 'Refs is not a closing keyword', text: 'Refs #99001, #99002.', expect: [] },
    { name: 'See also is not either', text: 'See also #99001, #99002.', expect: [] },
    { name: 'prose that merely contains the word', text: 'That closes the window at cut + 2 days.', expect: [] },
    { name: 'a bare list with no keyword', text: 'Read #99001, #99002 before starting.', expect: [] },
    { name: 'inside an inline span', text: 'Write `Closes #99001, #99002` and it breaks.', expect: [] },
    { name: 'inside a fence', text: '```\nCloses #99001, #99002\n```\n', expect: [] },
    { name: 'inside a tilde fence', text: '~~~text\nCloses #99001, #99002\n~~~\n', expect: [] },
    {
        name: 'inside a MULTI-LINE fence — the shape a one-line vector cannot see',
        text: '```\nfirst\nCloses #99001, #99002\nthird\n```\n\nprose after',
        expect: [],
    },
    { name: 'inside an unterminated fence', text: '```\nCloses #99001, #99002\n#99003', expect: [] },
    { name: 'inside an indented fence', text: '  ```js\n  Closes #99001, #99002\n  ```\n', expect: [] },
    { name: 'after a fence, still read', text: '```\ncode\n```\n\nCloses #99001, #99002', expect: ['#99002'] },
    { name: 'a version, not a reference', text: 'Closes #99001, v0.48.0 shipped it.', expect: [] },
    // Without the `#` anchor in REF this one flags `42`, and every other vector
    // stays green — it is the whole of what holds that anchor.
    { name: 'a bare number, not a reference', text: 'Closes #99001, 42 files changed.', expect: [] },
    { name: 'a new paragraph that opens with And', text: 'Closes #99001\n\nAnd #99002 is a follow-up.', expect: [] },
    { name: 'a next line that opens with and', text: 'Closes #99001\nand #99002 stays open.', expect: [] },
    { name: 'a comma cannot reach past a blank line', text: 'Closes #99001,\n\n#99002 is separate.', expect: [] },
];

function selfTest() {
    const failures = [];

    for (const vector of VECTORS) {
        const found = danglingClosingRefs(vector.text).flatMap((finding) => finding.dangling);
        const expected = vector.expect;
        if (found.length !== expected.length || found.some((ref, i) => ref !== expected[i])) {
            failures.push(`${vector.name}: expected [${expected.join(', ')}], detector said [${found.join(', ')}]`);
        }
    }

    // The line number is what a reader navigates by, so it is asserted rather
    // than assumed — an off-by-one here sends someone to the wrong paragraph of a
    // long body.
    const onLineThree = danglingClosingRefs('first\nsecond\nCloses #99001, #99002\n');
    if (onLineThree[0]?.line !== 3) {
        failures.push(`line number: expected 3, got ${onLineThree[0]?.line}`);
    }

    const suggestion = repaired({ keyword: 'closes', closed: '#99001', dangling: ['#99002'] });
    if (suggestion !== 'Closes #99001. Closes #99002.') {
        failures.push(`repaired(): got ${JSON.stringify(suggestion)}`);
    }

    return failures;
}

const selfTestFailures = selfTest();
if (selfTestFailures.length > 0) {
    console.error('::error::check-closing-keywords: the detector failed its own vectors, so it read no real data.');
    for (const failure of selfTestFailures) console.error(`::error::  - ${failure}`);
    process.exit(1);
}

// ------------------------------------------------------------------ real data

const body = process.env.PR_BODY ?? '';
const baseSha = process.env.PR_BASE_SHA ?? '';
const headSha = process.env.PR_HEAD_SHA ?? '';

// An empty PR_BODY is legitimate: GitHub sends null for a PR with no description.
// An empty RANGE is not. Without it this read one surface, exited 0, and printed a
// success line naming the body it had read — green over a PR whose COMMITS carry
// the list, which is the surface #1568 closed all four of its issues from. Same
// refusal `check-pr-title-length.mjs` makes when PR_TITLE is empty.
if (!baseSha || !headSha) {
    console.error(
        '::error::check-closing-keywords: PR_BASE_SHA/PR_HEAD_SHA are empty — this must run in a pull_request job.',
    );
    console.error(
        '::error::Reading the body alone reports clean on a PR whose commit messages carry the list. #1568 ' +
            'closed its four issues from exactly there.',
    );
    process.exit(1);
}

/**
 * The commit messages in the PR. A squash body is composed from these, and #1568
 * closed four issues from exactly there, so they carry the same claim the body
 * does.
 *
 * A PR always has at least one commit. Zero means the range was wrong or the
 * history is too shallow to walk — a corpus this check could quietly report clean.
 */
function commitMessages() {
    const out = execFileSync('git', ['log', '--format=%B%x00', `${baseSha}..${headSha}`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });

    return out
        .split('\0')
        .map((message) => message.trim())
        .filter(Boolean);
}

let commits;
try {
    commits = commitMessages();
} catch (error) {
    console.error(`::error::check-closing-keywords: could not walk ${baseSha}..${headSha} — ${error.message}`);
    console.error('::error::The job needs the full history (`fetch-depth: 0`) and both PR SHAs.');
    process.exit(1);
}

if (commits.length === 0) {
    console.error(`::error::check-closing-keywords: ${baseSha}..${headSha} yielded no commit message.`);
    console.error('::error::A pull request has at least one. Reading zero here would report every PR clean.');
    process.exit(1);
}

const sources = [
    { what: 'the PR body', text: body },
    ...commits.map((message, i) => ({ what: `commit ${i + 1} of ${commits.length}`, text: message })),
];

const findings = sources.flatMap(({ what, text }) =>
    danglingClosingRefs(text).map((finding) => ({ ...finding, what })),
);

if (findings.length === 0) {
    console.log(
        `closing-keywords: self-test green — ${VECTORS.length} vector(s). Read the PR body ` +
            `(${body.length} characters) and ${commits.length} commit message(s); ` +
            'no closing keyword carries a reference it does not close.',
    );
    process.exit(0);
}

console.error('::error::A closing keyword closes ONE issue. These references are named but not closed by it:');
for (const finding of findings) {
    const isOrAre = finding.dangling.length === 1 ? 'is' : 'are';
    console.error(
        `::error::  ${finding.what}, line ${finding.line}: "${finding.keyword} ${finding.closed}" closes ` +
            `${finding.closed} and nothing else — ${finding.dangling.join(', ')} ${isOrAre} not closed by it.`,
    );
    console.error(`::error::    write instead: ${repaired(finding)}`);
}
console.error(
    '::error::Another surface may still close them — #1568 was rescued by its commit bodies while its ' +
        'own PR body carried this exact list. Do not rely on that: #1567 and #1565 were not, and left ' +
        'seven issues open across a release.',
);
process.exit(1);
