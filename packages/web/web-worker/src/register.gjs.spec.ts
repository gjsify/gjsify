// `/register` installs the global on a host without one. Node has no WHATWG
// Worker either, but the assertion lives on GJS: the Node leg of the suite must
// keep proving the adapter, not the global. The bundle's `--globals auto` may
// already have run `/register` before this spec (it maps `Worker` to it), so the
// spec asserts the state after the import, not the absence before it.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from './index.js';

type Holder = { Worker?: unknown };

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/web-worker/register', async () => {
            await it('makes globalThis.Worker the adapter', async () => {
                await import('./register.js');
                expect((globalThis as Holder).Worker).toBe(Worker);
            });
        });
    });
};
