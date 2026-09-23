#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Does THIS pull request need an OS-suite workflow's heavy job? Answers `run=true|false`
 * plus a reason, for `macos-suites.yml`, `windows-suites.yml` and `gtk-os-suites.yml`,
 * through `.github/actions/suite-scope`.
 *
 * WHY. Those three spawn five jobs per PR, four of them on macOS, whose concurrency the
 * free plan caps well below Linux. Measured over 30 PR runs each (2026-09-23): 40, 16 and
 * 22 runner-minutes, with a median 12.7 min macOS queue wait (p90 32) before the first
 * step — while most of those PRs changed the Adwaita web/NativeScript renderers or a
 * website gate, which none of the three builds a byte of into what it measures.
 *
 * WHAT A SKIP MUST PROVE, all of it, or the job runs:
 *   · the event is a pull request — `main`, the nightly and a dispatch run everything;
 *   · the changed-file list and the affected classifier's verdict were both read;
 *   · no changed file is one of the workflow's OWN inputs: the workflow file, any path
 *     its non-comment lines name (a script it runs, an e2e suite, a package directory),
 *     the composite actions, or a BUILD-SHAPE file anywhere — a manifest, a tsconfig, a
 *     package-local build script, a prebuild. The suites build the workspace under the
 *     target OS and end in the manifest audit, and those files are what a build and that
 *     audit read, so a change to one can red the leg from any package;
 *   · the classifier did not fall back to a full run;
 *   · its closure (seeds plus everything depending on them) holds none of the packages the
 *     suite tests — every `@gjsify/<name>` its non-comment lines name, read off the workflow
 *     so a suite step added later is covered without anyone remembering this file.
 *
 * The last two reuse `gjsify affected` instead of a second copy of the dependency graph
 * (docs/ci-selective.md): the closure walk, the GLOBAL_TRIGGERS (the CLI, the workspace
 * tooling, `@gjsify/unit`, the lockfile) and the root-script readers all come with it.
 * Every other outcome — an unreadable input, a crash, an unknown shape — runs the job.
 *
 * The four darwin defects and the win32 CLI break named in the workflows' headers all sat
 * in `@gjsify/child_process`, `@gjsify/process`, `@gjsify/net` and `@gjsify/cli`, each a
 * package these suites list, so each of those PRs still runs its leg under this rule.
 *
 * Usage: node scripts/decide-suite-scope.mjs --workflow <path> --changed <file>
 *          --affected <file> [--packages "<a> <b>"] [--paths <ERE>]
 * Writes `run=` and `reason=` to $GITHUB_OUTPUT (stdout without it), and a summary line.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { argv, env, exit, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

/** Files that decide how the workspace BUILDS, or what the manifest audit reads. */
export const BUILD_SHAPE = [
    /(^|\/)package\.json$/,
    /(^|\/)tsconfig[^/]*\.json$/,
    /^gjsify-lock\.json$/,
    /^(packages|showcases|examples|templates)\/.+\/scripts\//,
    /(^|\/)meson(_options\.txt|\.build)$/,
    /(^|\/)prebuilds\//,
    /^\.github\/actions\//,
    /^scripts\/audit-runtimes\.mjs$/,
    /^scripts\/manifest-conformance\//,
    /^packages\/infra\/manifest-conformance\//,
];

/**
 * Repo paths a workflow's non-comment lines name. A named directory or file claims every
 * path under it: `packages/node-gi/node-gi` in a `run:` line makes all of node-gi an input.
 */
export function namedPaths(workflowText) {
    const out = new Set();
    for (const raw of workflowText.split('\n')) {
        if (/^\s*#/.test(raw)) continue;
        const line = raw.replace(/\\/g, '/');
        for (const m of line.matchAll(/(?:^|[\s"'=(])((?:scripts|tests|packages|\.github)\/[\w@.+/-]*[\w@+-])/g)) {
            let p = m[1];
            // `tests/e2e/<suite>/run.mjs` claims the suite, not just its entry file.
            const suite = /^tests\/e2e\/[^/]+\//.exec(p);
            if (suite) p = suite[0];
            out.add(p);
        }
    }
    return [...out].sort();
}

/** Workspace names a workflow's non-comment lines name (`workspace @gjsify/os run test`). */
export function namedPackages(workflowText) {
    const out = new Set();
    for (const raw of workflowText.split('\n')) {
        if (/^\s*#/.test(raw)) continue;
        for (const m of raw.matchAll(/@gjsify\/[a-z0-9][\w.-]*[a-z0-9]/g)) out.add(m[0]);
    }
    return [...out].sort();
}

function claims(path, named) {
    return named.some((n) => path === n || path.startsWith(n.endsWith('/') ? n : `${n}/`));
}

/**
 * @param {object} input
 * @param {string} input.event          github.event_name
 * @param {string[]|undefined} input.changed   PR diff, repo-relative
 * @param {object|undefined} input.affected    `gjsify affected --format=json` output
 * @param {string[]} input.packages     workspaces the suite tests beyond those it names
 * @param {string} input.workflowPath   the calling workflow, repo-relative
 * @param {string} input.workflowText   its content
 * @param {RegExp|undefined} input.extra      additional own inputs
 * @returns {{ run: boolean, reason: string }}
 */
export function decide({ event, changed, affected, packages, workflowPath, workflowText, extra }) {
    if (event !== 'pull_request') return { run: true, reason: `\`${event}\` runs the full matrix` };
    if (!changed || changed.length === 0) {
        return { run: true, reason: 'the changed-file list was empty or unreadable — failing open' };
    }
    if (!affected || typeof affected.global !== 'boolean' || !Array.isArray(affected.workspaces)) {
        return { run: true, reason: 'the affected classifier gave no verdict — failing open' };
    }
    const named = [workflowPath, ...namedPaths(workflowText)];
    const tested = [...new Set([...packages, ...namedPackages(workflowText)])];
    for (const f of changed) {
        if (claims(f, named)) return { run: true, reason: `\`${f}\` is named by ${workflowPath}` };
        const shape = BUILD_SHAPE.find((re) => re.test(f));
        if (shape) return { run: true, reason: `\`${f}\` shapes the build or the manifest audit (${shape.source})` };
        if (extra && extra.test(f))
            return { run: true, reason: `\`${f}\` matches this suite's own inputs (${extra.source})` };
    }
    if (affected.global) return { run: true, reason: `the classifier runs everything: ${affected.reason}` };
    const hit = affected.workspaces.filter((w) => tested.includes(w));
    if (hit.length > 0) return { run: true, reason: `the change reaches ${hit.join(', ')}` };
    return {
        run: false,
        reason:
            (affected.skipAll
                ? 'the classifier maps no changed file to a workspace'
                : `the affected closure (${affected.workspaces.length} workspace(s)) holds none of the ${tested.length} packages ${workflowPath} names`) +
            ', and no changed file is one of its inputs',
    };
}

function flag(name) {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? undefined : argv[i + 1];
}

function readOrUndefined(path, parse) {
    if (!path) return undefined;
    try {
        return parse(readFileSync(path, 'utf8'));
    } catch {
        // An unreadable input is a decision this script may not make: `decide` turns
        // `undefined` into a run.
        return undefined;
    }
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
    const workflowPath = flag('workflow');
    const packages = (flag('packages') ?? '').split(/\s+/).filter(Boolean);
    if (!workflowPath) {
        console.error(
            'usage: decide-suite-scope.mjs --workflow <path> --changed <file> --affected <file> [--packages "<names>"] [--paths <ERE>]',
        );
        exit(2);
    }
    const extraSrc = flag('paths');
    const verdict = decide({
        event: env.GITHUB_EVENT_NAME ?? 'unknown',
        changed: readOrUndefined(flag('changed'), (t) =>
            t
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
        ),
        affected: readOrUndefined(flag('affected'), JSON.parse),
        packages,
        workflowPath,
        workflowText: readFileSync(workflowPath, 'utf8'),
        extra: extraSrc ? new RegExp(extraSrc) : undefined,
    });
    const lines = `run=${verdict.run}\nreason=${verdict.reason.replace(/\n/g, ' ')}\n`;
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines);
    else stdout.write(lines);
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            env.GITHUB_STEP_SUMMARY,
            `### Suite scope: ${verdict.run ? 'run' : 'skip'}\n\n${verdict.reason}\n`,
        );
    }
    console.log(`[suite-scope] ${verdict.run ? 'RUN' : 'SKIP'} — ${verdict.reason}`);
}
