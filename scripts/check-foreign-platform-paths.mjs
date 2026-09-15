#!/usr/bin/env node
// A Linux system path must not be written into a macOS or Windows artifact.
//
// THE GAP THIS CLOSES, measured, twice, in code that had been green for months:
//
//   packages/infra/cli/src/utils/ship/launcher.ts — the `.app` launcher
//     XDG_DATA_DIRS="$contents/Resources/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
//
//   packages/framework/adwaita-app/src/locale-dir.ts — on EVERY platform
//     export const SYSTEM_LOCALE_DIR = '/usr/share/locale';
//
// Both are the XDG/FHS defaults for a Linux system, and both reached a platform that has no
// such layout. `/usr/local/share` is Intel Homebrew's prefix and does not exist on Apple
// Silicon; `/usr/share` on macOS is Apple's, with no `glib-2.0/schemas` and no
// `icons/hicolor`; on Windows neither exists at all.
//
// WHY A GATE RATHER THAN TWO FIXES. The failure mode is the expensive one: the path RESOLVES.
// `/usr/share/locale` is a real directory on macOS, so `bindtextdomain` succeeded, no lookup
// threw, and the app was simply untranslated — indistinguishable from an app with no
// catalogue. Nothing in a test suite, a type, or a Linux CI run can see that. The two defects
// were also written years apart by different hands, which is what makes them a CLASS.
//
// THE RULE, in three scopes, because "is this string foreign?" is only answerable per scope:
//
//   1. WHOLE-FILE. A module whose only product is a `.app`, a `.dmg`, an `.ico` or an `.msi`
//      may not contain a Linux system path at all. `FOREIGN_ONLY_FILES` names them, and each
//      one must EXIST — a renamed file that silently scanned nothing would report agreement.
//
//   2. FILE MINUS ONE FUNCTION. `launcher.ts` renders all three forms side by side, so the
//      file cannot be judged whole: `renderPrefixLauncher` is Linux and the default there is
//      correct, load-bearing, and must stay. So EVERYTHING ELSE in that file is scanned and
//      only that one renderer is cut out. Scanning the two foreign renderers instead was the
//      first cut of this rule and it left the file's shared helpers — `prependVar`,
//      `execLine`, `stagedFontDir`, every future one — outside every scope, which is the
//      hole an opt-in list always has. Opt-out is the safe direction: a new helper is
//      covered the moment it is written, and the two foreign renderers are still asserted to
//      EXIST so a rename is loud rather than quiet.
//
//   3. FRAMEWORK RUNTIME. `packages/framework/*/src` ships to all three OSes. A Linux system
//      path there is allowed only where the module has visibly DECIDED what the other two get:
//      `darwin` or `win32` must appear in CODE within `PLATFORM_WINDOW` lines of the literal.
//      Locality rather than "somewhere in the file", because a 900-line module mentioning
//      `darwin` once does not make a constant 400 lines away platform-aware.
//
// WHAT IT DOES NOT CATCH — the list is written here rather than left to be discovered, and
// `tests/e2e/foreign-platform-paths-gate` drives every line of it through a fixture so the
// claims stay measured:
//
//   · A path ASSEMBLED rather than written: `'/usr' + '/share'`, `join('/usr', 'share')`,
//     `` `${prefix}/share` ``. Invisible to any textual gate, and no fix is attempted.
//   · A literal defined in one file and imported into a foreign one. Scope 1 reads a module's
//     own text; it does not follow imports.
//   · `FOREIGN_ONLY_FILES` is a HAND-MAINTAINED list. A file on it that disappears fails
//     loudly, but a NEW macOS/Windows-only module — `nsis.ts`, `notarize.ts` — is simply never
//     scanned, and nothing says so. Whoever adds one adds it here.
//   · Scope 3 reaches `packages/framework/*/src` only. `packages/node/*`, `packages/gjs/*`
//     and `packages/web/*` ship to all three OSes too and are not covered; `@gjsify/os` and
//     `@gjsify/fs` carry Linux paths there by design and would need per-package judgement.
//   · Scope 3 checks that a platform decision sits NEXT TO the literal, not that the decision
//     is CORRECT. Reintroducing an unconditional return in a module that still names `darwin`
//     elsewhere stays green here — `locale-dir.spec.ts` is what holds that line.
//   · A file or directory whose own path says `linux` is exempt from scope 3 entirely.
//
// COMMENTS ARE EXEMPT, and have to be: this tree explains a rule by quoting the path it
// forbids, including in this header. A line whose first non-space characters are `//`, `*`,
// `/*` or `*/` is skipped, and on the lines that remain the token must sit inside quotes —
// a bare mention in trailing prose is not a string being emitted.
//
// TEMPLATE LITERALS ARE TRACKED ACROSS LINES, and that is not a refinement — it is the
// difference between this gate working and this gate being decorative. `launcher.ts` emits a
// SHELL SCRIPT, and the idiomatic way to write one in TypeScript is a multi-line template
// literal. A quote-parity test that looks only at the current line sees no quote character on
// the inner lines of one, so the ORIGINAL defect this gate exists for —
// `XDG_DATA_DIRS=…:/usr/local/share:/usr/share` — passes green the moment the same renderer is
// rewritten in the shape it most wants to be written in. Measured: it did. So backtick state
// is carried line to line, every line inside an open template counts as emitted text, and a
// file whose template state does not close by EOF FAILS — a desynced scanner is a scanner
// reporting agreement about something it stopped parsing, which is this family's oldest bug.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `--root <dir>` so the gate can be aimed at a fixture tree or at another checkout, the same
// knob `check-ship-format-vocabulary.mjs` and `check-ci-image-packages.mjs` take. A checker
// with no way to be pointed somewhere else is a checker with no test.
const rootFlag = process.argv.indexOf('--root');
if (rootFlag !== -1 && process.argv[rootFlag + 1] === undefined) {
    // Falling back to the real repo root would answer a question about ANOTHER tree, in green.
    console.error('  ✗ --root was given with no directory after it.');
    process.exit(2);
}
const ROOT = rootFlag !== -1 ? process.argv[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The paths a Linux system defines and neither foreign platform does.
 *
 * `/etc/` and `/usr/lib` carry the trailing shape they are always written with, so that
 * `/etc/` does not fire on the word "fetch" and `/usr/lib` still catches `/usr/lib64`.
 */
const LINUX_SYSTEM_PATHS = ['/usr/local/share', '/usr/share', '/usr/lib', '/etc/'];

/** Modules whose every output is a macOS or Windows artifact. Scope 1. */
const FOREIGN_ONLY_FILES = [
    'packages/infra/cli/src/utils/ship/plist.ts',
    'packages/infra/cli/src/utils/ship/dmg.ts',
    'packages/infra/cli/src/utils/ship/icns.ts',
    'packages/infra/cli/src/utils/ship/ico.ts',
    'packages/infra/cli/src/utils/ship/msi.ts',
    'packages/infra/cli/src/utils/ship/pe-launcher.ts',
];

/**
 * Scope 2. The ONE section of `launcher.ts` a Linux system path belongs in, and the two
 * renderers whose continued existence is asserted because they are why the file is special.
 */
const LAUNCHER_FILE = 'packages/infra/cli/src/utils/ship/launcher.ts';
const LINUX_RENDERER = 'renderPrefixLauncher';
const FOREIGN_RENDERERS = ['renderAppBundleLauncher', 'renderWindowsLauncher'];

/** Scope 3's neighbourhood. Wide enough for a constant and its JSDoc, narrow enough to mean it. */
const PLATFORM_WINDOW = 15;
const FRAMEWORK_DIR = 'packages/framework';

const failures = [];
const fail = (message) => failures.push(message);

function read(rel) {
    try {
        return readFileSync(join(ROOT, rel), 'utf8');
    } catch {
        return null;
    }
}

/** A comment line — the exemption the header describes. */
function isComment(line) {
    const trimmed = line.trimStart();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * Is `token` at `index` inside a quoted string on this line?
 *
 * Counting the quote characters BEFORE the token: an odd count means the token opened inside
 * one. Crude on purpose — it runs on single lines of TypeScript, and the alternative (stripping
 * comments first) can truncate a line at a `//` inside a URL and turn a real violation green.
 * Erring toward a false positive is the safe direction for a gate.
 */
function insideQuotes(line, index) {
    const before = line.slice(0, index);
    for (const quote of ["'", '"', '`']) {
        const count = before.split(quote).length - 1;
        if (count % 2 === 1) return true;
    }
    return false;
}

/** A `/` here opens a regex rather than dividing. Anything a value cannot follow. */
const REGEX_MAY_FOLLOW = new Set([
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '^',
    '~',
    '<',
    '>',
    'n',
]);

/**
 * Advance the template-literal state machine across one line, returning the new `stack`.
 *
 * Counting bare backticks is NOT enough, and that is measured rather than assumed: the first
 * cut of this did exactly that and desynced on `packages/framework/webgl/src/ts/utils.ts`,
 * whose `/["$\`@\\'\0]/` puts a backtick inside a REGEX CHARACTER CLASS. One stray tick flips
 * the state for the rest of the file, and from there every line reads as template content —
 * a gate failing on prose, which is how a gate gets deleted.
 *
 * So the line is walked with the four things that can swallow a backtick: a `//` tail, a
 * `/* *\/` block, a `'`/`"` string, and a regex literal. Template interpolations are a stack
 * rather than a flag, so `` `${x ? `a` : `b`}` `` does not close the outer one early.
 *
 * The stack is the return value and `top === 'template'` is the whole question this answers.
 * Anything it still cannot lex shows up as an unbalanced stack at EOF, which FAILS — this
 * scanner is not allowed to be quietly wrong, only loudly.
 */
function advanceTemplates(line, stack, blockComment) {
    let inBlock = blockComment;
    let i = 0;
    let lastCode = '';
    const top = () => stack[stack.length - 1];
    while (i < line.length) {
        const c = line[i];
        if (inBlock) {
            if (c === '*' && line[i + 1] === '/') {
                inBlock = false;
                i += 2;
            } else i++;
            continue;
        }
        if (top()?.kind === 'template') {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '`') {
                stack.pop();
                i++;
                continue;
            }
            if (c === '$' && line[i + 1] === '{') {
                stack.push({ kind: 'interp', depth: 0 });
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        // Code: either outside every template, or inside a `${…}` of one.
        if (c === '/' && line[i + 1] === '/') break;
        if (c === '/' && line[i + 1] === '*') {
            inBlock = true;
            i += 2;
            continue;
        }
        if (c === '/' && (lastCode === '' || REGEX_MAY_FOLLOW.has(lastCode))) {
            i = skipRegex(line, i);
            lastCode = '/';
            continue;
        }
        if (c === "'" || c === '"') {
            i = skipString(line, i, c);
            lastCode = c;
            continue;
        }
        if (c === '`') {
            stack.push({ kind: 'template' });
            i++;
            continue;
        }
        if (top()?.kind === 'interp') {
            if (c === '{') top().depth++;
            else if (c === '}') {
                if (top().depth === 0) stack.pop();
                else top().depth--;
            }
        }
        if (c.trim() !== '') lastCode = /[A-Za-z0-9_$]/.test(c) ? 'n' : c;
        i++;
    }
    return { stack, blockComment: inBlock };
}

/** Index just past a `'`/`"` string opened at `start`, or end of line if it never closes. */
function skipString(line, start, quote) {
    for (let i = start + 1; i < line.length; i++) {
        if (line[i] === '\\') i++;
        else if (line[i] === quote) return i + 1;
    }
    return line.length;
}

/** Index just past a regex literal opened at `start`. `[…]` may hold an unescaped `/`. */
function skipRegex(line, start) {
    let inClass = false;
    for (let i = start + 1; i < line.length; i++) {
        if (line[i] === '\\') i++;
        else if (line[i] === '[') inClass = true;
        else if (line[i] === ']') inClass = false;
        else if (line[i] === '/' && !inClass) return i + 1;
    }
    return line.length;
}

/**
 * Every `{ line, lineNo, path }` where a forbidden path is emitted rather than discussed.
 *
 * `where` names the text for the unbalanced-template failure; pass `null` for a slice of a
 * file, where an open template at the end means the slice cut one, not that the scan broke.
 */
function violations(text, offset = 0, where = null) {
    const found = [];
    let stack = [];
    let blockComment = false;
    text.split('\n').forEach((line, i) => {
        const openedInTemplate = stack[stack.length - 1]?.kind === 'template';
        // Exempt as prose only OUTSIDE a template literal. Inside one, a line opening with
        // `*` or `//` is script content — a `# comment` in a generated shell script, say —
        // and skipping it would hand anyone a two-character way to hide a path from this gate.
        if (openedInTemplate || !isComment(line)) {
            for (const path of LINUX_SYSTEM_PATHS) {
                let at = line.indexOf(path);
                while (at !== -1) {
                    // Inside an open template every character is emitted text, quotes or not.
                    if (openedInTemplate || insideQuotes(line, at)) {
                        found.push({ line: line.trim(), lineNo: offset + i + 1, path });
                        break;
                    }
                    at = line.indexOf(path, at + 1);
                }
            }
        }
        ({ stack, blockComment } = advanceTemplates(line, stack, blockComment));
    });
    // Valid TypeScript closes every template it opens, so a stack still open at EOF means this
    // scanner lost track — and a lost scanner reports agreement about text it is no longer
    // reading. That is exactly how the previous checker in this family drifted into green, so
    // it is a FAILURE here rather than a fallback to the old line-local guess.
    if (stack.length > 0 && where !== null) {
        fail(`${where}: template-literal tracking did not close by end of file — the scan desynced.`);
    }
    return found;
}

// ---- Scope 1: files that only ever produce a foreign artifact -------------------------------

for (const rel of FOREIGN_ONLY_FILES) {
    const text = read(rel);
    if (text === null) {
        // A renamed or deleted file must FAIL, not vanish from the scan. This is the exact way
        // the last checker in this family drifted: its parse stopped matching and it reported
        // agreement between two things it was no longer reading.
        fail(`${rel} is listed as macOS/Windows-only but does not exist — update FOREIGN_ONLY_FILES.`);
        continue;
    }
    for (const v of violations(text, 0, rel)) {
        fail(
            `${rel}:${v.lineNo} emits the Linux path ${v.path} — this module only builds foreign artifacts.\n      ${v.line}`,
        );
    }
}

// ---- Scope 2: the two foreign launcher renderers --------------------------------------------

/** The span of a top-level `function <name>(`, or `null` when it is not there. */
function functionSpan(lines, name) {
    const start = lines.findIndex((line) => line.startsWith(`function ${name}(`));
    if (start === -1) return null;
    // Up to the next top-level declaration or its doc block. Slicing between declarations
    // rather than brace-matching, because a brace inside a comment would misalign the count.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^(function |export function |\/\*\*)/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return { start, end };
}

const launcher = read(LAUNCHER_FILE);
if (launcher === null) {
    fail(`${LAUNCHER_FILE} does not exist — update LAUNCHER_FILE.`);
} else {
    const lines = launcher.split('\n');

    // The two foreign renderers are no longer the unit of scanning, but they are still the
    // reason this file is special-cased, so a rename must be LOUD. A gate that quietly stops
    // recognising its own subject is the failure mode this family keeps rediscovering.
    for (const name of FOREIGN_RENDERERS) {
        if (functionSpan(lines, name) === null) {
            fail(`${LAUNCHER_FILE} has no top-level \`function ${name}(\` — the renderer was renamed or moved.`);
        }
    }

    const linux = functionSpan(lines, LINUX_RENDERER);
    if (linux === null) {
        fail(
            `${LAUNCHER_FILE} has no top-level \`function ${LINUX_RENDERER}(\` — the one section this gate ` +
                `exempts. Cutting nothing would flag the Linux default, which is correct there; update ` +
                `LINUX_RENDERER rather than widening the exemption.`,
        );
    } else if (linux.end - linux.start < 4) {
        // An exemption that swallowed the file would report agreement having read nothing, and
        // one that shrank to nothing means the slice stopped working. Three lines is
        // `function`, one statement, `}` — anything real is longer.
        fail(`${LAUNCHER_FILE}: \`${LINUX_RENDERER}\` sliced to ${linux.end - linux.start} lines — the parse broke.`);
    } else {
        // Everything OUTSIDE the Linux renderer: both foreign renderers, and every shared
        // helper they call. Blanking the exempt span rather than removing it keeps line
        // numbers true, so a failure names the line a reader can open.
        const scanned = lines.map((line, i) => (i >= linux.start && i < linux.end ? '' : line));
        for (const v of violations(scanned.join('\n'), 0, LAUNCHER_FILE)) {
            fail(
                `${LAUNCHER_FILE}:${v.lineNo} writes the Linux path ${v.path} outside \`${LINUX_RENDERER}\` — ` +
                    `everything else in this file feeds a macOS or Windows launcher.\n      ${v.line}`,
            );
        }
    }
}

// ---- Scope 3: framework runtime code, which ships to all three OSes --------------------------

function tsFilesUnder(dir) {
    const out = [];
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules' && entry !== 'dist') out.push(...tsFilesUnder(full));
        } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const frameworkRoot = join(ROOT, FRAMEWORK_DIR);
const frameworkSources = [];
try {
    for (const pkg of readdirSync(frameworkRoot)) {
        const src = join(frameworkRoot, pkg, 'src');
        try {
            if (statSync(src).isDirectory()) frameworkSources.push(...tsFilesUnder(src));
        } catch {
            // A framework package without `src/` is normal — generated packages have none.
        }
    }
} catch {
    fail(`${FRAMEWORK_DIR} does not exist — update FRAMEWORK_DIR.`);
}

// Scanning nothing is not the same as finding nothing. This tree has dozens of framework
// sources; a walker that returns an empty list has broken, not passed.
if (frameworkSources.length < 10 && failures.length === 0) {
    fail(`${FRAMEWORK_DIR}/*/src matched ${frameworkSources.length} sources — the walk broke.`);
}

for (const full of frameworkSources) {
    const rel = relative(ROOT, full);
    // A module whose own path says `linux` has declared its scope there. The only exemption,
    // and it is one nobody can widen without renaming a file to lie about what it is.
    if (/(^|[/\-.])linux([/\-.]|$)/.test(rel)) continue;
    const text = read(rel);
    if (text === null) continue;
    const lines = text.split('\n');
    for (const v of violations(text, 0, rel)) {
        const from = Math.max(0, v.lineNo - 1 - PLATFORM_WINDOW);
        const to = Math.min(lines.length, v.lineNo + PLATFORM_WINDOW);
        const decided = lines
            .slice(from, to)
            .some((line) => !isComment(line) && (line.includes('darwin') || line.includes('win32')));
        if (!decided) {
            fail(
                `${rel}:${v.lineNo} bakes the Linux path ${v.path} with no darwin/win32 decision within ` +
                    `${PLATFORM_WINDOW} lines — this module ships to all three OSes.\n      ${v.line}`,
            );
        }
    }
}

// ---- Report ----------------------------------------------------------------------------------

if (failures.length > 0) {
    console.error('A Linux system path reached a platform that has no such layout:\n');
    for (const message of failures) console.error(`  ✗ ${message}`);
    console.error(
        '\n  A foreign artifact resolves its data and locale directories from INSIDE the bundle.' +
            '\n  Where the bundle names none, the honest answer is no directory — not a Linux one' +
            '\n  that either does not exist or belongs to a package manager the user never chose.',
    );
    process.exit(1);
}

console.log(
    `  ✓ no Linux system path in ${FOREIGN_ONLY_FILES.length} foreign-only modules, ` +
        `${LAUNCHER_FILE.split('/').pop()} outside \`${LINUX_RENDERER}\`, or ${frameworkSources.length} framework sources.`,
);
