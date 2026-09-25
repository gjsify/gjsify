// Gates on two runtime identities, so on any one leg exactly one of them stands
// down. Run with `GJSIFY_TEST_EXPECT_AXES` naming the one that stood down, the
// runner must fail; naming one no gate mentions, it must not care.
import { describe, it, expect, on, run } from '@gjsify/unit';

run({
    s: async () => {
        await describe('one gate per runtime', async () => {
            await on('Node.js', async () => {
                await it('runs under Node', () => expect(1).toBe(1));
            });
            await on('Gjs', async () => {
                await it('runs under GJS', () => expect(1).toBe(1));
            });
        });
    },
});
