// Portable menu-model conformance vectors — the spec every surface is held to (ADR 0042).
//
// The rows are derived from two places and say which: `gtkpopovermenu.c`'s own attribute
// list for what a menu may CARRY, and `gtkmenutrackeritem.c` for what an action makes of
// an item. The second half is the one a reader guesses wrong — `enabled` and `checked`
// look like item fields and are not — so every row there cites the C line that decides
// it.
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   NORMALIZE  the link/attribute split. `{ label: 'More', submenu: [...] }` is a
//              SUBMENU, not an item carrying a stray array; a bare string is a
//              label-only item; an unknown `hidden-when` is dropped rather than kept as
//              a string the visibility switch cannot name. And IDEMPOTENCE, which is
//              not decoration: a renderer hands its own model back in, and a normalised
//              section keeps its children under `items` rather than `section`.
//   PARSE      the same, through the `menu` ATTRIBUTE — the one door where a typo can
//              reach the widget, so nothing here may throw.
//   FLATTEN    sections inline, submenus do not. A flat surface that inlined a submenu
//              would offer items the user never opened.
//   STATE      `sensitive`/`toggled`/`role`/`visible` from the action, including the
//              two rows that look like mistakes and are C: an item with NO action is
//              SENSITIVE, and `hidden-when="action-missing"` on an actionless item
//              hides it for ever.
//   REFUSAL    `custom` names an application widget, so a surface without
//              `gtk_popover_menu_add_child` must SAY so rather than draw a blank row.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (`## Menu models`, the attribute list)
// Reference: refs/gtk/gtk/gtkmenutrackeritem.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type {
    AdwMenuActions,
    AdwMenuInput,
    AdwMenuItem,
    AdwMenuItemState,
    AdwMenuModel,
    AdwMenuPath,
} from '../menu.js';

/** One {@link normalizeMenuModel} expectation. */
export interface MenuNormalizeVector {
    input: AdwMenuInput;
    model: AdwMenuModel;
    rule: string;
}

/**
 * Authored input → the normalised tree.
 *
 * The first row is the shape the whole ADR is about: one menu value carrying a section,
 * a detailed action with a target, an icon and a submenu — everything the three surfaces
 * used to spell three different ways, or not at all.
 */
export const MENU_NORMALIZE_VECTORS: ReadonlyArray<MenuNormalizeVector> = [
    {
        input: ['Save as…'],
        model: [{ kind: 'item', label: 'Save as…' }],
        rule: 'a bare string is a label-only item — the shorthand NativeScript used to be alone in having',
    },
    {
        input: [{ label: 'Save as…', action: 'app.save-as' }],
        model: [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }],
        rule: 'the GTK shape: (label, detailed action) pairs (gtkpopovermenu.c:101,103)',
    },
    {
        input: [{ section: [{ label: 'Cut', action: 'app.cut' }, 'Copy'], label: 'Edit' }],
        model: [
            {
                kind: 'section',
                items: [
                    { kind: 'item', label: 'Cut', action: 'app.cut' },
                    { kind: 'item', label: 'Copy' },
                ],
                label: 'Edit',
            },
        ],
        rule: 'a `section` key IS the section link, and its `label` is the group heading (gtkpopovermenu.c:115-117)',
    },
    {
        input: [{ label: 'More', submenu: ['Rename'], icon: 'view-more-symbolic' }],
        model: [
            {
                kind: 'submenu',
                label: 'More',
                items: [{ kind: 'item', label: 'Rename' }],
                icon: 'view-more-symbolic',
            },
        ],
        rule: 'a `submenu` key wins over the attributes beside it — a link is read before an attribute (gtkpopovermenu.c:126-131)',
    },
    {
        input: [
            {
                label: 'Recent',
                submenu: ['Report.pdf'],
                submenuAction: 'win.recent-shown',
                macosSpecial: 'services',
            },
        ],
        model: [
            {
                kind: 'submenu',
                label: 'Recent',
                items: [{ kind: 'item', label: 'Report.pdf' }],
                submenuAction: 'win.recent-shown',
                macosSpecial: 'services',
            },
        ],
        rule: 'the two submenu attributes the first cut dropped in silence — `submenu-action` (gtkpopovermenu.c:106-107, read at gtkmenutrackeritem.c:822) and `gtk-macos-special` (:130-131, read at :761)',
    },
    {
        input: [{ label: 'List', action: 'app.view::list' }],
        model: [{ kind: 'item', label: 'List', action: 'app.view::list' }],
        rule: 'the target travels INSIDE the detailed action, so no GVariant encoding has to be invented',
    },
    {
        input: [{ label: 'Zoom', custom: 'zoom-control' }],
        model: [{ kind: 'item', label: 'Zoom', custom: 'zoom-control' }],
        rule: '`custom` names an application widget and survives normalisation — refusing it is a SURFACE question',
    },
    {
        input: [{ label: 'Undo', accel: '<Control>z', verbIcon: 'edit-undo-symbolic', useMarkup: true }],
        model: [
            {
                kind: 'item',
                label: 'Undo',
                verbIcon: 'edit-undo-symbolic',
                accel: '<Control>z',
                useMarkup: true,
            },
        ],
        rule: 'the decoration attributes round-trip whether or not a given surface draws them',
    },
    {
        input: [
            { label: 'Delete', hiddenWhen: 'action-disabled' },
            { label: 'X', hiddenWhen: 'whenever' },
        ],
        model: [
            { kind: 'item', label: 'Delete', hiddenWhen: 'action-disabled' },
            { kind: 'item', label: 'X' },
        ],
        rule: 'an unknown `hidden-when` is IGNORED, not stored: "Ignore other values" (gtkmenutrackeritem.c:530-535 + the comment at :537-544)',
    },
    {
        input: [{ label: 'Open', action: 7, icon: { name: 'x' } }] as unknown as AdwMenuInput,
        model: [{ kind: 'item', label: 'Open' }],
        rule: 'a non-string attribute is dropped rather than leaked into a field typed as one',
    },
    {
        input: [{ label: 'Open', action: '' }],
        model: [{ kind: 'item', label: 'Open' }],
        rule: "an EMPTY action is not an action — GIO refuses `''`, and dropping it here is one abort the GTK path never has to refuse",
    },
    {
        input: [{}, null, 42, ['nested'], { label: 42 }] as unknown as AdwMenuInput,
        model: [],
        rule: 'an entry with no usable attribute and no link draws nothing, so it is not an entry',
    },
    {
        input: [{ label: '' }],
        model: [{ kind: 'item', label: '' }],
        rule: 'an EMPTY label is a label — the same distinction `text-button` is keyed off',
    },
    {
        input: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] },
        ] as unknown as AdwMenuInput,
        model: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] },
        ],
        rule: 'IDEMPOTENCE: a normalised model is legal input, or handing a widget its own model back would flatten it',
    },
];

/** One {@link parseMenuModel} expectation — the `menu` attribute door. */
export interface MenuParseVector {
    /** The raw attribute (or `null` when absent). */
    json: string | null;
    model: AdwMenuModel;
    rule: string;
}

/**
 * Menu-attribute parsing. Total: nothing an author can type may prevent the widget
 * upgrading, which is why every malformed row below yields a menu rather than a throw.
 */
export const MENU_PARSE_VECTORS: ReadonlyArray<MenuParseVector> = [
    {
        json: '[{"label":"Save as…","action":"app.save-as"}]',
        model: [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }],
        rule: 'the GTK shape through the attribute door',
    },
    {
        json: '[{"label":"Copy","action":"app.copy"},{"label":"Copy","action":"app.copy-special"}]',
        model: [
            { kind: 'item', label: 'Copy', action: 'app.copy' },
            { kind: 'item', label: 'Copy', action: 'app.copy-special' },
        ],
        rule: 'duplicate labels are legal and must NOT collapse',
    },
    {
        json: '[{"label":"About","id":"about","icon":"help-about-symbolic"}]',
        model: [{ kind: 'item', label: 'About', icon: 'help-about-symbolic', id: 'about' }],
        rule: 'the menu-button extras (id/icon) are attributes like any other',
    },
    {
        json: '[{"section":[{"label":"Cut"}]},{"label":"More","submenu":[{"label":"Rename"}]}]',
        model: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] },
        ],
        rule: 'sections and submenus are writable in markup — the whole point of a JSON attribute',
    },
    { json: null, model: [], rule: 'no attribute → no menu' },
    { json: '', model: [], rule: 'an empty attribute → no menu' },
    { json: 'not json at all', model: [], rule: 'malformed JSON degrades to no menu, it does not throw' },
    { json: '{"label":"Save"}', model: [], rule: 'a non-array root is rejected wholesale' },
    { json: '[]', model: [], rule: 'an empty array is an empty menu' },
    {
        json: '[{"action":"app.x"},null,42,["label"]]',
        model: [{ kind: 'item', label: '', action: 'app.x' }],
        rule: 'an entry with an action but no label is still an item; the three junk entries are not',
    },
];

/** One expected row of a {@link flattenMenu} walk. */
export interface MenuFlatRowVector {
    /** The label the row draws. */
    label: string;
    path: AdwMenuPath;
    separated: boolean;
}

/** One {@link flattenMenu} expectation. */
export interface MenuFlattenVector {
    model: AdwMenuModel;
    rows: readonly MenuFlatRowVector[];
    rule: string;
}

const SECTIONED: AdwMenuModel = [
    { kind: 'item', label: 'New' },
    {
        kind: 'section',
        items: [
            { kind: 'item', label: 'Cut' },
            { kind: 'item', label: 'Copy' },
        ],
    },
    { kind: 'item', label: 'Quit' },
];

/**
 * The rows a one-list-at-a-time surface draws, and where a separator goes.
 *
 * A separator NEVER leads: a rule above nothing is a line at the top of the menu, which
 * is what a naive "a section starts, so separate" rule produces for a menu whose first
 * entry is a section.
 */
export const MENU_FLATTEN_VECTORS: ReadonlyArray<MenuFlattenVector> = [
    {
        model: SECTIONED,
        rows: [
            { label: 'New', path: [0], separated: false },
            { label: 'Cut', path: [1, 0], separated: true },
            { label: 'Copy', path: [1, 1], separated: false },
            { label: 'Quit', path: [2], separated: true },
        ],
        rule: 'a section is inlined and separated on BOTH sides; its items keep their real paths',
    },
    {
        model: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'item', label: 'Quit' },
        ],
        rows: [
            { label: 'Cut', path: [0, 0], separated: false },
            { label: 'Quit', path: [1], separated: true },
        ],
        rule: 'a LEADING section draws no separator above it',
    },
    {
        model: [
            { kind: 'section', items: [{ kind: 'item', label: 'A' }] },
            { kind: 'section', items: [{ kind: 'item', label: 'B' }] },
        ],
        rows: [
            { label: 'A', path: [0, 0], separated: false },
            { label: 'B', path: [1, 0], separated: true },
        ],
        rule: 'two adjacent sections are separated once, not twice',
    },
    {
        model: [
            { kind: 'section', items: [] },
            { kind: 'item', label: 'Quit' },
        ],
        rows: [{ label: 'Quit', path: [1], separated: false }],
        rule: 'an EMPTY section draws nothing and opens no boundary — a separator with no group above it',
    },
    {
        model: [{ kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] }],
        rows: [{ label: 'More', path: [0], separated: false }],
        rule: 'a submenu stays ONE row: inlining it would offer items the user never opened',
    },
];

/** One {@link parseDetailedAction} expectation, and what GIO makes of the same string. */
export interface MenuDetailedActionVector {
    detailed: string;
    /** What the display-side splitter answers. It never throws. */
    name: string;
    target?: string;
    /**
     * Whether `g_action_parse_detailed_name` ACCEPTS the string.
     *
     * The load-bearing field, and the reason this table is driven twice. The splitter is
     * lenient by design — it runs on a menu that has already been accepted, so it
     * answers something for every input — and reading its answer as "this is a legal
     * action name" is exactly the mistake that let `'app.x('` through to
     * `g_menu_item_set_detailed_action`, which ABORTS the process on it. `false` rows
     * are asserted to be REFUSED by `@gjsify/gtk-host`'s `buildGioMenu`; `true` rows are
     * asserted to survive a round trip through a real `Gio.Menu`.
     */
    gioValid: boolean;
    rule: string;
}

/**
 * CORE-ONLY: the SPLITTER's answers are never read by a renderer — they exist for
 * MENU_ITEM_STATE_VECTORS, which both renderer suites drive through the widget's action
 * state, and a target that does not come off leaves every radio item reading `normal`.
 * The `gioValid` half IS driven against a real implementation, by
 * packages/framework/gtk-host/src/menu.spec.ts — the GTK host rather than an Adwaita
 * port, so this gate does not count it as a renderer, and holds the PATH instead.
 *
 * `g_action_parse_detailed_name`'s two forms, the strings that are neither, and what the
 * display-side splitter answers for each.
 *
 * IT IS DRIVEN TWICE, and the second drive is what the first cut was missing: the core
 * suite asserts {@link parseDetailedAction}, and `@gjsify/gtk-host`'s menu suite sends
 * every row through `buildGioMenu`. Without the second, this table DECLARED `'app.x('`
 * legal while nothing ever handed it to GIO — and GIO answers a malformed name with
 * `g_error()`, a SIGABRT no `catch` can see. A vector nobody drives against the real
 * implementation is the shape `conformance/index.ts` warns about, one layer down.
 */
export const MENU_DETAILED_ACTION_VECTORS: ReadonlyArray<MenuDetailedActionVector> = [
    { detailed: 'app.save-as', name: 'app.save-as', gioValid: true, rule: 'no target' },
    {
        detailed: 'app.view::list',
        name: 'app.view',
        target: 'list',
        gioValid: true,
        rule: 'the `::` form — a string target',
    },
    {
        detailed: 'win.zoom(2)',
        name: 'win.zoom',
        target: '2',
        gioValid: true,
        rule: 'the `(…)` form — a GVariant text target',
    },
    {
        detailed: "app.view('list')",
        name: 'app.view',
        target: 'list',
        gioValid: true,
        rule: 'the QUOTED `(…)` form is the same target as the `::` form — unquoted, or a radio written this way reads OFF',
    },
    {
        detailed: "app.view('a\\'b')",
        name: 'app.view',
        target: "a'b",
        gioValid: true,
        rule: 'GVariant text ESCAPES the quote inside a quoted string; leaving the escape on is wrong CONTENT, not a second spelling',
    },
    {
        detailed: "app.view('a\\\\b')",
        name: 'app.view',
        target: 'a\\b',
        gioValid: true,
        rule: 'and the backslash — the only other character GVariant escapes there',
    },
    {
        detailed: 'app.view::a::b',
        name: 'app.view',
        target: 'a::b',
        gioValid: true,
        rule: 'only the FIRST `::` splits; the rest is target text',
    },
    {
        detailed: 'app.x(',
        name: 'app.x(',
        gioValid: false,
        rule: 'an unterminated `(` is not the target form — the splitter keeps the lot, GIO ABORTS on it',
    },
    {
        detailed: 'win.zoom(qqq)',
        name: 'win.zoom',
        target: 'qqq',
        gioValid: false,
        rule: 'the splitter cannot know `qqq` is not a GVariant; GIO can, and aborts',
    },
    {
        detailed: 'app.a b',
        name: 'app.a b',
        gioValid: false,
        rule: 'a space is not legal in an action name',
    },
    { detailed: 'app.x)', name: 'app.x)', gioValid: false, rule: 'a stray `)` is not the target form' },
    {
        detailed: 'app.x()',
        name: 'app.x',
        target: '',
        gioValid: false,
        rule: 'an EMPTY target is not a GVariant — "0:expected value"',
    },
    {
        detailed: 'a.b(1,2)',
        name: 'a.b',
        target: '1,2',
        gioValid: false,
        rule: 'two values are not one target — "1:expected end of input"',
    },
];

/** One {@link resolveMenuItemState} expectation. */
export interface MenuItemStateVector {
    item: AdwMenuItem;
    actions: AdwMenuActions;
    state: AdwMenuItemState;
    rule: string;
}

const TOGGLE_ACTIONS: AdwMenuActions = {
    'app.sidebar': { state: 'true' },
    'app.view': { state: 'list' },
    'app.save': { enabled: false },
    'app.copy': {},
};

/**
 * Where `enabled` and `checked` come from, which is NOT the menu.
 *
 * Every row cites `gtkmenutrackeritem.c`, because the whole table exists to show that a
 * portable model carrying `enabled: false` on an item would be inventing a field
 * `GMenuModel` has not got — and would then have nowhere to put it when the model is
 * handed to a real `Gio.Menu`.
 */
export const MENU_ITEM_STATE_VECTORS: ReadonlyArray<MenuItemStateVector> = [
    {
        item: { kind: 'item', label: 'Heading' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: false, role: 'normal', visible: true },
        rule: 'NO action at all is SENSITIVE — C sets it explicitly in the else branch (c:591-595, the assignment at c:594)',
    },
    {
        item: { kind: 'item', label: 'Save', action: 'app.save' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: false, toggled: false, role: 'normal', visible: true },
        rule: 'sensitive IS the action’s enabled flag — `self->sensitive = enabled` (c:332)',
    },
    {
        item: { kind: 'item', label: 'Copy', action: 'app.copy' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: false, role: 'normal', visible: true },
        rule: 'an action with no state is a plain command',
    },
    {
        item: { kind: 'item', label: 'Missing', action: 'app.nope' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: false, toggled: false, role: 'normal', visible: true },
        rule: 'an action the group has not got is INSENSITIVE, and still shown (c:582-586)',
    },
    {
        item: { kind: 'item', label: 'Sidebar', action: 'app.sidebar' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: true, role: 'check', visible: true },
        rule: 'a boolean state with no target is a CHECK, toggled by the state (c:342-346)',
    },
    {
        item: { kind: 'item', label: 'List', action: 'app.view::list' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: true, role: 'radio', visible: true },
        rule: 'a target AND a state is a RADIO, toggled when they are equal (c:336-340)',
    },
    {
        item: { kind: 'item', label: 'Grid', action: 'app.view::grid' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: false, role: 'radio', visible: true },
        rule: 'the OTHER radio of the same action is a radio too, and off',
    },
    {
        item: { kind: 'item', label: 'Save', action: 'app.save', hiddenWhen: 'action-disabled' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: false, toggled: false, role: 'normal', visible: false },
        rule: 'hidden-when="action-disabled" folds onto sensitive (c:271-272)',
    },
    {
        item: { kind: 'item', label: 'Ghost', action: 'app.nope', hiddenWhen: 'action-missing' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: false, toggled: false, role: 'normal', visible: false },
        rule: 'hidden-when="action-missing" folds onto can_activate (c:267-268)',
    },
    {
        item: { kind: 'item', label: 'Ghost', hiddenWhen: 'action-missing' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: false, role: 'normal', visible: false },
        rule: 'an actionless item with hidden-when="action-missing" is hidden FOR EVER — C says so in its own comment (c:541-543)',
    },
    {
        item: { kind: 'item', label: 'Quit', action: 'app.quit' },
        actions: {},
        state: { sensitive: false, toggled: false, role: 'normal', visible: true },
        rule: 'an EMPTY group knows the action is missing, so the item is insensitive',
    },
    {
        item: { kind: 'item', label: 'Menubar', action: 'app.copy', hiddenWhen: 'macos-menubar' },
        actions: TOGGLE_ACTIONS,
        state: { sensitive: true, toggled: false, role: 'normal', visible: true },
        rule: 'macos-menubar hides only under `mac_os_mode`, which no renderer here is (c:534-535)',
    },
];

/** One {@link menuRefusals} expectation. */
export interface MenuRefusalVector {
    model: AdwMenuModel;
    /** The paths that must be refused, in walk order. */
    paths: readonly AdwMenuPath[];
    rule: string;
}

/**
 * What a surface without `gtk_popover_menu_add_child` will not draw.
 *
 * Every row is asserted for the WEB and NATIVESCRIPT surfaces (which refuse `custom`)
 * and for GTK (which refuses nothing), so the table also pins down that the GTK path
 * accepts every model the other two do.
 */
export const MENU_REFUSAL_VECTORS: ReadonlyArray<MenuRefusalVector> = [
    {
        model: [{ kind: 'item', label: 'Save', action: 'app.save' }],
        paths: [],
        rule: 'an ordinary menu is refused by nothing',
    },
    {
        model: [{ kind: 'item', label: 'Zoom', custom: 'zoom-control' }],
        paths: [[0]],
        rule: '`custom` names an application widget, so a blank row would be the alternative',
    },
    {
        model: [
            { kind: 'item', label: 'A' },
            { kind: 'section', items: [{ kind: 'item', label: 'Z', custom: 'zoom' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'C', custom: 'colour' }] },
        ],
        paths: [
            [1, 0],
            [2, 0],
        ],
        rule: 'the walk enters sections AND submenus — a refusal three levels down is still a blank row',
    },
    {
        model: [
            { kind: 'item', label: 'A', custom: 'one' },
            { kind: 'item', label: 'B', custom: 'two' },
        ],
        paths: [[0], [1]],
        rule: 'EVERY refusal is reported, not the first: a GTK menu typically has all of its custom items at once',
    },
];
