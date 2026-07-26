#!/usr/bin/env node
// Builds every `dist/test.browser.mjs` bundle the Playwright suite discovers.
//
// `discover-bundles.mjs` only sees a package once its bundle exists on disk, so
// something has to run each package's `build:test:browser` script first. This is
// that something — used by `tests/browser`'s own `build` script AND by the CI
// `build` job (which stages the resulting bundles as an artifact for the
// Playwright job, the same "build there, run here" split the macOS leg uses).
//
// Discovery mirrors `discover-bundles.mjs`: a package qualifies when it declares
// a `build:test:browser` script AND ships `src/test.browser.mts`. Keep the
// PACKAGE_DIRS list in sync between the two files.
//
// Usage:
//   node tests/browser/scripts/build-bundles.mjs [--jobs N] [--list]
//                                                [--include <pkg>]...
//                                                [--known-broken <pkg>[,<pkg>]]...
//
// Exits non-zero if any build fails; every package is attempted regardless, so
// one broken bundle does not hide the state of the rest. `--known-broken` is the
// ledger for builds that are already understood to be broken (CI passes it
// `$BROWSER_KNOWN_BROKEN_BUILDS`): they still run, they still print their error,
// but they do not fail the process — and the run says so if one starts passing.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

// Same pillars the Playwright discovery walks. `framework` is included here on
// purpose: those packages ship a `src/test.browser.mts` too — see the note in
// `discover-bundles.mjs`.
const PACKAGE_DIRS = ['web', 'dom', 'node', 'framework'];

/** All workspace dirs that declare a `build:test:browser` script + entry. */
export function discoverBuildablePackages() {
    const out = [];
    for (const pillar of PACKAGE_DIRS) {
        const dir = join(REPO_ROOT, 'packages', pillar);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pkgDir = join(dir, entry.name);
            const pkgJson = join(pkgDir, 'package.json');
            if (!existsSync(pkgJson) || !existsSync(join(pkgDir, 'src', 'test.browser.mts'))) continue;
            let manifest;
            try {
                manifest = JSON.parse(readFileSync(pkgJson, 'utf8'));
            } catch {
                continue;
            }
            if (!manifest.scripts?.['build:test:browser']) continue;
            out.push({ name: manifest.name ?? `@gjsify/${entry.name}`, pillar, dir: pkgDir });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

function parseArgs(argv) {
    const opts = { jobs: Math.max(1, Math.min(4, cpus().length)), list: false, include: [], knownBroken: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list') opts.list = true;
        else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 1);
        else if (a === '--include') opts.include.push(argv[++i]);
        // Ledger of packages whose `--app browser` build is KNOWN broken: they
        // are still attempted (so a fix is noticed) but do not fail the run.
        // Accepts a repeated flag and/or a comma/space-separated list.
        else if (a === '--known-broken') opts.knownBroken.push(...String(argv[++i] ?? '').split(/[\s,]+/).filter(Boolean));
    }
    return opts;
}

function runBuild(pkg) {
    const bundle = join(pkg.dir, 'dist', 'test.browser.mjs');
    return new Promise((resolve) => {
        const child = spawn('gjsify', ['run', 'build:test:browser'], {
            cwd: pkg.dir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let output = '';
        child.stdout.on('data', (c) => (output += c));
        child.stderr.on('data', (c) => (output += c));
        child.on('error', (err) => resolve({ pkg, ok: false, output: String(err) }));
        child.on('close', (code) => {
            // Do NOT trust the exit code alone. `gjsify build` currently exits 0
            // on a bundler error (observed: `@gjsify/constants` dies with a
            // rolldown `MissingExport` — `node:os`/`node:fs`/`node:crypto` alias
            // to `@gjsify/empty` under `--app browser` — prints the CLI help and
            // a `{"error": …}` line, writes nothing, and returns 0). Trusting it
            // silently dropped that package from the suite. Assert the artifact.
            if (code !== 0) return resolve({ pkg, ok: false, output });
            if (!existsSync(bundle)) {
                return resolve({
                    pkg,
                    ok: false,
                    output: `${output}\n[browser-bundles] build exited 0 but produced no dist/test.browser.mjs`,
                });
            }
            resolve({ pkg, ok: true, output });
        });
    });
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    let packages = discoverBuildablePackages();
    if (opts.include.length > 0) {
        packages = packages.filter((p) => opts.include.some((i) => p.name === i || p.dir.endsWith(`/${i}`)));
    }

    if (opts.list) {
        for (const p of packages) console.log(p.name);
        return 0;
    }

    console.log(`[browser-bundles] building ${packages.length} bundle(s), ${opts.jobs} at a time`);
    const queue = [...packages];
    const failures = [];
    const ledgered = [];
    const unexpectedlyFixed = [];
    let done = 0;

    const worker = async () => {
        for (;;) {
            const pkg = queue.shift();
            if (!pkg) return;
            const known = opts.knownBroken.includes(pkg.name);
            const result = await runBuild(pkg);
            done++;
            if (result.ok) {
                console.log(`  [${done}/${packages.length}] ok    ${pkg.name}`);
                if (known) unexpectedlyFixed.push(pkg.name);
            } else if (known) {
                ledgered.push(result);
                console.log(`  [${done}/${packages.length}] known-broken  ${pkg.name}`);
            } else {
                failures.push(result);
                console.log(`  [${done}/${packages.length}] FAIL  ${pkg.name}`);
            }
        }
    };

    await Promise.all(Array.from({ length: opts.jobs }, worker));

    for (const name of unexpectedlyFixed) {
        console.log(`[browser-bundles] ${name} builds again — drop it from the --known-broken ledger`);
    }
    for (const l of ledgered) {
        console.warn(`[browser-bundles] ledgered failure (not fatal): ${l.pkg.name}\n${l.output.trim()}`);
    }

    if (failures.length > 0) {
        console.error(`\n[browser-bundles] ${failures.length} build(s) failed:`);
        for (const f of failures) {
            console.error(`\n──── ${f.pkg.name} ────\n${f.output.trim()}`);
        }
        return 1;
    }
    console.log(`[browser-bundles] ${packages.length - ledgered.length}/${packages.length} bundles built`);
    return 0;
}

// Only run when invoked directly (the discovery helper is importable).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main().then((code) => process.exit(code));
}
