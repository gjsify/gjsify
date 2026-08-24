// Deepkit's type compiler must see the ORIGINAL TypeScript, and a user plugin must
// not be able to strip the annotations out from under it.
//
// THE INCIDENT. `@gjsify/rolldown-plugin-solid` declares `transform: { order: 'pre' }`
// and runs `@babel/preset-typescript` over every `.tsx`. The build composed
// `[...pnpPlugins, ...userPlugins, ...cfg.plugins]` and `deepkitPlugin` lived in
// `cfg.plugins`, so both are `'pre'` and array position decided: the user plugin won,
// Deepkit was handed a file with no types left, found nothing to reflect and returned
// `null`. MEASURED on one `.tsx` carrying both a `typeOf<T>()` and a JSX tag: the
// artifact read `const reflected = typeOf();`, no `__Ω` token anywhere, exit 0, not one
// diagnostic — and `Error: No type given` thrown at runtime.
//
// The fix splits the contract: `GjsifyConfig.prePlugins` is composed BEFORE the user's
// plugins, `plugins` stays after them. User plugins keep winning where the original
// order was actually argued for — `resolveId`/`load`, so a user alias or loader beats
// `aliasPlugin`/`externalsPlugin`. Transform order was collateral, never argued.
//
// WHY THIS FILE AND NOT AN E2E. `commands/affected-classify.ts` sets `run-e2e` only on a
// `tests/e2e/**` touch or a declared coupling, so an e2e-only gate would not run on a
// future `build.ts`-only PR — the exact PR that could reintroduce this.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rolldown } from 'rolldown';

import { gjsifyPlugin } from '@gjsify/rolldown-plugin-gjsify';

/**
 * A user plugin with the ONE property that produced the bug: a `'pre'` transform that
 * rewrites TypeScript syntax on a `.ts*` id.
 *
 * A regex stand-in for what `@babel/preset-typescript` does to `typeOf<T>()`, so the
 * CLI's test closure stays free of Babel. What it strips does not matter — only that it
 * strips before Deepkit reads.
 */
const stripTypeArgs = () => ({
    name: 'test-strip-type-args',
    transform: {
        order: 'pre' as const,
        handler: (code: string) => code.replace(/typeOf<[^>]*>\(\)/g, 'typeOf()'),
    },
});

const SOURCE = `import { typeOf } from '@deepkit/type';
interface Reflected { id: number; label: string }
export const reflected = typeOf<Reflected>();
`;

/** Bundle `SOURCE` with the user plugin composed at `place`. */
async function bundleWith(place: 'before-user' | 'after-user'): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'gjsify-reflection-order-'));
    try {
        const entry = join(dir, 'entry.ts');
        await writeFile(entry, SOURCE);
        const cfg = await gjsifyPlugin(
            { input: entry, output: { file: join(dir, 'out.mjs') } },
            {
                app: 'node',
                reflection: true,
            },
        );
        // `before-user` is EXACTLY the composition `BuildAction.buildApp` uses.
        const plugins =
            place === 'before-user'
                ? [...cfg.prePlugins, stripTypeArgs(), ...cfg.plugins]
                : [stripTypeArgs(), ...cfg.prePlugins, ...cfg.plugins];
        const bundle = await rolldown({ ...cfg.options, input: entry, external: ['@deepkit/type'], plugins });
        const { output } = await bundle.generate({ format: 'esm' });
        return output[0].code;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export default async () => {
    await describe('reflection survives a user pre-transform', async () => {
        await it('emits the reflection table when gjsify pre-plugins run first', async () => {
            // `__Ω<name>` is Deepkit's encoded type table. Its ABSENCE is the whole bug:
            // `typeOf()` with no argument throws `No type given` at runtime, and the
            // build that produced it exited 0.
            expect((await bundleWith('before-user')).includes('__ΩReflected')).toBe(true);
        });

        await it('loses it when a user transform gets there first', async () => {
            // The A/B, kept as a test rather than a comment: this is the composition
            // `main` had, and it is what makes the assertion above a gate instead of a
            // description. If a future edit empties `prePlugins`, the first case fails —
            // and if Deepkit stops depending on reading types first, this one does.
            expect((await bundleWith('after-user')).includes('__ΩReflected')).toBe(false);
        });

        await it('composes gjsify pre-plugins ahead of nothing else', async () => {
            // `prePlugins` is deliberately narrow: only transforms that must read the
            // original source. A grown list is the smell that the split is being used as
            // a general "run early" bucket, which would take back the resolveId/load
            // precedence user plugins are given on purpose.
            const cfg = await gjsifyPlugin(
                { input: 'x.ts', output: { file: 'y.mjs' } },
                {
                    app: 'node',
                    reflection: true,
                },
            );
            expect(cfg.prePlugins.length).toBe(1);
        });
    });
};
