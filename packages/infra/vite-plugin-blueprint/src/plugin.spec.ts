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
import {
    BlueprintEmitError,
    BlueprintSyntaxError,
    gtypeName,
    parseBlueprint,
    projectToSharedNode,
} from '@gjsify/blueprint';
import { CORPUS_REFUSALS } from '@gjsify/blueprint/corpus';
import { describe, expect, it } from '@gjsify/unit';
import type { Plugin } from 'vite';
import blueprintPlugin, { BlueprintProjectionError } from './index.js';

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

/**
 * The plugin's `resolveId` hook over a context whose `resolve` is the identity.
 *
 * `resolveId` DOES read the Rollup context — `this.resolve` — which is the whole reason it
 * exists: the default resolver stats the specifier and there is no file named
 * `main-window.blp?shared-tree`. A stub is enough to hold what this plugin decides: that the
 * query is stripped before the path is handed on, and put back on the id that comes out.
 * Whether the bundler's own resolver then finds the file is the bundler's business.
 */
const resolveIdOf = (plugin: Plugin) => {
    const hook = plugin.resolveId;
    if (typeof hook !== 'function') throw new Error('the plugin no longer exposes `resolveId` as a function');
    const context = { resolve: (source: string) => Promise.resolve({ id: `/resolved${source}` }) };
    return (source: string) => Promise.resolve(hook.call(context as never, source, undefined, {} as never));
};

/**
 * What the projection makes of one `.blp`, asked of `@gjsify/blueprint` rather than written here.
 *
 * The package IS the oracle for this exit — stage D of `check-blueprint-corpus.mjs` holds it
 * against the reference compiler's goldens on every run — so a tree transcribed into this file
 * would be a second opinion with nothing behind it, and a loss line copied here would go stale
 * the way the refusal line above already did once.
 */
const projectionOf = (file: string) =>
    projectToSharedNode(parseBlueprint(readFileSync(file, 'utf8'), file), { gtypeName });

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

        await it('serves the authored tree under ?shared-tree, and the same file still serves XML', async () => {
            // THE TWO EXITS ON ONE FILE, in one test, because the property that matters is not
            // that either works — it is that asking for one does not move the other. ADR 0066 §
            // The XML exit does not move made that checkable at the emitter; this is the same
            // property at the build seam, where a target-controlled emit mode would have broken
            // it invisibly.
            const source = join(repoRoot, 'showcases/gtk/effect-adw-services/src/window.blp');
            const golden = readFileSync(
                join(blueprintDir, 'corpus/real/showcases_gtk_effect-adw-services_src_window.ui'),
                'utf8',
            );
            const plugin = blueprintPlugin();

            expect(await loadOf(plugin)(source)).toBe(`export default ${JSON.stringify(golden)};`);
            expect(await loadOf(plugin)(`${source}?shared-tree`)).toBe(
                `export default ${JSON.stringify(projectionOf(source).node)};`,
            );
        });

        await it('refuses a lossy .blp as a shared tree, and compiles the same file to XML', async () => {
            // The pairing is the point. `templates/gtk-minimal/src/main-window.blp` is the file
            // the first test in this suite byte-compares against the reference compiler, and it
            // drops a `styles` block on the way to a node. So: GTK path green, shared-tree path
            // refused, one file, one run. A build that emitted the tree anyway would render a
            // window whose styling is simply absent, on a target where nothing else can notice.
            const source = join(repoRoot, 'templates/gtk-minimal/src/main-window.blp');
            const { lost } = projectionOf(source);
            expect(lost.length > 0).toBe(true);

            let thrown: unknown;
            try {
                await loadOf(blueprintPlugin())(`${source}?shared-tree`);
            } catch (error) {
                thrown = error;
            }

            expect(thrown instanceof BlueprintProjectionError).toBe(true);
            const refusal = thrown as BlueprintProjectionError;
            expect(refusal.file).toBe(source);
            expect(refusal.lost.length).toBe(lost.length);
            // The message carries what a reader has to act on: the file, every loss KIND, and
            // the line each sits on. Asserted off the projection, so a new loss kind on this
            // file fails here rather than quietly narrowing what the refusal says.
            for (const loss of lost) {
                expect(refusal.message.includes(`${loss.kind} at ${source}:${loss.line}`)).toBe(true);
            }

            expect(typeof (await loadOf(blueprintPlugin())(source))).toBe('string');
        });

        await it('resolves the query by stripping it and putting it back', async () => {
            const resolve = resolveIdOf(blueprintPlugin());
            expect(await resolve('./main-window.blp?shared-tree')).toBe('/resolved./main-window.blp?shared-tree');
            // Everything else stays the bundler's: a bare `.blp` already resolves, and a query
            // on a file that is not one is not this plugin's.
            expect(await resolve('./main-window.blp')).toBe(null);
            expect(await resolve('./theme.css?shared-tree')).toBe(null);
        });
    });
};
