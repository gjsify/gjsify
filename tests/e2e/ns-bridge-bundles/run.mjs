// E2E for `gjsify build --app nativescript` over `packages/nativescript-bridge/*`.
//
// WHAT THIS EXISTS FOR. Every package under `packages/nativescript-bridge/`
// declares `runtimes.nativescript` and nothing in CI had ever run the NS build
// over any of them. What that hid: the derived alias layer rewrote every one of
// them to `@gjsify/empty` (a `native` slot with no `globals.mjs` fell back to
// empty), and `@nativescript/core` was not external, so the UI-widget bridges
// could not resolve the optional peer they subclass. Every bridge package
// except `@gjsify/native-platform` failed to build, on a green `main`.
//
// WHAT A BUILD LEG DOES NOT PROVE — read this before treating NativeScript as
// covered. It bundles; it never EVALUATES a module on the NS V8 runtime, and
// module evaluation is the failure class this tree actually pays for: a
// top-level `new TextEncoder()` compiles fine here and dies on device, because
// NS registers its globals after the bundle's first module runs. That is not a
// hypothetical — it is exactly how `@gjsify/buffer` crashed on Android
// (`tests/integration/nativescript/README.md`). Only the on-device suite in
// `tests/integration/nativescript/` answers that question, and it needs an
// emulator with `-gpu host`, which GitHub runners do not have.
//
// The CLI is driven from its Node entry, no tarball install: these are the
// workspace's OWN packages and the point is to bundle them where they live.
// Their workspace deps resolve through `exports["."]` to `lib/`, so this needs
// a BUILT tree — the e2e job restores exactly that from the build cache, as the
// pack-based suites do.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MONOREPO_ROOT } from '../helpers.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages/infra/cli/lib/index.js');
const BRIDGE_DIR = join(MONOREPO_ROOT, 'packages/nativescript-bridge');
const PACKAGES_DIR = join(MONOREPO_ROOT, 'packages');

/** A named-import clause for `@nativescript/core`, in source or in a minified bundle. */
const NS_CORE_CLAUSE = /import\s*\{([^}]*)\}\s*from\s*['"]@nativescript\/core['"]/g;

/**
 * The identifiers the NS runtime injects as AMBIENT globals — the NS analogue of
 * GJS's `imports.gi.*`. `app/nativescript.ts` promises they are neither aliased
 * nor externalised, so a bundle that still reads them proves the promise; a
 * minifier renames locals but never a free global, so their literal presence is
 * the whole check.
 */
const NATIVE_BRIDGE_GLOBALS = ['java', 'android', 'androidx', 'kotlin', 'NSFileManager', 'UIDevice'];

/** Every `<name>` in a `{ a, b as c }` clause, as EXPORTED by `@nativescript/core`. */
function nsCoreImportNames(text) {
    const names = new Set();
    for (const match of text.matchAll(NS_CORE_CLAUSE)) {
        for (const member of match[1].split(',')) {
            const trimmed = member.trim();
            if (trimmed) names.add(trimmed.split(/\s+as\s+/)[0].trim());
        }
    }
    return names;
}

function jsFilesUnder(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) jsFilesUnder(path, out);
        else if (entry.name.endsWith('.js')) out.push(path);
    }
    return out;
}

/**
 * `@gjsify/<name>` → its directory, for every `packages/<pillar>/<name>`.
 *
 * The oracle below reads EMITTED `lib/esm/**`, not `src/**`: tsc has already
 * elided the type-only imports and stripped the comments, and both forms of
 * `@nativescript/core` occur in this tree — `devtools` documents the value
 * import it deliberately does NOT make, in a JSDoc block, which a source scan
 * reads as the opposite of what the package promises.
 */
function indexWorkspacePackages() {
    const index = new Map();
    for (const pillar of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
        if (!pillar.isDirectory()) continue;
        for (const pkg of readdirSync(join(PACKAGES_DIR, pillar.name), { withFileTypes: true })) {
            if (!pkg.isDirectory()) continue;
            const dir = join(PACKAGES_DIR, pillar.name, pkg.name);
            const manifestPath = join(dir, 'package.json');
            if (!existsSync(manifestPath)) continue;
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (typeof manifest.name === 'string') index.set(manifest.name, { dir, manifest });
        }
    }
    return index;
}

/**
 * Which `@nativescript/core` bindings a bundle rooted at `pkgName` may legitimately
 * carry: the union over its `@gjsify/*` dependency CLOSURE, because a bundle inherits
 * its dependencies' imports (`@gjsify/storybook-nativescript` keeps `GridLayout`
 * through `@gjsify/adwaita-nativescript`, not through its own sources).
 */
function expectedNsCoreNames(pkgName, index, seen = new Set()) {
    const names = new Set();
    if (seen.has(pkgName)) return names;
    seen.add(pkgName);
    const entry = index.get(pkgName);
    if (!entry) return names;
    for (const file of jsFilesUnder(join(entry.dir, 'lib', 'esm'))) {
        for (const name of nsCoreImportNames(readFileSync(file, 'utf8'))) names.add(name);
    }
    for (const dep of Object.keys(entry.manifest.dependencies ?? {})) {
        if (!dep.startsWith('@gjsify/')) continue;
        for (const name of expectedNsCoreNames(dep, index, seen)) names.add(name);
    }
    return names;
}

/**
 * The native-bridge globals a package reads in its OWN emitted code — no closure
 * here, deliberately. A dependency's global read can be tree-shaken out of this
 * bundle when the consumer re-exports only part of it, and demanding it back
 * would be a check that fails on correct output.
 *
 * `*.android.js` / `*.ios.js` are skipped: with no `NATIVESCRIPT_PLATFORM` the
 * build resolves the `.native`/base variant, so a platform fork's globals are
 * legitimately absent.
 */
function ownNativeGlobals(dir) {
    const found = new Set();
    for (const file of jsFilesUnder(join(dir, 'lib', 'esm'))) {
        if (/\.(android|ios)\.js$/.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        for (const global of NATIVE_BRIDGE_GLOBALS) {
            if (new RegExp(`\\b${global}\\b`).test(text)) found.add(global);
        }
    }
    return found;
}

const bridgePackages = readdirSync(BRIDGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(BRIDGE_DIR, entry.name, 'package.json')))
    .map((entry) => {
        const dir = join(BRIDGE_DIR, entry.name);
        return { dir, name: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

describe('gjsify build --app nativescript over packages/nativescript-bridge/*', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let index;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ns-bridge-bundles-'));
        index = indexWorkspacePackages();
        console.log(`  tmp dir: ${tmpDir}`);
    });

    after(() => {
        if (process.env.GJSIFY_E2E_KEEP_TEMP) console.log(`  keeping tmp dir: ${tmpDir}`);
        else if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    // An empty enumeration would make every assertion below vacuously true, and
    // this suite's whole subject is a directory it discovers rather than a list
    // it carries.
    it('finds the bridge packages to build', () => {
        assert.ok(bridgePackages.length > 0, `no packages with a package.json under ${BRIDGE_DIR}`);
    });

    for (const pkg of bridgePackages) {
        it(`bundles ${pkg.name} and keeps what the NS runtime has to supply`, () => {
            const entry = join(pkg.dir, 'src', 'index.ts');
            assert.ok(existsSync(entry), `${pkg.name} has no src/index.ts`);

            const outFile = join(tmpDir, `${pkg.name.replace(/[@/]/g, '_')}.ns.mjs`);
            const build = spawnSync(
                process.execPath,
                [CLI_ENTRY, 'build', entry, '--app', 'nativescript', '--outfile', outFile],
                { cwd: MONOREPO_ROOT, encoding: 'utf-8', timeout: 5 * 60 * 1000 },
            );
            assert.equal(
                build.status,
                0,
                `${pkg.name} failed to build for --app nativescript\n${build.stdout}\n${build.stderr}`,
            );
            assert.ok(existsSync(outFile) && statSync(outFile).size > 0, `${outFile} missing or empty`);

            // Valid ESM — an outfile that exists proves nothing on its own.
            const check = spawnSync(process.execPath, ['--check', outFile], { encoding: 'utf-8', timeout: 60 * 1000 });
            assert.equal(check.status, 0, `${pkg.name} bundle does not parse\n${check.stderr}`);

            const bundle = readFileSync(outFile, 'utf-8');

            // A GJS edge here is a missing alias, never something the NS runtime
            // will supply — same rule the browser bundles are held to.
            assert.ok(!bundle.includes('gi://'), `${pkg.name} bundle leaks a gi:// import`);
            assert.ok(!bundle.includes('@girs/'), `${pkg.name} bundle leaks an @girs/* import`);

            // `@nativescript/core` is the runtime's own registry: it has to leave
            // this build as an IMPORT for the NS bundler to resolve, never inlined
            // and never tree-shaken away. A bundle that lost it is still a file,
            // and every widget subclassing an NS view is then extending undefined.
            const expected = expectedNsCoreNames(pkg.name, index);
            const actual = nsCoreImportNames(bundle);
            if (expected.size === 0) {
                assert.ok(
                    !bundle.includes('@nativescript/core'),
                    `${pkg.name} imports nothing from @nativescript/core in its emitted lib, yet the bundle names it`,
                );
            } else {
                assert.ok(
                    /import\s*\{[^}]*\}\s*from\s*["']@nativescript\/core["']/.test(bundle),
                    `${pkg.name} bundle has no \`import … from "@nativescript/core"\` — the peer was inlined or ` +
                        `resolved away, and the NS runtime's single core instance is gone. Expected some of: ` +
                        `${[...expected].sort().join(', ')}`,
                );
                const invented = [...actual].filter((name) => !expected.has(name));
                assert.deepEqual(
                    invented,
                    [],
                    `${pkg.name} bundle imports @nativescript/core bindings its dependency closure never asks for`,
                );
            }

            // Ambient native-bridge identifiers stay free globals.
            for (const global of ownNativeGlobals(pkg.dir)) {
                assert.match(
                    bundle,
                    new RegExp(`\\b${global}\\b`),
                    `${pkg.name} reads the ambient \`${global}\` in its emitted lib but the bundle does not — ` +
                        `it was aliased, externalised or renamed, and the NS runtime injects it under that name only`,
                );
            }
        });
    }
});
