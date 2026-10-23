#!/usr/bin/env node
// Decide what a `release.yml` run with `only=<names/globs>` actually does.
//
// THE INCIDENT — run 38366110484, `-f skip_publish=false -f only='@gjsify/gi-runtime-android'`
//
// The `publish` job turned `only` into `gjsify foreach --include …`, but
// `packages/node-gi/*` and `packages/napi/*` are NOT root workspaces, so foreach
// threw "--include matched no workspace" and `publish` failed. Every dedicated job
// `needs: publish`, so all of them were skipped: `only` could not recover ANY package
// those jobs publish. The mirror flaw: the dedicated jobs ignored `only`, so
// `only=@gjsify/adwaita-fonts` still rebuilt and republished all of them.
//
// WHAT THIS DECIDES, from the tree rather than a second list of workspaces:
//   sweep      the patterns that match a root workspace, for `gjsify foreach --include`
//              (empty = skip the sweep, the job still succeeds)
//   <job>      'true'/'false' per dedicated publish job: it runs when `only` is empty or
//              names/globs one of ITS packages
// A pattern that matches nothing anywhere is an error, exactly as in foreach.
//
// The one hardcoded thing is JOBS (which package a dedicated job publishes — that lives
// in the workflow's steps). `--check` holds it to the tree: every non-private package
// that is not a root workspace must be published by exactly one job.
//
// Usage: node scripts/release-only-plan.mjs [--only "<patterns>"] [--root <dir>] [--check]
// Writes `key=value` lines to $GITHUB_OUTPUT when set, else to stdout.

import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createContext } from '../packages/infra/manifest-conformance/lib/context.mjs';

export const JOBS = {
    gtk_darwin: ['@gjsify/gtk-runtime-darwin-arm64', '@gjsify/gtk-runtime-darwin-x64'],
    gtk_win32: ['@gjsify/gtk-runtime-win32-x64', '@gjsify/gtk-runtime-win32-arm64', '@gjsify/gl-runtime-win32-x64'],
    node_gi: ['@gjsify/node-gi'],
    napi: ['@gjsify/napi', '@gjsify/napi-darwin-arm64', '@gjsify/napi-linux-x64'],
    node_runtime: ['@gjsify/node-runtime-darwin-arm64', '@gjsify/node-runtime-darwin-x64', '@gjsify/node-runtime-win32-x64', '@gjsify/node-runtime-win32-arm64'],
    gi_android: ['@gjsify/gi-runtime-android'],
};

// Same translation as `globToRegex` in @gjsify/workspace, which `foreach --include` uses.
function globToRegex(pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`);
}

/**
 * @param {string} only space-separated names/globs, '' = everything
 * @param {{workspaceNames: string[], dedicatedNames: string[]}} tree
 */
export function planOnly(only, { workspaceNames, dedicatedNames }) {
    const patterns = only.split(/\s+/).filter(Boolean);
    if (patterns.length === 0) {
        return { sweep: '', all: 'true', ...Object.fromEntries(Object.keys(JOBS).map((j) => [j, 'true'])) };
    }
    const sweep = [];
    const hit = new Set();
    const unmatched = [];
    for (const pattern of patterns) {
        const re = globToRegex(pattern);
        const inWorkspace = workspaceNames.some((n) => re.test(n));
        const dedicated = dedicatedNames.filter((n) => re.test(n));
        if (inWorkspace) sweep.push(pattern);
        for (const n of dedicated) hit.add(n);
        if (!inWorkspace && dedicated.length === 0) unmatched.push(pattern);
    }
    if (unmatched.length > 0) {
        throw new Error(`only: ${unmatched.map((p) => JSON.stringify(p)).join(', ')} matched no publishable package`);
    }
    const jobs = Object.fromEntries(
        Object.entries(JOBS).map(([job, names]) => [job, String(names.some((n) => hit.has(n)))]),
    );
    return { sweep: sweep.join(' '), all: 'false', ...jobs };
}

/** Problems in JOBS relative to the tree; empty = in sync. */
export function checkJobs(dedicatedNames) {
    const claimed = Object.values(JOBS).flat();
    const problems = [];
    for (const n of dedicatedNames) if (!claimed.includes(n)) problems.push(`${n} is published by no job in JOBS`);
    for (const n of claimed) if (!dedicatedNames.includes(n)) problems.push(`${n} in JOBS is not a dedicated package`);
    const dupes = claimed.filter((n, i) => claimed.indexOf(n) !== i);
    for (const n of dupes) problems.push(`${n} is claimed by more than one job`);
    return problems;
}

export function readTree(root) {
    const ctx = createContext({ root, discoveryRoots: ['packages'] });
    const workspaceNames = ctx.packages.map((p) => p.name);
    const inWorkspace = new Set(ctx.packages.map((p) => p.dir));
    const dedicatedNames = ctx.allPackages
        .filter((p) => !inWorkspace.has(p.dir) && !p.private && typeof p.name === 'string')
        .map((p) => p.name);
    return { workspaceNames, dedicatedNames };
}

function main() {
    const args = process.argv.slice(2);
    const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const root = arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
    const tree = readTree(root);

    if (args.includes('--check')) {
        const problems = checkJobs(tree.dedicatedNames);
        if (problems.length > 0) {
            console.error(`release-only-plan: JOBS is out of sync with the tree (${problems.length}):`);
            for (const p of problems) console.error(`  ${p}`);
            console.error('Update JOBS in scripts/release-only-plan.mjs and the job `if:` in release.yml.');
            process.exit(1);
        }
        console.log(
            `release-only-plan: ${tree.dedicatedNames.length} dedicated packages, all owned by exactly one job`,
        );
        return;
    }

    let plan;
    try {
        plan = planOnly(arg('--only') ?? process.env.ONLY ?? '', tree);
    } catch (e) {
        console.error(`release-only-plan: ${e.message}`);
        process.exit(1);
    }
    const lines = Object.entries(plan).map(([k, v]) => `${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    else console.log(lines.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
