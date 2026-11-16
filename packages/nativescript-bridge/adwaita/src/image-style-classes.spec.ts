import { describe, expect, it } from '@gjsify/unit';

import { adwaitaNsAccentColor } from './widgets/accent-theme.js';
import { imageClassColor } from './widgets/image-style-classes.js';

export default async () => {
    await describe('imageClassColor', async () => {
        await it('is null when no class names a colour', () => {
            expect(imageClassColor([], 'blue', 'light')).toBe(null);
            expect(imageClassColor(['dim-label', 'success'], 'blue', 'dark')).toBe(null);
        });

        await it('resolves accent per scheme to the standalone colour', () => {
            expect(imageClassColor(['accent'], 'blue', 'light')).toBe(adwaitaNsAccentColor('blue', 'shade'));
            expect(imageClassColor(['accent'], 'blue', 'dark')).toBe(adwaitaNsAccentColor('blue', 'standalone-dark'));
        });

        await it('follows the accent', () => {
            expect(imageClassColor(['accent'], 'red', 'light')).toBe(adwaitaNsAccentColor('red', 'shade'));
        });
    });
};
