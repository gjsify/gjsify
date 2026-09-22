#!/usr/bin/env node
// The Blueprint corpus is complete, and where the reference compiler exists, the
// committed goldens are still what it produces.
//
// WHY THIS EXISTS BEFORE A PARSER DOES
//
// ADR 0053 decided that Blueprint is parsed in this repo and that `blueprint-compiler`
// becomes the ORACLE rather than a build dependency. Its § Implementation puts the
// corpus first, for a reason worth repeating here: "a harness with nothing to compare
// reports green while proving nothing". So the first thing built is the thing to
// compare against, and this is the gate that keeps it honest in the meantime.
//
// FOUR STAGES, AND THE REPORT SAYS WHICH ONES RAN
//
//   A. COMPLETENESS — runs everywhere, needs no binary. Every rule file is listed
//      exactly once, goldened and given a hand-written `SharedNode` expectation; every
//      expectation is structurally a `SharedNode` and projects as many objects as the
//      golden holds; every loss names a line that exists; and every `.blp` tracked
//      anywhere in this repo is either a corpus rule or a reality probe. That last one
//      is what stops the probe from quietly falling behind the tree: a twelfth `.blp`
//      added to a showcase fails this until it is listed.
//
//   B. ORACLE — runs only where `blueprint-compiler` is on PATH. Recompiles every
//      corpus file and diffs against the committed goldens.
//
//   C. SHADOW — runs everywhere. Emits every corpus file with the in-repo parser and
//      holds it to the golden, excusing only what `corpus/divergences.mjs` names.
//
//   D. PROJECTION — runs everywhere. Holds every hand-written `SharedNode` tree against
//      what the projection produces.
//
//   E. REFUSALS — runs everywhere. Every file under `corpus/refused/` reaches one construct
//      the subset does not hold; the XML exit must refuse it BY NAME and BY LINE, the
//      projection must do what the manifest records of it, and stage B records what the
//      oracle does with the same file. Stages C and D see only what the parser accepts, so
//      this is the one stage that can measure ADR 0053 clause 3.
//
// The counts are printed, never written here: a live count in a comment is restatement,
// and this one was stale at "25 rules" one rule file later.
//
// Stage B is skipped, loudly and by name, wherever the binary is absent. That is the
// same two-stage shape ADR 0053 clause 7 asks of `check-doc-fences.mjs`, and it is the
// only shape that is honest here: the corpus must be complete on every runner, and the
// oracle cannot be. Note what the two stages measure: stage A is BOOKKEEPING over the
// corpus, and only stage B reads the language.
//
// …WHICH IS WHY THE SKIP IS A FAILURE WHERE THE BINARY IS PROMISED
//
// An announced skip is honest on a laptop and a hole in CI. `blueprint-compiler` is
// installed unpinned in `.docker/ci-fedora.Dockerfile`, so a rebuild can take it away —
// and this script would then print "stage B SKIPPED" into a 3000-line log and stay
// green, with every golden in the tree unverified from that day on. That is the failure
// class ADR 0053 names about `check-doc-fences.mjs` itself: "every other run of that
// script proves nothing about the fences". So the caller that KNOWS the binary must be
// there says so with `--require-oracle`, and its absence is then red rather than beige.
//
// In CI stage B runs in `tree-checks` — the one job that carries no classifier gate and
// whose image bakes `blueprint-compiler`, so a docs-only PR runs it too. Nine other jobs
// share that image and every one of them is gated on `changes.outputs.skip-all`; being
// the gate-free one is what makes this the right home, not the image alone. It reads
// `git ls-files`, so it runs as `testuser` there and not as root, or git refuses the
// tree as dubiously owned.
//
// A VERSION MISMATCH IS A FAILURE, NOT A NUISANCE
//
// The goldens record which compiler produced them. ADR 0053 clause 5: after an
// upstream release, a run that starts reporting IS the upgrade notice. So a different
// version fails with both numbers named, and the fix is a deliberate `--write` plus a
// look at what moved — never a silent re-record.
//
// `--write` therefore does the WHOLE of what that failure asks for, rather than the
// first third of it: it names the version change, lists every golden whose bytes
// actually moved, and moves `ORACLE.version` itself, so the re-recorded goldens and the
// version they came from land in one commit. Writing them and leaving the manifest
// behind would clear the diff — the only evidence of the upgrade — while leaving the
// tree failing with a message that has become untrue ("the goldens were recorded with
// <old>" when they were recorded seconds ago with <new>).
//
// Usage: node scripts/check-blueprint-corpus.mjs [--write] [--require-oracle] [--root <dir>]
//        --write           re-derive every golden from the reference compiler, and record
//                          which version produced them (needs the binary)
//        --require-oracle  fail instead of skipping when the binary is absent — for any
//                          caller whose environment promises it, CI first among them

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const write = args.includes('--write');
const requireOracle = args.includes('--require-oracle');
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

// A mistyped flag must not read as its own absence. `--require-oracles` silently
// disabling the requirement is the same class of defect this script exists to catch,
// one level up: a gate whose teeth were removed by a typo nobody sees.
const KNOWN_FLAGS = new Set(['--write', '--require-oracle', '--root']);
const stray = args.filter((a, i) => !(rootFlag !== -1 && i === rootFlag + 1) && !KNOWN_FLAGS.has(a));
if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
    console.error(
        `check-blueprint-corpus: ${stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory'}\n` +
            '  usage: node scripts/check-blueprint-corpus.mjs [--write] [--require-oracle] [--root <dir>]',
    );
    process.exit(2);
}

const CORPUS = join(root, 'packages/infra/blueprint/corpus');
const MANIFEST = join(CORPUS, 'manifest.mjs');
const RULES_DIR = join(CORPUS, 'rules');
const REAL_DIR = join(CORPUS, 'real');
const REFUSED_DIR = join(CORPUS, 'refused');

const { ORACLE, CORPUS_RULES, CORPUS_REAL_FILES, CORPUS_REFUSALS } = await import(
    `file://${join(CORPUS, 'manifest.mjs')}`
);
const { RULE_EXPECTATIONS } = await import(`file://${join(CORPUS, 'expectations.mjs')}`);
const { SHADOW_DIVERGENCES } = await import(`file://${join(CORPUS, 'divergences.mjs')}`);
const { REAL_EXPECTATIONS } = await import(`file://${join(CORPUS, 'real-expectations.mjs')}`);

// Kept in step with the `LossKind` typedef in `corpus/expectations.mjs` by hand, because
// a JSDoc union is not readable at runtime. A kind used there and missing here fails
// stage A, which is the direction that matters: an unnamed loss is the defect.
const LOSS_KINDS = new Set([
    // NO `template`, NO `object-id`, NO `translatable` and NO `styles`: ADR 0066 gave the first
    // two a field on the node, ADR 0067 the third and ADR 0068 the fourth, so declaring any of
    // them as a loss here is now the defect rather than the bookkeeping. `value-list` STAYED
    // and is the one to read carefully: it is where a bracketed value that is NOT a style class
    // still leaves — `widgets [ ]` is object references, `strings [ ]` emits as `<items>` — and
    // where an ident inside either style-class spelling leaves too, since the reference compiler
    // refuses that construct and there is no oracle for it. `translation-domain` stayed because
    // it is a fact about the FILE and this shape is a tree, ADR 0067 § 4.
    'signal',
    'binding',
    'breakpoint',
    'menu',
    'layout',
    'accessibility',
    'comment',
    'value-list',
    'sibling-object',
    'responses',
    'extern',
    'inline-template',
    // The six bracketed lists, each by its own name — see `project.mjs`.
    'marks',
    'items',
    'offsets',
    'mime-types',
    'patterns',
    'suffixes',
    'internal-child',
    'translation-domain',
    'action-widget',
]);

const NODE_FIELDS = new Set(['tag', 'id', 'template', 'slot', 'props', 'translatable', 'styleClasses', 'children']);

const problems = [];

const fail = () => {
    console.error('check-blueprint-corpus: FAILED\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
};

/** A `SharedNode` is eight optional-ish fields and three value kinds; hold it to that. */
const validateNode = (node, where, isRoot = true) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        problems.push(`${where}: expected a SharedNode object, got ${JSON.stringify(node)}.`);
        return;
    }
    for (const key of Object.keys(node)) {
        if (!NODE_FIELDS.has(key)) {
            problems.push(`${where}: "${key}" is not a SharedNode field (${[...NODE_FIELDS].join(', ')}).`);
        }
    }
    if (typeof node.tag !== 'string' || node.tag.length === 0) {
        problems.push(`${where}: "tag" must be a non-empty GIR class name.`);
    } else if (node.tag.includes('.')) {
        problems.push(
            `${where}: "tag" is "${node.tag}", the dotted Blueprint spelling. SharedNode tags are GIR ` +
                'class names — "Adw.Bin" is "AdwBin".',
        );
    }
    if (node.slot !== undefined && (typeof node.slot !== 'string' || node.slot.length === 0)) {
        problems.push(`${where}: "slot" must be a non-empty string when present.`);
    }
    if (node.id !== undefined && (typeof node.id !== 'string' || node.id.length === 0)) {
        problems.push(`${where}: "id" must be a non-empty string when present.`);
    }
    // `template` says what the TREE defines, so a second one inside it would be a second
    // document — which is `inline-template`, and that is a declared loss with its own id
    // scope. A nested `template` is therefore not a smaller claim, it is the wrong one.
    if (node.template !== undefined) {
        if (typeof node.template !== 'string' || node.template.length === 0) {
            problems.push(`${where}: "template" must be a non-empty class name when present.`);
        } else if (!isRoot) {
            problems.push(
                `${where}: "template" is on a CHILD node. It names the class the whole tree defines, ` +
                    'so only the root may carry one.',
            );
        }
    }
    if (node.props !== undefined) {
        for (const [key, value] of Object.entries(node.props)) {
            const kind = typeof value;
            if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') {
                problems.push(
                    `${where}: prop "${key}" is a ${Array.isArray(value) ? 'list' : kind}. SharedNode props ` +
                        'hold string, number or boolean only — a richer value is a LOSS to declare, not a prop.',
                );
            }
        }
    }
    // A marking is ABOUT a prop, so one that names no prop marks nothing — and that is the
    // shape of the mistake worth catching here: a tree that says `translatable: { titel: {} }`
    // beside `props: { title: … }` is a claim about a property this node does not have, and
    // stage D would then report it as a whole-tree mismatch rather than as the typo it is.
    if (node.translatable !== undefined) {
        for (const [key, marking] of Object.entries(node.translatable)) {
            if (node.props?.[key] === undefined) {
                problems.push(
                    `${where}: "translatable" marks "${key}", which is not one of this node's props. ` +
                        'A marking sits beside the value it marks.',
                );
            } else if (typeof node.props[key] !== 'string') {
                problems.push(
                    `${where}: "translatable" marks "${key}", whose value is a ${typeof node.props[key]}. ` +
                        'Only a string is translatable.',
                );
            }
            const extra = Object.keys(marking ?? {}).filter((field) => field !== 'context');
            if (marking === null || typeof marking !== 'object' || extra.length > 0) {
                problems.push(
                    `${where}: the marking on "${key}" is ${JSON.stringify(marking)}. It holds an optional ` +
                        '"context" and nothing else — `{}` is `_()`, `{ context }` is `C_()`.',
                );
            }
        }
    }
    // A style class is a NAME, and the two things worth catching here are an empty list and a
    // name with whitespace in it. The first is a claim that says nothing — absence is what says
    // "no style classes" — and the second cannot survive ADR 0049 § 3's space-joined write door,
    // so a tree carrying one would be authoring something no surface can set.
    if (node.styleClasses !== undefined) {
        if (!Array.isArray(node.styleClasses) || node.styleClasses.length === 0) {
            problems.push(
                `${where}: "styleClasses" is ${JSON.stringify(node.styleClasses)}. It is a non-empty list of ` +
                    'class names; absence is what says a node carries none.',
            );
        } else {
            for (const name of node.styleClasses) {
                if (typeof name !== 'string' || name.length === 0 || /\s/.test(name)) {
                    problems.push(
                        `${where}: "styleClasses" holds ${JSON.stringify(name)}. A style class is one name with ` +
                            "no whitespace — ADR 0049 § 3's door is space-separated, so a name with a space in " +
                            'it is two classes on every surface that writes it.',
                    );
                }
            }
        }
    }
    if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
            problems.push(`${where}: "children" must be an array.`);
            return;
        }
        node.children.forEach((child, i) => validateNode(child, `${where} > children[${i}]`, false));
    }
};

const countNodes = (node) => 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);

/**
 * How many GtkBuilder OBJECTS the reference compiler emitted for a file. `<template>` is
 * the root object of a composite template and counts as one; `<menu>` is a `GMenuModel`
 * and not an object at all, which is why a `menu` loss does not appear below.
 */
/**
 * The objects of ONE document.
 *
 * A CDATA section is stripped first, and that is a statement about what is being counted
 * rather than a convenience: the `template Type { … }` block of a `Gtk.BuilderListItemFactory`
 * embeds a SECOND, complete GtkBuilder document — its own `<?xml?>` declaration, its own
 * `<interface>`, its own id scope, which the reference implementation says may not reference
 * the outer one or be referenced by it. Counting its objects here would hold the projection of
 * one document against the object count of two, and the only way to satisfy that would be to
 * declare losses for objects the projection was never asked about.
 */
const goldenObjects = (xml) => {
    const single = xml.replaceAll(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    return (single.match(/<object /g) ?? []).length + (single.match(/<template /g) ?? []).length;
};

/**
 * The loss kinds that drop a whole OBJECT rather than an attribute of one. Measured
 * against every golden in the corpus, not assumed: `breakpoint` (an `Adw.Breakpoint` is an
 * `<object>` that `SharedNode` has no tag for) and `sibling-object` (a second top-level
 * object the one-tree projection has to leave behind). Every other kind drops something
 * inside an object that still projects.
 */
const OBJECT_SHAPED_LOSSES = new Set(['breakpoint', 'sibling-object']);

/** A file's source line count, not counting the phantom element a trailing newline splits off. */
const lineCount = (text) => (text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length);

// ---------------------------------------------------------------- stage A

/**
 * The corpus tables are LISTS, so a duplicate entry is expressible — and it passes every
 * other check here while inflating the two counts the report prints. That matters
 * because those counts are the only thing standing between a shrinking corpus and a
 * green run (see the note above the final `console.log`): delete a rule, list a
 * surviving one twice, and the headline is byte-identical to a healthy tree.
 *
 * @param {readonly object[]} entries @param {string} key @param {string} label
 */
const refuseDuplicates = (entries, key, label) => {
    const seen = new Set();
    for (const entry of entries) {
        const value = entry[key];
        if (seen.has(value)) {
            problems.push(
                `${label} lists "${value}" twice. A duplicate entry raises the count this run reports without ` +
                    'adding a file, which is exactly how a corpus shrinks behind an unchanged headline.',
            );
        }
        seen.add(value);
    }
};

refuseDuplicates(CORPUS_RULES, 'file', 'CORPUS_RULES');
refuseDuplicates(CORPUS_REAL_FILES, 'source', 'CORPUS_REAL_FILES');
refuseDuplicates(CORPUS_REAL_FILES, 'slug', 'CORPUS_REAL_FILES (slug)');
refuseDuplicates(CORPUS_REFUSALS, 'file', 'CORPUS_REFUSALS');

const onDisk = existsSync(RULES_DIR)
    ? readdirSync(RULES_DIR)
          .filter((f) => f.endsWith('.blp'))
          .sort()
    : [];
const listed = CORPUS_RULES.map((r) => r.file);

for (const file of onDisk) {
    if (!listed.includes(file)) {
        problems.push(
            `corpus/rules/${file} is on disk and not in CORPUS_RULES. A rule nobody listed is a rule nobody reads.`,
        );
    }
}
for (const rule of CORPUS_RULES) {
    if (!onDisk.includes(rule.file)) {
        problems.push(`CORPUS_RULES lists "${rule.file}", which is not in corpus/rules/.`);
        continue;
    }
    // Not under `--write`, which is on its way to creating exactly this file: reporting
    // "run this with --write" from the run that WAS `--write` reads as a broken fix.
    if (!write && !existsSync(join(RULES_DIR, rule.file.replace(/\.blp$/, '.ui')))) {
        problems.push(
            `corpus/rules/${rule.file} has no committed golden. Run this with --write where the compiler is installed.`,
        );
    }
    if (typeof rule.isolates !== 'string' || rule.isolates.length === 0) {
        problems.push(`CORPUS_RULES entry "${rule.file}" does not say what it isolates.`);
    }
}

const refusedOnDisk = existsSync(REFUSED_DIR)
    ? readdirSync(REFUSED_DIR)
          .filter((f) => f.endsWith('.blp'))
          .sort()
    : [];
for (const file of refusedOnDisk) {
    if (!CORPUS_REFUSALS.some((r) => r.file === file)) {
        problems.push(
            `corpus/refused/${file} is on disk and not in CORPUS_REFUSALS. A refusal nobody listed is never run.`,
        );
    }
}
for (const refusal of CORPUS_REFUSALS) {
    if (!refusedOnDisk.includes(refusal.file)) {
        problems.push(`CORPUS_REFUSALS lists "${refusal.file}", which is not in corpus/refused/.`);
        continue;
    }
    const lines = lineCount(readFileSync(join(REFUSED_DIR, refusal.file), 'utf8'));
    if (typeof refusal.construct !== 'string' || refusal.construct.length === 0) {
        problems.push(`CORPUS_REFUSALS entry "${refusal.file}" does not say which construct it reaches.`);
    }
    if (refusal.oracle !== 'compiles' && refusal.oracle !== 'refuses') {
        problems.push(`CORPUS_REFUSALS entry "${refusal.file}" must say whether the oracle compiles or refuses it.`);
    }
    if (refusal.projection !== 'refuses' && refusal.projection !== 'projects') {
        problems.push(
            `CORPUS_REFUSALS entry "${refusal.file}" must say whether the projection refuses or projects it.`,
        );
    }
    if (!Number.isInteger(refusal.line) || refusal.line < 1 || refusal.line > lines) {
        problems.push(
            `CORPUS_REFUSALS entry "${refusal.file}" names line ${refusal.line}, but the file has ${lines} line(s).`,
        );
    }
    if (typeof refusal.names !== 'string' || refusal.names.length === 0) {
        problems.push(`CORPUS_REFUSALS entry "${refusal.file}" does not say what the error must name.`);
    }
}

for (const probe of CORPUS_REAL_FILES) {
    if (!existsSync(join(root, probe.source))) {
        problems.push(`CORPUS_REAL_FILES points at ${probe.source}, which does not exist.`);
    }
    if (!write && !existsSync(join(REAL_DIR, `${probe.slug}.ui`))) {
        problems.push(`corpus/real/${probe.slug}.ui is missing for ${probe.source}.`);
    }
}

// Every expectation lines up with a corpus file, and every corpus file with one
// expectation. ADR 0053 clause 2 wants a hand-written tree per file, and a file whose
// expectation was forgotten is exactly the one a parser would be graded on last.
const checkExpectations = (expectations, keys, label, goldenFor) => {
    const seen = new Set();
    for (const exp of expectations) {
        if (!keys.includes(exp.file)) {
            problems.push(`${label} has an entry for "${exp.file}", which is not in the corpus.`);
            continue;
        }
        if (seen.has(exp.file)) problems.push(`${label} has two entries for "${exp.file}".`);
        seen.add(exp.file);
        const before = problems.length;
        validateNode(exp.node, `${label} "${exp.file}"`);
        // The SIZE of the claim, against the only measurement available without a
        // parser: the committed golden's own object count. Structural validity says a
        // one-node stub is a well-formed `SharedNode`, and a 14-node expectation
        // collapsed to `{ tag: 'AdwApplicationWindow' }` passed everything else here —
        // that is the shape of an expectation refactored away rather than written.
        //
        // NOT a claim that the two files are views of the same VALUES: they are not, and
        // `expectations.mjs` says so (`orientation: vertical` projects as the string and
        // emits `1`). This counts objects, which both notations agree on once the losses
        // that drop a whole object are added back.
        if (problems.length === before) {
            const goldenPath = goldenFor(exp.file);
            const golden = existsSync(goldenPath) ? readFileSync(goldenPath, 'utf8') : null;
            const dropped = (exp.lost ?? []).filter((l) => OBJECT_SHAPED_LOSSES.has(l.kind)).length;
            const projected = countNodes(exp.node) + dropped;
            if (golden !== null && goldenObjects(golden) !== projected) {
                problems.push(
                    `${label} "${exp.file}": the golden emits ${goldenObjects(golden)} object(s) and the ` +
                        `expectation accounts for ${projected} (${countNodes(exp.node)} node(s) + ${dropped} ` +
                        'object-shaped loss(es)). Either the tree is missing nodes or an object it drops is ' +
                        'not declared as a loss.',
                );
            }
        }
        const source = join(
            root,
            label === 'RULE_EXPECTATIONS' ? join('packages/infra/blueprint/corpus/rules', exp.file) : exp.file,
        );
        const lines = existsSync(source) ? lineCount(readFileSync(source, 'utf8')) : 0;
        for (const loss of exp.lost ?? []) {
            if (!LOSS_KINDS.has(loss.kind)) {
                problems.push(`${label} "${exp.file}": loss kind "${loss.kind}" is not in the declared vocabulary.`);
            }
            if (!Number.isInteger(loss.line) || loss.line < 1 || loss.line > lines) {
                problems.push(`${label} "${exp.file}": loss on line ${loss.line}, but the file has ${lines} line(s).`);
            }
            if (typeof loss.detail !== 'string' || loss.detail.length === 0) {
                problems.push(
                    `${label} "${exp.file}": a loss on line ${loss.line} says what kind it is and not what is lost.`,
                );
            }
        }
    }
    for (const key of keys) {
        if (!seen.has(key))
            problems.push(`${label} has no entry for "${key}" (ADR 0053 clause 2 wants one per corpus file).`);
    }
};

const slugFor = new Map(CORPUS_REAL_FILES.map((p) => [p.source, p.slug]));

checkExpectations(RULE_EXPECTATIONS, listed, 'RULE_EXPECTATIONS', (file) =>
    join(RULES_DIR, file.replace(/\.blp$/, '.ui')),
);
checkExpectations(
    REAL_EXPECTATIONS,
    CORPUS_REAL_FILES.map((p) => p.source),
    'REAL_EXPECTATIONS',
    (file) => join(REAL_DIR, `${slugFor.get(file)}.ui`),
);

// The probe must not fall behind the tree it probes.
const tracked = spawnSync('git', ['-C', root, 'ls-files', '--', '*.blp'], { encoding: 'utf8' });
if (tracked.status !== 0) {
    // `stderr` is null when the binary itself is missing, so read the spawn error first.
    // A gate that throws here reports nothing at all, which is worse than the failure it
    // was trying to describe.
    const why = tracked.error ? tracked.error.message : (tracked.stderr ?? '').trim();
    problems.push(`git ls-files failed, so the reality probe could not be checked against the tree: ${why}`);
} else {
    const corpusOwn = new Set([
        ...CORPUS_RULES.map((r) => `packages/infra/blueprint/corpus/rules/${r.file}`),
        ...CORPUS_REFUSALS.map((r) => `packages/infra/blueprint/corpus/refused/${r.file}`),
    ]);
    const probed = new Set(CORPUS_REAL_FILES.map((p) => p.source));
    for (const path of tracked.stdout.split('\n').filter(Boolean)) {
        if (corpusOwn.has(path) || probed.has(path)) continue;
        problems.push(
            `${path} is a tracked .blp that no corpus entry covers. Add it to CORPUS_REAL_FILES with a ` +
                'golden and a hand-written expectation — the reality probe is only a probe while it is complete.',
        );
    }
}

// ---------------------------------------------------------------- stage B

const version = spawnSync('blueprint-compiler', ['--version'], { encoding: 'utf8' });
const havecompiler = version.status === 0;
const installed = havecompiler ? version.stdout.trim() : null;

if (!havecompiler && requireOracle) {
    const why = version.error ? version.error.message : (version.stderr ?? '').trim() || `exit ${version.status}`;
    problems.push(
        `--require-oracle was passed and \`${ORACLE.tool}\` did not answer, so stage B checked nothing: ${why}. ` +
            'Every golden in the tree is unverified on this run. In CI that means the ci-fedora image lost the ' +
            'package it installs unpinned in `.docker/ci-fedora.Dockerfile`.',
    );
}
if (!havecompiler && write) {
    problems.push(`--write needs \`${ORACLE.tool}\` on PATH, and nothing was re-derived.`);
}

let compared = 0;
let classified = 0;
let rewritten = 0;
if (havecompiler) {
    if (installed !== ORACLE.version && !write) {
        problems.push(
            `the goldens were recorded with ${ORACLE.tool} ${ORACLE.version} and this machine has ${installed}. ` +
                'Per ADR 0053 clause 5 that is the upgrade notice: re-derive with --write, read the diff, and ' +
                'move ORACLE.version in corpus/manifest.mjs in the same commit.',
        );
    }
    const jobs = [
        ...CORPUS_RULES.map((r) => ({
            source: join(RULES_DIR, r.file),
            golden: join(RULES_DIR, r.file.replace(/\.blp$/, '.ui')),
            name: `rules/${r.file}`,
        })),
        ...CORPUS_REAL_FILES.map((p) => ({
            source: join(root, p.source),
            golden: join(REAL_DIR, `${p.slug}.ui`),
            name: p.source,
        })),
    ];
    for (const job of jobs) {
        if (!existsSync(job.source)) continue;
        const run = spawnSync('blueprint-compiler', ['compile', job.source], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
        if (run.status !== 0) {
            problems.push(`${job.name} no longer compiles: ${(run.stderr || '').trim().split('\n')[0]}`);
            continue;
        }
        if (write) {
            // Read before writing: "read the diff" is the middle third of what the
            // version-mismatch failure asks for, and it is the third that disappears the
            // moment the bytes are overwritten. Naming the files here puts it in the run.
            const had = existsSync(job.golden) ? readFileSync(job.golden, 'utf8') : null;
            if (had !== run.stdout) {
                rewritten += 1;
                console.log(`  re-recorded ${job.name}${had === null ? ' (new)' : ''}`);
            }
            writeFileSync(job.golden, run.stdout);
            continue;
        }
        const golden = existsSync(job.golden) ? readFileSync(job.golden, 'utf8') : null;
        if (golden === null) continue; // already reported by stage A
        compared += 1;
        if (golden !== run.stdout) {
            const a = golden.split('\n');
            const b = run.stdout.split('\n');
            const i = a.findIndex((line, n) => line !== b[n]);
            problems.push(
                `${job.name}: the committed golden is not what ${ORACLE.tool} ${installed} produces. ` +
                    `First difference on line ${i + 1}:\n      golden: ${JSON.stringify(a[i])}\n      now:    ${JSON.stringify(b[i])}`,
            );
        }
    }

    // A refused file is classified by what the ORACLE does with it, so the table can say which
    // refusals are limits of the subset (the oracle compiles the file) and which are errors the
    // two compilers share. The verdict is held here, where the compiler is, and never written
    // out: a golden for a file the parser refuses would be a golden nothing can be held to.
    for (const refusal of CORPUS_REFUSALS) {
        const source = join(REFUSED_DIR, refusal.file);
        if (!existsSync(source)) continue;
        const run = spawnSync('blueprint-compiler', ['compile', source], { encoding: 'utf8' });
        const verdict = run.status === 0 ? 'compiles' : 'refuses';
        classified += 1;
        if (verdict === refusal.oracle) continue;
        problems.push(
            `refused/${refusal.file}: CORPUS_REFUSALS says the oracle ${refusal.oracle} it, and ${ORACLE.tool} ` +
                `${installed} ${verdict}${run.status === 0 ? '' : `: ${(run.stderr || '').trim().split('\n')[0]}`}. ` +
                'Reclassify it: a refusal that stops being a shared error is the oracle moving, and one that ' +
                'stops being a subset limit is the subset catching up.',
        );
    }

    // The version bump travels WITH the goldens or the tree is left in a state that
    // fails while describing itself wrongly — "recorded with <old>" about files this run
    // recorded with <new>. ADR 0053 clause 5 wants the upgrade visible; after a `--write`
    // the goldens no longer differ, so the manifest line is the only place left for it to
    // be visible, and a human editing it by hand afterwards is a step that gets skipped.
    if (write && installed !== ORACLE.version) {
        const before = readFileSync(MANIFEST, 'utf8');
        const after = before
            .replace(/(\n\s*version: ')[^']*(',)/, `$1${installed}$2`)
            .replace(/(\n\s*recordedOn: ')[^']*(',)/, `$1${new Date().toISOString().slice(0, 10)}$2`);
        if (after === before) {
            problems.push(
                `the goldens were re-derived with ${ORACLE.tool} ${installed} but ORACLE.version could not be ` +
                    `moved off ${ORACLE.version} in corpus/manifest.mjs — edit it by hand before committing.`,
            );
        } else {
            writeFileSync(MANIFEST, after);
            console.log(
                `  ORACLE.version ${ORACLE.version} -> ${installed} in corpus/manifest.mjs; ` +
                    `${rewritten} golden(s) moved. READ THAT DIFF — it is the upgrade notice, and it is the ` +
                    'whole reason a version mismatch is a failure rather than an auto-update.',
            );
        }
    }
}

// ---------------------------------------------------------------- stage C

// The SHADOW RUN of ADR 0053 clause 5: the in-repo parser reads every corpus file, the
// emitter writes GtkBuilder XML from the AST, and the result is diffed against the golden
// the reference compiler produced. `blueprint-compiler` stays authoritative for the build
// until this stage is silent.
//
// It needs no compiler, only the committed goldens — so unlike stage B it runs on EVERY
// runner, which is the whole reason the goldens are committed at all.
//
// THERE IS NO SKIP PATH, AND THERE WAS ONE
//
// This stage arrived with `haveParser = existsSync(PARSER) && existsSync(EMITTER)` and a
// comment saying that once `src/parser.mjs` exists there is no skip path. Both halves of the
// conjunction had to hold, so deleting `src/emit-xml.mjs` alone printed "stage C SKIPPED —
// there is no parser in this tree yet, which is the only reason it can be" and exited 0, with
// `parser.mjs` sitting right beside it; deleting `src/project.mjs` did the same to stage D.
// That is precisely the shape `--require-oracle` was added to stage B to close, one stage
// over: a gate reporting green because it could not run, in a message that was not true.
//
// So the three files are REQUIRED. Unlike `blueprint-compiler` they are in this repository,
// which means their absence is never an environment and always a deletion, and no flag needs
// to be passed to say so.
const PARSER = join(CORPUS, '..', 'src', 'parser.mjs');
const EMITTER = join(CORPUS, '..', 'src', 'emit-xml.mjs');
const PROJECTOR = join(CORPUS, '..', 'src', 'project.mjs');
const RESOLVER = join(CORPUS, '..', 'src', 'resolve-ident.mjs');

for (const [what, path] of [
    ['parser', PARSER],
    ['emitter', EMITTER],
    ['projection', PROJECTOR],
    // The resolver is required for the same reason the other three are, and for one more:
    // without it stage C does not CRASH, it quietly reports eleven divergences the emitter
    // can no longer excuse, because the ledger that used to hold them is gone. A missing
    // file that turns a gate red in a message about the wrong thing is worse than one that
    // names itself, so it names itself here.
    ['enum resolver', RESOLVER],
]) {
    if (!existsSync(path)) {
        problems.push(
            `the ${what} is missing at ${path.slice(root.length + 1)}, so the stage that runs it checked ` +
                'nothing. It lives in this repository, so this is a deletion and not an environment — ' +
                'restore it or delete the stage deliberately.',
        );
    }
}

const haveParser = existsSync(PARSER) && existsSync(EMITTER) && existsSync(RESOLVER);

// THROUGH THE PACKAGE BOUNDARY, NOT AROUND IT
//
// The files above are checked BY PATH, because a deletion is the thing to name and a path is
// the only address a deleted file still has. They are IMPORTED by specifier, because that is
// the surface ADR 0053 clause 5 hands `@gjsify/vite-plugin-blueprint`, and a gate that reaches
// past `exports` proves nothing about it: this script read `src/parser.mjs` directly for as
// long as `package.json` exported nothing but the corpus, so every green run was compatible
// with a package that no consumer could import at all.
//
// The two diagnoses stay different sentences, which is the whole reason the path check above
// was not replaced by this one. A missing FILE is named up there. A missing EXPORT is named
// below, by name. A package that resolves to neither — no `exports` entry for it, or a
// workspace that was never installed — is named here as the boundary it is.
//
// Resolved from `--root` rather than from this file, because `--root` means "the tree to
// measure" and a bare specifier would resolve against the tree this SCRIPT sits in: another
// tree's goldens held against this one's parser, silently, which is the shape of every defect
// in this file's header.
const SURFACE = '@gjsify/blueprint';
// The WHOLE surface and not the six names this file happens to call: an export nothing here
// reads is still a promise the flip's consumer will hold the package to, and a gate that only
// asserts its own diet is how `BlueprintSyntaxError` disappears with every stage still green.
// A class is a function, so one test holds all nine.
const SURFACE_NAMES = [
    'BlueprintEmitError',
    'BlueprintSyntaxError',
    'accessibilityElement',
    'accessibilityValue',
    'emitGtkBuilderXml',
    'enumOrFlagsTypeOf',
    'gtypeName',
    'parseBlueprint',
    'propertyGType',
    'resolveIdent',
];

/** @type {Record<string, Function> | undefined} */
let surface;
if (haveParser) {
    try {
        surface = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve(SURFACE)).href);
    } catch (error) {
        problems.push(
            `${SURFACE} does not resolve from ${root}, so stages C, D and E ran nothing — ${error.message}. ` +
                'The files are all there (the check above passed), so this is the package boundary and not a ' +
                'deletion: either `exports` has no entry for the surface, or this tree was never installed.',
        );
    }
    // Every missing name, not the first: a rename that moved four of the five resolver seams
    // should print four lines and not one, or the next run finds the second one.
    const absent = surface === undefined ? [] : SURFACE_NAMES.filter((n) => typeof surface[n] !== 'function');
    if (absent.length > 0) {
        problems.push(
            `${SURFACE} resolves, but exports no ${absent.map((n) => `\`${n}\``).join(', ')}. The file that ` +
                'implements each is present, so this is the surface and not the implementation — an `export` was ' +
                'dropped, or `src/index.mjs` stopped re-exporting it. The flip of ADR 0053 clause 5 consumes ' +
                'exactly these names, so the stages below ran nothing rather than measure a surface it cannot use.',
        );
        surface = undefined;
    }
}

let byteEqual = 0;
let ledgered = 0;
if (surface !== undefined) {
    const {
        accessibilityElement,
        accessibilityValue,
        emitGtkBuilderXml,
        enumOrFlagsTypeOf,
        gtypeName,
        parseBlueprint,
        resolveIdent,
    } = surface;

    const known = new Map(SHADOW_DIVERGENCES.map((entry) => [entry.file, entry]));
    for (const entry of SHADOW_DIVERGENCES) {
        if (typeof entry.kind !== 'string' || entry.kind.length === 0) {
            problems.push(`corpus/divergences.mjs: the entry for "${entry.file}" has no kind.`);
        }
        if (typeof entry.reason !== 'string' || entry.reason.length < 20) {
            problems.push(
                `corpus/divergences.mjs: "${entry.file}" is tolerated with no reason worth reading. ` +
                    'An entry here is the only record that the disagreement was a decision.',
            );
        }
        // Without this an entry excused the whole FILE. Measured: an emitter taught to write
        // `<property name="THIS-IS-NOT-A-PROPERTY">SABOTAGE</property>` for every
        // `hscrollbar-policy` — five ledgered files, no byte-equal one — passed with the
        // headline unchanged. An exemption that does not name what it excuses is not data,
        // it is an off switch.
        if (!Array.isArray(entry.lines) || entry.lines.length === 0) {
            problems.push(
                `corpus/divergences.mjs: "${entry.file}" names no lines. An entry without \`lines\` excuses ` +
                    'every byte the file emits, which is the whole file unchecked behind one slug.',
            );
            continue;
        }
        for (const row of entry.lines) {
            if (!Number.isInteger(row?.line) || row.line < 1) {
                problems.push(`corpus/divergences.mjs: "${entry.file}" has a tolerated line that is not a line.`);
            }
            if (typeof row?.golden !== 'string' || typeof row?.inRepo !== 'string') {
                problems.push(
                    `corpus/divergences.mjs: "${entry.file}" line ${row?.line} does not say what stands on it. ` +
                        'Both sides are named so the diff is readable without running anything.',
                );
            }
        }
    }

    const shadowJobs = [
        ...CORPUS_RULES.map((r) => ({
            key: `rules/${r.file}`,
            source: join(RULES_DIR, r.file),
            golden: join(RULES_DIR, r.file.replace(/\.blp$/, '.ui')),
        })),
        ...CORPUS_REAL_FILES.map((p) => ({
            key: p.source,
            source: join(root, p.source),
            golden: join(REAL_DIR, `${p.slug}.ui`),
        })),
    ];

    for (const job of shadowJobs) {
        if (!existsSync(job.source) || !existsSync(job.golden)) continue; // stage A said so
        const golden = readFileSync(job.golden, 'utf8');
        let emitted;
        try {
            emitted = emitGtkBuilderXml(parseBlueprint(readFileSync(job.source, 'utf8'), job.key), {
                accessibilityElement,
                accessibilityValue,
                enumOrFlagsTypeOf,
                gtypeName,
                resolveIdent,
            });
        } catch (error) {
            // Never ledgerable. Clause 3 makes an unreadable construct a hard error naming its
            // line, so a corpus file the parser refuses is a gap in the parser or a file that
            // does not belong in the corpus — not a disagreement to tolerate.
            problems.push(`${job.key}: the parser refused it — ${error.message}`);
            continue;
        }
        const entry = known.get(job.key);
        if (emitted === golden) {
            byteEqual += 1;
            if (entry) {
                problems.push(
                    `${job.key} is byte-equal and still listed in corpus/divergences.mjs as "${entry.kind}". ` +
                        'Delete the entry — a ledger that only grows describes a parser nobody improved.',
                );
            }
            continue;
        }
        const a = golden.split('\n');
        const b = emitted.split('\n');
        // `findIndex` returns -1 when every line of the golden matches and the emitter merely
        // wrote MORE, so the first difference is the first line the golden does not have.
        const firstDiff = a.findIndex((line, n) => line !== b[n]);
        const i = firstDiff === -1 ? a.length : firstDiff;
        if (!entry) {
            problems.push(
                `${job.key}: the in-repo emitter does not reproduce the golden, and no entry in ` +
                    `corpus/divergences.mjs says why. First difference on line ${i + 1}:\n` +
                    `      golden:   ${JSON.stringify(a[i])}\n      in-repo:  ${JSON.stringify(b[i])}`,
            );
            continue;
        }

        // The entry excuses the lines it NAMES and nothing else. Two directions, both real: a
        // difference the ledger does not name is an unrecorded divergence, and a line the
        // ledger names that no longer differs is a claim that stopped being true.
        if (a.length !== b.length) {
            problems.push(
                `${job.key}: the emitter wrote ${b.length} line(s) where the golden has ${a.length}. A ` +
                    'ledger entry excuses named lines, and a length change moves every line after it — ' +
                    'so this is never one of them.',
            );
            continue;
        }
        const excused = new Map(entry.lines.map((row) => [row.line, row]));
        let honoured = 0;
        for (let n = 0; n < a.length; n += 1) {
            if (a[n] === b[n]) continue;
            const row = excused.get(n + 1);
            if (row === undefined) {
                problems.push(
                    `${job.key}: line ${n + 1} differs and corpus/divergences.mjs does not name it. The entry ` +
                        `is "${entry.kind}", which excuses [${entry.lines.map((r) => r.line).join(', ')}] and ` +
                        `nothing else:\n      golden:   ${JSON.stringify(a[n])}\n      in-repo:  ${JSON.stringify(b[n])}`,
                );
                continue;
            }
            honoured += 1;
            // Indentation is compared on its own so the stored text can stay readable without
            // the comparison becoming loose: a divergence that is ONLY leading whitespace is
            // still a divergence, and a trimmed compare would call it tolerated.
            const indent = (line) => line.slice(0, line.length - line.trimStart().length);
            if (indent(a[n]) !== indent(b[n])) {
                problems.push(
                    `${job.key}: line ${row.line} is tolerated for its TEXT and the indentation moved — ` +
                        `${indent(a[n]).length} space(s) in the golden, ${indent(b[n]).length} emitted. ` +
                        'That is a separate divergence and this entry does not excuse it.',
                );
            } else if (a[n].trim() !== row.golden || b[n].trim() !== row.inRepo) {
                problems.push(
                    `${job.key}: line ${row.line} is tolerated, but not for what stands there now.\n` +
                        `      ledger golden:  ${JSON.stringify(row.golden)}\n      actual golden:  ${JSON.stringify(a[n].trim())}\n` +
                        `      ledger in-repo: ${JSON.stringify(row.inRepo)}\n      actual in-repo: ${JSON.stringify(b[n].trim())}`,
                );
            }
        }
        if (honoured !== entry.lines.length) {
            const taken = new Set(a.map((line, n) => (line === b[n] ? 0 : n + 1)));
            problems.push(
                `${job.key}: corpus/divergences.mjs excuses ${entry.lines.length} line(s) and only ${honoured} ` +
                    `still differ — [${entry.lines
                        .map((r) => r.line)
                        .filter((n) => !taken.has(n))
                        .join(', ')}] agree with the golden now. Delete them; a ledger that only grows ` +
                    'describes a parser nobody improved.',
            );
        }
        ledgered += 1;
    }
}

// ---------------------------------------------------------------- stage D

/**
 * The two ADDRESSING fields, held against the GOLDEN rather than against a second
 * hand-written copy of them — ADR 0066 clause 4.
 *
 * WHY THE GOLDEN AND NOT THE EXPECTATION. The expectations above already pin which NODE
 * carries which id, and a mistake there is a mistake in two files at once: the tree and the
 * projection can agree and both be wrong about the file, which is the failure mode ADR 0053
 * clause 2 wrote the hand-written trees to avoid and cannot itself detect. `<template class>`
 * and `id=` are attributes the reference compiler WRITES, so the oracle's own bytes are
 * available as the third opinion — and the two exits from one AST then cannot disagree about
 * one file's addressing without this saying so.
 *
 * CDATA IS STRIPPED FIRST, for the reason `goldenObjects` already states one screen up: an
 * inline `template` embeds a second, complete document with its own id scope, and
 * `51-inline-template.ui` carries `corpusFactory` and `<template class="GtkListItem">` twice
 * because of it. Counting the inner document here would demand ids of a projection that was
 * never handed that document.
 *
 * AN ID MAY BE MISSING ONLY WHERE THE OBJECT IS. `<menu>`, `<section>` and `<submenu>` ids
 * are GMenuModel and never a node, so they are not read at all. An `<object>` id the
 * projection does not carry has to belong to an object a declared loss took away — and the
 * loss has to NAME it, which is the one thing a `detail` is asked to do here: three files
 * drop a top-level sibling with an id, and "the whole `Gtk.Label labelA`" is what tells a
 * reader where the name went. An id that vanishes with nothing saying so is the defect.
 */
const checkAddressing = (job, result) => {
    if (!existsSync(job.golden)) return; // stage A said so
    addressed += result.node.template === undefined ? 0 : 1;
    const golden = readFileSync(job.golden, 'utf8').replaceAll(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const wantTemplate = golden.match(/<template\s+class="([^"]+)"/)?.[1];
    if (result.node.template !== wantTemplate) {
        problems.push(
            `${job.key}: the golden writes ${wantTemplate === undefined ? 'no <template>' : `<template class="${wantTemplate}">`} ` +
                `and the projection says template=${JSON.stringify(result.node.template)}. The two exits from one AST ` +
                'must spell the composite class the same way.',
        );
    }
    const goldenIds = [...golden.matchAll(/<object\s+[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    const carried = [];
    const walk = (node) => {
        if (node.id !== undefined) carried.push(node.id);
        for (const child of node.children ?? []) walk(child);
    };
    walk(result.node);
    addressedIds += carried.length;
    const invented = carried.filter((id) => !goldenIds.includes(id));
    if (invented.length > 0) {
        problems.push(
            `${job.key}: the projection carries id(s) [${invented.join(', ')}] that the golden does not write. ` +
                'A name no GtkBuilder document declares addresses nothing.',
        );
    }
    const details = (job.expectation.lost ?? []).map((loss) => loss.detail ?? '').join(' ');
    for (const id of goldenIds) {
        if (carried.includes(id)) continue;
        // The NAME anywhere in a detail, not a fixed phrasing around it: the three files that
        // reach this write it as "the whole `Gtk.Label labelA`" and as "its id `objectOne`",
        // and demanding one of those two shapes would be grading prose rather than reading it.
        if (new RegExp(`\\b${id.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(details)) continue;
        problems.push(
            `${job.key}: the golden writes id="${id}" and the projection carries no such node, and no declared ` +
                'loss names it. Either the id was swallowed, or the loss that took its object has to say so.',
        );
    }
};

/**
 * The `_()` markings, held against the GOLDEN for the same reason the addressing is — ADR
 * 0067 § 5.
 *
 * WHAT IS COMPARED. GtkBuilder writes a marking as `translatable="yes"` plus an optional
 * `context="…"` on the element carrying the value, so the golden states, per file, exactly
 * which properties are marked and with which context. This collects those pairs and holds
 * them against the ones the projection carries, both directions: a marking the projection
 * invents is a failure, and one the golden writes that the tree does not carry is a failure.
 * No escape hatch, deliberately — every marking the goldens write on a `<property>` today is
 * one the projection reaches, so a hatch would be a hole nobody has ever walked through,
 * silently passing the first file that needs it instead of making someone decide.
 *
 * WHY A MULTISET AND NOT A POSITION. The emitter re-orders: properties and children are
 * written in GtkBuilder's order, not the source's, so pairing the nth marking in the golden
 * with the nth in the tree would be a second implementation of that ordering. WHERE each
 * marking sits is what the hand-written tree above pins, node by node; how many there are and
 * with which contexts is what the oracle pins here. Neither arm can cover for the other, which
 * is the point of having both.
 *
 * TWO SUBTREES ARE REMOVED FIRST, each because it is a second document or a second namespace:
 * CDATA, for the reason `checkAddressing` gives one screen up, and `<accessibility>`, which is
 * the ONLY other element GtkBuilder writes a `<property>` inside — measured, 1 of the 27 the
 * corpus holds — and whose whole block the projection loses by its own kind.
 */
const checkMarkings = (job, result) => {
    if (!existsSync(job.golden)) return; // stage A said so
    const golden = readFileSync(job.golden, 'utf8')
        .replaceAll(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replaceAll(/<accessibility>[\s\S]*?<\/accessibility>/g, '');
    const spell = (name, context) => (context === undefined ? name : `${name} (context "${context}")`);
    const wanted = [...golden.matchAll(/<property\s+([^>]*\btranslatable="yes"[^>]*)>/g)].map((match) =>
        spell(/\bname="([^"]+)"/.exec(match[1])?.[1] ?? '?', /\bcontext="([^"]+)"/.exec(match[1])?.[1]),
    );
    const carried = [];
    const walk = (node) => {
        for (const [name, marking] of Object.entries(node.translatable ?? {}))
            carried.push(spell(name, marking.context));
        for (const child of node.children ?? []) walk(child);
    };
    walk(result.node);
    marked += carried.length;
    const a = [...wanted].sort();
    const b = [...carried].sort();
    if (a.join('\n') === b.join('\n')) return;
    const missing = [...a];
    const invented = [];
    for (const one of b) {
        const at = missing.indexOf(one);
        if (at === -1) invented.push(one);
        else missing.splice(at, 1);
    }
    problems.push(
        `${job.key}: the golden and the projection disagree about which properties are marked ` +
            `for translation — written by the oracle and not carried: [${missing.join(', ')}]; ` +
            `carried and not written: [${invented.join(', ')}].`,
    );
};

/**
 * The style classes, held against the GOLDEN — ADR 0068 § 5, built like the marking arm.
 *
 * WHAT IS COMPARED, AND WHY IT TAKES TWO PATTERNS. The oracle writes ONE GTK property two ways,
 * because Blueprint gave it two spellings: a `styles [ ]` block becomes
 * `<style><class name="flat"/></style>`, and a `css-classes: [ ]` property value becomes a
 * `<property name="css-classes">` whose text is NEWLINE-joined. So the golden's own answer for a
 * file is the union of both, and that union is what the projection's `styleClasses` is held
 * against — both directions: a class the projection invents is a failure, and one the golden
 * writes that no node carries is a failure.
 *
 * THE NEWLINE JOIN IS THE MEASUREMENT THAT DECIDED THE FIELD. ADR 0058 § 4 recorded that a
 * space-joined string in `props` would do, on ADR 0049 § 3's write door. The oracle joins with
 * `\n`, not with a space — so a string would have had to pick one of the two joins and could then
 * not be compared against the other golden at all. A list can be compared against both, which is
 * the whole reason this arm exists rather than a prop-key equality.
 *
 * WHY A MULTISET AND NOT A POSITION, and CDATA removed first: the reasons `checkMarkings` gives
 * one screen up, unchanged. `<accessibility>` is NOT removed here, because GtkBuilder writes no
 * `<style>` and no `css-classes` inside one — measured, 0 of the corpus's goldens — and removing
 * a subtree that can hold nothing would be an exemption with no subject.
 */
const checkStyleClasses = (job, result) => {
    if (!existsSync(job.golden)) return; // stage A said so
    const golden = readFileSync(job.golden, 'utf8').replaceAll(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const wanted = [
        ...[...golden.matchAll(/<class\s+name="([^"]+)"\s*\/>/g)].map((match) => match[1]),
        ...[...golden.matchAll(/<property\s+name="css-classes"\s*>([\s\S]*?)<\/property>/g)].flatMap((match) =>
            match[1].split('\n').filter((one) => one.length > 0),
        ),
    ];
    const carried = [];
    const walk = (node) => {
        carried.push(...(node.styleClasses ?? []));
        for (const child of node.children ?? []) walk(child);
    };
    walk(result.node);
    styled += carried.length;
    const a = [...wanted].sort();
    const b = [...carried].sort();
    if (a.join('\n') === b.join('\n')) return;
    const missing = [...a];
    const invented = [];
    for (const one of b) {
        const at = missing.indexOf(one);
        if (at === -1) invented.push(one);
        else missing.splice(at, 1);
    }
    problems.push(
        `${job.key}: the golden and the projection disagree about the style classes on this file — ` +
            `written by the oracle and not carried: [${missing.join(', ')}]; ` +
            `carried and not written: [${invented.join(', ')}].`,
    );
};

// The hand-written `SharedNode` trees, run rather than read.
//
// Stage A holds their SHAPE — a valid tag, scalar props, a loss line inside the file — and
// says nothing about whether they are RIGHT. They were written by reading each `.blp`
// before a parser existed, which is what makes them worth having and also what makes them
// unverified: the most expensive artefact in this corpus was, until this stage, a claim.
//
// So the projection of ADR 0053 clause 1 runs over the same files and the two are compared.
// The direction matters: a mismatch is reported as the EXPECTATION disagreeing with the
// projection, because either one can be wrong and the file a human wrote is the one worth
// re-reading first.
//
// `detail` is not compared — it is prose for a reader, and a machine cannot be right about
// it. `comment` losses are dropped before comparing: comments never reach the AST, so the
// projection has nothing to lose, while the expectation declares the loss from the reader's
// side. Both halves are correct and they are not comparable.
//
// `PROJECTOR` is declared beside the parser above and is REQUIRED there — deleting it used to
// print "stage D SKIPPED — no projection in this tree yet" and exit 0.
let projected = 0;
// The addressing arm's own denominator. A count that only ever goes up with the corpus is
// what tells a reader the arm RAN — printing "stage D held 68 trees" would read the same
// whether it compared two fields or none, which is the shape `--require-oracle` exists for.
let addressed = 0;
let addressedIds = 0;
// The marking arm's own denominator, beside the two the addressing arm keeps, and for the
// same reason: a count that grows with the corpus is what says the arm RAN.
let marked = 0;
let styled = 0;
if (surface !== undefined && existsSync(PROJECTOR)) {
    const { gtypeName, parseBlueprint } = surface;
    // `project.mjs` is the one of the four NOT on the surface — `src/index.mjs` § WHAT IS
    // DELIBERATELY NOT HERE says why — so this stage keeps a path for it, and keeps the
    // ability to say which of the two went missing.
    const { projectToSharedNode } = await import(`file://${PROJECTOR}`);

    const jobs = [
        ...RULE_EXPECTATIONS.map((e) => ({
            key: `rules/${e.file}`,
            source: join(RULES_DIR, e.file),
            golden: join(RULES_DIR, e.file.replace(/\.blp$/, '.ui')),
            expectation: e,
        })),
        ...REAL_EXPECTATIONS.map((e) => ({
            key: e.file,
            source: join(root, e.file),
            golden: join(REAL_DIR, `${slugFor.get(e.file)}.ui`),
            expectation: e,
        })),
    ];
    for (const job of jobs) {
        if (!existsSync(job.source)) continue;
        let result;
        try {
            result = projectToSharedNode(parseBlueprint(readFileSync(job.source, 'utf8'), job.key), { gtypeName });
        } catch (error) {
            problems.push(`${job.key}: the projection failed — ${error.message}`);
            continue;
        }
        projected += 1;
        const want = JSON.stringify(job.expectation.node, null, 2);
        const got = JSON.stringify(result.node, null, 2);
        if (want !== got) {
            const a = want.split('\n');
            const b = got.split('\n');
            const i = a.findIndex((line, n) => line !== b[n]);
            problems.push(
                `${job.key}: the hand-written SharedNode tree and the projection disagree. ` +
                    `First difference on line ${i + 1} of the tree:\n` +
                    `      expectation: ${JSON.stringify(a[i])}\n      projection:  ${JSON.stringify(b[i])}`,
            );
        }
        const key = (loss) => `${loss.kind}:${loss.line}`;
        const wantLost = (job.expectation.lost ?? [])
            .filter((l) => l.kind !== 'comment')
            .map(key)
            .sort();
        const gotLost = result.lost.map(key).sort();
        if (wantLost.join(',') !== gotLost.join(',')) {
            const missing = wantLost.filter((k) => !gotLost.includes(k));
            const extra = gotLost.filter((k) => !wantLost.includes(k));
            problems.push(
                `${job.key}: declared losses and projected losses disagree — ` +
                    `declared and not taken: [${missing.join(', ')}]; taken and not declared: [${extra.join(', ')}].`,
            );
        }
        checkAddressing(job, result);
        checkMarkings(job, result);
        checkStyleClasses(job, result);
    }
}

// ---------------------------------------------------------------- stage E

// ADR 0053 clause 3 is a PROPERTY and not a feature — "outside the documented subset is a hard
// error naming its line, never wrong output" — and stages C and D cannot measure it: both see
// only files the parser accepts, so a construct that is inside what it accepts and outside what
// it gets right is invisible to them. That is what `accessibility { }` was, and what
// `Gio.ListStore` was after it: the parser took the `using`, the emitter wrote `GioListStore`,
// a class GtkBuilder cannot find, and every stage stayed green. Each file here reaches one such
// construct, and the XML exit must throw, the error must name the construct, and it must name
// the line — a file that emits instead is the pass-through this stage exists to catch.
//
// The projection is the second exit from the same AST and is asked too. What it does is data
// in the manifest, held in both directions: a tag is the one thing that exit must spell right,
// and it spelled `GioListStore` exactly as the emitter did until this half existed.
let refused = 0;
if (surface !== undefined) {
    const {
        accessibilityElement,
        accessibilityValue,
        emitGtkBuilderXml,
        enumOrFlagsTypeOf,
        gtypeName,
        parseBlueprint,
        resolveIdent,
    } = surface;
    const { projectToSharedNode } = await import(`file://${PROJECTOR}`);

    // A parser error is `refused/<file>:<line>:<column>:` and an emitter or resolver error
    // `refused/<file>:<line>:` — the same anchor, one field shorter, because an AST node
    // carries no column. Both are matched WITH their delimiters. Measured: `:3:` alone was
    // satisfied by a column of 3 on line 4, and a prose fallback of `line 3` by "closing the
    // `{` on line 3" of an error at end of file — two wrong lines this stage passed. That
    // fallback is gone rather than kept as a second arm: since `BlueprintEmitError` every
    // refusal names the file it was parsed under, so an arm that matched a bare `line N:`
    // would fire for exactly the error this stage now exists to refuse — one with no file.
    const namesLine = (message, refusal) => message.includes(`refused/${refusal.file}:${refusal.line}:`);
    // The construct is matched with that location prefix removed. The prefix carries the FILE
    // NAME, so `translation-domain` matched its own path and the by-name half was vacuous for
    // it: the file altered to fail for another reason on the same line stayed green here.
    //
    // The column group is optional because an emitter refusal has no column, and without that
    // the strip misses all 16 of them — but MISSING the strip is only vacuous where the path
    // happens to carry the construct name, which is 3: `expression-item-in-bind` (`item`),
    // `expression-try-empty` (`try`) and `expression-cast-literal` (`cast`). The other 13 go red
    // under either regex when their message stops naming the construct, and `null-value` is the
    // near miss worth knowing — its `names` is `` `null` `` WITH backticks, which the path does
    // not carry. Three is small and it is the wrong thing to measure: the structural hole was
    // all 16, and which of them a sabotage happens to expose is an accident of spelling.
    const namesConstruct = (message, refusal) =>
        message.replace(/^refused\/[^:\n]+:\d+:(?:\d+:)? /, '').includes(refusal.names);
    const hold = (refusal, exit, message) => {
        if (!namesConstruct(message, refusal)) {
            problems.push(
                `refused/${refusal.file}: ${exit} refused it, but not by name — the error does not mention ` +
                    `${JSON.stringify(refusal.names)}:\n      ${message}`,
            );
        }
        if (!namesLine(message, refusal)) {
            problems.push(
                `refused/${refusal.file}: ${exit} refused it, but the error does not name line ${refusal.line}:\n      ${message}`,
            );
        }
    };

    for (const refusal of CORPUS_REFUSALS) {
        const source = join(REFUSED_DIR, refusal.file);
        if (!existsSync(source)) continue; // stage A said so
        const key = `refused/${refusal.file}`;
        let ast;
        try {
            ast = parseBlueprint(readFileSync(source, 'utf8'), key);
        } catch (error) {
            // Refused before either exit ran, so both are refused by this one sentence.
            hold(refusal, 'the parser', String(error.message));
            if (refusal.projection === 'projects') {
                problems.push(
                    `${key}: CORPUS_REFUSALS says the projection projects it, and the parser refused the file first.`,
                );
            }
            refused += 1;
            continue;
        }

        let emitted;
        try {
            emitted = emitGtkBuilderXml(ast, {
                accessibilityElement,
                accessibilityValue,
                enumOrFlagsTypeOf,
                gtypeName,
                resolveIdent,
            });
        } catch (error) {
            hold(refusal, 'the emitter', String(error.message));
            refused += 1;
        }
        if (emitted !== undefined) {
            problems.push(
                `${key}: ${refusal.construct} was ACCEPTED, and ${emitted.split('\n').length} line(s) ` +
                    'of XML came out. ADR 0053 clause 3 makes a construct outside the subset a hard error naming its ' +
                    'line; output that looks plausible is the failure this stage exists to catch.',
            );
        }

        try {
            const { node } = projectToSharedNode(ast, { gtypeName });
            if (refusal.projection === 'refuses') {
                problems.push(
                    `${key}: CORPUS_REFUSALS says the projection refuses it, and a tree tagged ` +
                        `${JSON.stringify(node.tag)} came out. Say \`projects\` if that is a declared loss or a value ` +
                        'kept as spelled; a tag is the one thing that exit must spell right.',
                );
            }
        } catch (error) {
            if (refusal.projection === 'projects') {
                problems.push(
                    `${key}: CORPUS_REFUSALS says the projection projects it, and it refused: ${String(error.message)}`,
                );
            } else hold(refusal, 'the projection', String(error.message));
        }
    }
}

// ---------------------------------------------------------------- stage F

// A corpus file named in prose and not present on disk. Measured, not hypothetical: the
// `binding-lookup-chain.blp` refusal pointed at a rules/ file named for a lookup chain, for the
// cast form of the same shape, and no such file has ever existed — the shape is in
// `rules/43-expression-lookup.blp`. Every other stage reads the manifest TABLES, so a name that
// appears only in a comment is read by nothing, and a reader who goes looking for it finds an
// absence and no way to tell a renamed file from an invented one.
//
// Scope is this package plus the scripts that check it. Paths from the wild corpus live in
// `status/` and `docs/reports/` and are deliberately out of scope: they name other people's
// repositories, which this tree cannot resolve.
const PROSE_FILES = [
    ...readdirSync(join(root, 'packages/infra/blueprint/src')).map((f) =>
        join(root, 'packages/infra/blueprint/src', f),
    ),
    join(root, 'packages/infra/blueprint/README.md'),
    MANIFEST,
    join(CORPUS, 'expectations.mjs'),
    join(CORPUS, 'divergences.mjs'),
    join(CORPUS, 'real-expectations.mjs'),
    join(root, 'scripts/check-blueprint-corpus.mjs'),
].filter((f) => existsSync(f));

let namedFiles = 0;
for (const path of PROSE_FILES) {
    const text = readFileSync(path, 'utf8');
    // TWO spellings are resolvable and the limit is deliberate. A `rules/…`, `refused/…` or
    // `real/…` path names a file of this corpus and must be there. A bare `NN-name.blp` is the
    // rule-file convention and must be in `rules/`. Everything else a comment may name is out of
    // scope and is NOT resolved: `toolbar-view.blp` is the showcase source a `real/` probe was
    // flattened from, and `expr_try.blp` is the reference implementation's own sample — both are
    // real files this tree cannot see, and flagging them would teach a reader to ignore the stage.
    for (const match of text.matchAll(
        /`(?:(rules|refused|real)\/([\w.-]+\.(?:blp|ui))|(\d\d-[\w.-]+\.(?:blp|ui)))`/g,
    )) {
        const [, dir, dirName, bare] = match;
        namedFiles++;
        const name = dir === undefined ? bare : dirName;
        const found = dir === undefined ? existsSync(join(RULES_DIR, name)) : existsSync(join(CORPUS, dir, name));
        if (!found) {
            problems.push(
                `${relative(root, path)} names \`${dir === undefined ? '' : `${dir}/`}${name}\`, which is not in the corpus.`,
            );
        }
    }
}
const stageF = `stage F resolved ${namedFiles} corpus file name(s) written in prose, every one of them present`;

if (problems.length > 0) fail();

// Neither stage has a skip branch to print: a missing parser, emitter or projection is a
// problem pushed above, and `fail()` has already exited by here.
const kinds = new Set(SHADOW_DIVERGENCES.map((entry) => entry.kind));
const tolerated = SHADOW_DIVERGENCES.reduce((n, entry) => n + (entry.lines ?? []).length, 0);
// An empty ledger is the condition ADR 0053 clause 5 names, so the line SAYS that rather than
// printing three zeros a reader has to add up. The zeros were honest and unreadable: "0
// ledgered across 0 cause(s) and 0 named line(s) — every other line held to the golden" is the
// silence clause 5 is waiting for, written as an accounting remainder.
const stageC =
    ledgered === 0
        ? `stage C ran the in-repo parser over all ${byteEqual} corpus file(s): every one byte-equal, ` +
          'nothing ledgered — the silence ADR 0053 clause 5 makes the parser authoritative on'
        : `stage C ran the in-repo parser over all ${byteEqual + ledgered} corpus file(s): ` +
          `${byteEqual} byte-equal, ${ledgered} ledgered across ${kinds.size} cause(s) and ` +
          `${tolerated} named line(s) — every other line held to the golden`;

const stageD =
    `stage D held ${projected} hand-written SharedNode tree(s) against the projection, and ${addressed} ` +
    `composite class(es), ${addressedIds} object id(s), ${marked} translatable marking(s) and ${styled} ` +
    'style class(es) against the golden the oracle wrote';

const stageE = `stage E held ${refused} refusal(s) to an error naming the construct and its line, and the projection to its recorded verdict on each`;

const stageB = havecompiler
    ? write
        ? `stage B re-derived every golden with ${ORACLE.tool} ${installed} (${rewritten} changed) and classified ${classified} refusal(s)`
        : `stage B compared ${compared} golden(s) and classified ${classified} refusal(s) against ${ORACLE.tool} ${installed}`
    : 'stage B SKIPPED — blueprint-compiler is not on PATH, so no golden was re-derived here';

// Printed every run so the SIZE of the claim is visible in the log, not just its
// colour. The rule and probe counts are now load-bearing rather than decorative —
// `refuseDuplicates` above stops a shrinking corpus from holding them steady — but the
// node and loss totals are still only a signal: nothing pins them to a number, and a
// deliberate deletion of a rule and its expectation together is still a green run.
const everyExpectation = [...RULE_EXPECTATIONS, ...REAL_EXPECTATIONS];
const nodes = everyExpectation.reduce((n, e) => n + countNodes(e.node), 0);
const losses = everyExpectation.reduce((n, e) => n + (e.lost ?? []).length, 0);

console.log(
    `check-blueprint-corpus: stage A verified ${CORPUS_RULES.length} rule(s) and ` +
        `${CORPUS_REAL_FILES.length} reality probe(s), each with a hand-written expectation ` +
        `(${nodes} node(s), ${losses} declared loss(es)); ${stageB}; ${stageC}; ${stageD}; ${stageE}; ${stageF}.`,
);
