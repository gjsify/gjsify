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
//   2. FUNCTION. `launcher.ts` renders all three forms side by side, so the file cannot be
//      judged whole: `renderPrefixLauncher` is Linux and the default there is correct, load-
//      bearing, and must stay. Only the two foreign renderers are scanned, and both must be
//      found with a real body.
//
//   3. FRAMEWORK RUNTIME. `packages/framework/*/src` ships to all three OSes. A Linux system
//      path there is allowed only where the module has visibly DECIDED what the other two get:
//      `darwin` or `win32` must appear in CODE within `PLATFORM_WINDOW` lines of the literal.
//      Locality rather than "somewhere in the file", because a 900-line module mentioning
//      `darwin` once does not make a constant 400 lines away platform-aware.
//
// WHAT IT DOES NOT CATCH, said plainly so nobody reads a green run as more than it is:
// scope 3 checks that a platform decision sits NEXT TO the literal, not that the decision is
// correct. Reintroducing an unconditional return in a module that still names `darwin`
// elsewhere stays green here — `locale-dir.spec.ts` is what holds that line. A path assembled
// at runtime (`'/usr' + '/share'`) is invisible to any textual gate. And Linux paths reaching
// a foreign platform through a shared helper are outside all three scopes.
//
// COMMENTS ARE EXEMPT, and have to be: this tree explains a rule by quoting the path it
// forbids, including in this header. A line whose first non-space characters are `//`, `*`,
// `/*` or `*/` is skipped, and on the lines that remain the token must sit inside quotes —
// a bare mention in trailing prose is not a string being emitted.

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

/** The launcher renderers that are NOT Linux. Scope 2. */
const LAUNCHER_FILE = 'packages/infra/cli/src/utils/ship/launcher.ts';
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

/** Every `{ line, lineNo, path }` where a forbidden path is emitted rather than discussed. */
function violations(text, offset = 0) {
    const found = [];
    text.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        for (const path of LINUX_SYSTEM_PATHS) {
            let at = line.indexOf(path);
            while (at !== -1) {
                if (insideQuotes(line, at)) {
                    found.push({ line: line.trim(), lineNo: offset + i + 1, path });
                    break;
                }
                at = line.indexOf(path, at + 1);
            }
        }
    });
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
    for (const v of violations(text)) {
        fail(
            `${rel}:${v.lineNo} emits the Linux path ${v.path} — this module only builds foreign artifacts.\n      ${v.line}`,
        );
    }
}

// ---- Scope 2: the two foreign launcher renderers --------------------------------------------

const launcher = read(LAUNCHER_FILE);
if (launcher === null) {
    fail(`${LAUNCHER_FILE} does not exist — update LAUNCHER_FILE.`);
} else {
    const lines = launcher.split('\n');
    for (const name of FOREIGN_RENDERERS) {
        const start = lines.findIndex((line) => line.startsWith(`function ${name}(`));
        if (start === -1) {
            fail(`${LAUNCHER_FILE} has no top-level \`function ${name}(\` — the renderer was renamed or moved.`);
            continue;
        }
        // Up to the next top-level declaration or its doc block. Slicing between declarations
        // rather than brace-matching, because a brace inside a comment would misalign the count.
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
            if (/^(function |export function |\/\*\*)/.test(lines[i])) {
                end = i;
                break;
            }
        }
        const body = lines.slice(start, end);
        // A body that shrank to nothing means the slice stopped working, and an empty scan is
        // the failure this whole family is built to avoid. Three lines is `function`, one
        // statement, `}` — anything real is longer.
        if (body.length < 4) {
            fail(`${LAUNCHER_FILE}: \`${name}\` sliced to ${body.length} lines — the section parse broke.`);
            continue;
        }
        for (const v of violations(body.join('\n'), start)) {
            fail(
                `${LAUNCHER_FILE}:${v.lineNo} — \`${name}\` writes the Linux path ${v.path} into a foreign launcher.` +
                    `\n      ${v.line}`,
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
    for (const v of violations(text)) {
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
        `${FOREIGN_RENDERERS.length} foreign launcher renderers, or ${frameworkSources.length} framework sources.`,
);
