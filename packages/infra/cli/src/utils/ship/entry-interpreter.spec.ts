// SPDX-License-Identifier: MIT
// The pair `gjsify ship` never compared: the interpreter a target execs and the
// entry it hands that interpreter (#1545).
//
// The evidence in every case below is a MODULE SCHEME, and the two refusals are
// symmetric because the two loaders are. Measured on GJS 1.86 and Node 24:
//
//     node   ← import … from 'gi://Gtk?version=4.0'
//              ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'gi:'
//     gjs    ← import … from 'node:fs'
//              ImportError: Unsupported URI scheme for importing: node
//
// So the `--app gjs` fixtures here are not a stand-in for a real bundle: they
// carry the one specifier that decides the case, which is the same thing a real
// bundle carries. What a real bundle adds is size.

import { describe, expect, it } from '@gjsify/unit';

import { assertEntryRunsUnder, entryEvidence } from './entry-interpreter.js';

const check = (interpreter: 'gjs' | 'node', source: string): (() => void) => {
    return () =>
        assertEntryRunsUnder({
            interpreter,
            source,
            entry: 'dist/app.gjs.mjs',
            appKey: 'gjsify.ship.app.darwin',
            bundleKey: 'gjsify.main',
            layoutOs: 'darwin',
        });
};

export default async () => {
    await describe('ship entry ↔ interpreter', async () => {
        await it('refuses a gjs bundle on a target that execs node', async () => {
            // The measured case: `gjsify.ship.app.darwin: "node"` with the payload
            // left on `gjsify.main`, which for a Linux-first project is its GJS
            // bundle. The artifact was built, reported as built, and died on its
            // first import.
            const source = 'import Gtk from "gi://Gtk?version=4.0";\nexport default Gtk;\n';
            expect(check('node', source)).toThrow('imports gi://Gtk?version=4.0');
            expect(check('node', source)).toThrow('ERR_UNSUPPORTED_ESM_URL_SCHEME');
            // The fix names the key that selects an entry PER TARGET, not the
            // project-wide one: sending the reader to `gjsify.main` would move
            // every other layout's payload with it.
            expect(check('node', source)).toThrow('gjsify.ship.bundle.darwin');
        });

        await it('refuses a node bundle on a target that execs gjs', async () => {
            const source = 'import { readFileSync } from "node:fs";\nexport default readFileSync;\n';
            expect(check('gjs', source)).toThrow('imports node:fs');
            expect(check('gjs', source)).toThrow('Unsupported URI scheme for importing: node');
        });

        await it('passes each bundle to the interpreter that can load it', async () => {
            expect(check('gjs', 'import Gtk from "gi://Gtk?version=4.0";\n')).not.toThrow();
            expect(check('node', 'import { readFileSync } from "node:fs";\n')).not.toThrow();
        });

        await it('passes a bundle that names neither scheme', async () => {
            // Absence of evidence is not evidence: a pure-JS CLI, or one whose GI
            // reach is all dynamic, has nothing here to contradict. Refusing it
            // would turn working packages into failures, which is the correction
            // `assertLauncherMatchesInterpreter` already carries.
            expect(check('node', 'export default 1 + 1;\n')).not.toThrow();
            expect(check('gjs', 'const m = await import(`gi://${ns}`);\n')).not.toThrow();
        });

        await it('reads the scheme only where a loader would', async () => {
            // A mention in a diagnostic string is not an import, and the whole
            // reason this is an acorn pass rather than a regex: over-approximating
            // here refuses a correct project.
            expect(check('node', 'throw new Error("gi://Nautilus is not supported");\n')).not.toThrow();
            expect(entryEvidence('const s = "node:fs";').node).toStrictEqual([]);
        });

        await it('reads the shapes a MINIFIED bundle emits', async () => {
            const minified = 'import e from"gi://Gtk?version=4.0";const n=await import(`gi://GLib?version=2.0`);';
            expect(entryEvidence(minified).gi).toStrictEqual(['gi://GLib?version=2.0', 'gi://Gtk?version=4.0']);
        });

        await it('names at most three specifiers, then counts the rest', async () => {
            // A bundle can import a dozen namespaces; a refusal that pastes all of
            // them buries the sentence that says what to do about it.
            const many = ['Gtk', 'Adw', 'Gio', 'GLib', 'Gdk'].map((ns) => `import ${ns} from "gi://${ns}";`).join('\n');
            expect(check('node', many)).toThrow('and 2 more');
        });
    });
};
