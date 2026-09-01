#!/usr/bin/env node
// Catch a change that silently resurrects prose the base branch deleted.
//
// THE FAILURE, twice in one day. A doc commit written against a copy of a file
// that predates a rewrite already on the base branch puts the old wording back.
// Git merges it WITHOUT A CONFLICT — "replace these paragraphs with those" is an
// ordinary edit — so #886 restored five paragraphs #885 had consolidated in
// `AGENTS.md`, and #892 carried the whole pre-#885 file. Prose has no test, no
// type, no conformance rule, and by construction no conflict.
//
// THE SIGNATURE IS NOT "removes what the base added": both incidents had the new
// wording in their own merge base and replaced it anyway. What distinguishes them
// is the other direction — **the change ADDS lines the base branch had DELETED**,
// content coming back from the dead, which is what a stale copy produces and an
// ordinary edit does not.
//
// It WARNS rather than gating: a deliberate revert has the identical signature,
// and a hard gate on an ambiguous signal trains people to route around it.
// Acknowledge with a `Revert-Of:` trailer.
//
// Usage: node scripts/check-doc-revert.mjs [--base <ref>] [--head <ref>]
//                                          [--depth N] [--all] [--json] [--strict]
//   --depth   how far back on the base branch to look for deletions (default 80)
//   --all     every changed file, not just *.md — prose is the default because
//             a source regression of this shape gets caught by tsc/lint/tests
//   --strict  exit 1 on an unacknowledged hit

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const BASE = flag('--base', 'origin/main');
const HEAD = flag('--head', 'HEAD');
const DEPTH = Number(flag('--depth', '80'));
const JSON_OUT = has('--json');
const STRICT = has('--strict');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

/**
 * A line worth comparing. Structural noise (blank lines, fences, lone brackets,
 * short fragments) collides across unrelated revisions and would bury a real
 * hit; a length floor is the cheapest filter that keeps prose and drops it.
 */
const significant = (line) => {
    const t = line.trim();
    return t.length >= 40 && !/^[-=*_`|#>\s]+$/.test(t);
};

let mergeBase;
try {
    // stderr silenced: "no merge base" / "not a valid object name" is an EXPECTED
    // answer here, and a leaked `fatal:` line reads like a failure in a CI log
    // when the check is in fact skipping cleanly.
    mergeBase = execFileSync('git', ['merge-base', BASE, HEAD], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
} catch {
    // A shallow clone has no common ancestor. Say so rather than printing
    // "nothing resurrected", which reads as a clean bill of health from a check
    // that never ran; the caller is expected to deepen first.
    console.log(
        `doc-revert: SKIPPED — no merge base between ${BASE} and ${HEAD} (shallow clone?).\n` +
            `  Deepen first, e.g. \`git fetch --deepen=200 origin <base>\`.`,
    );
    process.exit(0);
}

const filter = has('--all') ? [] : ['*.md'];
const files = git('diff', '--name-only', `${mergeBase}...${HEAD}`, '--', ...filter)
    .split('\n')
    .filter(Boolean);

const findings = [];
for (const file of files) {
    const added = new Set(
        git('diff', '--unified=0', `${mergeBase}...${HEAD}`, '--', file)
            .split('\n')
            .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
            .map((l) => l.slice(1))
            .filter(significant),
    );
    if (!added.size) continue;

    // Every line the base branch has DELETED from this file recently. One git
    // call per file — a `log -S` per candidate line would be the same answer at
    // hundreds of times the cost.
    const deleted = new Set(
        git('log', '-p', '--format=', `-n${DEPTH}`, BASE, '--', file)
            .split('\n')
            .filter((l) => l.startsWith('-') && !l.startsWith('---'))
            .map((l) => l.slice(1))
            .filter(significant),
    );

    // A line that STILL EXISTS on the base in a slightly different form churned
    // rather than being resurrected — canonically the header carrying the
    // workspace version, which every release rewrites and which would otherwise
    // fire on every branch predating a release. Keyed on a prefix so a reworded
    // tail still matches.
    const key = (l) => l.trim().slice(0, 40);
    let baseText = '';
    try {
        // stderr silenced: "path does not exist in <ref>" is an EXPECTED answer,
        // which execFileSync would otherwise leak as if something had gone wrong.
        baseText = execFileSync('git', ['show', `${BASE}:${file}`], {
            encoding: 'utf8',
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        // The file does not exist on the base branch — this change creates it, so
        // nothing is "still live there" and every match stands. `git show
        // <ref>:<path>` exits non-zero rather than returning empty.
    }
    const liveOnBase = new Set(baseText.split('\n').filter(significant).map(key));

    const resurrected = [...added].filter((l) => deleted.has(l) && !liveOnBase.has(key(l)));
    if (resurrected.length) findings.push({ file, count: resurrected.length, sample: resurrected[0] });
}

const trailers = git('log', '--format=%B', `${mergeBase}..${HEAD}`);
const acknowledged = /^Revert-Of:/m.test(trailers);

if (JSON_OUT) {
    console.log(JSON.stringify({ mergeBase, findings, acknowledged }, null, 2));
} else if (!findings.length) {
    console.log(`doc-revert: nothing resurrected — no added line was previously deleted from ${BASE}.`);
} else {
    const total = findings.reduce((n, f) => n + f.count, 0);
    console.log(`doc-revert: ${total} line(s) this change ADDS were previously DELETED from ${BASE}.`);
    for (const f of findings) console.log(`  · ${f.file}: ${f.count}`);
    console.log(`  first: ${findings[0].sample.slice(0, 110)}`);
    console.log(
        acknowledged
            ? '  Acknowledged by a `Revert-Of:` trailer — treated as deliberate.'
            : '  Usually this means the file was edited against a stale copy: take the base version\n' +
                  '  and re-apply your change on top of it. If the revert IS the intent, say so with a\n' +
                  '  `Revert-Of: <what>` trailer.',
    );
}

// On GitHub, ALSO as an annotation. The plain lines above are the whole report,
// and they were invisible in the case this check exists for: the step is advisory
// (`continue-on-error`), so its output lands inside a job whose conclusion says
// nothing is wrong, and nobody opens the log of a green job. Measured on #1449 —
// a rebase resurrected ten pre-rename lines, the check would have named the first
// of them, and the finding was reached instead through a DIFFERENT gate two jobs
// later that happened to read one of the ten. An annotation shows up on the PR's
// Files-changed view and in the run summary without failing anything, which is
// what "advisory" was supposed to mean.
if (!JSON_OUT && findings.length && !acknowledged && process.env.GITHUB_ACTIONS === 'true') {
    // `::warning` takes its message on one line: a literal newline would end the
    // command and print the remainder as ordinary log text.
    const esc = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    for (const f of findings) {
        console.log(
            `::warning file=${f.file},title=Resurrected prose::` +
                esc(
                    `${f.count} line(s) added here were previously deleted from ${BASE}. ` +
                        `First: ${f.sample.slice(0, 110)} — take the ${BASE} version and re-apply on top of it, ` +
                        `or acknowledge a deliberate revert with a \`Revert-Of:\` trailer.`,
                ),
        );
    }
}

if (STRICT && findings.length && !acknowledged) process.exit(1);
