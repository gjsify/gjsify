// Fixtures for `check-adapter-import-direction.mjs` — the checker's own test suite.
//
// THE INCIDENT
//
// The ratchet was corrected twice in review and still missed the SHORTEST real violation:
// `import { GTK_DESCRIPTORS } from '../descriptors/gtk.js'`, the table's own module, which its
// `descriptors(/index)?.js` pattern did not admit. Beside it: an extensionless `'../registry'`,
// every adapter spelled anything but `.ts` — `readdirSync` was non-recursive and filtered
// `f.endsWith('.ts')`, so the identical content passed as `react.tsx`, `react.mts`, `react.jsx`,
// `react.js` or `adapters/react/index.ts` while printing "1 adapter(s) carry no widget knowledge"
// — and a `//` inside a string literal, which truncated the rest of the line and hid the call
// after it. Nothing checked the checker, so every one of those misses cost a human an A/B run.
// These fixtures are that missing check: each one is a vector the pre-fix script got wrong.
//
// WHY THEY ARE TEMPLATE LITERALS AND NOT FILES ON DISK
//
// The whole-tree format gate (`oxfmt --check`, main.yml) owns every `.ts`/`.tsx`/`.js` byte in
// this repository, and it REWRITES the layouts these vectors are about: measured with the
// repo's own pinned oxfmt, `const u = 'https://x'; w.append(c);` comes back as two lines, which
// deletes the vector while leaving the fixture green. The same bytes inside a template literal
// come back byte-identical (measured on the same file). So the fixtures live here as strings and
// are written to a temp tree per run — which also keeps the recursive WALK under test, the half
// an in-memory fixture map could not reach, since the walk is what the map would have replaced.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** An adapter that maps and nothing else — the shape every other fixture deviates from. */
const CLEAN_ADAPTER = `// A toy adapter. Prose may name 'GtkLabel' and even set_child() — code may not.
/**
 * The descriptor table owns the widget vocabulary, so 'AdwBin' appears here only
 * as prose, on a JSDoc continuation line.
 */
import { createElement, insert, setProp } from '../host.js';
import type { HostNode } from '../types.js';

const DOCS = 'https://example.invalid/gtk-host#adapters';

export function mount(tag: string, parent: HostNode): void {
    const node = createElement(tag);
    setProp(node, 'docs', DOCS);
    insert(parent, node, null);
}
`;

/** All three violation kinds, one per line, in a TypeScript adapter one level below `src/`. */
const CARRIES_WIDGET_KNOWLEDGE = `import { GTK_DESCRIPTORS } from '../descriptors/gtk.js';

export function mount(tag: string, parent: HostNode): void {
    const widget = GTK_DESCRIPTORS[tag] ?? 'GtkBox';
    parent.append(widget);
}
`;

/** The same three, without type annotations, for the `.js`/`.jsx` legs. */
const CARRIES_WIDGET_KNOWLEDGE_JS = `import { GTK_DESCRIPTORS } from '../descriptors/gtk.js';

export function mount(tag, parent) {
    const widget = GTK_DESCRIPTORS[tag] ?? 'GtkBox';
    parent.append(widget);
}
`;

/** The same three from one directory deeper — the `../..` the pre-fix `\\.\\./` regex could not see. */
const CARRIES_WIDGET_KNOWLEDGE_NESTED = `import { GTK_DESCRIPTORS } from '../../descriptors/gtk.js';

export function mount(tag, parent) {
    const widget = GTK_DESCRIPTORS[tag] ?? 'GtkBox';
    parent.append(widget);
}
`;

/**
 * Every fixture: a miniature `@gjsify/gtk-host` whose `src/adapters/` tree the checker walks.
 *
 * `expect.files` is the number of adapter files the walk READ — the assertion that catches an
 * extension or a layout the walk skips, which is invisible in a problem count alone.
 */
export const ADAPTER_IMPORT_DIRECTION_FIXTURES = [
    {
        name: 'clean-adapter',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER },
        expect: { files: 1, problems: [], blockers: [] },
    },
    {
        // Vector 1: the shortest import that reaches the table. `descriptors/gtk.ts` and
        // `descriptors/adw.ts` export it directly; only `descriptors(/index)?.js` was matched.
        name: 'descriptor-table-by-module-name',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/leaky.ts': `import { GTK_DESCRIPTORS } from '../descriptors/gtk.js';\n\nexport const table = GTK_DESCRIPTORS;\n`,
        },
        expect: { files: 2, problems: ['host-internal-import'], blockers: [] },
    },
    {
        // Vector 2: no extension at all, in every spelling that binds a module — plus the
        // double-quoted and backtick forms, which the patterns claim to cover and no fixture
        // held. The claim is what a fixture is for.
        name: 'host-internals-without-extension',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/leaky.ts': [
                `import { lookup } from '../registry';`,
                `import { policyFor } from '../policies/index';`,
                `const table = await import('../descriptors/adw');`,
                'import "../descriptors/gtk.js";',
                'const adw = await import(`../policies`);',
                `export const seen = [lookup, policyFor, table, adw];`,
                '',
            ].join('\n'),
        },
        expect: {
            files: 2,
            problems: [
                'host-internal-import',
                'host-internal-import',
                'host-internal-import',
                'host-internal-import',
                'host-internal-import',
            ],
            blockers: [],
        },
    },
    {
        // Vector 3, five spellings. `status/status.json` names "No React adapter" as next work,
        // so `react.tsx` is the file that plausibly arrives — and it was read by nothing.
        name: 'adapter-spelled-tsx',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER, 'src/adapters/react.tsx': CARRIES_WIDGET_KNOWLEDGE },
        expect: { files: 2, problems: ['host-internal-import', 'widget-name', 'placement-method'], blockers: [] },
    },
    {
        name: 'adapter-spelled-mts',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER, 'src/adapters/react.mts': CARRIES_WIDGET_KNOWLEDGE },
        expect: { files: 2, problems: ['host-internal-import', 'widget-name', 'placement-method'], blockers: [] },
    },
    {
        name: 'adapter-spelled-jsx',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER, 'src/adapters/react.jsx': CARRIES_WIDGET_KNOWLEDGE_JS },
        expect: { files: 2, problems: ['host-internal-import', 'widget-name', 'placement-method'], blockers: [] },
    },
    {
        // `.js` is not hypothetical: this package's own build globs `src/**/*.{ts,js}`.
        name: 'adapter-spelled-js',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER, 'src/adapters/react.js': CARRIES_WIDGET_KNOWLEDGE_JS },
        expect: { files: 2, problems: ['host-internal-import', 'widget-name', 'placement-method'], blockers: [] },
    },
    {
        // A directory per adapter — the layout that made `readdirSync` return one entry and
        // read none of it.
        name: 'adapter-in-its-own-directory',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/react/index.ts': CARRIES_WIDGET_KNOWLEDGE_NESTED,
        },
        expect: { files: 2, problems: ['host-internal-import', 'widget-name', 'placement-method'], blockers: [] },
    },
    {
        // Vector 4: a `//` inside a string literal is not a comment. `/\\/\\/.*$/` truncated the
        // line at the URL and the placement call after it was never read.
        name: 'double-slash-inside-a-string',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/leaky.ts': `const DOCS = 'https://example.invalid/x'; parent.append(child);\n`,
        },
        expect: { files: 2, problems: ['placement-method'], blockers: [] },
    },
    {
        // Vector 5, the false POSITIVE: a `/* … */` block whose continuation lines carry no
        // leading `*` was scanned as code, so ordinary prose quoting a widget name failed the
        // check. Prose may name a widget; code may not.
        name: 'block-comment-without-leading-stars',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/notes.ts': [
                '/*',
                " A paragraph about 'GtkLabel' and how set_child() is the descriptor's job,",
                ' written the way a paragraph is written: no leading star per line.',
                '*/',
                `export const NAME = 'toy';`,
                '',
            ].join('\n'),
        },
        expect: { files: 2, problems: [], blockers: [] },
    },
    {
        // A spec MUST name widgets and placements — it asserts on them. It is not an adapter,
        // and it does not make the adapter set non-empty either.
        name: 'spec-file-may-name-widgets',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER, 'src/adapters/toy.spec.ts': CARRIES_WIDGET_KNOWLEDGE },
        expect: { files: 1, problems: [], blockers: [] },
    },
    {
        // The vacuity guard's real question. A file the walk cannot read is worse than a file
        // that fails: it reports the same green as a clean tree.
        name: 'file-in-an-extension-the-walk-cannot-read',
        files: {
            'src/adapters/toy.ts': CLEAN_ADAPTER,
            'src/adapters/react.vue': `<script>\n${CARRIES_WIDGET_KNOWLEDGE_JS}</script>\n`,
        },
        expect: { files: 1, problems: [], blockers: ['unreadable-file'] },
    },
    {
        // The other half: an adapter the package PUBLISHES whose source the walk never reached
        // — it moved out of `src/adapters/`, or it was never written.
        name: 'published-adapter-with-no-source-scanned',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER },
        exports: ['./toy', './react'],
        expect: { files: 1, problems: [], blockers: ['unscanned-adapter'] },
    },
    {
        // The positive control for the line above: declared AND scanned is silence.
        name: 'published-adapter-with-its-source',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER },
        exports: ['./toy'],
        expect: { files: 1, problems: [], blockers: [] },
    },
    {
        name: 'no-adapter-at-all',
        files: {},
        expect: { files: 0, problems: [], blockers: ['no-adapter'] },
    },
    {
        name: 'only-spec-files',
        files: { 'src/adapters/toy.spec.ts': CARRIES_WIDGET_KNOWLEDGE },
        expect: { files: 0, problems: [], blockers: ['no-adapter'] },
    },
    {
        name: 'adapters-directory-gone',
        files: {},
        omitAdaptersDir: true,
        expect: { files: 0, problems: [], blockers: ['no-adapters-dir'] },
    },
    {
        // Reading the manifest is how the check knows what the package PROMISES. Failing to
        // read it must not degrade to "nothing declared, nothing to compare".
        name: 'manifest-unreadable',
        files: { 'src/adapters/toy.ts': CLEAN_ADAPTER },
        omitManifest: true,
        expect: { files: 1, problems: [], blockers: ['no-manifest'] },
    },
];

/** The manifest a fixture publishes: `.` plus one `./lib/esm/adapters/<name>.js` per declared adapter. */
function fixtureManifest(fixture) {
    const exported = { '.': { types: './lib/types/index.d.ts', default: './lib/esm/index.js' } };
    for (const subpath of fixture.exports ?? []) {
        const module = subpath.replace(/^\.\//, '');
        exported[subpath] = {
            types: `./lib/types/adapters/${module}.d.ts`,
            default: `./lib/esm/adapters/${module}.js`,
        };
    }
    return { name: `@gjsify/fixture-${fixture.name}`, private: true, type: 'module', exports: exported };
}

/**
 * Write one fixture into `root` as a miniature package and return its directory.
 *
 * The adapters directory is created even when the fixture has no files in it: "the directory
 * exists and holds no adapter" and "the directory is gone" are different findings, and only
 * `omitAdaptersDir` asks for the second.
 */
export function materializeFixture(fixture, root) {
    const pkgDir = join(root, fixture.name);
    mkdirSync(fixture.omitAdaptersDir ? pkgDir : join(pkgDir, 'src', 'adapters'), { recursive: true });
    for (const [relativePath, content] of Object.entries(fixture.files)) {
        const target = join(pkgDir, ...relativePath.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    if (!fixture.omitManifest) {
        writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify(fixtureManifest(fixture), null, 4)}\n`);
    }
    return pkgDir;
}
