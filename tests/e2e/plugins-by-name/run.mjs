// E2E test for `bundler.plugins` entries that reference a plugin by package
// name (or relative path). Lets `package.json#gjsify` describe the full
// plugin chain without dropping to a JS-form config file.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

const PLUGIN_SOURCE = `// Tiny test plugin — replaces the literal __INJECTED__ in any module
// with a marker string. Tests that:
//   1. By-name resolution finds the file
//   2. The default-export factory is called with the supplied options
//   3. The resulting plugin is wired into the Rolldown plugin chain
export default function testPlugin(options) {
  const marker = options?.marker ?? 'fallback-marker';
  return {
    name: 'e2e-test-plugin',
    transform: {
      filter: { id: /\\.[mc]?[tj]sx?$/ },
      handler(code) {
        if (!code.includes('__INJECTED__')) return null;
        return { code: code.replace(/__INJECTED__/g, JSON.stringify(marker)), map: null };
      },
    },
  };
}
`;

describe('CLI plugins-by-name E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-plugins-by-name-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'plugins-by-name-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-plugins-by-name',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
                gjsify: {
                    bundler: {
                        output: { file: 'dist/app.js', minify: false },
                        plugins: [{ name: './fixture-plugin.mjs', options: { marker: 'hello-from-by-name' } }],
                    },
                },
            },
            tarballsDir,
            tarballMap,
        );

        writeFileSync(join(projectDir, 'fixture-plugin.mjs'), PLUGIN_SOURCE);
        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            `// @ts-nocheck — __INJECTED__ is provided by the fixture plugin via
// a substitution transform, not a declaration. A \`declare const\`
// here would also get rewritten by the transform (regex is intentionally
// dumb to keep the test fixture small) and produce invalid TS.
console.log(__INJECTED__);
`,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    // Both cases write the SAME path — `bundler.output.file` decides it in either
    // mode, `--outdir` does not override it (measured) — so each clears it first
    // and neither can pass on the other's artefact.
    const buildFresh = (args) => {
        rmSync(join(projectDir, 'dist'), { recursive: true, force: true });
        execFileSync('npx', ['gjsify', 'build', ...args], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });
        const built = join(projectDir, 'dist', 'app.js');
        assert.ok(existsSync(built), 'dist/app.js missing');
        return readFileSync(built, 'utf-8');
    };

    it('applies the same plugin in LIBRARY mode', () => {
        // `--library` took a different code path: it never called
        // `resolveUserPlugins`, never built the user text loader, and dropped
        // `merged.plugins` when it assembled the chain. A configured plugin was
        // therefore ignored SILENTLY — exit 0, a real bundle on disk, the default
        // transform, no diagnostic anywhere. Nothing caught it because every
        // plugin test in the repo built an APP.
        const out = buildFresh(['--library', 'src/app.ts']);
        assert.match(
            out,
            /"hello-from-by-name"/,
            'library build ignored bundler.plugins — the marker is missing or fell back',
        );
        // The premise: a plugin that stopped running for some OTHER reason cannot
        // pass this by leaving the source untouched.
        assert.ok(!out.includes('__INJECTED__'), 'the substitution did not run at all');
    });

    it('resolves a relative-path plugin and applies its transform', () => {
        const out = buildFresh(['src/app.ts']);
        assert.match(
            out,
            /"hello-from-by-name"/,
            'plugin transform did not run — __INJECTED__ marker still present or replaced with fallback',
        );
    });
});
