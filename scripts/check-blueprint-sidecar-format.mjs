#!/usr/bin/env node
// The `.d.blp.ts` sidecar this repository commits is the sidecar `gjsify format --check` accepts.
//
// THE INCIDENT
//
// ADR 0088's emitter read `.oxfmtrc.json#printWidth` into a constant — with a comment saying it
// read the file — and hardcoded a FOUR-SPACE indent beside it. Both values are this repository's,
// so every committed sidecar and every `oxfmt --check` run here agreed, and the emitter looked
// correct. It was not: a `tabWidth: 2` consumer (kurier, Learn6502) got a sidecar the formatter
// reflowed on sight, and `gjsify format --check` was red on a file nobody hand-wrote. The emitter
// had no way to find out, because the only formatter it had ever met was the one its constants
// were copied from.
//
// WHAT THIS HOLDS, AND WHY IT IS A SEPARATE GATE FROM THE DRIFT CHECK
//
// `check-blueprint-sidecars.mjs` holds the committed bytes to what the emitter writes. That is the
// emitter's own opinion, so on its own it is a writer grading its own homework: had the emitter
// modelled the wrong indent, every one of those 38 files would have been "current" and the
// formatter would still have been red. This gate supplies the other half — it runs the REAL oxfmt
// engine over what the emitter wrote, under this repository's `.oxfmtrc.json` and under the
// configurations that are NOT this repository's, and requires the bytes to be equal. Every option
// the emitter models is exercised here, so "modelled" and "measured" cannot drift apart.
//
// A model, not a call, and `oxfmt-config.mjs` § WHY THE OPTIONS ARE MODELLED gives the three
// reasons the emitter does not simply hand its text to this engine at run time. The engine is what
// PROVES the model; it is not what produces the bytes.
//
// THE CONFIGS BELOW ARE THE PROOF THAT NO CONSTANT IS LEFT
//
// `this repository` is the `.oxfmtrc.json` in the tree root, and the other twelve are hand-written
// configurations of the options `EmitFormat` carries. Two of them are MEASURED consumers (kurier,
// Learn6502 both run `tabWidth: 2`) and the rest exist so that a future option added to
// `emitFormatFor` without being added here is a red gate rather than a silent default. The
// `.blp` sources cover every shape `emitTypedSidecar` emits: a template that packs, a template
// that reflows, a builder whose ids need quoting beside ones that do not, a builder that needs
// `Adw.init()`, a template with no ids at all, and a menu.
//
// Usage: node scripts/check-blueprint-sidecar-format.mjs [--root <dir>]
// Exits 0 when the formatter is a no-op on every emitted sidecar, 1 when it rewrites one.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { emitTypedSidecar, parseBlueprint, sidecarPathFor } from '@gjsify/blueprint';
import { emitFormatFor, parseOxfmtrc } from '@gjsify/blueprint/oxfmt';
import { format } from 'oxfmt';

/**
 * Every configuration the emitter is held against, and why it is here.
 *
 * `this repository` is read from disk rather than written out, so the gate cannot drift from the
 * file it is asserting against — the shape of the failure is a gate that pins a copy of the thing
 * it measures. Each of the rest names the options it moves off this repository's values, and
 * `defaults` is oxfmt's own with nothing set at all, which is what a project with no `.oxfmtrc`
 * gets on both sides.
 */
function configs(root) {
    const rc = parseOxfmtrc(readFileSync(join(root, '.oxfmtrc.json'), 'utf8'));
    return [
        ['defaults (no .oxfmtrc)', {}],
        ['this repository', rc],
        ['tabWidth 2 (kurier, Learn6502)', { ...rc, tabWidth: 2 }],
        ['useTabs', { ...rc, useTabs: true }],
        ['useTabs + tabWidth 2', { ...rc, useTabs: true, tabWidth: 2 }],
        ['double quotes', { ...rc, singleQuote: false }],
        ['no semicolons', { ...rc, semi: false }],
        ['no trailing comma', { ...rc, trailingComma: 'none' }],
        ['trailingComma es5', { ...rc, trailingComma: 'es5' }],
        ['quoteProps consistent', { ...rc, quoteProps: 'consistent' }],
        ['quoteProps preserve', { ...rc, quoteProps: 'preserve' }],
        // Measured to change nothing in any emitted shape, and here so the claim in
        // `oxfmt-config.mjs` § WHAT IS NOT MODELLED is a measured one: it only pads a `{}` that fits
        // on one line, and every object literal this emitter writes is multi-line.
        ['bracketSpacing false', { ...rc, bracketSpacing: false }],
        ['printWidth 80', { ...rc, printWidth: 80 }],
        ['printWidth 200', { ...rc, printWidth: 200 }],
        ['crlf', { ...rc, endOfLine: 'crlf' }],
    ];
}

/**
 * Every shape `emitTypedSidecar` can emit, as a `.blp`'s source.
 *
 * The wide template is the one that makes `printWidth` observable: its eight ids are what first
 * broke the packed `InternalChildren` (ADR 0088 § Consequences), so at this repository's 120 it
 * reflows one id per line and at 80 the packed line is still too wide. The builder carries a
 * dashed id BESIDE a plain one, which is the only case where `quoteProps: 'consistent'` differs
 * from `as-needed`.
 */
const WIDE_IDS = [
    'sidebarToggleButton',
    'pauseButton',
    'splitView',
    'pixelSizeRow',
    'normalEdgeRow',
    'depthEdgeRow',
    'pixelAlignRow',
    'glAreaContainer',
];

const SOURCES = [
    ['one-child template', 'using Gtk 4.0;\ntemplate $One: Gtk.Box {\n  Gtk.Button menuButton { }\n}\n'],
    ['childless template', 'using Gtk 4.0;\ntemplate $Plain: Gtk.Box {\n  Gtk.Label { }\n}\n'],
    [
        'wide template',
        `using Gtk 4.0;\ntemplate $Wide: Gtk.Box {\n${WIDE_IDS.map((id) => `  Gtk.Label ${id} { }`).join('\n')}\n}\n`,
    ],
    ['builder', 'using Gtk 4.0;\nGtk.Box bin { }\n'],
    ['builder quoted beside bare', 'using Gtk 4.0;\nusing Adw 1;\nAdw.Bin a-b { }\nGtk.Button download_button { }\n'],
    ['builder with Adwaita', 'using Gtk 4.0;\nusing Adw 1;\nAdw.Bin bin { }\n'],
    ['menu', 'using Gtk 4.0;\nmenu mainMenu {\n  section firstSection {\n    item ("Hi", "app.hi")\n  }\n}\n'],
];

/**
 * Ids whose PACKED `InternalChildren` declaration is exactly one column short of `printWidth`.
 *
 * That is the edge the `+ 1` in `idTuple` exists for, and an edge is the only thing that measures
 * it: with ids that are simply short, the packed form is kept by any rule that is not wildly off,
 * and with ids that are simply long, so is the reflowed one. MEASURED against the engine at this
 * repository's width: a packed line of 119 columns is kept and one of 120 is reflowed, for
 * `printWidth: 120`.
 *
 * The widths are derived rather than written down so the property survives a `printWidth` change
 * in `.oxfmtrc.json`; the assertion afterwards is what stops a miscount from turning the edge
 * fixture into an ordinary one, silently.
 */
function boundaryIds(printWidth) {
    const declaration = 'export declare const InternalChildren: ';
    const second = 'secondId';
    // declaration + '[' + '<n1>' + ', ' + '<n2>' + ']' === printWidth - 1, where <n> is the id
    // between two quote characters.
    const room = printWidth - 1 - declaration.length - 1 - 2 - 2 - 2 - 1;
    const first = 'a'.repeat(room - second.length);
    return [first, second];
}

/** The lines where a difference is readable; a whole-file dump of every comparison is not. */
function firstDifference(emitted, formatted) {
    const one = emitted.split('\n');
    const two = formatted.split('\n');
    for (let i = 0; i < Math.max(one.length, two.length); i += 1) {
        if (one[i] !== two[i])
            return `line ${i + 1}\n      emitted  ${JSON.stringify(one[i])}\n      oxfmt    ${JSON.stringify(two[i])}`;
    }
    return 'identical line count, different bytes';
}

async function main(argv) {
    const rootAt = argv.indexOf('--root');
    const root = resolve(rootAt === -1 ? process.cwd() : argv[rootAt + 1]);
    const problems = [];
    let checked = 0;

    for (const [configName, config] of configs(root)) {
        const style = emitFormatFor(config);
        const boundary = boundaryIds(style.printWidth);
        const sources = [
            ...SOURCES,
            [
                'tuple one column short of the width',
                `using Gtk 4.0;\ntemplate $Edge: Gtk.Box {\n${boundary.map((id) => `  Gtk.Label ${id} { }`).join('\n')}\n}\n`,
            ],
        ];
        for (const [sourceName, source] of sources) {
            const blp = `${sourceName.replaceAll(' ', '-')}.blp`;
            const emitted = emitTypedSidecar(parseBlueprint(source, blp), blp, style);
            const result = await format(sidecarPathFor(blp), emitted, config);
            checked += 1;
            if (sourceName === 'tuple one column short of the width') {
                // The fixture is the only thing that measures the `+ 1`, so a fixture that is off
                // the edge by a column is a lost measurement and must not pass quietly.
                //
                // Measured on the TUPLE, which is the text `idTuple` takes the width of, and NOT on
                // the emitted line: `semi: false` removes a terminator from it and
                // `endOfLine: 'crlf'` would leave its `\r` on a `\n` split, so a raw
                // `line.length` is off by one under exactly the two configurations that turn it
                // red while the model is in fact exact. The split is on `style.eol` for the same
                // reason.
                const line = emitted
                    .split(style.eol)
                    .find((one) => one.startsWith('export declare const InternalChildren: ['));
                const tuple =
                    line === undefined || style.semi === ''
                        ? line
                        : line.slice(0, Math.max(0, line.length - style.semi.length));
                if (tuple === undefined || tuple.length !== style.printWidth - 1) {
                    problems.push(
                        `the boundary fixture under "${configName}" packed to ` +
                            `${tuple === undefined ? 'nothing' : `${tuple.length} columns`}, so it no ` +
                            `longer sits on printWidth - 1 (${style.printWidth - 1}); it measures nothing.`,
                    );
                    continue;
                }
            }
            if (result.errors.length > 0) {
                problems.push(
                    `${configName} / ${sourceName}: oxfmt reported ${result.errors.length} error(s): ${result.errors[0].message}`,
                );
                continue;
            }
            if (result.code !== emitted) {
                problems.push(
                    `oxfmt REWROTE what the emitter wrote under "${configName}" for a ${sourceName}:\n` +
                        `      ${firstDifference(emitted, result.code)}`,
                );
            }
        }
    }

    if (problems.length === 0) {
        console.log(
            `check-blueprint-sidecar-format: ${checked} sidecar(s) across ${configs(root).length} ` +
                'configuration(s) are byte-identical to what oxfmt would emit.',
        );
        return 0;
    }
    for (const problem of problems) console.error(`check-blueprint-sidecar-format: ${problem}`);
    console.error(
        '\nThe emitter models the formatter rather than calling it (oxfmt-config.mjs § WHY THE ' +
            'OPTIONS ARE MODELLED), so a difference here is a MODELLED RULE that is wrong: fix ' +
            'emitFormatFor or the line shape in typed-exports.mjs, never by formatting the sidecar ' +
            'in place — that is the second copy this gate exists to refuse.',
    );
    return 1;
}

process.exit(await main(process.argv.slice(2)));
