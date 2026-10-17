#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Write `payload-baseline.json`: the link graph of the pinned GI prefix, plus what the
// default (nothing selected) build plans out of it.
//
// WHY A SNAPSHOT AND NOT A MEASUREMENT IN CI. Selecting namespaces (ADR 0117) changes what
// the AAR carries, and the one property no reviewer can check by reading the diff is that
// selecting NOTHING still carries exactly what ADR 0110 measured on a device. Measuring it
// needs the cross toolchain and the sha256-pinned sysroot, which no CI job has, so the
// inputs to the decision are frozen here instead and the decision itself is replayed by
// `gi-runtime-android.test.mjs` on every run — host-only, no NDK, no device.
//
// The graph, not the byte sizes, is the thing worth freezing. The payload is ~15.7 MB of
// stripped `.so`, so a byte-for-byte fixture is out of the question; what makes the bytes
// what they are is WHICH sonames and typelibs enter the APK, and that is small, stable and
// exactly what a selection bug would change. ADR 0110's compressed totals are recorded
// alongside as the accounting those entries add up to.
//
// Regenerate when `build-inputs.json`'s sysroot pin moves — with the same prefix the pin
// names, or the baseline stops describing what ships:
//
//   node scripts/snapshot-payload-baseline.mjs \
//     --ndk ~/Android/Sdk/ndk/27.1.12297006 \
//     --gi-sysroot <prefix> --node-gi-lib <build-android.mjs --out dir>

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planTypelibSet, readTypelibDir } from '../../scripts/typelib-backers.mjs';
import { parseNeeded, planClosure, planGiRoots, REQUIRED_NAMESPACES } from './build-gi-runtime-android.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const ABIS = ['arm64-v8a', 'x86_64'];

function fail(message) {
    console.error(`snapshot-payload-baseline: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const opts = { ndk: process.env.ANDROID_NDK_HOME ?? '', giSysroot: '', nodeGiLib: '' };
    for (let i = 0; i < argv.length; i++) {
        const [flag, inline] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], undefined];
        const value = inline ?? argv[++i];
        if (flag === '--ndk') opts.ndk = value;
        else if (flag === '--gi-sysroot') opts.giSysroot = value;
        else if (flag === '--node-gi-lib') opts.nodeGiLib = value;
        else fail(`unknown argument ${argv[i]}`);
    }
    for (const [flag, value] of Object.entries(opts)) {
        if (!value) fail(`--${flag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
    return opts;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const readelf = join(opts.ndk, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin', 'llvm-readelf');
    if (!existsSync(readelf)) fail(`${readelf} does not exist — is --ndk an NDK root?`);
    const inputs = JSON.parse(readFileSync(join(pkgDir, 'build-inputs.json'), 'utf8'));

    const graph = {};
    const planned = {};
    for (const abi of ABIS) {
        const libDir = resolve(opts.giSysroot, 'lib', abi);
        const addon = resolve(opts.nodeGiLib, abi, 'libnode_gi.so');
        if (!existsSync(libDir)) fail(`${libDir} does not exist — is the prefix built for ${abi}?`);
        if (!existsSync(addon)) fail(`${addon} does not exist — run node-gi's scripts/build-android.mjs first`);

        // Every soname the walk could ask about, answered once. Recording the whole prefix
        // and not only the reachable part is the point: a selection that reaches further
        // has to find the same answers here that the real build would find on disk.
        const needed = {};
        const ask = (soname) => {
            if (soname in needed) return needed[soname];
            const path = soname === 'libnode_gi.so' ? addon : join(libDir, soname);
            needed[soname] = existsSync(path)
                ? parseNeeded(execFileSync(readelf, ['-d', path], { encoding: 'utf8' }))
                : null;
            return needed[soname];
        };
        const typelibs = readTypelibDir(join(libDir, 'girepository-1.0')).map((typelib) => ({
            name: typelib.name,
            namespace: typelib.namespace,
            version: typelib.version,
            key: typelib.key,
            sharedLibraries: typelib.sharedLibraries,
            dependencies: typelib.dependencies,
            major: typelib.major,
        }));
        // Ask about everything the prefix offers, not only `libnode_gi.so`'s closure, so the
        // fixture can answer a selection the default build never makes.
        for (const typelib of typelibs) for (const soname of typelib.sharedLibraries) ask(soname);
        const { seeds } = planGiRoots({ namespaces: [], typelibs });
        const { bundle, system } = planClosure({ roots: ['libnode_gi.so'], seeds, needed: ask });
        // One more sweep: the seeds of every namespace the prefix has, so a test can plan a
        // selection without the prefix being present.
        for (const typelib of typelibs) {
            const reachable = planGiRoots({ namespaces: [typelib.key], typelibs });
            for (const soname of reachable.seeds) ask(soname);
        }
        for (const soname of Object.keys(needed)) for (const dep of needed[soname] ?? []) ask(dep);

        const plan = planTypelibSet({
            typelibs,
            libraries: new Set(['libnode_gi.so', ...bundle]),
            caseInsensitive: false,
            requiredNamespaces: REQUIRED_NAMESPACES,
        });
        if (plan.problems.length > 0) fail(`${abi}: ${plan.problems.join('; ')}`);

        graph[abi] = {
            needed: Object.fromEntries(
                Object.keys(needed)
                    .sort()
                    .map((k) => [k, needed[k]]),
            ),
            typelibs,
        };
        planned[abi] = {
            libraries: ['libnode_gi.so', ...bundle].sort(),
            system: [...system].sort(),
            typelibs: plan.copy.map((typelib) => typelib.name).sort(),
        };
    }

    const existing = existsSync(join(pkgDir, 'payload-baseline.json'))
        ? JSON.parse(readFileSync(join(pkgDir, 'payload-baseline.json'), 'utf8'))
        : {};
    const out = {
        $comment: [
            'The pinned GI prefix as the AAR build sees it, and what selecting NOTHING plans out',
            'of it. Written by scripts/snapshot-payload-baseline.mjs; replayed by node-gi/test/',
            'gi-runtime-android.test.mjs, which is the only check that ADR 0117 selection left the',
            'default payload alone. Regenerate when build-inputs.json moves the sysroot pin.',
            'measured: what ADR 0110 stage C counted in the release split APKs, per ABI, as',
            'COMPRESSED zip-entry sizes (docs/reports/2026-10-15-adr-0110-gates.md). The entry',
            'counts are checkable here; the byte totals are not reproducible on a host and are',
            'recorded so the entries they account for cannot change unnoticed.',
        ],
        sysroot: { repository: inputs.sysroot.repository, tag: inputs.sysroot.tag },
        measured: existing.measured ?? null,
        planned,
        graph,
    };
    const file = join(pkgDir, 'payload-baseline.json');
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    for (const abi of ABIS) {
        console.log(`${abi}: ${planned[abi].libraries.length} libraries, ${planned[abi].system.length} system`);
    }
    console.log(`wrote ${file}`);
}

main();
