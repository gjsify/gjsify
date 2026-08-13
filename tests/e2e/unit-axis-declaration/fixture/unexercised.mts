// Declares the two axes this repo's legs actually run on, and contains no `on()`
// gate at all — so whichever leg builds it MUST report the declaration unmet.
import { describe, it, expect, run } from '@gjsify/unit';

run(
    {
        s: async () => {
            await describe('a suite with no on() gate', async () => {
                await it('passes on its own terms', () => expect(1).toBe(1));
            });
        },
    },
    { requireAxes: ['Node.js', 'Gjs'] },
);
