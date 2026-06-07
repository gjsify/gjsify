// E2E guard for the tsc SELF-HOST: gjsify type-checks its own workspace with
// `gjsify tsc` (the GJS-bundled `@gjsify/tsc`), not upstream node `tsc`. Every
// package's `check` + `build:types` runs `gjsify tsc`, so a regression in
// `@gjsify/tsc` would break the type-gate of the ENTIRE workspace. This test
// pins the contract independently of the full `gjsify run check`:
//
//   1. `gjsify tsc` on type-correct code → exit 0 (no diagnostics).
//   2. `gjsify tsc` on a deliberate type error → non-zero, reports the exact
//      TS code (TS2322) and NOT TS6053/TS2318 (proving the default `lib.*.d.ts`
//      resolve from the shipped bundle — the v0.4.37-0.4.39 empty-lib class of
//      bug would surface here as TS6053).
//
// Invokes the CLI exactly as a package's `check` does: `gjsify tsc -p <cfg>`
// (the Node CLI dispatch spawns the committed `dist/tsc.gjs.mjs` GJS bundle via
// `gjs`). Requires `gjs` on PATH — runs in the CI Fedora/GJS container.
//
// We match the bare TS code (e.g. /TS2322/), NOT `/error TS2322/`: tsc colorizes
// diagnostics when it detects color support (it does under the GJS bundle in CI
// but not for a plain local pipe), inserting ANSI escapes BETWEEN `error` and
// `TS2322`. The code itself is never split, so the bare-code regex is robust in
// both environments.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/self-host-tsc/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const LIB_SOURCE_MJS = join(MONOREPO_ROOT, 'packages', 'infra', 'tsc', 'scripts', 'lib-source.mjs');

// Run from the monorepo root so `gjsify tsc` resolves the workspace
// `@gjsify/tsc` (it resolves the bundle from cwd's node_modules — exactly as a
// package's `check` script does from its own dir). `cfg` is an absolute path to
// the fixture tsconfig; its `files` resolve relative to the tsconfig's own dir.
/** Run `gjsify tsc -p <cfg>`; return { code, output }. */
function runGjsifyTsc(cfg) {
    try {
        const output = execFileSync('node', [CLI_ENTRY, 'tsc', '-p', cfg], {
            cwd: MONOREPO_ROOT,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, output };
    } catch (err) {
        return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

describe('gjsify tsc — workspace self-host', () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-selfhost-tsc-'));
        // `types: []` isolates the type-check from the workspace's @types (cwd is
        // the monorepo root) so the only diagnostics come from the fixture itself.
        const base = {
            compilerOptions: {
                lib: ['ESNext', 'DOM'],
                strict: true,
                noEmit: true,
                skipLibCheck: false,
                types: [],
            },
        };
        mkdirSync(join(dir, 'src'), { recursive: true });
        // Type-correct: exercises ES2022 (.at) + ESNext (Promise.withResolvers)
        // + DOM lib — all must resolve from the shipped default libs.
        writeFileSync(
            join(dir, 'src', 'good.ts'),
            'export const a: number | undefined = [1, 2, 3].at(0);\n' +
                'export const p = Promise.withResolvers<number>();\n' +
                'export const el: Element | null = (globalThis as unknown as { document?: Document }).document?.body ?? null;\n',
        );
        writeFileSync(join(dir, 'src', 'bad.ts'), 'export const n: number = "not a number";\n');
        writeFileSync(
            join(dir, 'tsconfig.good.json'),
            JSON.stringify({ ...base, files: ['src/good.ts'] }, null, 2),
        );
        writeFileSync(
            join(dir, 'tsconfig.bad.json'),
            JSON.stringify({ ...base, files: ['src/bad.ts'] }, null, 2),
        );
    });

    after(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('exits 0 on type-correct code (ESNext + DOM libs resolve)', () => {
        const { code, output } = runGjsifyTsc(join(dir, 'tsconfig.good.json'));
        assert.equal(code, 0, `expected clean exit, got ${code}:\n${output}`);
        assert.ok(!/TS6053/.test(output), `default libs failed to resolve (TS6053):\n${output}`);
    });

    it('catches a deliberate type error (TS2322), libs still resolve (no TS6053/TS2318)', () => {
        const { code, output } = runGjsifyTsc(join(dir, 'tsconfig.bad.json'));
        assert.notEqual(code, 0, 'expected non-zero exit on a type error');
        assert.match(output, /TS2322/, `expected the deliberate TS2322:\n${output}`);
        assert.ok(!/TS6053/.test(output), `lib resolution broke (TS6053):\n${output}`);
        assert.ok(!/TS2318/.test(output), `global types missing (TS2318):\n${output}`);
    });
});

// Guards the @gjsify/tsc build-bundle lib-source decision (pickLibSource). The
// committed `lib/lib*.d.ts` are version-locked; the build must NEVER let a
// mismatched/incomplete upstream `typescript` install clobber them. This is the
// root-cause fix for the v0.4.42 Fedora-44 `main` red, where a partial CI
// typescript install (missing lib.esnext.full.d.ts) was copied over the correct
// committed libs, breaking every downstream `gjsify tsc` with TS6053.
describe('@gjsify/tsc build — lib source selection (pickLibSource)', () => {
    let pickLibSource, SUPER_LIB;

    before(async () => {
        ({ pickLibSource, SUPER_LIB } = await import(pathToFileURL(LIB_SOURCE_MJS).href));
    });

    const set = (n, withSuper = true) =>
        Array.from({ length: n }, (_, i) => (i === 0 && withSuper ? SUPER_LIB : `lib.x${i}.d.ts`));

    it('refreshes when the install matches the pin and is complete', () => {
        const r = pickLibSource({
            tsVersion: '6.0.3',
            pinnedVersion: '6.0.3',
            sourceLibs: set(108),
            committedLibs: set(108),
        });
        assert.equal(r.action, 'refresh', r.reason);
    });

    it('keeps committed libs when the installed version != the pin (stale TS 5.9)', () => {
        const r = pickLibSource({
            tsVersion: '5.9.3',
            pinnedVersion: '6.0.3',
            sourceLibs: set(100), // 5.9 has the super-lib but fewer files (no es2025.*)
            committedLibs: set(108),
        });
        assert.equal(r.action, 'keep', r.reason);
    });

    it('keeps committed libs when a same-version install is partial (no super-lib)', () => {
        const r = pickLibSource({
            tsVersion: '6.0.3',
            pinnedVersion: '6.0.3',
            sourceLibs: set(90, false), // corrupt: missing lib.esnext.full.d.ts
            committedLibs: set(108),
        });
        assert.equal(r.action, 'keep', r.reason);
    });

    it('errors only when neither source can supply a valid set', () => {
        const r = pickLibSource({
            tsVersion: '5.9.3',
            pinnedVersion: '6.0.3',
            sourceLibs: set(90, false),
            committedLibs: [],
        });
        assert.equal(r.action, 'error', r.reason);
    });
});
