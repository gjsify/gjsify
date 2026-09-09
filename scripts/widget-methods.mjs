// The reader every consumer of the widget-method oracle shares.
//
// `scripts/generate-widget-methods.mjs` runs under GJS and writes
// `packages/framework/gtk-host/src/generated/methods.mts`;
// `scripts/check-vocabulary-alignment.mjs` runs under plain Node in the no-install gate
// and holds a port's method names against it. Both read the same generated literal the
// same way, so the parsing lives here once — the arrangement `enum-values.mjs` set one
// artifact over, and for the same reason: a second reader of a generated literal is the
// shape ADR 0029 § 6 refuses for GIR XML, at smaller scale.
//
// WHAT THE ARTIFACT IS. Three tables read from the installed typelib, plus one read from
// the running GJS:
//
//   OWN_METHODS         GType -> the instance methods THAT TYPE declares, spelled as
//                       the typelib spells them and GJS installs them: snake_case.
//                       Inherited methods are not repeated; `ANCESTRY` says where to
//                       look.
//   ANCESTRY            GType -> every ancestor and interface, transitively, for the
//                       widgets the runtime table carries. Resolving a widget's whole
//                       method set is a union over this list, done here in
//                       {@link methodsOf} so no consumer re-derives it.
//   GJS_OBJECT_METHODS  What GJS puts on `GObject.Object.prototype` BEYOND the typelib —
//                       `connect`, `disconnect`, `emit` and their siblings. No `.gir`
//                       carries these; they are the host's, and a ledger holding a port's
//                       `connect` against the GIR alone would call the one method every
//                       GJS snippet uses a divergence.
//   METHODS_UNAVAILABLE Widgets the runtime table names that the generating host had no
//                       typelib entry for — the declared remainder, so "every widget has
//                       a chain" can be a rule rather than a hope.
//
// THE READERS FAIL, THEY DO NOT RETURN LESS — the rule `enum-values.mjs` states, kept
// here by reusing its block reader and its residue check: anything in a literal the
// matcher did not consume is an error naming the residue, never a shorter answer.
//
// This module imports nothing but its sibling reader. It is handed text and returns
// data, so the GJS half (GLib file reads) and the Node half (`node:fs`) can each bring
// their own I/O.

import { readBlock, readStringArray } from './enum-values.mjs';

/** Where the method tables live — this oracle. */
export const METHODS_FILE = 'packages/framework/gtk-host/src/generated/methods.mts';

/** Where the widget set the tables cover is emitted — the runtime table. */
export const WIDGETS_FILE = 'packages/framework/gtk-host/src/generated/widgets.ts';

/**
 * Every GType the runtime widget table carries, in file order.
 *
 * The same row shape `check-vocabulary-alignment.mjs` reads for its tag map, matched
 * here on the GType alone: the generator needs the SET the tables have to cover, and the
 * tag is that file's business.
 */
export function readRuntimeGTypes(text) {
    const out = [];
    for (const [, gtype] of text.matchAll(/\{\s*gtype:\s*'([^']+)',\s*tag:\s*'[^']+'/g)) out.push(gtype);
    if (out.length === 0) throw new Error(`no widget rows found in ${WIDGETS_FILE} — the emitted shape moved`);
    return out;
}

/** What a matcher did NOT consume, once commas and whitespace are discounted. */
function residue(body, spans) {
    const kept = [];
    let at = 0;
    for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
        kept.push(body.slice(at, from));
        at = to;
    }
    kept.push(body.slice(at));
    return kept.join('').replace(/[\s,]/g, '');
}

/**
 * A `Name: ['a', 'b']` record whose values are string arrays — `OWN_METHODS` and
 * `ANCESTRY` are both spelled this way.
 *
 * An empty array is a legitimate value and is kept: `GInitiallyUnowned` declares no
 * method of its own, and a reader that dropped the row would make "no methods" and
 * "not read" the same answer.
 */
export function readStringArrayRecord(text, name) {
    const body = readBlock(text, name);
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
        const items = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
        const inner = residue(
            match[2],
            [...match[2].matchAll(/'[^']*'/g)].map((m) => [m.index, m.index + m[0].length]),
        );
        if (inner !== '') throw new Error(`${name} entry ${match[1]} carries an unreadable item: ${inner}`);
        if (out.has(match[1])) throw new Error(`${name} declares ${match[1]} twice`);
        out.set(match[1], items);
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`${name} has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/**
 * A `Key: '<text>'` record whose keys are BARE identifiers — GType names carry no dot, and
 * the repository's formatter (`quoteProps: as-needed`) strips quotes a key does not need,
 * so `enum-values.mjs`'s quoted-key reader would refuse the file the formatter accepts.
 */
export function readBareStringRecord(text, name) {
    const body = readBlock(text, name);
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/(\w+):\s*'((?:[^'\\]|\\.)*)'/g)) {
        if (out.has(match[1])) throw new Error(`${name} declares ${match[1]} twice`);
        out.set(match[1], match[2]);
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`${name} has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/**
 * The whole artifact, as data.
 *
 * @param {string} text the generated file
 * @returns {{
 *   provenance: string,
 *   own: Map<string, string[]>,
 *   ancestry: Map<string, string[]>,
 *   host: string[],
 *   unavailable: Map<string, string>,
 * }}
 */
export function readMethodTable(text) {
    const provenance = /^export const METHODS_PROVENANCE = '([^']*)';$/m.exec(text)?.[1];
    if (provenance === undefined) throw new Error('METHODS_PROVENANCE is not declared as a plain string');
    const own = readStringArrayRecord(text, 'OWN_METHODS');
    const ancestry = readStringArrayRecord(text, 'ANCESTRY');
    const host = readStringArray(text, 'GJS_OBJECT_METHODS');
    const unavailable = readBareStringRecord(text, 'METHODS_UNAVAILABLE');
    if (own.size === 0) throw new Error('OWN_METHODS read as empty');
    if (ancestry.size === 0) throw new Error('ANCESTRY read as empty');
    if (host.length === 0) throw new Error('GJS_OBJECT_METHODS read as empty');
    // Every ancestor a widget names has a row of its own, or a union over the chain
    // would silently stop short — the same "fewer facts" failure the readers above
    // refuse, one level up.
    for (const [gtype, chain] of ancestry) {
        for (const ancestor of chain) {
            if (!own.has(ancestor))
                throw new Error(`ANCESTRY of ${gtype} names ${ancestor}, which has no OWN_METHODS row`);
        }
    }
    for (const gtype of unavailable.keys()) {
        if (ancestry.has(gtype)) throw new Error(`${gtype} is both in ANCESTRY and declared unavailable`);
    }
    return { provenance, own, ancestry, host, unavailable };
}

/**
 * Every method a GJS caller can invoke on an instance of `gtype`: its own, every
 * ancestor's and interface's, and the host's signal verbs.
 *
 * `null` for a GType the tables do not cover — an abstract base or an interface has
 * `OWN_METHODS` but no `ANCESTRY` row, because the closure is only resolved for the
 * widgets the runtime table names. A caller asking about anything else gets no answer
 * rather than a short one.
 *
 * @param {ReturnType<typeof readMethodTable>} table
 * @param {string} gtype
 * @returns {Set<string> | null}
 */
export function methodsOf(table, gtype) {
    const chain = table.ancestry.get(gtype);
    if (chain === undefined) return null;
    const out = new Set(table.own.get(gtype) ?? []);
    for (const ancestor of chain) for (const name of table.own.get(ancestor) ?? []) out.add(name);
    for (const name of table.host) out.add(name);
    return out;
}

/** `add_top_bar` -> `addTopBar`: the spelling a port written in NativeScript's idiom uses. */
export const camelOf = (snake) => snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** `addTopBar` -> `add_top_bar`: the only spelling GJS installs. */
export const snakeOf = (camel) => camel.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`);
