// E2E: `gjsify site build` in a plain app project that only ran
// `npm i -D @gjsify/cli @gjsify/site` — nothing from the workspace, no `--root`, no node-gi.
//
// Measured on a real app checkout (beifahrer, @gjsify/site 0.62.0): the node default died with
// "Cannot run the storybook on Node: `@gjsify/node-gi` is not installed", and `--runtime gjs`
// produced a bundle that aborted with `URL is not defined`, because `--globals auto` could not
// resolve the register packages from the PROJECT's node_modules.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject, hasCommand, e2eSkipReason } from '../helpers.mjs';

const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.example.App</id>
  <name>Example App</name>
  <summary>A demo</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>
  <description><p>Hello</p></description>
  <releases><release version="1.0.0" date="2026-01-01"/></releases>
</component>
`;

const skip = e2eSkipReason('site-standalone', [['gjs on PATH', hasCommand('gjs')]]);

describe('gjsify site build outside the workspace', { timeout: 15 * 60 * 1000, skip }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-site-standalone-');
        tmpDir = env.tmpDir;
        projectDir = join(tmpDir, 'app');
        mkdirSync(join(projectDir, 'data'), { recursive: true });
        writeFileSync(join(projectDir, 'data', 'org.example.App.metainfo.xml'), METAINFO);
        setupProject(
            projectDir,
            {
                name: 'test-site-standalone',
                version: '1.0.0',
                type: 'module',
                private: true,
                devDependencies: { '@gjsify/cli': '^0.1.0', '@gjsify/site': '^0.1.0' },
                gjsify: {
                    site: {
                        metainfo: 'data/org.example.App.metainfo.xml',
                        url: 'https://example.org/app/',
                        base: '/app/',
                        languages: ['en'],
                        repository: 'https://github.com/example/app',
                    },
                },
            },
            env.tarballsDir,
            env.tarballMap,
        );
    });

    after(() => cleanupTestEnvironment(tmpDir));

    it('builds with the default runtime and no node-gi', () => {
        const r = spawnSync('npx', ['gjsify', 'site', 'build', '--offline'], {
            cwd: projectDir,
            encoding: 'utf8',
            timeout: 10 * 60 * 1000,
        });
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.ok(existsSync(join(projectDir, 'dist', 'en', 'index.html')), 'dist/en/index.html missing');
        assert.match(readFileSync(join(projectDir, 'dist', 'en', 'index.html'), 'utf8'), /Example App/);
    });
});
