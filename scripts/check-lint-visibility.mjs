#!/usr/bin/env node
// Every file git tracks is one oxlint reads, or it is declared here with a reason.
//
// THE INCIDENT
//
// `.oxlintrc.json` carried `**/lib` in `ignorePatterns`, put there for build output:
// `lib/` is where 119 packages compile `src/` to. Three packages COMMIT files under
// that name, and the blanket pattern swallowed all of them — 134 tracked files, of
// which 26 are hand-written ESM in `@gjsify/manifest-conformance` (the manifest gates
// that block `main`) and `@gjsify/resolve-npm` (the alias layer every build target
// routes through). Neither had ever had a line linted. The way it surfaced is the
// part worth keeping: `oxlint packages/infra/resolve-npm` exits 1 with "No files
// found to lint", so a reviewer who lints the package BY PATH is told the package is
// empty rather than that all of it is skipped. Exit 1 read as "checked, and angry";
// it meant "nothing was checked at all".
//
// That is this repository's most expensive recurring shape — a green check that
// verified nothing — wearing an ignore pattern instead of a test. Nothing else in the
// tree can report it: lint gates grade the files they were HANDED, and the defect is
// in the handing.
//
// HOW THE SET IS DERIVED, and why neither half is this script's own opinion
//
// The obvious implementation re-reads `ignorePatterns` and re-implements gitignore
// matching. That builds a SECOND matcher, which then has to agree with oxlint's about
// `**/lib` vs `lib/`, about `.gitignore` inheritance, about negation — and the day it
// disagrees, this script is confidently wrong in whichever direction its own bug
// points. So both sides are asked of oxlint itself, with `--debug=files`, which prints
// the walk result and exits:
//
//   WILL  = `oxlint --debug=files .`
//           what the whole-tree lint actually visits — every ignore layer applied.
//   COULD = `oxlint --debug=files --no-ignore <every tracked path>`
//           the same walker over git's list with the ignore layers off, so the
//           extension question ("is this a file you lint?") is answered by oxlint and
//           not by a list of suffixes maintained here. Passing git's paths explicitly
//           is also what keeps `node_modules` out of a `--no-ignore` walk.
//
// blind = COULD − WILL. Every member is a tracked file oxlint can read and does not.
//
// WHY THE EXEMPTIONS MUST MATCH SOMETHING
//
// A registry entry that matches nothing is the same claim as an unused
// `eslint-disable`: it announces that a case was considered when the case is gone.
// `.oxlintrc.json` already turns `reportUnusedDisableDirectives` to `error` over the
// incident where such comments sat next to code for two months describing a review
// that had never happened (#859/#861). The rule applies to this file's own registry,
// so a stale entry is RED, and the entries retire themselves.
//
// It buys the control this script would otherwise lack. The failure mode of a
// set-difference gate is that the difference silently becomes empty — `--no-ignore`
// stops disabling anything, `--debug=files` changes its output, one oracle starts
// returning nothing — and the gate then passes while measuring the empty set. Because
// every exemption must match a real blind file, the same run that reports "no
// undeclared blind files" also proves the differencing still finds the ~131 files it
// is supposed to find. A broken oracle cannot come back green.
//
// THE FORMATTER HALF IS CLOSED, SEPARATELY: `.oxfmtrc.json` carried the same `**/lib`
// line and hid the same 26 sources from oxfmt — 15 of them unformatted. That landed on
// its own, because closing it reformats load-bearing infra and deserved its own diff to
// read. This gate still says nothing about formatting: it answers "can the LINTER see
// this file", and the equivalent question for oxfmt needs a different oracle (oxfmt has
// no `--debug=files` and no `--no-ignore`, so its visible set is only recoverable by
// bisecting an accepted-file count). That arm is owed and not written.
//
// Usage: node scripts/check-lint-visibility.mjs [--root <dir>] [--list]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (rootFlag !== -1 && args[rootFlag + 1] === undefined) {
    console.error('check-lint-visibility: --root needs a directory.');
    process.exit(2);
}
const ROOT =
    rootFlag === -1
        ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
        : resolve(process.cwd(), args[rootFlag + 1]);
const LIST = args.includes('--list');

/**
 * Tracked paths oxlint deliberately never reads. `prefix` matches a path or anything
 * under it; `why` is the part that has to survive review, so it states what the files
 * ARE and what linting them would grade.
 *
 * Adding an entry is a decision to stop checking real code. Committed SOURCE does not
 * belong here — narrow the ignore instead, which is what `**\/lib`'s removal did.
 */
const EXEMPT = [
    {
        prefix: 'packages/infra/tsc/lib',
        why:
            "verbatim copies of upstream TypeScript's default-library declarations, refreshed from " +
            "`node_modules/typescript/lib` by the package's own build and committed so a consumer " +
            "without `typescript` can resolve them. Linting `lib.dom.d.ts` grades Microsoft's house " +
            'style, and every finding would be unfixable here by construction.',
    },
    {
        prefix: 'packages/infra/cli/dist/affected.gjs.mjs',
        why:
            'a committed BUNDLE, not a source: the Soup-free CI classifier the `changes` job boots ' +
            'before any install. Its input lives in `packages/infra/cli/src`, which is linted; the ' +
            'artifact is rebuilt, never edited.',
    },
    {
        prefix: 'packages/infra/lightningcss-wasm/src/napi-wasm.mjs',
        why: 'vendored upstream wasm-bindgen glue, replaced wholesale on every lightningcss bump.',
    },
    {
        prefix: 'packages/framework/gtk-host/src/generated',
        why: 'generated from the GTK/Adwaita GIR; findings belong to the generator, not the output.',
    },
    {
        prefix: 'packages/framework/react-native/src/generated',
        why: 'generated export stubs; same as gtk-host — fix the generator.',
    },
    {
        prefix: 'packages/framework/webgl/src/ts/@types',
        why: 'hand-copied ambient declarations for an untyped upstream package, kept as it was written.',
    },
    {
        prefix: 'templates',
        why:
            'scaffolding copied into a NEW project by `gjsify create`, not compiled as part of this ' +
            'tree. Measured 2026-08 with the ignore lifted: 2 findings, both ' +
            '`gjsify/no-literal-widget-label` in `templates/gtk-minimal`, on the hello-world caption a ' +
            'user replaces first — the same posture `.oxlintrc.json` already grants `examples/` and ' +
            '`showcases/` for demo captions. Un-ignoring templates is a defensible separate change; it ' +
            'wants that override extended, not a new blind spot.',
    },
    {
        prefix: 'website/src/components/AdwWidget.astro',
        why:
            "oxlint's .astro reader finds `<script>` by text scan and takes the one inside this file's " +
            'JSX comment as a real opener, then fails to parse the markup after it. Reasoned at length ' +
            'in `.oxlintrc.json`; every other .astro file stays linted.',
    },
];

const require = createRequire(import.meta.url);
let OXLINT;
try {
    // Via `package.json`, not the bin path directly: the bin has no extension and the
    // package's `exports` map does not expose it, so `require.resolve('oxlint/bin/oxlint')`
    // throws even where the file is right there.
    OXLINT = join(dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
} catch {
    // Not a "best effort" catch: without the pinned binary there is no oracle, and a
    // gate that cannot measure must say so rather than pass.
    console.error('check-lint-visibility: cannot resolve the pinned `oxlint`. Install dependencies first.');
    process.exit(2);
}

/**
 * Run oxlint's own walker and return the paths it reports, repo-relative and
 * forward-slashed (Windows prints backslashes).
 *
 * `--debug=files` writes the list and exits 0 without linting; a non-zero status means
 * the oracle did not answer, which must not be read as "nothing to report".
 */
function oxlintFiles(extraArgs, paths) {
    let out;
    try {
        out = execFileSync(process.execPath, [OXLINT, '--debug=files', ...extraArgs, ...paths], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            // `execFileSync` lets the child's stderr reach ours unless stdio is
            // spelled out, which prints the failure twice around this script's
            // explanation of it.
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        console.error(
            `check-lint-visibility: \`oxlint --debug=files ${extraArgs.join(' ')}\` failed ` +
                `(status ${err.status ?? '?'}). Without both file lists there is nothing to compare.`,
        );
        if (err.stderr) console.error(String(err.stderr).trimEnd());
        process.exit(2);
    }
    return out
        .split('\n')
        .map((line) => line.trim().replaceAll('\\', '/'))
        .filter(Boolean);
}

/** `git ls-files`, NUL-separated so a path with a newline in it cannot split a row. */
function trackedFiles() {
    let out;
    try {
        out = execFileSync('git', ['ls-files', '-z'], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        // Real throw paths, all of which produce an EMPTY subject rather than an error:
        // no `git` on PATH, not a repository, or the container's "dubious ownership"
        // refusal. Each would make this gate pass having listed nothing.
        console.error(
            `check-lint-visibility: \`git ls-files\` failed in ${ROOT} (status ${err.status ?? '?'}). ` +
                'The tracked-file list is the subject of this check; without it there is nothing to check.',
        );
        if (err.stderr) console.error(String(err.stderr).trimEnd());
        process.exit(2);
    }
    return out.split('\0').filter(Boolean);
}

/** argv has a length limit; the tracked list is ~5.5k paths, so hand it over in batches. */
function chunked(paths, budget = 100_000) {
    const chunks = [[]];
    let size = 0;
    for (const p of paths) {
        if (size + p.length + 1 > budget && chunks.at(-1).length > 0) {
            chunks.push([]);
            size = 0;
        }
        chunks.at(-1).push(p);
        size += p.length + 1;
    }
    return chunks;
}

const tracked = new Set(trackedFiles());
const will = new Set(oxlintFiles([], ['.']));
const could = new Set();
for (const chunk of chunked([...tracked])) {
    for (const file of oxlintFiles(['--no-ignore'], chunk)) could.add(file);
}

// Both oracles are the same binary and the same walker; if the ignore-free list does
// not contain the ignored one, they are not answering the same question and the
// difference below means nothing.
if (will.size === 0 || could.size === 0) {
    console.error(
        `check-lint-visibility: an oracle came back empty (will=${will.size}, could=${could.size}). ` +
            'A set difference against an empty set is not a measurement.',
    );
    process.exit(2);
}
// Restricted to TRACKED files on purpose. `will` comes from walking the tree, so on a
// working copy it also holds files git has never seen — a new script, a scratch repro —
// and `could` is built from `git ls-files`. Comparing the raw sets would report every
// uncommitted file as an oracle disagreement, which is loud, wrong, and exactly the kind
// of noise that trains people to stop reading a gate.
const notASuperset = [...will].filter((f) => tracked.has(f) && !could.has(f));
if (notASuperset.length > 0) {
    console.error(
        'check-lint-visibility: tracked files the tree lint reads are missing from the ignore-free ' +
            'walk, so the two lists are not comparable:\n',
    );
    for (const f of notASuperset.slice(0, 10)) console.error(`  ${f}`);
    process.exit(2);
}

const blind = [...could].filter((f) => !will.has(f)).sort();

const matched = new Map(EXEMPT.map((e) => [e.prefix, []]));
const undeclared = [];
for (const file of blind) {
    const hit = EXEMPT.find((e) => file === e.prefix || file.startsWith(`${e.prefix}/`));
    if (hit) matched.get(hit.prefix).push(file);
    else undeclared.push(file);
}

if (LIST) {
    for (const { prefix } of EXEMPT) {
        console.log(`${prefix}  (${matched.get(prefix).length} file(s))`);
        for (const f of matched.get(prefix)) console.log(`    ${f}`);
    }
}

const stale = EXEMPT.filter((e) => matched.get(e.prefix).length === 0);

if (undeclared.length > 0 || stale.length > 0) {
    if (undeclared.length > 0) {
        console.error('check-lint-visibility: tracked files oxlint never reads.\n');
        for (const file of undeclared) console.error(`  ${file}`);
        console.error(
            '\nEach of these is committed code the CI lint gate never grades, and checking one by\n' +
                'hand does not reveal it — MEASURED, both answers mislead: a path excluded by\n' +
                '`ignorePatterns` makes `oxlint <path>` print "No files found to lint" and exit 1,\n' +
                'which reads as angry-but-checked; a path excluded by `.gitignore` gets linted on an\n' +
                'explicit argument and looks covered, while `oxlint .` walks straight past it.\n' +
                'Either narrow the ignore in `.oxlintrc.json` so the tree walk reaches the file, or\n' +
                'add it to EXEMPT in this script with a reason that says what it IS.\n',
        );
    }
    if (stale.length > 0) {
        console.error('check-lint-visibility: EXEMPT entries that match nothing.\n');
        for (const { prefix } of stale) console.error(`  ${prefix}`);
        console.error(
            '\nAn exemption matching no file claims a case was considered that no longer exists —\n' +
                'the unused-disable-directive shape `.oxlintrc.json` makes an error. It is also this\n' +
                "gate's only control: if the difference stopped finding anything, this is where it\n" +
                'shows. Delete the entry, or find out why the file it named is no longer blind.\n',
        );
    }
    process.exit(1);
}

// `will` also holds untracked files the tree walk found, so the headline counts the
// intersection — otherwise the two numbers do not add up to `could.size` and the reader
// has to guess which one is the lie.
const read = [...will].filter((f) => tracked.has(f)).length;
console.log(
    `check-lint-visibility: ${read} of ${could.size} lintable tracked file(s) are read by ` +
        `oxlint; the remaining ${blind.length} are declared across ${EXEMPT.length} exemption(s), ` +
        'each of which still matches.',
);
