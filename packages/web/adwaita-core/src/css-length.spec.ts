import { describe, expect, it } from '@gjsify/unit';

import { CSS_LENGTH_VECTORS, driveCssLengthVectors } from './conformance/css-length.js';
import { cssPxToDip } from './css-length.js';

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
};
