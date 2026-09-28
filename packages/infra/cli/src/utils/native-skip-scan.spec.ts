// Tests for native-skip-scan — the pre-scan that surfaces files the native
// oxfmt (GJS) cannot format, so `gjsify format --check` does not silently
// skip them.

import { describe, it, expect } from '@gjsify/unit';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForNativeSkips, NATIVE_SKIP_EXTENSIONS } from './native-skip-scan.js';

describe('scanForNativeSkips', () => {
    it('finds CSS files the native formatter will skip', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-css`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'style.css'), 'body { color: red; }');

        const result = scanForNativeSkips([dir], dir);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('style.css');

        rmSync(dir, { recursive: true, force: true });
    });

    it('finds HTML files the native formatter will skip', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-html`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), '<html></html>');

        const result = scanForNativeSkips([dir], dir);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('index.html');

        rmSync(dir, { recursive: true, force: true });
    });

    it('finds Vue files the native formatter will skip', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-vue`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'App.vue'), '<template><div /></template>');

        const result = scanForNativeSkips([dir], dir);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('App.vue');

        rmSync(dir, { recursive: true, force: true });
    });

    it('finds Markdown files the native formatter will skip', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-md`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'README.md'), '# Hello');

        const result = scanForNativeSkips([dir], dir);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('README.md');

        rmSync(dir, { recursive: true, force: true });
    });

    it('does NOT flag JS/TS files — the native formatter handles those', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-js`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.ts'), 'const x: number = 1;');
        writeFileSync(join(dir, 'main.js'), 'const x = 1;');

        const result = scanForNativeSkips([dir], dir);
        expect(result.skipped).toHaveLength(0);
        expect(result.total).toBe(2);

        rmSync(dir, { recursive: true, force: true });
    });

    it('recurses into subdirectories', () => {
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

    it('handles a single file path directly', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-single`);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, 'style.css');
        writeFileSync(file, 'body {}');

        const result = scanForNativeSkips([file], dir);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toBe(file);

        rmSync(dir, { recursive: true, force: true });
    });

    it('returns empty for non-existent paths', () => {
        const dir = join(tmpdir(), `gjsify-skip-scan-${Date.now()}-nonexistent`);
        const result = scanForNativeSkips([join(dir, 'does-not-exist')], dir);
        expect(result.skipped).toHaveLength(0);
        expect(result.total).toBe(0);
    });

    it('handles mixed directories — only flags skippable extensions', () => {
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

    it('NATIVE_SKIP_EXTENSIONS covers the documented gap', () => {
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
});
