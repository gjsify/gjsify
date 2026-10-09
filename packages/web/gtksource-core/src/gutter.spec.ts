import { describe, expect, it } from '@gjsify/unit';

import { parseColor } from './color.js';
import { digitCount, emphasisedLine, gutterWidth, visibleLines } from './gutter.js';

export default async () => {
    await describe('gtksource-core: gutter and colour arithmetic', async () => {
        await it('keeps a minimum digit count so the gutter does not jitter', () => {
            expect(digitCount(9)).toBe(2);
            expect(digitCount(100)).toBe(3);
            expect(gutterWidth(9, 10, 4)).toBe(28);
        });

        await it('finds the visible line range by bisection', () => {
            const top = (l: number): number => l * 10;
            const bottom = (l: number): number => l * 10 + 10;
            expect(visibleLines(1000, top, bottom, 95, 125)).toStrictEqual({ first: 9, last: 12 });
            expect(visibleLines(0, top, bottom, 0, 10)).toBe(null);
            expect(visibleLines(3, top, bottom, 100, 200)).toBe(null);
        });

        await it('emphasises the caret line number only under highlight-current-line', () => {
            expect(emphasisedLine(false, 0)).toBe(-1);
            expect(emphasisedLine(true, 0)).toBe(0);
            expect(emphasisedLine(true, 7)).toBe(7);
        });

        await it('parses CSS colours with the alpha last', () => {
            expect(parseColor('#ff0000')).toBe(0xffff0000 | 0);
            expect(parseColor('#00000018')).toBe(0x18000000);
            expect(parseColor('#0f0')).toBe(0xff00ff00 | 0);
            expect(parseColor('red')).toBe(undefined);
        });
    });
};
