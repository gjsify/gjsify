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
//   3. The MIRROR of (1): does a job USE a tool the image does not carry and
//      never installs? (1) catches installing what is already there; the
//      symmetric mistake — reaching for what was never there — is what shipped
//      half of v0.31.0.
//
// THE INCIDENT BEHIND (3)
//
// `release.yml`'s `napi-prebuild-linux` runs on the baked image and ends in
// `node ../../../scripts/stage-prebuild.mjs .`. The Dockerfile carries no
// nodejs, in those words: "no nodejs/npm baked in — the workflow uses
// actions/setup-node". That job had no setup-node step. So on the v0.31.0
// publish the meson build ran to completion — all 16 ninja targets, the
// typelib generated — and the step then died on `node: command not found`,
// exit 127. `publish-napi` needs that artifact, so it was skipped: the whole
// 0.31.0 sweep published, `@gjsify/node-gi` published, and `@gjsify/napi`
// alone stayed at 0.30.0.
//
// Two things made it invisible until a real release. The step was copied from
// `napi.yml`, where all three container jobs DO carry a setup-node, but the
// copy took the `run:` and not the step before it. And `release.yml` runs on
// `release`/`workflow_dispatch` only, so no PR ever executed it — the same
// reason `check-workflow-inline-scripts.mjs` exists, and the same failure
// shape as the v0.28.0 gtk-runtime lag that check was written for.
//
// This check has no judgement call in it: on a bare or baked Fedora image
// `node` is present only if something in the job put it there. The three other
// container jobs that invoke node all pass because they genuinely provide it —
// two through `./.github/actions/gjsify-setup` (which runs setup-node), one
// through its own `dnf install … nodejs`. All three ways are recognised, so
// the check states a fact rather than a house style.
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
// Usage: node scripts/check-ci-image-packages.mjs [--json] [--root <dir>]
//
// `--root` exists so the checks can be run against a FIXTURE tree — the same
// affordance `check-workflow-inline-scripts.mjs` has, and for the same reason:
// a guard whose failure path is never executed is the shape it was written to
// catch. `tests/e2e/release-bundle-gate` drives it.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const DOCKERFILE = join(ROOT, '.docker/ci-fedora.Dockerfile');
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
            cur = { id: `${file}/${job[1]}`, image: null, run: '', runners: [], uses: [], commands: [] };
            jobs.push(cur);
            continue;
        }
        if (!cur) continue;
        const img = /^\s*image:\s*(\S+)/.exec(line);
        if (img && !cur.image) cur.image = img[1];
        // `uses:` steps, for question (3): a step can PROVIDE a tool as well as
        // install one, and a local composite action can provide it one level down.
        const uses = /^\s*(?:- )?uses:\s*(\S+)/.exec(line);
        if (uses) cur.uses.push(uses[1]);
        // Single-line `run:` too, into `commands` ONLY. A one-line `run:` is a
        // command to check for (3), but folding it into `run` would hand question
        // (1) a package list it has never read — a behaviour change smuggled in as
        // a refactor. Block scalars go to both; this form goes to one.
        const inlineRun = /^\s*(?:- )?run:\s+(?![|>])(.*)$/.exec(line);
        if (inlineRun) cur.commands.push({ line: i + 1, text: inlineRun[1] });
        // Both spellings, because the arm64 legs use the second: a literal
        // `runs-on:`, and the `runner:` values of a static matrix `include:`
        // that `runs-on: ${{ matrix.runner }}` selects from.
        const runner = /^\s*(?:- )?(?:runs-on|runner):\s*(\S+)/.exec(line);
        if (runner && !runner[1].startsWith('${{')) cur.runners.push(runner[1]);
        // Both block scalars. `|` alone missed every `run: >` — including
        // `prebuilds.yml`'s only `dnf install`, so question (1) had never read that
        // job's package list at all and question (3) would have called its perfectly
        // good nodejs install absent.
        //
        // A `>` block is FOLDED as YAML folds it (lines joined by a space) rather
        // than copied verbatim: `packagesIn` reads a `dnf install` list to end of
        // line, and in the folded spelling the packages are on the lines after it.
        // Doing it here keeps that parser one parser instead of two.
        const block = /^\s*(- )?run:\s*([|>])/.exec(line);
        if (block) {
            const folded = block[2] === '>';
            for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^ {10}/.test(lines[j])); j++) {
                cur.run += folded ? lines[j].trim() + ' ' : lines[j] + '\n';
                cur.commands.push({ line: j + 1, text: lines[j] });
            }
            if (folded) cur.run += '\n';
        }
    }
    return jobs;
}

// Question (3). The tools `actions/setup-node` puts on PATH and nothing else
// does on a Fedora image. `corepack`/`npx`/`npm` ship with Node, so a job that
// reaches for any of them needs the same provision.
const NODE_TOOLS = ['node', 'npx', 'npm', 'corepack'];
// Must be a COMMAND, not a substring: `node-gi`, `node_modules`, `nodejs` and
// `--app node` all contain the word and none of them invoke the binary. So the
// token has to start a command — line start, or after a shell operator/`-c "` —
// and be followed by whitespace or end.
const NODE_CALL = new RegExp(
    String.raw`(?:^|[;&|(]|&&|\|\||\bsudo\s|\bsu\s[^;&|]*-c\s*['"])\s*(${NODE_TOOLS.join('|')})(?=\s|$)`,
);
const COMMENT = /^\s*#/;

/** A step that puts Node on PATH: setup-node itself, or a local composite action that does. */
function providesNode(job, root) {
    for (const ref of job.uses) {
        if (ref.startsWith('actions/setup-node')) return `${ref} step`;
        if (!ref.startsWith('./')) continue;
        // A local composite action, one level down — `main.yml`'s jobs get Node
        // this way and are correct. Not recursed further: this repo nests one deep,
        // and an unbounded walk would trade a real check for a clever one.
        for (const candidate of ['action.yml', 'action.yaml']) {
            let body;
            try {
                body = readFileSync(join(root, ref.slice(2), candidate), 'utf8');
            } catch {
                continue;
            }
            if (body.includes('actions/setup-node')) return `${ref} (runs setup-node)`;
        }
    }
    // Or the job installs it itself — `prebuilds.yml` does exactly this, naming
    // `stage-prebuild.mjs` as the reason in a comment beside it. Read through the
    // SAME parser question (1) uses, so the two can never disagree about what a
    // job installs.
    if (packagesIn(job.run).has('nodejs')) return 'its own nodejs install';
    return null;
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
    console.error(
        `::error::could not read a \`platforms:\` list from ${IMAGE_WORKFLOW} — the arch derivation is blind.`,
    );
    process.exit(1);
}

/** GitHub's runner labels carry the arch in their suffix; everything else is x86_64. */
const runnerArch = (label) => (/-arm$|^.*arm64.*$/.test(label) ? 'arm64' : 'amd64');

const problems = [];
const bare = [];
const excused = [];
const nodeProvisioned = [];
let bakedJobs = 0;

for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))) {
    for (const job of scanWorkflow(file)) {
        if (!job.image) continue;

        // (3) Node is present on these images only if the job put it there.
        // Derived, not assumed: the day the Dockerfile bakes nodejs, baked-image
        // jobs stop needing a setup-node step and this stops asking for one.
        const imageShipsNode = job.image.startsWith(BAKED_IMAGE) && baked.has('nodejs');
        if ((job.image.startsWith(BAKED_IMAGE) || job.image.startsWith('fedora:')) && !imageShipsNode) {
            const calls = job.commands.filter((c) => !COMMENT.test(c.text) && NODE_CALL.test(c.text));
            if (calls.length) {
                const how = providesNode(job, ROOT);
                if (how) {
                    nodeProvisioned.push(`${job.id} — ${calls.length} node call(s), provided by ${how}`);
                } else {
                    const first = calls[0];
                    problems.push(
                        `${job.id} runs on ${job.image}, which ships no node, and invokes it anyway ` +
                            `(${file}:${first.line}: ${first.text.trim().slice(0, 72)}). Add an actions/setup-node ` +
                            `step, or install nodejs in the job. This is how v0.31.0 published everything ` +
                            `except @gjsify/napi.`,
                    );
                }
            }
        }

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
            excused.push(
                `${job.id} — runs on ${unbuilt.join('+')}, ${BAKED_IMAGE} is built for ${[...imageArches].join('+')} only`,
            );
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
    console.log(
        JSON.stringify({ bakedJobs, bare, excused, nodeProvisioned, ledgered: BARE_IMAGE_LEDGER, problems }, null, 2),
    );
} else {
    console.log(
        `ci-image: ${bakedJobs} job(s) on ${BAKED_IMAGE}, ${bare.length} still on a bare fedora image ` +
            `(${excused.length} with no image to move to, ${Object.keys(BARE_IMAGE_LEDGER).length} ledgered); ` +
            `${nodeProvisioned.length} container job(s) invoke node and provide it.`,
    );
    // Printed like the exemptions above, and for the same reason: the interesting
    // number is how many jobs depend on a provision step that is easy to drop when
    // a `run:` block is copied without the step above it.
    for (const n of nodeProvisioned.sort()) console.log(`  · ${n}`);
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
