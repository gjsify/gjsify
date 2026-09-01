// The half of a vocabulary that lives in its `.d.ts`, read as TEXT.
//
// WHY IT IS ITS OWN MODULE. `girs-vocabulary.mts` opens files, so it imports
// `gi://GLib` and can only be loaded on a GJS host. Everything here is string work
// over a buffer somebody else read, which is what makes it testable: the fixtures in
// `generator.spec.ts` are literals, and they run wherever that suite runs.
//
// WHY IT IS TEXT AND NOT A PARSER. The input is `@girs`' own generated output, whose
// shape is fixed by ts-for-gir's emitter — one member per line, one JSDoc block above
// it — and pulling a TypeScript parser into the generator to read a file whose layout
// we already know would be a second toolchain. The price is that every assumption
// about that layout has to be PINNED, because a regex over TypeScript fails silently:
// it returns fewer names, never an error. Three have already cost a defect, and each
// is a vector in `generator.spec.ts`:
//
//  - `\s*` before the interface's brace. Without it only interfaces carrying an
//    `extends` clause match, because `[^{]*` swallows the space for those, and all 33
//    root interfaces were dropped. The same missing `\s*` was still live in
//    `scripts/check-adwaita-element-properties.mjs`, where it hid 25 interfaces and
//    took `<adw-toggle>` out of that check without failing it.
//  - stripping the block delimiters BEFORE the per-line stars. A single-line JSDoc
//    otherwise keeps its trailing delimiter, which the emitter then closes a second
//    time and `gjsify format` rejects as a syntax error.
//  - the doc block must be ADJACENT. `lastIndexOf` finds the nearest one ANYWHERE
//    above, so a member with no JSDoc inherited its predecessor's, and
//    `GtkTreeView.model` shipped documented as "Extra indentation for each level."

/** One member, as the `.d.ts` renders it: the TS text plus whatever JSDoc sits above. */
export interface DeclaredProp {
    readonly ts: string;
    readonly doc?: string;
    readonly since?: string;
    readonly deprecated: boolean;
}

/** One `export interface <GType>Props` — its own JSDoc, and its own members. */
export interface DeclaredInterface {
    readonly doc?: string;
    readonly props: Map<string, DeclaredProp>;
}

interface DocBlock {
    readonly doc?: string;
    readonly since?: string;
    readonly deprecated: boolean;
}

const NO_DOC: DocBlock = { deprecated: false };

/**
 * The JSDoc block directly above a declaration, or nothing.
 *
 * ADJACENCY IS THE WHOLE RULE. `text` is everything preceding the declaration, so the
 * nearest block above it may belong to a sibling several members up. Requiring
 * whitespace only between that block's terminator and the declaration is what
 * separates "this member is documented" from "some earlier member was".
 */
export function readDocBlock(text: string): DocBlock {
    const open = text.lastIndexOf('/**');
    const close = text.lastIndexOf('*/');
    if (open === -1 || close <= open || text.slice(close + 2).trim() !== '') return NO_DOC;
    const block = text.slice(open, close + 2);
    const doc = block
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*+ ?/, '').trim())
        .filter((line) => line !== '' && !line.startsWith('@'))
        .join(' ');
    return {
        doc: doc === '' ? undefined : doc,
        since: /@since ([\d.]+)/.exec(block)?.[1],
        deprecated: /@deprecated/.test(block),
    };
}

/**
 * Read the namespace imports a vocabulary declares: `import type Gdk from
 * '@girs/gdk-4.0'`.
 *
 * These are the only honest answer to "which namespaces do the rendered types reach
 * into". Deriving it from the source list instead emitted `Gdk.RGBA` with no Gdk
 * import — TS2503, in a file nobody edits by hand.
 */
export function readNamespaceImports(text: string, ownPkg: string): Map<string, string> {
    const out = new Map<string, string>();
    const line = /^import type (\w+) from '([^']+)';$/gm;
    for (let m = line.exec(text); m !== null; m = line.exec(text)) {
        const spec = m[2]!;
        out.set(m[1]!, spec.startsWith('.') ? `@girs/${ownPkg}` : spec);
    }
    return out;
}

/**
 * The interfaces a vocabulary `.d.ts` declares, with each property's rendered type.
 *
 * Brace-matched rather than terminated on a closing brace at column 0: an interface
 * body can contain a nested object type, and a reader that stops at the first one
 * silently truncates it. That exact shortcut is already recorded as a defect in two
 * sibling scripts.
 */
export function readDeclaredInterfaces(text: string): Map<string, DeclaredInterface> {
    const out = new Map<string, DeclaredInterface>();
    const head = /^export interface (\w+)Props(?:\s+extends\s[^{]*)?\s*\{/gm;
    for (let m = head.exec(text); m !== null; m = head.exec(text)) {
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < text.length && depth > 0; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
        }
        out.set(m[1]!, {
            // The CLASS blurb, and it is not decoration: a published type surface
            // exists for its hover text (ADR 0028 § 6). Leaving it unread took 194 of
            // the 197 interface comments out of `generated/props.ts` in one commit,
            // with the input still carrying every one of them.
            doc: readDocBlock(text.slice(0, m.index)).doc,
            props: readProps(text.slice(m.index + m[0].length, i - 1)),
        });
    }
    return out;
}

/** Property lines plus the JSDoc block immediately above each one. */
export function readProps(body: string): Map<string, DeclaredProp> {
    const props = new Map<string, DeclaredProp>();
    const line = /^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\?: (.+);$/gm;
    for (let m = line.exec(body); m !== null; m = line.exec(body)) {
        const name = m[1] ?? m[2]!;
        const { doc, since, deprecated } = readDocBlock(body.slice(0, m.index));
        props.set(name, { ts: m[3]!, doc, since, deprecated });
    }
    return props;
}
