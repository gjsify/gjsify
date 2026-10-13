// GTK properties whose NAME a `@nativescript/core` base already owns — the one table, and the
// one router every door of this package goes through for them (ADR 0112).
//
// THE RULE. A port class never declares a JS accessor under a name its platform base already
// declares. Re-declaring one is TS2416 for every consumer that compiles our `lib/types` without
// `skipLibCheck` (the type differs), and at runtime it takes the name away from NativeScript's
// own machinery: `ViewCommon.direction` is the CSS layout direction the layout pass reads,
// `ViewCommon.modal` the parent a view was shown modally from, `GridLayoutBase.rows` the track
// spec. So the GTK property keeps every door GJS has that is NOT the JS accessor —
// `get_<p>()` / `set_<p>()`, `get_property` / `set_property('<p>')`, `notify::<p>`, a Blueprint
// or `.ui` `<property name>`, a `bind` — and the accessor stays NativeScript's. That is a true
// subset of GJS: a snippet that writes `button.set_direction(Gtk.ArrowType.UP)` runs verbatim;
// one that writes `button.direction = …` reaches NativeScript's member, as it would on any view.
//
// THE TABLE IS A MEASUREMENT, NOT A WISH. `scripts/check-gtk-host-member-clashes.mjs` intersects
// every port class's GIR properties (and the accessors the port invented) with the members its
// platform base declares — read off `@nativescript/core`'s own typings into
// `status/nativescript-base-members.json` — and fails when the result is not exactly the names
// below: a new GTK property that lands on a NativeScript name has to be decided here first.
//
// Each name takes one of three doors:
//   · ROUTED for the GType names in `routed`: the class implements `get_<p>` / `set_<p>`, and
//     every builder write and construct-props key of that name goes there.
//   · REFUSED for the GIR types in `refused`: the port does not implement that GTK property, and
//     without this entry an authored `modal: true` on a `Gtk.Window` would have been written to
//     `View.modal` — a getter — and thrown, or `css-classes` would have replaced the `Set`
//     `ViewBase` keeps its classes in. Refused by name instead.
//   · SHARED ({@link SHARED_PROPERTIES}): the NativeScript member means what the GTK property
//     means, so the platform's own accessor IS the door and nothing is routed.

/** One GTK property name that a NativeScript base owns as something else. */
export interface ShadowedProperty {
    /** The platform member the name lands on, and what it is there. */
    readonly nativeScript: string;
    /** GType names whose GTK property of this name the port implements through `get_<p>` / `set_<p>`. */
    readonly routed: readonly string[];
    /** GIR types declaring a property of this name the port does not implement. */
    readonly refused: readonly string[];
}

export const SHADOWED_PROPERTIES = {
    columns: {
        nativeScript: "GridLayoutBase.columns — the column track spec ('auto,*'), setter-only",
        routed: ['AdwDataGrid'],
        refused: [],
    },
    cssClasses: {
        nativeScript: "ViewBase.cssClasses — the Set the view's own class list lives in",
        routed: [],
        // `styles [...]` and `styleClasses` are the port's door to the class list.
        refused: ['GtkWidget'],
    },
    direction: {
        nativeScript: "ViewCommon.direction — the CSS layout direction ('ltr' | 'rtl') margins resolve by",
        routed: ['AdwSplitButton'],
        refused: ['GtkMenuButton'],
    },
    modal: {
        nativeScript: 'ViewCommon.modal — the view this one was shown modally from, getter-only',
        routed: ['AdwBottomSheet'],
        refused: ['GtkWindow'],
    },
    rows: {
        nativeScript: "GridLayoutBase.rows — the row track spec ('auto,*'), setter-only",
        routed: ['AdwDataGrid'],
        refused: [],
    },
    visibility: {
        nativeScript: "View.visibility — 'visible' | 'hidden' | 'collapse'",
        routed: [],
        refused: ['GtkEntry'],
    },
} as const satisfies Readonly<Record<string, ShadowedProperty>>;

/** Every name {@link SHADOWED_PROPERTIES} decides. */
export type ShadowedName = keyof typeof SHADOWED_PROPERTIES;

/** A GTK property the NativeScript member of the same name already carries, and why that is enough. */
export interface SharedProperty {
    /** The GIR type that declares it. */
    readonly declarer: string;
    readonly why: string;
}

export const SHARED_PROPERTIES = {
    marginBottom: {
        declarer: 'GtkWidget',
        why: 'View.marginBottom is the same outer spacing; a GTK pixel count is a valid NativeScript length.',
    },
    marginTop: {
        declarer: 'GtkWidget',
        why: 'View.marginTop is the same outer spacing; a GTK pixel count is a valid NativeScript length.',
    },
    opacity: {
        declarer: 'GtkWidget',
        why: 'View.opacity is the same 0..1 alpha.',
    },
    orientation: {
        declarer: 'GtkOrientable',
        why: "StackLayout.orientation takes the same two nicks, 'horizontal' and 'vertical'.",
    },
} as const satisfies Readonly<Record<string, SharedProperty>>;

/** How a GTK property name reaches a given object. */
export type GtkPropertyDoor =
    | { readonly kind: 'accessor' }
    | { readonly kind: 'verbs'; readonly get: string; readonly set: string }
    | { readonly kind: 'refused'; readonly why: string }
    | { readonly kind: 'absent' };

/** The GType names along `target`'s prototype chain, nearest first. */
function gtypeNames(target: object): string[] {
    const names: string[] = [];
    for (
        let proto: object | null = Object.getPrototypeOf(target);
        proto !== null;
        proto = Object.getPrototypeOf(proto)
    ) {
        const ctor = (proto as { constructor?: unknown }).constructor;
        if (typeof ctor === 'function' && Object.hasOwn(ctor, 'GTypeName')) {
            const name = (ctor as { GTypeName?: unknown }).GTypeName;
            if (typeof name === 'string') names.push(name);
        }
    }
    return names;
}

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * A GObject property name (`'can-close'`, `'can_close'`, `'canClose'`) in the camel case the
 * port's members use — `propertyOf` from `@gjsify/adwaita-core/tags`, restated here so every
 * widget importing `signals.js` does not reach adwaita-core through it.
 */
export const camelProperty = (name: string) =>
    name.replace(/[-_]([a-z0-9])/g, (_match, next: string) => next.toUpperCase());

/**
 * Where an assignment or read of the camel-case GTK property `prop` lands on `target`: the
 * class's own accessor, its `get_<p>` / `set_<p>` pair, a refusal, or nowhere.
 */
export function gtkPropertyDoor(target: object, prop: string): GtkPropertyDoor {
    if (!Object.hasOwn(SHADOWED_PROPERTIES, prop)) return prop in target ? { kind: 'accessor' } : { kind: 'absent' };
    const entry: ShadowedProperty = SHADOWED_PROPERTIES[prop as ShadowedName];
    const chain = gtypeNames(target);
    const owner = entry.routed.find((gtype) => chain.includes(gtype));
    const get = `get_${snake(prop)}`;
    const set = `set_${snake(prop)}`;
    const verbs = target as Record<string, unknown>;
    if (owner !== undefined && typeof verbs[get] === 'function' && typeof verbs[set] === 'function') {
        return { kind: 'verbs', get, set };
    }
    return {
        kind: 'refused',
        why:
            `'${prop}' is ${entry.nativeScript} on this platform, and ${chain[0] ?? target.constructor.name} ` +
            `implements no GTK property of that name behind \`${set}()\` — writing it would reach ` +
            "NativeScript's member instead (scripts/check-gtk-host-member-clashes.mjs).",
    };
}

/** Whether {@link writeGtkProperty} has somewhere to put `prop`. */
export function hasGtkProperty(target: object, prop: string): boolean {
    const door = gtkPropertyDoor(target, prop);
    return door.kind === 'accessor' || door.kind === 'verbs';
}

/** Why `prop` is refused on `target`, or `null` when it is not one of the shadowed names. */
export function gtkPropertyRefusal(target: object, prop: string): string | null {
    const door = gtkPropertyDoor(target, prop);
    return door.kind === 'refused' ? door.why : null;
}

/** Read the GTK property `prop`, through `get_<p>()` where the name is NativeScript's. */
export function readGtkProperty(target: object, prop: string): unknown {
    const door = gtkPropertyDoor(target, prop);
    if (door.kind === 'verbs') return (target as Record<string, () => unknown>)[door.get]();
    if (door.kind === 'refused') throw new TypeError(door.why);
    return (target as Record<string, unknown>)[prop];
}

/** Write the GTK property `prop`, through `set_<p>()` where the name is NativeScript's. */
export function writeGtkProperty(target: object, prop: string, value: unknown): void {
    const door = gtkPropertyDoor(target, prop);
    if (door.kind === 'verbs') {
        (target as Record<string, (value: unknown) => void>)[door.set](value);
        return;
    }
    if (door.kind === 'refused') throw new TypeError(door.why);
    (target as Record<string, unknown>)[prop] = value;
}
