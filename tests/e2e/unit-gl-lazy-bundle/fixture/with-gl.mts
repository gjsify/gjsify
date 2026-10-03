// Imports `@gjsify/unit/gl` and uses `on('Gl', …)` — the ONLY shape allowed to pull
// `gi://Gtk`/`gi://Gdk` into a bundle. Control case: without it, a suite asserting only the
// no-gl fixture could pass against a runner that stripped the specifier unconditionally.
import { describe, it, expect, on, run } from '@gjsify/unit';
import '@gjsify/unit/gl';

run({
    s: async () => {
        await describe('a suite that uses the Gl axis', async () => {
            await on('Gl', async () => {
                await it('runs only where GL realizes', () => expect(1).toBe(1));
            });
        });
    },
});
