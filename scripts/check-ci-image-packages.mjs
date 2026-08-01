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
//      on every run? Each one must appear in the ledger below WITH A REASON,
//      printed on every run. That is the `unchecked-fields.mjs` idiom: an
//      honest "not yet" is available, a silent one is not.
//
// Why (2) is worth a check rather than a comment: during the v0.26.0 release
// sweep the `dnf install` step took 41 minutes twice (normal: 22 seconds) and
// killed the Adwaita-storybook job on its timeout, while a Docker Hub pull
// timeout independently failed `napi`. Thirteen jobs are exposed to that, two
// of them on the release path. The image that fixes it has existed since
// `build-ci-image.yml` was written — these jobs simply never adopted it.
//
// Usage: node scripts/check-ci-image-packages.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = '.github/workflows';
const DOCKERFILE = '.docker/ci-fedora.Dockerfile';
const BAKED_IMAGE = 'ghcr.io/gjsify/ci-fedora';

// job id -> why it is still on a bare `fedora:<major>`. Delete the entry in the
// same change that switches the job over; an entry for a job that no longer
// uses a bare image is a FAILURE, so this cannot rot into a stale list.
const BARE_IMAGE_LEDGER = {
    'node-gi.yml/build-test': 'pending switch to the baked image (packages landed, jobs not yet moved)',
    'node-gi.yml/cross-runtime': 'pending switch to the baked image',
    'node-gi.yml/gtk-smoke': 'pending switch to the baked image',
    'node-gi.yml/consumer-sqlite': 'pending switch to the baked image',
    'node-gi.yml/arm64': 'runs under QEMU on a foreign arch — needs a multi-arch image build first',
    'node-gi.yml/consumer-suites': 'pending switch to the baked image',
    'node-gi.yml/storybook-node-gi-bundle': 'pending switch to the baked image',
    'napi.yml/build-test': 'pending switch to the baked image',
    'napi.yml/consumer': 'pending switch to the baked image',
    'napi.yml/nodegi-shim': 'pending switch to the baked image',
    'release.yml/node-gi-prebuild-linux': 'pending switch — ON THE RELEASE PATH, do this one first',
    'release.yml/napi-prebuild-linux': 'pending switch — ON THE RELEASE PATH, do this one first',
    'prebuilds.yml/build-prebuilds': 'pins fedora:43 while the baked image tracks 43+44 — confirm the pin still matters',
};

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
            cur = { id: `${file}/${job[1]}`, image: null, run: '' };
            jobs.push(cur);
            continue;
        }
        if (!cur) continue;
        const img = /^\s*image:\s*(\S+)/.exec(line);
        if (img && !cur.image) cur.image = img[1];
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

const problems = [];
const bare = [];
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
    console.log(JSON.stringify({ bakedJobs, bare, problems }, null, 2));
} else {
    console.log(`ci-image: ${bakedJobs} job(s) on ${BAKED_IMAGE}, ${bare.length} still on a bare fedora image.`);
    for (const id of bare.sort()) console.log(`  · ${id} — ${BARE_IMAGE_LEDGER[id] ?? 'UNDECLARED'}`);
    for (const p of problems) console.error(`  ✗ ${p}`);
}

if (problems.length) {
    console.error(`ci-image: ${problems.length} problem(s).`);
    process.exit(1);
}
