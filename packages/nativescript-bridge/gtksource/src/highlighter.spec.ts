import { describe, expect, it } from '@gjsify/unit';
import { parseLanguage, Tokenizer } from '@gjsify/gtksource-core';

import { IncrementalHighlighter } from './highlighter.js';

const C_LIKE = `<?xml version="1.0"?>
<language id="t" name="T" version="2.0" _section="Source">
  <styles><style id="comment" name="Comment" map-to="def:comment"/><style id="kw" name="Kw" map-to="def:keyword"/></styles>
  <definitions>
    <context id="block" style-ref="comment"><start>/\\*</start><end>\\*/</end></context>
    <context id="t"><include>
      <context ref="block"/>
      <context id="k" style-ref="kw"><match>\\bfoo\\b</match></context>
    </include></context>
  </definitions>
</language>`;

const tokenizer = new Tokenizer(parseLanguage(C_LIKE, { strict: true }));
const styles = (h: IncrementalHighlighter, line: number): string =>
    h
        .tokensOf(line)
        .map((t) => `${t.start}-${t.end}:${t.style}`)
        .join(',');

export default async () => {
    await describe('gtksource-nativescript: IncrementalHighlighter', async () => {
        await it('tokenizes everything on reset', () => {
            const h = new IncrementalHighlighter(tokenizer);
            h.reset(['foo', 'bar']);
            expect(h.lineCount).toBe(2);
            expect(styles(h, 0)).toBe('0-3:kw');
            expect(styles(h, 1)).toBe('');
        });

        await it('re-tokenizes only the edited line when the end state is unchanged', () => {
            const h = new IncrementalHighlighter(tokenizer);
            const lines = ['foo', 'x', 'foo'];
            h.reset(lines);
            lines[1] = 'foo';
            expect(h.update(lines, { first: 1, removed: 1, inserted: 1 })).toStrictEqual({ first: 1, last: 1 });
            expect(styles(h, 1)).toBe('0-3:kw');
        });

        await it('propagates an opened comment down to its end and no further', () => {
            const h = new IncrementalHighlighter(tokenizer);
            const lines = ['a', 'foo', 'b */', 'foo'];
            h.reset(lines);
            lines[0] = '/* a';
            const range = h.update(lines, { first: 0, removed: 1, inserted: 1 });
            expect(range).toStrictEqual({ first: 0, last: 2 });
            expect(styles(h, 1)).toBe('0-3:comment');
            expect(styles(h, 3)).toBe('0-3:kw');
        });

        await it('closes a comment again when the opener is deleted', () => {
            const h = new IncrementalHighlighter(tokenizer);
            let lines = ['/* a', 'foo', 'b */', 'foo'];
            h.reset(lines);
            lines = ['a', 'foo', 'b */', 'foo'];
            h.update(lines, { first: 0, removed: 1, inserted: 1 });
            expect(styles(h, 1)).toBe('0-3:kw');
        });

        await it('handles lines inserted and removed', () => {
            const h = new IncrementalHighlighter(tokenizer);
            let lines = ['foo', 'bar'];
            h.reset(lines);
            lines = ['foo', '/*', 'x', 'bar'];
            const range = h.update(lines, { first: 1, removed: 1, inserted: 3 });
            expect(h.lineCount).toBe(4);
            expect(range.first).toBe(1);
            expect(styles(h, 2)).toBe('0-1:comment');
            lines = ['foo', 'bar'];
            h.update(lines, { first: 1, removed: 3, inserted: 1 });
            expect(h.lineCount).toBe(2);
        });

        await it('agrees with tokenizing the whole text from scratch', () => {
            const h = new IncrementalHighlighter(tokenizer);
            let lines = ['foo /* x', 'foo', '*/ foo'];
            h.reset(lines);
            lines = ['foo /* x', 'foo */', '*/ foo'];
            h.update(lines, { first: 1, removed: 1, inserted: 1 });
            const fresh = new IncrementalHighlighter(tokenizer);
            fresh.reset(lines);
            for (let i = 0; i < lines.length; i++) expect(styles(h, i)).toBe(styles(fresh, i));
        });

        await it('rejects an edit that does not fit', () => {
            const h = new IncrementalHighlighter(tokenizer);
            h.reset(['a']);
            expect(() => h.update(['a', 'b'], { first: 0, removed: 1, inserted: 1 })).toThrow();
        });
    });
};
