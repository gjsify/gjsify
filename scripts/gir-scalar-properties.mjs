// The GIR side of every "does this surface carry its widget's properties" check.
//
// ONE READER, TWO RATCHETS. `check-adwaita-element-properties.mjs` holds the web
// elements against it and `check-nativescript-widget-coverage.mjs` holds the
// NativeScript widgets against it. They ask the same question of the same file — which
// scalar properties does `generated/props.ts` say this GType declares — and the moment
// that lived in two places the two backlogs could disagree about what a property IS
// while both stayed green. The repo rule this follows is the one about the SECOND copy
// being where you lift.
//
// WHAT COUNTS AS A SCALAR, and why the two exclusions are not a way of hiding findings
// (the reasoning is `check-adwaita-element-properties.mjs`'s, kept with the code it
// belongs to):
//
//   · SIGNAL props (`on-clicked`, `on-notify-*`) are a JSX convention. A custom element
//     dispatches events; a NativeScript view takes `addEventListener`. Neither is a
//     property either surface could carry under that name.
//   · WIDGET-VALUED props (`child`, `content`, `sidebar`, `title-widget` — anything
//     typed `Gtk.*`/`Adw.*`/`Gio.*`/`Gdk.*`/`Pango.*`/`GObject.*` and NOT an enum) are
//     SLOTS on both renderers: an HTML attribute cannot carry a widget and neither can
//     an XML one, where `component-builder` assigns `instance[name] = "<raw string>"`.
//
// ENUMS ARE NOT EXCLUDED although the namespace test would catch them: the generator
// spells one `AdwToolbarStyleNick | Adw.ToolbarStyle`, and a nick is a STRING — which is
// exactly what ADR 0034 § 4 names as the convergent spelling for both surfaces.
//
// THE OWN BODY, NOT THE `extends` CHAIN. Both ratchets ask what the GType ITSELF
// declares. Resolving the chain would put the whole of `GtkWidget` behind every widget
// and produce a number nobody can act on — the three rungs of that ladder are measured in
// `status/open-todos.md` rather than written here, because a count in a comment is the
// copy that drifts. The chain-resolved set is the right one for the opposite question (is
// a property a surface HAS a key of its counterpart), which is what
// `check-vocabulary-alignment.mjs` uses it for.

/** A GIR type that holds an object — a slot on either renderer, never an attribute. */
const OBJECT_TYPE = /\b(?:Gtk|Adw|Gio|Gdk|Pango|GObject)\.\w+/;

/**
 * An ENUM, which {@link OBJECT_TYPE} also matches and must not exclude.
 *
 * The generator spells an enum property `AdwToolbarStyleNick | Adw.ToolbarStyle`, so the
 * namespaced half makes it look object-typed. It is not: a nick is a STRING, exactly what
 * an attribute carries. The proof that these belong to the checked surface is that 17 of
 * them are already observed as attributes today (`adw-banner/button-style`,
 * `adw-dialog/presentation-mode`, `adw-toolbar-view/top-bar-style`, …). Excluding them
 * would have hidden 14 real gaps behind a justification — "an attribute cannot carry a
 * widget" — that does not apply to them.
 */
const ENUM_TYPE = /\b\w+Nick\b/;

/** `canShrink` → `can-shrink`: the second spelling the generator emits beside it. */
export const kebabName = (name) => name.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`);

/** `tag -> GType`, from the runtime widget table. */
export function tagGTypes(widgetsSource) {
    const map = new Map();
    for (const m of widgetsSource.matchAll(/gtype: '([^']+)', tag: '([^']+)'/g)) map.set(m[2], m[1]);
    return map;
}

/**
 * `<GType> -> interface body`, brace-MATCHED rather than regex-bounded.
 *
 * A lazy `[\s\S]*?\n\}` reads an EMPTY interface as the next one's body, which silently
 * credited `adw-spinner` with `AdwSplitButton`'s properties while this was being built.
 */
export function propsBodies(propsSource) {
    const bodies = new Map();
    // `extends\s`, NOT `extends ` — the generator wraps long heritage lists onto the
    // next line, and a literal space missed 65 of 190 interfaces. Each one then had no
    // body, and `propertyProblems` skipped its element as unmapped: eight `adw-*`
    // elements passed by being invisible. A vector pins it.
    //
    // `\s*` before the brace is the SAME defect one clause over, and it was live here
    // after the first one was fixed: `[^{]*` swallows the space only when `extends` is
    // present, so an interface declared WITHOUT one — `export interface AdwToggleProps
    // {` — never matched. 13 interfaces were invisible that way, and the @girs 4.5.0
    // vocabulary took it to 25 by dropping the empty `GObject` base: `<adw-toggle>`
    // left this check silently, and surfaced only as five KNOWN_GAPS entries reported
    // as stale. `girs-vocabulary.mts` carries the identical rule and its own vector.
    const head = /export interface (\w+)Props(?:\s+extends\s[^{]*)?\s*\{/g;
    let m;
    while ((m = head.exec(propsSource))) {
        let depth = 1;
        let i = head.lastIndex;
        while (i < propsSource.length && depth > 0) {
            const c = propsSource[i];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            i++;
        }
        bodies.set(m[1], propsSource.slice(head.lastIndex, i - 1));
    }
    return bodies;
}

/**
 * The scalar properties of one interface body, as `kebab-spelling -> camelSpelling`.
 *
 * BOTH SPELLINGS, because the two surfaces write different ones and neither may be
 * derived by a second transformation: an HTML attribute is `can-shrink` and a
 * NativeScript setter is `canShrink`, and the generator itself emits the pair
 * (`canShrink?: boolean;` beside `'can-shrink'?: boolean;`). Reading the camel spelling
 * out of the source rather than mapping back from the kebab one is the difference
 * between a fact and a round-trip assumption — `imModule`/`im-module` round-trips today
 * and nothing guarantees the next generated name will.
 *
 * A property the generator emits ONLY as a quoted kebab name maps to the camelCase form
 * derived from it, which is the honest fallback: there is no second spelling to read.
 */
export function scalarPropertyNames(body) {
    /** @type {Map<string, string>} */
    const names = new Map();
    for (const line of body.split('\n')) {
        const m = /^\s*(?:'([a-z0-9-]+)'|([a-zA-Z][a-zA-Z0-9]*))\?:\s*(.+?);\s*$/.exec(line);
        if (!m) continue;
        const camel = m[2] ?? m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const name = m[1] ?? kebabName(m[2]);
        if (name.startsWith('on-')) continue;
        if (OBJECT_TYPE.test(m[3]) && !ENUM_TYPE.test(m[3])) continue;
        // The quoted kebab line usually comes SECOND, and it carries no camel spelling
        // of its own; the camel line is the authority, so the first entry wins.
        if (!names.has(name)) names.set(name, camel);
    }
    return names;
}

/**
 * The scalar property names of one interface body, kebab-spelled and deduplicated.
 *
 * The generator emits multiword properties TWICE — `canOpen?: boolean;` and
 * `'can-open'?: boolean;` — so without the dedupe every multiword gap counts double.
 */
export const scalarProps = (body) => new Set(scalarPropertyNames(body).keys());

/**
 * The fixture both ratchets prove the reader on, and every shape it has been wrong about.
 *
 * It lives here rather than in either check for the reason the reader does: two copies
 * of a fixture is two definitions of what a scalar property is.
 */
export const GIR_FIXTURE_PROPS = `
export interface DemoWidgetProps extends GtkWidgetProps {
    /** A scalar. */
    label?: string;
    /** Multiword, emitted twice by the generator. */
    canShrink?: boolean;
    'can-shrink'?: boolean;
    /** An ENUM — namespaced, but a nick is a string an attribute carries. */
    barStyle?: AdwBarStyleNick | Adw.BarStyle;
    'bar-style'?: AdwBarStyleNick | Adw.BarStyle;
    /** A slot, not an attribute. */
    child?: Gtk.Widget | null;
    /** A signal, not a property. */
    'on-clicked'?: () => void;
}
export interface RootWidgetProps {
    /** Reachable ONLY if the head reader tolerates a space before the brace. */
    rooted?: string;
}
export interface EmptyWidgetProps extends GtkWidgetProps {}
export interface AfterEmptyProps extends GtkWidgetProps {
    trap?: string;
}
export interface WrappedWidgetProps
    extends GtkWidgetProps,
        GtkAccessibleProps,
        GtkBuildableProps {
    /** Reachable ONLY if the head reader tolerates a newline after \`extends\`. */
    wrapped?: string;
}
`;

/** Every scalar `DemoWidget` offers, kebab-spelled — an enum among them, on purpose. */
export const GIR_FIXTURE_SCALARS = ['label', 'can-shrink', 'bar-style'];

/**
 * The reader's own vectors, run by BOTH ratchets before either reads the repository.
 *
 * @returns {string[]} failures, empty when the reader is sound
 */
export function girReaderSelfTest() {
    const failures = [];
    const bodies = propsBodies(GIR_FIXTURE_PROPS);
    if (scalarProps(bodies.get('EmptyWidget') ?? '').size !== 0) {
        failures.push('an empty interface must have no properties — the body reader ran past its closing brace');
    }
    if (!scalarProps(bodies.get('AfterEmpty') ?? '').has('trap')) {
        failures.push('the interface after an empty one must still be read');
    }
    if (!bodies.has('WrappedWidget')) {
        failures.push('an interface whose `extends` list wraps must be found — the head reader needs `\\s`');
    }
    if (!bodies.has('RootWidget')) {
        failures.push('an interface with no `extends` must be found — the head reader needs `\\s*` before `{`');
    }
    const demo = scalarProps(bodies.get('DemoWidget') ?? '');
    for (const property of GIR_FIXTURE_SCALARS) {
        if (!demo.has(property)) failures.push(`DemoWidget must expose '${property}' as a scalar`);
    }
    if (demo.has('child')) failures.push('a widget-valued property must not count as a scalar');
    if (demo.size !== GIR_FIXTURE_SCALARS.length) {
        failures.push(`DemoWidget must expose ${GIR_FIXTURE_SCALARS.length} scalars, got ${[...demo].join(', ')}`);
    }
    // The camel half, which the NativeScript ratchet keys on: it must be READ from the
    // source line, not derived from the kebab one. A reader that returned the kebab name
    // twice would satisfy every assertion above and hand that surface a setter name no
    // class has.
    const camels = scalarPropertyNames(bodies.get('DemoWidget') ?? '');
    if (camels.get('can-shrink') !== 'canShrink') {
        failures.push(`'can-shrink' must carry the camel spelling 'canShrink', got '${camels.get('can-shrink')}'`);
    }
    if (camels.get('label') !== 'label') failures.push("a single-word property's camel spelling is itself");
    return failures;
}
