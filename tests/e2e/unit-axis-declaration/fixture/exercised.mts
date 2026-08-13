// The same declaration, satisfied: one gate per axis, each executing a test. The
// control case — without it, a suite asserting only the failure could pass against
// a runner that failed every run.
import { describe, it, expect, on, run } from '@gjsify/unit';

run(
    {
        s: async () => {
            await describe('a suite whose gates execute', async () => {
                await on('Node.js', async () => {
                    await it('runs on the node leg', () => expect(1).toBe(1));
                });
                await on('Gjs', async () => {
                    await it('runs on the gjs leg', () => expect(1).toBe(1));
                });
            });
        },
    },
    { requireAxes: ['Node.js', 'Gjs'] },
);
