import { describe, expect, it } from '@gjsify/unit';

import { CSS_LENGTH_VECTORS, driveCssLengthVectors } from './conformance/css-length.js';
import { cssPxToDip, scaleAdwaitaCss } from './css-length.js';

export default async () => {
    await driveCssLengthVectors(
        { name: 'adwaita-core', isOracle: false, toDip: cssPxToDip },
        { describe, expect, it },
        CSS_LENGTH_VECTORS,
    );

    await describe('cssPxToDip', async () => {
        await it('drops px from a length', () => {
            expect(cssPxToDip('padding: 12px;')).toBe('padding: 12;');
            expect(cssPxToDip('min-width: 0px')).toBe('min-width: 0');
            expect(cssPxToDip('margin: 1.5px')).toBe('margin: 1.5');
            expect(cssPxToDip('margin: .5px')).toBe('margin: .5');
        });
        await it('converts each length of a shorthand, negatives included', () => {
            expect(cssPxToDip('padding: 0 12px')).toBe('padding: 0 12');
            expect(cssPxToDip('margin: -4px 8px -2.5px 0')).toBe('margin: -4 8 -2.5 0');
            expect(cssPxToDip('margin:4px 8px')).toBe('margin:4 8');
        });
        await it('leaves unitless values, percentages and other units alone', () => {
            expect(cssPxToDip('padding: 12; width: 50%; font-size: 1.2em; margin: 2pt 3rem')).toBe(
                'padding: 12; width: 50%; font-size: 1.2em; margin: 2pt 3rem',
            );
        });
        await it('leaves strings, url() and comments alone', () => {
            const kept = `content: "12px"; background: url(a-12px.png); /* 12px */ x: '3px'`;
            expect(cssPxToDip(kept)).toBe(kept);
            expect(cssPxToDip(`a { content: "x"; padding: 3px }`)).toBe(`a { content: "x"; padding: 3 }`);
        });
        await it('does not read px inside an identifier or a hex colour', () => {
            expect(cssPxToDip('color: #12px; --a2px: 1; .w12px { top: 1px }')).toBe(
                'color: #12px; --a2px: 1; .w12px { top: 1 }',
            );
        });
        await it('converts a custom property that later feeds a length', () => {
            expect(cssPxToDip('--swatch-size: 44px; padding: var(--swatch-size)')).toBe(
                '--swatch-size: 44; padding: var(--swatch-size)',
            );
        });
        await it('reads PX in any case', () => {
            expect(cssPxToDip('padding: 8PX')).toBe('padding: 8');
        });
    });

    await describe('scaleAdwaitaCss', async () => {
        await it('scales the font AND the box around it with the same factor', () => {
            expect(scaleAdwaitaCss('.body { font-size: 14.67; padding: 12; color: red }', 1.143)).toBe(
                '.body { font-size: 16.768; padding: 13.716 }',
            );
        });
        await it('emits only the length declarations, so a colour override survives it', () => {
            expect(scaleAdwaitaCss('.adw-window { background-color: #fafafb; min-height: 48 }', 1.5)).toBe(
                '.adw-window { min-height: 72 }',
            );
            expect(scaleAdwaitaCss('.adw-window { background-color: rgba(0, 0, 0, 0.8) }', 1.5)).toBe('');
        });
        await it('keeps the selector as authored, so the override wins on position', () => {
            expect(scaleAdwaitaCss('.a, Page.b > .c { height: 10 }', 2)).toBe('.a, Page.b > .c { height: 20 }');
        });
        await it('emits the original lengths at 1, which is how a scale is taken back', () => {
            expect(scaleAdwaitaCss('.row { min-height: 48; margin: 0 12 }', 1)).toBe(
                '.row { min-height: 48; margin: 0 12 }',
            );
        });
        await it('scales every length of a shorthand and leaves keywords and percentages', () => {
            expect(scaleAdwaitaCss('.a { margin: 4 auto -2.5 0 }', 1.5)).toBe('.a { margin: 6 auto -3.75 0 }');
            expect(scaleAdwaitaCss('.a { width: 100%; height: 50 }', 1.5)).toBe('.a { height: 75 }');
        });
        await it('leaves durations, colours and tracking alone — they are not lengths', () => {
            const kept = '.a { transition: 0.2s; color: #112233; letter-spacing: 0.1; opacity: 0.5 }';
            expect(scaleAdwaitaCss(kept, 2)).toBe('');
        });
        await it('keeps a rule inside the condition it was written under', () => {
            expect(scaleAdwaitaCss('@media (min-width: 600) { .a { padding: 6 } }', 2)).toBe(
                '@media (min-width: 600) { .a { padding: 12 } }',
            );
        });
        await it('drops at-rules that carry no layout length', () => {
            expect(scaleAdwaitaCss('@font-face { src: url(a.ttf) } @keyframes x { from { width: 4 } }', 2)).toBe('');
            expect(scaleAdwaitaCss('@import "a.css"; .a { width: 4 }', 2)).toBe('.a { width: 8 }');
        });
        await it('carries a px length through, for a sheet that still has one', () => {
            expect(scaleAdwaitaCss('.a { padding: 12px }', 2)).toBe('.a { padding: 24px }');
        });
        await it('answers nothing for a scale that is not a usable factor', () => {
            expect(scaleAdwaitaCss('.a { width: 4 }', 0)).toBe('');
            expect(scaleAdwaitaCss('.a { width: 4 }', Number.NaN)).toBe('');
        });
        await it('ignores a brace, a colon or a semicolon inside a string or a comment', () => {
            expect(scaleAdwaitaCss('/* .x { width: 9 } */ .a { width: 4 }', 2)).toBe('.a { width: 8 }');
            expect(scaleAdwaitaCss(`.a { content: "{;}"; width: 4 }`, 2)).toBe('.a { width: 8 }');
        });
    });
};
