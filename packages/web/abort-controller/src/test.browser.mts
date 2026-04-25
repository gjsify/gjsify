import { run, describe, it, expect } from '@gjsify/unit';

run({
    async AbortControllerTest() {
        await describe('AbortController', async () => {
            await it('signal is initially not aborted', async () => {
                const ac = new AbortController();
                expect(ac.signal.aborted).toBe(false);
            });

            await it('abort() marks signal as aborted', async () => {
                const ac = new AbortController();
                ac.abort();
                expect(ac.signal.aborted).toBe(true);
            });

            await it('abort() with reason stores reason on signal', async () => {
                const ac = new AbortController();
                ac.abort('my reason');
                expect(ac.signal.reason).toBe('my reason');
            });

            await it('abort() fires abort event on signal', async () => {
                const ac = new AbortController();
                let fired = false;
                ac.signal.addEventListener('abort', () => { fired = true; });
                ac.abort();
                expect(fired).toBe(true);
            });

            await it('subsequent abort() calls are no-ops', async () => {
                const ac = new AbortController();
                ac.abort('first');
                ac.abort('second');
                expect(ac.signal.reason).toBe('first');
            });

            await it('signal property always returns the same instance', async () => {
                const ac = new AbortController();
                expect(ac.signal).toBe(ac.signal);
            });
        });

        await describe('AbortSignal', async () => {
            await it('AbortSignal.timeout() creates a non-aborted signal', async () => {
                const signal = AbortSignal.timeout(5000);
                expect(signal.aborted).toBe(false);
            });

            await it('AbortSignal.any() aborts when any source aborts', async () => {
                const ac1 = new AbortController();
                const ac2 = new AbortController();
                const combined = AbortSignal.any([ac1.signal, ac2.signal]);
                expect(combined.aborted).toBe(false);
                ac2.abort('from ac2');
                expect(combined.aborted).toBe(true);
            });
        });
    },
});
