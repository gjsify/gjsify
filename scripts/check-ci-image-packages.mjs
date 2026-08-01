#!/usr/bin/env node
// Hold the CI container images to the jobs that use them.
//
// Two questions, one script, both DERIVED from the workflows rather than from
// a list somebody remembers to update:
//
//   1. Does a job that runs ON the baked image install packages the image does
//      not carry? `.docker/ci-fedora.Dockerfile` used to carry the sentence
//      "This list MUST stay in lockstep with ... main.yml — that file is the
//      source of truth", which is a convention with nothing behind it. This is
//      the check that sentence was asking for.
//
//   2. Which jobs still run on a bare `fedora:<major>` and pay `dnf install`
//      on every run? A job that CAN switch and has not must appear in the
//      ledger below WITH A REASON, printed on every run. That is the
//      `unchecked-fields.mjs` idiom: an honest "not yet" is available, a
//      silent one is not.
//
// Why (2) is worth a check rather than a comment: during the v0.26.0 release
// sweep the `dnf install` step took 41 minutes twice (normal: 22 seconds) and
// killed the Adwaita-storybook job on its timeout, while a Docker Hub pull
// timeout independently failed `napi`. Thirteen jobs were exposed to that, two
// of them on the release path. The image that fixes it has existed since
// `build-ci-image.yml` was written — those jobs simply never adopted it. Ten
// have since; the last three are the arm64 ones below.
//
// A job that CANNOT switch is DERIVED, never ledgered. `build-ci-image.yml`
// builds `linux/amd64` only, so a job needing an arm64 runner has no image to
// move to — a structural fact both files already state, and the ledger's job is
// to record DECISIONS, not to keep a hand-written second copy of one. It kept
// three: two entries claimed the switch was "deferred only to avoid editing
// release.yml while #900 has it open" (#900 merged; the real blocker is an
// arm64 matrix leg) and one claimed `prebuilds.yml` "pins fedora:43" (it pins
// 44, and is likewise arm64). All three were prose that had drifted off the
// thing it described, which is what deriving prevents. Widening the image to
// linux/arm64 therefore deletes three exemptions at once, with nothing to
// remember to update.
//
// Usage: node scripts/check-ci-image-packages.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = '.github/workflows';
const DOCKERFILE = '.docker/ci-fedora.Dockerfile';
const IMAGE_WORKFLOW = 'build-ci-image.yml';
const BAKED_IMAGE = 'ghcr.io/gjsify/ci-fedora';

// job id -> why a job that COULD run on the baked image deliberately does not.
// Empty today, and the two ways it fails keep it that way: an entry for a job
// that is no longer bare is a FAILURE, and so is an entry for a job the arch
// derivation already excuses — a reason that is derivable must not also be
// written down, or the copy drifts (all three that lived here did).
const BARE_IMAGE_LEDGER = {};

/** Packages a `dnf install` line asks for, with line continuations joined. */
function packagesIn(run) {
    const joined = run.replace(/\\\n\s*/g, ' ');
    const found = new Set();
    for (const m of joined.matchAll(/dnf install ([^\n]*)/g)) {
        for (const tok of m[1].split(/\s+/)) {
            if (!tok || tok.startsWith('-') || tok === '&&' || tok === 'dnf' || tok === 'install') continue;
            // `... && dnf clean all` and friends end the package list.
            if (tok === 'clean' || tok === 'all') continue;
            found.add(tok);
        }
    }
    return found;
}

/**
 * Containerised jobs, without a YAML parser: workflows here use `${{ }}`
 * expressions in `container.image`, and the point is only to find each job's
 * image and its `run:` blocks. A scanner keyed on this repo's own indentation
 * is enough and adds no dependency.
 */
function scanWorkflow(file) {
    const lines = readFileSync(join(WORKFLOW_DIR, file), 'utf8').split('\n');
    const jobs = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (job) {
            cur = { id: `${file}/${job[1]}`, image: null, run: '', runners: [] };
            jobs.push(cur);
            continue;
        }
        if (!cur) continue;
        const img = /^\s*image:\s*(\S+)/.exec(line);
        if (img && !cur.image) cur.image = img[1];
        // Both spellings, because the arm64 legs use the second: a literal
        // `runs-on:`, and the `runner:` values of a static matrix `include:`
        // that `runs-on: ${{ matrix.runner }}` selects from.
        const runner = /^\s*(?:- )?(?:runs-on|runner):\s*(\S+)/.exec(line);
        if (runner && !runner[1].startsWith('${{')) cur.runners.push(runner[1]);
        if (/^\s*(- )?run:\s*\|/.test(line)) {
            for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^ {10}/.test(lines[j])); j++) {
                cur.run += lines[j] + '\n';
            }
        }
    }
    return jobs;
}

const dockerfile = readFileSync(DOCKERFILE, 'utf8');
const baked = new Set();
for (const m of dockerfile.matchAll(/RUN dnf install -y(.*?)&& dnf clean all/gs)) {
    for (const tok of m[1].split(/[\s\\]+/)) if (tok && !tok.startsWith('-')) baked.add(tok);
}

// The architectures the baked image is actually PUBLISHED for, read from the
// workflow that publishes it rather than assumed. A job cannot move to an image
// that was never built for its runner, and reading it here means widening
// `platforms:` is the whole change — no exemption to also remember to delete.
const imageWorkflow = readFileSync(join(WORKFLOW_DIR, IMAGE_WORKFLOW), 'utf8');
const imageArches = new Set(
    (/^\s*platforms:\s*(\S+)/m.exec(imageWorkflow)?.[1] ?? '')
        .split(',')
        .map((p) => p.split('/')[1])
        .filter(Boolean),
);
if (!imageArches.size) {
    console.error(`::error::could not read a \`platforms:\` list from ${IMAGE_WORKFLOW} — the arch derivation is blind.`);
    process.exit(1);
}

/** GitHub's runner labels carry the arch in their suffix; everything else is x86_64. */
const runnerArch = (label) => (/-arm$|^.*arm64.*$/.test(label) ? 'arm64' : 'amd64');

const problems = [];
const bare = [];
const excused = [];
let bakedJobs = 0;

for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))) {
    for (const job of scanWorkflow(file)) {
        if (!job.image) continue;
        if (job.image.startsWith(BAKED_IMAGE)) {
            bakedJobs += 1;
            const missing = [...packagesIn(job.run)].filter((p) => !baked.has(p)).sort();
            if (missing.length) {
                problems.push(
                    `${job.id} runs on the baked image but installs ${missing.join(', ')}, ` +
                        `which ${DOCKERFILE} does not carry — add them there instead of paying dnf every run.`,
                );
            }
            continue;
        }
        if (!job.image.startsWith('fedora:')) continue;
        bare.push(job.id);

        // Structurally excused: at least one of the job's runners is an arch
        // the baked image is not published for, so there is nothing to switch
        // to. Derived, so it needs no ledger entry and cannot go stale.
        const unbuilt = [...new Set(job.runners.map(runnerArch))].filter((a) => !imageArches.has(a));
        if (unbuilt.length) {
            excused.push(`${job.id} — runs on ${unbuilt.join('+')}, ${BAKED_IMAGE} is built for ${[...imageArches].join('+')} only`);
            if (job.id in BARE_IMAGE_LEDGER) {
                problems.push(
                    `BARE_IMAGE_LEDGER lists ${job.id}, but the arch derivation already excuses it ` +
                        `(${unbuilt.join('+')} runner, no such image). Delete the entry — a derivable reason ` +
                        `written down twice is the copy that drifts.`,
                );
            }
            continue;
        }

        if (!(job.id in BARE_IMAGE_LEDGER)) {
            problems.push(
                `${job.id} runs on a bare ${job.image} and pays dnf install on every run. ` +
                    `Switch it to ${BAKED_IMAGE}, or add it to BARE_IMAGE_LEDGER with the reason it cannot.`,
            );
        }
    }
}

for (const id of Object.keys(BARE_IMAGE_LEDGER)) {
    if (!bare.includes(id)) {
        problems.push(
            `BARE_IMAGE_LEDGER lists ${id}, but no such job runs on a bare fedora image. ` +
                `Delete the entry — it now documents a decision nobody is making.`,
        );
    }
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ bakedJobs, bare, excused, ledgered: BARE_IMAGE_LEDGER, problems }, null, 2));
} else {
    console.log(
        `ci-image: ${bakedJobs} job(s) on ${BAKED_IMAGE}, ${bare.length} still on a bare fedora image ` +
            `(${excused.length} with no image to move to, ${Object.keys(BARE_IMAGE_LEDGER).length} ledgered).`,
    );
    // Printed every run, both kinds: the derived exemptions are the work item
    // (one `platforms:` edit retires all of them), the ledgered ones are the
    // decisions somebody owns.
    for (const e of excused.sort()) console.log(`  · ${e}`);
    for (const id of Object.keys(BARE_IMAGE_LEDGER).sort()) console.log(`  · ${id} — ${BARE_IMAGE_LEDGER[id]}`);
    for (const p of problems) console.error(`  ✗ ${p}`);
}

if (problems.length) {
    console.error(`ci-image: ${problems.length} problem(s).`);
    process.exit(1);
}
