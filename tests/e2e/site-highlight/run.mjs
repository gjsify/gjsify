// E2E: `@gjsify/site-highlight` as a CONSUMER gets it — two tarballs installed into a project
// outside the workspace, a real `buildSite` on the gjs runtime, and the HTML it wrote.
//
// The unit suites prove the highlighter's output; this suite proves the parts only an install can
// break: that `grammars/blueprint.tmLanguage.json` is IN the tarball (`files`), that its JSON
// import survives the `--app gjs` bundle (GJS itself refuses import attributes, and the emitted
// `lib/index.js` is never loaded unbundled there because stock GJS resolves no bare specifier),
// and that the hook reaches `renderPostBody` through `buildSite` rather than only through a
// hand-passed `MarkdownOptions`.
//
// The `.blp` fence is the one a Shiki-only consumer cannot get: Shiki bundles no Blueprint
// grammar, so a green block here means the shipped grammar was found AND registered.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject, hasCommand, e2eSkipReason } from '../helpers.mjs';

const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.example.Highlight</id>
  <name>Highlight Demo</name>
  <summary>A demo</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>
  <description><p>Hello</p></description>
  <releases><release version="1.0.0" date="2026-01-01"/></releases>
</component>
`;

const POST = `---
title: Highlight
date: 2026-10-31
summary: Three fences.
---

\`\`\`ts
export const greet = (name: string): string => \`hi \${name}\`;
\`\`\`

\`\`\`blp
using Gtk 4.0;
template $MainWindow: Gtk.ApplicationWindow {
  title: "hello";
}
\`\`\`

\`\`\`brainfuck
+++[>+<-]
\`\`\`
`;

// A project-side driver, bundled by the CLI from inside the project: it uses the two packages the
// way a consumer's own build script does, and nothing from the workspace.
const DRIVER = `import { writeFileSync } from 'node:fs';

import { buildSite } from '@gjsify/site';
import { createHighlighter } from '@gjsify/site-highlight';

const highlighter = await createHighlighter();
const result = await buildSite({
    root: process.cwd(),
    out: 'site',
    offline: true,
    // The bundle's own URL reveals no install of @gjsify/site, so the one option a bundled
    // caller must set is where the package's client assets live.
    packageDir: new URL('./node_modules/@gjsify/site', import.meta.url).pathname,
    markdown: { highlight: (code, lang) => highlighter.highlight(code, lang) },
});
writeFileSync('site/highlight.css', highlighter.css);
print(result.languages.join(','));
`;

const skip = e2eSkipReason('site-highlight', [['gjs on PATH', hasCommand('gjs')]]);

describe('a site build with @gjsify/site-highlight', { timeout: 15 * 60 * 1000, skip }, () => {
    let env;
    let projectDir;

    before(() => {
        env = createTestEnvironment('gjsify-e2e-site-highlight-');
        projectDir = join(env.tmpDir, 'app');
        mkdirSync(join(projectDir, 'data'), { recursive: true });
        mkdirSync(join(projectDir, 'blog'), { recursive: true });
        writeFileSync(join(projectDir, 'data', 'org.example.Highlight.metainfo.xml'), METAINFO);
        writeFileSync(join(projectDir, 'blog', 'highlight.en.md'), POST);
        writeFileSync(join(projectDir, 'driver.mjs'), DRIVER);

        setupProject(
            projectDir,
            {
                name: 'test-site-highlight',
                version: '1.0.0',
                type: 'module',
                private: true,
                devDependencies: {
                    '@gjsify/cli': '^0.1.0',
                    '@gjsify/site': '^0.1.0',
                    '@gjsify/site-highlight': '^0.1.0',
                },
                gjsify: {
                    site: {
                        metainfo: 'data/org.example.Highlight.metainfo.xml',
                        url: 'https://example.org/highlight/',
                        base: '/highlight/',
                        languages: ['en'],
                        repository: 'https://github.com/example/highlight',
                        blog: { posts: 'blog' },
                    },
                },
            },
            env.tarballsDir,
            env.tarballMap,
        );
    });

    after(() => cleanupTestEnvironment(env.tmpDir));

    it('highlights the languages it ships and leaves the rest plain', () => {
        const build = spawnSync(
            'npx',
            ['gjsify', 'build', 'driver.mjs', '--app', 'gjs', '--outfile', 'driver.gjs.mjs'],
            {
                cwd: projectDir,
                encoding: 'utf8',
                timeout: 5 * 60 * 1000,
            },
        );
        assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

        const run = spawnSync('npx', ['gjsify', 'run', 'driver.gjs.mjs'], {
            cwd: projectDir,
            encoding: 'utf8',
            timeout: 10 * 60 * 1000,
        });
        assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
        assert.match(run.stdout, /^en$/m);

        const page = join(projectDir, 'site', 'en', 'blog', 'highlight', 'index.html');
        assert.ok(existsSync(page), 'the post page is missing');
        const html = readFileSync(page, 'utf8');

        const blocks = html.match(/<pre class="shiki[^"]*"[\s\S]*?<\/pre>/g) ?? [];
        assert.equal(blocks.length, 2, `expected TypeScript and Blueprint to be highlighted:\n${html}`);
        assert.match(blocks[0], /--shiki-light:#/);
        // Blueprint has no grammar in Shiki; the one this package ships is what makes `template`
        // and `Gtk.ApplicationWindow` carry colours at all.
        assert.match(blocks[1], /Gtk/);
        assert.match(blocks[1], /--shiki-dark:#/);

        // A language nobody ships keeps the plain block — not a `<pre class="shiki">` without colours.
        assert.match(html, /<pre><code class="language-brainfuck">/);

        const css = readFileSync(join(projectDir, 'site', 'highlight.css'), 'utf8');
        assert.match(css, /pre\.shiki/);
        assert.match(css, /@media \(prefers-color-scheme: dark\)/);
    });
});
