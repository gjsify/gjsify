#!/usr/bin/env node
// The release legs' "Prepare a Node-runnable @gjsify/cli" step, as one script.
//
// WHY A NODE-INSTALLED CLI AT ALL. Four `release.yml` jobs — the two GTK-runtime
// bundle legs, `publish-node-gi` and the three `publish-node-runtime` targets — OIDC-
// publish ONE package each with a payload their own runner had to build. They need a
// `gjsify publish`, and a cold checkout carries NO CLI to give them. Measured, because
// the first draft of this note said "the committed `dist/cli.gjs.mjs`" and no such file
// is committed anywhere: `packages/infra/cli/lib/` is a build output (`.gitignore:63` →
// `lib/`), and the GJS bundles are ignored as well — `.gitignore:61` takes `dist/`,
// then `packages/infra/cli/dist/*` is re-ignored with exactly ONE exception,
// `dist/affected.gjs.mjs`, which is the affected-classifier and not the CLI. Even a
// bundle that WAS there would want `gjs` (absent on these runners) and, to build
// anything, `@gjsify/rolldown-native`, which declares no win32 prebuild. These jobs
// deliberately do not build the workspace — that is the ubuntu `publish` job's ~30
// minutes, and the CLI has 15 `workspace:^` deps — so the published tarball at the
// release-train version is the only Node-runnable CLI available to them.
// `needs: publish` puts it on npm first.
//
// WHY ONE SCRIPT AND NOT FOUR SHELL BODIES. It was four: three bash copies and one
// PowerShell transliteration, each doing the same six things (read the version, make a
// temp dir, `npm init -y`, install, write `bin=` to `$GITHUB_OUTPUT`, run `--version`).
// The pwsh copy is the reason this shape has a cost — the same class as the inline
// `node -e` that took out all three v0.28.0 bundle publishes, and the reason
// `verify-bundle-manifest.mjs` is a script shared by the darwin and win32 legs rather
// than two transliterations. Inline workflow shell is also held by no check and
// testable by nothing, which for a workflow that never runs on a pull request means
// its first execution is a release.
//
// The install itself goes through `npm-install-published.mjs`, whose header carries the
// v0.46.0 incident: npm served three legs a packument older than a PUT it had already
// acknowledged, and their ETARGET was read as a release verdict. The retry lives there,
// with its tests in `tests/e2e/npm-install-propagation-retry/`.
//
// Usage:
//   node scripts/bootstrap-published-cli.mjs [options]
//
//   --version-from <path>   package.json to read the version from
//                           (default packages/infra/cli/package.json)
//   --version <v>           use this version instead of reading one
//   --dir <path>            where to install (default $RUNNER_TEMP/gjsify-node-cli,
//                           falling back to the OS temp dir)
//   --output-name <name>    the `$GITHUB_OUTPUT` key to write (default "bin")
//   --dry-run               print the plan, install nothing, exit 0
//   plus every retry knob of npm-install-published.mjs
//                           (--window-ms, --attempts, --initial-delay-ms,
//                            --max-delay-ms, --npm-bin)
//
// Prints the absolute path of the CLI entry on stdout and, under GitHub Actions,
// appends `<output-name>=<path>` to `$GITHUB_OUTPUT`. Exits non-zero if the install
// fails or the installed entry does not run.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installWithRetry, retryOptionsFromArgv } from './npm-install-published.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'bootstrap-published-cli';

function fail(message) {
    console.error(`${LABEL}: ${message}`);
    process.exit(1);
}

async function main() {
    const opts = process.argv.slice(2);
    const { flag, retry } = retryOptionsFromArgv(opts, fail);

    const versionFrom = resolve(ROOT, flag('--version-from', join('packages', 'infra', 'cli', 'package.json')));
    let version = flag('--version', undefined);
    if (!version) {
        // The version is read from the TREE, not from a dist-tag: these jobs publish a
        // sibling of the package they are installing, and `latest` can still point at
        // the previous release while this one is mid-sweep. Reading the checked-out tag
        // is what makes the CLI and the payload the same release.
        try {
            version = JSON.parse(readFileSync(versionFrom, 'utf8')).version;
        } catch (error) {
            fail(`cannot read a version from ${versionFrom}: ${error.message}`);
        }
        if (!version) fail(`${versionFrom} has no "version" field`);
    }

    const dir = resolve(flag('--dir', join(process.env.RUNNER_TEMP || tmpdir(), 'gjsify-node-cli')));
    mkdirSync(dir, { recursive: true });
    // A manifest, rather than `npm init -y`: it is one write instead of a subprocess,
    // and `private` keeps a stray `npm publish` in this directory from meaning anything.
    if (!existsSync(join(dir, 'package.json'))) {
        writeFileSync(
            join(dir, 'package.json'),
            `${JSON.stringify({ name: 'gjsify-node-cli-host', version: '0.0.0', private: true }, null, 2)}\n`,
        );
    }

    const spec = `@gjsify/cli@${version}`;
    console.log(`${LABEL}: ${spec} → ${dir}`);
    const code = await installWithRetry({
        cwd: dir,
        npmArgs: [spec, '--no-audit', '--no-fund', '--no-save'],
        label: LABEL,
        ...retry,
    });
    if (code !== 0) return code;

    const bin = join(dir, 'node_modules', '@gjsify', 'cli', 'lib', 'index.js');
    if (retry.dryRun) {
        console.log(`${LABEL}: --dry-run — would have reported ${bin}`);
        return 0;
    }
    if (!existsSync(bin)) {
        fail(`the install reported success but ${bin} does not exist — the tarball's layout changed`);
    }

    // Running `--version` is the point of this last step and not decoration: an install
    // can succeed and leave an entry that throws on import (a missing dependency in the
    // published tarball, a Node too old for its syntax). Proving it RUNS here fails the
    // job on the bootstrap rather than three steps later inside `gjsify publish`.
    const probe = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    process.stdout.write(probe.stdout ?? '');
    process.stderr.write(probe.stderr ?? '');
    if (probe.status !== 0) fail(`${bin} --version exited ${probe.status} — the installed CLI does not run`);

    const printed = (probe.stdout ?? '').trim();
    if (printed && !printed.includes(version)) {
        // A resolved version other than the one asked for means npm satisfied the spec
        // from somewhere else (a cached tarball, a stale lock, a `--prefix` surprise).
        // The publish that follows would then run a DIFFERENT release's CLI against this
        // release's payload, which is the kind of mismatch that gets noticed downstream.
        fail(`asked for ${version} but the installed CLI reports "${printed}"`);
    }

    console.log(bin);
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) appendFileSync(outputFile, `${flag('--output-name', 'bin')}=${bin}\n`);
    return 0;
}

// Direct invocation only — see the same note in npm-install-published.mjs.
if (process.argv[1] && process.argv[1].endsWith('bootstrap-published-cli.mjs')) process.exit(await main());
