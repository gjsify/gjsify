#!/usr/bin/env node
// No workflow resolves a `@gjsify/*` closure from npm through a bare `npm install`.
//
// THE INCIDENT
//
// v0.46.0 (run 33735989472) went red in three jobs, all in the same step and none of
// them in a publish: `Prepare a Node-runnable @gjsify/cli` died with
//
//   npm error code ETARGET
//   npm error notarget No matching version found for @gjsify/child_process@^0.46.0.
//
// on a version the publish client had PUT 3m56s earlier (09:25:10 vs an ETARGET at
// 09:29:06), and which npm's own `time` field records at 09:29:21 — fifteen seconds
// AFTER the installer that could not find it gave up. The ordering was correct
// (`needs: publish`, dependency 3m21s before dependent); npm served a packument older
// than a PUT it had already acknowledged. Attempt 3 of the same run was green with no
// change to the tree.
//
// WHY A CHECK AND NOT JUST THE FIX. Four jobs carried that step, and the three that
// went red were simply the three that started earliest — `publish-napi` at 09:29:37
// and the gtk-runtime legs at 09:31:19 ran the identical command and passed. So the
// defect was never in those three jobs; it was in a SHAPE that four of them shared and
// that any new publish leg would copy. `release.yml` never runs on a pull request, so
// a fifth copy would be reviewed by nobody and would first execute during a release —
// the same argument that puts `check-workflow-inline-scripts.mjs` in this job.
//
// WHAT IT CHECKS
//
// Every line in `.github/workflows/**` that hands an install verb (`npm install`,
// `npm i`, `npm ci`, `npx`) a `@gjsify/*` spec must route through
// `scripts/npm-install-published.mjs`. `scripts/bootstrap-published-cli.mjs` never
// trips it: it derives the spec itself, so no workflow line names one.
//
// `ALLOWED` is self-retiring — an entry whose snippet no longer appears FAILS, so an
// exemption cannot outlive its cause — and every entry is printed on every run.
//
// Usage: node scripts/check-workflow-registry-installs.mjs [--root <dir>]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

/** The one wrapper. A line naming it has already answered the question. */
const WRAPPER = 'npm-install-published.mjs';

/** `npm install`, `npm i`, `npm ci`, `npx` — the verbs that make npm resolve a tree. */
const INSTALL_VERB = /\bnpm\s+(?:install|i|ci)\b|\bnpx\b/;

/** A pinned or dist-tagged `@gjsify/<name>@<something>` argument. */
const GJSIFY_SPEC = /@gjsify\/[A-Za-z0-9._-]+@/;

/**
 * Lines allowed to resolve a `@gjsify/*` spec directly, each with the reason the
 * wrapper does not belong there. `snippet` must still occur in `file`, or this check
 * fails on the stale entry.
 *
 * @type {Array<{ file: string, snippet: string, why: string }>}
 */
const ALLOWED = [
    {
        file: 'cli-cross-platform.yml',
        snippet: 'npm install --no-audit --no-fund --no-save "@gjsify/node-gi@latest" > npm-nodegi.log',
        why: [
            'the FAILURE is the measurement. node-gi declares `scripts.install: node-gyp rebuild`, so this',
            'step exists to find out whether a source build is forced on this OS; the surrounding shell',
            'captures the log, keeps `install_ok`, and attributes a rollback against a version bound. A',
            'retry here would re-run the very failure being measured and then report a lag verdict over it.',
        ].join(' '),
    },
    {
        file: 'cli-cross-platform.yml',
        snippet: '"@gjsify/node-gi@latest" "@gjsify/gtk-runtime-$TARGET@latest" > npm-load.log',
        why: [
            'same step shape as the row above, one probe further: `|| true` because a failed install IS one',
            'of the outcomes this leg maps. Its subject is the bundled GTK runtime loading, not resolution.',
        ].join(' '),
    },
    {
        file: 'cli-cross-platform.yml',
        snippet: 'npx --yes "@gjsify/cli@${CLI_VERSION}" install "@gjsify/cli@${CLI_VERSION}"',
        why: [
            'the resolver under test is GJSIFY’s install backend, not npm’s — the assertion is that',
            '`linkBins` writes a runnable shim (the win32 cmd-shim trio). npx only stages the CLI that',
            'performs it, and the spec it stages is a dist-tag (`latest` on the release dispatch), so the',
            'top-level ETARGET shape does not arise. Wrapping an `npx` in an `npm install` retry would',
            'also not retry what fails: a lag inside gjsify’s own resolver reports in its words, not npm’s.',
        ].join(' '),
    },
];

const findings = [];
const files = readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

for (const file of files) {
    const path = join(WORKFLOW_DIR, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // A comment cannot run npm. Checking the code only is what keeps the prose in
        // these workflows — which quotes npm commands constantly — from being findings.
        if (/^\s*#/.test(line)) continue;
        if (!INSTALL_VERB.test(line) || !GJSIFY_SPEC.test(line)) continue;
        if (line.includes(WRAPPER)) continue;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.snippet))) continue;
        findings.push({ file, line: i + 1, text: line.trim() });
    }
}

const stale = ALLOWED.filter((a) => {
    const path = join(WORKFLOW_DIR, a.file);
    try {
        return !readFileSync(path, 'utf8').includes(a.snippet);
    } catch {
        return true;
    }
});

console.log(
    `check-workflow-registry-installs: read ${files.length} workflow file(s) in ${relative(ROOT, WORKFLOW_DIR)}`,
);
for (const a of ALLOWED) {
    console.log(`  allowed  ${a.file}: ${a.snippet}`);
    console.log(`           ${a.why}`);
}

if (stale.length > 0) {
    console.error('\ncheck-workflow-registry-installs: stale ALLOWED entr(y|ies) — the snippet no longer occurs:');
    for (const a of stale) console.error(`  ${a.file}: ${a.snippet}`);
    console.error('An exemption must not outlive its cause. Delete the entry.');
    process.exit(1);
}

if (findings.length > 0) {
    console.error('\ncheck-workflow-registry-installs: a bare npm install of a @gjsify/* spec:');
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
    console.error(
        '\nRoute it through `node scripts/npm-install-published.mjs -- <npm args>` (or, for a release\n' +
            "leg's Node-runnable CLI, `node scripts/bootstrap-published-cli.mjs`). npm can serve a\n" +
            'packument older than a PUT it has acknowledged, and that ETARGET is not a verdict — the\n' +
            'measurement is in the wrapper’s header. If the failure genuinely IS the measurement, add an\n' +
            'ALLOWED entry here saying so.',
    );
    process.exit(1);
}

console.log(`clean — no workflow resolves a @gjsify/* spec without ${WRAPPER}`);
