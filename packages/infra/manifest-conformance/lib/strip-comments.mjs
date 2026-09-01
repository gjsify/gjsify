// SPDX-License-Identifier: MIT
// The ONE comment stripper every whole-file check reads through.
//
// THE INCIDENT
//
// Eleven readers, eleven implementations. Nine were the same two regexes — remove
// `/* … */`, remove `//…` — and neither regex can tell a comment from a string, so the
// ORDER of the two decided which half of the tree went invisible. Block-first let a line
// comment ending in `/*` — `@girs/*`, `packages/*`, `src/*` — pair with the next `*/`
// below, usually the following JSDoc. Line-first let a block comment CONTAINING a `//`
// lose its terminator and swallow the declaration under it, which is a live shape:
// `npm-registry/src/types.ts` documents its field as keyed by a `//host/path/:` prefix.
// Neither sees a glob pattern in a string: `globSync('**/*.ts')` opens a fake block
// comment either way round, and the two orders blank different halves of the file.
//
// Measured against this scanner over the 3642 tracked JS/TS sources: block-first hid 7780
// code lines in 226 files, line-first hid 3503 in 104. Swapping the order halves a class
// it cannot close — and the closed version already existed in this repository.
// `check-adapter-import-direction.mjs` rewrote its stripper as a stateful scanner after a
// regex read `const re = /[/*]/;` as an open block comment and reported a live violation
// as exit 0. This module is that scanner, lifted so the other ten inherit it: measured
// the same way it hides 0 code lines and keeps 0 comment lines.
//
// Strings and regex bodies are KEPT — a quoted widget name, a `gi://` specifier or a glob
// pattern is usually the thing being looked for. Line boundaries are kept too, so a
// reported line number still points at the source line it came from.

/** A character that ENDS an expression, so a `/` after it is division and never a regex. */
const ENDS_EXPRESSION = /[\w$)\]'"`<>]/;

/** Identifier characters, for the keyword lookback below. */
const IDENTIFIER = /[\w$]/;

/**
 * Keywords a `/` may FOLLOW and still open a regex. The previous character alone cannot tell
 * `return /x/` from `total / x`: both end in an identifier character.
 */
const REGEX_AFTER_KEYWORD = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
]);

/**
 * The index just past a regex literal starting at `start`, or -1 if it does not close on its
 * line — in which case the `/` was division, or JSX, and reading it as a regex is what would
 * cost the rest of the line. Character classes are a region where `/` is literal, which is the
 * whole of `/[/*]/`; a backslash escapes the next character.
 */
function regexLiteralEnd(source, start) {
    let i = start + 1;
    let inClass = false;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '\n') return -1;
        if (ch === '\\') {
            if (source[i + 1] === undefined || source[i + 1] === '\n') return -1;
            i += 2;
            continue;
        }
        if (inClass) {
            if (ch === ']') inClass = false;
        } else if (ch === '[') {
            inClass = true;
        } else if (ch === '/') {
            return i + 1;
        }
        i += 1;
    }
    return -1;
}

/**
 * Strip comments, keeping every other byte and every line boundary.
 *
 * Stateful because the four shapes a line-regex cannot decide are the ones that were wrong:
 * a `//` inside a string literal is not a comment, a `/* … *\/` block runs across lines whether
 * or not the continuation lines are decorated, a `${…}` inside a template literal is code
 * again, and a `/` may open a REGEX LITERAL. Strings are KEPT — a quoted widget name is the
 * violation being looked for — and so is a regex body.
 *
 * The note that used to stand here called the untracked regex "a false negative on a line".
 * It was measured, and it costs the FILE. `const re = /[/*]/;` is valid JS; read as code, its
 * `/*` opened block-comment state that ran to EOF, so the `'GtkBox'` and the `.append()` under
 * it vanished and the run printed "1 adapter(s) carry no widget knowledge", exit 0 — a
 * violation the PRE-rewrite script caught, lost as GREEN. The mirror image was loud rather than
 * dangerous: `/'/` left string state open, after which `//` stopped being a comment and prose
 * was reported as a placement method. `//` costs a line; `/*` costs the file.
 *
 * So a `/` opens a regex only when the previous significant character cannot END an expression
 * (or the word before it is a keyword like `return`) AND the literal CLOSES on its line — the
 * second half is not a heuristic, ECMAScript forbids a LineTerminator in a
 * RegularExpressionLiteral. Together they bound a miscall to the rest of ONE line.
 *
 * Still lexical, not a parser: `a < /re/.test(b)` reads as division, because `<` and `>` count
 * as ending an expression. That is what keeps a `.tsx` file's `</div>` out of regex state.
 */
export function stripCommentLines(source) {
    const lines = [];
    let current = '';
    const endLine = () => {
        lines.push(current);
        current = '';
    };

    /** `code` (top level, or a `${…}` expression) | `single` | `double` | `template`. */
    const stack = ['code'];
    /** Brace depth per `code` frame, so a `}` knows whether it closes a `${…}`. */
    const depth = [0];
    /** Whether a `/` here would open a regex, and the identifier before it for the keyword case. */
    let regexAllowed = true;
    let word = '';

    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        const top = stack[stack.length - 1];

        // Line accounting is state-independent: every reported line number depends on it.
        if (ch === '\n') {
            endLine();
            i += 1;
            continue;
        }

        if (top === 'code') {
            if (ch === '/' && next === '/') {
                while (i < source.length && source[i] !== '\n') i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                i += 2;
                while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
                    if (source[i] === '\n') endLine();
                    i += 1;
                }
                i += 2;
                continue;
            }
            // A regex literal, kept whole. Tested only HERE — after `//` and `/*`, exactly the
            // order JS lexes them in — so `/[/*]/` is a regex and `/* … */` is still a comment.
            if (ch === '/' && (regexAllowed || REGEX_AFTER_KEYWORD.has(word))) {
                const end = regexLiteralEnd(source, i);
                if (end !== -1) {
                    current += source.slice(i, end);
                    regexAllowed = false;
                    word = '';
                    i = end;
                    continue;
                }
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                stack.push(ch === "'" ? 'single' : ch === '"' ? 'double' : 'template');
            } else if (ch === '{') {
                depth[depth.length - 1] += 1;
            } else if (ch === '}') {
                if (depth[depth.length - 1] === 0 && stack.length > 1) {
                    depth.pop();
                    stack.pop();
                } else if (depth[depth.length - 1] > 0) {
                    depth[depth.length - 1] -= 1;
                }
            }
            if (!/\s/.test(ch)) {
                word = IDENTIFIER.test(ch) ? word + ch : '';
                regexAllowed = !ENDS_EXPRESSION.test(ch);
            }
            current += ch;
            i += 1;
            continue;
        }

        // Inside a string or a template literal.
        if (ch === '\\') {
            current += ch;
            if (next === '\n') {
                endLine();
            } else if (next !== undefined) {
                current += next;
            }
            i += 2;
            continue;
        }
        if (
            (top === 'single' && ch === "'") ||
            (top === 'double' && ch === '"') ||
            (top === 'template' && ch === '`')
        ) {
            stack.pop();
            regexAllowed = false;
            word = '';
            current += ch;
            i += 1;
            continue;
        }
        if (top === 'template' && ch === '$' && next === '{') {
            stack.push('code');
            depth.push(0);
            regexAllowed = true;
            word = '';
            current += '${';
            i += 2;
            continue;
        }
        current += ch;
        i += 1;
    }
    endLine();
    return lines;
}

/** The same text with comment bodies removed, as one string. */
export function stripComments(source) {
    return stripCommentLines(source).join('\n');
}

// ------------------------------------------------------------------ the self-test
//
// One vector per shape a two-regex stripper gets wrong, each measured in this tree. It runs
// on IMPORT, so every consumer inherits the proof instead of trusting that someone ran it.
const VECTORS = [
    // The two ORDERING shapes. Neither order gets both: block-first loses the first,
    // line-first loses the second, and each blanks everything down to the next `*/`.
    ['// types live under `@girs/*`\nconst a = 1;\n/** doc */\nconst b = 2;', '\nconst a = 1;\n\nconst b = 2;'],
    // The trailing `/** … */` is load-bearing in both: with no later `*/` the lazy block
    // regex finds no match and neither bug reproduces, so a vector without it is green
    // under every ordering and proves nothing.
    ['/** keyed by `//host/path/:` */\nconst c = 3;\n/** doc */\nconst d = 4;', '\nconst c = 3;\n\nconst d = 4;'],
    // A string is not a comment, in either delimiter.
    ["const u = 'https://x'; f();", "const u = 'https://x'; f();"],
    ["const g = '**/*.ts';\nconst h = 4;", "const g = '**/*.ts';\nconst h = 4;"],
    ["import Gtk from 'gi://Gtk?version=4.0';", "import Gtk from 'gi://Gtk?version=4.0';"],
    // A regex literal is not a comment either — `/[/*]/` read as code opened block state
    // that ran to EOF, and `/\'/` left string state open. Both were measured as exit 0.
    ['const re = /[/*]/;\nconst i = 5;', 'const re = /[/*]/;\nconst i = 5;'],
    ["const q = /'/;\nconst j = 6; // gone", "const q = /'/;\nconst j = 6; "],
    // A `${…}` hole is code again, so a comment inside one is still a comment.
    ['const t = `a${b /* x */}c`;', 'const t = `a${b }c`;'],
    // Line boundaries survive, so a reported line number still points at its source line.
    ['/* one\n   two */\nconst k = 7;', '\n\nconst k = 7;'],
];

const failures = VECTORS.filter(([source, want]) => stripComments(source) !== want).map(
    ([source, want]) =>
        `  ${JSON.stringify(source)}\n    wanted ${JSON.stringify(want)}\n    got    ${JSON.stringify(stripComments(source))}`,
);
if (failures.length > 0) {
    throw new Error(
        `scripts/strip-comments.mjs: SELF-TEST failed — every check reading through it is unsound:\n${failures.join('\n')}`,
    );
}
