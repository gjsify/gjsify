import { describe, expect, it } from '@gjsify/unit';

import { createHighlighter, HIGHLIGHT_CSS, highlightCss } from './index.js';

const TS = `const greet = (name: string): string => \`hi ${'${name}'}\`;\nexport default greet;\n`;
const CSS = '.demo { color: #1c7a4a; /* accent */ }\n';
const BLUEPRINT = `using Gtk 4.0;
template $MainWindow: Gtk.ApplicationWindow {
  title: "hello";
  Gtk.Label hint { styles ["demo-status"] }
}
`;

export default async () => {
    const highlighter = await createHighlighter();

    await describe('createHighlighter', async () => {
        await it('writes both palettes into CSS variables, so one HTML serves light and dark', async () => {
            const html = highlighter.highlight(TS, 'typescript');
            expect(html).toContain('<pre class="shiki');
            expect(html).toContain('--shiki-light');
            expect(html).toContain('--shiki-dark');
            // A token carries a colour of its own; a plain lang- attribute would not.
            expect(html).toMatch(/<span style="--shiki-light:#[0-9A-Fa-f]+[^"]*--shiki-dark:/);
        });

        await it('highlights CSS, shell and diff blocks', async () => {
            for (const [lang, code] of [
                ['css', CSS],
                ['sh', 'gjsify create hello --template gtk-minimal\n'],
                ['diff', '- a\n+ b\n'],
                ['json', '{"a": 1}\n'],
                ['xml', '<node attr="1"/>\n'],
                ['yaml', 'a: 1\n'],
                ['markdown', '# Title\n'],
                ['scss', '.a { .b { color: red; } }\n'],
                ['javascript', 'export const a = 1;\n'],
            ] as const) {
                const html = highlighter.highlight(code, lang);
                expect({ lang, tokens: html?.includes('--shiki-light') }).toStrictEqual({ lang, tokens: true });
            }
        });

        await it('answers the same for a language and its aliases', async () => {
            expect(highlighter.highlight(TS, 'ts')).toBe(highlighter.highlight(TS, 'typescript'));
            expect(highlighter.highlight('export const a = 1;\n', 'js')).toBe(
                highlighter.highlight('export const a = 1;\n', 'javascript'),
            );
            expect(highlighter.highlight('ls\n', 'bash')).toBe(highlighter.highlight('ls\n', 'sh'));
            expect(highlighter.highlight(BLUEPRINT, 'blp')).toBe(highlighter.highlight(BLUEPRINT, 'blueprint'));
        });

        await it('highlights Blueprint, which Shiki bundles no grammar for', async () => {
            const html = highlighter.highlight(BLUEPRINT, 'blueprint');
            expect(html).toContain('<span class="line">');
            // `template` is a keyword and `Gtk.ApplicationWindow` a type name — both get a class.
            expect(html).toMatch(/<span style="[^"]*--shiki-light:#[0-9A-Fa-f]+[^"]*">(template|Gtk)<\/span>/);
        });

        await it('answers undefined for a language it does not ship, and for none at all', async () => {
            expect(highlighter.highlight('echo hi\n', 'brainfuck')).toBe(undefined);
            expect(highlighter.highlight('plain\n', '')).toBe(undefined);
        });

        await it('reads the language off an info string that carries more than a name', async () => {
            expect(highlighter.highlight('ls\n', 'sh title=build')).toContain('--shiki-light');
            expect(highlighter.highlight('ls\n', 'SH')).toContain('--shiki-light');
            // `sh` plus a title still resolves, while an unknown name with options does not throw.
            expect(highlighter.highlight('ls\n', 'nope title=build')).toBe(undefined);
        });

        await it('escapes the code it was given, so a fence cannot inject markup', async () => {
            const html = highlighter.highlight('const s = "<b>&";\n', 'ts');
            // Shiki escapes numerically (`&#x3C;`, `&#x26;`), not as named entities — what matters
            // is that the markup it emits is the only markup left.
            expect(html).toContain('&#x3C;b>&#x26;');
            expect(html).not.toContain('<b>');
        });

        await it('ships the stylesheet the two-palette HTML needs', async () => {
            expect(highlighter.css).toBe(HIGHLIGHT_CSS);
            expect(HIGHLIGHT_CSS).toContain('var(--shiki-light)');
            expect(HIGHLIGHT_CSS).toContain('@media (prefers-color-scheme: dark)');
            expect(HIGHLIGHT_CSS).toContain("[data-theme='dark']");
            expect(HIGHLIGHT_CSS).toContain("[data-theme='light']");
            // `pre.shiki`, not `.shiki`: the site's own `pre` rule has to be beatable by order.
            expect(HIGHLIGHT_CSS).toContain('pre.shiki');
        });

        await it('follows the scheme attribute a site names', async () => {
            const css = highlightCss('data-scheme');
            expect(css).toContain("[data-scheme='dark'] pre.shiki");
            expect(css).toContain("[data-scheme='light'] pre.shiki");
            expect(css).not.toContain('data-theme');
            const custom = await createHighlighter({ schemeAttribute: 'data-scheme' });
            expect(custom.css).toBe(css);
            expect(() => highlightCss("x'] {}")).toThrow();
        });
    });
};
