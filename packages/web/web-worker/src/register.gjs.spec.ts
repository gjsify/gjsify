// `/register` installs the global on a host without one. Node has no WHATWG
// Worker either, but the assertion lives on GJS: the Node leg of the suite must
// keep proving the adapter, not the global. The module evaluates once per
// realm, so the "host already has one" branch has no second import to test.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from './index.js';

type Holder = { Worker?: unknown };

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/web-worker/register', async () => {
            await it('sets globalThis.Worker when it is absent', async () => {
                expect((globalThis as Holder).Worker).toBe(undefined);
                await import('./register.js');
                expect((globalThis as Holder).Worker).toBe(Worker);
                delete (globalThis as Holder).Worker;
            });
        });
    });
};
