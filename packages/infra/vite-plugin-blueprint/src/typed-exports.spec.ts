// ADR 0087's derivation, held against the corpus and against the four facts that were MEASURED
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

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
    BlueprintEmitError,
    deriveExports,
    emitTypedModule,
    emitTypedSidecar,
    parseBlueprint,
} from '@gjsify/blueprint';
import { CORPUS_REAL_FILES } from '@gjsify/blueprint/corpus';
import { describe, expect, it } from '@gjsify/unit';

const blueprintDir = dirname(createRequire(import.meta.url).resolve('@gjsify/blueprint/package.json'));
const repoRoot = join(blueprintDir, '..', '..', '..');

const exportsOf = (source: string) => deriveExports(parseBlueprint(source, 'spec.blp'));

/** A `.blp` built in the test, so a property can be asserted on a construct no shipped file has. */
const derive = (body: string) => exportsOf(`using Gtk 4.0;\nusing Adw 1;\n${body}`);

export default async () => {
    await describe('typed exports (ADR 0087)', async () => {
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

        await it('gives a childless template neither InternalChildren nor Children', async () => {
            // `extends {}` constrains nothing and `InternalChildren: []` is a list
            // `registerClass` iterates zero times, so the absence is what says the template
            // declares no internal child. `toolbar-view.blp` is this file.
            const file = parseBlueprint('using Gtk 4.0;\ntemplate $Plain: Gtk.Box {\n  Gtk.Label { }\n}\n', 's.blp');
            const sidecar = emitTypedSidecar(file);
            expect(sidecar.includes("export declare const GTypeName: 'Plain';")).toBe(true);
            expect(sidecar.includes('InternalChildren')).toBe(false);
            expect(sidecar.includes('Children')).toBe(false);
            // And no `gi://` import either: nothing in the emitted text names a widget type.
            expect(sidecar.includes('gi://')).toBe(false);
            expect(emitTypedModule(file, '<interface/>').includes('InternalChildren')).toBe(false);
        });

        await it('exports no class for a template that names an existing type', async () => {
            // `template ListItem { }` compiles to `<template class="GtkListItem">` — the type
            // already exists, so there is no class to register and a `GTypeName` export would
            // hand `registerClass` a name to collide with.
            expect(derive('template ListItem {\n  child: Gtk.Label { };\n}').template).toBe(undefined);
        });

        await it('gives a template module no gi:// import and a builder module Gtk', async () => {
            const template = parseBlueprint('using Gtk 4.0;\ntemplate $Probe: Gtk.Box { }\n', 'spec.blp');
            const templateModule = emitTypedModule(template, '<interface/>');
            expect(templateModule.includes('gi://')).toBe(false);
            expect(templateModule.includes("export const GTypeName = 'Probe';")).toBe(true);

            // The builder exit needs Gtk for the Builder itself, and Adw ONLY to init it.
            const builder = parseBlueprint('using Gtk 4.0;\nusing Adw 1;\nAdw.Bin bin { }\n', 'spec.blp');
            const builderModule = emitTypedModule(builder, '<interface/>');
            expect(builderModule.includes("import Gtk from 'gi://Gtk?version=4.0';")).toBe(true);
            expect(builderModule.includes("import Adw from 'gi://Adw?version=1';")).toBe(true);
            expect(builderModule.includes('Adw.init();')).toBe(true);

            // No Adwaita in the file, no init and no import: a `.blp` that never names Adw must
            // not pull the typelib in to call something it does not need.
            const gtkOnly = emitTypedModule(parseBlueprint('using Gtk 4.0;\nGtk.Box bin { }\n', 'spec.blp'), '<i/>');
            expect(gtkOnly.includes('Adw')).toBe(false);
        });

        await it('quotes a dashed id as a key rather than renaming it', async () => {
            // `get_object` takes the id AS WRITTEN, so the key stays the id and the caller
            // reaches it with `built['download-button']`. Renaming it to a bare identifier would
            // put a second spelling of the id in the output for nothing to hold.
            const sidecar = emitTypedSidecar(parseBlueprint('using Gtk 4.0;\nGtk.Box a-b { }\n', 'spec.blp'));
            expect(sidecar.includes('"a-b": Gtk.Box;')).toBe(true);
        });
    });
};
