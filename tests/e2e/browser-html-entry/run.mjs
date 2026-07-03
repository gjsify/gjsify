// E2E test for `gjsify build --app browser <index.html>` — the Vite-style HTML
// entry. The CLI bundles the module the page's `<script type="module" src>`
// references and emits a processed `index.html` beside the JS bundle, with the
// script `src` rewritten to the built file. Replaces the hand-written
// `write-app-html.mjs` pattern browser apps used to carry.
//
// Asserts: the JS bundle is built AND a sibling `index.html` is emitted whose
// entry `<script src>` points at the built bundle (`./app.js`), while the rest
// of the page (`<title>`, meta) is preserved. Also checks the imported `.css`
// travelled into the JS bundle as a string (the unified css-as-string path).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app browser HTML entry E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-browser-html-');
        tmpDir = env.tmpDir;

        projectDir = join(tmpDir, 'browser-html-project');
        mkdirSync(join(projectDir, 'src', 'app'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-browser-html',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
            },
            env.tarballsDir,
            env.tarballMap,
        );

        // The Vite-style shell page + its module + a real .css file.
        writeFileSync(
            join(projectDir, 'src', 'app', 'app.html'),
            [
                '<!doctype html>',
                '<html lang="en">',
                '  <head><meta charset="utf-8" /><title>HTML Entry App</title></head>',
                '  <body>',
                '    <script type="module" src="./main.ts"></script>',
                '  </body>',
                '</html>',
                '',
            ].join('\n'),
        );
        writeFileSync(
            join(projectDir, 'src', 'app', 'main.ts'),
            [
                "import shellCss from './styles.css';",
                'const style = document.createElement("style");',
                'style.textContent = shellCss;',
                'document.head.appendChild(style);',
                '',
            ].join('\n'),
        );
        writeFileSync(join(projectDir, 'src', 'app', 'styles.css'), '.zzhtmlmarker { display: grid; }\n');
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('bundles the html-referenced module and emits a processed index.html', () => {
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app/app.html', '--app', 'browser', '--outfile', 'dist-app/app.js'],
            { cwd: projectDir, stdio: 'pipe', timeout: 120 * 1000 },
        );

        const jsPath = join(projectDir, 'dist-app', 'app.js');
        const htmlPath = join(projectDir, 'dist-app', 'index.html');

        assert.ok(existsSync(jsPath), 'dist-app/app.js missing');
        assert.ok(statSync(jsPath).size > 0, 'dist-app/app.js is empty');
        assert.ok(existsSync(htmlPath), 'dist-app/index.html was not emitted');

        const html = readFileSync(htmlPath, 'utf-8');
        // Script src rewritten to the built bundle (relative to the html).
        assert.ok(html.includes('src="./app.js"'), `emitted index.html should load ./app.js — got:\n${html}`);
        assert.ok(!html.includes('./main.ts'), 'emitted index.html must not still reference the source entry');
        // The rest of the page is preserved.
        assert.ok(html.includes('<title>HTML Entry App</title>'), 'the original <title> should be preserved');

        // The imported .css travelled into the JS bundle as a string.
        const js = readFileSync(jsPath, 'utf-8');
        assert.ok(js.includes('zzhtmlmarker'), 'the imported .css should be inlined as a string in the bundle');
    });

    it('emitted browser bundle is syntactically valid JavaScript', () => {
        const jsPath = join(projectDir, 'dist-app', 'app.js');
        if (!existsSync(jsPath)) return;
        execFileSync('node', ['--check', jsPath], { stdio: 'pipe', timeout: 30 * 1000 });
    });
});
