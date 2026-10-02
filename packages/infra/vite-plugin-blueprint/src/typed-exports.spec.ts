// ADR 0088's derivation, held against the corpus and against the four facts that were MEASURED
// rather than reasoned.
//
// WHY THIS SPEC IS ONE PACKAGE OVER FROM THE CODE IT TESTS. `deriveExports` lives in
// `@gjsify/blueprint`, which has no build step on purpose (`src/index.mjs` § There is no build
// step) and therefore no bundled `src/test.mts` to register a spec with. This package is its
// first consumer, has `@gjsify/unit`, and already runs under Node. The alternative — a fourth
// gate script of its own — buys nothing the registration here does not.
//
// THE SWEEP IS THE CORPUS ARM. `CORPUS_REAL_FILES` is every `.blp` this repository ships, and
// the properties below are asserted over all of them rather than over a fixture: a derivation
// that holds on one hand-written file and throws on a real one is the failure that matters, and
// `scripts/check-blueprint-sidecars.mjs` would only find it after the sidecars were committed.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    BlueprintEmitError,
    deriveExports,
    emitTypedModule,
    emitTypedSidecar,
    parseBlueprint,
} from '@gjsify/blueprint';
import { emitFormatFor, emitFormatForTree } from '@gjsify/blueprint/oxfmt';
import { CORPUS_REAL_FILES } from '@gjsify/blueprint/corpus';
import { describe, expect, it } from '@gjsify/unit';

const blueprintDir = dirname(createRequire(import.meta.url).resolve('@gjsify/blueprint/package.json'));
const repoRoot = join(blueprintDir, '..', '..', '..');

/**
 * This repository's OWN emitter options, read the way `gjsify format` reads them.
 *
 * Not the constants: an assertion that spells `    _id: Gtk.Widget;` with four literal spaces is
 * an assertion about THIS repository's `.oxfmtrc.json`, and it stays green the day that file says
 * `tabWidth: 2` while the emitter has done something else — which is exactly the drift ADR 0088
 * records, where the emitter's hardcoded 4-space indent agreed with `oxfmt --check` here and with
 * nothing else. Building the expectation from the resolved format makes the assertion about the
 * MAPPING; `scripts/check-blueprint-sidecar-format.mjs` is what holds the mapping to the engine.
 */
const repoFormat = emitFormatForTree(repoRoot);

const exportsOf = (source: string) => deriveExports(parseBlueprint(source, 'spec.blp'));

/** A `.blp` built in the test, so a property can be asserted on a construct no shipped file has. */
const derive = (body: string) => exportsOf(`using Gtk 4.0;\nusing Adw 1;\n${body}`);

export default async () => {
    await describe('typed exports (ADR 0088)', async () => {
        await it('derives ids, types and the template class from every shipped .blp', async () => {
            // The whole corpus, because the parse and the derivation are both total over it:
            // anything that throws here is a construct the derivation does not hold, named.
            for (const { source } of CORPUS_REAL_FILES) {
                const file = join(repoRoot, source);
                const derived = deriveExports(parseBlueprint(readFileSync(file, 'utf8'), file));
                // A file is one shape or the other, never both: a template's ids are internal
                // children and reached through `_name`, a builder's are reached through
                // `get_object`. Exporting both would give one id two meanings.
                if (derived.template !== undefined) expect(derived.objects.length).toBe(0);
                for (const one of [...derived.objects, ...(derived.template?.children ?? [])]) {
                    // Namespace-qualified, always — an unqualified `Box` is a Gtk type and a
                    // bare `Box` in a sidecar resolves to nothing.
                    expect(one.type.includes('.')).toBe(true);
                    expect(one.type.startsWith(`${one.namespace}.`)).toBe(true);
                }
            }
        });

        await it('spells an internal child the way GJS installs it', async () => {
            // MEASURED on gjs 1.88.1: `InternalChildren: ['download-button']` installs
            // `this._download_button`. Both `_downloadButton` and `_download-button` read
            // `undefined`, so the dash transform is the only one and camel-casing is wrong.
            const derived = derive('template $Probe: Adw.Bin {\n  child: Gtk.Button download-button { };\n}');
            expect(derived.template?.GTypeName).toBe('Probe');
            expect(derived.template?.children.map((one) => one.id)).toStrictEqual(['download-button']);
            expect(derived.template?.children.map((one) => one.member)).toStrictEqual(['_download_button']);
            expect(derived.template?.children[0]?.type).toBe('Gtk.Button');
        });

        await it('types a menu id as Gio.Menu, root and named section alike', async () => {
            // MEASURED: `builder.get_object` answers `GMenu` for a top-level `menu` AND for a
            // named `section` inside it, so both are exported and both carry the same type.
            const derived = derive('menu mainMenu {\n  section firstSection {\n    item ("Hi", "app.hi")\n  }\n}');
            expect(derived.objects.map((one) => one.id)).toStrictEqual(['mainMenu', 'firstSection']);
            for (const one of derived.objects) expect(one.type).toBe('Gio.Menu');
        });

        await it('types an extern as GObject.Object, because it names no GIR type', async () => {
            // A `$Name` type is registered by the application at run time — `ast.d.mts`
            // § TypeRef.extern — so there is nothing to spell and narrowing stays the caller's.
            const derived = derive('$CustomThing custom { }');
            expect(derived.objects.map((one) => one.type)).toStrictEqual(['GObject.Object']);
            expect(derived.objects.map((one) => one.namespace)).toStrictEqual(['GObject']);
        });

        await it('does not export an id from an inline template, which is a second document', async () => {
            // `ast.d.mts` § InlineTemplateNode: a `Gtk.BuilderListItemFactory`'s template becomes
            // its own GtkBuilder document, CDATA-escaped into a property, with its own id scope —
            // "may not reference objects in the main blueprint or vice versa". Exporting an id
            // from it would hand out a name whose `get_object` reads null.
            const derived = derive(
                'Gtk.ListView outer {\n  factory: Gtk.BuilderListItemFactory {\n' +
                    '    template Gtk.ListItem {\n      child: Gtk.Label innerLabel { };\n    }\n  };\n}',
            );
            expect(derived.objects.map((one) => one.id)).toStrictEqual(['outer']);
        });

        await it('refuses an id that collides with the builder it is returned beside', async () => {
            let thrown: unknown;
            try {
                derive('Gtk.Box builder { }');
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof BlueprintEmitError).toBe(true);
            expect((thrown as BlueprintEmitError).message.includes('collides with the Gtk.Builder')).toBe(true);
        });

        await it('refuses two ids that would become one name in the emitted text', async () => {
            // NOTHING UPSTREAM CATCHES THIS. Measured: the parser accepts a repeated id and the
            // XML emitter writes both `id="same"` through — GtkBuilder's answer is last-one-wins
            // at run time, not a refusal. The emitted TEXT has no such tolerance, so without this
            // the first reader is `tsc` on a GENERATED file, pointing at a line in a sidecar
            // nobody wrote. Three shapes, because the two exits name things differently.
            const refusalFor = (body: string): BlueprintEmitError => {
                let thrown: unknown;
                try {
                    derive(body);
                } catch (error) {
                    thrown = error;
                }
                expect(thrown instanceof BlueprintEmitError).toBe(true);
                return thrown as BlueprintEmitError;
            };

            // A template's children collide on the MEMBER: two `_same` in one `Children` is
            // TS2300 "Duplicate identifier".
            expect(
                refusalFor('template $C: Gtk.Box {\n  Gtk.Label same { }\n  Gtk.Button same { }\n}').message.includes(
                    'two internal children are both named "same"',
                ),
            ).toBe(true);

            // And the case the member transform CREATES out of two ids that are distinct in the
            // source: `a-b` and `a_b` are different `get_object` names and one `_a_b` member.
            // The refusal names both spellings, because the `.blp` has no second `a_b` to find.
            const transformed = refusalFor('template $C: Gtk.Box {\n  Gtk.Label a-b { }\n  Gtk.Button a_b { }\n}');
            expect(transformed.message.includes('"a-b"') && transformed.message.includes('"a_b"')).toBe(true);
            expect(transformed.message.includes('_a_b')).toBe(true);

            // A builder file collides on the ID: `build()` keys its result by the id verbatim, so
            // the object literal would silently drop all but the last.
            expect(
                refusalFor('Gtk.Box same { }\nGtk.Button same { }').message.includes('two objects are both named'),
            ).toBe(true);

            // The line is the SECOND occurrence — where the reader has to change something.
            expect(refusalFor('Gtk.Box same { }\nGtk.Button same { }').line).toBe(4);
        });

        await it('gives a childless template neither InternalChildren nor Children', async () => {
            // `extends {}` constrains nothing and `InternalChildren: []` is a list
            // `registerClass` iterates zero times, so the absence is what says the template
            // declares no internal child. `toolbar-view.blp` is this file.
            const file = parseBlueprint('using Gtk 4.0;\ntemplate $Plain: Gtk.Box {\n  Gtk.Label { }\n}\n', 's.blp');
            const sidecar = emitTypedSidecar(file, 's.blp', repoFormat);
            expect(
                sidecar.includes(
                    `export declare const GTypeName: ${repoFormat.quote}Plain${repoFormat.quote}${repoFormat.semi}`,
                ),
            ).toBe(true);
            expect(sidecar.includes('InternalChildren')).toBe(false);
            expect(sidecar.includes('Children')).toBe(false);
            // And no `gi://` import either: nothing in the emitted text names a widget type.
            expect(sidecar.includes('gi://')).toBe(false);
            expect(emitTypedModule(file, '<interface/>', repoFormat).includes('InternalChildren')).toBe(false);
        });

        await it('exports no class for a template that names an existing type', async () => {
            // `template ListItem { }` compiles to `<template class="GtkListItem">` — the type
            // already exists, so there is no class to register and a `GTypeName` export would
            // hand `registerClass` a name to collide with.
            expect(derive('template ListItem {\n  child: Gtk.Label { };\n}').template).toBe(undefined);
        });

        await it('gives a template module no gi:// import and a builder module Gtk', async () => {
            const template = parseBlueprint('using Gtk 4.0;\ntemplate $Probe: Gtk.Box { }\n', 'spec.blp');
            const templateModule = emitTypedModule(template, '<interface/>', repoFormat);
            expect(templateModule.includes('gi://')).toBe(false);
            expect(
                templateModule.includes(
                    `export const GTypeName = ${repoFormat.quote}Probe${repoFormat.quote}${repoFormat.semi}`,
                ),
            ).toBe(true);

            // The builder exit needs Gtk for the Builder itself, and Adw ONLY to init it.
            const builder = parseBlueprint('using Gtk 4.0;\nusing Adw 1;\nAdw.Bin bin { }\n', 'spec.blp');
            const builderModule = emitTypedModule(builder, '<interface/>', repoFormat);
            expect(builderModule.includes("import Gtk from 'gi://Gtk?version=4.0';")).toBe(true);
            expect(builderModule.includes("import Adw from 'gi://Adw?version=1';")).toBe(true);
            expect(builderModule.includes('Adw.init();')).toBe(true);

            // No Adwaita in the file, no init and no import: a `.blp` that never names Adw must
            // not pull the typelib in to call something it does not need.
            const gtkOnly = emitTypedModule(
                parseBlueprint('using Gtk 4.0;\nGtk.Box bin { }\n', 'spec.blp'),
                '<i/>',
                repoFormat,
            );
            expect(gtkOnly.includes('Adw')).toBe(false);
        });

        await it('quotes a dashed id as a key rather than renaming it', async () => {
            // `get_object` takes the id AS WRITTEN, so the key stays the id and the caller
            // reaches it with `built['download-button']`. Renaming it to a bare identifier would
            // put a second spelling of the id in the output for nothing to hold.
            const sidecar = emitTypedSidecar(
                parseBlueprint('using Gtk 4.0;\nGtk.Box a-b { }\n', 'spec.blp'),
                'a.blp',
                repoFormat,
            );
            expect(sidecar.includes(`${repoFormat.quote}a-b${repoFormat.quote}: Gtk.Box${repoFormat.semi}`)).toBe(true);
        });

        await it('names the .blp in the header from the caller, and never a path', async () => {
            // The header is the one place a name is needed, and the emitter cannot work one out:
            // it has no build step (so no `@gjsify/utils/core`) and is bundled into the GJS CLI.
            // MEASURED on the win32 shape this replaces: `path.lastIndexOf('/')` on
            // `C:\app\header-bar.blp` answers -1, so the header read `// GENERATED from
            // C:\app\header-bar.blp` — a committed sidecar whose provenance is a machine's
            // directory layout, and different on every developer. The caller passes the name.
            const file = parseBlueprint('using Gtk 4.0;\nGtk.Box bin { }\n', 'C:\\app\\header-bar.blp');
            const sidecar = emitTypedSidecar(file, 'header-bar.blp', repoFormat);
            expect(sidecar.startsWith('// GENERATED from header-bar.blp — do not edit.')).toBe(true);
            expect(sidecar.includes('C:')).toBe(false);
        });

        await it('writes InternalChildren the way the repository formatter would', async () => {
            // `gjsify format --check` runs over this tree, and a committed sidecar is in it, so a
            // sidecar the formatter would reflow makes `Whole-tree checks` red on a file nobody
            // edited. oxfmt's rule is the WIDTH (`.oxfmtrc.json` `printWidth`), so both arms are
            // asserted: packed while the line fits, one id per line once it does not. Eight ids
            // is what first broke it, in showcases/dom/three-postprocessing-pixel.
            const template = (ids: string[]) =>
                `using Gtk 4.0;\ntemplate $Wide: Gtk.Box {\n${ids.map((id) => `  Gtk.Label ${id} { }`).join('\n')}\n}\n`;
            const few = ['oneId', 'twoId', 'threeId'];
            const many = [
                'sidebarToggleButton',
                'pauseButton',
                'splitView',
                'pixelSizeRow',
                'normalEdgeRow',
                'depthEdgeRow',
                'pixelAlignRow',
                'glAreaContainer',
            ];
            // The whole declaration: one line while it is packed, down to the lone `]` once it is
            // not — which is the only way to read the reflowed form back out of the text. Every
            // quote, terminator, indent and line break in the two expectations below comes from
            // `repoFormat`, so this reads the project's `.oxfmtrc` rather than assuming four
            // spaces and a `;` happen to be what it says.
            const quote = repoFormat.quote;
            const close = `]${repoFormat.semi}`;
            const declaration = (source: string) => {
                const lines = emitTypedSidecar(parseBlueprint(source, 'wide.blp'), 'wide.blp', repoFormat).split(
                    repoFormat.eol,
                );
                const first = lines.findIndex((line) => line.startsWith('export declare const InternalChildren:'));
                const last = lines.findIndex((line, index) => index > first && line === close);
                return lines.slice(first, last === -1 ? first + 1 : last + 1).join(repoFormat.eol);
            };

            expect(declaration(template(few))).toBe(
                `export declare const InternalChildren: [${few.map((id) => `${quote}${id}${quote}`).join(', ')}]${
                    repoFormat.semi
                }`,
            );
            expect(declaration(template(many))).toBe(
                [
                    'export declare const InternalChildren: [',
                    ...many.map((id) => `${repoFormat.indent}${quote}${id}${quote},`),
                    close,
                ].join(repoFormat.eol),
            );
            // And the property that makes it a gate rather than a sample: whatever a `.blp`
            // declares, no emitted sidecar carries a line the formatter would break. The bound is
            // the resolved `printWidth`, not the 120 this repository happens to set.
            for (const { source } of CORPUS_REAL_FILES) {
                const file = join(repoRoot, source);
                const text = emitTypedSidecar(
                    parseBlueprint(readFileSync(file, 'utf8'), file),
                    'corpus.blp',
                    repoFormat,
                );
                for (const line of text.split(repoFormat.eol)) {
                    expect(line.length).toBeLessThanOrEqual(repoFormat.printWidth);
                }
            }
        });
        await it('writes a sidecar in the PROJECT indent, not a hardcoded one', async () => {
            // THE BUG, in one test. The emitter read `.oxfmtrc.json#printWidth` into a constant
            // and hardcoded a FOUR-SPACE indent beside it. Both are this repository's values, so
            // every committed sidecar and every `oxfmt --check` run here agreed and the emitter
            // looked right; a `tabWidth: 2` consumer (kurier, Learn6502) got a sidecar the
            // formatter reflowed on sight, and the red was on a file nobody hand-wrote. The
            // emitter had no way to find out, because the only formatter it had ever met was the
            // one its constants were copied from.
            //
            // So both arms, and the second is the one that matters: the format is a REQUIRED
            // argument, and a caller that forgets is TOLD rather than handed a default — a
            // default would restore exactly that shape one layer down.
            const file = parseBlueprint(
                'using Gtk 4.0;\ntemplate $Two: Gtk.Box {\n  Gtk.Label firstId { }\n}\n',
                's.blp',
            );

            const narrow = emitFormatFor({ tabWidth: 2 });
            const member = `_firstId: Gtk.Label`;
            expect(emitTypedSidecar(file, 's.blp', narrow)).toContain(`\n  ${member}${narrow.semi}\n`);

            const tabbed = emitFormatFor({ useTabs: true });
            expect(emitTypedSidecar(file, 's.blp', tabbed)).toContain(`\n\t${member}${tabbed.semi}\n`);

            // And the repo's own value, so this test also fails if the emitter ever stops
            // believing the argument it is handed.
            expect(emitTypedSidecar(file, 's.blp', repoFormat)).toContain(
                `\n${repoFormat.indent}${member}${repoFormat.semi}\n`,
            );

            // And the reflowed tuple indents with the project too — that was the second hardcoded
            // four, one line below.
            const wide = `using Gtk 4.0;\ntemplate $Wide: Gtk.Box {\n${['oneId', 'twoId', 'threeId', 'fourId', 'fiveId', 'sixId', 'sevenId', 'eightId', 'nineId', 'tenId', 'elevenId', 'twelveId'].map((id) => `  Gtk.Label ${id} { }`).join('\n')}\n}\n`;
            const reflowed = emitTypedSidecar(parseBlueprint(wide, 'w.blp'), 'w.blp', narrow);
            expect(reflowed).toContain(`\n  ${narrow.quote}oneId${narrow.quote},`);

            // The refusal: a missing argument is an error naming what to pass, never a guess.
            let refusal = '';
            try {
                emitTypedSidecar(file, 's.blp', undefined as never);
            } catch (error) {
                refusal = (error as Error).message;
            }
            expect(refusal.includes('emitFormatFor')).toBe(true);
        });

        await it('answers the formatter config the way gjsify format resolves it', async () => {
            // The WALK, not the mapping: the emitter is only right if it reads the SAME file the
            // formatter reads. `gjsify format` walks `.oxfmtrc` then `.oxfmtrc.json`, up to 12
            // levels; a sidecar written against any other file is one that formatter reflows, so
            // this is a parameter of the emitter's correctness rather than a convenience.
            //
            // MEASURED in a temp tree rather than asserted from the implementation: the directory
            // the walk starts in is walked UP, which is what makes a package with its own
            // `.oxfmtrc.json` inside a monorepo get its own indent.
            const temp = mkdtempSync(join(tmpdir(), 'gjsify-oxfmt-'));
            try {
                const nested = join(temp, 'packages', 'demo');
                mkdirSync(nested, { recursive: true });
                writeFileSync(
                    join(nested, '.oxfmtrc.json'),
                    '{\n  // a comment, and a trailing comma, as a real config carries\n  "tabWidth": 2,\n  "singleQuote": true,\n}\n',
                );
                const walked = emitFormatForTree(nested);
                expect(walked.indent).toBe('  ');
                // The file is JSONC and says so: `//` inside a value is a comment, `"https://…"`
                // inside a string is not, and the trailing comma is dropped. MEASURED, because
                // this repository's own `.oxfmtrc.json` is a commented file that `JSON.parse`
                // refuses — a parser that only read strict JSON would fail on the config it was
                // written for.
                expect(walked.quote).toBe("'");

                // NEAREST wins, which is the property that makes a monorepo correct: the tree
                // root says 4, the package says 2, and a `.blp` in the package gets the package's
                // indent. The wrong direction here — a nearest that loses to a root — is a
                // sidecar the consumer's own `gjsify format --check` reflows.
                const deeper = join(nested, 'src');
                mkdirSync(deeper, { recursive: true });
                expect(emitFormatForTree(deeper).indent).toBe('  ');
                writeFileSync(join(deeper, '.oxfmtrc'), '{ "tabWidth": 8 }');
                expect(emitFormatForTree(deeper).indent).toBe('        ');
                // No config anywhere above is oxfmt's OWN default, not this repository's.
                const bare = mkdtempSync(join(tmpdir(), 'gjsify-oxfmt-bare-'));
                try {
                    expect(emitFormatForTree(bare).indent).toBe('  ');
                } finally {
                    rmSync(bare, { recursive: true, force: true });
                }
            } finally {
                rmSync(temp, { recursive: true, force: true });
            }
        });

        await it('quotes a dashed id in the project quote, with the other keys beside it', async () => {
            // Two properties, both measured against the engine by
            // `scripts/check-blueprint-sidecar-format.mjs` under every option:
            //
            // `quoteProps: 'consistent'` is the option that surprises. It is NOT "quote every
            // key" and NOT "quote none": ONE quoted key pulls every other key in the same object
            // along, so a `.blp` declaring both a dashed id and a plain one emits
            // `Built { 'a-b': …; 'plain': … }` under `consistent` and `Built { 'a-b': …; plain: … }`
            // under `as-needed`. Getting that backwards is a red `oxfmt --check`.
            const dashed = parseBlueprint('using Gtk 4.0;\nGtk.Box a-b { }\nGtk.Button plain { }\n', 'spec.blp');

            const asNeeded = emitFormatFor({ quoteProps: 'as-needed', singleQuote: true });
            expect(emitTypedSidecar(dashed, 's.blp', asNeeded)).toContain(`'a-b': Gtk.Box${asNeeded.semi}\n  plain: `);

            const consistent = emitFormatFor({ quoteProps: 'consistent', singleQuote: true });
            expect(emitTypedSidecar(dashed, 's.blp', consistent)).toContain(
                `'a-b': Gtk.Box${consistent.semi}\n  'plain': `,
            );
        });
    });
};
