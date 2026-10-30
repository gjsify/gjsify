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
// THE SECOND HALF OF THE FILE is a different kind of table, and the distinction matters:
// everything above pins the PORTABLE model — what an author writes and what a renderer
// makes of it. Everything from `MENU_MODEL_TYPE_VECTORS` down pins the `Gio.MenuModel`
// the port now IS (ADR 0128), and every row there was MEASURED against GJS 1.88 / GTK
// 4.22 under a private headless session, not read off a header. Where the measurement
// contradicts what a reader would assume, the row says so — `remove_all` on an empty
// menu still emits, `Gtk.MenuButton` has no identity guard where `Adw.SplitButton` does,
// and a link's emission does not bubble.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (`## Menu models`, the attribute list)
// Reference: refs/gtk/gtk/gtkmenutrackeritem.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { AdwMenuActions, AdwMenuInput, AdwMenuItem, AdwMenuItemState, AdwMenuTree, AdwMenuPath } from '../menu.js';

/** One {@link normalizeMenuModel} expectation. */
export interface MenuNormalizeVector {
    input: AdwMenuInput;
    tree: AdwMenuTree;
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
        tree: [{ kind: 'item', label: 'Save as…' }],
        rule: 'a bare string is a label-only item — the shorthand NativeScript used to be alone in having',
    },
    {
        input: [{ label: 'Save as…', action: 'app.save-as' }],
        tree: [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }],
        rule: 'the GTK shape: (label, detailed action) pairs (gtkpopovermenu.c:101,103)',
    },
    {
        input: [{ section: [{ label: 'Cut', action: 'app.cut' }, 'Copy'], label: 'Edit' }],
        tree: [
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
        tree: [
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
        tree: [
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
        tree: [{ kind: 'item', label: 'List', action: 'app.view::list' }],
        rule: 'the target travels INSIDE the detailed action, so no GVariant encoding has to be invented',
    },
    {
        input: [{ label: 'Zoom', custom: 'zoom-control' }],
        tree: [{ kind: 'item', label: 'Zoom', custom: 'zoom-control' }],
        rule: '`custom` names an application widget and survives normalisation — refusing it is a SURFACE question',
    },
    {
        input: [{ label: 'Undo', accel: '<Control>z', verbIcon: 'edit-undo-symbolic', useMarkup: true }],
        tree: [
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
        tree: [
            { kind: 'item', label: 'Delete', hiddenWhen: 'action-disabled' },
            { kind: 'item', label: 'X' },
        ],
        rule: 'an unknown `hidden-when` is IGNORED, not stored: "Ignore other values" (gtkmenutrackeritem.c:530-535 + the comment at :537-544)',
    },
    {
        input: [{ label: 'Open', action: 7, icon: { name: 'x' } }] as unknown as AdwMenuInput,
        tree: [{ kind: 'item', label: 'Open' }],
        rule: 'a non-string attribute is dropped rather than leaked into a field typed as one',
    },
    {
        input: [{ label: 'Open', action: '' }],
        tree: [{ kind: 'item', label: 'Open' }],
        rule: "an EMPTY action is not an action — GIO refuses `''`, and dropping it here is one abort the GTK path never has to refuse",
    },
    {
        input: [{}, null, 42, ['nested'], { label: 42 }] as unknown as AdwMenuInput,
        tree: [],
        rule: 'an entry with no usable attribute and no link draws nothing, so it is not an entry',
    },
    {
        input: [{ label: '' }],
        tree: [{ kind: 'item', label: '' }],
        rule: 'an EMPTY label is a label — the same distinction `text-button` is keyed off',
    },
    {
        input: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] },
        ] as unknown as AdwMenuInput,
        tree: [
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
    tree: AdwMenuTree;
    rule: string;
}

/**
 * Menu-attribute parsing. Total: nothing an author can type may prevent the widget
 * upgrading, which is why every malformed row below yields a menu rather than a throw.
 */
export const MENU_PARSE_VECTORS: ReadonlyArray<MenuParseVector> = [
    {
        json: '[{"label":"Save as…","action":"app.save-as"}]',
        tree: [{ kind: 'item', label: 'Save as…', action: 'app.save-as' }],
        rule: 'the GTK shape through the attribute door',
    },
    {
        json: '[{"label":"Copy","action":"app.copy"},{"label":"Copy","action":"app.copy-special"}]',
        tree: [
            { kind: 'item', label: 'Copy', action: 'app.copy' },
            { kind: 'item', label: 'Copy', action: 'app.copy-special' },
        ],
        rule: 'duplicate labels are legal and must NOT collapse',
    },
    {
        json: '[{"label":"About","id":"about","icon":"help-about-symbolic"}]',
        tree: [{ kind: 'item', label: 'About', icon: 'help-about-symbolic', id: 'about' }],
        rule: 'the menu-button extras (id/icon) are attributes like any other',
    },
    {
        json: '[{"section":[{"label":"Cut"}]},{"label":"More","submenu":[{"label":"Rename"}]}]',
        tree: [
            { kind: 'section', items: [{ kind: 'item', label: 'Cut' }] },
            { kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] },
        ],
        rule: 'sections and submenus are writable in markup — the whole point of a JSON attribute',
    },
    { json: null, tree: [], rule: 'no attribute → no menu' },
    { json: '', tree: [], rule: 'an empty attribute → no menu' },
    { json: 'not json at all', tree: [], rule: 'malformed JSON degrades to no menu, it does not throw' },
    { json: '{"label":"Save"}', tree: [], rule: 'a non-array root is rejected wholesale' },
    { json: '[]', tree: [], rule: 'an empty array is an empty menu' },
    {
        json: '[{"action":"app.x"},null,42,["label"]]',
        tree: [{ kind: 'item', label: '', action: 'app.x' }],
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
    tree: AdwMenuTree;
    rows: readonly MenuFlatRowVector[];
    rule: string;
}

const SECTIONED: AdwMenuTree = [
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
        tree: SECTIONED,
        rows: [
            { label: 'New', path: [0], separated: false },
            { label: 'Cut', path: [1, 0], separated: true },
            { label: 'Copy', path: [1, 1], separated: false },
            { label: 'Quit', path: [2], separated: true },
        ],
        rule: 'a section is inlined and separated on BOTH sides; its items keep their real paths',
    },
    {
        tree: [
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
        tree: [
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
        tree: [
            { kind: 'section', items: [] },
            { kind: 'item', label: 'Quit' },
        ],
        rows: [{ label: 'Quit', path: [1], separated: false }],
        rule: 'an EMPTY section draws nothing and opens no boundary — a separator with no group above it',
    },
    {
        tree: [{ kind: 'submenu', label: 'More', items: [{ kind: 'item', label: 'Rename' }] }],
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
    tree: AdwMenuTree;
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
        tree: [{ kind: 'item', label: 'Save', action: 'app.save' }],
        paths: [],
        rule: 'an ordinary menu is refused by nothing',
    },
    {
        tree: [{ kind: 'item', label: 'Zoom', custom: 'zoom-control' }],
        paths: [[0]],
        rule: '`custom` names an application widget, so a blank row would be the alternative',
    },
    {
        tree: [
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
        tree: [
            { kind: 'item', label: 'A', custom: 'one' },
            { kind: 'item', label: 'B', custom: 'two' },
        ],
        paths: [[0], [1]],
        rule: 'EVERY refusal is reported, not the first: a GTK menu typically has all of its custom items at once',
    },
];

/** One {@link menuLabelText} expectation. */
export interface MenuLabelTextVector {
    label: string;
    text: string;
    rule: string;
}

/**
 * What a menu row shows for an item, submenu or menubar label.
 *
 * Measured on GTK 4.22: a `Gio.Menu` in a `GtkPopoverMenu` (and a
 * `GtkPopoverMenuBar`), every row's `GtkLabel` read back with `get_text()`. The rows a
 * reader guesses wrong are the TRAILING `_` ones: a `GtkLabel` keeps a lone trailing
 * marker, which `adw_strip_mnemonic` (the core `stripMnemonic`) drops.
 */
export const MENU_LABEL_TEXT_VECTORS: ReadonlyArray<MenuLabelTextVector> = [
    { label: 'Plain', text: 'Plain', rule: 'a label without `_` is shown verbatim' },
    { label: '_Preferences', text: 'Preferences', rule: 'a `_` marks the next character and is removed' },
    { label: 'Save__As', text: 'Save_As', rule: '`__` is one literal underscore' },
    { label: 'A_b_c', text: 'Abc', rule: 'every marker is removed, not only the first' },
    { label: 'tail_', text: 'tail_', rule: 'a trailing lone `_` marks nothing and is KEPT' },
    { label: '_', text: '_', rule: 'a label that is only a marker keeps it' },
    { label: '___', text: '__', rule: '`__` then a trailing lone `_`' },
    { label: 'a__', text: 'a_', rule: 'an escaped underscore at the end is one underscore' },
    { label: '_a_', text: 'a_', rule: 'a marker, then a kept trailing `_`' },
    { label: 'A__B_c', text: 'A_Bc', rule: 'an escape and a marker in one label' },
    { label: 'x_\u{1D49C}', text: 'x\u{1D49C}', rule: 'the marker takes a whole code point, not a UTF-16 half' },
];

// --- The real `Gio.MenuModel` (ADR 0128), measured on GJS 1.88 / GTK 4.22 ---
//
// Every row below was run under a private headless session (`scripts/headless-run --
// gjs -m`) against GJS 1.88 / GTK 4.22 and records what GIO ANSWERED, not what a header
// promises. They are shaped to be DRIVEN rather than read: each table carries the call
// as data so the twin is held to the measurement instead of to a paraphrase of it.

/** What a type-surface row asks of the implementation. */
export type MenuTypeQuery =
    /** `new Gio.MenuModel()` — the abstract base. */
    | 'construct-abstract'
    /** `new Gio.Menu().constructor.$gtype.name`. */
    | 'gtype-name'
    /** `GObject.type_parent(Gio.Menu.$gtype).name`. */
    | 'parent-gtype-name'
    /** `new Gio.Menu() instanceof Gio.MenuModel`. */
    | 'instance-of-base'
    /** `GObject.signal_lookup('items-changed', Gio.MenuModel.$gtype) !== 0`. */
    | 'items-changed-on-base'
    /** `new Gio.Menu().get_n_items()`. */
    | 'fresh-n-items'
    /** `new Gio.Menu().is_mutable()`. */
    | 'fresh-is-mutable';

/** One type-surface fact a `Gio.Menu` twin has to reproduce. */
export interface MenuModelTypeVector {
    query: MenuTypeQuery;
    /** What the query answered, or `undefined` where it threw. */
    answer?: string | number | boolean;
    /** The message it threw, where it threw. */
    throws?: string;
    rule: string;
}

/**
 * CORE-ONLY: a GType surface has no rendered form — a renderer can only observe it
 * through the door that reads it, which is MENU_MODEL_DOOR_VECTORS, and both renderers
 * drive that. Holding the same facts twice would assert the port's registration against
 * itself in a place no widget can see.
 *
 * The GType surface: what a menu IS before anything is in it.
 *
 * The row a reader guesses wrong is the first one. `Gio.MenuModel` is an abstract CLASS,
 * not an interface, so the twin declares it with `registerBaseClass` and has no
 * `Implements` to answer for. ADR 0122's string list had the opposite shape:
 * `Gio.ListModel` IS an interface, and the whole `ACCEPTED_INTERFACES` apparatus exists
 * for it. A port that copied the string list wholesale would have invented an interface
 * GTK does not have.
 */
export const MENU_MODEL_TYPE_VECTORS: ReadonlyArray<MenuModelTypeVector> = [
    {
        query: 'construct-abstract',
        throws: 'Cannot instantiate abstract type GMenuModel',
        rule: 'the base is ABSTRACT — a twin that lets it be constructed has invented a type GTK does not have',
    },
    {
        query: 'gtype-name',
        answer: 'GMenu',
        rule: 'the concrete type is `GMenu`, not `GioMenu` — the GType NAME is what a ParamSpec check reads',
    },
    {
        query: 'parent-gtype-name',
        answer: 'GMenuModel',
        rule: 'one hop, with no interface in between',
    },
    {
        query: 'instance-of-base',
        answer: true,
        rule: 'the check a widget door makes before it accepts a value',
    },
    {
        query: 'items-changed-on-base',
        answer: true,
        rule: '`items-changed` is declared on the ABSTRACT base, so a subclass inherits it rather than redeclaring it',
    },
    { query: 'fresh-n-items', answer: 0, rule: 'an empty menu, not a null model' },
    {
        query: 'fresh-is-mutable',
        answer: true,
        rule: 'a fresh menu is mutable; MENU_MODEL_DIVERGENCE_VECTORS has what `freeze()` does and does not do',
    },
];

/** A mutator call, as data, so the table can be driven rather than read. */
export type MenuMutatorCall =
    | { readonly method: 'append' | 'prepend'; readonly label: string; readonly action?: string }
    | { readonly method: 'insert'; readonly position: number; readonly label: string; readonly action?: string }
    | { readonly method: 'append_item' | 'prepend_item'; readonly label: string }
    | { readonly method: 'insert_item'; readonly position: number; readonly label: string }
    | {
          readonly method: 'append_section' | 'append_submenu' | 'prepend_section' | 'prepend_submenu';
          readonly label: string | null;
          readonly children: readonly string[];
      }
    | {
          readonly method: 'insert_section' | 'insert_submenu';
          readonly position: number;
          readonly label: string | null;
          readonly children: readonly string[];
      }
    | { readonly method: 'remove'; readonly position: number }
    | { readonly method: 'remove_all' }
    | { readonly method: 'items_changed'; readonly position: number; readonly removed: number; readonly added: number };

/** One measured `Gio.Menu` mutator and the single `items-changed` it emits. */
export interface MenuMutatorEmissionVector {
    /** How many plain items the menu holds before the call. */
    before: number;
    call: MenuMutatorCall;
    /** `items-changed(position, removed, added)` — exactly ONE emission per call. */
    emission: readonly [number, number, number];
    /** How many items the menu holds after it. */
    after: number;
    rule: string;
}

/**
 * CORE-ONLY: the emission is the CONTRACT a renderer consumes, and what a renderer can
 * be held to is the reaction, not the triple — which is
 * MENU_MODEL_NOTIFY_VECTORS and COMBO_ITEMS_CHANGED_VECTORS, both renderer-driven. A
 * renderer suite asserting the triple would be asserting the model it was handed.
 *
 * Every mutator, the triple it emits, and the count it leaves behind.
 *
 * ONE emission per call, always: there is no mutator that batches and none that stays
 * silent. The last two rows are the ones that separate a menu from a list store. A
 * `remove_all()` on an EMPTY menu STILL emits `(0, 0, 0)` — measured — so the no-op skip
 * that is right for `Gtk.StringList` (ADR 0122) is wrong here, and `items_changed` is a
 * PUBLIC emitter that changes nothing, which is how a subclass reports a splice it made
 * itself.
 */
export const MENU_MUTATOR_EMISSION_VECTORS: ReadonlyArray<MenuMutatorEmissionVector> = [
    {
        before: 2,
        call: { method: 'append', label: 'C', action: 'app.c' },
        emission: [2, 0, 1],
        after: 3,
        rule: 'an append lands at the old count',
    },
    {
        before: 2,
        call: { method: 'prepend', label: 'C', action: 'app.c' },
        emission: [0, 0, 1],
        after: 3,
        rule: 'a prepend is an insert at 0, not a rebuild',
    },
    {
        before: 2,
        call: { method: 'insert', position: 1, label: 'C', action: 'app.c' },
        emission: [1, 0, 1],
        after: 3,
        rule: 'the position is the one that was asked for',
    },
    {
        before: 2,
        call: { method: 'append_item', label: 'C' },
        emission: [2, 0, 1],
        after: 3,
        rule: 'an item carries its own attributes and changes nothing about the triple',
    },
    {
        before: 2,
        call: { method: 'prepend_item', label: 'C' },
        emission: [0, 0, 1],
        after: 3,
        rule: 'and the prepend of one is still a single insert',
    },
    {
        before: 2,
        call: { method: 'insert_item', position: 1, label: 'C' },
        emission: [1, 0, 1],
        after: 3,
        rule: 'as is an insert at a position',
    },
    {
        before: 2,
        call: { method: 'append_section', label: 'Edit', children: ['Cut', 'Copy'] },
        emission: [2, 0, 1],
        after: 3,
        rule: 'a section is ONE item of the parent, however many items it holds',
    },
    {
        before: 2,
        call: { method: 'append_submenu', label: 'More', children: ['Deeper'] },
        emission: [2, 0, 1],
        after: 3,
        rule: 'and so is a submenu',
    },
    {
        before: 2,
        call: { method: 'insert_section', position: 1, label: 'Edit', children: ['Cut'] },
        emission: [1, 0, 1],
        after: 3,
        rule: 'the link mutators take the same position as the plain ones',
    },
    {
        before: 2,
        call: { method: 'insert_submenu', position: 1, label: 'More', children: ['Deeper'] },
        emission: [1, 0, 1],
        after: 3,
        rule: 'the same again for a submenu',
    },
    {
        before: 2,
        call: { method: 'prepend_section', label: null, children: ['Cut'] },
        emission: [0, 0, 1],
        after: 3,
        rule: 'prepend is position 0 for links too, and a section may carry no heading',
    },
    {
        before: 2,
        call: { method: 'prepend_submenu', label: 'More', children: ['Deeper'] },
        emission: [0, 0, 1],
        after: 3,
        rule: 'and for submenus',
    },
    {
        before: 3,
        call: { method: 'remove', position: 1 },
        emission: [1, 1, 0],
        after: 2,
        rule: 'one removal, reported where it happened',
    },
    {
        before: 2,
        call: { method: 'remove_all' },
        emission: [0, 2, 0],
        after: 0,
        rule: 'the whole span in one emission — a renderer may drop every row it holds',
    },
    {
        before: 0,
        call: { method: 'remove_all' },
        emission: [0, 0, 0],
        after: 0,
        rule: 'MEASURED, and the row a `Gtk.StringList` twin gets wrong: an EMPTY menu still emits, so the no-op skip of ADR 0122 § 3 is not GIO behaviour here',
    },
    {
        before: 2,
        call: { method: 'items_changed', position: 3, removed: 2, added: 1 },
        emission: [3, 2, 1],
        after: 2,
        rule: 'the emitter is PUBLIC and does not touch the contents — a subclass reports its own splices through it, and a lying triple is not policed',
    },
];

/** A GVariant the table hands to `set_attribute_value`, spelled as type + value. */
export interface MenuAttributeVariant {
    /** A type string from ADR 0118 § 2's subset — `s`, `i`, `b` or `d`. */
    readonly type: 's' | 'i' | 'b' | 'd';
    readonly value: string | number | boolean;
}

/** How the attribute under test got onto the item. */
export type MenuAttributeSet =
    /** `item.set_detailed_action(detailed)` — writes `action` and maybe `target`. */
    | { readonly kind: 'detailed-action'; readonly detailed: string }
    /** `item.set_label(label)`. */
    | { readonly kind: 'label'; readonly label: string }
    /** `item.set_attribute_value(name, variant)`. */
    | { readonly kind: 'attribute'; readonly name: string; readonly variant: MenuAttributeVariant }
    /** Nothing was set — the row is about reading what was never written. */
    | { readonly kind: 'nothing' };

/** One `get_item_attribute_value` read, and the variant type it answers with. */
export interface MenuAttributeVariantVector {
    set: MenuAttributeSet;
    /** The attribute name the read asks for. */
    read: string;
    /** `expected_type`, where the row is about passing one. */
    expectedType?: string;
    /** The type string the read answers with, or `null` for an empty read. */
    type: string | null;
    /** `deepUnpack()` of the answer, where the row is about the VALUE and not only the type. */
    value?: string | number | boolean;
    rule: string;
}

/**
 * CORE-ONLY: an attribute's variant TYPE never reaches a rendered surface — what a
 * renderer draws from it is held by MENU_NORMALIZE_VECTORS and MENU_ITEM_STATE_VECTORS,
 * which both renderers drive.
 *
 * What type each menu attribute comes back as.
 *
 * `target` is the row that explains the table: its type is the TARGET's own, not a fixed
 * `s`. A radio item written `win.zoom(2)` reads `i` and one written `app.view::list`
 * reads `s`, which is why `resolveMenuItemState` compares the PRINTED target rather than
 * the unpacked one. The two rows at the end are the empty reads, and neither throws — an
 * unknown attribute name and a mismatched `expected_type` both answer `null`, so a
 * surface cannot tell a typo from an absence and must not try.
 */
export const MENU_ATTRIBUTE_VARIANT_VECTORS: ReadonlyArray<MenuAttributeVariantVector> = [
    {
        set: { kind: 'label', label: 'Save as…' },
        read: 'label',
        type: 's',
        value: 'Save as…',
        rule: 'the label is text',
    },
    {
        set: { kind: 'detailed-action', detailed: 'app.save-as' },
        read: 'action',
        type: 's',
        value: 'app.save-as',
        rule: 'the action NAME, with the target already split off',
    },
    {
        set: { kind: 'detailed-action', detailed: 'app.save-as' },
        read: 'target',
        type: null,
        rule: 'and no target at all, rather than an empty string',
    },
    {
        set: { kind: 'detailed-action', detailed: 'app.view::list' },
        read: 'target',
        type: 's',
        value: 'list',
        rule: 'the `::` form gives a string target',
    },
    {
        set: { kind: 'detailed-action', detailed: "app.view('list')" },
        read: 'target',
        type: 's',
        value: 'list',
        rule: 'and the quoted `(…)` form gives the same one — the two spellings are not two targets',
    },
    {
        set: { kind: 'detailed-action', detailed: 'win.zoom(2)' },
        read: 'target',
        type: 'i',
        value: 2,
        rule: 'MEASURED: the target keeps its OWN type, so this one is an int and not the text `2`',
    },
    {
        set: { kind: 'detailed-action', detailed: 'win.flag(true)' },
        read: 'target',
        type: 'b',
        value: true,
        rule: 'and a boolean target is a boolean',
    },
    {
        set: { kind: 'attribute', name: 'icon', variant: { type: 's', value: 'document-save-symbolic' } },
        read: 'icon',
        type: 's',
        value: 'document-save-symbolic',
        rule: "the PORTABLE icon is a NAME — GIO's own `icon` is a serialised GIcon, which MENU_MODEL_DIVERGENCE_VECTORS holds",
    },
    {
        set: { kind: 'attribute', name: 'accel', variant: { type: 's', value: '<Control>s' } },
        read: 'accel',
        type: 's',
        value: '<Control>s',
        rule: 'an accelerator string, parsed by the surface and never by GIO',
    },
    {
        set: { kind: 'attribute', name: 'hidden-when', variant: { type: 's', value: 'action-missing' } },
        read: 'hidden-when',
        type: 's',
        value: 'action-missing',
        rule: 'one of the three visibility words',
    },
    {
        set: { kind: 'attribute', name: 'verb-icon', variant: { type: 's', value: 'edit-copy-symbolic' } },
        read: 'verb-icon',
        type: 's',
        value: 'edit-copy-symbolic',
        rule: 'libadwaita reads this one and GTK does not; GIO carries it either way',
    },
    {
        set: { kind: 'attribute', name: 'use-markup', variant: { type: 'b', value: true } },
        read: 'use-markup',
        type: 'b',
        value: true,
        rule: 'MEASURED as a BOOLEAN when GIO is handed one',
    },
    {
        set: { kind: 'attribute', name: 'use-markup', variant: { type: 's', value: 'true' } },
        read: 'use-markup',
        type: 's',
        value: 'true',
        rule: 'and as a STRING when the portable writer sets it, which is what `buildGioMenu` has always done — both reach a renderer and ADR 0128 § 5 keeps the string rather than migrating it',
    },
    {
        set: { kind: 'attribute', name: 'x-house-attribute', variant: { type: 's', value: 'kept' } },
        read: 'x-house-attribute',
        type: 's',
        value: 'kept',
        rule: 'ANY attribute name is stored and read back — GIO has no vocabulary check, so a surface that dropped unknown names would be stricter than GTK',
    },
    {
        set: { kind: 'nothing' },
        read: 'x-not-a-menu-attribute',
        type: null,
        rule: 'an unknown name is an EMPTY read, not a throw',
    },
    {
        set: { kind: 'label', label: 'Save as…' },
        read: 'label',
        expectedType: 'b',
        type: null,
        rule: 'MEASURED: a mismatched `expected_type` answers null rather than converting or throwing, so a typo is indistinguishable from an absence',
    },
];

/** What a link row asks of the implementation, against the scene its docblock describes. */
export type MenuLinkQuery =
    /** `menu.get_item_link(0, 'section')` is the very section that was appended. */
    | 'section-identity'
    /** Two reads of the same link are identity-equal. */
    | 'repeat-read-identity'
    /** `get_item_link(0, 'submenu')` on a SECTION item. */
    | 'wrong-link-name'
    /** `get_item_link(0, 'x-no-such-link')`. */
    | 'unknown-link-name'
    /** The link names `iterate_item_links(0)` yields. */
    | 'link-iteration'
    /** The attribute names `iterate_item_attributes(0)` yields. */
    | 'attribute-iteration'
    /** Root emissions counted while the SECTION is appended to. */
    | 'link-emission-does-not-bubble'
    /** The link's own count after that append. */
    | 'link-count-after-append';

/** One link read, or the emission a link does not send. */
export interface MenuLinkVector {
    query: MenuLinkQuery;
    /** What it answered: a boolean, a count, or the names an iterator yielded. */
    answer: boolean | number | readonly string[] | null;
    rule: string;
}

/**
 * CORE-ONLY: the non-bubbling emission is the reason `watchMenuModel` exists, and what a
 * renderer owes is the REDRAW — held by MENU_TREE_VECTORS, which both renderers drive
 * through their own widgets.
 *
 * Links, their identity, and the emission that stays where it was raised.
 *
 * THE SCENE every row runs against: a menu holding one `append_section('Edit', sec)` at
 * position 0, where `sec` holds a single `append('Cut', 'app.cut')`.
 *
 * The last two rows are the whole reason `watchMenuModel` exists (ADR 0128 § 6). A
 * section's own `items-changed` does NOT bubble to the menu holding it, while the link
 * read reflects the change immediately — so a renderer connected only to the root shows a
 * stale section for ever. That defect was unreachable while the model was an array,
 * because every mutation went through a re-parse of the whole tree; it arrives WITH the
 * real model, which is why the vector arrives with it too.
 */
export const MENU_LINK_VECTORS: ReadonlyArray<MenuLinkVector> = [
    {
        query: 'section-identity',
        answer: true,
        rule: 'a link read hands back the INSTANCE — unlike an item, which is a snapshot',
    },
    {
        query: 'repeat-read-identity',
        answer: true,
        rule: 'two reads are identity-equal, so a renderer may key its subtree on the link it got',
    },
    {
        query: 'wrong-link-name',
        answer: null,
        rule: 'the wrong link name on a real link is still an empty read',
    },
    { query: 'unknown-link-name', answer: null, rule: 'and an unknown one, without throwing' },
    {
        query: 'link-iteration',
        answer: ['section'],
        rule: 'the iterator yields only the links actually set, not both names with one empty',
    },
    {
        query: 'attribute-iteration',
        answer: ['label'],
        rule: 'and only the attributes actually set — a section item carries its heading and nothing else',
    },
    {
        query: 'link-emission-does-not-bubble',
        answer: 0,
        rule: 'MEASURED: the ROOT is silent about a change inside its own section',
    },
    {
        query: 'link-count-after-append',
        answer: 2,
        rule: 'so the model is right and only the notification is missing: a watcher has to connect to every link it descends into',
    },
];

/** The widgets whose `menu-model` property was measured. */
export type MenuModelHolder = 'Adw.SplitButton' | 'Gtk.MenuButton';

/** One value in a write sequence: the name of a model, or the empty value. */
export type MenuModelWrite = 'A' | 'B' | null;

/** One widget `menu-model` write sequence and the `notify::menu-model` count per write. */
export interface MenuModelNotifyVector {
    widget: MenuModelHolder;
    /** The writes, in order. `A` and `B` are two DISTINCT models; `null` clears. */
    writes: ReadonlyArray<MenuModelWrite>;
    /** How many `notify::menu-model` each write produced, in order. */
    notifies: ReadonlyArray<number>;
    /** Set where the sequence ends by MUTATING the held model rather than writing one. */
    mutateHeldModel?: boolean;
    rule: string;
}

/**
 * The identity guard, which the TWO libraries disagree about.
 *
 * Both widgets declare `menu-model` with `value_type=GMenuModel` and both take the same
 * values, but `Adw.SplitButton` compares by POINTER and skips the notify for a repeat,
 * while `Gtk.MenuButton` notifies unconditionally — including `null` over `null`.
 * Measured, both of them, because a port guessing one way is wrong about one widget: a
 * port that guards both is wrong about `Gtk.MenuButton`, and one that guards neither is
 * wrong about `Adw.SplitButton`, whose notify rebuilds the popover.
 *
 * The last row is the one that puts `JSON.stringify` out of the picture for good. Mutating
 * a HELD model is not a property change: the content arrives over `items-changed` and
 * never over `notify`, so a widget keying its popover on a serialisation of the model
 * (which `split-button.ts` did, as `menuKey`) redraws on writes that changed nothing and
 * stays still for mutations that changed everything.
 */
export const MENU_MODEL_NOTIFY_VECTORS: ReadonlyArray<MenuModelNotifyVector> = [
    {
        widget: 'Adw.SplitButton',
        writes: ['A', 'A', 'B', null, null],
        notifies: [1, 0, 1, 1, 0],
        rule: 'MEASURED: an IDENTITY guard — the same model twice is one notify, and null over null is none',
    },
    {
        widget: 'Gtk.MenuButton',
        writes: ['A', 'A', 'B', null, null],
        notifies: [1, 1, 1, 1, 1],
        rule: 'MEASURED: NO guard — every write notifies, so a port must not add one here even though the sibling has it',
    },
    {
        widget: 'Adw.SplitButton',
        writes: ['A'],
        notifies: [1, 0],
        mutateHeldModel: true,
        rule: 'and a mutation of the model it already holds is NOT a property change — the second count is the append, which notifies nothing',
    },
    {
        widget: 'Gtk.MenuButton',
        writes: ['A'],
        notifies: [1, 0],
        mutateHeldModel: true,
        rule: 'the same for the unguarded widget: no guard does not mean a notify per mutation',
    },
];

/** One value written to a widget's `menu-model` property, and the door's answer. */
export interface MenuModelDoorVector {
    /** What was assigned. */
    write: 'menu' | 'null' | 'array' | 'plain-object' | 'wrong-gobject' | 'json-string';
    /** The message the write threw, or `null` where it was accepted. */
    error: string | null;
    /**
     * Where ONE surface answers differently, keyed by `AdwMenuSurface['name']`: `null`
     * means that surface accepts the write, a string is a FRAGMENT of its refusal (the
     * full message names the widget class, which belongs to the caller and not here).
     *
     * One row needs it, and the asymmetry is deliberate rather than a gap. The browser has
     * a real `menu-model` ATTRIBUTE, so a JSON string is what markup actually delivers and
     * the door parses it. NativeScript's XML Builder writes an attribute STRAIGHT onto the
     * property, so the same string would arrive at the same door a code assignment uses —
     * and ADR 0042 kept that door shut rather than open an XML seam no probe can prove.
     * Same write, two answers, each measured against its own platform.
     */
    bySurface?: Readonly<Record<string, string | null>>;
    rule: string;
}

/**
 * What the `menu-model` door accepts, and the words it refuses with.
 *
 * The two GJS refusals are reproduced VERBATIM — an array and a plain object are both
 * rejected by the GObject value check before any menu code sees them, which is what makes
 * "assign an array to `menu-model`" a type error rather than a convenience the port could
 * have kept. The `json-string` row is the port's OWN door and not GIO's: an authored
 * `menu="…"` attribute is a string by the time it reaches a widget, and ADR 0128 § 7
 * coerces it at the same seam ADR 0122 § 5 coerces a list at, which is the one place a
 * ParamSpec cannot.
 */
export const MENU_MODEL_DOOR_VECTORS: ReadonlyArray<MenuModelDoorVector> = [
    { write: 'menu', error: null, rule: 'the real thing' },
    { write: 'null', error: null, rule: 'and the empty value, which clears the popover' },
    {
        write: 'json-string',
        error: null,
        bySurface: { nativescript: 'takes a menu model, not the string' },
        rule: 'the AUTHORED door: a `menu` attribute arrives as JSON text and is parsed into a real model, so markup keeps working without an array ever being assignable — and the surface with no attribute to parse refuses it BY NAME rather than silently building an empty menu (ADR 0042)',
    },
    {
        write: 'array',
        error: "Object is not a subclass of GObject_Object, it's a Array",
        rule: 'MEASURED as `Object 0x7f… is not a subclass …`: GJS refuses the array at the value check and prints the POINTER, which nothing can match — so the port drops it and the rest is word for word',
    },
    {
        write: 'plain-object',
        error: "Object is not a subclass of GObject_Object, it's a Object",
        rule: 'and a plain object, with only the last word different',
    },
    {
        write: 'wrong-gobject',
        error: 'Object is of type GtkStringList - cannot convert to GMenuModel',
        rule: 'MEASURED with a `Gtk.Label`: a GObject that is not a menu model is refused by TYPE and not by shape, which is the refusal an array never reaches. The type NAME is the one the subset can actually build — `Gtk.StringList` (ADR 0122) is its one registered non-menu GObject, and the message is the widget-independent half of what GJS said',
    },
];

/** A behaviour the twin has to ANSWER for, named so a spec can drive it. */
export type MenuDivergenceProbe =
    /** `get_item_attribute_value(99, 'label', null)` on a one-item menu. */
    | 'attribute-read-out-of-range'
    /** `get_item_link(99, 'section')` on a one-item menu. */
    | 'link-read-out-of-range'
    /** `freeze()`, then `append` — `is_mutable()` and the resulting count. */
    | 'freeze-does-not-lock'
    /** `set_label` on an item ALREADY appended. */
    | 'item-is-a-snapshot'
    /** `set_attribute_value(name, null)`. */
    | 'null-attribute-removes'
    /** `set_attribute_value('x', 'str')` — a bare JS string where a Variant belongs. */
    | 'bare-string-attribute-refused'
    /** The serialised-GIcon `icon` attribute GIO writes and the subset has no type for. */
    | 'icon-is-a-serialised-gicon'
    /** `get_item_attribute` — the varargs form. */
    | 'varargs-attribute-getter-absent'
    /** `get_string` / `get_boolean` / `get_int32` on an attribute Variant. */
    | 'typed-variant-getters-refused'
    /** What `expected_type` is: `get_item_attribute_value(0, 'label', <type>)`. */
    | 'variant-type-is-a-string';

/** One place the twin cannot copy GIO, with what each side does. */
export interface MenuModelDivergenceVector {
    probe: MenuDivergenceProbe;
    /** What GIO does, measured. */
    gio: string;
    /** What the twin does — the port's declared answer, which the spec drives. */
    twin: string;
    rule: string;
}

/**
 * CORE-ONLY: a divergence is between the port and GIO, so there is no third surface to
 * hold it against — the renderer-visible consequence is the snapshot read, which is
 * MENU_TREE_VECTORS, and both renderers drive that.
 *
 * Where the port cannot copy GIO, and what it does instead.
 *
 * The first row is not a style choice. `get_item_attribute_value` past the end trips a C
 * position assertion and takes the process with it — measured by crashing a probe — so
 * there is no behaviour to reproduce and the twin has to PICK one. It picks the empty
 * read, matching every other out-of-range read in this package. `freeze-does-not-lock` is
 * the opposite of what the name suggests and is measured both ways: the flag flips and the
 * mutators keep working, so a twin that refused mutation after a freeze would break a
 * caller GIO lets through. The last three are the edges of ADR 0118 § 2's variant subset
 * and of GJS's own introspection, and each is a deliberate narrowing rather than a gap
 * someone forgot.
 */
export const MENU_MODEL_DIVERGENCE_VECTORS: ReadonlyArray<MenuModelDivergenceVector> = [
    {
        probe: 'attribute-read-out-of-range',
        gio: 'SIGABRT — a C position assertion, not a catchable error',
        twin: 'null',
        rule: 'MEASURED by crashing: there is no GIO answer to match, so the twin DEFINES the empty read and says so here rather than claiming parity',
    },
    {
        probe: 'link-read-out-of-range',
        gio: 'null — the link read is bounds-checked where the attribute read is not',
        twin: 'null',
        rule: 'the same answer, and the asymmetry is GIO\u2019s rather than the port\u2019s',
    },
    {
        probe: 'freeze-does-not-lock',
        gio: '`is_mutable()` flips to false and the mutators KEEP WORKING — a post-freeze append neither throws nor is ignored',
        twin: 'the same: a flag, not a lock',
        rule: 'MEASURED, and the opposite of what the name suggests',
    },
    {
        probe: 'item-is-a-snapshot',
        gio: 'a later `set_label` on an appended item does not reach the menu',
        twin: 'the same — and `menuTree` hands back a deep snapshot TREE, which no later mutation reaches either',
        rule: 'MEASURED, and the reason the specs compare menu nodes by VALUE: an identity assertion would hold the port to a sharing GIO does not do',
    },
    {
        probe: 'null-attribute-removes',
        gio: '`set_attribute_value(name, null)` and `set_label(null)` REMOVE the attribute',
        twin: 'the same',
        rule: 'null is a delete, not a stored empty value — so a round trip through an item drops what it was handed null for',
    },
    {
        probe: 'bare-string-attribute-refused',
        gio: "Expected an object of type GVariant for argument 'value' but got type string",
        twin: 'the same refusal',
        rule: 'an attribute value is a Variant; the convenience of passing text belongs to `set_attribute`, which is varargs and therefore absent',
    },
    {
        probe: 'icon-is-a-serialised-gicon',
        gio: "`icon` reads as `(sv)` — e.g. ('themed', <['document-save-symbolic', 'document-save']>)",
        twin: 'an icon NAME as `s`, which is what `buildGioMenu` has always written',
        rule: "ADR 0118 § 2's subset is `b i u d s` and arrays of them, with no type for a serialised GIcon — so the divergence is the subset's, declared here rather than worked around at each reader",
    },
    {
        probe: 'varargs-attribute-getter-absent',
        gio: 'exists in C, NOT introspectable',
        twin: 'absent',
        rule: 'a method GJS cannot call is not part of the surface a port owes — `get_item_attribute_value` is the whole door',
    },
    {
        probe: 'typed-variant-getters-refused',
        gio: 'get_string / get_boolean / get_int32 all work',
        twin: 'REFUSED by the Variant subset — the twin reads through `deepUnpack()` and `get_type_string()`',
        rule: 'a twin reaching for the typed getters would be using a surface the port does not ship, which is how a port passes its own tests and fails under GJS',
    },
    {
        probe: 'variant-type-is-a-string',
        gio: '`expected_type` is a `GLib.VariantType`, built as `new GLib.VariantType("s")`',
        twin: 'a type STRING — `get_item_attribute_value(0, "label", "s")`',
        rule: "ADR 0118 § 2's subset has `GLib.Variant` and no `GLib.VariantType`, so the port carries the TYPE STRING a Variant already answers from `get_type_string()`. Signature-only, and it is the whole reason the filter in MENU_ATTRIBUTE_VARIANT_VECTORS is spelled `expectedType: 'b'`",
    },
];

/** One `Gio` menu constant the twin has to export with the measured value. */
export interface MenuConstantVector {
    /** The name on the `Gio` namespace. */
    name: string;
    /** Its value, measured. */
    value: string | number;
    rule: string;
}

/**
 * CORE-ONLY: a constant has no rendered form at all. What a renderer does with the names
 * it stands for is MENU_NORMALIZE_VECTORS, which both renderers drive through their own
 * split button.
 *
 * The constants, because a caller writing `Gio.MENU_ATTRIBUTE_LABEL` instead of `'label'`
 * has to get the same string from the port as from GJS.
 *
 * `MENU_EXPORTER_MAX_SECTION_SIZE` is the odd one out: nothing in the port enforces it and
 * nothing should, since it is a D-Bus exporter limit. It is here so that a caller reading
 * it is handed the real number rather than `undefined` — the failure mode of a port that
 * exports the constants it happens to use.
 */
export const MENU_CONSTANT_VECTORS: ReadonlyArray<MenuConstantVector> = [
    { name: 'MENU_ATTRIBUTE_ACTION', value: 'action', rule: 'the attribute names GIO spells out' },
    {
        name: 'MENU_ATTRIBUTE_ACTION_NAMESPACE',
        value: 'action-namespace',
        rule: 'carried, and never interpreted by the port',
    },
    {
        name: 'MENU_ATTRIBUTE_ICON',
        value: 'icon',
        rule: 'the name is shared even where the TYPE diverges (MENU_MODEL_DIVERGENCE_VECTORS)',
    },
    { name: 'MENU_ATTRIBUTE_LABEL', value: 'label', rule: 'the one every item has' },
    { name: 'MENU_ATTRIBUTE_TARGET', value: 'target', rule: 'and the one whose type varies' },
    { name: 'MENU_LINK_SECTION', value: 'section', rule: 'the two link names, and there are only two' },
    { name: 'MENU_LINK_SUBMENU', value: 'submenu', rule: 'flattening inlines the first and not the second' },
    {
        name: 'MENU_EXPORTER_MAX_SECTION_SIZE',
        value: 1000,
        rule: 'a D-Bus exporter limit the port does not enforce, exported so a caller reading it is not handed undefined',
    },
];
