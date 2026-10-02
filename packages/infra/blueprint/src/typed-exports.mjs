// ADR 0088: the ids a `.blp` declares, derived as TYPED names, plus the `.d.blp.ts` sidecar
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
 * A string literal in the project's own quote, with the two characters that would end it escaped.
 *
 * The old spelling was `'${id}'` beside a `JSON.stringify` for the keys, i.e. two quoting rules
 * in one file — and neither of them the project's. `scripts/generate-widget-methods.mjs` § quoted
 * has the same helper for the same reason.
 */
function quoted(value, format) {
    // The two callers' inputs are an IDENTIFIER (`template $Name`), a `gi://` specifier and a `.blp`
    // id, and none of the three can contain a quote — so the escape below never fires today. It is
    // here because a formatter that gets this wrong picks the OTHER quote rather than escaping
    // (`"it's"` over `'it\'s'` under `singleQuote`), which is a modelled rule that would have to
    // match, and a future id syntax change should not silently become a red `oxfmt --check`.
    const escaped = value.replaceAll('\\', '\\\\').replaceAll(format.quote, `\\${format.quote}`);
    return `${format.quote}${escaped}${format.quote}`;
}

/** One statement, terminated the way the project terminates statements (`semi`). */
const stmt = (text, format) => `${text}${format.semi}`;

/**
 * A list of ids as oxfmt lays it out: one line while the whole line fits, else one id per line.
 *
 * MEASURED both ways before the rule, the two findings `scripts/generate-widget-methods.mjs`
 * § PRINT_WIDTH records for the other generator in this tree: a packed `InternalChildren` was
 * reflowed one id per line, and the reflowed one was collapsed back onto one line wherever it
 * fitted. oxfmt's rule is the WIDTH, so the width comes from the project's own `printWidth` — and
 * an eighth id is what first broke the packed one (showcases/dom/three-postprocessing-pixel).
 */
function idTuple(ids, prefix, format) {
    const oneLine = `${prefix}[${ids.map((id) => quoted(id, format)).join(', ')}]`;
    // The `+ 1` is the trailing comma the reflowed form carries and the packed one does not, so
    // under `trailingComma: "none"` the packed form gets that column back.
    const comma = format.trailingComma ? 1 : 0;
    if (oneLine.length + comma <= format.printWidth) return oneLine;
    // The separator comma is not the trailing one: every id but the last carries a comma whatever
    // `trailingComma` says, and only the LAST id's comma is the setting. Dropping both together
    // (measured, `trailingComma: "none"`) emits an array with no separators at all, which does not
    // parse — so the two are separate here.
    const items = ids.map((id) => `${format.indent}${quoted(id, format)}`).join(`,${format.eol}`);
    return `${prefix}[${format.eol}${items}${format.trailingComma ? ',' : ''}${format.eol}]`;
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
 * Whether every key of one object is quoted, which `quoteProps: 'consistent'` asks for.
 *
 * Measured, not read off the option's name: under `consistent` ONE quoted key pulls every other
 * key in the same object literal or interface member list along, and `preserve` leaves the
 * emitter's own `as-needed` spelling alone. So `consistent` and `as-needed` differ only for a
 * `.blp` that declares BOTH a dashed id and a plain one: the emitter's `Built { "a-b": …; box: … }`
 * becomes `Built { "a-b": …; "box": … }` under `consistent`.
 */
const keysAllQuoted = (ids, format) => format.quoteProps === 'consistent' && ids.some((id) => !isBareKey(id));

/** One key of that object, in the project's quote. A dashed id keeps its spelling either way. */
const keyOf = (id, format, all) => (all || !isBareKey(id) ? quoted(id, format) : id);

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
 * Refuse two ids that would become ONE NAME in the emitted text, naming both and the line.
 *
 * NOTHING UPSTREAM CATCHES THIS. Measured: the parser accepts `Gtk.Label same { }` beside
 * `Gtk.Button same { }` and the XML emitter writes both `id="same"` through — GtkBuilder's own
 * answer is last-one-wins, which is a run-time fact and not a refusal. The emitted TEXT has no
 * such tolerance: two `_a_b` members in one interface is TS2300 "Duplicate identifier", two
 * `same` keys in `Built` is the same error, and the object literal `build()` returns silently
 * drops all but the last. So without this the first reader is `tsc` on a GENERATED file, at a
 * line number that means nothing to whoever wrote the `.blp`.
 *
 * The key differs per exit because the two texts NAME things differently: a template's children
 * collide on the MEMBER, so the distinct ids `a-b` and `a_b` both install `_a_b`, while a
 * builder file's objects collide on the id itself, which `build()` uses as the key verbatim.
 */
function refuseCollisions(identifiers, keyOf, collision, file) {
    const seen = new Map();
    for (const one of identifiers) {
        const key = keyOf(one);
        const first = seen.get(key);
        if (first === undefined) {
            seen.set(key, one);
            continue;
        }
        throw new BlueprintEmitError(collision(first, one, key), { file, line: one.line });
    }
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

    if (template !== undefined) {
        refuseCollisions(
            template.children,
            (one) => one.member,
            (first, second, member) =>
                first.id === second.id
                    ? `two internal children are both named "${second.id}"; rename one`
                    : `the internal children "${first.id}" and "${second.id}" both install "${member}" ` +
                      '(a dash becomes an underscore); rename one',
            file.file,
        );
    }
    refuseCollisions(
        objects,
        (one) => one.id,
        (_first, second) => `two objects are both named "${second.id}", and build() can return the id once; rename one`,
        file.file,
    );

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

/**
 * The project's `.oxfmtrc` options, or a refusal naming the one argument this emitter needs.
 *
 * REQUIRED, not defaulted, and that is the whole point of this function. The emitter used to take
 * no format at all and hardcode four spaces: correct here, wrong in a `tabWidth: 2` project, and
 * the emitter had no way to learn it was wrong. A default would restore exactly that shape one
 * layer down — a caller that forgets the argument gets oxfmt's defaults, which are right for a
 * project with no `.oxfmtrc` and wrong for every project that has one — so a caller that forgets
 * is told instead. `emitFormatFor` is what every caller reaches it through.
 */
function requireFormat(format, emitter) {
    if (format === undefined || typeof format.indent !== 'string') {
        throw new TypeError(
            `${emitter}() needs the project's resolved .oxfmtrc options as its third argument — ` +
                'pass emitFormatFor(parseOxfmtrc(readFileSync(<the .oxfmtrc this project formats with>, "utf8"))). ' +
                'Without them this emitter would guess an indent, which is the defect ADR 0088 § Consequences records.',
        );
    }
    return format;
}

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
 * SPIKED BEFORE ADR 0088 WAS WRITTEN, on TypeScript 6.0.3: the sidecar wins over the wildcard,
 * a `.blp` with no sidecar still falls back to it, and without `allowArbitraryExtensions` the
 * sidecar is ignored — which is the negative control proving the first of the three.
 *
 * `format` is the PROJECT's `.oxfmtrc`, because this text lands in the consumer's tree and
 * `gjsify format --check` there holds it: see `requireFormat` and `oxfmt-config.mjs` § THE
 * INCIDENT. Two `tabWidth: 2` consumers are what that cost when it was not asked for.
 */
export function emitTypedSidecar(file, sourceName, format) {
    const style = requireFormat(format, 'emitTypedSidecar');
    const { namespaces, template, objects } = deriveExports(file);
    const where = { file: file.file, line: 1 };

    const used = new Set(namespacesOf(template === undefined ? objects : template.children));
    // `Gtk.Builder` is the one type the builder exit needs that no id mentions.
    if (template === undefined && objects.length > 0) used.add('Gtk');
    const imports = [...used].sort();

    const lines = [
        `// GENERATED from ${sourceName} — do not edit. ADR 0088 says what these exports mean.`,
        '// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.',
        '',
    ];

    for (const namespace of imports) {
        lines.push(
            stmt(`import type ${namespace} from ${quoted(specifier(namespace, namespaces, where), style)}`, style),
        );
    }
    if (imports.length > 0) lines.push('');

    lines.push(
        '/** The GtkBuilder XML this `.blp` compiles to. */',
        stmt('declare const xml: string', style),
        stmt('export default xml', style),
    );

    if (template !== undefined) {
        lines.push(
            '',
            `/** The class \`template $${template.GTypeName}\` defines. */`,
            stmt(`export declare const GTypeName: ${quoted(template.GTypeName, style)}`, style),
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
                ' * boilerplate ADR 0088 exists to remove. The tuple still pins the exact ids and arity,',
                ' * which is the property that matters. `status/open-todos/blueprint.md` carries the',
                ' * upstream half.',
                ' */',
                stmt(
                    idTuple(
                        template.children.map((one) => one.id),
                        'export declare const InternalChildren: ',
                        style,
                    ),
                    style,
                ),
                '',
                '/** The `_`-prefixed members GJS installs for them. Merge it into the class interface. */',
                'export interface Children {',
                ...template.children.map((one) => `${style.indent}${one.member}: ${one.type}${style.semi}`),
                '}',
            );
        }
    }

    if (template === undefined && objects.length > 0) {
        // `builder` is a bare key beside the ids, so it counts in the `quoteProps: 'consistent'`
        // question: one dashed id pulls it along too, exactly as the formatter would.
        const all = keysAllQuoted(['builder', ...objects.map((one) => one.id)], style);
        lines.push(
            '',
            '/** What `build()` hands back: the builder, and every id the file declared. */',
            'export interface Built {',
            `${style.indent}${keyOf('builder', style, all)}: Gtk.Builder${style.semi}`,
            ...objects.map((one) => `${style.indent}${keyOf(one.id, style, all)}: ${one.type}${style.semi}`),
            '}',
            '',
            '/** Builds the tree with a fresh `Gtk.Builder`. */',
            stmt('export declare function build(): Built', style),
        );
    }

    return `${lines.join(style.eol)}${style.eol}`;
}

/**
 * The MODULE a bundler gets for one `.blp` — the other half of the sidecar above.
 *
 * Both halves live in this one file on purpose: the sidecar DECLARES `build()` and this
 * IMPLEMENTS it, so a change to either is visible beside the other. Split across two packages
 * they would drift into a declaration that lies about a function nobody re-checked.
 *
 * `default` is the XML and does not move (ADR 0088 § 1). A template file gets no `gi://` import
 * at all: `GTypeName` and `InternalChildren` are plain data, and importing Gtk to export two
 * strings would make every template module pull a typelib it never calls.
 *
 * `format` for the same reason as the sidecar's, and it is REQUIRED for the same reason: this
 * text is handed to a bundler, so no formatter ever reads it, and the only reason to format it
 * at all is that the two halves of a `.blp`'s types then read alike. `const xml = …` is the one
 * place the project's quote is NOT applied, deliberately: `JSON.stringify` is what escapes the
 * XML correctly, and GtkBuilder XML is full of `"`, so re-quoting it would mean unescaping and
 * re-escaping a document whose bytes must survive the trip exactly.
 */
export function emitTypedModule(file, xml, format) {
    const style = requireFormat(format, 'emitTypedModule');
    const { namespaces, template, objects } = deriveExports(file);
    const where = { file: file.file, line: 1 };
    const lines = [];

    if (template === undefined && objects.length > 0) {
        lines.push(stmt(`import Gtk from ${quoted(specifier('Gtk', namespaces, where), style)}`, style));
        // `Adw.init()` only where the file uses Adwaita, and that call is the whole reason this
        // import exists. MEASURED (showcases/gtk/adw-blueprint-layout/src/app.ts): GtkBuilder
        // resolves a class by GType NAME, so a namespace nothing has touched is unregistered and
        // the build fails with `Invalid object type 'AdwHeaderBar'`, handing back null children.
        if (namespaces.Adw !== undefined) {
            lines.push(stmt(`import Adw from ${quoted(specifier('Adw', namespaces, where), style)}`, style));
        }
        lines.push('');
    }

    lines.push(stmt(`const xml = ${JSON.stringify(xml)}`, style), stmt('export default xml', style));

    if (template !== undefined) {
        lines.push('', stmt(`export const GTypeName = ${quoted(template.GTypeName, style)}`, style));
        // Both halves agree on the absence — see the sidecar emitter for why there is one.
        if (template.children.length > 0) {
            // The same width rule as the sidecar's declaration, so the two halves of a `.blp`'s
            // types read alike — and so a caller that formats what this emits reflows neither.
            lines.push(
                stmt(
                    idTuple(
                        template.children.map((one) => one.id),
                        'export const InternalChildren = ',
                        style,
                    ),
                    style,
                ),
            );
        }
    }

    if (template === undefined && objects.length > 0) {
        const inner = style.indent.repeat(2);
        const all = keysAllQuoted(['builder', ...objects.map((one) => one.id)], style);
        lines.push(
            '',
            'export function build() {',
            ...(namespaces.Adw === undefined ? [] : [`${style.indent}${stmt('Adw.init()', style)}`]),
            `${style.indent}${stmt('const builder = Gtk.Builder.new_from_string(xml, -1)', style)}`,
            `${style.indent}return {`,
            `${inner}builder,`,
            // No terminator on a property: the comma IS the separator, and there is no `;` inside
            // an object literal for `semi` to remove.
            ...objects.map(
                (one) => `${inner}${keyOf(one.id, style, all)}: builder.get_object(${quoted(one.id, style)}),`,
            ),
            `${style.indent}}${style.semi}`,
            '}',
        );
    }

    return `${lines.join(style.eol)}${style.eol}`;
}

/** `header-bar.blp` → `header-bar.d.blp.ts`. The one spelling, so no caller invents a second. */
export function sidecarPathFor(blueprintPath) {
    if (!blueprintPath.endsWith('.blp')) throw new Error(`not a .blp path: ${blueprintPath}`);
    return `${blueprintPath.slice(0, -'.blp'.length)}.d.blp.ts`;
}
