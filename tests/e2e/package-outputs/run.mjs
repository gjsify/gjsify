// E2E test for `scripts/verify-package-outputs.mjs` — the post-build guard that
// a package's DECLARED entry points (`main`/`module`/`types`/`bin`/`exports`)
// actually exist on disk.
//
// The bug it exists for (#67): with `composite`/`incremental`, a `.tsbuildinfo`
// that outlives its output tree makes `tsc` consider the project up to date. It
// prints nothing, writes nothing and EXITS 0, so the package ships a `types`
// entry point that does not exist and consumers hit TS7016. Nothing else in the
// pipeline can see it — `check` type-checks sources and never looks at `lib/`,
// the build cache treats a tree missing an output unit as a hit, and `gjsify
// pack`'s type-shipping guard (#655, tests/e2e/publish-types-shipped)
// deliberately does NOT fire on an ABSENT declaration so an unbuilt dev tree can
// still pack.
//
// The last case here is that exact mechanism driven end to end through the real
// committed `@gjsify/tsc` bundle, so the test fails if TypeScript ever stops
// no-opping (in which case the guard's reason-for-being changed) or if the guard
// stops noticing.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/package-outputs/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const GUARD = join(MONOREPO_ROOT, 'scripts', 'verify-package-outputs.mjs');
const TARBALL_GUARD = join(MONOREPO_ROOT, 'scripts', 'verify-tarball-outputs.mjs');
const TSC_BUNDLE = join(MONOREPO_ROOT, 'packages', 'infra', 'tsc', 'dist', 'tsc.gjs.mjs');

let tmp;

/** Build a workspace root with `packages/*` and return its path. */
function makeRoot(name) {
    const root = join(tmp, name);
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: `${name}-root`, private: true, workspaces: ['packages/*'] }, null, 2),
    );
    return root;
}

/** Write `packages/<dir>/package.json` plus any `files` (path → contents). */
function addPackage(root, dir, pkg, files = {}) {
    const pkgDir = join(root, 'packages', dir);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2));
    for (const [rel, contents] of Object.entries(files)) {
        const abs = join(pkgDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, contents);
    }
    return pkgDir;
}

function runGuard(root, extra = []) {
    const r = spawnSync(process.execPath, [GUARD, '--root', root, ...extra], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * The TARBALL guard over the same fixture tree. Same shape on purpose: the two
 * checks share `declaredPaths()`, so a fixture that one understands the other
 * must understand too.
 */
function runTarballGuard(root, extra = []) {
    const r = spawnSync(process.execPath, [TARBALL_GUARD, '--root', root, ...extra], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('verify-package-outputs — declared entry points must exist (#67)', () => {
    before(() => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-pkg-outputs-'));
    });
    after(() => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    it('passes when every declared path exists', () => {
        const root = makeRoot('complete');
        addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                module: 'lib/esm/index.js',
                types: 'lib/types/index.d.ts',
                exports: { '.': { types: './lib/types/index.d.ts', default: './lib/esm/index.js' } },
            },
            {
                'lib/esm/index.js': 'export const a = 1;\n',
                'lib/types/index.d.ts': 'export declare const a: number;\n',
            },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 0, out);
        assert.match(out, /All declared entry points exist/);
    });

    it('FAILS when the declaration tree is missing, naming the field and the path', () => {
        const root = makeRoot('no-types');
        addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                module: 'lib/esm/index.js',
                types: 'lib/types/index.d.ts',
                exports: { '.': { types: './lib/types/index.d.ts', default: './lib/esm/index.js' } },
                scripts: { 'build:types': 'gjsify tsc' },
            },
            { 'lib/esm/index.js': 'export const a = 1;\n' },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /@t\/a/);
        assert.match(out, /exports\["\."\]\["types"\]/, 'names the exports condition');
        assert.match(out, /lib\/types\/index\.d\.ts/, 'names the missing file');
        assert.match(out, /build:types/, 'names the script that should have produced it');
    });

    it('covers main and bin, not just types', () => {
        const root = makeRoot('no-main');
        addPackage(root, 'a', {
            name: '@t/a',
            version: '1.0.0',
            main: 'lib/index.js',
            bin: { 'a-cli': './bin/a.js' },
        });
        const { status, out } = runGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /main → lib\/index\.js/);
        assert.match(out, /bin\["a-cli"\]/);
    });

    // `gjsify.main` / `gjsify.example` used to sit in the unchecked-field
    // ledger while the sibling `gjsify.bin` was checked. The consequence
    // shipped: `@gjsify/example-dom-excalibur-jelly-jumper@0.23.0` declared all
    // four runtimes, its `build` never called its own `build:node`, and `deno
    // run npm:@gjsify/cli showcase excalibur-jelly-jumper` failed on
    // "declared node entry not found" — a promise nothing verified.
    it('covers the gjsify-first entry points (gjsify.main, gjsify.example.node)', () => {
        const root = makeRoot('gjsify-entries');
        addPackage(root, 'a', {
            name: '@t/a',
            version: '1.0.0',
            gjsify: { main: 'dist/gjs.js', example: { runtimes: ['gjs', 'node'], node: 'dist/gjs.node.mjs' } },
        });
        const { status, out } = runGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /gjsify\.main → dist\/gjs\.js/);
        assert.match(out, /gjsify\.example\.node → dist\/gjs\.node\.mjs/);
    });

    it('catches a declared non-gjs runtime with no node bundle to back it', () => {
        // The only declaration that promises an artifact WITHOUT naming it:
        // the CLI derives `dist/gjs.js` → `dist/gjs.node.mjs`, so a plain path
        // check cannot see the promise at all.
        const root = makeRoot('implied-node-entry');
        addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                gjsify: { main: 'dist/gjs.js', example: { runtimes: ['gjs', 'node', 'bun', 'deno'] } },
            },
            { 'dist/gjs.js': '// gjs bundle\n' },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /gjsify\.example\.runtimes → node, bun, deno/);
        assert.match(out, /dist\/gjs\.node\.mjs/);
    });

    it('accepts the derived node bundle when it is actually built', () => {
        const root = makeRoot('implied-node-entry-ok');
        addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                gjsify: { main: 'dist/gjs.js', example: { runtimes: ['gjs', 'node'] } },
            },
            { 'dist/gjs.js': '// gjs bundle\n', 'dist/gjs.node.mjs': '// node bundle\n' },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 0, out);
    });

    it('asks nothing of a gjs-only example', () => {
        const root = makeRoot('gjs-only-example');
        addPackage(
            root,
            'a',
            { name: '@t/a', version: '1.0.0', gjsify: { main: 'dist/gjs.js', example: { runtimes: ['gjs'] } } },
            { 'dist/gjs.js': '// gjs bundle\n' },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 0, out);
    });

    it('ignores non-path values (bare specifiers, false, nested condition objects)', () => {
        const root = makeRoot('non-paths');
        addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                main: 'lib/index.js',
                // A `browser` remap table: a bare package name and an exclusion.
                browser: { './lib/node-only.js': false, crypto: 'crypto-browserify' },
                exports: { '.': { node: { default: './lib/index.js' }, default: './lib/index.js' } },
            },
            { 'lib/index.js': 'export const a = 1;\n' },
        );
        const { status, out } = runGuard(root);
        assert.equal(status, 0, out);
    });

    it('checks a subpath PATTERN down to its static directory prefix', () => {
        const root = makeRoot('pattern');
        addPackage(root, 'a', {
            name: '@t/a',
            version: '1.0.0',
            exports: { './assets/*': './assets/*' },
        });
        assert.equal(runGuard(root).status, 1, 'missing assets/ dir is a failure');

        const root2 = makeRoot('pattern-ok');
        addPackage(
            root2,
            'a',
            { name: '@t/a', version: '1.0.0', exports: { './assets/*': './assets/*' } },
            {
                'assets/logo.svg': '<svg/>',
            },
        );
        assert.equal(runGuard(root2).status, 0, 'present assets/ dir passes');
    });

    it('skips private workspaces unless --include-private', () => {
        const root = makeRoot('private');
        addPackage(root, 'a', { name: '@t/a', version: '1.0.0', private: true, types: 'lib/types/index.d.ts' });
        assert.equal(runGuard(root).status, 0);
        assert.equal(runGuard(root, ['--include-private']).status, 1);
    });

    it('--allow-unbuilt downgrades the failure to a warning', () => {
        const root = makeRoot('unbuilt');
        addPackage(root, 'a', { name: '@t/a', version: '1.0.0', types: 'lib/types/index.d.ts' });
        const { status, out } = runGuard(root, ['--allow-unbuilt']);
        assert.equal(status, 0);
        assert.match(out, /tolerated \(--allow-unbuilt\)/);
    });

    // The regression this whole guard exists for, driven through the REAL
    // compiler: a `.tsbuildinfo` outside the emit tree survives a wipe of
    // `lib/types`, so the next `tsc` is a silent no-op with exit code 0.
    it('catches the stale-tsbuildinfo silent no-op end to end', { skip: !existsSync(TSC_BUNDLE) }, () => {
        const root = makeRoot('stale-buildinfo');
        const pkgDir = addPackage(
            root,
            'a',
            {
                name: '@t/a',
                version: '1.0.0',
                types: 'lib/types/index.d.ts',
                exports: { '.': { types: './lib/types/index.d.ts' } },
                scripts: { 'build:types': 'gjsify tsc' },
            },
            {
                'src/index.ts': 'export const answer = 42;\n',
                'tsconfig.json': JSON.stringify(
                    {
                        compilerOptions: {
                            outDir: 'lib',
                            declarationDir: 'lib/types',
                            rootDir: 'src',
                            // The desyncing shape: build info OUTSIDE the emit tree.
                            tsBuildInfoFile: 'tmp/.tsbuildinfo',
                            declaration: true,
                            emitDeclarationOnly: true,
                            module: 'ESNext',
                            moduleResolution: 'bundler',
                            target: 'es2020',
                            composite: true,
                            incremental: true,
                            types: [],
                        },
                        include: ['src'],
                    },
                    null,
                    2,
                ),
            },
        );

        const tsc = (cwd) => spawnSync('gjs', ['-m', TSC_BUNDLE], { cwd, encoding: 'utf8' });

        const cold = tsc(pkgDir);
        assert.equal(cold.status, 0, `${cold.stdout}${cold.stderr}`);
        assert.ok(existsSync(join(pkgDir, 'lib', 'types', 'index.d.ts')), 'cold run emits the declaration');
        assert.ok(existsSync(join(pkgDir, 'tmp', '.tsbuildinfo')), 'and the build info lands outside lib/');
        assert.equal(runGuard(root).status, 0, 'guard is green on a complete tree');

        // Wipe ONLY the outputs — exactly what a build-cache restore of a
        // sibling unit, a partial clean, or a `rm -rf lib/types` does.
        rmSync(join(pkgDir, 'lib'), { recursive: true, force: true });

        const stale = tsc(pkgDir);
        assert.equal(stale.status, 0, 'tsc still reports success');
        assert.equal(
            existsSync(join(pkgDir, 'lib')),
            false,
            'and emits NOTHING — this is the silent no-op the guard exists for',
        );

        const failed = runGuard(root);
        assert.equal(failed.status, 1, failed.out);
        assert.match(failed.out, /lib\/types\/index\.d\.ts/);

        // Dropping the stale build info makes the SAME command emit again.
        rmSync(join(pkgDir, 'tmp'), { recursive: true, force: true });
        const recovered = tsc(pkgDir);
        assert.equal(recovered.status, 0, `${recovered.stdout}${recovered.stderr}`);
        assert.deepEqual(readdirSync(join(pkgDir, 'lib')), ['types']);
        assert.equal(runGuard(root).status, 0, 'guard goes green once the declaration is emitted');
    });
});

describe('verify-tarball-outputs — declared entry points must be IN THE TARBALL', () => {
    before(() => {
        if (!tmp) tmp = mkdtempSync(join(tmpdir(), 'gjsify-tarball-outputs-'));
    });

    // The sibling guard above answers "does the path exist in the repo". In this
    // repository `lib/` always does, so it is structurally unable to see the
    // failure a CONSUMER feels: a declared path that is built and then excluded
    // from the tarball. These cases pin that difference.
    const PKG = (extra) => ({
        name: '@t/shipped',
        version: '1.0.0',
        main: 'lib/esm/index.js',
        types: 'lib/types/index.d.ts',
        exports: {
            '.': { types: './lib/types/index.d.ts', default: './lib/esm/index.js' },
            './register': { default: './lib/esm/register.js' },
        },
        ...extra,
    });
    const BUILT = {
        'lib/esm/index.js': 'export const a = 1;\n',
        'lib/esm/register.js': 'globalThis.a = 1;\n',
        'lib/types/index.d.ts': 'export declare const a: number;\n',
    };

    it('passes when `files` names the built output', () => {
        const root = makeRoot('tarball-ok');
        addPackage(root, 'shipped', PKG({ files: ['lib'] }), BUILT);
        const { status, out } = runTarballGuard(root);
        assert.equal(status, 0, out);
        assert.match(out, /Every declared entry point is in its tarball/);
    });

    it('FAILS on a built entry point the `files` allowlist excludes', () => {
        const root = makeRoot('tarball-unshipped');
        // `files` ships the types but not the register module — the exact shape
        // `gjsify pack`'s own types-only guard cannot see.
        addPackage(root, 'shipped', PKG({ files: ['lib/types', 'lib/esm/index.js'] }), BUILT);
        const { status, out } = runTarballGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /exports\["\.\/register"\]\["default"\]/);
        assert.match(out, /lib\/esm\/register\.js/);
        // `main` is force-included by the packer regardless of `files`, so it
        // must NOT be reported — the check reads the real selection rules
        // rather than assuming `files` is the whole story.
        assert.doesNotMatch(out, /main → lib\/esm\/index\.js/);
    });

    it('FAILS with NO `files` field, because gitignore semantics drop the build output', () => {
        const root = makeRoot('tarball-gitignored');
        addPackage(root, 'shipped', PKG({}), { ...BUILT, '.gitignore': 'lib\n' });
        const { status, out } = runTarballGuard(root);
        assert.equal(status, 1, out);
        assert.match(out, /files.*absent/);
        assert.match(out, /lib\/types\/index\.d\.ts/);
    });

    it('stays silent when the declared path does not exist at all', () => {
        const root = makeRoot('tarball-unbuilt');
        // Absent-on-disk is the SIBLING guard's finding. Claiming it here would
        // red-line every unbuilt dev tree for something this check cannot fix.
        addPackage(root, 'shipped', PKG({ files: ['lib'] }), {});
        assert.equal(runTarballGuard(root).status, 0, 'unbuilt tree is not this check’s failure');
        assert.equal(runGuard(root).status, 1, 'but it IS the declared-outputs guard’s');
    });
});
