// Tests for native-skip-scan — the pre-scan that surfaces files the native
// oxfmt (GJS) cannot format, so `gjsify format --check` does not silently
// skip them.

import { describe, it, expect } from '@gjsify/unit';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForNativeSkips, NATIVE_SKIP_EXTENSIONS } from './native-skip-scan.js';

export default async () => {
    await describe('scanForNativeSkips', async () => {
        await it('finds CSS files the native formatter will skip', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-css`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'style.css'), 'body { color: red; }');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toContain('style.css');
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('finds HTML files the native formatter will skip', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-html`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'index.html'), '<html></html>');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toContain('index.html');
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('finds Vue files the native formatter will skip', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-vue`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'App.vue'), '<template><div /></template>');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toContain('App.vue');
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('finds Markdown files the native formatter will skip', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-md`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'README.md'), '# Hello');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toContain('README.md');
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('does NOT flag JS/TS files — the native formatter handles those', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-js`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'index.ts'), 'const x: number = 1;');
            writeFileSync(join(dir, 'main.js'), 'const x = 1;');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(0);
            expect(result.total).toBe(2);
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('recurses into subdirectories', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-recurse`);
            mkdirSync(join(dir, 'src', 'components'), { recursive: true });
            writeFileSync(join(dir, 'src', 'components', 'style.css'), 'body {}');
            writeFileSync(join(dir, 'src', 'index.ts'), 'const x: number = 1;');
            writeFileSync(join(dir, 'src', 'components', 'template.html'), '<div></div>');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(2);
            expect(result.total).toBe(3);
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('handles a single file path directly', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-single`);
            mkdirSync(dir, { recursive: true });
            const file = join(dir, 'style.css');
            writeFileSync(file, 'body {}');
    
            const result = scanForNativeSkips([file], dir);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toBe(file);
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('returns empty for non-existent paths', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-nonexistent`);
            const result = scanForNativeSkips([join(dir, 'does-not-exist')], dir);
            expect(result.skipped).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    
        await it('handles mixed directories — only flags skippable extensions', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-mixed`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'index.ts'), 'const x: number = 1;');
            writeFileSync(join(dir, 'style.css'), 'body {}');
            writeFileSync(join(dir, 'index.html'), '<html></html>');
            writeFileSync(join(dir, 'main.js'), 'const x = 1;');
            writeFileSync(join(dir, 'README.md'), '# Hello');
            writeFileSync(join(dir, 'data.json'), '{}');
    
            const result = scanForNativeSkips([dir], dir);
            expect(result.skipped).toHaveLength(3);
            expect(result.total).toBe(6);
    
            rmSync(dir, { recursive: true, force: true });
        });
    
        await it('NATIVE_SKIP_EXTENSIONS covers the documented gap', async () => {
            // The README documents: CSS/HTML/Vue/Markdown need the Node-API host
            expect(NATIVE_SKIP_EXTENSIONS.has('.css')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.html')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.htm')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.vue')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.md')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.markdown')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.scss')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.sass')).toBe(true);
            expect(NATIVE_SKIP_EXTENSIONS.has('.less')).toBe(true);
            // JS/TS/JSX are handled natively
            expect(NATIVE_SKIP_EXTENSIONS.has('.ts')).toBe(false);
            expect(NATIVE_SKIP_EXTENSIONS.has('.tsx')).toBe(false);
            expect(NATIVE_SKIP_EXTENSIONS.has('.js')).toBe(false);
            expect(NATIVE_SKIP_EXTENSIONS.has('.jsx')).toBe(false);
        });

        // The regression the other ten missed, because every one of them passed
        // the target directory as `cwd` TOO — so `join(cwd, p)` doubled it into a
        // path that happened to make the assertion fail for the wrong reason.
        // The real caller does not: `gjsify format --check /srv/app` runs from an
        // unrelated cwd, and `join` turns that into `<cwd>/srv/app`, which does not
        // exist. `statSync` throws, the entry is dropped, and the scan reports
        // nothing — so `--check` exits 0 under GJS having checked nothing, which is
        // the single failure this module exists to prevent.
        await it('scans an absolute path that is NOT under cwd', async () => {
            const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-absolute`);
            const elsewhere = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-cwd`);
            mkdirSync(dir, { recursive: true });
            mkdirSync(elsewhere, { recursive: true });
            writeFileSync(join(dir, 'style.css'), 'body {}');

            const result = scanForNativeSkips([dir], elsewhere);
            expect(result.skipped).toHaveLength(1);
            expect(result.skipped[0]).toBe(join(dir, 'style.css'));

            rmSync(dir, { recursive: true, force: true });
            rmSync(elsewhere, { recursive: true, force: true });
        });
    });
};
