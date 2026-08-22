// The `/register` wiring, in its own file (tests/AGENTS.md rule 7).
//
// The common specs import `DOMParser` by name, which says nothing about whether
// importing `@gjsify/domparser/register` puts it on `globalThis` — and that path
// is the one every `--globals DOMParser` bundle and `@excaliburjs/plugin-tiled`
// actually take. It went untested for the life of the package.
//
// `.gjs.spec.ts` rather than `register.spec.ts`: this package is cross-platform,
// and on node/bun/deno there is nothing to assert — the runtime has no native
// `DOMParser`, and the register module's own guard means a browser's native one
// must survive untouched.
//
// The global is read through `Record<string, unknown>` rather than a typed
// declaration: TypeScript's ambient `lib.dom` `DOMParser` is a DIFFERENT type
// with the same name, so declaring the property collides with it.

import { describe, expect, it, on } from '@gjsify/unit';
import { DOMParser } from '@gjsify/domparser';
import '@gjsify/domparser/register';

const injected = (): unknown => (globalThis as Record<string, unknown>).DOMParser;

export default async () => {
    await on('Gjs', async () => {
        await describe('domparser/register', async () => {
            await it('puts DOMParser on globalThis', async () => {
                expect(injected()).toBeDefined();
                // Identity, not just presence: a second, differently-behaving
                // constructor under the same name is the failure this catches.
                expect(injected()).toBe(DOMParser);
            });

            await it('parses through the global exactly as through the import', async () => {
                // The consumer shape: tiled never imports the class, it reads the
                // global. So the global has to be a working parser, not a marker.
                const Injected = injected() as typeof DOMParser;
                const doc = new Injected().parseFromString('<map><layer name="g"/></map>', 'application/xml');
                expect(doc.documentElement).not.toBeNull();
                expect(doc.querySelector('layer')!.getAttribute('name')).toBe('g');

                const html = new Injected().parseFromString('<ul><li>a<li>b</ul>', 'text/html');
                expect(html.querySelectorAll('li').length).toBe(2);
                expect(html.querySelectorAll('li')[0].textContent).toBe('a');
            });

            await it('leaves an already-installed DOMParser alone', async () => {
                // The guard in register.ts is `typeof g.DOMParser === 'undefined'`,
                // which is what keeps a browser's native parser from being replaced.
                // Re-importing must therefore be a no-op, not a reassignment.
                const before = injected();
                await import('@gjsify/domparser/register');
                expect(injected()).toBe(before);
            });
        });
    });
};
