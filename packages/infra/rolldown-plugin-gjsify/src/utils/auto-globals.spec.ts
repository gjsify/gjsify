// SPDX-License-Identifier: MIT
// The byte-1 process stub must not reach a `--globals auto` ANALYSIS bundle
// (ADR 0081).
//
// `processStubPlugin` does not merely guard `process` — it ASSIGNS
// `globalThis.process` in `renderChunk`, i.e. it writes into the very output
// `detectFreeGlobals` parses. Composed into the analysis pass it therefore
// reported `process` as a free global on EVERY build, and `process` →
// `@gjsify/process` was injected unconditionally. Measured on an empty entry:
// a 140 KB bundle instead of ~3 KB.
//
// Pinned at three levels, because each catches a different regression: the
// banner is what the detector reads back (the TRAP — so a future "harmless"
// banner tweak cannot silently reopen it), `setupForGjs` honours the flag, and a
// real `detectAutoGlobals` run on a trivial entry detects no `process`.
//
// The FINAL build must keep the stub — `glob`/`path-scurry` read
// `process.platform` at top level during `__esm` lazy init — so the last test
// asserts it is still composed when the flag is absent.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processStubPlugin } from '../plugins/process-stub.js';
import { setupForGjs } from '../app/gjs.js';
import { gjsifyPlugin } from '../plugin.js';
import { detectFreeGlobals } from './detect-free-globals.js';
import { detectAutoGlobals } from './auto-globals.js';

/** An entry chunk that names no ambient global at all. */
const TRIVIAL_CHUNK = 'const answer = 42;\nexport { answer };\n';

/** The only chunk field `processStubPlugin`'s `renderChunk` reads. */
interface EntryChunk {
    isEntry: boolean;
}

/**
 * Run the plugin's own `renderChunk` over a chunk, as the bundler would. The
 * hook reads nothing off the plugin context and takes two chunk arguments this
 * test does not model, so it is called through a narrowed signature rather than
 * with four faked ones.
 */
function renderWithProcessStub(chunk: string): string {
    const rendered = processStubPlugin({ captureBundleUrl: true }).renderChunk;
    const handler = typeof rendered === 'function' ? rendered : rendered.handler;
    const out = (handler as unknown as (code: string, chunk: EntryChunk) => { code: string } | null).call(
        undefined,
        chunk,
        { isEntry: true },
    );
    return out?.code ?? chunk;
}

/** The orchestrator's factory: it receives the MERGED plugin options only. */
async function gjsFactory(pluginOptions: Parameters<typeof gjsifyPlugin>[1]) {
    const cfg = await gjsifyPlugin({ output: { file: 'out.gjs.mjs' } }, pluginOptions);
    return { options: cfg.options, plugins: cfg.plugins };
}

/** Plugin names the `--app gjs` composition carries, with falsy entries dropped. */
function pluginNames(plugins: readonly unknown[]): string[] {
    return plugins.filter((p): p is { name: string } => !!p && typeof p === 'object' && 'name' in p).map((p) => p.name);
}

export default async () => {
    await describe('byte-1 process stub vs the auto-globals detector', async () => {
        await it('is exactly what the detector would read back as a live global', async () => {
            // The trap, asserted directly. If this ever goes false the banner
            // stopped tripping the detector and ADR 0081's fix became a no-op
            // guard rather than a correction.
            const withStub = detectFreeGlobals(renderWithProcessStub(TRIVIAL_CHUNK));
            expect(withStub.has('process')).toBe(true);

            // And the control: the same chunk WITHOUT the banner is clean,
            // so the detection above is attributable to the stub alone.
            const withoutStub = detectFreeGlobals(TRIVIAL_CHUNK);
            expect(withoutStub.has('process')).toBe(false);
        });

        await it('drops the stub from the composition when asked, and only then', async () => {
            const base = { output: { file: 'out.gjs.mjs' } } as const;

            const withStub = await setupForGjs({ ...base, pluginOptions: {} });
            expect(pluginNames(withStub.plugins)).toContain('gjsify-process-stub');

            const withoutStub = await setupForGjs({
                ...base,
                pluginOptions: { skipProcessStub: true },
            });
            expect(pluginNames(withoutStub.plugins)).not.toContain('gjsify-process-stub');

            // Omitting the flag must keep the shipped behaviour: `glob` et al
            // read `process.platform` at top level before any import side
            // effect fires, so the final GJS bundle cannot lose the stub.
            expect(pluginNames(withoutStub.plugins).length).toBe(pluginNames(withStub.plugins).length - 1);
        });

        await it('detects no `process` for an entry that never mentions it', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-auto-globals-'));
            const entry = join(dir, 'main.js');
            writeFileSync(entry, 'export const answer = 42;\n');
            try {
                // The false positive reaches past a wrong SET entry: `process`
                // expands with the register closure, so the analysis build
                // starts importing `<pkg>/register/<feature>` subpaths a
                // one-line entry can never need. Where those subpaths resolve
                // the defect is a wrong entry in the detected set; where they do
                // not, the analysis build fails on the subpath it injected. Both
                // are this ONE defect, so both read as a failure. The runner
                // prints no values for a failed `toBe`, hence the naming here.
                let detectedProcess = false;
                try {
                    const { detected } = await detectAutoGlobals({ input: entry, format: 'esm' }, {}, gjsFactory);
                    detectedProcess = detected.has('process');
                } catch {
                    detectedProcess = true;
                }
                expect(detectedProcess).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
