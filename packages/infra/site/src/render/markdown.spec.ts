import { describe, expect, it } from '@gjsify/unit';

import { renderMarkdown } from './markdown.js';

export default async () => {
    await describe('renderMarkdown', async () => {
        await it('shifts heading levels up by one, since the page already has its own h1', async () => {
            expect(renderMarkdown('# Title\n\n## Section\n\n### Sub')).toBe(
                '<h2>Title</h2>\n<h3>Section</h3>\n<h4>Sub</h4>',
            );
        });

        await it('joins wrapped lines of one paragraph, and separates two on a blank line', async () => {
            expect(renderMarkdown('one line\nwrapped onto a second\n\na new paragraph')).toBe(
                '<p>one line wrapped onto a second</p>\n<p>a new paragraph</p>',
            );
        });

        await it('renders ordered and unordered lists', async () => {
            expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
            expect(renderMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
        });

        await it('renders a GFM pipe table', async () => {
            expect(renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |')).toBe(
                '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
            );
        });

        await it('renders a horizontal rule', async () => {
            expect(renderMarkdown('above\n\n---\n\nbelow')).toBe('<p>above</p>\n<hr>\n<p>below</p>');
        });

        await it('renders inline links, bold and code, applied to already-escaped text', async () => {
            expect(renderMarkdown('See [the code](https://example.org/x?a=1&b=2).')).toBe(
                '<p>See <a href="https://example.org/x?a=1&amp;b=2">the code</a>.</p>',
            );
            expect(renderMarkdown('**bold** and `code`')).toBe('<p><strong>bold</strong> and <code>code</code></p>');
        });

        await it('escapes HTML in the source, never renders it', async () => {
            expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
        });
    });
};
