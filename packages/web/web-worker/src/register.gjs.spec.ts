// `/register` installs the global on a host without one. Node has no WHATWG
// Worker either, but the assertion lives on GJS: the Node leg of the suite must
// keep proving the adapter, not the global. The bundle's `--globals auto` may
// already have run `/register` before this spec (it maps `Worker` to it), so the
// spec asserts the state after the import, not the absence before it. That
// earlier install comes from the package build while this spec imports the
// source, so the two classes differ in identity: compare the shape instead.

import { describe, it, expect, on } from '@gjsify/unit';

type Holder = { Worker?: { name: string; prototype: Record<string, unknown> } };

export default async () => {
    await on('Gjs', async () => {
        await describe('@gjsify/web-worker/register', async () => {
            await it('installs a WHATWG Worker on globalThis', async () => {
                await import('./register.js');
                const Ctor = (globalThis as unknown as Holder).Worker;
                expect(typeof Ctor).toBe('function');
                expect(Ctor?.name).toBe('Worker');
                expect(typeof Ctor?.prototype.postMessage).toBe('function');
                expect(typeof Ctor?.prototype.terminate).toBe('function');
            });
        });
    });
};
