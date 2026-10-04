// No `on('Gl', …)` anywhere, and no `@gjsify/unit/gl` import — the common case for every
// consumer whose suites never touch WebGL. The bundle this builds into must carry no
// `gi://Gtk`/`gi://Gdk` specifier at all.
import { describe, it, expect, run } from '@gjsify/unit';

run({
    s: async () => {
        await describe('a suite that never asks about GL', async () => {
            await it('passes on its own terms', () => expect(1).toBe(1));
        });
    },
});
