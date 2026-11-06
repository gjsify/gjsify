import { describe, it, expect } from '@gjsify/unit';
import { dimmedIconColor, onWindowFgChanged, publishWindowFg, publishedWindowFg } from './status-icon-color.js';

export default async () => {
    await describe('status-page icon colour', async () => {
        await it('dims the foreground to half opacity as #aarrggbb', async () => {
            expect(dimmedIconColor('#3d2a4a', '#33333a')).toBe('#803d2a4a');
        });
        await it('falls back to the scheme default when no foreground is declared', async () => {
            expect(dimmedIconColor(null, '#33333a')).toBe('#8033333a');
            expect(dimmedIconColor('not-a-colour', '#33333a')).toBe('#8033333a');
        });
        await it('notifies subscribers only on a change', async () => {
            let calls = 0;
            const off = onWindowFgChanged(() => calls++);
            publishWindowFg('#112233');
            publishWindowFg('#112233');
            expect(calls).toBe(1);
            expect(publishedWindowFg()).toBe('#112233');
            off();
            publishWindowFg(null);
            expect(calls).toBe(1);
        });
    });
};
