// E2E: `gjsify tsc`'s upstream-`typescript` fallback must run under NODE, even
// when the CLI itself is hosted by GJS.
//
// `gjsify tsc` prefers the Node-free `@gjsify/tsc` GJS bundle and falls back to
// npm `typescript` when that bundle is not resolvable. The fallback is not an
// exotic path: `dist/tsc.gjs.mjs` is a BUILD OUTPUT, and root `build:infra`
// builds `@gjsify/create-app` — the first package whose `build` calls
// `gjsify tsc` — several steps before `@gjsify/tsc` produces it. On a cold tree
// the fallback is therefore the NORMAL path for the early half of the build.
//
// The bug it guards: the fallback spawned `process.execPath`, which is the
// documented way to re-enter "the current runtime" and is exactly wrong for a
// dual-host CLI. Under `dist/cli.gjs.mjs` the current runtime is GJS
// (`/proc/self/exe` → `gjs-console`), so TypeScript's CommonJS CLI was handed to
// GJS, which RAN it and died inside the payload:
//
//     JS ERROR: ReferenceError: module is not defined
//     @/…/node_modules/typescript/lib/tsc.js:8:1
//     script "build" exited with code 1
//     [@gjsify/create-app] gjsify run build exited with code 1
//
// On a host where `execPath` resolves to a gjsify launcher rather than the raw
// interpreter, the same line re-executes the CLI instead and yargs rejects the
// tsc entry as `Unknown argument: …/typescript/lib/tsc.js`. Two faces, one
// defect. Both are invisible to every Node-hosted test, which is why this suite
// drives the GJS bundle directly.
//
// WHY tests/e2e/create-app DID NOT CATCH IT: that suite starts by executing
// `packages/infra/create-gjsify/lib/index.js` — the OUTPUT of the very build
// that was broken — with `node`. A build failure makes it error out in `before`
// as a missing prerequisite rather than a caught regression, and every command
// it runs afterwards (`npm install`, `npm run build`) is Node-hosted, so the
// GJS-hosted `gjsify tsc` this bug lives in is never reached. It tests what the
// templates produce; nothing tested how the package itself is built.
//
// HOW THE FALLBACK IS FORCED without touching the repo: `commands/tsc.ts`
// resolves `@gjsify/tsc/bundle` from two anchors — the consumer's workspace root
// (or cwd) and the running bundle's own location. Copying `cli.gjs.mjs` into a
// temp dir and running it with cwd set to a temp project defeats both: neither
// path can walk up into the monorepo's `node_modules/@gjsify/tsc`. `typescript`
// is linked into the temp project so the fallback has something to find.
//
// SKIP off a capable host (non-Linux / no gjs / no built CLI bundle / no
// npm `typescript`) — same posture as tests/e2e/workspace-node-free-gjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/tsc-node-fallback/ → monorepo root is 3 levels up.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
const TYPESCRIPT_PKG = join(REPO_ROOT, 'node_modules', 'typescript');

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

const SKIP =
    process.platform !== 'linux' || !hasGjs() || !existsSync(CLI_BUNDLE) || !existsSync(TYPESCRIPT_PKG)
        ? 'needs linux + gjs + a built dist/cli.gjs.mjs + node_modules/typescript'
        : false;

describe('gjsify tsc — Node fallback under a GJS-hosted CLI', { skip: SKIP, timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;
    let bundleCopy;

    /** Run the GJS-hosted CLI: `gjs -m <copied bundle> tsc <args…>` in projectDir. */
    function runGjsifyTsc(args, env) {
        const r = spawnSync('gjs', ['-m', bundleCopy, 'tsc', ...args], {
            cwd: projectDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            ...(env ? { env } : {}),
        });
        return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    }

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-tsc-fallback-'));

        // The bundle lives OUTSIDE the monorepo so its own `createRequire`
        // anchor cannot reach `node_modules/@gjsify/tsc`.
        bundleCopy = join(tmpDir, 'cli.gjs.mjs');
        copyFileSync(CLI_BUNDLE, bundleCopy);

        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        mkdirSync(join(projectDir, 'node_modules'), { recursive: true });

        // No `workspaces` key: `findWorkspaceRoot` must stop here, not climb to
        // a real monorepo above /tmp.
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'tsc-fallback-fixture', private: true, type: 'module' }, null, 2) + '\n',
        );
        // `typescript` is the ONLY thing the fallback may find — deliberately no
        // `@gjsify/tsc` beside it.
        symlinkSync(TYPESCRIPT_PKG, join(projectDir, 'node_modules', 'typescript'), 'dir');

        writeFileSync(
            join(projectDir, 'tsconfig.json'),
            JSON.stringify(
                {
                    compilerOptions: {
                        target: 'ES2022',
                        module: 'ESNext',
                        moduleResolution: 'bundler',
                        strict: true,
                        noEmit: true,
                        // `types: []` keeps the check independent of whatever
                        // @types happen to be reachable from the temp dir.
                        types: [],
                    },
                    include: ['src'],
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('type-checks clean source through the fallback (exit 0)', () => {
        writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const answer: number = 42;\n');
        const { code, output } = runGjsifyTsc(['-p', 'tsconfig.json']);
        assert.equal(code, 0, `expected a clean type-check, got exit ${code}:\n${output}`);
    });

    it('does not hand the tsc entry to the wrong interpreter', () => {
        writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const answer: number = 42;\n');
        const { output } = runGjsifyTsc(['-p', 'tsconfig.json']);
        // The GJS-ran-a-CommonJS-file face of the bug.
        assert.doesNotMatch(
            output,
            /module is not defined/,
            'tsc.js was executed by GJS instead of node — the Node fallback spawned the wrong interpreter',
        );
        // The re-executed-the-CLI face: yargs rejects the tsc entry as a
        // positional. Matched language-independently on the path itself, since
        // yargs localises "Unknown argument".
        assert.doesNotMatch(
            output,
            /rgument.*typescript[/\\]lib[/\\]tsc\.js/,
            'the CLI re-executed itself with the tsc entry as an argument',
        );
    });

    it('still REPORTS type errors through the fallback (exit non-zero, TS2322)', () => {
        // Proves tsc actually ran rather than the spawn merely not crashing —
        // a fallback that silently exits 0 would satisfy the test above.
        writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const answer: number = "not a number";\n');
        const { code, output } = runGjsifyTsc(['-p', 'tsconfig.json']);
        assert.notEqual(code, 0, `expected a failing type-check, got exit 0:\n${output}`);
        // Bare code, not `error TS2322`: tsc inserts ANSI escapes between the
        // two when it detects colour support (see tests/e2e/self-host-tsc).
        assert.match(output, /TS2322/, `expected TS2322, got:\n${output}`);
    });

    // The path NOTHING covered before, and the one that shipped broken.
    //
    // The two cases above exercise `child.on('close')` — the child RAN, so the
    // async spawn armed the GLib main loop and the idle-scheduled
    // `process.exit()` was delivered. When the spawn itself FAILS there is no
    // child and no armed loop, so that idle never runs: the CLI printed its
    // diagnosis and then exited **0**.
    //
    // That is not a cosmetic exit code. `@gjsify/create-app`'s build is
    // `node scripts/process-template.mjs && gjsify tsc && node scripts/set-bin-mode.mjs`,
    // so a 0 here runs `set-bin-mode.mjs` against a `lib/index.js` tsc never
    // wrote — which is how a release-cut on a cold tree failed pointing two
    // steps past the real fault. `ci-fedora` ships no node, and the Node
    // fallback is the NORMAL path on a cold tree, so this is reachable in CI.
    it('FAILS LOUDLY when the compiler cannot be spawned at all (no node on PATH)', () => {
        writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const answer: number = 42;\n');
        // A PATH that still resolves `gjs` (the host we are launching) but not
        // `node` (the interpreter the fallback needs), so the spawn raises
        // ENOENT instead of the child failing.
        const gjsDir = dirname(spawnSync('sh', ['-c', 'command -v gjs'], { encoding: 'utf-8' }).stdout.trim());
        const { code, output } = runGjsifyTsc(['-p', 'tsconfig.json'], { ...process.env, PATH: gjsDir });
        assert.notEqual(
            code,
            0,
            `gjsify tsc reported SUCCESS while producing nothing — the deferred exit was dropped:\n${output}`,
        );
        assert.match(
            output,
            /not on PATH|cannot (be )?run|not found/i,
            `expected a diagnosis naming the missing interpreter, got:\n${output}`,
        );
    });
});
