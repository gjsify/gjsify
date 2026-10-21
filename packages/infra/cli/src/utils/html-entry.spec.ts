// Unit tests for the `--app browser` HTML-entry helpers.
//
// Pure string/path logic — no filesystem, no bundler. Verifies detection of a
// single html entry, extraction of the local module script, the `src`
// rewrite in the emitted page, and the linked icons' `assets/` copies.

import { describe, expect, it } from '@gjsify/unit';
import { resolve, dirname } from 'node:path';
import { collectLinkedAssets, detectHtmlEntry, parseHtmlEntry, emitBrowserHtml } from './html-entry.js';

const HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head><meta charset="utf-8" /><title>My App</title></head>',
    '  <body>',
    '    <script type="module" src="./main.ts"></script>',
    '  </body>',
    '</html>',
    '',
].join('\n');

export default async (): Promise<void> => {
    await describe('html-entry.detectHtmlEntry', async () => {
        await it('detects a single .html string entry', async () => {
            expect(detectHtmlEntry('src/app/app.html')).toBe('src/app/app.html');
            expect(detectHtmlEntry('index.htm')).toBe('index.htm');
        });
        await it('detects a 1-element array / 1-key record', async () => {
            expect(detectHtmlEntry(['src/app/app.html'])).toBe('src/app/app.html');
            expect(detectHtmlEntry({ app: 'src/app/app.html' })).toBe('src/app/app.html');
        });
        await it('returns null for non-html + multi-entry + globs + empty', async () => {
            expect(detectHtmlEntry('src/main.ts')).toBeNull();
            expect(detectHtmlEntry('src/**/*.ts')).toBeNull();
            expect(detectHtmlEntry(['a.html', 'b.html'])).toBeNull();
            expect(detectHtmlEntry({ a: 'a.html', b: 'b.html' })).toBeNull();
            expect(detectHtmlEntry(undefined)).toBeNull();
        });
    });

    await describe('html-entry.parseHtmlEntry', async () => {
        await it('finds the local module script + resolves it against the html dir', async () => {
            const htmlPath = 'src/app/app.html';
            const parsed = parseHtmlEntry(htmlPath, HTML);
            expect(parsed.scriptSrc).toBe('./main.ts');
            expect(parsed.moduleEntry).toBe(resolve(dirname(htmlPath), './main.ts'));
            expect(parsed.scriptTag).toContain('type="module"');
        });
        await it('skips externally hosted module scripts', async () => {
            const html = '<script type="module" src="https://cdn.example/x.js"></script>\n' + HTML;
            // the FIRST local one wins; the external is skipped
            expect(parseHtmlEntry('a.html', html).scriptSrc).toBe('./main.ts');
        });
        await it('throws a clear error when no local module script exists', async () => {
            expect(() => parseHtmlEntry('a.html', '<html><body>no script</body></html>')).toThrow();
        });
    });

    await describe('html-entry.emitBrowserHtml', async () => {
        await it('rewrites src to the built bundle (same dir) + preserves the rest', async () => {
            const { scriptTag, scriptSrc } = parseHtmlEntry('src/app/app.html', HTML);
            const out = emitBrowserHtml({
                htmlSource: HTML,
                scriptTag,
                scriptSrc,
                jsOutPath: resolve('dist-app/app.js'),
                outHtmlPath: resolve('dist-app/index.html'),
            });
            expect(out).toContain('src="./app.js"');
            expect(out).not.toContain('./main.ts');
            expect(out).toContain('<title>My App</title>');
        });
        await it('rewrites src to a nested bundle path', async () => {
            const { scriptTag, scriptSrc } = parseHtmlEntry('src/app/app.html', HTML);
            const out = emitBrowserHtml({
                htmlSource: HTML,
                scriptTag,
                scriptSrc,
                jsOutPath: resolve('dist-app/assets/app.js'),
                outHtmlPath: resolve('dist-app/index.html'),
            });
            expect(out).toContain('src="./assets/app.js"');
        });
    });

    await describe('html-entry.collectLinkedAssets', async () => {
        const ICONS = [
            '<head>',
            '<link rel="icon" type="image/svg+xml" href="../icons/app.svg" />',
            '<link rel="apple-touch-icon" href="../icons/app.svg">',
            '<link rel="shortcut icon" href="./other/app.svg?v=2">',
            '<link rel="stylesheet" href="./style.css">',
            '<link rel="icon" href="https://example.org/favicon.ico">',
            '<link rel="icon" href="/favicon.ico">',
            '<link rel="icon" href="data:,">',
            '</head>',
            '<script type="module" src="./main.ts"></script>',
        ].join('\n');

        await it('collects local icon links only, resolved against the html directory', async () => {
            const assets = collectLinkedAssets('src/app/app.html', ICONS);
            expect(assets.map((a) => a.href)).toStrictEqual([
                '../icons/app.svg',
                '../icons/app.svg',
                './other/app.svg?v=2',
            ]);
            expect(assets[0].source).toBe(resolve('src/icons/app.svg'));
            expect(assets[2].source).toBe(resolve('src/app/other/app.svg'));
        });
        await it('one target per file, a suffix for a second file with the same name', async () => {
            const assets = collectLinkedAssets('src/app/app.html', ICONS);
            expect(assets.map((a) => a.target)).toStrictEqual(['assets/app.svg', 'assets/app.svg', 'assets/app-1.svg']);
        });
        await it('the emitted page links the copies and leaves other links alone', async () => {
            const { scriptTag, scriptSrc } = parseHtmlEntry('src/app/app.html', ICONS);
            const out = emitBrowserHtml({
                htmlSource: ICONS,
                scriptTag,
                scriptSrc,
                jsOutPath: resolve('dist-app/app.js'),
                outHtmlPath: resolve('dist-app/index.html'),
                assets: collectLinkedAssets('src/app/app.html', ICONS),
            });
            expect(out).toContain('<link rel="icon" type="image/svg+xml" href="./assets/app.svg" />');
            expect(out).toContain('<link rel="apple-touch-icon" href="./assets/app.svg">');
            expect(out).toContain('<link rel="shortcut icon" href="./assets/app-1.svg">');
            expect(out).toContain('href="./style.css"');
            expect(out).toContain('href="https://example.org/favicon.ico"');
            expect(out).toContain('href="/favicon.ico"');
            expect(out).not.toContain('../icons/');
        });
    });
};
