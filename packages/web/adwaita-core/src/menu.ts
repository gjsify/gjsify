// The portable menu model — `GMenuModel`'s own shape, in plain data (ADR 0042).
//
// A menu is the one piece of Adwaita a declarative dialect could not express: on GJS it
// is a `Gio.Menu` built imperatively, on NativeScript it was a bare `string[]`, and in
// the website gallery `Adw.SplitButton`, `Gtk.MenuButton` and `Gtk.PopoverMenu` carried
// no Solid/Vue/React snippet at all — "its menu is a Gio.MenuModel, built imperatively".
// This module is the value those three surfaces now share.
//
// IT MIRRORS `GMenuModel`, IT DOES NOT INVENT A MENU. A `GMenuModel` is a list of ITEMS,
// each carrying ATTRIBUTES (`label`, `action`, `icon`, …) and LINKS (`section`,
// `submenu`) to further models. The three node kinds below are those two links plus the
// plain item.
//
// WHAT IT CARRIES, EXACTLY: every attribute `gtkpopovermenu.c:99-131` lists — for items,
// sections and submenus — plus `accel`, which that list omits and
// `gtkmenutrackeritem.c:731` reads, plus `id`, which is ours. Nothing else. `target` is
// the one attribute with no field of its own, because it travels inside the detailed
// action name (see {@link AdwMenuItem.action}), and GIO writes it out again.
//
// The FIRST version of this file claimed "nothing was invented and nothing was left
// out" while silently dropping `submenu-action` and `gtk-macos-special` — both
// documented, both read by `gtkmenutrackeritem.c`, both measured coming back `null`
// through a GIO round trip. A completeness claim nothing enumerates is a claim nobody
// can check, which is why the enumeration is above and the round trip in
// `@gjsify/gtk-host`'s `menu.spec.ts` is what holds it.
//
// THE THREE DELIBERATE DIVERGENCES, each stated where it lives:
//
//   1. `enabled` and `checked` are NOT item fields. Measured in
//      `gtkmenutrackeritem.c`: `sensitive` is the ACTION's `enabled` flag (c:332), and
//      `toggled`/`role` come from the action's STATE compared against the item's
//      `target`. Putting them on the item would make a model no `Gio.Menu` can hold —
//      the silent drop this design exists to prevent. They arrive instead through
//      {@link AdwMenuActions}, the portable stand-in for what a `GActionGroup`
//      publishes, and {@link resolveMenuItemState} folds the two exactly as C does.
//   2. `action` carries a DETAILED action name (`app.view::list`), not an action name
//      plus a separately encoded target. That is `g_action_parse_detailed_name`'s own
//      text form, so it is lossless for every target type without this module having to
//      invent a JSON encoding for `GVariant` — the place a portable model would
//      otherwise have to guess `int32` from a JS number.
//   3. A node's KIND is carried explicitly on the normalised form and structurally on
//      the input form. GtkBuilder's menu XML does the same: `<section>`/`<submenu>` are
//      sugar for `<link name="section">`/`<link name="submenu">`.
//
// WHAT A SURFACE CANNOT DRAW is declared rather than dropped in silence, and the split
// is three-way: STRUCTURE (items, sections, submenus, labels, actions) is portable and
// never lost; DECORATION (`icon`, `verbIcon`, `accel`, `useMarkup`, `displayHint`) is
// best-effort per surface; and `custom` — which names an application WIDGET, not a
// label — is refused by name off GTK, because a surface with no
// `gtk_popover_menu_add_child` would otherwise render a blank row where a control
// belongs. {@link assertMenuRenderable} is that refusal.
//
// PLATFORM-NEUTRAL: pure data and pure functions. `Gio.Menu` construction is the GTK
// renderer's half and lives in `@gjsify/gtk-host`, which cannot be imported here.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (the attribute list, `## Menu models`)
// Reference: refs/gtk/gtk/gtkmenutrackeritem.c (role/sensitive/visible derivation)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * The values `hidden-when` is documented to take.
 *
 * A union rather than `string` because each one has its OWN visibility rule in
 * {@link resolveMenuItemState}; an unrecognised value is ignored by C on purpose ("this
 * code may be running in context of a desktop shell … and should not spew criticals"),
 * which {@link normalizeMenuModel} reproduces by dropping it.
 */
export type AdwMenuHiddenWhen = 'action-disabled' | 'action-missing' | 'macos-menubar';

/** A section's `display-hint`, which asks for a row of buttons instead of a list. */
export type AdwMenuDisplayHint = 'horizontal-buttons' | 'circular-buttons' | 'inline-buttons';

/** A section's `text-direction`, read only when {@link AdwMenuDisplayHint} is horizontal. */
export type AdwMenuTextDirection = 'ltr' | 'rtl' | 'none';

/**
 * One menu item — the attributes `GtkPopoverMenu` documents, plus `id`.
 *
 * `id` is OURS and has no meaning to GTK. It survives the round trip anyway, because a
 * `GMenuModel`'s attribute space is open (`g_menu_item_set_attribute` takes any name and
 * GTK ignores what it does not know), so carrying it is not a divergence — it is an
 * unread attribute, exactly like an application's own. It exists because the two
 * renderers' activation events already reported one, falling back to the label.
 */
export interface AdwMenuItem {
    readonly kind: 'item';
    /** The user-visible string. `''` for an item that has none — never `undefined`. */
    readonly label: string;
    /**
     * The DETAILED action name — `app.save-as`, `app.view::list`, `win.zoom(2)`.
     *
     * One string rather than an action plus a target, because that is what
     * `g_menu_item_set_detailed_action` takes and what `g_action_parse_detailed_name`
     * can read back for every `GVariant` target type. {@link parseDetailedAction} splits
     * it where a surface needs the halves.
     */
    readonly action?: string;
    /** Symbolic icon name shown beside the label. */
    readonly icon?: string;
    /** Icon for the button form a `display-hint` section draws instead of a row. */
    readonly verbIcon?: string;
    /** Accelerator text, e.g. `<Control>s`. Display only — it binds nothing. */
    readonly accel?: string;
    /** When this item disappears rather than merely dimming. */
    readonly hiddenWhen?: AdwMenuHiddenWhen;
    /** Names an application widget the surface must host in place of a row. */
    readonly custom?: string;
    /** Whether {@link label} is Pango markup. */
    readonly useMarkup?: boolean;
    /** Stable identifier for activation reporting; defaults to {@link label}. */
    readonly id?: string;
}

/**
 * A `section` link: items drawn inline, separated from their neighbours.
 *
 * A section is NOT a container the user opens — it is a visual grouping, which is why a
 * flat surface may inline it ({@link flattenMenu}) without losing an item.
 */
export interface AdwMenuSection {
    readonly kind: 'section';
    /** Optional heading above the group. */
    readonly label?: string;
    readonly displayHint?: AdwMenuDisplayHint;
    readonly textDirection?: AdwMenuTextDirection;
    readonly items: readonly AdwMenuNode[];
}

/**
 * A `submenu` link: a nested menu the user opens.
 *
 * `submenuAction` is documented under ITEMS (`gtkpopovermenu.c:106-107`) rather than
 * under submenus, and it is here anyway: it names the action that tracks whether the
 * submenu is OPEN, so the only item it can sit on is the one carrying the link — which
 * in this model IS this node. `gtkmenutrackeritem.c:822` and `:1049` read it, and both
 * paths are submenu paths.
 */
export interface AdwMenuSubmenu {
    readonly kind: 'submenu';
    readonly label: string;
    readonly icon?: string;
    /** Action tracking whether this submenu is shown (`submenu-action`). */
    readonly submenuAction?: string;
    /**
     * `gtk-macos-special` — macOS menu-bar meaning, ignored everywhere else
     * (`gtkpopovermenu.c:130-131`, read at `gtkmenutrackeritem.c:761`).
     *
     * Carried and never acted on here: no renderer in this workspace exports a macOS
     * menu bar. It is in the model so that a menu written for one survives the trip,
     * which is the whole lossless claim.
     */
    readonly macosSpecial?: string;
    readonly items: readonly AdwMenuNode[];
}

/** Any node of a normalised model. */
export type AdwMenuNode = AdwMenuItem | AdwMenuSection | AdwMenuSubmenu;

/**
 * A normalised menu: the value a renderer walks and the GTK host converts.
 *
 * `readonly` throughout, because every renderer holds one across a render and a shared
 * mutable tree is how two widgets showing the same menu would diverge.
 */
export type AdwMenuModel = readonly AdwMenuNode[];

// --- The input form: what an author may write ------------------------------------

/** An item as authored — `kind` is implied by the absence of a link. */
export interface AdwMenuItemInput {
    label?: unknown;
    action?: unknown;
    icon?: unknown;
    verbIcon?: unknown;
    accel?: unknown;
    hiddenWhen?: unknown;
    custom?: unknown;
    useMarkup?: unknown;
    id?: unknown;
}

/** A section as authored — the `section` key IS the link. */
export interface AdwMenuSectionInput {
    section: readonly AdwMenuEntryInput[];
    label?: unknown;
    displayHint?: unknown;
    textDirection?: unknown;
}

/** A submenu as authored — the `submenu` key IS the link. */
export interface AdwMenuSubmenuInput {
    submenu: readonly AdwMenuEntryInput[];
    label?: unknown;
    icon?: unknown;
    submenuAction?: unknown;
    macosSpecial?: unknown;
}

/**
 * One authored entry.
 *
 * A BARE STRING is a label-only item, and that form is not a NativeScript leftover: it
 * is the model's own shorthand, the same one {@link normalizeComboOptions} gives an
 * option list, and it is now accepted on every surface rather than on one. What it
 * cannot carry — an action, an icon, a section — is exactly what made
 * `button.menu = ['Save as…']` unable to grow, so the shorthand widens INTO this union
 * instead of standing beside it.
 */
export type AdwMenuEntryInput = string | AdwMenuItemInput | AdwMenuSectionInput | AdwMenuSubmenuInput;

/** A menu as authored, before {@link normalizeMenuModel} has seen it. */
export type AdwMenuInput = readonly AdwMenuEntryInput[];

const HIDDEN_WHEN: readonly AdwMenuHiddenWhen[] = ['action-disabled', 'action-missing', 'macos-menubar'];
const DISPLAY_HINTS: readonly AdwMenuDisplayHint[] = ['horizontal-buttons', 'circular-buttons', 'inline-buttons'];
const TEXT_DIRECTIONS: readonly AdwMenuTextDirection[] = ['ltr', 'rtl', 'none'];

/** A string-valued attribute, or `undefined` — never a number leaked into a string field. */
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A member of a closed attribute vocabulary, or `undefined`. C ignores what it cannot name. */
function oneOf<T extends string>(members: readonly T[], value: unknown): T | undefined {
    return typeof value === 'string' && (members as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Assign `key` only when `value` is set, so an absent attribute stays ABSENT rather than `undefined`. */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
    if (value !== undefined) target[key] = value;
}

/**
 * Authored entries → the normalised model every renderer walks.
 *
 * TOTAL BY CONSTRUCTION. The input reaches this function from author-written markup (a
 * JSON attribute, an XML attribute, a JSX expression), and a typo must not take the
 * widget down with it — the same rule the `menu` attribute parser it replaces already
 * had. So an unusable entry is DROPPED and an unusable attribute is omitted; nothing
 * here throws. The loud half is {@link assertMenuRenderable}, which runs against a
 * SURFACE and can therefore say something true about what will not be drawn.
 *
 * A link wins over the attributes beside it: `{ label: 'More', submenu: [...] }` is a
 * submenu with a label, never an item that happens to carry a list, because that is how
 * `g_menu_item_get_link` reads the same object.
 */
export function normalizeMenuModel(input: AdwMenuInput | null | undefined): AdwMenuModel {
    if (!Array.isArray(input)) return [];
    const nodes: AdwMenuNode[] = [];
    for (const raw of input) {
        const node = normalizeEntry(raw);
        if (node !== null) nodes.push(node);
    }
    return nodes;
}

function normalizeEntry(raw: AdwMenuEntryInput): AdwMenuNode | null {
    if (typeof raw === 'string') return { kind: 'item', label: raw };
    if (raw === null || typeof raw !== 'object') return null;

    // The LINKS first: `section` and `submenu` decide the kind, and an item is what is
    // left. Reading the attributes first and the link second is how `{ submenu: [] }`
    // came out as an item with a stray array on it.
    const record = raw as Record<string, unknown>;
    // AN ALREADY-NORMALISED NODE IS ALSO LEGAL INPUT, which is what makes this function
    // IDEMPOTENT — `normalize(normalize(x))` is `normalize(x)`. Not a convenience: a
    // renderer hands back the model it was given (`state.menuModel` into
    // `setMenuModel`), and a normalised section carries its children under `items`
    // rather than `section`, so without this arm the second pass would read it as an
    // attribute-only item and DROP the whole group.
    if (Array.isArray(record.items) && (record.kind === 'section' || record.kind === 'submenu')) {
        // `items` and `kind` are REMOVED, not merely shadowed: leaving them on would
        // re-enter this very branch on the next call and recurse until the stack ran
        // out. Measured — twelve suites failed with `Maximum call stack size exceeded`
        // the first time this arm shipped.
        const { items, kind, ...attributes } = record;
        return normalizeEntry({ ...attributes, [kind as 'section' | 'submenu']: items } as AdwMenuEntryInput);
    }
    if (Array.isArray(record.section)) {
        const section: AdwMenuSection = { kind: 'section', items: normalizeMenuModel(record.section) };
        const mutable = section as { -readonly [K in keyof AdwMenuSection]: AdwMenuSection[K] };
        put(mutable, 'label', str(record.label));
        put(mutable, 'displayHint', oneOf(DISPLAY_HINTS, record.displayHint));
        put(mutable, 'textDirection', oneOf(TEXT_DIRECTIONS, record.textDirection));
        return section;
    }
    if (Array.isArray(record.submenu)) {
        const submenu: AdwMenuSubmenu = {
            kind: 'submenu',
            label: str(record.label) ?? '',
            items: normalizeMenuModel(record.submenu),
        };
        const mutableSubmenu = submenu as { -readonly [K in keyof AdwMenuSubmenu]: AdwMenuSubmenu[K] };
        put(mutableSubmenu, 'icon', str(record.icon));
        put(mutableSubmenu, 'submenuAction', str(record.submenuAction));
        put(mutableSubmenu, 'macosSpecial', str(record.macosSpecial));
        return submenu;
    }

    // An item with NO attribute at all is not an item: it would draw an empty,
    // unactionable row. `{ label: '' }` IS one — an empty label is a legal label, the
    // same distinction `splitButtonStyleClasses` keys `text-button` off.
    const label = str(record.label);
    const item: AdwMenuItem = { kind: 'item', label: label ?? '' };
    const mutable = item as { -readonly [K in keyof AdwMenuItem]: AdwMenuItem[K] };
    // `action: ''` is not an action: GIO refuses it (`g_action_parse_detailed_name('')`
    // errors), and dropping it here means the GTK path never has to.
    put(mutable, 'action', str(record.action) || undefined);
    put(mutable, 'icon', str(record.icon));
    put(mutable, 'verbIcon', str(record.verbIcon));
    put(mutable, 'accel', str(record.accel));
    put(mutable, 'hiddenWhen', oneOf(HIDDEN_WHEN, record.hiddenWhen));
    put(mutable, 'custom', str(record.custom));
    put(mutable, 'id', str(record.id));
    if (record.useMarkup === true) mutable.useMarkup = true;
    if (label === undefined && Object.keys(item).length === 2) return null;
    return item;
}

/**
 * A `menu` ATTRIBUTE — a JSON array — as a model.
 *
 * Total for the same reason {@link normalizeMenuModel} is, and it adds the one failure
 * markup can produce that a JS value cannot: `JSON.parse` genuinely throws on a typo,
 * and the widget must degrade to "no menu" rather than fail to upgrade.
 */
export function parseMenuModel(json: string | null | undefined): AdwMenuModel {
    if (!json) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    return Array.isArray(parsed) ? normalizeMenuModel(parsed as AdwMenuInput) : [];
}

// --- Addressing -------------------------------------------------------------------

/**
 * Where a node sits: the index chain from the model's root.
 *
 * A `GMenuModel` addresses its items BY POSITION and a link is a model of its own, so a
 * position inside a submenu is only meaningful together with the positions above it.
 * Resolving a choice by LABEL instead silently dispatches the first of two identically
 * named entries — the defect the split button's activation vectors already pin down, one
 * level deeper now that a menu can nest.
 */
export type AdwMenuPath = readonly number[];

/** The node at a path, or `null` when the path names none. */
export function menuNodeAt(model: AdwMenuModel, path: AdwMenuPath): AdwMenuNode | null {
    if (!Array.isArray(path) || path.length === 0) return null;
    let nodes: readonly AdwMenuNode[] = model;
    let found: AdwMenuNode | null = null;
    for (const index of path) {
        if (!Number.isInteger(index) || index < 0 || index >= nodes.length) return null;
        found = nodes[index] as AdwMenuNode;
        nodes = found.kind === 'item' ? [] : found.items;
    }
    return found;
}

/** The item at a path — `null` for a path that names a section, a submenu or nothing. */
export function menuItemAt(model: AdwMenuModel, path: AdwMenuPath): AdwMenuItem | null {
    const node = menuNodeAt(model, path);
    return node !== null && node.kind === 'item' ? node : null;
}

// --- Flattening, for a surface that draws one list at a time ----------------------

/** One row of a {@link flattenMenu} walk. */
export interface AdwMenuFlatRow {
    /** The node this row draws. Sections never appear — they become {@link separated}. */
    readonly node: AdwMenuItem | AdwMenuSubmenu;
    /**
     * Where it lives, for {@link menuItemAt}.
     *
     * It is also the depth: `path.length` counts the links walked to reach the row.
     * There is no separate `depth` field, because nothing would indent by it — GTK
     * draws a section flush with its neighbours — and a field only its own vectors read
     * is a claim nothing holds.
     */
    readonly path: AdwMenuPath;
    /** Whether a separator belongs above this row — a section boundary. */
    readonly separated: boolean;
}

/**
 * ONE LEVEL of a model as the ordered rows a list draws.
 *
 * SECTIONS ARE INLINED, SUBMENUS ARE NOT, and that asymmetry is `GMenuModel`'s own: a
 * section is a visual grouping that `GtkPopoverMenu` itself draws inline with a
 * separator, so inlining it loses a rule and no item; a submenu is a menu the user
 * OPENS, so inlining it would put its items where they were never offered. A submenu
 * row therefore stays a row, and a surface shows its contents by flattening THAT node's
 * `items` when the user asks — a second popover page on the web, a second sheet on
 * NativeScript. {@link AdwMenuFlatRow.path} is what makes the second call addressable.
 *
 * `separated` marks the FIRST row after a boundary and is never set on the first row of
 * all, because a separator above nothing is a line at the top of the menu.
 */
export function flattenMenu(model: AdwMenuModel, path: AdwMenuPath = []): readonly AdwMenuFlatRow[] {
    const rows: AdwMenuFlatRow[] = [];
    let boundary = false;
    model.forEach((node, index) => {
        const here = [...path, index];
        if (node.kind === 'section') {
            const inner = flattenMenu(node.items, here);
            if (inner.length === 0) return;
            // A section OPENS a boundary and CLOSES one: what follows a group is as
            // separated from it as the group is from what came before.
            rows.push({ ...(inner[0] as AdwMenuFlatRow), separated: rows.length > 0 });
            rows.push(...inner.slice(1));
            boundary = true;
            return;
        }
        rows.push({ node, path: here, separated: boundary && rows.length > 0 });
        boundary = false;
    });
    return rows;
}

// --- Action state: where `enabled` and `checked` actually come from ----------------

/** What a `GActionGroup` publishes about one action, in portable form. */
export interface AdwMenuAction {
    /** `g_action_group_get_action_enabled`. Absent counts as enabled. */
    readonly enabled?: boolean;
    /**
     * `g_action_group_get_action_state`, as its CONTENT in text: `true`/`false` for a
     * toggle, `list` for a radio whose targets are strings.
     *
     * NOT the `GVariant` TEXT form, which would quote the string —
     * `GLib.Variant.new_string('list').print(false)` is `'list'`, with the quotes. A
     * consumer bridging a real `GActionGroup` writes `state.get_string()[0]` for a
     * string and `String(state.get_boolean())` for a boolean; reading `print(false)`
     * instead is what makes every radio row render OFF, because the target it is
     * compared against ({@link AdwDetailedAction.target}) is unquoted too.
     */
    readonly state?: string;
}

/**
 * The actions a surface knows about — the portable stand-in for a `GActionGroup`.
 *
 * Keyed by the action's own name, prefix included (`app.save-as`), which is the key a
 * detailed action name yields. An action ABSENT from the map is missing, not disabled,
 * and the two differ: `hidden-when="action-missing"` hides one and shows the other.
 *
 * NO MAP AT ALL IS A THIRD THING, and the distinction is load-bearing rather than
 * pedantic: `{}` is a group that knows no actions, so every item in it is insensitive;
 * `undefined` is a surface with no action group to consult, so nothing is known and
 * nothing is dimmed. MEASURED — collapsing the two made every actioned item in the
 * browser renderer arrive `disabled`, because the common case is a menu whose actions
 * the host dispatches itself and never declares.
 */
export type AdwMenuActions = Readonly<Record<string, AdwMenuAction>>;

/** `GtkMenuTrackerItemRole`. */
export type AdwMenuItemRole = 'normal' | 'check' | 'radio';

/** What an item's action makes of it. */
export interface AdwMenuItemState {
    /** `GTK_STATE_FLAG_INSENSITIVE`'s inverse — the action's `enabled`. */
    readonly sensitive: boolean;
    /** Whether the check/radio decoration is drawn. */
    readonly toggled: boolean;
    readonly role: AdwMenuItemRole;
    /** Whether the item is drawn at all — `hidden-when`, folded. */
    readonly visible: boolean;
}

/** An action name and the target text beside it. */
export interface AdwDetailedAction {
    readonly name: string;
    /**
     * The target's CONTENT — `list` for `app.view::list` AND for `app.view('list')`,
     * `2` for `win.zoom(2)`.
     *
     * Never the `GVariant` TEXT, which would quote a string: the two spellings of the
     * same target must compare equal, or a radio written one way and an action state
     * read the other way disagree. MEASURED: without the unquoting,
     * `parseDetailedAction("app.v('list')")` answered `'list'` WITH quotes and every
     * such radio row rendered OFF against a state of `list`.
     */
    readonly target?: string;
}

/**
 * `app.view::list` → `{ name: 'app.view', target: 'list' }`.
 *
 * The two forms `g_action_parse_detailed_name` accepts, and no third: `::` for a string
 * target and `(…)` for a `GVariant` text one. A quoted `(…)` target is UNQUOTED, so
 * `app.v::list` and `app.v('list')` — the same detailed action to GLib — yield the same
 * target here; without that they did not, and every radio written the second way read
 * OFF.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is parse the `GVariant`. The target is the text
 * between the delimiters with its quotes removed, so comparing it against an action's
 * `state` is a STRING comparison. That is exact for the string and boolean targets a
 * menu actually uses, and it does not canonicalise WHITESPACE: `win.zoom(2)` and
 * `win.zoom( 2 )` name the same action to GLib and different targets here. A portable
 * model with no `GVariant` implementation cannot close that, and pretending otherwise
 * would be a wrong answer instead of a stated one.
 *
 * IT IS ALSO NOT A VALIDATOR. It never throws and answers something for every string,
 * because it runs on the display side of a menu that has already been accepted. GIO is
 * the authority on whether a detailed action name is legal, and `@gjsify/gtk-host`'s
 * `buildGioMenu` asks it — see {@link AdwMenuItem.action}.
 */
export function parseDetailedAction(detailed: string | undefined): AdwDetailedAction | null {
    if (typeof detailed !== 'string' || detailed.length === 0) return null;
    const colons = detailed.indexOf('::');
    if (colons > 0) return { name: detailed.slice(0, colons), target: detailed.slice(colons + 2) };
    const open = detailed.indexOf('(');
    if (open > 0 && detailed.endsWith(')')) {
        return { name: detailed.slice(0, open), target: unquote(detailed.slice(open + 1, -1)) };
    }
    return { name: detailed };
}

/**
 * `'list'` → `list`. `GVariant` text quotes a string and the `::` form does not, so the
 * two spellings of one target are only equal after this.
 */
function unquote(text: string): string {
    // `text[text.length - 1]`, not `text.at(-1)`: this package's `lib` target predates
    // `String.prototype.at`, and it is headless on four runtimes — the one place a
    // convenience method is not free.
    const first = text[0];
    const quoted = text.length >= 2 && (first === "'" || first === '"') && text[text.length - 1] === first;
    return quoted ? text.slice(1, -1) : text;
}

/**
 * `sensitive`, `toggled`, `role` and `visible` for one item — `gtk_menu_tracker_item_*`
 * as a pure fold.
 *
 * This is the whole answer to "where does a menu carry enabled and checked", and the
 * answer is that it does not. C reads all three off the ACTION: `sensitive` is the
 * action's `enabled` flag (c:332), `role` is RADIO when the item has a target and the
 * action has a state (c:336-340), CHECK when the state is a boolean and there is no
 * target (c:342-346), and `toggled` compares the two. An item with no `action` attribute
 * at all is SENSITIVE — C sets it explicitly in the else branch
 * (`gtkmenutrackeritem.c:594`) rather than leaving the field false, because a label with
 * no action is not a disabled command.
 *
 * TWO PLACES THIS IS NOT C, both because a portable action map carries no `GVariantType`:
 *
 *   · `can_activate`'s TYPE check. C refuses to activate an item whose target type does
 *     not match the action's parameter type, and that refusal feeds
 *     `hidden-when="action-missing"`. Here "missing" means only that the action is
 *     absent from {@link AdwMenuActions} — a present action with a mistyped target reads
 *     as activatable where GTK would hide it.
 *   · A boolean state is the TEXT `'true'`/`'false'`, since the state is text. A radio
 *     whose targets are literally those two strings would therefore read as a check.
 *     GTK tells them apart by `GVariant` type; nothing here can.
 *
 * `macos-menubar` hides an item only in the macOS menubar export (C guards it with
 * `mac_os_mode`, c:534-535), which no renderer here is, so it stays visible.
 */
export function resolveMenuItemState(item: AdwMenuItem, actions?: AdwMenuActions): AdwMenuItemState {
    const detailed = parseDetailedAction(item.action);
    if (actions === undefined) {
        // No action group was consulted, so no action state is KNOWN. Not the same as
        // an empty group, which knows the action is absent — see {@link AdwMenuActions}.
        return { sensitive: true, toggled: false, role: 'normal', visible: visibility(item, true, true) };
    }
    if (detailed === null) {
        // `else { update_visibility (self); self->sensitive = TRUE; }` (c:591-595, the
        // assignment at c:594) — and `can_activate` stays FALSE, so
        // `hidden-when="action-missing"` hides an item that names no action at all. C's
        // own comment says so: "if we just set a hidden-when state, but don't get the
        // action_name below then our visibility will be FALSE forever" (c:541-543).
        return { sensitive: true, toggled: false, role: 'normal', visible: visibility(item, false, true) };
    }
    const action = actions?.[detailed.name];
    if (action === undefined) {
        return { sensitive: false, toggled: false, role: 'normal', visible: visibility(item, false, false) };
    }

    const sensitive = action.enabled !== false;
    let role: AdwMenuItemRole = 'normal';
    let toggled = false;
    if (detailed.target !== undefined && action.state !== undefined) {
        role = 'radio';
        toggled = action.state === detailed.target;
    } else if (action.state === 'true' || action.state === 'false') {
        role = 'check';
        toggled = action.state === 'true';
    }
    return { sensitive, toggled, role, visible: visibility(item, true, sensitive) };
}

/** `gtk_menu_tracker_item_update_visibility` (c:257-287) — the `hidden-when` switch, verbatim. */
function visibility(item: AdwMenuItem, canActivate: boolean, sensitive: boolean): boolean {
    switch (item.hiddenWhen) {
        // c:267-268
        case 'action-missing':
            return canActivate;
        // c:271-272
        case 'action-disabled':
            return sensitive;
        // HIDDEN_WHEN_ALWAYS is reached only with `mac_os_mode`, which no renderer sets.
        case 'macos-menubar':
            return true;
        default:
            return true;
    }
}

// --- The loud half ----------------------------------------------------------------

/**
 * What a surface can draw.
 *
 * ONE CAPABILITY, because one is what actually differs in a way a reader could not
 * otherwise see. All three surfaces nest (GTK slides a page, the browser swaps the
 * popover's page, NativeScript opens a second sheet) and all three draw every
 * attribute they have a place for, so a field for those would be `true` everywhere and
 * a refusal arm nothing could ever reach — the shape this repository pays most for. A
 * second field lands with the first surface that needs it.
 */
export interface AdwMenuSurface {
    /** A name for the diagnostic — `adwaita-web`, `nativescript`. */
    readonly name: string;
    /** Can it host an application widget named by `custom`? Only GTK can. */
    readonly custom: boolean;
}

// THERE IS NO `ADW_MENU_SURFACE_GTK`, and its absence is the point. GTK refuses
// nothing, so a published constant for it would have an unreachable refusal arm — the
// shape this file's own header criticises ten lines up, and the reason `AdwMenuSurface`
// has one field. `menu.spec.ts` builds `{ name: 'gtk', custom: true }` inline to assert
// that a surface which CAN host a custom child refuses nothing; a constant is what a
// consumer of the GTK renderer would import, and the GTK renderer never asks.

/** The browser popover: it has no `add_child` for a `custom` item to name. */
export const ADW_MENU_SURFACE_WEB: AdwMenuSurface = { name: 'adwaita-web', custom: false };

/** The NativeScript action sheet: its rows are STRINGS, so a `custom` widget has no home. */
export const ADW_MENU_SURFACE_NATIVESCRIPT: AdwMenuSurface = { name: 'nativescript', custom: false };

/** One thing a surface will not draw, with where it is. */
export interface AdwMenuRefusal {
    readonly path: AdwMenuPath;
    /** The attribute that cannot be honoured. */
    readonly what: 'custom';
    readonly message: string;
}

/**
 * Every part of a model the surface cannot render — empty when it can render all of it.
 *
 * IT LISTS WHAT WOULD VANISH, NOT WHAT WOULD LOOK DIFFERENT. An icon a sheet cannot show
 * is a decoration and the row is still there; a `custom` item is a PLACEHOLDER for an
 * application widget, so a surface that ignores it draws a blank row where a control
 * belongs, and the reader has no way to tell. That is the distinction the three-way
 * split in this file's header draws, and it is why refusing everything unsupported
 * would be useless: NativeScript renders no icon and no accelerator on any menu, so a
 * refusal per decoration would fire on every well-formed menu and be switched off.
 */
export function menuRefusals(model: AdwMenuModel, surface: AdwMenuSurface, path: AdwMenuPath = []): AdwMenuRefusal[] {
    const refusals: AdwMenuRefusal[] = [];
    model.forEach((node, index) => {
        const here = [...path, index];
        if (node.kind === 'item') {
            if (node.custom !== undefined && !surface.custom) {
                refusals.push({
                    path: here,
                    what: 'custom',
                    message:
                        `menu item custom="${node.custom}" names an application widget, which ${surface.name} ` +
                        'cannot host: it has no gtk_popover_menu_add_child. Give the item a label and an ' +
                        'action, or keep this menu on GTK.',
                });
            }
            return;
        }
        refusals.push(...menuRefusals(node.items, surface, here));
    });
    return refusals;
}

/**
 * Throw if the surface cannot render the model.
 *
 * Called by a renderer when a menu is SET, so the throw names the assignment rather than
 * arriving as a missing row three interactions later. The message carries every refusal,
 * not the first: a menu written for GTK typically has all of its `custom` items at once,
 * and reporting them one run at a time is how a port becomes a series of identical bug
 * reports.
 */
export function assertMenuRenderable(model: AdwMenuModel, surface: AdwMenuSurface): void {
    const refusals = menuRefusals(model, surface);
    if (refusals.length === 0) return;
    const lines = refusals.map((r) => `  [${r.path.join('.')}] ${r.message}`);
    throw new Error(`${surface.name} cannot render this menu:\n${lines.join('\n')}`);
}
