// What the corpus gate structurally cannot see: this plugin's WIRING.
//
// `scripts/check-blueprint-corpus.mjs` holds `@gjsify/blueprint` over every tracked `.blp`, and
// it hands in its own five seams. So it proves the parser and the emitter and says nothing about
// the file you are reading — whether `load()` reads the source at all, whether it hands over the
// seams it has, whether what comes back is the module a bundler can consume. Every one of those
// can be wrong with the gate green, and after ADR 0053 clause 5's flip this plugin is the only
// thing between a `.blp` and a shipped widget.
//
// ONE FILE, AND IT IS NOT A SECOND CORPUS. Every real `.blp` this repo builds is byte-compared
// against the reference compiler's goldens one directory over, on every run; re-comparing them
// here would be a parallel mechanism measuring what already has one. What is measured here is
// the join: the plugin's own output against the golden of a file whose bytes MOVE when the
// wiring is wrong — `orientation: vertical` is `1` only through `resolveIdent`, and
// `Gtk.ApplicationWindow` is `GtkApplicationWindow` only through `gtypeName`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BlueprintEmitError, BlueprintSyntaxError } from '@gjsify/blueprint';
import { CORPUS_REFUSALS } from '@gjsify/blueprint/corpus';
import { describe, expect, it } from '@gjsify/unit';
import type { Plugin } from 'vite';
import blueprintPlugin from './index.js';

/** The `@gjsify/blueprint` package directory, resolved through the specifier rather than a `../`
 * count: this file is bundled before it runs, so a relative walk would be counted from the
 * outfile and not from here. */
const blueprintDir = dirname(createRequire(import.meta.url).resolve('@gjsify/blueprint/package.json'));
const repoRoot = join(blueprintDir, '..', '..', '..');

/**
 * Which line a refusal file reaches its construct on, asked of the corpus rather than written here.
 *
 * Two copies of a line number is one too many, and the second one was already wrong: the `@girs`
 * 5.3.0 bump moved `refused/namespace-without-vocabulary.blp` from `Gio.ListStore` — a namespace
 * that has a vocabulary now — to `GdkPixbuf.Pixbuf`, four lines shorter, and the corpus gate stayed
 * green while this file failed on a number nothing had told it about. The manifest is the table;
 * this reads it.
 */
const refusalLine = (file: string): number => {
    const entry = CORPUS_REFUSALS.find((refusal) => refusal.file === file);
    if (!entry) throw new Error(`corpus/refused/${file} is in no CORPUS_REFUSALS entry`);
    return entry.line;
};

/** The plugin's `load` hook, as a plain callable. Nothing in it reads the Rollup context. */
const loadOf = (plugin: Plugin) => {
    const hook = plugin.load;
    if (typeof hook !== 'function') throw new Error('the plugin no longer exposes `load` as a function');
    return (id: string) => Promise.resolve(hook.call({} as never, id, {} as never));
};

export default async () => {
    await describe('vite-plugin-blueprint', async () => {
        await it('compiles a real .blp to the bytes the reference compiler wrote', async () => {
            const source = join(repoRoot, 'templates/gtk-minimal/src/main-window.blp');
            const golden = readFileSync(
                join(blueprintDir, 'corpus/real/templates_gtk-minimal_src_main-window.ui'),
                'utf8',
            );

            const loaded = await loadOf(blueprintPlugin())(source);

            expect(loaded).toBe(`export default ${JSON.stringify(golden)};`);
        });

        await it('leaves a file that is not a .blp to the next plugin', async () => {
            expect(await loadOf(blueprintPlugin())(join(repoRoot, 'package.json'))).toBe(undefined);
        });

        await it('refuses a construct outside the subset, naming the file and the line', async () => {
            // ADR 0053 clause 3, through the exit a build actually takes. The file is one the
            // reference compiler COMPILES, so this is the behaviour change the flip makes
            // user-visible, and the error has to be one a reader can act on.
            const file = 'namespace-without-vocabulary.blp';
            const line = refusalLine(file);
            const source = join(blueprintDir, `corpus/refused/${file}`);
            let thrown: unknown;
            try {
                await loadOf(blueprintPlugin())(source);
            } catch (error) {
                thrown = error;
            }

            expect(thrown instanceof BlueprintEmitError).toBe(true);
            const refusal = thrown as BlueprintEmitError;
            expect(refusal.file).toBe(source);
            expect(refusal.line).toBe(line);
            expect(refusal.message.includes('no vocabulary for')).toBe(true);
            // The FILE, not just the line: this plugin is the first thing to put these messages
            // in front of someone with twelve `.blp` open, and a bare line number names none of
            // them.
            expect(refusal.message.startsWith(`${source}:${line}: `)).toBe(true);
        });

        await it('refuses a syntax error the same way, before an AST exists', async () => {
            const source = join(blueprintDir, 'corpus/refused/bad-escape.blp');
            let thrown: unknown;
            try {
                await loadOf(blueprintPlugin())(source);
            } catch (error) {
                thrown = error;
            }

            expect(thrown instanceof BlueprintSyntaxError).toBe(true);
            const refusal = thrown as BlueprintSyntaxError;
            expect(refusal.file).toBe(source);
            expect(refusal.line).toBe(refusalLine('bad-escape.blp'));
            expect(refusal.message.startsWith(`${source}:${refusalLine('bad-escape.blp')}:13: `)).toBe(true);
        });
    });
};
