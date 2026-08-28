#!/usr/bin/env node
// Every extension the linter calls a source is one this repository's source-walkers
// know about, and every file a walker's own scope holds is one it opens.
//
// THE INCIDENT
//
// `.tsx` arrived and three walkers written before it kept grading the files they were
// handed, all three green, all three found on one day (2026-08-28):
//
//   - `source-graph.mjs` matched `/\.(ts|mts)$/`, so `@gjsify/adwaita-react-native`'s
//     four widget implementations were invisible to the ADR 0014 reachability audit.
//     Setting its `gjsify.runtimes["react-native"]` to `polyfill`, `partial` or `none`
//     each left `audit-runtimes --check` at exit 0 — the declaration was not checked.
//     That package is on `feat/adwaita-react-native` and not here: on this branch the
//     widening changes nothing, `listSourceFiles` returning the same 1354 files either
//     way, so the `source-graph` half of this gate is held up by its vectors alone
//     until that branch lands. The other two below are live on this tree.
//   - `check-comment-budget.mjs` globbed `'*.ts' '*.mts' '*.mjs' '*.js' '*.cjs'` and
//     did not count 19 tracked `.tsx` files. Folding them in moved `showcases` from
//     0.153 to 0.170 against a ceiling of 0.158 that had shown 78 lines of headroom.
//   - `generate-status.mjs`'s open-todo anchor walk matched
//     `/\.(?:ts|mts|cts|js|mjs|cjs)$/`, so an anchor pointing at a deleted heading
//     could sit in a `.tsx` file forever.
//
// Each carried its OWN literal, so fixing one taught the others nothing, and the fourth
// would have been written next month. `source-extensions.mjs` is now the one place an
// extension is added; this is what fails when a walker or that vocabulary falls behind.
//
// TWO HALVES, AND NEITHER IS THIS SCRIPT'S OPINION
//
//   VOCABULARY — every extension oxlint's walker accepts on a TRACKED file is in
//                `source-extensions.mjs`, or declared below with a reason. oxlint is
//                the oracle because it already answers "is this a JS-family source"
//                and is maintained by people who follow the dialects; a list of
//                suffixes written here would be the same literal this check exists to
//                remove. `--debug=files` prints its walk and exits without linting.
//   VISIBILITY — for each walker below: the files ITS OWN scope claims, restricted to
//                the shared vocabulary, minus the files IT reports reading. Both sides
//                come from the walker, so the only thing being compared is its
//                extension subject against the repository's. A walker that drops an
//                extension names exactly the files it stopped opening.
//
// WHY EVERY DECLARATION MUST MATCH SOMETHING
//
// Same argument as `check-lint-visibility.mjs`, and the same control: a set-difference
// gate fails open when the difference silently becomes empty — an oracle that returns
// nothing, a scope probe that stops printing. Because each `NOT_SOURCE` entry has to
// match a real tracked file and each walker has to report a non-empty read set, the run
// that says "nothing blind" also proves it still measured something.
//
// THE RESIDUAL, stated rather than hidden: the vocabulary half walks with oxlint's
// ignore layers ON, so a NEW dialect arriving only inside an oxlint-ignored tree
// (`templates/`, the generated directories) is not seen here. That arm is
// `check-lint-visibility.mjs`'s, which holds every tracked file oxlint never reads to a
// declared reason — so a file has to be invisible to BOTH to go unnoticed.
//
// Usage: node scripts/check-source-visibility.mjs [--list] [--self-test]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CODE_SOURCE_EXTENSIONS,
    TS_SOURCE_EXTENSIONS,
    hasSourceExtension,
    listSourceFiles,
    packagesUnder,
} from '../packages/infra/manifest-conformance/lib/index.mjs';
import { readSuiteRegistration } from './suite-registration.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');

// The checker before anything it checks: the vectors below cost milliseconds and no
// oracle, and a broken difference cannot be seen by any run over the real tree.
const selfTestResult = selfTest();
if (selfTestResult.failures.length > 0) {
    console.error(`check-source-visibility: SELF-TEST FAILED, ${selfTestResult.failures.length} finding(s).\n`);
    for (const failure of selfTestResult.failures) console.error(`  ${failure}`);
    console.error('\nThe differencing no longer reports what the vectors measure. Fix it, or — if the');
    console.error('expectation is what changed — say so in the vector.');
    process.exit(1);
}
console.log(`check-source-visibility: self-test green — ${selfTestResult.vectors} vector(s).`);
if (process.argv.includes('--self-test')) process.exit(0);

/**
 * Extensions oxlint reads that this repository's walkers deliberately do not.
 *
 * `why` has to say what the files ARE and what a walker would do with them, because
 * adding an entry is a decision that a whole dialect stays outside the vocabulary.
 * A new one here is a real decision; a new one MISSING here is this gate firing.
 */
const NOT_SOURCE = [
    {
        ext: 'astro',
        why:
            "the website's page and component templates. Frontmatter plus markup, compiled by " +
            'Astro and never by `gjsify build`; the walkers below ask questions about package ' +
            'sources (what a bundle reaches, what a spec registers) that an `.astro` page cannot ' +
            'answer. `check-website-package-names.mjs` and oxlint hold this tree.',
    },
    {
        ext: 'vue',
        why:
            'single-file components: eight `gtk-host/type-tests/vue/**` fixtures that ' +
            '`check-type-surfaces.mjs` drives through `vue-tsc`, and two showcase SFCs the Vue ' +
            'plugin compiles. A `<template>` plus `<script setup>` is not a module `gjsify build` ' +
            'compiles or a spec runner registers, and `check-vue-program.mjs` holds the tree ' +
            'instead. It is also load-bearing that `.vue` stays OUT: ' +
            '`adapter-import-direction-fixtures.mjs` uses it as its stand-in for "an extension the ' +
            'walk cannot read", and adding it was measured to turn that suite\'s two blocker ' +
            'vectors into a self-test failure.',
    },
];

/** Repo-relative, forward-slashed. @param {string} path */
const rel = (path) => relative(ROOT, path).split('\\').join('/');

/** @param {string[]} paths */
function toSet(paths) {
    return new Set(paths);
}

/**
 * Run a probe and return its stdout lines. A probe that fails did not ANSWER, which
 * must never be read as "it found nothing" — that is the whole failure class here.
 *
 * @param {string} label @param {string[]} argv
 */
function probe(label, argv) {
    try {
        return execFileSync(process.execPath, argv, {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    } catch (err) {
        console.error(
            `check-source-visibility: the ${label} probe failed (status ${err.status ?? '?'}). ` +
                'Without its answer there is nothing to compare.',
        );
        if (err.stderr) console.error(String(err.stderr).trimEnd());
        process.exit(2);
    }
}

/** `git ls-files`, NUL-separated so a path with a newline cannot split a row. */
function trackedFiles() {
    try {
        return execFileSync('git', ['ls-files', '-z'], {
            cwd: ROOT,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
            .split('\0')
            .filter(Boolean);
    } catch (err) {
        console.error(
            `check-source-visibility: \`git ls-files\` failed in ${ROOT} (status ${err.status ?? '?'}). ` +
                'The tracked list is the subject of both halves; without it there is nothing to check.',
        );
        if (err.stderr) console.error(String(err.stderr).trimEnd());
        process.exit(2);
    }
}

/** The files oxlint's own walker visits, repo-relative. */
function oxlintFiles() {
    let binary;
    try {
        // Via `package.json`: the bin has no extension and `exports` does not expose it,
        // so resolving the bin path directly throws even where the file is right there.
        binary = join(dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), 'bin', 'oxlint');
    } catch {
        console.error('check-source-visibility: cannot resolve the pinned `oxlint`. Install dependencies first.');
        process.exit(2);
    }
    return probe('oxlint --debug=files', [binary, '--debug=files', '.']).map((line) => line.split('\\').join('/'));
}

const tracked = trackedFiles();
const trackedSet = toSet(tracked);

// ── the walkers ─────────────────────────────────────────────────────────────

const packageSrcDirs = packagesUnder(join(ROOT, 'packages')).map((dir) => join(dir, 'src'));

/**
 * A spec, as the SHARED vocabulary spells one.
 *
 * Deliberately NOT `suite-registration.mjs`'s own `isSpecFile`: that predicate is the
 * thing under test, and asking it to describe its own subject makes the difference
 * circular — measured, narrowing it back to `.spec.(ts|mts)` moved BOTH halves and the
 * gate stayed green over a `.spec.tsx` neither side could see. The `.spec.` marker is a
 * naming convention both sides already agree on; the extension after it is the question.
 */
const SPEC_SUBJECT = new RegExp(`\\.spec\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);

/**
 * The two other things a source walk here declares outside its subject, spelled the same
 * way and for the same reason: a TEST ENTRY and a DECLARATION file.
 *
 * `isNonShippingSource` used to be called here, as `isSpecFile` once was, and it carries
 * the identical defect: it is `source-graph.mjs`'s OWN predicate, built from `SPEC_RE`,
 * `TEST_ENTRY_RE` and `isDeclarationFile`, so a change inside it moves the scope and the
 * read set together and the difference is against itself. Measured on this tree —
 * `isNonShippingSource` widened to swallow `.mts` took the subject from 1354 to 1344 and
 * this gate exited 0; widened to swallow `.tsx` it hid a staged `pkg/src/probe.tsx` from
 * both halves, also exit 0. Same for `isDeclarationFile` inside the comment budget.
 *
 * `.spec.`, a leading `test`, and `.d.` are naming conventions both sides already agree
 * on. The extension after each is the question, and it comes from the vocabulary.
 */
const TEST_ENTRY_SUBJECT = new RegExp(`^test(\\..*)?\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);
const DECLARATION_SUBJECT = new RegExp(`\\.d\\.(${TS_SOURCE_EXTENSIONS.join('|')})$`);

/** @param {string} name a BASE name, as the walkers' own exclusions take one */
const isNonShippingSubject = (name) =>
    SPEC_SUBJECT.test(name) || TEST_ENTRY_SUBJECT.test(name) || DECLARATION_SUBJECT.test(name);

/** Tracked files directly under one of the package `src` trees. @param {(f: string) => boolean} keep */
const underPackageSrc = (keep) =>
    tracked.filter(
        (file) =>
            !file.includes('/node_modules/') &&
            packageSrcDirs.some((dir) => file.startsWith(`${rel(dir)}/`)) &&
            keep(file),
    );

/**
 * A registered walker states what it grades, which half of the vocabulary its subject
 * is, and answers ONE question with its OWN code: which tracked files its scope holds,
 * and which of those it actually reads. Both come back from the same call so the two
 * sides cannot describe different runs.
 */
const WALKERS = [
    {
        id: 'comment-budget',
        what: "scripts/check-comment-budget.mjs — every tree's comment-to-code ratio against its ceiling",
        extensions: CODE_SOURCE_EXTENSIONS,
        // `--scope` answers with the tracked files that budget is ABOUT, declarations
        // INCLUDED — the extension question is asked here, once, so a change to
        // `isDeclarationFile` moves the read set alone and shows up as blindness.
        measure: () => ({
            scope: probe('check-comment-budget --scope', ['scripts/check-comment-budget.mjs', '--scope']).filter(
                (file) => !DECLARATION_SUBJECT.test(file),
            ),
            reads: probe('check-comment-budget --files', ['scripts/check-comment-budget.mjs', '--files']),
        }),
    },
    {
        id: 'source-graph',
        what:
            'packages/infra/manifest-conformance/lib/source-graph.mjs `listSourceFiles` — the source ' +
            "set behind `audit-runtimes`' ADR 0014 cross-runtime reachability audit",
        extensions: TS_SOURCE_EXTENSIONS,
        measure: () => ({
            scope: underPackageSrc((file) => !isNonShippingSubject(file.slice(file.lastIndexOf('/') + 1))),
            reads: packageSrcDirs.flatMap((dir) => listSourceFiles(dir)).map(rel),
        }),
    },
    {
        id: 'suite-registration',
        what:
            'scripts/suite-registration.mjs — which `*.spec.*` files a package REACHES and which it ' +
            'actually runs, read by the node, browser and Adwaita-driver registration gates',
        extensions: TS_SOURCE_EXTENSIONS,
        // A package with no test entry directly under `src/` is one this reader declares
        // outside its own subject — `check-node-test-registration.mjs` skips it on the
        // same condition — so the scope is taken from that answer rather than from a
        // guess made here. It is a real gap and it is NOT this gate's: five packages keep
        // their entry a directory down (`packages/framework/webgl/src/test/`) and their
        // 18 specs are graded by nothing. Recorded in `status/open-todos.md`; widening
        // the entry search is a change to what those gates assert, not to what they see.
        measure: () => {
            const scope = [];
            const reads = [];
            for (const dir of packageSrcDirs) {
                const registration = readSuiteRegistration(dirname(dir));
                if (registration.entries.length === 0) continue;
                const prefix = `${rel(dir)}/`;
                scope.push(...tracked.filter((file) => file.startsWith(prefix) && SPEC_SUBJECT.test(file)));
                reads.push(...registration.specs.map(rel));
            }
            return { scope, reads };
        },
    },
];

/**
 * Tracked files a walker's own scope holds, at an extension the vocabulary names, that
 * the walker does not read.
 *
 * Blind files this repository ACCEPTS would be declared here. The list is empty and
 * that is the point: a walker whose scope names a file it will not open has a bug, not
 * an exemption, and the three fixed on 2026-08-28 were each one line of glob.
 */
const EXEMPT = [];

// ── half one: the vocabulary ────────────────────────────────────────────────

const lintable = oxlintFiles().filter((file) => trackedSet.has(file));
if (lintable.length === 0) {
    console.error(
        'check-source-visibility: oxlint reported no tracked files. An extension census over an ' +
            'empty set is not a measurement.',
    );
    process.exit(2);
}

/** @type {Map<string, string[]>} */
const byExtension = new Map();
for (const file of lintable) {
    const ext = file.slice(file.lastIndexOf('.') + 1);
    if (!byExtension.has(ext)) byExtension.set(ext, []);
    byExtension.get(ext).push(file);
}

const declared = new Map(NOT_SOURCE.map((entry) => [entry.ext, entry]));
const unclassified = [...byExtension.keys()]
    .filter((ext) => !CODE_SOURCE_EXTENSIONS.includes(ext) && !declared.has(ext))
    .sort();
const staleDeclarations = NOT_SOURCE.filter((entry) => !byExtension.has(entry.ext));

// ── half two: the walkers ───────────────────────────────────────────────────

/**
 * One walker's answer, differenced. Pure, and separated from the run so `--self-test`
 * can hand it scenarios this tree does not contain — including the mutation this whole
 * mechanism exists to catch, on the day no `.tsx` file yet lives where the walker looks.
 *
 * `empty` is not a verdict about the tree: a scope∩vocabulary or a read set of zero
 * means the probe stopped answering, and a difference against nothing is what a check
 * of this shape fails open as.
 *
 * @param {{scope: string[], reads: string[], extensions: readonly string[]}} answer
 * @param {(file: string) => boolean} isTracked
 */
function difference({ scope, reads, extensions }, isTracked = () => true) {
    const read = toSet(reads);
    const inScope = toSet(scope);
    const subject = scope.filter((file) => hasSourceExtension(file, extensions));
    return {
        subject,
        read,
        empty: read.size === 0 || subject.length === 0,
        outside: [...read].filter((file) => isTracked(file) && !inScope.has(file)),
        blind: subject.filter((file) => !read.has(file)).sort(),
    };
}

/**
 * The differencing, checked against vectors before it is pointed at anything real —
 * the `check-adapter-import-direction.mjs` posture, for the same reason: a checker
 * whose own machinery cannot see a violation prints the same green as a clean tree,
 * and no run over this tree could show it.
 */
function selfTest() {
    const failures = [];
    let vectors = 0;
    /** @param {string} name @param {unknown} actual @param {unknown} expected */
    const expect = (name, actual, expected) => {
        vectors += 1;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            failures.push(
                `${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
            );
        }
    };

    // THE MUTATION, as a vector: a walker whose filter lost an extension. This is the
    // shape of all three 2026-08-28 instances, and on `main` today no package `src` tree
    // holds a `.tsx` file — so without this fixture the machinery would go unfalsified
    // exactly where it matters.
    const narrowed = difference({
        scope: ['pkg/src/widget.ts', 'pkg/src/widget.tsx', 'pkg/src/screen.tsx'],
        reads: ['pkg/src/widget.ts'],
        extensions: CODE_SOURCE_EXTENSIONS,
    });
    expect('a walker that dropped .tsx names the files it stopped opening', narrowed.blind, [
        'pkg/src/screen.tsx',
        'pkg/src/widget.tsx',
    ]);
    expect('…and does not report itself empty', narrowed.empty, false);

    expect(
        'a walker that reads its whole scope is blind to nothing',
        difference({
            scope: ['pkg/src/a.ts', 'pkg/src/b.tsx'],
            reads: ['pkg/src/a.ts', 'pkg/src/b.tsx'],
            extensions: CODE_SOURCE_EXTENSIONS,
        }).blind,
        [],
    );

    // An extension OUTSIDE the vocabulary is not this gate's business: the census half
    // decides whether `.vue` is a source, and if the answer stays "no" a walker skipping
    // it is right. Getting this backwards would make the gate fire on correct code.
    expect(
        'an unvocalised extension in scope is not blindness',
        difference({
            scope: ['pkg/src/a.ts', 'pkg/src/demo.vue'],
            reads: ['pkg/src/a.ts'],
            extensions: CODE_SOURCE_EXTENSIONS,
        }).blind,
        [],
    );

    // The TS half is narrower than the code half on purpose — a walker over compiled
    // TypeScript is not blind for skipping a `.mjs` build script.
    expect(
        'the TypeScript half does not demand .mjs',
        difference({
            scope: ['pkg/src/a.ts', 'pkg/build.mjs'],
            reads: ['pkg/src/a.ts'],
            extensions: TS_SOURCE_EXTENSIONS,
        }).blind,
        [],
    );

    // THE SPLIT, pinned. The census half only ever weighs the UNION, so an extension
    // MOVED from one half of the vocabulary to the other leaves it green and every vector
    // above green too — while `source-graph` and `suite-registration` both take their
    // subject from the TypeScript half. Measured: with `tsx` in `JS_SOURCE_EXTENSIONS`, a
    // staged `pkg/src/probe.tsx` and `pkg/src/probe.spec.tsx` were invisible to both and
    // this script exited 0. Derived from the spelling rather than listed again — every
    // TypeScript suffix contains `ts` and no JavaScript one does — so this stays a rule
    // about the vocabulary and not a fourth copy of it.
    expect(
        'every TypeScript extension is in the TypeScript half',
        CODE_SOURCE_EXTENSIONS.filter((ext) => ext.includes('ts') && !TS_SOURCE_EXTENSIONS.includes(ext)),
        [],
    );
    expect(
        '…and no JavaScript extension is',
        TS_SOURCE_EXTENSIONS.filter((ext) => !ext.includes('ts')),
        [],
    );

    expect(
        'a probe that answered nothing reports empty, not clean',
        difference({ scope: ['pkg/src/a.ts'], reads: [], extensions: CODE_SOURCE_EXTENSIONS }).empty,
        true,
    );
    expect(
        'a scope probe that answered nothing reports empty too',
        difference({ scope: [], reads: ['pkg/src/a.ts'], extensions: CODE_SOURCE_EXTENSIONS }).empty,
        true,
    );

    expect(
        'a read outside the declared scope makes the two lists incomparable',
        difference(
            { scope: ['pkg/src/a.ts'], reads: ['pkg/src/a.ts', 'other/b.ts'], extensions: CODE_SOURCE_EXTENSIONS },
            () => true,
        ).outside,
        ['other/b.ts'],
    );
    // Untracked files a walk found are not a disagreement — a scratch repro in the tree
    // would otherwise report as one, which is the noise that trains people to skip a gate.
    expect(
        'an UNTRACKED read is not a disagreement',
        difference(
            { scope: ['pkg/src/a.ts'], reads: ['pkg/src/a.ts', 'scratch.ts'], extensions: CODE_SOURCE_EXTENSIONS },
            (file) => file !== 'scratch.ts',
        ).outside,
        [],
    );

    return { failures, vectors };
}

const reports = [];
for (const walker of WALKERS) {
    const result = difference({ ...walker.measure(), extensions: walker.extensions }, (file) => trackedSet.has(file));
    if (result.empty) {
        console.error(
            `check-source-visibility: walker '${walker.id}' answered with an empty set ` +
                `(scope ∩ vocabulary ${result.subject.length}, read ${result.read.size}). A difference ` +
                'against nothing is not a measurement — the probe broke, not the tree.',
        );
        process.exit(2);
    }
    reports.push({ walker, ...result });
}

const notASuperset = reports.filter((report) => report.outside.length > 0);

const undeclared = [];
const matched = new Map(EXEMPT.map((entry) => [entry.prefix, []]));
for (const report of reports) {
    for (const file of report.blind) {
        const hit = EXEMPT.find(
            (entry) =>
                entry.walker === report.walker.id && (file === entry.prefix || file.startsWith(`${entry.prefix}/`)),
        );
        if (hit) matched.get(hit.prefix).push(file);
        else undeclared.push({ walker: report.walker, file });
    }
}
const staleExemptions = EXEMPT.filter((entry) => matched.get(entry.prefix).length === 0);

// ── the verdict ─────────────────────────────────────────────────────────────

if (LIST) {
    for (const [ext, files] of [...byExtension].sort()) {
        const verdict = CODE_SOURCE_EXTENSIONS.includes(ext) ? 'source' : declared.has(ext) ? 'declared' : 'UNKNOWN';
        console.log(`.${ext.padEnd(6)} ${String(files.length).padStart(5)} file(s)  ${verdict}`);
        // The reason is the whole content of a declaration; unprintable, it is a claim
        // nobody can weigh without opening this file.
        if (declared.has(ext)) console.log(`         ${declared.get(ext).why}`);
    }
    for (const report of reports) {
        console.log(
            `${report.walker.id.padEnd(20)} scope∩vocabulary ${String(report.subject.length).padStart(5)}  ` +
                `read ${String(report.read.size).padStart(5)}  blind ${report.blind.length}`,
        );
    }
}

let failed = false;

if (unclassified.length > 0) {
    failed = true;
    console.error('check-source-visibility: extensions oxlint reads that the source vocabulary does not name.\n');
    for (const ext of unclassified) {
        const files = byExtension.get(ext);
        console.error(`  .${ext}  (${files.length} tracked file(s), e.g. ${files[0]})`);
    }
    console.error(
        '\nEvery walker below decides what a source is by reading\n' +
            '`packages/infra/manifest-conformance/lib/source-extensions.mjs`. An extension missing\n' +
            'from it is code that every one of them walks past in silence, reporting the same green\n' +
            'as a clean tree — which is what `.tsx` did to three of them at once.\n' +
            'Either add the extension to that vocabulary, or add it to NOT_SOURCE in this script\n' +
            'with a reason that says what the files ARE and why a source walk is the wrong tool\n' +
            'for them.\n',
    );
}

if (staleDeclarations.length > 0) {
    failed = true;
    console.error('check-source-visibility: NOT_SOURCE entries that match no tracked file.\n');
    for (const entry of staleDeclarations) console.error(`  .${entry.ext}`);
    console.error(
        '\nA declaration matching nothing claims a decision was made about files that are gone, and\n' +
            "it is also this half's only control: if the census stopped seeing anything, this is\n" +
            'where it shows. Delete the entry, or find out why its files vanished.\n',
    );
}

if (notASuperset.length > 0) {
    failed = true;
    console.error('check-source-visibility: a walker reads tracked files its own scope probe does not list.\n');
    for (const report of notASuperset) {
        console.error(`  ${report.walker.id}: ${report.outside.slice(0, 5).join(', ')}`);
    }
    console.error(
        '\nThe two probes are not answering the same question, so the difference below means\n' +
            'nothing. Fix the scope probe before reading any blind count.\n',
    );
}

if (undeclared.length > 0) {
    failed = true;
    console.error("check-source-visibility: files a walker's own scope holds that it never opens.\n");
    for (const { walker, file } of undeclared) console.error(`  ${walker.id}  ${file}`);
    console.error('');
    for (const id of new Set(undeclared.map((entry) => entry.walker.id))) {
        const walker = WALKERS.find((entry) => entry.id === id);
        console.error(`  ${id}: ${walker.what}`);
    }
    console.error(
        '\nThese files are inside what the walker says it covers, at an extension the shared\n' +
            'vocabulary names, and the walker does not read them — so whatever it grades, it is not\n' +
            'grading these. Widen its filter to `source-extensions.mjs` rather than to a new literal;\n' +
            'a walker that keeps its own list is one that falls behind alone, which is exactly how\n' +
            'three of them ended up green over code nobody had checked.\n',
    );
}

if (staleExemptions.length > 0) {
    failed = true;
    console.error('check-source-visibility: EXEMPT entries that match nothing.\n');
    for (const entry of staleExemptions) console.error(`  ${entry.walker}  ${entry.prefix}`);
    console.error('\nDelete the entry, or find out why the file it named is no longer blind.\n');
}

if (failed) process.exit(1);

console.log(
    `check-source-visibility: ${lintable.length} tracked source file(s) across ` +
        `${byExtension.size} extension(s) — ${CODE_SOURCE_EXTENSIONS.filter((ext) => byExtension.has(ext)).length} in ` +
        `the vocabulary, ${NOT_SOURCE.length} declared out. ` +
        `${WALKERS.length} walker(s) read every file their own scope holds ` +
        `(${reports.map((report) => `${report.walker.id} ${report.subject.length}`).join(', ')}).`,
);
