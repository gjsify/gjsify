#!/usr/bin/env node
// The cross-runtime package list and the gate that decides whether its job runs
// are two copies of one set. This holds them to each other.
//
// THE DRIFT. `main.yml` names the packages whose suites run on node + bun + deno
// in `env.CROSS_RUNTIME_PACKAGES`, and the `cross-runtime` job's `if:` repeats the
// same set as a chain of `contains(include-args, '@gjsify/<name>')`. Selective CI
// means the second list decides whether the first one is ever read: a package in
// the env block but missing from the chain runs only when something ELSE in the
// chain is affected, which reads as "it is covered" and is not.
//
// Measured: `packages/gjs/runtime` — the runtime DETECTION package, whose own spec
// header records "That is how Bun read as Node while four legs were green" — was in
// neither list for nine days after it grew the scripts. The five assertions that
// read `globalThis` on a real host are the only ones that cannot be checked
// anywhere else, and they were the ones never run.
//
// WHAT IT DOES NOT DO. It does not derive the list from the manifests. Membership
// is a JUDGEMENT — the env block's own header spells out the rule (a spec must
// import its own package by name, or a bare Web specifier the alias table routes
// to the polyfill, or be infra nobody's builtin) and every entry is run on all
// three runtimes by hand before being listed. A derived list would quietly enrol
// packages whose "green" leg tests the host's builtin instead of our polyfill.
// So: the human picks the set, and this makes the machine agree with itself.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'main.yml');

const yaml = readFileSync(WORKFLOW, 'utf-8');

/** The `>-` folded block under `CROSS_RUNTIME_PACKAGES:`, as a list of paths. */
function readPackageList() {
    const m = /^\s*CROSS_RUNTIME_PACKAGES:\s*>-\s*$/m.exec(yaml);
    if (!m) {
        console.error('check-cross-runtime-gate: no `CROSS_RUNTIME_PACKAGES: >-` block in main.yml.');
        process.exit(1);
    }
    const rest = yaml
        .slice(m.index + m[0].length)
        .split('\n')
        .slice(1);
    const out = [];
    for (const line of rest) {
        if (line.trim() === '') break;
        if (!/^\s+\S/.test(line)) break;
        out.push(line.trim());
    }
    return out;
}

/** Every `@gjsify/<name>` the `cross-runtime` job's `if:` mentions. */
function readGateNames() {
    const line = yaml.split('\n').find((l) => l.includes('@gjsify/storybook-core') && l.includes('contains('));
    if (line === undefined) {
        console.error("check-cross-runtime-gate: could not find the cross-runtime job's `if:` chain.");
        process.exit(1);
    }
    return new Set(
        [...line.matchAll(/contains\(needs\.changes\.outputs\.include-args,\s*'(@gjsify\/[^']+)'\)/g)].map((m) => m[1]),
    );
}

const paths = readPackageList();
const gated = readGateNames();
const failures = [];

for (const rel of paths) {
    const manifest = join(ROOT, rel, 'package.json');
    if (!existsSync(manifest)) {
        failures.push(`${rel}: listed in CROSS_RUNTIME_PACKAGES but has no package.json`);
        continue;
    }
    const { name } = JSON.parse(readFileSync(manifest, 'utf-8'));
    if (typeof name !== 'string') {
        failures.push(`${rel}: package.json declares no \`name\``);
        continue;
    }
    if (!gated.has(name)) {
        failures.push(
            `${name} (${rel}): in CROSS_RUNTIME_PACKAGES but NOT in the cross-runtime job's \`if:\` chain, so a PR ` +
                'touching only it never runs the bun/deno legs it was listed for. Add ' +
                `\`|| contains(needs.changes.outputs.include-args, '${name}')\`.`,
        );
    }
}

// The reverse direction is not symmetric: `@gjsify/cli` is deliberately in the
// chain without being in the list, because a CLI change rebuilds every bundle the
// legs run. Only names that look like a stale list entry are reported.
const listed = new Set(
    paths
        .map((rel) => join(ROOT, rel, 'package.json'))
        .filter((f) => existsSync(f))
        .map((f) => JSON.parse(readFileSync(f, 'utf-8')).name),
);
for (const name of gated) {
    if (name === '@gjsify/cli') continue;
    if (!listed.has(name)) {
        failures.push(
            `${name}: in the cross-runtime job's \`if:\` chain but not in CROSS_RUNTIME_PACKAGES, so the job is ` +
                'triggered for it and then does not run its suite. Add it to the list, or drop it from the chain.',
        );
    }
}

if (failures.length > 0) {
    console.error(`check-cross-runtime-gate: the list and its gate disagree on ${failures.length} package(s):`);
    for (const f of failures) console.error(`  · ${f}`);
    process.exit(1);
}

console.log(`check-cross-runtime-gate: ${paths.length} package(s) listed, and the job's gate names every one.`);
