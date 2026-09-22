#!/usr/bin/env node
// The authored-tree node shape is written down more than once, and every copy says the same
// thing — held field by field, and swept for the copy nobody declared.
//
// THE SHAPE. `{ tag, slot?, props?, children? }`, spelled in GIR class names, is what ADR
// 0051 authors a widget tree in. The ORIGINAL is `SharedTreeNode` in
// `packages/web/adwaita-core/src/conformance/shared-trees.ts`: renderer-free, published, and
// read by all three tree drivers. It is the one declaration that gets to decide the shape.
//
// WHY THERE ARE COPIES AT ALL, AND WHY THEY CANNOT BECOME IMPORTS. Each restatement has a
// measured reason in its own header, and none of them is taste:
//
//   · `scripts/adwaita-gallery-shared-trees.d.mts` — its two consumers are plain-Node
//     generators that run in CI jobs with NO `node_modules`, so a bare specifier does not
//     resolve for them.
//   · `packages/infra/blueprint/src/shared-node.d.mts` — `@gjsify/blueprint` is tier 1 and
//     `@gjsify/adwaita-core` is tier 2, so ADR 0003's tier rule refuses the edge; and the package
//     deliberately has no build step, while `@gjsify/adwaita-core` publishes its types from
//     `lib/types/**`, which does not exist in `tree-checks` — the job the corpus gate runs in.
//   · the NativeScript template probe — the interface is EMITTED into a showcase app by
//     `scripts/generate-adwaita-nativescript-templates.mjs`, and a showcase compiles against
//     what it ships, not against a workspace type.
//
// So the copies stay. What was missing is the thing that makes a copy safe: a machine that
// says the day one of them stops meaning what the original means.
//
// AND THE HARDER HALF — A COPY NOBODY LISTED. Holding a registry of known restatements to
// the original catches drift in the ones somebody already thought about. It cannot catch the
// next person writing `interface Node { tag: string; children?: Node[] }` somewhere new,
// which is how most of the ledger below got here. So the tree is SWEPT for the shape rather than for
// the name: any declaration with a `tag` member of a string type and a `children` member is
// a member of this family, and one that appears in no list below is a failure with the file
// and the line in the message. The sweep is the mechanism; the registry is only its ledger.
//
// TWO VERDICTS, BECAUSE NOT EVERY MEMBER OF THE FAMILY IS THE SAME SHAPE.
//
//   `holds`  — structurally identical to the original, and must stay so. A field added,
//              removed, renamed or re-typed on either side fails, naming the field.
//   `apart`  — declared DIFFERENT, with the difference written out as a delta and a measured
//              reason for it. The delta is compared exactly, so a new divergence nobody
//              declared fails just as loudly as a drifted `holds` entry — and an entry whose
//              delta has gone EMPTY fails too, saying so: it has become the original and
//              belongs on the other list, or the two should be merged. The ledger cannot only
//              grow, which is the property `corpus/divergences.mjs` was written for.
//
// WHAT IT COMPARES, AND WHAT IT DELIBERATELY DOES NOT. Comments are stripped, `readonly` and
// `Readonly<>` are normalised away, the declaration's own name is folded to `Self` so a
// self-recursive `children` matches across two spellings, and members are compared by NAME
// rather than by order. What it does not compare is MEANING: `ExpectNode.tag` holds an XML
// element name (`adw:Clamp`) where the original holds a GIR class. That difference is real
// and is not a shape difference, so it is a comment over there and not a delta here. A gate
// that tried to grade meaning would be grading prose.
//
// WHAT COUNTS AS A DECLARATION IS "WRITTEN AT THE START OF A LINE", and that is not a
// shortcut. It is what admits the copy this gate most needed to find — the NativeScript
// generator PRINTS its interface into a template literal, at column zero of the emitted file
// — while leaving a declaration quoted mid-line as what it is, a fixture or a sentence about
// one. `oxfmt` puts every real declaration in this tree at a line start, so the rule costs
// nothing and the alternative costs a lot: dropping the anchor makes every vector in this
// file's own self-test a spelling of its own, and a gate that reports its own test data is one
// nobody reads. The fixture that IS at a line start is on the ledger below, which is the
// honest half of the same rule — it has to track the original like any other copy, or the
// vectors would be measuring against a shape that moved.
//
// WHY THE SWEEP ASKS FOR `string` AND NOT MERELY FOR `tag`. Measured on this tree, the
// predicate "has `tag` and has `children`" also collects `DerValue` in `@gjsify/crypto`,
// whose `tag` is a DER tag BYTE — a `number`. That is not a near miss of this shape, it is a
// different shape that shares two English words, and admitting it would mean an exemption
// list whose first entry teaches the reader nothing. Asking that the tag be spelled as a
// string is the boundary, and it is the one thing every member of this family agrees on.
//
// Reads no `node_modules`: `git ls-files` plus the repo's own comment stripper, so it runs in
// `audit-runtimes.yml`, which installs nothing.
//
// Usage: node scripts/check-shared-tree-shape.mjs [--root <dir>] [--list]
// Exits 0 when every copy agrees, 1 on drift or an undeclared copy, 2 on a usage error, a
// read error, or a self-test failure — the last meaning the comparison proves nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sourcePathspecs, toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';
import { stripComments } from '../packages/infra/manifest-conformance/lib/strip-comments.mjs';

// ------------------------------------------------------------------ 1. the ledger

// The delta lines that repeat across every `apart` entry, written once each: the marking of
// ADR 0067 and the style-class list of ADR 0068 are absent from all five of them, and five
// copies of one string is five places to forget when its spelling moves.
const MARK = '- translatable?: Record<string, { context?: string }>';
const STYLES = '- styleClasses?: string[]';

/** The declaration that decides the shape. Everything else is measured against it. */
const ORIGINAL = {
    file: 'packages/web/adwaita-core/src/conformance/shared-trees.ts',
    name: 'SharedTreeNode',
};

/**
 * Every other declaration of this shape in the tree, with its verdict.
 *
 * A `why` says what the declaration is FOR and — for an `apart` entry — what the delta buys.
 * "It is different" is not a reason; the reason has to be the thing that would be lost by
 * making it identical, because that is the question a reader of a failure is deciding.
 */
const FAMILY = [
    {
        file: 'scripts/adwaita-gallery-shared-trees.d.mts',
        name: 'SharedNode',
        verdict: 'holds',
        why:
            'the types for the gallery corpus, so the tree drivers read the corpus itself rather than a ' +
            'transcription of it',
    },
    {
        file: 'packages/infra/blueprint/src/shared-node.d.mts',
        name: 'SharedNode',
        verdict: 'holds',
        why: "the output shape of ADR 0053's lossy second exit, `src/project.mjs`",
    },
    {
        file: 'scripts/generate-adwaita-nativescript-templates.mjs',
        name: 'ExpectNode',
        verdict: 'holds',
        why: 'emitted into the NativeScript showcase probe, which compiles against what it ships',
    },
    {
        file: 'showcases/dom/adwaita-gallery-nativescript/app/expected.ts',
        name: 'ExpectNode',
        verdict: 'holds',
        why: 'the emitted copy of the entry above — generated, and tracked, so it is swept like any other file',
    },
    {
        file: 'scripts/check-shared-tree-shape.mjs',
        name: 'SharedTreeNode',
        verdict: 'holds',
        why:
            "this file's own self-test fixture, swept like any other copy on purpose: the vectors " +
            'below measure deltas AGAINST it, so a fixture left behind by a change to the original ' +
            'would grade every restatement against a shape that no longer exists',
    },
    {
        file: 'packages/framework/gtk-host/src/conformance/vectors.mts',
        name: 'VectorElement',
        verdict: 'apart',
        delta: [
            '- id?: string',
            '- slot?: string',
            '- template?: string',
            `${MARK}`,
            `${STYLES}`,
            '~ children?: VectorNode[] | canon children?: Self[]',
            '~ props?: Record<string, unknown> | canon props?: Record<string, string | number | boolean>',
        ],
        why:
            'a `VectorNode` is `string | VectorElement`, so this tree can carry a TEXT NODE — the one ' +
            'thing the authored corpus cannot express and the thing these vectors exist to drive. ' +
            'Its `props` are `unknown` because the vectors set properties the corpus never authors, ' +
            'and it needs no `slot` because `h()` places children positionally',
    },
    ...[
        'scripts/generate-adwaita-framework-snippets.mjs',
        'showcases/gtk/adwaita-gallery-react/src/app.tsx',
        'showcases/gtk/adwaita-gallery-solid/src/app.tsx',
        'showcases/gtk/adwaita-gallery-vue/src/app.ts',
    ].map((file) => ({
        file,
        name: 'Expect',
        verdict: 'apart',
        delta: [
            '+ gtype: string',
            '- id?: string',
            '- template?: string',
            `${MARK}`,
            `${STYLES}`,
            '~ props?: Record<string, unknown> | canon props?: Record<string, string | number | boolean>',
        ],
        why:
            'the framework probes compare the CONSTRUCTED widget against the authored node, so each ' +
            'node carries the GType it must have realised as BESIDE the tag it was written with — ' +
            'two facts the original deliberately keeps as one. `props` are read back off a real ' +
            'widget, where a value may be any type',
    })),
    {
        file: 'packages/web/domparser/src/selectors.spec.ts',
        name: 'TestNode',
        verdict: 'apart',
        delta: [
            '+ attrs: Record<string, string>',
            '+ parent: Self | null',
            '+ text: string',
            '- id?: string',
            '- props?: Record<string, string | number | boolean>',
            '- slot?: string',
            '- template?: string',
            `${MARK}`,
            `${STYLES}`,
            '~ children: Self[] | canon children?: Self[]',
            '~ tag: string | null | canon tag: string',
        ],
        why:
            'not a widget tree at all: it is the fixture the CSS selector engine runs over, so it is ' +
            "shaped by htmlparser2's `Adapter` — a parent link, an attribute bag, text, and a null tag " +
            'for the document node. It shares two field names with this family and nothing else',
    },
];

// ------------------------------------------------------------------ 2. reading a shape

/** An identifier, as either spelling of a declaration names one. */
const IDENT = '[A-Za-z_$][\\w$]*';

/** A generic parameter list, which either spelling may carry before its body. */
const GENERICS = '(?:<[^<>{}=]*>)?';

/**
 * `interface X {` / `type X = {`, opening a line, at any nesting.
 *
 * At any nesting, because the NativeScript generator writes its declaration INSIDE a template
 * literal and a sweep that looked only at top level would miss the very copy that makes this
 * gate necessary — the one that reaches the tree by being printed into it. Opening a LINE,
 * because that is what tells a declaration from a fixture quoted mid-line: § WHAT COUNTS AS A
 * DECLARATION above has the measurement, and this file's own vectors are the reason.
 *
 * Built from fragments rather than written out as one literal, so no line of it runs past the
 * formatter's width — a regex literal is the one thing `oxfmt` cannot break for you.
 */
const DECLARATION = new RegExp(
    '(?:^|\\n)[ \\t]*(?:export\\s+)?(?:declare\\s+)?' +
        `(?:interface\\s+(${IDENT})|type\\s+(${IDENT})\\s*${GENERICS}\\s*=)\\s*${GENERICS}\\s*\\{`,
    'g',
);

/** The index of the brace that closes the one at `open`, or -1. */
function matchingBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** `Readonly<X>` is X, however deeply nested — unwrapped by brace depth, never by regex. */
function unwrapReadonly(type) {
    let out = type;
    for (;;) {
        const at = out.indexOf('Readonly<');
        if (at === -1) return out;
        let depth = 0;
        let end = -1;
        for (let i = at + 'Readonly'.length; i < out.length; i += 1) {
            if (out[i] === '<') depth += 1;
            else if (out[i] === '>') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        // An unbalanced `Readonly<` is not something to guess at: leave it, and let the
        // comparison report the member rather than silently normalising half of it away.
        if (end === -1) return out;
        out = `${out.slice(0, at)}${out.slice(at + 'Readonly<'.length, end)}${out.slice(end + 1)}`;
    }
}

/**
 * One member type, in the spelling two declarations of one shape have to agree on.
 *
 * `readonly` and `Readonly<>` go, because the original is frozen where the projection BUILDS
 * its tree, and that is a difference in who writes the object rather than in what it holds.
 * The declaration's own name folds to `Self`, so `children?: SharedTreeNode[]` and
 * `children?: SharedNode[]` are one member and a change to the ELEMENT type is still caught.
 */
function normaliseType(type, ownName) {
    const collapsed = unwrapReadonly(type.replace(/\s+/g, ' ').trim())
        .replace(/\breadonly\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return collapsed.replace(new RegExp(`\\b${ownName}\\b`, 'g'), 'Self');
}

/** `name`, `name?`, quoted or computed keys — everything a member line may open with. */
const MEMBER = /^(?:readonly\s+)?(\[[^\]]*\]|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/;

/**
 * The members of a declaration body, keyed by name.
 *
 * Split on `;` and newline at brace depth zero and NOT on `,`, because the only commas in
 * this family sit inside a `Record<…, …>` and a splitter that took them would report half a
 * type as a member. A line that does not parse as `name: type` is kept under its own raw
 * text, so a call signature or an index signature still takes part in the comparison —
 * dropping what it cannot read is how a comparison passes on the half it never saw.
 *
 * The `>` of an arrow type is not a closing bracket, and reading it as one is not a cosmetic
 * bug: depth would go negative at the first `(x: T) => U` member and never return to zero, so
 * every member AFTER it would be swallowed into one unparsable blob. The comparison would
 * still be loud rather than wrong — that blob matches nothing — but it would name the wrong
 * thing, which is most of what a reader gets from a failure. The vector for it puts the arrow
 * member in the MIDDLE, measured: with it last, the final flush collects the tail anyway and
 * the vector passes under the bug it was written for.
 */
function membersOf(body, ownName) {
    const members = new Map();
    let depth = 0;
    let previous = '';
    let current = '';
    const flush = () => {
        const piece = current.trim();
        current = '';
        if (piece === '') return;
        const parsed = MEMBER.exec(piece);
        if (parsed === null) {
            members.set(`«${piece}»`, { name: `«${piece}»`, optional: false, type: '', raw: piece });
            return;
        }
        const [, name, optional, type] = parsed;
        members.set(name, {
            name,
            optional: optional === '?',
            type: normaliseType(type.replace(/[;,]\s*$/, ''), ownName),
        });
    };
    for (const ch of body) {
        if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth += 1;
        else if (ch === '}' || ch === ']' || ch === ')' || (ch === '>' && previous !== '=')) depth -= 1;
        previous = ch;
        if (depth === 0 && (ch === ';' || ch === '\n')) {
            flush();
            continue;
        }
        current += ch;
    }
    flush();
    return members;
}

/** How a member is printed in a delta and in a failure — one spelling for both. */
const render = (member) =>
    member.raw !== undefined ? member.raw : `${member.name}${member.optional ? '?' : ''}: ${member.type}`;

/**
 * Every `interface`/`type` declaration in one file's text, with its members and its line.
 *
 * Comments are stripped TWICE, and the second pass is not redundant: the shared stripper
 * keeps string and template-literal bodies — deliberately, a quoted widget name is usually
 * the thing being looked for — so the declaration the NativeScript generator prints into a
 * template literal still carries its JSDoc. Stripping the extracted body again reads that
 * body as code, which is what it is about to become.
 */
export function declarationsIn(text) {
    const code = stripComments(text);
    const found = [];
    DECLARATION.lastIndex = 0;
    let match;
    while ((match = DECLARATION.exec(code)) !== null) {
        const open = code.indexOf('{', match.index + match[0].length - 1);
        const close = matchingBrace(code, open);
        if (close === -1) continue;
        const name = match[1] ?? match[2];
        found.push({
            name,
            line: code.slice(0, match.index + 1).split('\n').length,
            members: membersOf(stripComments(code.slice(open + 1, close)), name),
        });
        DECLARATION.lastIndex = close;
    }
    return found;
}

/**
 * Whether a declaration is a member of this family.
 *
 * A `children` member and a `tag` spelled as a string. Both halves are needed: `tag` alone is
 * every tagged union in the tree, and `children` alone is every DOM-ish node.
 */
export function isAuthoredTreeShape(declaration) {
    const tag = declaration.members.get('tag');
    const children = declaration.members.get('children');
    return tag !== undefined && children !== undefined && /\bstring\b/.test(tag.type);
}

/**
 * How a declaration differs from the original, as sorted lines.
 *
 * `+` is a member the original does not have, `-` one it has and this does not, `~` one they
 * both have and spell differently — and `~` prints BOTH sides, so a change to either one
 * moves the line. A ledger entry that only recorded the divergent side would go on matching
 * after the original moved underneath it.
 */
export function deltaAgainst(original, other) {
    const lines = [];
    for (const name of [...new Set([...original.keys(), ...other.keys()])].sort()) {
        const here = other.get(name);
        const there = original.get(name);
        if (here !== undefined && there === undefined) lines.push(`+ ${render(here)}`);
        else if (here === undefined && there !== undefined) lines.push(`- ${render(there)}`);
        else if (render(here) !== render(there)) lines.push(`~ ${render(here)} | canon ${render(there)}`);
    }
    return lines.sort();
}

// ------------------------------------------------------------------ 3. the self-test
//
// Every vector is a shape this comparison has to get right, and each is a way the gate could
// pass while proving nothing. It runs before the tree is read, because a broken comparison
// over a clean tree is exit 0 either way.

const CANON_SOURCE = `
export interface SharedTreeNode {
    /** A GIR class name. */
    tag: string;
    id?: string;
    template?: string;
    slot?: string;
    props?: Readonly<Record<string, string | number | boolean>>;
    translatable?: Readonly<Record<string, { readonly context?: string }>>;
    styleClasses?: readonly string[];
    children?: readonly SharedTreeNode[];
}
`;

const VECTORS = [
    [
        'readonly, Readonly<> and the self-name are three spellings of one shape',
        `export interface SharedNode {
    tag: string;
    id?: string;
    template?: string;
    slot?: string;
    props?: Record<string, string | number | boolean>;
    translatable?: Record<string, { context?: string }>;
    styleClasses?: string[];
    children?: SharedNode[];
}`,
        'SharedNode',
        [],
    ],
    [
        'a field that lost its optionality is named',
        `interface SharedNode {
    tag: string;
    id?: string;
    template?: string;
    slot: string;
    props?: Record<string, string | number | boolean>;
    translatable?: Record<string, { context?: string }>;
    styleClasses?: string[];
    children?: SharedNode[];
}`,
        'SharedNode',
        ['~ slot: string | canon slot?: string'],
    ],
    [
        'an added field and a re-typed one are both reported',
        `interface Expect {
    readonly tag: string;
    readonly gtype: string;
    readonly slot?: string;
    readonly props?: Record<string, unknown>;
    readonly children?: readonly Expect[];
}`,
        'Expect',
        [
            '+ gtype: string',
            '- id?: string',
            '- template?: string',
            `${MARK}`,
            `${STYLES}`,
            '~ props?: Record<string, unknown> | canon props?: Record<string, string | number | boolean>',
        ],
    ],
    [
        'a dropped field is reported even though everything else matches',
        `interface Lossy {
    tag: string;
    id?: string;
    template?: string;
    props?: Record<string, string | number | boolean>;
    translatable?: Record<string, { context?: string }>;
    styleClasses?: string[];
    children?: Lossy[];
}`,
        'Lossy',
        ['- slot?: string'],
    ],
    [
        'an arrow type does not swallow the members after it',
        `interface Callbacky {
    tag: string;
    id?: string;
    template?: string;
    slot?: string;
    render: (into: Callbacky) => void;
    props?: Record<string, string | number | boolean>;
    translatable?: Record<string, { context?: string }>;
    styleClasses?: string[];
    children?: Callbacky[];
}`,
        'Callbacky',
        ['+ render: (into: Self) => void'],
    ],
    [
        'the element type of children is compared, not just its name',
        `interface Widened {
    tag: string;
    id?: string;
    template?: string;
    slot?: string;
    props?: Record<string, string | number | boolean>;
    translatable?: Record<string, { context?: string }>;
    styleClasses?: string[];
    children?: (Widened | string)[];
}`,
        'Widened',
        ['~ children?: (Self | string)[] | canon children?: Self[]'],
    ],
];

/** Shapes the SWEEP must find, and shapes it must not — the half a field comparison cannot test. */
const SWEEP_VECTORS = [
    ['a plain interface of the shape', 'interface N { tag: string; children?: N[] }', true],
    [
        'a declaration printed into a template literal is in the tree too',
        'const t = `\ninterface ExpectNode {\n    tag: string;\n    children?: ExpectNode[];\n}\n`;',
        true,
    ],
    ['a type alias spelling of the shape', 'type N = { tag: string; children?: N[] };', true],
    ['a numeric tag is a different shape, not a near miss', 'interface Der { tag: number; children?: Der[] }', false],
    ['a tag with no children is not this family', 'interface Evt { tag: string; at: number }', false],
    ['children with no tag is not this family', 'interface Dom { nodeName: string; children: Dom[] }', false],
    [
        'a commented-out declaration is prose, not a copy',
        '// interface Ghost { tag: string; children?: Ghost[] }\nconst x = 1;',
        false,
    ],
];

function selfTest() {
    const failures = [];
    const canon = declarationsIn(CANON_SOURCE);
    if (canon.length !== 1 || !isAuthoredTreeShape(canon[0])) {
        return ['  the vector original itself does not read as one declaration of this shape'];
    }
    for (const [what, source, name, expected] of VECTORS) {
        const read = declarationsIn(source).find((declaration) => declaration.name === name);
        if (read === undefined) {
            failures.push(`  ${what}\n    the reader found no declaration called ${name}`);
            continue;
        }
        const got = deltaAgainst(canon[0].members, read.members);
        if (got.join('\n') !== [...expected].sort().join('\n')) {
            failures.push(`  ${what}\n    expected [${expected.join(' · ')}]\n    got      [${got.join(' · ')}]`);
        }
    }
    for (const [what, source, wanted] of SWEEP_VECTORS) {
        const got = declarationsIn(source).some(isAuthoredTreeShape);
        if (got !== wanted) failures.push(`  ${what}\n    expected the sweep to ${wanted ? 'find' : 'pass over'} it`);
    }
    return failures;
}

// ------------------------------------------------------------------ 4. the real tree

function usage() {
    return 'usage: node scripts/check-shared-tree-shape.mjs [--root <dir>] [--list]';
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(usage());
        return process.exit(0);
    }
    // A mistyped flag must not read as its own absence — `check-blueprint-census.mjs`'s note.
    const rootFlag = args.indexOf('--root');
    const root = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];
    const stray = args.filter(
        (arg, i) => arg !== '--root' && arg !== '--list' && !(rootFlag !== -1 && i === rootFlag + 1),
    );
    if (stray.length > 0 || (rootFlag !== -1 && typeof root !== 'string')) {
        const why = stray.length > 0 ? `unknown argument(s): ${stray.join(', ')}` : '--root needs a directory';
        console.error(`check-shared-tree-shape: ${why}\n  ${usage()}`);
        return process.exit(2);
    }

    const selfTestFailures = selfTest();
    if (selfTestFailures.length > 0) {
        console.error('check-shared-tree-shape: its own comparison is broken, so it proves nothing.\n');
        for (const failure of selfTestFailures) console.error(`${failure}\n`);
        return process.exit(2);
    }

    /** Every declaration of this shape the tree holds, keyed `<file>#<name>`. */
    const swept = new Map();
    let scanned = 0;
    try {
        const listed = execFileSync('git', ['ls-files', '-z', '--', ...sourcePathspecs()], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 1 << 28,
        })
            .split('\0')
            .filter(Boolean);
        for (const file of listed) {
            const text = readFileSync(join(root, file), 'utf8');
            scanned += 1;
            // The cheap gate first: the sweep is over every tracked source, and reading a
            // declaration out of all of them costs more than the question is worth.
            if (!text.includes('tag') || !text.includes('children')) continue;
            for (const declaration of declarationsIn(text)) {
                if (!isAuthoredTreeShape(declaration)) continue;
                swept.set(`${toPosixPath(file)}#${declaration.name}`, { file: toPosixPath(file), ...declaration });
            }
        }
    } catch (error) {
        console.error(`check-shared-tree-shape: ${error.message}`);
        return process.exit(2);
    }

    const originalKey = `${ORIGINAL.file}#${ORIGINAL.name}`;
    const original = swept.get(originalKey);
    if (original === undefined) {
        // The discriminator. With no original there is nothing to compare against, and every
        // other arm below would pass by having no work — the vacuous green this gate is for.
        console.error(
            `check-shared-tree-shape: the original ${originalKey} is not in the tree.\n` +
                '  It was moved or renamed, and this gate compares against nothing until it is named here.\n',
        );
        return process.exit(2);
    }

    if (args.includes('--list')) {
        console.log(`${originalKey}  (original)`);
        for (const [key, declaration] of [...swept].sort()) {
            if (key === originalKey) continue;
            const delta = deltaAgainst(original.members, declaration.members);
            console.log(`${key}  ${delta.length === 0 ? 'identical' : `${delta.length} divergence(s)`}`);
            for (const line of delta) console.log(`    ${line}`);
        }
        return process.exit(0);
    }

    const failures = [];
    const listed = new Set(FAMILY.map((entry) => `${entry.file}#${entry.name}`));

    for (const entry of FAMILY) {
        const key = `${entry.file}#${entry.name}`;
        const declaration = swept.get(key);
        if (declaration === undefined) {
            failures.push(
                `${key} is on the ledger and the sweep did not find it. Either it was deleted or renamed — ` +
                    'then drop the entry - or it stopped matching the shape, which is itself the drift this ' +
                    'gate reports',
            );
            continue;
        }
        const delta = deltaAgainst(original.members, declaration.members);
        if (entry.verdict === 'holds') {
            if (delta.length === 0) continue;
            failures.push(
                `${key}:${declaration.line} is declared identical to the original and is not:\n` +
                    delta.map((line) => `      ${line}`).join('\n') +
                    `\n    it exists because: ${entry.why}`,
            );
            continue;
        }
        const declared = [...entry.delta].sort();
        if (delta.length === 0) {
            failures.push(
                `${key}:${declaration.line} is on the \`apart\` list and is now IDENTICAL to the original. ` +
                    "Move it to `holds`, or make it an import if its header's reason has gone away. A ledger " +
                    'entry that no longer describes anything is the next thing to drift',
            );
            continue;
        }
        if (delta.join('\n') !== declared.join('\n')) {
            const news = delta.filter((line) => !declared.includes(line));
            const gone = declared.filter((line) => !delta.includes(line));
            failures.push(
                `${key}:${declaration.line} diverges from the original differently than the ledger says:\n` +
                    news.map((line) => `      undeclared: ${line}`).join('\n') +
                    (news.length > 0 && gone.length > 0 ? '\n' : '') +
                    gone.map((line) => `      no longer true: ${line}`).join('\n') +
                    `\n    the declared reason is: ${entry.why}`,
            );
        }
    }

    for (const [key, declaration] of [...swept].sort()) {
        if (key === originalKey || listed.has(key)) continue;
        failures.push(
            `${key}:${declaration.line} declares the authored-tree shape and is on no list here. ` +
                'An undeclared spelling of this shape is exactly what this gate exists to surface: say why ' +
                'it cannot import the original, then add it as `holds` (identical) or as `apart` with its ' +
                'delta and the reason the delta buys something',
        );
    }

    if (failures.length > 0) {
        console.error(`\ncheck-shared-tree-shape: ${failures.length} problem(s):\n`);
        for (const failure of failures) console.error(`  - ${failure}.\n`);
        console.error(
            `The original is ${originalKey}. It decides the shape; every other declaration of it is a\n` +
                'restatement that has to say why it cannot import, and is held to the original field by\n' +
                'field. A copy that drifts fails in a CONSUMER, and a copy nobody listed fails nowhere.\n',
        );
        return process.exit(1);
    }

    const apart = FAMILY.filter((entry) => entry.verdict === 'apart').length;
    console.log(
        `check-shared-tree-shape: self-test green — ${VECTORS.length + SWEEP_VECTORS.length} vector(s). ` +
            `${scanned} tracked source(s) swept; ${swept.size} declaration(s) of the authored-tree shape, ` +
            `${FAMILY.length - apart} identical to ${originalKey}, ${apart} declared apart with a reason.\n`,
    );
    return process.exit(0);
}

// `import.meta.main` is not available on every Node this repo's CI still runs.
if (process.argv[1] && process.argv[1].endsWith('check-shared-tree-shape.mjs')) main();
