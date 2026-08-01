#!/usr/bin/env node
/**
 * Re-pin every platform-gated ARTIFACT package to its parent's new version.
 *
 * ADR 0003 rule 5 requires a parent to pin its artifact packages at an EXACT
 * version equal to their own (the esbuild model, per ADR 0017) — a range would
 * let a bumped parent resolve a stale payload, whose only symptom is a
 * wrong-ABI load on a consumer's machine. The `tier` conformance rule fails on
 * any skew, which makes the invariant visible; this script is what keeps it
 * TRUE across a release bump.
 *
 * WHY A SCRIPT AND NOT `.release-it.json`:
 *
 * `@release-it/bumper` can write arbitrary JSON paths (`out: [{ file, path:
 * [...] }]`), and per-edge entries were the first draft. Two reasons against:
 *
 *   1. It races. `out` already carries the glob `packages/*\/*\/package.json`,
 *      which MATCHES a parent manifest. Bumper reads every target before it
 *      writes any (`Promise.all` over callbacks that read synchronously and
 *      write after one `await`), so two entries for one file both start from
 *      the ORIGINAL text and the later write silently discards the earlier
 *      one's edit. Whether the pins survive would depend on array order.
 *   2. It does not scale. ADR 0017 splits all 11 native packages into ~51
 *      per-target artifact packages; 51 hand-listed paths in the release config
 *      is exactly the drifting list this repo keeps replacing with derived
 *      rules, and a new target would be pinned by whoever remembered the line.
 *
 * So the edge set is DERIVED from the same `gjsify.artifactOf` declarations the
 * conformance rule reads — one source of truth, no per-edge configuration, and
 * a new artifact package is picked up by existing.
 *
 * Runs from release-it's `after:bump` hook, i.e. after every `version` field has
 * been written. Idempotent: re-running changes nothing.
 *
 *   node scripts/sync-artifact-pins.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectPublishedPackages } from './manifest-conformance/rules/tier.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DRY_RUN = process.argv.includes('--dry-run');

/** The file's own indentation, so a rewrite produces no whitespace diff. */
function indentOf(source) {
    const match = source.match(/\n([ \t]+)"/);
    return match ? match[1] : '  ';
}

/**
 * Every parent → artifact edge whose pin does not equal the artifact's version,
 * grouped by the parent manifest that must be rewritten.
 */
function driftedPinsByParent(published) {
    /** @type {Map<string, Array<{artifact: string, from: string|undefined, to: string}>>} */
    const byParent = new Map();
    for (const [name, info] of published) {
        if (typeof info.artifactOf !== 'string' || !info.version) continue;
        const parent = published.get(info.artifactOf);
        if (!parent) continue; // the conformance rule owns that failure
        const edge = parent.edges.find((e) => e.dep === name && e.field === 'optionalDependencies');
        if (!edge || edge.range === info.version) continue;
        const list = byParent.get(parent.path) ?? [];
        list.push({ artifact: name, from: edge.range, to: info.version });
        byParent.set(parent.path, list);
    }
    return byParent;
}

const published = collectPublishedPackages(ROOT);
const drifted = driftedPinsByParent(published);

if (drifted.size === 0) {
    console.log('sync-artifact-pins: OK — every artifact pin already equals its package version, nothing to do.');
    process.exit(0);
}

for (const [parentPath, edges] of drifted) {
    const file = join(ROOT, parentPath, 'package.json');
    const source = readFileSync(file, 'utf8');
    const manifest = JSON.parse(source);
    for (const { artifact, from, to } of edges) {
        manifest.optionalDependencies[artifact] = to;
        console.log(`sync-artifact-pins: ${parentPath} → ${artifact} ${from} => ${to}`);
    }
    if (!DRY_RUN) writeFileSync(file, `${JSON.stringify(manifest, null, indentOf(source))}\n`);
}

if (DRY_RUN) console.log('sync-artifact-pins: --dry-run, nothing written.');
