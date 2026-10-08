#!/usr/bin/env node
// Repairs what `commitlint.yml` would otherwise only report: the mechanical half of a
// PR title and body, which a squash merge writes as the commit that lands on `main`.
//
// WHY A REPAIR, NOT ONE MORE CHECK. Every finding the three PR-text checks produce has
// so far been fixed by hand in the same way — lower-case a word, drop a session URL,
// re-wrap a paragraph, move a table into a comment — and each round costs a red
// required check, an edit and another run. The strings live on the PR, not in git, so
// fixing them needs no push and no history rewrite: `main` is squash-only, the branch
// commits never land, and nothing here touches a branch (a force-push would break a
// stacked PR and every worktree checked out on it).
//
// WHAT IT LEAVES ALONE, so the checks keep reporting it: a type that is not in the
// enum and not one of the synonyms below (choosing one is a decision about the
// CHANGELOG), and a title with no conventional header when the head branch carries no
// type. A repair that guesses is worse than a red check.
//
// WHAT IT CHANGES, title:
//   - whitespace runs, `Feat :`-style type spelling, a trailing full stop;
//   - type synonyms mapped onto the enum: feature/features → feat, bugfix/bug/
//     hotfix/fixes → fix, doc/documentation → docs, tests/testing → test, chores →
//     chore, refactoring → refactor, performance → perf, builds → build;
//   - an upper-case first word of the subject (#1275, #1590): a plain capitalised word
//     is lower-cased, anything else (`GJS`, `TypeScript`) is quoted in backticks, which
//     commitlint strips before judging `subject-case`;
//   - a missing conventional header, when the head branch starts with a type's word
//     (`docs/…`, `hotfix-…`): the type is prepended — the branch stating the decision a
//     header would have made;
//   - a subject too long for `<title> (#N)`: the scope is dropped first, then the
//     subject is cut at a word boundary, and the cut DROPS no words: the full title is
//     moved to the top of the body under `Full title:`.
// body:
//   - drops `claude.ai/code/session_…` lines and `Co-Authored-By: Claude` trailers
//     (#1699 — see `check-pr-body-lines.mjs`);
//   - repeats a closing keyword before every reference of a list
//     (`Closes #1, #2` → `Closes #1, closes #2`), the form
//     `check-closing-keywords.mjs` demands;
//   - re-wraps a prose line over the limit at word boundaries, keeping list and quote
//     prefixes, never starting a continuation with something markdown would read as a
//     new block;
//   - turns an over-long heading into bold prose **…** wrapped under the limit;
//   - moves a table, a fenced block, or a prose line that cannot be wrapped (a single
//     long URL) into a PR COMMENT, which is not part of the commit, and leaves a
//     pointer in its place. That is the fix `check-pr-body-lines.mjs` has always told
//     people to make by hand.
//
// RUNS WITH A WRITE TOKEN AND NO HEAD CODE: the workflow checks this file out from
// `base.sha`, and the PR text reaches it as data through the API, never as program text.
// An edit made with `GITHUB_TOKEN` starts no new run, so the workflow lints the text
// this script hands on through `$GITHUB_OUTPUT` instead of waiting for an `edited` event.
//
// Usage (in a pull_request job):
//   GH_TOKEN=… REPO=owner/name PR_NUMBER=… HEAD_REF=… node scripts/repair-pr-text.mjs

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** `@commitlint/config-conventional`'s line limit, mirrored as in `check-pr-body-lines.mjs`. */
const MAX_LINE_LENGTH = 100;

/** `conventional-changelog-conventionalcommits`' `headerPattern`, loosened around the colon. */
const LOOSE_HEADER = /^(\w+)(\([^)]*\))?(!)?\s*:\s*(.*)$/;

const SESSION_LINK = /claude\.ai\/code\/session_/;
const CO_AUTHOR_CLAUDE = /^Co-Authored-By:\s*Claude\b/i;

/** Tokens that would open a new markdown block if a wrap put them first on a line. */
const BLOCK_OPENER = /^([-*+]|\d+[.)]|#{1,6}|>|\||```|~~~|=+|-{3,})$/;

/** A line that opens or closes a fenced block — the boundary of `check-closing-keywords.mjs`' `blankCode`. */
const FENCE_START = /^\s*(```|~~~)/;

/**
 * Type spellings a hand reaches for that are not the enum's own. Each maps onto a
 * type that IS in the enum (`typeEnum()`), and only onto one of those — see
 * `typeFor`, which refuses anything else so an unknown type stays a decision.
 */
const TYPE_SYNONYMS = {
    feature: 'feat',
    features: 'feat',
    bugfix: 'fix',
    bug: 'fix',
    hotfix: 'fix',
    fixes: 'fix',
    doc: 'docs',
    documentation: 'docs',
    tests: 'test',
    testing: 'test',
    chores: 'chore',
    refactoring: 'refactor',
    performance: 'perf',
    builds: 'build',
};

/**
 * GitHub's closing keywords, verbatim from `check-closing-keywords.mjs`, whose regexes
 * this mirrors because that script cannot export them — it runs its CLI at import time.
 * A keyword repeated before every reference is what it accepts; see its header for why.
 */
const CLOSING_KEYWORDS = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
const CLOSING_REF = String.raw`(?:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#\d+`;
const CLOSING_GAP = String.raw`[^\S\n]*(?:\n[^\S\n]*)?`;
const CLOSING_SEPARATOR = String.raw`(?:${CLOSING_GAP}[,;&]${CLOSING_GAP}(?:and[^\S\n]+)?|[^\S\n]+and[^\S\n]+)`;
const TAIL_CLOSING_REF = new RegExp(CLOSING_REF, 'g');
/** An inline code span — exempt in the check, which blanks spans before scanning. */
const INLINE_CODE = /`+[^`\n]*`+/g;

function typeEnum() {
    const rule = require('../commitlint.config.cjs').rules?.['type-enum'];
    return Array.isArray(rule) && Array.isArray(rule[2]) ? rule[2] : [];
}

/**
 * A type can be spelled several ways; the enum cannot. Resolve synonyms onto the enum
 * and refuse everything else — an unknown type is a CHANGELOG decision.
 *
 * @param {string} word
 * @param {string[]} types
 * @returns {string | null}
 */
function typeFor(word, types) {
    const lower = String(word).toLowerCase();
    const target = TYPE_SYNONYMS[lower] ?? lower;
    return types.includes(target) ? target : null;
}

/**
 * The type a head branch names: its first `<word>/` or `<word>-` segment (`feat/…`,
 * `hotfix-123`). The branch is checked out precisely because it is that item of work,
 * so it has already stated the decision a header would have made.
 *
 * @param {string} branch
 * @param {string[]} types
 * @returns {string | null}
 */
function branchType(branch, types) {
    const word = String(branch ?? '').split(/[/-]/)[0];
    return word ? typeFor(word, types) : null;
}

/**
 * @param {string} subject
 * @returns {string}
 */
function repairSubjectCase(subject) {
    const match = /^(\S+)(.*)$/su.exec(subject);
    if (!match) return subject;
    const [, word, rest] = match;
    const first = [...word][0];
    // Same predicate as `check-pr-title-subject.mjs`'s `startsUpperCase`.
    if (first.toUpperCase() !== first || first.toLowerCase() === first) return subject;
    if (/^\p{Lu}\p{Ll}*[,;:]?$/u.test(word)) return `${first.toLowerCase()}${word.slice(first.length)}${rest}`;
    const trailing = /[,;:]$/.test(word) ? word.slice(-1) : '';
    const core = trailing ? word.slice(0, -1) : word;
    return `\`${core}\`${trailing}${rest}`;
}

/**
 * @param {string} title
 * @param {{ types?: string[], branch?: string }} [options]
 * @returns {string}
 */
export function repairTitle(title, { types = typeEnum(), branch = '' } = {}) {
    const collapsed = String(title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const header = LOOSE_HEADER.exec(collapsed);
    if (header) {
        const [, rawType, scope = '', bang = '', rawSubject] = header;
        const type = typeFor(rawType, types) ?? rawType;
        let subject = rawSubject.replace(/\.+$/, '').trimEnd();
        if (subject) subject = repairSubjectCase(subject);
        return `${type}${scope}${bang}: ${subject}`;
    }
    // No conventional header at all. The head branch often names the type — prepend
    // it; this is the branch stating the decision the form check would ask for.
    const type = branchType(branch, types);
    if (!type) return collapsed;
    const subject = collapsed.replace(/\.+$/, '').trimEnd();
    return `${type}: ${repairSubjectCase(subject)}`;
}

/** Shed the scope: it is the first thing a capped squash subject does not need. */
function dropScope(title) {
    const header = LOOSE_HEADER.exec(title);
    if (!header?.[2]) return title;
    const [, type, , bang = '', subject] = header;
    return `${type}${bang}: ${subject}`;
}

/**
 * Cut the subject at the last word boundary that still fits `max` characters. When
 * even the first word does not fit it is hard-cut instead — an empty subject would
 * fail `subject-empty`, a sliced one is at worst ugly.
 *
 * @param {string} title a conventional header (or unchanged, callers decide)
 * @param {number} max
 * @returns {string}
 */
function cutToFit(title, max) {
    const header = LOOSE_HEADER.exec(title);
    if (!header) return title;
    const [, type, scope = '', bang = '', subject] = header;
    const prefix = `${type}${scope}${bang}: `;
    const kept = [];
    let length = prefix.length;
    for (const word of subject.split(' ')) {
        const gap = kept.length === 0 ? 0 : 1;
        if (length + gap + word.length > max) break;
        kept.push(word);
        length += gap + word.length;
    }
    if (kept.length === 0) {
        kept.push(subject.slice(0, Math.max(1, max - prefix.length)));
    }
    return `${prefix}${kept.join(' ')}`.trimEnd();
}

/**
 * The whole PR text — the repairs are not independent: cutting the title to fit
 * `<title> (#N)` must put what it cut somewhere the checks still accept, the body.
 *
 * @param {{ title?: string, body?: string | null, number: string | number, branch?: string, types?: string[] }} pr
 * @returns {{ title: string, body: string, moved: string[] }} `moved` as in `repairBody`
 */
export function repairPr({ title, body, number, branch, types = typeEnum() }) {
    const originalTitle = String(title ?? '');
    const repairedTitle = repairTitle(originalTitle, { types, branch });
    const suffix = number ? ` (#${number})` : '';

    // The same arithmetic `check-pr-title-subject.mjs` applies: `<title> (#N)` must
    // fit 100 characters. Scope first, words only if that is not enough.
    const fits = (text) => text.length + suffix.length <= MAX_LINE_LENGTH;
    const withoutScope = fits(repairedTitle) ? repairedTitle : dropScope(repairedTitle);
    let fit = withoutScope;
    let wordsCut = false;
    if (!fits(fit)) {
        fit = cutToFit(fit, MAX_LINE_LENGTH - suffix.length);
        // A header-less title comes back unchanged; no cut, nothing moved to the body.
        wordsCut = fit !== withoutScope;
    }

    let nextBody = String(body ?? '');
    if (wordsCut) {
        // The PR still carries the full title; the commit only gets the cut. Keep the
        // cut words in history by prepending them to the body, wrapped like any prose.
        const paragraphLine = `Full title: ${originalTitle}`;
        const paragraph =
            paragraphLine.length <= MAX_LINE_LENGTH ? [paragraphLine] : (wrapLine(paragraphLine) ?? [paragraphLine]);
        nextBody = `${paragraph.join('\n')}\n\n${nextBody}`.trimEnd();
    }

    const { body: repairedBody, moved } = repairBody(nextBody);
    return { title: fit, body: repairedBody, moved };
}

/**
 * Greedy wrap that keeps a markdown prefix and never starts a line with a block opener.
 *
 * @param {string} line
 * @param {number} limit
 * @returns {string[] | null} null when the line cannot be wrapped under the limit
 */
export function wrapLine(line, limit = MAX_LINE_LENGTH) {
    const prefixMatch = /^(\s*(?:>\s?)*)((?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/.exec(line);
    const lead = prefixMatch[1];
    const marker = prefixMatch[2] ?? '';
    const firstPrefix = lead + marker;
    const nextPrefix = lead + ' '.repeat(marker.length);
    const words = line.slice(firstPrefix.length).split(/ +/).filter(Boolean);
    if (words.length < 2) return null;

    const lines = [];
    let current = [];
    let prefix = firstPrefix;
    const width = (parts) => prefix.length + parts.join(' ').length;
    for (const word of words) {
        if (current.length > 0 && width([...current, word]) > limit) {
            // A word like `-` or `1.` must not open the next line, or the wrap changes
            // what the markdown means; pull the word before it down with it.
            let carry = [word];
            while (BLOCK_OPENER.test(carry[0]) && current.length > 1) carry = [current.pop(), ...carry];
            if (BLOCK_OPENER.test(carry[0])) return null;
            lines.push(prefix + current.join(' '));
            prefix = nextPrefix;
            current = carry;
        } else {
            current.push(word);
        }
    }
    lines.push(prefix + current.join(' '));
    return lines.every((text) => text.length <= limit) ? lines : null;
}

/**
 * An over-long heading → bold prose: a wrapped line starting with `#` would open a
 * new (nested) heading, `**…**` keeps the emphasis with no block semantics.
 *
 * @param {string} line
 * @param {number} limit
 * @returns {string[] | null} null when the heading is one unbreakable word
 */
function headingToBold(line, limit) {
    const text = line.replace(/^\s*#{1,6}\s+/, '').trimEnd();
    const single = `**${text}**`;
    if (single.length <= limit) return [single];
    // The closing `**` rides on the last wrapped line, so the text itself is wrapped
    // two columns narrower than the limit.
    const wrapped = wrapLine(`**${text}`, limit - 2);
    if (!wrapped) return null;
    return [...wrapped.slice(0, -1), `${wrapped[wrapped.length - 1]}**`];
}

/**
 * Index one past the fenced block that starts at `i` — its closing fence included, EOF
 * when the fence never closes (a fence is a fence to the check either way).
 *
 * @param {string[]} lines
 * @param {number} i
 * @returns {number}
 */
function fenceEnd(lines, i) {
    const fence = FENCE_START.exec(lines[i]);
    let end = i + 1;
    while (end < lines.length && !lines[end].trimStart().startsWith(fence[1])) end++;
    return end + 1;
}

/**
 * @param {string[]} lines
 * @returns {{ kind: 'fence' | 'table' | 'line', lines: string[] }[]}
 */
function blocksOf(lines) {
    const blocks = [];
    for (let i = 0; i < lines.length;) {
        if (FENCE_START.test(lines[i])) {
            const end = fenceEnd(lines, i);
            blocks.push({ kind: 'fence', lines: lines.slice(i, end) });
            i = end;
        } else if (/^\s*\|/.test(lines[i])) {
            let end = i;
            while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++;
            blocks.push({ kind: 'table', lines: lines.slice(i, end + 1) });
            i = end + 1;
        } else {
            blocks.push({ kind: 'line', lines: [lines[i]] });
            i++;
        }
    }
    return blocks;
}

/**
 * @param {string} prose prose without fences
 * @returns {string}
 */
function repairProseChains(prose) {
    const spans = [...prose.matchAll(INLINE_CODE)].map((m) => [m.index, m.index + m[0].length]);
    const overSpan = (start, end) => spans.some(([s, e]) => start < e && end > s);
    const chains = new RegExp(
        String.raw`\b(${CLOSING_KEYWORDS.join('|')})(:?)\s+(${CLOSING_REF})((?:${CLOSING_SEPARATOR}${CLOSING_REF})+)`,
        'gi',
    );
    return prose.replace(chains, (whole, keyword, colon, first, tail, offset) => {
        // Inline code is exempt in the check (`blankCode` blanks spans); leave one be.
        if (overSpan(offset, offset + whole.length)) return whole;
        const dangling = tail.match(TAIL_CLOSING_REF) ?? [];
        if (dangling.length === 0) return whole;
        // The original keyword spelling for the first reference, lower-case for the
        // rest: `Closes #1, closes #2, closes #3`.
        return dangling.reduce(
            (text, ref) => `${text}, ${keyword.toLowerCase()} ${ref}`,
            `${keyword}${colon} ${first}`,
        );
    });
}

/**
 * Repeats a closing keyword before every reference its chain leaves keyword-less. A
 * chain may wrap across lines (`Closes #1,\n#2`), so prose runs are repaired whole;
 * fenced blocks are code to the check and stay verbatim.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function repairClosingKeywordChains(lines) {
    const out = [];
    for (let i = 0; i < lines.length;) {
        if (FENCE_START.test(lines[i])) {
            const end = fenceEnd(lines, i);
            out.push(...lines.slice(i, end));
            i = end;
        } else {
            let end = i + 1;
            while (end < lines.length && !FENCE_START.test(lines[end])) end++;
            out.push(...repairProseChains(lines.slice(i, end).join('\n')).split('\n'));
            i = end;
        }
    }
    return out;
}

/**
 * @param {string | null | undefined} body
 * @param {{ limit?: number }} [options]
 * @returns {{ body: string, moved: string[] }} `moved` are the blocks for the PR comment
 */
export function repairBody(body, { limit = MAX_LINE_LENGTH } = {}) {
    const original = String(body ?? '');
    const lines = original
        .replaceAll('\r\n', '\n')
        .split('\n')
        .filter((line) => !SESSION_LINK.test(line) && !CO_AUTHOR_CLAUDE.test(line.trim()));
    const keyworded = repairClosingKeywordChains(lines);

    const out = [];
    const moved = [];
    for (const block of blocksOf(keyworded)) {
        const tooLong = block.lines.some((line) => line.length > limit);
        if (!tooLong) {
            out.push(...block.lines);
        } else if (block.kind === 'line') {
            const isHeading = /^\s*#{1,6}\s/.test(block.lines[0]);
            const wrapped = isHeading ? headingToBold(block.lines[0], limit) : wrapLine(block.lines[0], limit);
            if (wrapped) {
                out.push(...wrapped);
            } else if (isHeading) {
                // A heading that is one unbreakable word has nothing to shorten; the
                // check keeps naming it rather than this putting a guess in history.
                out.push(block.lines[0]);
            } else {
                // A prose line wrapLine cannot fit (a long URL) has nothing left to
                // shorten; move it whole to the comment, like a table or a fence.
                moved.push(block.lines[0]);
                out.push('_A long line moved to a PR comment: it does not fit the commit body._');
            }
        } else {
            moved.push(block.lines.join('\n'));
            const what = block.kind === 'table' ? 'A table' : 'A code block';
            out.push(`_${what} moved to a PR comment: its lines do not fit the commit body._`);
        }
    }

    const repaired = out.join('\n');
    // Untouched text keeps its own line endings, so a body that needed nothing compares
    // equal to the original and no edit is made.
    if (repaired === original.replaceAll('\r\n', '\n')) return { body: original, moved };
    return { body: repaired, moved };
}

function gh(args, input) {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

function setOutput(name, value) {
    const file = process.env.GITHUB_OUTPUT;
    if (!file) return;
    const delimiter = `EOF_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function main() {
    const { REPO, PR_NUMBER, HEAD_REF } = process.env;
    if (!REPO || !PR_NUMBER) {
        console.error('::error::REPO and PR_NUMBER are required — this runs in a pull_request job.');
        process.exit(1);
    }

    // The CURRENT text, not the event's: the event may be several edits old, and writing a
    // repair of stale text back would undo whatever was edited since.
    const pr = JSON.parse(gh(['api', `repos/${REPO}/pulls/${PR_NUMBER}`, '--jq', '{title: .title, body: .body}']));
    const { title, body, moved } = repairPr({ title: pr.title, body: pr.body, number: PR_NUMBER, branch: HEAD_REF });
    const titleChanged = title !== pr.title;
    const bodyChanged = body !== String(pr.body ?? '');

    if (titleChanged || bodyChanged) {
        try {
            if (moved.length > 0) {
                const comment =
                    'Moved out of the PR description by `commitlint.yml`: the description becomes the ' +
                    `squash commit body, where no line may exceed ${MAX_LINE_LENGTH} characters.\n\n` +
                    moved.join('\n\n');
                gh(
                    ['api', `repos/${REPO}/issues/${PR_NUMBER}/comments`, '--input', '-'],
                    JSON.stringify({ body: comment }),
                );
            }
            gh(
                ['api', '-X', 'PATCH', `repos/${REPO}/pulls/${PR_NUMBER}`, '--input', '-'],
                JSON.stringify({ title, body }),
            );
        } catch {
            // A fork PR's token is read-only. Hand nothing on, so the checks judge the text
            // the event delivered and report what is wrong with it.
            console.log('::notice::could not edit the PR (read-only token on a fork?). Nothing repaired.');
            return;
        }
        if (titleChanged) console.log(`::notice::PR title repaired: "${pr.title}" → "${title}"`);
        if (bodyChanged)
            console.log(
                `::notice::PR body repaired${moved.length ? `, ${moved.length} block(s) moved to a comment` : ''}.`,
            );
    } else {
        console.log('repair-pr-text: nothing to repair.');
    }

    setOutput('title', title);
    setOutput('body', body);
    setOutput('repaired', 'true');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
