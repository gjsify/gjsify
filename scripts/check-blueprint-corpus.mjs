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
// TWO STAGES, AND THE REPORT SAYS WHICH ONE RAN
//
//   A. COMPLETENESS — runs everywhere, needs no binary. Every rule file is listed,
//      goldened and given a hand-written `SharedNode` expectation; every expectation
//      is structurally a `SharedNode`; every loss names a line that exists; and every
//      `.blp` tracked anywhere in this repo is either a corpus rule or a reality
//      probe. That last one is what stops the probe from quietly falling behind the
//      tree: a twelfth `.blp` added to a showcase fails this until it is listed.
//
//   B. ORACLE — runs only where `blueprint-compiler` is on PATH. Recompiles all 31
//      files and diffs against the committed goldens.
//
// Stage B is skipped, loudly and by name, wherever the binary is absent. That is the
// same two-stage shape ADR 0053 clause 7 asks of `check-doc-fences.mjs`, and it is the
// only shape that is honest here: the corpus must be complete on every runner, and the
// oracle cannot be.
//
// In CI stage B runs in `tree-checks` — the one job whose image bakes
// `blueprint-compiler` and which carries no classifier gate, so a docs-only PR runs it
// too. It reads `git ls-files`, so it runs as `testuser` there and not as root, or git
// refuses the tree as dubiously owned.
//
// A VERSION MISMATCH IS A FAILURE, NOT A NUISANCE
//
// The goldens record which compiler produced them. ADR 0053 clause 5: after an
// upstream release, a run that starts reporting IS the upgrade notice. So a different
// version fails with both numbers named, and the fix is a deliberate `--write` plus a
// look at what moved — never a silent re-record.
//
// Usage: node scripts/check-blueprint-corpus.mjs [--write] [--root <dir>]
//        --write  re-derive every golden from the reference compiler (needs the binary)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const write = args.includes('--write');
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

const CORPUS = join(root, 'packages/infra/blueprint/corpus');
const RULES_DIR = join(CORPUS, 'rules');
const REAL_DIR = join(CORPUS, 'real');

const { ORACLE, CORPUS_RULES, CORPUS_REAL_FILES } = await import(`file://${join(CORPUS, 'manifest.mjs')}`);
const { RULE_EXPECTATIONS } = await import(`file://${join(CORPUS, 'expectations.mjs')}`);
const { REAL_EXPECTATIONS } = await import(`file://${join(CORPUS, 'real-expectations.mjs')}`);

// Kept in step with the `LossKind` typedef in `corpus/expectations.mjs` by hand, because
// a JSDoc union is not readable at runtime. A kind used there and missing here fails
// stage A, which is the direction that matters: an unnamed loss is the defect.
const LOSS_KINDS = new Set([
    'template',
    'object-id',
    'translatable',
    'signal',
    'binding',
    'breakpoint',
    'menu',
    'styles',
    'layout',
    'accessibility',
    'comment',
    'value-list',
    'sibling-object',
]);

const NODE_FIELDS = new Set(['tag', 'slot', 'props', 'children']);

const problems = [];

const fail = () => {
    console.error('check-blueprint-corpus: FAILED\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
};

/** A `SharedNode` is four optional-ish fields and three value kinds; hold it to that. */
const validateNode = (node, where) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        problems.push(`${where}: expected a SharedNode object, got ${JSON.stringify(node)}.`);
        return;
    }
    for (const key of Object.keys(node)) {
        if (!NODE_FIELDS.has(key)) {
            problems.push(`${where}: "${key}" is not a SharedNode field (tag, slot, props, children).`);
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
    if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
            problems.push(`${where}: "children" must be an array.`);
            return;
        }
        node.children.forEach((child, i) => validateNode(child, `${where} > children[${i}]`));
    }
};

const countNodes = (node) => 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);

// ---------------------------------------------------------------- stage A

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
    if (!existsSync(join(RULES_DIR, rule.file.replace(/\.blp$/, '.ui')))) {
        problems.push(
            `corpus/rules/${rule.file} has no committed golden. Run this with --write where the compiler is installed.`,
        );
    }
    if (typeof rule.isolates !== 'string' || rule.isolates.length === 0) {
        problems.push(`CORPUS_RULES entry "${rule.file}" does not say what it isolates.`);
    }
}

for (const probe of CORPUS_REAL_FILES) {
    if (!existsSync(join(root, probe.source))) {
        problems.push(`CORPUS_REAL_FILES points at ${probe.source}, which does not exist.`);
    }
    if (!existsSync(join(REAL_DIR, `${probe.slug}.ui`))) {
        problems.push(`corpus/real/${probe.slug}.ui is missing for ${probe.source}.`);
    }
}

// Every expectation lines up with a corpus file, and every corpus file with one
// expectation. ADR 0053 clause 2 wants a hand-written tree per file, and a file whose
// expectation was forgotten is exactly the one a parser would be graded on last.
const checkExpectations = (expectations, keys, label) => {
    const seen = new Set();
    for (const exp of expectations) {
        if (!keys.includes(exp.file)) {
            problems.push(`${label} has an entry for "${exp.file}", which is not in the corpus.`);
            continue;
        }
        if (seen.has(exp.file)) problems.push(`${label} has two entries for "${exp.file}".`);
        seen.add(exp.file);
        validateNode(exp.node, `${label} "${exp.file}"`);
        const source = join(
            root,
            label === 'RULE_EXPECTATIONS' ? join('packages/infra/blueprint/corpus/rules', exp.file) : exp.file,
        );
        const lines = existsSync(source) ? readFileSync(source, 'utf8').split('\n').length : 0;
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

checkExpectations(RULE_EXPECTATIONS, listed, 'RULE_EXPECTATIONS');
checkExpectations(
    REAL_EXPECTATIONS,
    CORPUS_REAL_FILES.map((p) => p.source),
    'REAL_EXPECTATIONS',
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
    const corpusOwn = new Set(CORPUS_RULES.map((r) => `packages/infra/blueprint/corpus/rules/${r.file}`));
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

let compared = 0;
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
}

if (problems.length > 0) fail();

const stageB = havecompiler
    ? write
        ? `stage B re-derived every golden with ${ORACLE.tool} ${installed}`
        : `stage B compared ${compared} golden(s) against ${ORACLE.tool} ${installed}`
    : 'stage B SKIPPED — blueprint-compiler is not on PATH, so no golden was re-derived here';

// Printed every run so the SIZE of the claim is visible in the log, not just its
// colour: a refactor that quietly drops half the expectations still exits 0 today,
// and these two numbers are where that shows.
const everyExpectation = [...RULE_EXPECTATIONS, ...REAL_EXPECTATIONS];
const nodes = everyExpectation.reduce((n, e) => n + countNodes(e.node), 0);
const losses = everyExpectation.reduce((n, e) => n + (e.lost ?? []).length, 0);

console.log(
    `check-blueprint-corpus: stage A verified ${CORPUS_RULES.length} rule(s) and ` +
        `${CORPUS_REAL_FILES.length} reality probe(s), each with a hand-written expectation ` +
        `(${nodes} node(s), ${losses} declared loss(es)); ${stageB}.`,
);
