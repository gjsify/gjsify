#!/usr/bin/env node
// Write the two platform-member ledgers `scripts/check-gtk-host-member-clashes.mjs` reads:
//
//   status/nativescript-base-members.json — every member each `@nativescript/core` class
//     declares, inherited ones included, read off an INSTALLED copy's own typings (`--core`).
//   status/html-element-members.json — every member of `HTMLElement`, read off the
//     workspace TypeScript's `lib.dom.d.ts`.
//
// The check intersects these with the GIR properties of every port class. They are snapshots
// rather than live reads for the reason `status/nativescript-undefined-defaults.json` is a
// ledger: `@nativescript/core` is an OPTIONAL peer, absent from the workspace install by
// design, and the audit job that runs the check has no install at all — a check that needed
// either would be a check that never runs. Each snapshot carries the version it was read from;
// regenerate it when the peer range or TypeScript moves.
//
// The member lists come from the TypeScript checker (`getPropertiesOfType` on the instance
// type), so inheritance, accessors and mixins resolve exactly as a consumer's compiler
// resolves them — no hand list, no regex over `.d.ts`.
//
// Usage: node scripts/generate-nativescript-member-snapshot.mjs [--core <path to @nativescript/core>]
//   Without `--core` only the HTMLElement ledger is rewritten.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS_OUT = join(ROOT, 'status/nativescript-base-members.json');
const DOM_OUT = join(ROOT, 'status/html-element-members.json');

/** The classes a port widget can extend, plus the bases between them and `Observable`. */
export const NS_CLASSES = [
    'Observable',
    'ViewBase',
    'View',
    'LayoutBase',
    'GridLayout',
    'StackLayout',
    'FlexboxLayout',
    'AbsoluteLayout',
    'DockLayout',
    'WrapLayout',
    'ContentView',
    'ScrollView',
    'Button',
    'Label',
    'Image',
    'TextField',
    'TextView',
];

/** Public member names of `type`; `_` members are left out, no GIR property starts with one. */
const membersOf = (checker, type) =>
    checker
        .getPropertiesOfType(type)
        .map((member) => member.name)
        .filter((member) => !member.startsWith('_') && !member.startsWith('__@'))
        .sort();

const write = (path, comment, body) => {
    writeFileSync(path, `${JSON.stringify({ $comment: comment, ...body }, null, 4)}\n`);
};

function nativeScript(core) {
    const version = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).version;
    const entry = join(core, 'index.d.ts');
    const program = ts.createProgram([entry], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        noEmit: true,
        types: [],
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    if (source === undefined) throw new Error(`${entry} is not readable`);
    const exports = new Map(
        checker.getExportsOfModule(checker.getSymbolAtLocation(source)).map((symbol) => [symbol.name, symbol]),
    );
    const classes = {};
    const missing = [];
    for (const name of NS_CLASSES) {
        let symbol = exports.get(name);
        if (symbol === undefined) {
            missing.push(name);
            continue;
        }
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        classes[name] = membersOf(checker, checker.getDeclaredTypeOfSymbol(symbol));
    }
    if (missing.length > 0) throw new Error(`@nativescript/core ${version} exports no ${missing.join(', ')}`);
    write(
        NS_OUT,
        [
            'Every public member each @nativescript/core class declares, inherited ones included.',
            'Written by scripts/generate-nativescript-member-snapshot.mjs from the installed typings;',
            'read by scripts/check-gtk-host-member-clashes.mjs. Do not edit by hand — regenerate.',
            'Members starting with `_` are left out: no GIR property name starts with one.',
        ],
        { package: '@nativescript/core', version, classes },
    );
    console.log(`wrote ${NS_OUT} — ${Object.keys(classes).length} classes from @nativescript/core ${version}`);
}

function htmlElement() {
    const probe = 'html-element-probe.ts';
    const options = {
        target: ts.ScriptTarget.ES2022,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        noEmit: true,
        types: [],
    };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile;
    host.getSourceFile = (file, language) =>
        file === probe ? ts.createSourceFile(file, 'export type Probe = HTMLElement;', language) : read(file, language);
    const program = ts.createProgram([probe], options, host);
    const checker = program.getTypeChecker();
    const alias = program.getSourceFile(probe).statements[0];
    const members = membersOf(checker, checker.getTypeAtLocation(alias.name));
    write(
        DOM_OUT,
        [
            'Every public member of HTMLElement, inherited ones included (Element, Node, EventTarget, mixins).',
            "Written by scripts/generate-nativescript-member-snapshot.mjs from the workspace TypeScript's",
            'lib.dom.d.ts; read by scripts/check-gtk-host-member-clashes.mjs. Do not edit by hand.',
        ],
        { package: 'typescript', version: ts.version, members },
    );
    console.log(`wrote ${DOM_OUT} — ${members.length} HTMLElement members from typescript ${ts.version}`);
}

const args = process.argv.slice(2);
const coreFlag = args.indexOf('--core');
if (coreFlag !== -1) {
    if (args[coreFlag + 1] === undefined) {
        console.error('usage: generate-nativescript-member-snapshot.mjs [--core <path to @nativescript/core>]');
        process.exit(2);
    }
    nativeScript(args[coreFlag + 1]);
}
htmlElement();
