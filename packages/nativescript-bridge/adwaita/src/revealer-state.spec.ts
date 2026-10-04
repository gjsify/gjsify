// What `reveal-child` does to the revealed child — collapsed, not hidden.

import { describe, expect, it } from '@gjsify/unit';

import { revealerChildVisibility } from './widgets/revealer-state.js';

export default async () => {
    await describe('revealerChildVisibility', async () => {
        await it('shows a revealed child', () => {
            expect(revealerChildVisibility(true)).toBe('visible');
        });

        await it('COLLAPSES an unrevealed one — GTK allocates it nothing, and `hidden` keeps the space', () => {
            expect(revealerChildVisibility(false)).toBe('collapse');
        });
    });
};
