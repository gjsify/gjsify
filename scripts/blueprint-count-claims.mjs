// Where a Blueprint corpus count is STATED — one reading, for every gate that needs it.
//
// WHY THIS IS ITS OWN MODULE. `check-blueprint-corpus-counts.mjs` sweeps the tree and
// `check-blueprint-census.mjs` refuses a count stated outside ADR 0053's emitted block. They
// used to carry a vocabulary each, and the seam between them was a hole: a claim wrapped
// across two lines, or spelled as `negative cases`, passed BOTH — the first because it hands
// that ADR over, the second because its own matcher was line-at-a-time with a shorter noun
// list. Two vocabularies over one file is the defect, not either regex, so there is one
// vocabulary and both gates read through it.
//
// WHAT A CLAIM LOOKS LIKE. A number beside the thing it counts, in EITHER order: a count of
// rule files and "Rule files:" followed by that count are the same sentence, and a markdown
// table writes the second one as often as the first. An earlier version matched only
// number-first while its header said "a number beside the thing it counts", which reads both
// ways — four payloads walked through the difference between what it said and what it did.
//
// TWO NOUN TIERS. A PLAIN spelling can only be this corpus — "rule files", "reality probes",
// "corpus files", "refused `.blp`", "`.ui` goldens", "negative cases" — and is read anywhere.
// A LOOSE spelling ("rules", "probes", "goldens", "fixtures", "refusals") names a dozen other
// things in this repository and is read only inside a REGION that is about this corpus: the
// package that is the corpus, a file whose path names it, or a markdown heading block that
// names it. The boundary is measured, not preferred — reading the loose set over whole files
// that merely mention the corpus turns `status/open-todos.md` into sixty findings that are e2e
// fixtures and lint rules, and a gate nobody reads twice gates nothing.

import { readFileSync } from 'node:fs';

const ONES = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Spelled-out numbers count as much as digits. ADR 0053's gate found that the number a reader
 * believes is as often written out as typed, and `corpus/manifest.mjs` states the probe count
 * four times without ever using a digit — a sweep for `\d+` reports that file clean.
 */
const NUMBER_WORD = [
    ...ONES,
    ...Object.keys(TENS).flatMap((ten) => [...ONES.slice(1, 10).map((one) => `${ten}[- ]${one}`), ten]),
].join('|');

/**
 * A digit run, a thousands separator, or a spelled-out number — never half of a range
 * (`rule files 32-35` names files, not a count) and never the tail of an identifier, which is
 * what `the MSYS2 probe` reads as otherwise.
 */
const NUMBER = String.raw`(?<![A-Za-z0-9_–-])(?:${NUMBER_WORD}|\d[\d,\u202f]*)(?![A-Za-z0-9_–-])`;

export const readNumber = (text) => {
    const word = text
        .toLowerCase()
        .replace(/[,\u202f]/g, '')
        .replace(/\s+/g, '-');
    if (/^\d+$/.test(word)) return Number(word);
    const [tens, ones] = word.split('-');
    if (tens in TENS) return TENS[tens] + (ones ? ONES.indexOf(ones) : 0);
    return ONES.indexOf(word);
};

/** A backtick, written as an escape so this file's own nouns are not mistaken for template holes. */
const TICK = String.raw`\x60?`;

/**
 * Between a number and its noun may stand whitespace at any indent, one blank line, ONE
 * markdown table pipe, emphasis marks, a backtick — never a word. One pipe and not two, because
 * `line < 1 || refusal.line` is code and a table cell is not.
 */
const GAP = String.raw`[\s\x60*_]{0,8}\|?[\s\x60*_]{0,8}`;

/**
 * Between a noun and a number that FOLLOWS it there must be an explicit CONNECTOR — a colon, a
 * table pipe, an equals sign, or one of the few words that link a thing to its total. A bare
 * space does not link: `a rule file that probes one case` and `a construct nothing probes is
 * one` are English, not claims, and allowing whitespace alone reported both.
 */
const LINK_WORD = String.raw`(?:\b(?:now|today|currently|already|still|altogether)\b\s+)?\b(?:number|numbers|numbered|total|totals|totalling|count|counts|counted|stands?|sits?|comes?|amounts?|reach(?:es)?|runs?)\b(?:\s+(?:at|to))?`;
const PAD = String.raw`[\s\x60*_.,—-]{0,6}`;
const LINK = String.raw`${PAD}(?::|\||=|${LINK_WORD})${PAD}`;

/**
 * The four counts and the spellings prose uses for each. `measure` is deliberately NOT here:
 * this module says where a claim is, and the gate that owns the tree says what the answer is.
 */
export const CATEGORIES = {
    rules: {
        label: 'rule file',
        plain: String.raw`(?:blueprint\s+|written\s+|corpus\s+)*rule\s+(?:files?|goldens?|cases?)|(?:blueprint|written|corpus)\s+rules?`,
        loose: String.raw`rules?`,
    },
    probes: {
        label: 'reality probe',
        plain: String.raw`reality[-\s]probes?|reality-probe\s+goldens?|(?:real|shipped)\s+${TICK}\.blp${TICK}`,
        loose: String.raw`probes?|real(?:ity)?\s+files?|${TICK}\.blp${TICK}\s+files?`,
    },
    goldens: {
        label: 'golden',
        plain: String.raw`corpus\s+(?:files?|goldens?)|${TICK}\.ui${TICK}\s+goldens?`,
        loose: String.raw`goldens?|fixtures?|${TICK}\.ui${TICK}\s+files?`,
    },
    refusals: {
        label: 'refusal',
        plain: String.raw`refused\s+(?:${TICK}\.blp${TICK}|files?)(?:\s+files?)?|refusal\s+files?|negative\s+cases?`,
        loose: String.raw`refusals?`,
    },
};

/**
 * A file whose every line is about this corpus: the package that holds it, or a path that names
 * it. `docs/blueprint-corpus-size.md` is about the corpus whatever it happens to say inside.
 */
export const CORPUS_OWN_FILES = /^packages\/infra\/blueprint\/|blueprint[\s\-_/]*corpus|corpus[\s\-_/]*blueprint/i;

/** What makes a REGION about this corpus: it names the harness, the directory or the ledger. */
export const SUBJECT =
    /packages\/infra\/blueprint|check-blueprint-corpus|SHADOW_DIVERGENCES|corpus\/(?:rules|refused|real)\b|blueprint[\s\-_/]*corpus|corpus[\s\-_/]*blueprint/i;

/**
 * The byte ranges in which the LOOSE spellings may be read.
 *
 * A whole file when the file itself is the corpus's. Otherwise, for markdown, the heading
 * blocks that name it — which is what lets `status/open-todos.md` be held to all four counts
 * with the full vocabulary while its other seven thousand lines are read for the plain
 * spellings only. That file went stale TWICE and was outside the loose set entirely until the
 * regions existed; its counts survived on one hand-rewritten sentence, which is the opposite of
 * what a gate is for.
 *
 * For anything else, no loose region: a `.ts` that mentions the corpus in one comment is not a
 * document about it, and reading `rules` there reports the lint registry.
 */
export function looseRegions(file, text) {
    if (CORPUS_OWN_FILES.test(file)) return [[0, text.length]];
    if (!/\.mdx?$/.test(file)) return [];

    const regions = [];
    const heading = /^#{1,6} .*$/gm;
    const starts = [0, ...[...text.matchAll(heading)].map((match) => match.index)];
    for (let i = 0; i < starts.length; i += 1) {
        const end = i + 1 < starts.length ? starts[i + 1] : text.length;
        if (SUBJECT.test(text.slice(starts[i], end))) regions.push([starts[i], end]);
    }
    return regions;
}

/**
 * Every claim in a text, in both orders, scanned ACROSS line ends and reported against the line
 * the NUMBER falls on. This repo hard-wraps at about ninety columns, which splits a claim as
 * often as not: the sentence this whole effort exists for says "and the 19" at the end of one
 * line and its noun at the start of the next, and a line-at-a-time sweep reads that file as
 * stating no refusal count at all.
 */
export function findClaims(text, regions = []) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (index) => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= index) low = mid;
            else high = mid - 1;
        }
        return low;
    };
    const inRegion = (index) => regions.some(([from, to]) => index >= from && index < to);

    const found = [];
    for (const [key, category] of Object.entries(CATEGORIES)) {
        for (const tier of ['plain', 'loose']) {
            const noun = category[tier];
            const patterns = [
                new RegExp(String.raw`(${NUMBER})${GAP}(?:${noun})\b`, 'gi'),
                new RegExp(String.raw`\b(?:${noun})${LINK}(${NUMBER})`, 'gi'),
            ];
            for (const re of patterns) {
                for (const match of text.matchAll(re)) {
                    if (tier === 'loose' && !inRegion(match.index)) continue;
                    const at = match.index + match[0].indexOf(match[1]);
                    found.push({
                        key,
                        tier,
                        stated: readNumber(match[1]),
                        text: match[0].replace(/\s+/g, ' ').trim(),
                        index: match.index,
                        line: lineOf(at),
                    });
                }
            }
        }
    }
    // One spelling can match twice — as a plain `rule files` and again as a loose `rules` — and
    // a doubled report reads like two defects. Keep the first at each number.
    const seen = new Set();
    return found
        .sort((a, b) => a.index - b.index || b.text.length - a.text.length)
        .filter((claim) => {
            const id = `${claim.key}\u0000${claim.line}\u0000${claim.stated}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
}

/**
 * A tracked file's text, or null when it is not text at all. Binary is decided by a NUL byte in
 * the bytes, with no extension list in front of it — an allow-list of file types is the same
 * shape as an allow-list of nouns and failed the same way, and the deny-list that replaced it
 * was wrong about `.mpd`, sixteen tracked files that hold no NUL and did carry a count.
 */
export function readText(path) {
    let bytes;
    try {
        bytes = readFileSync(path);
    } catch (error) {
        // A tracked path that is not a readable file: a symlink to a directory, or one whose
        // target is gone. Nothing to scan, and not a gate's business to fail on.
        if (['EISDIR', 'ELOOP', 'ENOENT', 'EACCES'].includes(error.code)) return null;
        throw error;
    }
    if (bytes.includes(0)) return null;
    return bytes.toString('utf8');
}
