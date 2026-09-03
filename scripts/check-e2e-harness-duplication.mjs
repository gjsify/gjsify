#!/usr/bin/env node
// No e2e suite carries its own copy of the npm harness.
//
// THE INCIDENT
//
// A hand-written ustar tarball writer, its SRI integrity helper and a spawn-the-CLI
// runner were copy-pasted into fifteen `tests/e2e/*/run.mjs`. They had drifted into
// nine distinct variants of the writer alone — some emitting the explicit NUL
// terminators, some not; some taking a `package.json` object, some a file MAP — and
// `runCli` existed in eight signatures. A correction to the writer therefore landed
// in one suite of fifteen, and the fourteen keeping the old bytes were the ones
// still asserting against them. `tests/e2e/helpers.mjs` had been the shared home the
// whole time and exported none of it.
//
// The lift is only half a fix: nothing stopped the sixteenth copy. This is the other
// half — the harness has ONE home (`tests/e2e/mock-registry.mjs`) and a new private
// copy fails here, naming it. `ALLOWED` is self-retiring: an entry whose suite no
// longer trips its rule FAILS, so an exemption cannot outlive its cause.
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
const ALLOWED = [
    {
        suite: 'publish',
        rule: 'registry-server',
        why: 'the SUBJECT is the publish HTTP layer, not a registry: it captures PUT bodies, the `@scope%2fname` escaping, the auth header and `npm-otp`, and stands up a 409 server, a 401+OTP server and one that accepts every write and serves nothing (the v0.46.0 read-back incident). Its packuments are echoes of the payloads it just accepted, so it can answer the post-PUT read-back; it serves no tarball.',
    },
    {
        suite: 'onboard',
        rule: 'registry-server',
        why: 'serves the npm auth/trust API — /-/whoami, PUT /-/user/…, GET+POST /-/package/<name>/trust — as an OTP-challenge state machine. No packument, no tarball.',
    },
    {
        suite: 'self-update',
        rule: 'registry-server',
        why: 'the assertion IS the URL the CLI asks for: every path but the escaped @gjsify/cli spellings gets a 406, which is the shape of the original defect. Its one packument is synthesised per request from a header and is never downloaded.',
    },
    {
        suite: 'install-script',
        rule: 'registry-server',
        why: 'its subject is the BOOTSTRAP downloader — SHA-256 digest routes, the content-addressed cache and the retry on a dropped connection — with a packument registry only incidentally beside it. Migrating that half is tracked in status/open-todos.md, and is deferred because the suite could not be verified on the machine the migration was written on.',
    },
];

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
    {
        id: 'registry-server',
        // Twenty suites stood up their own `node:http` registry beside the shared
        // one, so its packument/tarball routing had twenty divergent siblings that
        // no correction could reach. Matching the CALL rather than a helper name is
        // what makes a renamed copy still fail.
        test: (src) => /\bcreateServer\s*\(/.test(src),
        fix: `serve fixtures with \`startMockRegistry(packages, { onRequest, onPackument })\` from ../${SHARED_MODULE}`,
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
