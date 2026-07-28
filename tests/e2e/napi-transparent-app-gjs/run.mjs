// E2E test: transparent `.node` loading must ENGAGE for an UNMODIFIED napi-rs
// consumer built `--app gjs`.
//
// The fixes this locks down shipped in #840 ("Load real napi-rs packages under
// GJS"), which corrected six defects in `napiNodeAddonPlugin` — among them the
// bare-specifier filter gap, the `main`-only entry check, and the
// "first optionalDependency that resolves" platform pick. #840 verified them
// with unit tests plus a hand-run byte-comparison against Node; this suite is
// the AUTOMATED regression guard it left as a follow-up ("the addon gate should
// grow a leg that builds through the GJS engine, since that path had no
// coverage at all").
//
// It is deliberately NOT a second copy of #840's unit coverage. What it adds is
// the one configuration none of the existing tests occupy:
//
//   - The addon gates (`packages/napi/napi/test/*-gate.mjs`) hand-alias each
//     addon's bare specifier to its native entry. That alias is also what made
//     the interception fire, so the gates could be green while an ordinary
//     `import { transform } from 'lightningcss'` produced a bundle with ZERO
//     `loadAddon` calls. This suite passes NO alias and no `.gjsifyrc` — the
//     shape AGENTS.md advertises as "`import 'better-sqlite3'` just works".
//   - It runs the built bundle under stock `gjs` and asserts on the RUNTIME
//     result (one `loadAddon`, with a host-platform `.node`), not on the plugin
//     contract in isolation.
//
// Why `lightningcss` is the consumer under test: it is a REAL napi-rs package
// already in this repo's dependency graph, and its shape is the one that broke —
// `exports` has no `browser` condition, so `--app gjs`
// (`conditionNames: ['browser','import']`) resolves the `import` condition to
// `node/index.mjs`, which is NOT `main` (`node/index.js`).
//
// A foreign-platform sibling is PLANTED after the install, and that is
// load-bearing rather than decorative: npm honours `os`/`cpu` and installs only
// the host's optional dependency, so without the decoy the tree cannot express
// the state that produced the bug. `gjsify install` materialises all 11
// `lightningcss-*` platform packages, and `lightningcss` declares
// `lightningcss-darwin-x64` FIRST — so a regression to declaration order would
// bake a Mach-O binary into a Linux bundle, and only this fixture would catch it.
//
// `@gjsify/napi` is stubbed rather than real, and the stub is doing double duty:
// this suite is about RESOLUTION (does the right `.node` path reach
// `loadAddon()`), not about the N-API C ABI, so it needs no GjsifyNapi typelib —
// and because #840 made a resolvable `@gjsify/napi` the GATE on every rewrite,
// laying the stub down is also what exercises the gate's positive branch. The
// byte-identical-vs-Node proof for the ABI stays in the napi gate.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

/**
 * Probe gjs via spawnSync rather than `which gjs` — minimal Fedora containers
 * used by CI don't always ship `which`, but they do ship gjs.
 */
function gjsAvailable() {
    try {
        return spawnSync('gjs', ['--version'], { stdio: 'pipe', timeout: 5_000 }).status === 0;
    } catch {
        return false;
    }
}

/** `<os>-<arch>` as the running process names itself — the ONE spelling. */
const HOST = `${process.platform}-${process.arch}`;

/**
 * A stand-in for `gjsify install @gjsify/napi`. The real package is a Vala/C++
 * GI bridge that needs the GjsifyNapi typelib; here we only need `loadAddon` to
 * be resolvable by BARE specifier from the emitted shim and to record what it
 * was asked to load. Returns a Proxy so any accessor the addon's consumer reads
 * (`transform`, `Features`, …) exists without the stub knowing the addon's API.
 */
const NAPI_STUB = `export const loadedAddons = [];
export function loadAddon(path) {
    loadedAddons.push(path);
    return new Proxy({}, { get: () => () => 'STUB' });
}
`;

/**
 * An UNMODIFIED napi-rs consumer entry: no \`--alias\`, no \`.gjsifyrc\`, nothing
 * pinning the native entry. \`@gjsify/napi\` is imported only to read back what
 * the shim recorded.
 */
const ENTRY = `import { transform } from 'lightningcss';
import { loadedAddons } from '@gjsify/napi';

console.log('TRANSFORM_TYPE=' + typeof transform);
console.log('LOADADDON_COUNT=' + loadedAddons.length);
for (const p of loadedAddons) console.log('LOADADDON_PATH=' + p);
`;

describe('napi transparent .node loading under --app gjs', { timeout: 15 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;
    let bundlePath;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-napi-transparent-gjs-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-napi-transparent-app-gjs',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                    // Pinned: the assertions below quote this release's exact
                    // entry layout + optionalDependencies ORDER.
                    lightningcss: '1.32.0',
                },
            },
            tarballsDir,
            tarballMap,
        );

        const nodeModules = join(projectDir, 'node_modules');

        // `@gjsify/napi` is NOT a workspace member, so it is not in the tarball
        // map and npm never sees it — write the stub straight into the tree the
        // way `gjsify install @gjsify/napi` would.
        const napiDir = join(nodeModules, '@gjsify', 'napi');
        mkdirSync(napiDir, { recursive: true });
        writeFileSync(
            join(napiDir, 'package.json'),
            JSON.stringify(
                { name: '@gjsify/napi', version: '0.0.0-stub', type: 'module', exports: { '.': './index.js' } },
                null,
                2,
            ),
        );
        writeFileSync(join(napiDir, 'index.js'), NAPI_STUB);

        // The DECOY. npm honours `os`/`cpu` and installs only the host's
        // optional dependency; `gjsify install` installs every one. Recreate
        // that tree state so "first declared that resolves" would pick a
        // foreign-platform binary, exactly as it did in the wild.
        const decoy = HOST.startsWith('darwin') ? 'linux-x64-gnu' : 'darwin-x64';
        const decoyDir = join(nodeModules, `lightningcss-${decoy}`);
        mkdirSync(decoyDir, { recursive: true });
        writeFileSync(
            join(decoyDir, 'package.json'),
            JSON.stringify(
                { name: `lightningcss-${decoy}`, version: '1.32.0', main: `lightningcss.${decoy}.node` },
                null,
                2,
            ),
        );
        writeFileSync(join(decoyDir, `lightningcss.${decoy}.node`), '');

        writeFileSync(join(projectDir, 'src', 'index.ts'), ENTRY);
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('installs lightningcss with a real host-platform .node', () => {
        // Guard the premise: without a compiled binary on disk the plugin
        // correctly declines to rewrite, and a green run would mean nothing.
        const nodeModules = join(projectDir, 'node_modules');
        assert.ok(existsSync(join(nodeModules, 'lightningcss', 'node', 'index.js')), 'lightningcss entry missing');
        const hostPkgs = ['gnu', 'musl', 'msvc', 'gnueabihf', '']
            .map((abi) => join(nodeModules, `lightningcss-${HOST}${abi ? `-${abi}` : ''}`))
            .filter((d) => existsSync(d));
        assert.ok(hostPkgs.length > 0, `no lightningcss-${HOST}* platform package installed`);
    });

    it('builds the unmodified consumer for --app gjs and routes it through loadAddon', () => {
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/index.ts', '--app', 'gjs', '--outfile', 'dist/bundle.js', '--no-minify'],
            { cwd: projectDir, stdio: 'pipe', timeout: 5 * 60 * 1000 },
        );
        bundlePath = join(projectDir, 'dist', 'bundle.js');
        assert.ok(existsSync(bundlePath), 'dist/bundle.js missing');

        const src = readFileSync(bundlePath, 'utf8');
        assert.match(src, /loadAddon\(/, 'bundle contains no loadAddon call — the interception did not fire');
        // The generated loader's own acquisition must NOT have survived. It is a
        // template-literal require (`require(\`lightningcss-${parts.join('-')}\`)`)
        // — unrewritable by any bundler and unresolvable on GJS, which is exactly
        // why replacing the ENTRY is the only available lever. Asserting on the
        // shim alone would still pass if the dead loader shipped beside it.
        assert.doesNotMatch(
            src,
            /lightningcss-\$\{/,
            "the generated loader's runtime require survived into the bundle",
        );
    });

    it('calls loadAddon exactly once, with the HOST-platform .node, under stock gjs', () => {
        if (!gjsAvailable()) {
            // Surface a missing runtime in the report rather than skipping — the
            // whole point of this suite is a GJS-runtime behaviour.
            assert.fail('gjs not on PATH; this regression test requires the gjs runtime.');
        }
        const result = spawnSync('gjs', ['-m', bundlePath], { encoding: 'utf8', timeout: 60 * 1000 });
        const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        assert.strictEqual(result.status, 0, `gjs exited non-zero. Combined output:\n${combined}`);

        assert.match(
            result.stdout,
            /^LOADADDON_COUNT=1$/m,
            `expected exactly one loadAddon call. Combined output:\n${combined}`,
        );
        assert.match(
            result.stdout,
            /^TRANSFORM_TYPE=function$/m,
            `named export did not survive the entry replacement. Combined output:\n${combined}`,
        );

        const path = /^LOADADDON_PATH=(.+)$/m.exec(result.stdout)?.[1] ?? '';
        assert.ok(path.endsWith('.node'), `loadAddon was not handed a .node: ${path}`);
        assert.ok(
            path.includes(`lightningcss-${HOST}`),
            `loadAddon got a foreign-platform binary (host is ${HOST}): ${path}`,
        );
    });
});
