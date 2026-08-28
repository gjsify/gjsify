#!/usr/bin/env node
// Re-assert a populated `@gjsify/node-runtime-<target>` package right before it is
// published.
//
//   node packages/node-runtime/scripts/verify-node-runtime.mjs \
//     --package packages/node-runtime/node-runtime-darwin-arm64
//
// The fetcher already checks everything below while it writes. This runs against
// what is ON DISK a step later, which is a different question: it is the gate that
// catches a step that was skipped, a cache that served a stale tree, or a matrix
// leg whose `--out` pointed at the sibling package. A script rather than an inline
// `node -e` in the workflow, for the reason `verify-bundle-manifest.mjs` records:
// three v0.28.0 bundle publishes failed on a SyntaxError from a quote spliced into
// a single-quoted shell string, while the bundles themselves were correct.

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import {
    EXPECTED_LICENSE_BYTES,
    LICENSE_FIRST_LINE,
    MIN_BINARY_BYTES,
    NODE_VERSION,
    TARGETS,
} from './node-release.mjs';

const problems = [];
const check = (ok, message) => {
    if (!ok) problems.push(message);
};

let pkgDir;
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--package') pkgDir = process.argv[++i];
}
if (pkgDir === undefined) {
    console.error('verify-node-runtime: --package <dir> is required');
    process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const target = String(manifest.name).replace(/^@gjsify\/node-runtime-/, '');
const spec = TARGETS[target];
if (spec === undefined) {
    console.error(`verify-node-runtime: ${manifest.name} does not name one of ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
}

// The manifest half. `files` is what decides whether the payload reaches npm at
// all — the directory is gitignored, so `files` is the ONLY thing overriding that,
// and a package that fetched 120 MB and published none of it looks identical to a
// successful run from the outside.
const files = Array.isArray(manifest.files) ? manifest.files : [];
check(files.includes('bin'), `${manifest.name}: \`files\` must list "bin" — the payload is gitignored without it`);
check(
    manifest.license === 'SEE LICENSE IN bin/LICENSE',
    `${manifest.name}: \`license\` must be "SEE LICENSE IN bin/LICENSE", got ${JSON.stringify(manifest.license)}`,
);
check(
    Array.isArray(manifest.os) &&
        manifest.os[0] === spec.os &&
        Array.isArray(manifest.cpu) &&
        manifest.cpu[0] === spec.cpu,
    `${manifest.name}: os/cpu must be ["${spec.os}"]/["${spec.cpu}"]`,
);

const binPath = join(pkgDir, 'bin', spec.binaryName);
const licensePath = join(pkgDir, 'bin', 'LICENSE');

let binary;
let license;
try {
    binary = readFileSync(binPath);
    license = readFileSync(licensePath);
} catch (error) {
    // Named separately from the assertions below because this is the failure the
    // whole script exists for: the tarball would publish, install, and hand a
    // consumer an interpreter that is not there.
    console.error(`verify-node-runtime: ${manifest.name} payload missing — ${error.message}`);
    console.error('  Run scripts/fetch-node-runtime.mjs --target ' + target + ' --out ' + join(pkgDir, 'bin'));
    process.exit(1);
}

check(
    binary.byteLength >= MIN_BINARY_BYTES,
    `${binPath}: ${binary.byteLength} B is below the ${MIN_BINARY_BYTES} B floor`,
);
check(
    spec.magic.every((byte, i) => binary[i] === byte),
    `${binPath}: wrong magic — this is not a ${spec.os} binary`,
);
check((statSync(binPath).mode & 0o111) !== 0, `${binPath}: not executable`);
// The bare-binary shortcut is a WINDOWS shortcut, and naming it on a darwin
// failure would point the reader at a URL that 404s. Measured on v24.20.0:
// `dist/<v>/win-x64/` is the only per-target directory the release publishes, and
// it carries no LICENSE; `dist/<v>/darwin-arm64/` and `dist/<v>/darwin-x64/` do
// not exist. A diagnostic that names the wrong cause costs more than none.
const bareBinaryHint =
    spec.kind === 'zip'
        ? ` ⚠️ The bare-binary path https://nodejs.org/dist/${NODE_VERSION}/${spec.distTag}/ carries NO LICENSE ` +
          'at all — if this file is absent, that convenient route is the likely cause and the obligation was ' +
          'dropped with no error.'
        : '';
check(
    license.byteLength > 0 && EXPECTED_LICENSE_BYTES.has(license.byteLength),
    `${licensePath}: ${license.byteLength} B is neither length measured for ${NODE_VERSION} ` +
        `(${[...EXPECTED_LICENSE_BYTES].join(', ')}).${bareBinaryHint}`,
);
check(
    new TextDecoder().decode(license).startsWith(LICENSE_FIRST_LINE),
    `${licensePath}: does not begin with "${LICENSE_FIRST_LINE}"`,
);

// The payload's own record of itself, compared against the bytes beside it. A
// manifest that agrees with a stale binary is worse than none, so both digests
// are recomputed rather than trusted.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
    const payload = JSON.parse(readFileSync(join(pkgDir, 'bin', 'manifest.json'), 'utf8'));
    check(
        payload.nodeVersion === NODE_VERSION,
        `bin/manifest.json: nodeVersion ${payload.nodeVersion} ≠ ${NODE_VERSION}`,
    );
    check(payload.target === target, `bin/manifest.json: target ${payload.target} ≠ ${target}`);
    check(
        payload.binary?.sha256 === sha256(binary),
        'bin/manifest.json: binary sha256 does not match bin/' + spec.binaryName,
    );
    check(payload.license?.sha256 === sha256(license), 'bin/manifest.json: license sha256 does not match bin/LICENSE');
} catch (error) {
    problems.push(`bin/manifest.json unreadable — ${error.message}`);
}

if (problems.length > 0) {
    for (const problem of problems) console.error(`verify-node-runtime: ${problem}`);
    process.exit(1);
}

console.log(
    `verify-node-runtime: ${manifest.name} ok — ${spec.binaryName} ${binary.byteLength} B, ` +
        `LICENSE ${license.byteLength} B, Node ${NODE_VERSION}`,
);
