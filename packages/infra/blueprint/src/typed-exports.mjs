// ADR 0087: the ids a `.blp` declares, derived as TYPED names, plus the `.d.blp.ts` sidecar
// that carries them to TypeScript.
//
// A THIRD EXIT, and the reason it is here rather than in the plugin. ADR 0053 clause 1 has the
// XML and the `SharedNode` projection; this one emits neither. It answers "what names does this
// file export, and what type is each" — which is a question about the AST and nothing else, so
// it needs no GIR lookup: a TypeRef's namespace plus its name IS the TypeScript type
// (`Adw.ButtonContent`), where the GType name is not (`Gio.ListStore` is `GListStore`).
//
// It lives in this package because this package HAS NO BUILD STEP. The drift gate
// (`scripts/check-blueprint-sidecars.mjs`) and `gjsify blueprint types` both run after a bare
// install and before anything is built, which is the same constraint `src/index.mjs` § There is
// no build step records for the parser itself.

import { BlueprintEmitError } from './errors.mjs';

/**
 * The versions `gi://` imports need for the two namespaces a `using` line never names.
 *
 * Reached only through a menu id (`Gio.Menu`) or an extern type (`GObject.Object`) — neither is
 * a widget namespace, so neither appears in a `using` line, and both are 2.0 for every GNOME
 * release this repository targets. A file that DOES write `using Gio 2.0;` wins over this.
 */
const IMPLICIT_VERSIONS = Object.freeze({ Gio: '2.0', GObject: '2.0' });

/** The key `build()`'s return value may not carry, because it already carries the builder. */
const RESERVED_KEY = 'builder';

/**
 * The repository's formatter width (`.oxfmtrc.json`, `printWidth`), so this emitter writes the
 * bytes `gjsify format --check` accepts and the two gates over a sidecar — the formatter's, and
 * `scripts/check-blueprint-sidecars.mjs`, which holds the committed bytes to this emitter — cannot
 * contradict each other. MEASURED both ways before the rule, the two findings
 * `scripts/generate-widget-methods.mjs` § PRINT_WIDTH records for the other generator in this
 * tree: a packed `InternalChildren` was reflowed one id per line, and the reflowed one was
 * collapsed back onto one line wherever it fitted. oxfmt's rule is the width, so the width is
 * emitted — an eighth id is what first broke it (showcases/dom/three-postprocessing-pixel).
 */
const PRINT_WIDTH = 120;

/** A list of ids as oxfmt lays it out: one line while the whole line fits, else one id per line. */
function idTuple(ids, prefix) {
    const oneLine = `${prefix}[${ids.map((id) => `'${id}'`).join(', ')}]`;
    // The `+ 1` is the trailing comma the reflowed form carries and the packed one does not.
    if (oneLine.length + 1 <= PRINT_WIDTH) return oneLine;
    return `${prefix}[\n${ids.map((id) => `    '${id}',`).join('\n')}\n]`;
}

/**
 * The GJS member one internal child installs.
 *
 * MEASURED on gjs 1.88.1: `InternalChildren: ['download-button']` installs
 * `this._download_button`. A dash becomes an underscore and nothing else happens — both
 * `_downloadButton` and `_download-button` read `undefined` — so this applies that one
 * transform and invents no second one.
 */
const internalMember = (id) => `_${id.replaceAll('-', '_')}`;

/** Whether an id can be written as a bare key, or has to be quoted. A dashed id cannot. */
const isBareKey = (id) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id);

/**
 * The TypeScript type one `TypeRef` spells, and the namespace that type needs imported.
 *
 * An unqualified name is a Gtk type and not a lookup against the `using` lines — the rule
 * `resolve-ident.mjs` § `gtypeName` applies and `ast.d.mts` § `TypeRef` measured.
 *
 * An EXTERN type (`$Name`) names no GIR type by construction: the application registers it at
 * run time, so there is nothing to spell. `GObject.Object` is what `get_object` already returns
 * and narrowing it stays the caller's job.
 */
function typeOf(type) {
    if (type.extern === true) return { namespace: 'GObject', type: 'GObject.Object' };
    const namespace = type.namespace ?? 'Gtk';
    return { namespace, type: `${namespace}.${type.name}` };
}

/** One exported id: what the file called it, what GJS calls it, and what type it is. */
function identifier(id, type, line) {
    const resolved = typeOf(type);
    return { id, member: internalMember(id), line, ...resolved };
}

/** A menu id. MEASURED: a top-level `menu` and a named `section` inside it both answer `GMenu`. */
const menuIdentifier = (id, line) => ({ id, member: internalMember(id), line, namespace: 'Gio', type: 'Gio.Menu' });

function collectObject(object, out) {
    if (object.id !== undefined) out.push(identifier(object.id, object.type, object.line));
    collectBody(object.body, out);
}

function collectBody(body, out) {
    for (const property of body.properties) {
        if (property.value.kind === 'object') collectObject(property.value.object, out);
    }
    for (const child of body.children) collectObject(child.object, out);
    // `inlineTemplate` is deliberately NOT walked, and a nested `MenuValue` is not either. Both
    // become their own scope in the output: an inline template is a SECOND GtkBuilder document
    // CDATA-escaped into a property (`ast.d.mts` § InlineTemplateNode — "may not reference
    // objects in the main blueprint or vice versa"), and a menu written AT a property emits
    // inside that `<property>` rather than as a sibling of the objects. Neither is reachable
    // through `builder.get_object`, so exporting either would hand out a name that reads null.
}

/** A menu root, and every `section`/`submenu` inside it the source named. */
function collectMenu(menu, out) {
    if (menu.id !== undefined) out.push(menuIdentifier(menu.id, menu.line));
    const items = (list) => {
        for (const item of list) {
            if (item.id !== undefined) out.push(menuIdentifier(item.id, item.line));
            items(item.items);
        }
    };
    items(menu.items);
}

/**
 * What one `.blp` exports, as facts rather than as text.
 *
 * `template` is present only for the `$Name` sigil form. `template ListItem { }` names an
 * EXISTING Gtk type — `ast.d.mts` § TemplateNode: the class attribute becomes its GType — so
 * there is no class for the application to register and a `GTypeName` export would hand out
 * `GtkListItem` for `registerClass` to collide with.
 */
export function deriveExports(file) {
    const namespaces = {};
    for (const declared of file.imports) namespaces[declared.namespace] = declared.version;

    let template;
    const objects = [];

    for (const root of file.roots) {
        if (root.kind === 'template') {
            const children = [];
            collectBody(root.body, children);
            if (root.classType === undefined) {
                template = { GTypeName: root.className, children, line: root.line };
            }
            continue;
        }
        if (root.kind === 'menu') {
            collectMenu(root, objects);
            continue;
        }
        collectObject(root, objects);
    }

    for (const object of objects) {
        if (object.id !== RESERVED_KEY) continue;
        throw new BlueprintEmitError(
            `an object id of "${RESERVED_KEY}" collides with the Gtk.Builder that build() returns beside it; rename it`,
            { file: file.file, line: object.line },
        );
    }

    return { namespaces, template, objects };
}

/**
 * The `gi://` specifier one namespace needs, at the version the file declared for it.
 *
 * Throws rather than guessing a widget namespace's version: a `.blp` cannot name `Adw.Bin`
 * without `using Adw 1;`, so an absent version here means the AST and the imports disagree,
 * and a guessed `?version=1` would resolve to a vocabulary nobody asked for.
 */
function specifier(namespace, namespaces, where) {
    const version = namespaces[namespace] ?? IMPLICIT_VERSIONS[namespace];
    if (version === undefined) {
        throw new BlueprintEmitError(`no "using ${namespace} <version>;" line for the type that needs it`, where);
    }
    return `gi://${namespace}?version=${version}`;
}

/** Every namespace a set of identifiers needs, sorted, so the emitted import block is stable. */
const namespacesOf = (identifiers) => [...new Set(identifiers.map((one) => one.namespace))].sort();

const quoteKey = (id) => (isBareKey(id) ? id : JSON.stringify(id));

/**
 * The `x.d.blp.ts` text — what `allowArbitraryExtensions` reads instead of the ambient
 * `declare module '*.blp'` wildcard.
 *
 * `sourceName` is the `.blp`'s OWN name (`header-bar.blp`), never a path, and the caller supplies
 * it because this module cannot work it out. The header is the only thing here that needs a
 * separator, and neither answer is available to a package with NO BUILD STEP that is also bundled
 * into the GJS CLI: `@gjsify/utils/core`'s `lastPathSeparatorIndex` is a BUILT subpath the bare
 * install this gate runs against does not have, and slicing on `'/'` alone is the defect #1143 was
 * about — on win32 it wrote the whole `C:\…\header-bar.blp` into this header. `node:path` is what
 * the callers use, and it is right in all three: the bundler plugin and the sidecar gate run in
 * Node on the machine whose paths they hold, and `@gjsify/node-path` selects its win32 or posix
 * flavour per host at module init, so the CLI's GJS bundle gets the host's own answer too (#1146
 * is the flavour selection that made that so).
 *
 * SPIKED BEFORE ADR 0087 WAS WRITTEN, on TypeScript 6.0.3: the sidecar wins over the wildcard,
 * a `.blp` with no sidecar still falls back to it, and without `allowArbitraryExtensions` the
 * sidecar is ignored — which is the negative control proving the first of the three.
 */
export function emitTypedSidecar(file, sourceName) {
    const { namespaces, template, objects } = deriveExports(file);
    const where = { file: file.file, line: 1 };

    const used = new Set(namespacesOf(template === undefined ? objects : template.children));
    // `Gtk.Builder` is the one type the builder exit needs that no id mentions.
    if (template === undefined && objects.length > 0) used.add('Gtk');
    const imports = [...used].sort();

    const lines = [
        `// GENERATED from ${sourceName} — do not edit. ADR 0087 says what these exports mean.`,
        `// Regenerate with \`gjsify blueprint types\`; \`scripts/check-blueprint-sidecars.mjs\` holds it.`,
        '',
    ];

    for (const namespace of imports) {
        lines.push(`import type ${namespace} from '${specifier(namespace, namespaces, where)}';`);
    }
    if (imports.length > 0) lines.push('');

    lines.push(
        '/** The GtkBuilder XML this `.blp` compiles to. */',
        'declare const xml: string;',
        'export default xml;',
    );

    if (template !== undefined) {
        lines.push(
            '',
            `/** The class \`template $${template.GTypeName}\` defines. */`,
            `export declare const GTypeName: '${template.GTypeName}';`,
        );
        // A template with no ids gets NEITHER, rather than an empty tuple and an empty
        // interface: `extends {}` constrains nothing and `InternalChildren: []` is a list
        // `registerClass` would iterate zero times. The consumer writes what it wrote before —
        // `{ GTypeName, Template }` — and the absence is the honest statement that the template
        // declares no internal child. `toolbar-view.blp` is exactly this file.
        if (template.children.length > 0) {
            lines.push(
                '',
                '/**',
                ' * Every id inside the template, in source order — what `registerClass` is given.',
                ' *',
                ' * A MUTABLE tuple, and the `readonly` is missing for a reason that is not ours: `@girs`',
                " * declares `GObject.MetaInfo['InternalChildren']` as `string[]`, so a `readonly` tuple is",
                ' * refused at the call site with TS4104 and the consumer would have to spread it — the',
                ' * boilerplate ADR 0087 exists to remove. The tuple still pins the exact ids and arity,',
                ' * which is the property that matters. `status/open-todos/blueprint.md` carries the',
                ' * upstream half.',
                ' */',
                `${idTuple(
                    template.children.map((one) => one.id),
                    'export declare const InternalChildren: ',
                )};`,
                '',
                '/** The `_`-prefixed members GJS installs for them. Merge it into the class interface. */',
                'export interface Children {',
                ...template.children.map((one) => `    ${one.member}: ${one.type};`),
                '}',
            );
        }
    }

    if (template === undefined && objects.length > 0) {
        lines.push(
            '',
            '/** What `build()` hands back: the builder, and every id the file declared. */',
            'export interface Built {',
            '    builder: Gtk.Builder;',
            ...objects.map((one) => `    ${quoteKey(one.id)}: ${one.type};`),
            '}',
            '',
            '/** Builds the tree with a fresh `Gtk.Builder`. */',
            'export declare function build(): Built;',
        );
    }

    return `${lines.join('\n')}\n`;
}

/**
 * The MODULE a bundler gets for one `.blp` — the other half of the sidecar above.
 *
 * Both halves live in this one file on purpose: the sidecar DECLARES `build()` and this
 * IMPLEMENTS it, so a change to either is visible beside the other. Split across two packages
 * they would drift into a declaration that lies about a function nobody re-checked.
 *
 * `default` is the XML and does not move (ADR 0087 § 1). A template file gets no `gi://` import
 * at all: `GTypeName` and `InternalChildren` are plain data, and importing Gtk to export two
 * strings would make every template module pull a typelib it never calls.
 */
export function emitTypedModule(file, xml) {
    const { namespaces, template, objects } = deriveExports(file);
    const where = { file: file.file, line: 1 };
    const lines = [];

    if (template === undefined && objects.length > 0) {
        lines.push(`import Gtk from '${specifier('Gtk', namespaces, where)}';`);
        // `Adw.init()` only where the file uses Adwaita, and that call is the whole reason this
        // import exists. MEASURED (showcases/gtk/adw-blueprint-layout/src/app.ts): GtkBuilder
        // resolves a class by GType NAME, so a namespace nothing has touched is unregistered and
        // the build fails with `Invalid object type 'AdwHeaderBar'`, handing back null children.
        if (namespaces.Adw !== undefined) lines.push(`import Adw from '${specifier('Adw', namespaces, where)}';`);
        lines.push('');
    }

    lines.push(`const xml = ${JSON.stringify(xml)};`, 'export default xml;');

    if (template !== undefined) {
        lines.push('', `export const GTypeName = '${template.GTypeName}';`);
        // Both halves agree on the absence — see the sidecar emitter for why there is one.
        if (template.children.length > 0) {
            // The same width rule as the sidecar's declaration, so the two halves of a `.blp`'s
            // types read alike — and so a caller that formats what this emits reflows neither.
            lines.push(
                `${idTuple(
                    template.children.map((one) => one.id),
                    'export const InternalChildren = ',
                )};`,
            );
        }
    }

    if (template === undefined && objects.length > 0) {
        lines.push(
            '',
            'export function build() {',
            ...(namespaces.Adw === undefined ? [] : ['    Adw.init();']),
            '    const builder = Gtk.Builder.new_from_string(xml, -1);',
            '    return {',
            '        builder,',
            ...objects.map((one) => `        ${quoteKey(one.id)}: builder.get_object(${JSON.stringify(one.id)}),`),
            '    };',
            '}',
        );
    }

    return `${lines.join('\n')}\n`;
}

/** `header-bar.blp` → `header-bar.d.blp.ts`. The one spelling, so no caller invents a second. */
export function sidecarPathFor(blueprintPath) {
    if (!blueprintPath.endsWith('.blp')) throw new Error(`not a .blp path: ${blueprintPath}`);
    return `${blueprintPath.slice(0, -'.blp'.length)}.d.blp.ts`;
}
