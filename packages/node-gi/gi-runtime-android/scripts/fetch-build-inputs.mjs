#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Download and verify what this package's AAR is built from, as pinned in
// build-inputs.json, so release.yml can build it with nothing but the NDK.
//
//   node packages/node-gi/gi-runtime-android/scripts/fetch-build-inputs.mjs --out <dir>
//
// Writes <dir>/sysroot — every ABI's GI prefix tarball unpacked into one tree, laid out
// as build-android.mjs's and build-gi-runtime-android.mjs's --gi-sysroot expect — and
// <dir>/nativescript, the unzipped `optimized` runtime AAR for --napi-lib.
//
// THE DIGESTS ARE PINNED HERE, not read from the release beside the asset. A SHA256SUMS
// downloaded from the same place as the tarball proves the download is intact, not that
// it is the prefix this repository was tested against. A digest mismatch is a hard
// failure before anything is unpacked.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
    console.error(`fetch-build-inputs: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const args = { out: undefined };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--out') args.out = argv[++i];
        else fail(`unknown argument ${flag}. Usage: --out <dir>`);
    }
    if (args.out === undefined) fail('--out is required');
    return { out: resolve(args.out) };
}

/** Fetch a URL into memory, failing loudly on any non-200. */
async function get(url) {
    const response = await fetch(url);
    if (!response.ok) fail(`GET ${url} → ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function verify(bytes, want, what) {
    const got = sha256(bytes);
    if (got !== want) fail(`${what}: sha256 ${got} ≠ ${want} pinned in build-inputs.json`);
    console.log(`fetch-build-inputs: ${what} sha256 ok, ${bytes.byteLength} B`);
}

const { out } = parseArgs(process.argv.slice(2));
const inputs = JSON.parse(readFileSync(join(pkgDir, 'build-inputs.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'gi-runtime-android-'));
try {
    const sysroot = join(out, 'sysroot');
    rmSync(sysroot, { recursive: true, force: true });
    mkdirSync(sysroot, { recursive: true });
    const { repository, tag, assets } = inputs.sysroot;
    for (const [abi, asset] of Object.entries(assets)) {
        const bytes = await get(`https://github.com/${repository}/releases/download/${tag}/${asset.name}`);
        verify(bytes, asset.sha256, `${abi} sysroot`);
        const archive = join(scratch, asset.name);
        writeFileSync(archive, bytes);
        execFileSync('tar', ['-xzf', archive, '-C', sysroot]);
    }

    const ns = inputs.nativescript;
    const name = ns.package.split('/')[1];
    const tgz = await get(`https://registry.npmjs.org/${ns.package}/-/${name}-${ns.version}.tgz`);
    const tgzPath = join(scratch, `${name}.tgz`);
    writeFileSync(tgzPath, tgz);
    const aar = execFileSync('tar', ['-xzOf', tgzPath, ns.aar], {
        maxBuffer: 512 * 1024 * 1024,
    });
    verify(aar, ns.sha256, `${ns.package}@${ns.version} optimized AAR`);
    const aarPath = join(scratch, 'nativescript-optimized.aar');
    writeFileSync(aarPath, aar);
    const nativescript = join(out, 'nativescript');
    rmSync(nativescript, { recursive: true, force: true });
    execFileSync('unzip', ['-q', aarPath, '-d', nativescript]);

    console.log(`fetch-build-inputs: --gi-sysroot ${sysroot}`);
    console.log(`fetch-build-inputs: --napi-lib ${nativescript}`);
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
