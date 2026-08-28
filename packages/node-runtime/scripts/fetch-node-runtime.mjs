#!/usr/bin/env node
// Populate one `@gjsify/node-runtime-<target>` package's gitignored `bin/` payload.
//
//   node packages/node-runtime/scripts/fetch-node-runtime.mjs \
//     --target darwin-arm64 --out packages/node-runtime/node-runtime-darwin-arm64/bin
//
// The payload is a DOWNLOAD, not a build — which is the one way these packages
// differ from the `@gjsify/gtk-runtime-*` precedent they otherwise follow. A
// relocated GTK closure can only be produced on the OS it targets, so those need
// a macOS and a Windows publish job; a Node release tarball can be verified and
// unpacked anywhere, so all three of ours ride one ubuntu job. Nothing here reads
// `process.platform`.
//
// WHAT IT SHIPS, and what it deliberately does not. `bin/<node|node.exe>` plus
// `bin/LICENSE`, and that is all. The full distribution carries npm's bundled
// `node_modules`, whose win-x64 zip alone holds 154 further LICENSE files; an
// interpreter inside a `.app` or a Windows program directory needs the binary and
// the terms it is redistributed under, and every one of those 154 files would be
// an attribution obligation taken on for code that is not being shipped.
//
// Node's own `LICENSE`, copied verbatim from the release, discharges the whole
// set in one file: MIT, Apache-2.0 §4(a)/(b) (OpenSSL 3.5.7 is upstream, Apache-2.0
// alone — not quictls, so no advertising clause and no "Eric Young" attribution),
// BSD-3 clause 2, Unicode-3.0, zlib, Artistic-2.0 (npm), BlueOak-1.0.0 (minimatch)
// and ISC. There is no copyleft in the shipped binary and no Apache `NOTICE` to
// propagate.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
    EXPECTED_LICENSE_BYTES,
    LICENSE_FIRST_LINE,
    MIN_BINARY_BYTES,
    NODE_DIST_BASE,
    NODE_VERSION,
    TARGETS,
    packageName,
} from './node-release.mjs';

function fail(message) {
    console.error(`fetch-node-runtime: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const args = { target: undefined, out: undefined };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--target') args.target = argv[++i];
        else if (flag === '--out') args.out = argv[++i];
        else fail(`unknown argument ${flag}. Usage: --target <${Object.keys(TARGETS).join('|')}> --out <dir>`);
    }
    if (args.target === undefined) fail(`--target is required (one of ${Object.keys(TARGETS).join(', ')})`);
    if (args.out === undefined) fail('--out is required (the package’s `bin` directory)');
    return args;
}

/** Fetch a URL into memory, failing loudly on any non-200. */
async function get(url) {
    const response = await fetch(url);
    if (!response.ok) fail(`GET ${url} → ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The digest `SHASUMS256.txt` records for one archive.
 *
 * From the SAME release directory as the archive, which is the only reason the
 * check means anything. A missing line is a hard failure and not a skip: "the
 * release does not list this file" and "we asked for the wrong filename" are the
 * same observation from here, and both must stop the build.
 */
function expectedDigest(shasums, archive) {
    for (const line of new TextDecoder().decode(shasums).split('\n')) {
        const [digest, name] = line.trim().split(/\s+/);
        if (name === archive) return digest;
    }
    fail(`SHASUMS256.txt for ${NODE_VERSION} lists no entry for ${archive}`);
}

/**
 * One member of the archive, on stdout.
 *
 * Streaming a single member rather than unpacking the tree: the darwin tarball is
 * ~90 MB unpacked and only two files of it are ever shipped. `maxBuffer` is raised
 * because the default 1 MB truncates a 120 MB binary — and `execFileSync` reports
 * that truncation as ENOBUFS, which is at least loud.
 */
function extractMember(kind, archivePath, prefix, member) {
    const path = `${prefix}/${member}`;
    const options = { maxBuffer: 512 * 1024 * 1024 };
    if (kind === 'tar.xz') return execFileSync('tar', ['-xJOf', archivePath, path], options);
    if (kind === 'zip') return execFileSync('unzip', ['-p', archivePath, path], options);
    fail(`unknown archive kind ${kind}`);
}

function assertMagic(bytes, magic, what) {
    for (let i = 0; i < magic.length; i++) {
        if (bytes[i] === magic[i]) continue;
        const got = [...bytes.subarray(0, magic.length)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
        fail(`${what} does not start with the expected magic — got ${got}. The wrong member was extracted.`);
    }
}

const args = parseArgs(process.argv.slice(2));
const spec = TARGETS[args.target];
if (spec === undefined) fail(`unknown --target ${args.target} (one of ${Object.keys(TARGETS).join(', ')})`);

const archive = spec.archive(NODE_VERSION);
const archiveUrl = `${NODE_DIST_BASE}/${NODE_VERSION}/${archive}`;
console.log(`fetch-node-runtime: ${packageName(spec.target)} ← ${archiveUrl}`);

const shasums = await get(`${NODE_DIST_BASE}/${NODE_VERSION}/SHASUMS256.txt`);
const want = expectedDigest(shasums, archive);
const archiveBytes = await get(archiveUrl);
const got = sha256(archiveBytes);
if (got !== want) fail(`${archive} sha256 ${got} ≠ ${want} from SHASUMS256.txt`);
console.log(`fetch-node-runtime: sha256 ok (${want}), ${archiveBytes.byteLength} B`);

// A real temp DIRECTORY, removed in a finally: the extractors take a path, and a
// fixed name under the repo would collide between the three matrix legs if they
// ever ran on one runner.
const scratch = mkdtempSync(join(tmpdir(), 'gjsify-node-runtime-'));
let binary;
let license;
try {
    const archivePath = join(scratch, archive);
    writeFileSync(archivePath, archiveBytes);
    const prefix = archive.replace(/\.(tar\.xz|zip)$/, '');
    binary = extractMember(spec.kind, archivePath, prefix, spec.member);
    license = extractMember(spec.kind, archivePath, prefix, 'LICENSE');
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

assertMagic(binary, spec.magic, `${spec.binaryName} (${spec.target})`);
if (binary.byteLength < MIN_BINARY_BYTES) {
    fail(`${spec.binaryName} is ${binary.byteLength} B, below the ${MIN_BINARY_BYTES} B floor — truncated extraction`);
}

const licenseText = new TextDecoder().decode(license);
if (!licenseText.startsWith(LICENSE_FIRST_LINE)) {
    fail(`LICENSE does not begin with "${LICENSE_FIRST_LINE}" — the wrong member was extracted`);
}
if (!EXPECTED_LICENSE_BYTES.has(license.byteLength)) {
    fail(
        `LICENSE is ${license.byteLength} B, which is neither of the two lengths measured for ` +
            `${NODE_VERSION} (${[...EXPECTED_LICENSE_BYTES].join(' LF / ')} CRLF). Node ships the SAME licence ` +
            'twice, byte-different, and a bump changes both numbers. Re-measure and update ' +
            '`EXPECTED_LICENSE_BYTES` in scripts/node-release.mjs — this is the moment to re-read what is ' +
            'being redistributed, not a check to loosen.',
    );
}

mkdirSync(args.out, { recursive: true });
const binaryPath = join(args.out, spec.binaryName);
writeFileSync(binaryPath, binary);
// 0755 even for `node.exe`: the mode is meaningless on Windows and the tarball
// npm publishes is unpacked on macOS and Linux too, where a `bin/` entry that is
// not executable is a package that cannot run.
chmodSync(binaryPath, 0o755);
writeFileSync(join(args.out, 'LICENSE'), license);

// The manifest a consumer holding only the published tarball can read: what was
// shipped, from which release, and where the recipe lives. Same role as
// `gtk/manifest.json`'s `builder` field — a tarball must be able to say how it
// was made without the repository beside it.
writeFileSync(
    join(args.out, 'manifest.json'),
    `${JSON.stringify(
        {
            package: packageName(spec.target),
            target: spec.target,
            os: spec.os,
            cpu: spec.cpu,
            nodeVersion: NODE_VERSION,
            source: archiveUrl,
            archiveSha256: want,
            binary: { name: spec.binaryName, bytes: binary.byteLength, sha256: sha256(binary) },
            license: { name: 'LICENSE', bytes: license.byteLength, sha256: sha256(license) },
            builder: 'packages/node-runtime/scripts/fetch-node-runtime.mjs',
        },
        null,
        2,
    )}\n`,
);

console.log(
    `fetch-node-runtime: wrote ${relative(process.cwd(), binaryPath)} (${binary.byteLength} B) ` +
        `+ LICENSE (${license.byteLength} B) + manifest.json`,
);
