#!/usr/bin/env node
// No e2e suite carries its own copy of the npm harness.
//
// THE INCIDENT
//
// A hand-written ustar tarball writer, its SRI integrity helper and a `spawn the
// CLI` runner were copy-pasted into fifteen `tests/e2e/*/run.mjs`. They had drifted
// into nine distinct variants of the writer alone — some emitting the explicit NUL
// terminators, some not; some taking a `package.json` object, some a file map — and
// `runCli` existed in eight different signatures. A correction to the writer
// therefore landed in one suite of fifteen, and the fourteen keeping the old bytes
// were the ones still asserting against them. `tests/e2e/helpers.mjs` had been the
// shared home the whole time and exported none of it.
//
// The lift is only half a fix: nothing stopped the sixteenth copy. This is the
// other half — the harness now has ONE home (`tests/e2e/mock-registry.mjs`) and a
// new private copy fails here, naming it.
//
// WHAT IT CHECKS
//
//   1. a suite containing a tar-format literal (`ustar`)            → FAIL
//   2. a suite computing an npm `sha512-…` integrity string         → FAIL
//   3. a suite declaring its own `function runCli(`                 → FAIL
//   4. an ALLOWED entry that no longer matches                      → FAIL (self-retiring)
//
// (4) is what keeps the allowlist from becoming where duplication goes to die: an
// entry cannot outlive its cause, and every entry is PRINTED on every run.
//
// Usage: node scripts/check-e2e-harness-duplication.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];
const E2E_DIR = join(ROOT, 'tests', 'e2e');

/** The one home. Exempt by construction — it IS the implementation. */
const SHARED_MODULE = 'mock-registry.mjs';

/**
 * Suites allowed to keep a private copy, each with the reason it cannot use the
 * shared one. An entry whose suite no longer trips a rule FAILS, so a copy that
 * gets lifted takes its exemption with it.
 *
 * @type {Array<{ suite: string, rule: string, why: string }>}
 */
const ALLOWED = [];

/** Each rule names what it recognises and what to do instead. */
const RULES = [
    {
        id: 'tar-writer',
        // The magic field of a ustar header — present in every copy of the writer
        // and in nothing else. Matching the format literal rather than a function
        // name is what makes a renamed copy still fail.
        test: (src) => src.includes("'ustar\\0'") || src.includes('"ustar\\0"'),
        fix: `build fixtures with \`packageTar(files)\` from ../${SHARED_MODULE}`,
    },
    {
        id: 'integrity',
        // Constructing the SRI STRING, which is the duplicated thing. Deliberately
        // not `createHash('sha512')`: `flatpak-sources` needs the HEX digest of the
        // same bytes for a flatpak manifest, which is a different value, and a rule
        // that cannot tell them apart teaches people to silence it. A comment or an
        // `assert.match(…, /^sha512-/)` carries no `${` and so does not match.
        test: (src) => /`sha512-\$\{/.test(src),
        fix: `use \`sriSha512(bytes)\` / \`packageTarball(files)\` from ../${SHARED_MODULE}`,
    },
    {
        id: 'run-cli',
        test: (src) => /\bfunction runCli\s*\(/.test(src),
        fix: `import \`runCli\` from ../${SHARED_MODULE} (pass \`timeoutMs\` where 30s is too short)`,
    },
];

function suites() {
    return readdirSync(E2E_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(E2E_DIR, name, 'run.mjs')))
        .sort();
}

const violations = [];
const matched = new Set();

for (const suite of suites()) {
    const src = readFileSync(join(E2E_DIR, suite, 'run.mjs'), 'utf-8');
    for (const rule of RULES) {
        if (!rule.test(src)) continue;
        const allowed = ALLOWED.find((a) => a.suite === suite && a.rule === rule.id);
        if (allowed) {
            matched.add(`${allowed.suite}:${allowed.rule}`);
            continue;
        }
        violations.push({ suite, rule });
    }
}

const stale = ALLOWED.filter((a) => !matched.has(`${a.suite}:${a.rule}`));

if (ALLOWED.length > 0) {
    console.log('Allowed private harness copies:');
    for (const a of ALLOWED) console.log(`  - ${a.suite} (${a.rule}): ${a.why}`);
}

if (violations.length === 0 && stale.length === 0) {
    console.log(`OK — ${suites().length} e2e suites, one npm harness (tests/e2e/${SHARED_MODULE}).`);
    process.exit(0);
}

for (const { suite, rule } of violations) {
    console.error(`\ntests/e2e/${suite}/run.mjs carries its own ${rule.id}.`);
    console.error(`  → ${rule.fix}`);
}
for (const a of stale) {
    console.error(`\nStale allowlist entry: ${a.suite} (${a.rule}) no longer has a private copy.`);
    console.error('  → delete it from ALLOWED in this script.');
}
console.error(
    '\nThe harness lives in one place because fifteen copies had already drifted into nine.\n' +
        'If the shared module genuinely cannot serve this suite, EXTEND it (`onRequest` is the\n' +
        'seam for a registry that must misbehave) rather than adding a sixteenth copy.',
);
process.exit(1);
