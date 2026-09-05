// The reader both halves of the enum-value oracle share.
//
// `scripts/generate-enum-values.mjs` runs under GJS and writes
// `packages/framework/gtk-host/src/generated/enum-values.mts`;
// `scripts/check-enum-values.mjs` runs under plain Node in the no-install gate and
// holds that file against the nick lists it annotates. Both have to read the same two
// generated files the same way, so the parsing lives here once — a second reader of a
// generated literal is the shape ADR 0029 § 6 refuses for GIR XML, at smaller scale.
//
// THE READERS FAIL, THEY DO NOT RETURN LESS. Every one of them parses a whole object
// literal and then checks that what it matched COVERS the body: anything left over
// besides commas and whitespace throws with the residue in the message. That rule is
// not decoration. ADR 0029 § Amendment records the cost of the other kind twice in one
// migration — a regex reader of TypeScript dropped 194 of 197 doc comments and attached
// one member's JSDoc to the next member, and both failures were invisible because the
// reader answered with fewer facts instead of an error.
//
// This module imports nothing. It is handed text and returns data, so the GJS half
// (GLib file reads) and the Node half (`node:fs`) can each bring their own I/O.

/** Where the nick lists live — GIR-derived, emitted from the `@girs` vocabulary. */
export const SURFACE_DATA = 'packages/framework/gtk-host/src/generated/surface-data.mts';

/** Where the values live — this oracle. */
export const ENUM_VALUES_FILE = 'packages/framework/gtk-host/src/generated/enum-values.mts';

/**
 * Where a declaration's INITIALISER starts — after the `=`, never before it.
 *
 * The type annotation is between the two and it carries brackets: `export const
 * ENUM_DEPRECATED: readonly string[] = ['GtkAlign.baseline']` opens a `[` inside
 * `string[]` first. Reading from the declaration instead of from the `=` found that
 * one, returned the empty array between those brackets, and reported NOTHING — the
 * exact "answers with fewer facts" failure this file's header is about. It was caught
 * by a self-test vector rather than by review, which is the argument for the vectors.
 */
function initialiser(text, name) {
    const declaration = `export const ${name}`;
    const start = text.indexOf(declaration);
    if (start === -1) throw new Error(`${name} is not declared in this file`);
    const equals = text.indexOf('=', start + declaration.length);
    if (equals === -1) throw new Error(`${name} is declared with no initialiser`);
    return equals;
}

/**
 * The body of `export const <name> = { … }`, braces included.
 *
 * Balanced-brace scan rather than a regex: the nick lists contain no braces today, but
 * a reader that stops at the first `}` is one nested literal away from silently
 * truncating its own input.
 */
export function readBlock(text, name) {
    const start = initialiser(text, name);
    const open = text.indexOf('{', start);
    if (open === -1) throw new Error(`${name} is declared but is not an object literal`);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    throw new Error(`${name}'s object literal is not closed`);
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
 * `ENUM_NICKS` — enum GType to its nicks, in GIR declaration order.
 *
 * ORDER IS LOAD-BEARING and that is the whole reason this file exists: the obvious way
 * to turn a nick into the integer GTK wants is to count its position in this list, and
 * that answer is wrong for six of the enums it covers — and for a seventh on any host
 * whose GTK predates the vocabulary, where an unvalued nick shifts every position after
 * it. {@link countingWouldBeWrong} keeps the two apart; only the six are evidence.
 */
export function readNickLists(text) {
    const body = readBlock(text, 'ENUM_NICKS');
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
        const nicks = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
        const inner = residue(
            match[2],
            [...match[2].matchAll(/'[^']*'/g)].map((m) => [m.index, m.index + m[0].length]),
        );
        if (inner !== '') throw new Error(`ENUM_NICKS entry ${match[1]} carries an unreadable member: ${inner}`);
        out.set(match[1], nicks);
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`ENUM_NICKS has entries this reader did not match: ${left.slice(0, 120)}`);
    if (out.size === 0) throw new Error('ENUM_NICKS read as empty');
    return out;
}

/** A flat `'Key.name': <number>` record, as `SINCE` and `ENUM_VALUES` are spelled. */
export function readNumberRecord(text, name) {
    const body = readBlock(text, name);
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/'([^']+)':\s*(-?\d+)/g)) {
        if (out.has(match[1])) throw new Error(`${name} declares ${match[1]} twice`);
        out.set(match[1], Number(match[2]));
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`${name} has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/** A flat `'Key.name': '<text>'` record. Values may be long and may contain commas. */
export function readStringRecord(text, name) {
    const body = readBlock(text, name);
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/'([^']+)':\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+)/g)) {
        const value = [...match[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('');
        if (out.has(match[1])) throw new Error(`${name} declares ${match[1]} twice`);
        out.set(match[1], value);
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`${name} has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/** A flat `['a', 'b']` array declaration. */
export function readStringArray(text, name) {
    const start = initialiser(text, name);
    const open = text.indexOf('[', start);
    const close = text.indexOf(']', open);
    if (open === -1 || close === -1) throw new Error(`${name} is declared but is not an array literal`);
    const inner = text.slice(open + 1, close);
    const items = [...inner.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const left = residue(
        inner,
        [...inner.matchAll(/'[^']*'/g)].map((m) => [m.index, m.index + m[0].length]),
    );
    if (left !== '') throw new Error(`${name} has items this reader did not match: ${left.slice(0, 120)}`);
    return items;
}

/** `GtkAlign` + `baseline` -> `GtkAlign.baseline`, the one key spelling both files use. */
export const entryKey = (gtype, nick) => `${gtype}.${nick}`;

/** `GtkAlign.baseline` -> `['GtkAlign', 'baseline']`. GTypes carry no dot, nicks are kebab. */
export function splitKey(key) {
    const at = key.indexOf('.');
    if (at === -1) throw new Error(`${key} is not a <GType>.<nick> key`);
    return [key.slice(0, at), key.slice(at + 1)];
}

/**
 * The nicks of one enum grouped by the value they carry, value order preserved.
 *
 * A group of more than one is an ALIAS: two names for one member. Derived from the
 * VALUES rather than from anything the generator remembered, which is what lets the
 * gate hold the declared alias table against the numbers instead of against itself.
 */
export function groupsByValue(nicks, valueOf) {
    const groups = new Map();
    for (const nick of nicks) {
        const value = valueOf(nick);
        if (value === undefined) continue;
        const group = groups.get(value);
        if (group) group.push(nick);
        else groups.set(value, [nick]);
    }
    return groups;
}

/**
 * The enums where at least one nick's value is NOT its position in the nick list,
 * each with whether that disagreement is evidence about the LIBRARY.
 *
 * The finding this whole artifact exists for, computed rather than written down, so
 * the gate can print today's number instead of restating a measurement that drifts.
 *
 * `comparable` is false where some nick of the enum has no value on the generating
 * host: that nick carries no number, so every LATER nick sits one position further
 * along than the library numbers it, and the disagreement measures the version gap
 * rather than the numbering. Both kinds are returned, because a caller that GUARDS on
 * this needs them apart — measured 2026-09-06, a generator handed back the member
 * INDEX instead of the member's value and `GtkEditableProperties` (`num-properties` 8
 * at position 10, two newer nicks unvalued) was the only enum left on this list, so a
 * wholly counted oracle went past the one arm that exists to catch exactly that.
 */
export function countingWouldBeWrong(nickLists, values) {
    const wrong = [];
    for (const [gtype, nicks] of nickLists) {
        const off = nicks.filter((nick, index) => {
            const value = values.get(entryKey(gtype, nick));
            return value !== undefined && value !== index;
        });
        const comparable = nicks.every((nick) => values.has(entryKey(gtype, nick)));
        if (off.length > 0) wrong.push({ gtype, off, comparable });
    }
    return wrong;
}
