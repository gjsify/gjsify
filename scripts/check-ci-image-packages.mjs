#!/usr/bin/env node
// Hold the CI container images to the jobs that use them. Four questions, all
// DERIVED from the workflows rather than from a list somebody remembers to update:
//
//   1. Does a job on the baked image install packages the image already carries?
//   2. Which jobs still run on a bare `fedora:<major>` and pay `dnf install` every
//      run? One that CAN switch and has not must sit in `BARE_IMAGE_LEDGER` WITH A
//      REASON, printed on every run — the `unchecked-fields.mjs` idiom, where an
//      honest "not yet" is available and a silent one is not.
//   3. The MIRROR of (1): does a job USE a tool the image never carries or installs?
//   4. Does every `dnf install` under `.github/` disable the third-party openh264
//      repo?
//
// (3)'s incident: `release.yml`'s `napi-prebuild-linux` runs on the baked image,
// which bakes no nodejs, and ends in `node scripts/stage-prebuild.mjs` — with no
// setup-node step, because the step was copied from `napi.yml` without the step
// above it. On the v0.31.0 publish the meson build completed and then died on
// `node: command not found`; `publish-napi` needs that artifact, so the whole sweep
// published and `@gjsify/napi` alone stayed at 0.30.0. Invisible until a real
// release because `release.yml` runs on `release`/`workflow_dispatch` only — the
// same reason `check-workflow-inline-scripts.mjs` exists. All three ways of
// providing node are recognised (setup-node, a local composite action that runs it,
// a job's own `dnf install nodejs`), so the check states a fact, not a house style.
//
// (2) is a check rather than a comment because during the v0.26.0 release sweep the
// `dnf install` step took 41 minutes twice (normal: 22 seconds), killing the
// Adwaita-storybook job on its timeout while a Docker Hub pull timeout independently
// failed `napi`.
//
// A job that CANNOT switch is DERIVED, never ledgered: `build-ci-image.yml` builds
// `linux/amd64` only, so an arm64 job has no image to move to. The ledger records
// DECISIONS only — the three entries it once held had all drifted off the thing they
// described (a merged PR named as the blocker, a misquoted `fedora:` pin), which is
// what deriving prevents. Widening the image to linux/arm64 retires all three
// exemptions with nothing to remember to update.
//
// (4)'s incident: `dnf install gdk-pixbuf2` (or `-devel`, or `gtk4-devel`) pulls
// openh264 through libheif → libopenh264.so.8, and every edge is a HARD `Requires`,
// so `--setopt=install_weak_deps=False` does NOT drop it — the assumption that made
// this look handled. The package is served by the separately hosted
// `fedora-cisco-openh264` repo, enabled by default in the base images, and an outage
// there fails the WHOLE transaction for a codec nothing here decodes;
// `--disablerepo=fedora-cisco-openh264` resolves the soname to Fedora's `noopenh264`
// stub instead (#1057). Two of four sites carried the flag and two did not, so the
// rule is UNIVERSAL — every `dnf install` under `.github/`, no allowlist, no "which
// packages pull openh264" table to keep in sync. The corpus is the DIRECTORY and not
// a file-type list because `emulated-build.sh` was invisible while this script read
// `.github/workflows/*.yml` only.
//
// Usage: node scripts/check-ci-image-packages.mjs [--json] [--root <dir>]
//
// `--root` runs the checks against a FIXTURE tree, so the failure paths are
// exercised (`tests/e2e/release-bundle-gate` drives it) — a guard whose failure path
// never runs is the shape this file was written to catch.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex === -1 ? '.' : process.argv[rootIndex + 1];
const WORKFLOW_DIR = join(ROOT, '.github/workflows');
const CI_DIR = join(ROOT, '.github');
const DOCKERFILE = join(ROOT, '.docker/ci-fedora.Dockerfile');
const IMAGE_WORKFLOW = 'build-ci-image.yml';
const BAKED_IMAGE = 'ghcr.io/gjsify/ci-fedora';

// job id -> why a job that COULD run on the baked image deliberately does not.
// Empty today, and two failure modes keep it honest: an entry for a job that is no
// longer bare fails, and so does one the arch derivation already excuses — a
// derivable reason written down twice is the copy that drifts.
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
 * Containerised jobs, without a YAML parser: workflows here use `${{ }}` expressions
 * in `container.image`, and only each job's image and `run:` blocks are wanted, so a
 * scanner keyed on this repo's indentation is enough and adds no dependency.
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
        // For question (3): a step can PROVIDE a tool as well as install one, and a
        // local composite action can provide it one level down.
        const uses = /^\s*(?:- )?uses:\s*(\S+)/.exec(line);
        if (uses) cur.uses.push(uses[1]);
        // A one-line `run:` is a command to check for (3), but folding it into `run`
        // would hand question (1) a package list it has never read. Block scalars go
        // to both; this form goes to `commands` only.
        const inlineRun = /^\s*(?:- )?run:\s+(?![|>])(.*)$/.exec(line);
        if (inlineRun) cur.commands.push({ line: i + 1, text: inlineRun[1] });
        // Both spellings, because the arm64 legs use the second: a literal
        // `runs-on:`, and the `runner:` values of a static matrix `include:` that
        // `runs-on: ${{ matrix.runner }}` selects from.
        const runner = /^\s*(?:- )?(?:runs-on|runner):\s*(\S+)/.exec(line);
        if (runner && !runner[1].startsWith('${{')) cur.runners.push(runner[1]);
        // Both block scalars: `|` alone missed every `run: >`, including
        // `prebuilds.yml`'s only `dnf install`, so (1) never read that job's package
        // list and (3) would have called its nodejs install absent.
        //
        // A `>` block is FOLDED here as YAML folds it (lines joined by a space)
        // rather than copied verbatim, because `packagesIn` reads a `dnf install`
        // list to end of line and the folded spelling puts the packages on the lines
        // after it. Keeps that parser one parser instead of two.
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

// Question (3). `corepack`/`npx`/`npm` ship with Node, so a job reaching for any of
// them needs the same provision.
const NODE_TOOLS = ['node', 'npx', 'npm', 'corepack'];
// Must be a COMMAND, not a substring: `node-gi`, `node_modules`, `nodejs` and
// `--app node` all contain the word and none invoke the binary. So the token has to
// start a command — line start, or after a shell operator/`-c "` — and be followed
// by whitespace or end.
const NODE_CALL = new RegExp(
    String.raw`(?:^|[;&|(]|&&|\|\||\bsudo\s|\bsu\s[^;&|]*-c\s*['"])\s*(${NODE_TOOLS.join('|')})(?=\s|$)`,
);
const COMMENT = /^\s*#/;

// Question (4). A hard `Requires` chain, so this is the only flag that drops it —
// see the header — and it must hold at EVERY site.
const OPENH264_FLAG = '--disablerepo=fedora-cisco-openh264';

/** Every file under `.github/`, recursively — the corpus a CI job executes. */
function ciFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...ciFiles(path));
        else if (entry.isFile()) out.push(path);
    }
    return out;
}

/**
 * `dnf install` commands in a file, as {line, text} with continuations joined.
 *
 * Lines are counted AS AUTHORED while the text is the whole logical command, so a
 * flag on a later `\`-continued line counts. A FOLDED `run: >` block has no
 * continuations — YAML joins those lines itself — which is why the flag has to sit on
 * the `dnf install -y` line there.
 */
// `dnf` and `install` with any number of FLAGS between them, which is the
// shape almost every real call uses (`dnf -y install …`). Matching the literal
// substring `dnf install` — what this did until 2026-08-22 — was wrong in both
// directions at once, and both were live in this tree:
//
//   MISSED  `.github/ship-oracle/verify-rpm.sh:34`
//           `dnf -y install --setopt=… findutils diffutils`
//           A real, unguarded install the rule could not see, because the `-y`
//           sits between the two words.
//   FLAGGED `.github/ship-oracle/verify-rpm.sh:115`
//           `echo "== dnf install"`
//           A progress message. Not a command at all — the substring was inside
//           a string literal.
//
// So the one problem the rule reported was an echo, and the one real defect it
// stayed silent on was two lines up in the same file. Quoted strings are removed
// before matching (that kills the echo class), and the search is anchored to a
// command position — line start, or after `|`, `&&`, `;`, `(` — so prose like
// "no per-job dnf install" in an unindented line cannot re-enter through the
// comment gap.
const DNF_INSTALL = /(?:^|[|&;(])\s*(?:sudo\s+)?dnf\s+(?:-{1,2}[^\s]+\s+)*install(?:\s|$)/;
const QUOTED = /'[^']*'|"[^"]*"/g;

function dnfCommands(body) {
    const lines = body.split('\n');
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        if (COMMENT.test(lines[i]) || !DNF_INSTALL.test(lines[i].replace(QUOTED, ''))) continue;
        let text = lines[i];
        for (let j = i; /\\\s*$/.test(lines[j]) && j + 1 < lines.length; j++) text += ` ${lines[j + 1]}`;
        found.push({ line: i + 1, text });
    }
    return found;
}

/** A step that puts Node on PATH: setup-node itself, or a local composite action that does. */
function providesNode(job, root) {
    for (const ref of job.uses) {
        if (ref.startsWith('actions/setup-node')) return `${ref} step`;
        if (!ref.startsWith('./')) continue;
        // A local composite action, one level down — how `main.yml`'s jobs get Node.
        // Not recursed further: this repo nests one deep.
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
    // Or the job installs it itself, as `prebuilds.yml` does. Read through the SAME
    // parser question (1) uses, so the two cannot disagree about what a job installs.
    if (packagesIn(job.run).has('nodejs')) return 'its own nodejs install';
    return null;
}

const dockerfile = readFileSync(DOCKERFILE, 'utf8');
const baked = new Set();
for (const m of dockerfile.matchAll(/RUN dnf install -y(.*?)&& dnf clean all/gs)) {
    for (const tok of m[1].split(/[\s\\]+/)) if (tok && !tok.startsWith('-')) baked.add(tok);
}

// The architectures the baked image is actually PUBLISHED for, read from the workflow
// that publishes it rather than assumed: a job cannot move to an image never built
// for its runner, and reading it here makes widening `platforms:` the whole change.
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
let dnfLines = 0;

for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))) {
    for (const job of scanWorkflow(file)) {
        if (!job.image) continue;

        // (3) Node is present on these images only if the job put it there. Derived,
        // so the day the Dockerfile bakes nodejs this stops asking for a setup-node.
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

        // Structurally excused: one of the job's runners is an arch the baked image
        // is not published for, so there is nothing to switch to.
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

// (4) Every `dnf install` under `.github/`, whatever kind of file it lives in and
// whether or not the job scanner understood the job around it — the two ways
// `emulated-build.sh` and `prebuilds.yml` each stayed unchecked.
for (const file of ciFiles(CI_DIR)) {
    let body;
    try {
        body = readFileSync(file, 'utf8');
    } catch {
        continue;
    }
    for (const cmd of dnfCommands(body)) {
        dnfLines += 1;
        if (cmd.text.includes(OPENH264_FLAG)) continue;
        problems.push(
            `${file}:${cmd.line} runs \`dnf install\` without ${OPENH264_FLAG}. gdk-pixbuf2 pulls ` +
                `openh264 through a HARD Requires chain (libheif → libopenh264.so.8), so ` +
                `--setopt=install_weak_deps=False does not drop it, and the package comes from a ` +
                `separately hosted repo whose outage fails the whole transaction (#1057). Add the flag — ` +
                `on the \`dnf install\` line itself inside a folded \`run: >\` block.`,
        );
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

// The baked image's own Dockerfile installs gdk-pixbuf2 too, so it carries the same
// #1057 exposure — reported rather than left silent. It is outside the corpus because
// adding the flag there CHANGES WHAT THE IMAGE CONTAINS (openh264 → the noopenh264
// stub) and rebuilds the base every CI job runs on: a decision to take on its own,
// not as a side effect of a guard. Moving it under the rule is this constant joining
// `ciFiles()`.
const dockerfileUnguarded = dnfCommands(dockerfile).filter((c) => !c.text.includes(OPENH264_FLAG));

if (process.argv.includes('--json')) {
    console.log(
        JSON.stringify(
            {
                bakedJobs,
                bare,
                excused,
                nodeProvisioned,
                dnfLines,
                dockerfileUnguarded: dockerfileUnguarded.map((c) => c.line),
                ledgered: BARE_IMAGE_LEDGER,
                problems,
            },
            null,
            2,
        ),
    );
} else {
    console.log(
        `ci-image: ${bakedJobs} job(s) on ${BAKED_IMAGE}, ${bare.length} still on a bare fedora image ` +
            `(${excused.length} with no image to move to, ${Object.keys(BARE_IMAGE_LEDGER).length} ledgered); ` +
            `${nodeProvisioned.length} container job(s) invoke node and provide it; ` +
            `${dnfLines} \`dnf install\` line(s) under ${CI_DIR} carry ${OPENH264_FLAG}.`,
    );
    if (dockerfileUnguarded.length) {
        console.log(
            `  · ${DOCKERFILE} has ${dockerfileUnguarded.length} \`dnf install\` line(s) ` +
                `(${dockerfileUnguarded.map((c) => c.line).join(', ')}) without ${OPENH264_FLAG} — ` +
                `same #1057 exposure, deliberately outside the rule: adding it rebuilds the base image.`,
        );
    }
    // The interesting number is how many jobs depend on a provision step that is easy
    // to drop when a `run:` block is copied without the step above it.
    for (const n of nodeProvisioned.sort()) console.log(`  · ${n}`);
    // Both kinds, every run: the derived exemptions are the work item (one
    // `platforms:` edit retires all of them), the ledgered ones are owned decisions.
    for (const e of excused.sort()) console.log(`  · ${e}`);
    for (const id of Object.keys(BARE_IMAGE_LEDGER).sort()) console.log(`  · ${id} — ${BARE_IMAGE_LEDGER[id]}`);
    for (const p of problems) console.error(`  ✗ ${p}`);
}

if (problems.length) {
    console.error(`ci-image: ${problems.length} problem(s).`);
    process.exit(1);
}
