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
// enum (choosing one is a decision about the CHANGELOG), a subject too long for
// `<title> (#N)` (shortening means choosing words), a heading or a single word over the
// line limit, and a closing keyword list. A repair that guesses is worse than a red check.
//
// WHAT IT CHANGES, title:
//   - whitespace runs, `Feat :`-style type spelling, a trailing full stop;
//   - an upper-case first word of the subject (#1275, #1590): a plain capitalised word
//     is lower-cased, anything else (`GJS`, `TypeScript`) is quoted in backticks, which
//     commitlint strips before judging `subject-case`.
// body:
//   - drops `claude.ai/code/session_…` lines and `Co-Authored-By: Claude` trailers
//     (#1699 — see `check-pr-body-lines.mjs`);
//   - re-wraps a prose line over the limit at word boundaries, keeping list and quote
//     prefixes, never starting a continuation with something markdown would read as a
//     new block;
//   - moves a table or fenced block holding a line over the limit into a PR COMMENT,
//     which is not part of the commit, and leaves a pointer in its place. That is the
//     fix `check-pr-body-lines.mjs` has always told people to make by hand.
//
// RUNS WITH A WRITE TOKEN AND NO HEAD CODE: the workflow checks this file out from
// `base.sha`, and the PR text reaches it as data through the API, never as program text.
// An edit made with `GITHUB_TOKEN` starts no new run, so the workflow lints the text
// this script hands on through `$GITHUB_OUTPUT` instead of waiting for an `edited` event.
//
// Usage (in a pull_request job):
//   GH_TOKEN=… REPO=owner/name PR_NUMBER=… node scripts/repair-pr-text.mjs

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

function typeEnum() {
    const rule = require('../commitlint.config.cjs').rules?.['type-enum'];
    return Array.isArray(rule) && Array.isArray(rule[2]) ? rule[2] : [];
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
 * @param {{ types?: string[] }} [options]
 * @returns {string}
 */
export function repairTitle(title, { types = typeEnum() } = {}) {
    const collapsed = String(title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const header = LOOSE_HEADER.exec(collapsed);
    if (!header) return collapsed;
    const [, rawType, scope = '', bang = '', rawSubject] = header;
    const type = types.includes(rawType.toLowerCase()) ? rawType.toLowerCase() : rawType;
    let subject = rawSubject.replace(/\.+$/, '').trimEnd();
    if (subject) subject = repairSubjectCase(subject);
    return `${type}${scope}${bang}: ${subject}`;
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
 * @param {string[]} lines
 * @returns {{ kind: 'fence' | 'table' | 'line', lines: string[] }[]}
 */
function blocksOf(lines) {
    const blocks = [];
    for (let i = 0; i < lines.length;) {
        const fence = /^\s*(```|~~~)/.exec(lines[i]);
        if (fence) {
            let end = i + 1;
            while (end < lines.length && !lines[end].trimStart().startsWith(fence[1])) end++;
            blocks.push({ kind: 'fence', lines: lines.slice(i, end + 1) });
            i = end + 1;
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

    const out = [];
    const moved = [];
    for (const block of blocksOf(lines)) {
        const tooLong = block.lines.some((line) => line.length > limit);
        if (!tooLong) {
            out.push(...block.lines);
        } else if (block.kind === 'line') {
            const isHeading = /^\s*#{1,6}\s/.test(block.lines[0]);
            out.push(...((!isHeading && wrapLine(block.lines[0], limit)) || block.lines));
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
    const { REPO, PR_NUMBER } = process.env;
    if (!REPO || !PR_NUMBER) {
        console.error('::error::REPO and PR_NUMBER are required — this runs in a pull_request job.');
        process.exit(1);
    }

    // The CURRENT text, not the event's: the event may be several edits old, and writing a
    // repair of stale text back would undo whatever was edited since.
    const pr = JSON.parse(gh(['api', `repos/${REPO}/pulls/${PR_NUMBER}`, '--jq', '{title: .title, body: .body}']));
    const title = repairTitle(pr.title);
    const { body, moved } = repairBody(pr.body);
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
