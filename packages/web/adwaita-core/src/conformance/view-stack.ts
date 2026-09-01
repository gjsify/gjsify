// View-stack conformance vectors — the spec all three implementations are held to.
//
// Each row is a small SCRIPT rather than a single input/output pair, because the behaviour
// pinned is a state machine: a page list, a sequence of operations, and the exact sequence
// of change notifications those produce. All three suites replay the SAME row — the core
// against `ViewStackState`, the web against a mounted `<adw-view-stack>`, NativeScript
// against the state its real widget delegates to — so a renderer that quietly
// re-implements any clause (the guard on a fractional index, the first-VISIBLE-page
// auto-pick, the silent `null` name, the no-notify on remove) fails when it drifts.
//
// Every row cites the C function it comes from; where a row contradicts what a port
// shipped, the `rule` says so, and that row is a regression pin.
//
// Reference: refs/libadwaita/src/adw-view-stack.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** A page as a vector declares it — the input half of `AdwViewStackPageSpec`. */
export interface ViewStackVectorPage {
    name: string;
    /** Explicit title; omitted means "fall back to the name". */
    title?: string;
    /** GTK icon name, pre-normalization. */
    icon?: string;
    /** `AdwViewStackPage:visible`; omitted means `true`. */
    visible?: boolean;
}

/** One operation a vector applies after its pages are added. */
export type ViewStackVectorOp =
    | { readonly kind: 'selectIndex'; readonly index: number }
    | { readonly kind: 'selectName'; readonly name: string | null | undefined }
    | { readonly kind: 'setPageVisible'; readonly name: string; readonly visible: boolean }
    | { readonly kind: 'removePage'; readonly name: string };

/** One expected change notification, in the order it is emitted. */
export interface ViewStackVectorChange {
    /** Index of the newly-visible page, `-1` for none. */
    index: number;
    /** Its name, `''` for none. */
    name: string;
    /** Its title, `''` for none. */
    title: string;
    /** `true` only for an explicit select; every auto-pick is `false`. */
    interactive: boolean;
}

/** One end-to-end view-stack expectation. */
export interface ViewStackVector {
    rule: string;
    derivedFrom: string;
    /** The pages, added in this order. */
    pages: readonly ViewStackVectorPage[];
    /** Changes emitted WHILE the pages are added (the auto-pick), in order. */
    setupChanges: readonly ViewStackVectorChange[];
    ops: readonly ViewStackVectorOp[];
    /**
     * Return value of each op, in order. Asserted by the core suite only — the
     * renderers drive the same operations through property setters, which have
     * no return value; what they assert is `changes` plus the final state.
     */
    opResults: readonly boolean[];
    /** Changes emitted BY the ops, in order. */
    changes: readonly ViewStackVectorChange[];
    /** Final selected index, `-1` for none. */
    visibleIndex: number;
    /** Final selected name, `''` for none. */
    visibleName: string;
    /** Final selected title, `''` for none. */
    visibleTitle: string;
    count: number;
    /** Expected `duplicateNames`, when the row exercises them. */
    duplicateNames?: readonly string[];
    /** Expected `diagnostics` (C's `g_warning` texts), when the row exercises them. */
    diagnostics?: readonly string[];
}

// "Übersicht" in its two Unicode spellings — precomposed U+00DC (NFC) versus
// U+0055 + combining U+0308 (NFD). Written as escapes on purpose: the two are
// visually identical in source, and an editor or a "helpful" formatter that
// normalized them would silently delete this row's entire point. g_strcmp0
// compares UTF-8 BYTES with no normalization, exactly as JS `===` compares
// UTF-16 code units.
const UEBERSICHT_NFC = '\u00DCbersicht';
const UEBERSICHT_NFD = 'U\u0308bersicht';

/**
 * The selection state machine of `Adw.ViewStack`, end to end.
 *
 * Read the `rule` of each row before changing it: several encode behaviour that
 * BOTH ports had wrong, and "fixing" the vector to match a renderer would undo
 * the reason this table exists.
 */
export const VIEW_STACK_VECTORS: ReadonlyArray<ViewStackVector> = [
    {
        rule: 'the first page added becomes visible — and the auto-pick NOTIFIES (both ports were silent here, which is why every bound switcher needed a manual refresh())',
        derivedFrom: 'add_page, adw-view-stack.c:1149-1151 → set_visible_child notify at :1038-1039',
        pages: [{ name: 'learn' }, { name: 'code' }],
        setupChanges: [{ index: 0, name: 'learn', title: 'learn', interactive: false }],
        ops: [],
        opResults: [],
        changes: [],
        visibleIndex: 0,
        visibleName: 'learn',
        visibleTitle: 'learn',
        count: 2,
    },
    {
        rule: 'the first VISIBLE page wins, not the first added',
        derivedFrom: "add_page's `gtk_widget_get_visible (page->widget)` gate, adw-view-stack.c:1149-1151",
        pages: [{ name: 'a', visible: false }, { name: 'b' }],
        setupChanges: [{ index: 1, name: 'b', title: 'b', interactive: false }],
        ops: [],
        opResults: [],
        changes: [],
        visibleIndex: 1,
        visibleName: 'b',
        visibleTitle: 'b',
        count: 2,
    },
    {
        rule: 'with every page hidden nothing is selected and nothing is emitted',
        derivedFrom:
            'set_visible_child NULL scan finds no visible page (adw-view-stack.c:961-974), then returns at :976-977 with both NULL',
        pages: [
            { name: 'a', visible: false },
            { name: 'b', visible: false },
        ],
        setupChanges: [],
        ops: [],
        opResults: [],
        changes: [],
        visibleIndex: -1,
        visibleName: '',
        visibleTitle: '',
        count: 2,
    },
    {
        rule: 'an index past the end is refused',
        derivedFrom:
            'adw_view_stack_pages_select_item, adw-view-stack.c:682-683 `if (position >= children->len) return FALSE;`',
        pages: [{ name: 'learn' }, { name: 'code' }],
        setupChanges: [{ index: 0, name: 'learn', title: 'learn', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 2 }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'learn',
        visibleTitle: 'learn',
        count: 2,
    },
    {
        rule: 'a negative index is refused',
        derivedFrom:
            'adw_view_stack_pages_select_item takes a guint, adw-view-stack.c:675-677 — -1 wraps to G_MAXUINT and fails the bound check at :682',
        pages: [{ name: 'learn' }, { name: 'code' }],
        setupChanges: [{ index: 0, name: 'learn', title: 'learn', interactive: false }],
        ops: [{ kind: 'selectIndex', index: -1 }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'learn',
        visibleTitle: 'learn',
        count: 2,
    },
    {
        rule: 'REGRESSION PIN — a fractional index is refused. Both ports guarded with Number.isFinite, so 1.5 was stored, no page matched it, the whole stack went blank and a bogus notify still fired',
        derivedFrom:
            'adw_view_stack_pages_select_item(GtkSelectionModel*, guint position, gboolean), adw-view-stack.c:675-683 — a fractional position cannot exist',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'selectIndex', index: 1.5 }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 3,
    },
    {
        rule: 'NaN, Infinity and a numeric STRING are refused too — the guint contract admits integers only',
        derivedFrom: 'adw_view_stack_pages_select_item, adw-view-stack.c:675-683',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: Number.NaN },
            { kind: 'selectIndex', index: Number.POSITIVE_INFINITY },
            { kind: 'selectIndex', index: '1' as unknown as number },
        ],
        opResults: [false, false, false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 3,
    },
    {
        rule: 'selecting the same index twice notifies once',
        derivedFrom:
            'set_visible_child idempotence guard, adw-view-stack.c:976-977 `if (page == self->visible_child) return;`',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 1 },
            { kind: 'selectIndex', index: 1 },
        ],
        opResults: [true, false],
        changes: [{ index: 1, name: 'b', title: 'b', interactive: true }],
        visibleIndex: 1,
        visibleName: 'b',
        visibleTitle: 'b',
        count: 3,
    },
    {
        rule: 'an unknown name leaves the selection alone and records the warning C prints',
        derivedFrom: 'adw_view_stack_set_visible_child_name, adw-view-stack.c:2409-2412 (g_warning, then return)',
        pages: [{ name: 'learn' }, { name: 'code' }, { name: 'debug' }],
        setupChanges: [{ index: 0, name: 'learn', title: 'learn', interactive: false }],
        ops: [{ kind: 'selectName', name: 'missing' }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'learn',
        visibleTitle: 'learn',
        count: 3,
        diagnostics: ["Child name 'missing' not found in AdwViewStack"],
    },
    {
        rule: 'null and undefined are SILENT no-ops — no selection change and, unlike an unknown name, no diagnostic',
        derivedFrom:
            'adw_view_stack_set_visible_child_name, adw-view-stack.c:2404-2405 — `if (name == NULL) return;` sits BEFORE find_page_for_name and its warning',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectName', name: null },
            { kind: 'selectName', name: undefined },
        ],
        opResults: [false, false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 3,
        diagnostics: [],
    },
    {
        rule: "an EMPTY name is a legal lookup matching a page literally named '' — not 'no name' (web's declarative path used a falsy check and silently showed page 0)",
        derivedFrom:
            'find_page_for_name, adw-view-stack.c:901 `g_strcmp0 (page->name, name) == 0` — g_strcmp0("", "") is 0; only NULL is special-cased, at :2404',
        pages: [{ name: 'a' }, { name: '' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'selectName', name: '' }],
        opResults: [true],
        changes: [{ index: 1, name: '', title: '', interactive: true }],
        visibleIndex: 1,
        visibleName: '',
        visibleTitle: '',
        count: 3,
    },
    {
        rule: 'a duplicate name is still added, warned about, and resolves to the FIRST match',
        derivedFrom:
            'add_page warns but only breaks out of the check loop and still adds (adw-view-stack.c:1115-1126 + :1136); find_page_for_name returns on the first match (:898-905)',
        pages: [{ name: 'dup', title: 'First' }, { name: 'other' }, { name: 'dup', title: 'Second' }],
        setupChanges: [{ index: 0, name: 'dup', title: 'First', interactive: false }],
        ops: [
            { kind: 'selectName', name: 'other' },
            { kind: 'selectName', name: 'dup' },
        ],
        opResults: [true, true],
        changes: [
            { index: 1, name: 'other', title: 'other', interactive: true },
            { index: 0, name: 'dup', title: 'First', interactive: true },
        ],
        visibleIndex: 0,
        visibleName: 'dup',
        visibleTitle: 'First',
        count: 3,
        duplicateNames: ['dup'],
        diagnostics: ['While adding page: duplicate child name in AdwViewStack: dup'],
    },
    {
        rule: 'name matching is an exact, UNNORMALIZED compare — the NFD spelling of a name does not match its NFC page',
        derivedFrom:
            'find_page_for_name, adw-view-stack.c:901 — g_strcmp0 is a byte compare over UTF-8, with no Unicode normalization',
        pages: [{ name: 'other' }, { name: UEBERSICHT_NFC }],
        setupChanges: [{ index: 0, name: 'other', title: 'other', interactive: false }],
        ops: [
            { kind: 'selectName', name: UEBERSICHT_NFC },
            { kind: 'selectName', name: UEBERSICHT_NFD },
        ],
        opResults: [true, false],
        changes: [{ index: 1, name: UEBERSICHT_NFC, title: UEBERSICHT_NFC, interactive: true }],
        visibleIndex: 1,
        visibleName: UEBERSICHT_NFC,
        visibleTitle: UEBERSICHT_NFC,
        count: 2,
        diagnostics: [`Child name '${UEBERSICHT_NFD}' not found in AdwViewStack`],
    },
    {
        rule: 'hiding the selected page falls back to the first still-visible one, notifying as an auto-pick',
        derivedFrom:
            'update_child_visible, adw-view-stack.c:1071-1072 `else if (self->visible_child == page && !visible) set_visible_child (self, NULL);` → the first-visible scan at :961-974',
        pages: [{ name: 'a' }, { name: 'b' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 1 },
            { kind: 'setPageVisible', name: 'b', visible: false },
        ],
        opResults: [true, true],
        changes: [
            { index: 1, name: 'b', title: 'b', interactive: true },
            { index: 0, name: 'a', title: 'a', interactive: false },
        ],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
    },
    {
        rule: 'hiding the selected FIRST page moves the selection forward — the fallback scan skips the page it just hid',
        derivedFrom:
            'set_visible_child NULL scan, adw-view-stack.c:961-974, reached from update_child_visible :1071-1072',
        pages: [{ name: 'a' }, { name: 'b' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'a', visible: false }],
        opResults: [true],
        changes: [{ index: 1, name: 'b', title: 'b', interactive: false }],
        visibleIndex: 1,
        visibleName: 'b',
        visibleTitle: 'b',
        count: 2,
    },
    {
        rule: 'hiding the LAST visible page selects nothing — and unlike a remove, this DOES notify',
        derivedFrom:
            'update_child_visible :1071-1072 → set_visible_child(self, NULL) with a non-NULL visible_child, which falls through to the notify at :1038-1039',
        pages: [{ name: 'a' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'a', visible: false }],
        opResults: [true],
        changes: [{ index: -1, name: '', title: '', interactive: false }],
        visibleIndex: -1,
        visibleName: '',
        visibleTitle: '',
        count: 1,
    },
    {
        rule: 'making a page visible while nothing is selected selects it',
        derivedFrom:
            'update_child_visible, adw-view-stack.c:1069-1070 `if (self->visible_child == NULL && visible) set_visible_child (self, page);`',
        pages: [
            { name: 'a', visible: false },
            { name: 'b', visible: false },
        ],
        setupChanges: [],
        ops: [{ kind: 'setPageVisible', name: 'b', visible: true }],
        opResults: [true],
        changes: [{ index: 1, name: 'b', title: 'b', interactive: false }],
        visibleIndex: 1,
        visibleName: 'b',
        visibleTitle: 'b',
        count: 2,
    },
    {
        rule: 'making a page visible while ANOTHER is already selected moves nothing',
        derivedFrom:
            'update_child_visible, adw-view-stack.c:1069-1072 — neither branch fires while visible_child is set and stays set',
        pages: [{ name: 'a', visible: false }, { name: 'b' }],
        setupChanges: [{ index: 1, name: 'b', title: 'b', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'a', visible: true }],
        opResults: [false],
        changes: [],
        visibleIndex: 1,
        visibleName: 'b',
        visibleTitle: 'b',
        count: 2,
    },
    {
        rule: 'setting the visible flag to the value it already has returns early',
        derivedFrom:
            'adw_view_stack_page_set_visible, adw-view-stack.c — `if (visible == self->visible) return;` before update_child_visible',
        pages: [{ name: 'a' }, { name: 'b' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'a', visible: true }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
    },
    {
        rule: "flipping an unknown page's visibility changes nothing and records the not-found warning",
        derivedFrom:
            'update_child_visible is only ever reached through a real AdwViewStackPage (adw-view-stack.c:1095-1107); the name lookup that fails is find_page_for_name :891-906 + the g_warning at :2410',
        pages: [{ name: 'a' }, { name: 'b' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'setPageVisible', name: 'missing', visible: true }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
        diagnostics: ["Child name 'missing' not found in AdwViewStack"],
    },
    {
        rule: 'a hidden page cannot be selected by name — the lookup succeeds and the commit is then skipped, silently',
        derivedFrom:
            'adw_view_stack_set_visible_child_name, adw-view-stack.c:2415 `if (gtk_widget_get_visible (page->widget)) set_visible_child (self, page);`',
        pages: [{ name: 'a' }, { name: 'b', visible: false }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'selectName', name: 'b' }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
        diagnostics: [],
    },
    {
        rule: 'removing the VISIBLE page clears the selection without re-picking and WITHOUT notifying',
        derivedFrom:
            'stack_remove, adw-view-stack.c:1202-1203 `if (self->visible_child == page) self->visible_child = NULL;` — the function never calls set_visible_child on that path',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 1 },
            { kind: 'removePage', name: 'b' },
        ],
        opResults: [true, true],
        changes: [{ index: 1, name: 'b', title: 'b', interactive: true }],
        visibleIndex: -1,
        visibleName: '',
        visibleTitle: '',
        count: 2,
    },
    {
        rule: 'removing a LATER page leaves the selection where it is',
        derivedFrom: 'stack_remove, adw-view-stack.c:1202 — the guard only fires for the visible page',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'removePage', name: 'c' }],
        opResults: [true],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
    },
    {
        rule: 'removing an EARLIER page keeps the same page selected and shifts its index down — C holds a pointer, not a slot',
        derivedFrom:
            'stack_remove, adw-view-stack.c:1192-1209 — visible_child is an AdwViewStackPage* untouched unless it IS the removed page',
        pages: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [
            { kind: 'selectIndex', index: 2 },
            { kind: 'removePage', name: 'a' },
        ],
        opResults: [true, true],
        changes: [{ index: 2, name: 'c', title: 'c', interactive: true }],
        visibleIndex: 1,
        visibleName: 'c',
        visibleTitle: 'c',
        count: 2,
    },
    {
        rule: 'removing an unknown name changes nothing',
        derivedFrom: 'stack_remove, adw-view-stack.c:1192-1194 `page = find_page_for_widget (...); if (!page) return;`',
        pages: [{ name: 'a' }, { name: 'b' }],
        setupChanges: [{ index: 0, name: 'a', title: 'a', interactive: false }],
        ops: [{ kind: 'removePage', name: 'missing' }],
        opResults: [false],
        changes: [],
        visibleIndex: 0,
        visibleName: 'a',
        visibleTitle: 'a',
        count: 2,
    },
    {
        rule: 'removing the first of two duplicates makes the second reachable by that name',
        derivedFrom:
            'find_page_for_name returns the first match (adw-view-stack.c:898-905); stack_remove then removes exactly one page (:1209)',
        pages: [
            { name: 'dup', title: 'First' },
            { name: 'dup', title: 'Second' },
        ],
        setupChanges: [{ index: 0, name: 'dup', title: 'First', interactive: false }],
        ops: [
            { kind: 'removePage', name: 'dup' },
            { kind: 'selectName', name: 'dup' },
        ],
        opResults: [true, true],
        changes: [{ index: 0, name: 'dup', title: 'Second', interactive: true }],
        visibleIndex: 0,
        visibleName: 'dup',
        visibleTitle: 'Second',
        count: 1,
        duplicateNames: [],
        diagnostics: ['While adding page: duplicate child name in AdwViewStack: dup'],
    },
    {
        rule: 'an empty stack selects nothing — -1, not 0, so "nothing is selected" is distinguishable from "page 0 is selected"',
        derivedFrom:
            'adw_view_stack_get_visible_child_name returns NULL while visible_child is NULL (adw-view-stack.c:2379-2385); select_item bound check :682-683 with children->len == 0',
        pages: [],
        setupChanges: [],
        ops: [{ kind: 'selectIndex', index: 0 }],
        opResults: [false],
        changes: [],
        visibleIndex: -1,
        visibleName: '',
        visibleTitle: '',
        count: 0,
    },
];

/** One page-descriptor normalization expectation. */
export interface ViewStackPageDescriptorVector {
    rule: string;
    derivedFrom: string;
    page: ViewStackVectorPage;
    title: string;
    icon: string;
    /** Resolved `visible`. */
    visible: boolean;
}

/**
 * What a declared page resolves to in `pages[i]` — the shape a bound switcher
 * reads. `icon` is a NAME and is never `undefined`; the NS port used to store
 * `undefined`, which the web switcher bar's `page.icon.length` would throw on.
 */
export const VIEW_STACK_PAGE_VECTORS: ReadonlyArray<ViewStackPageDescriptorVector> = [
    {
        rule: 'an omitted title falls back to the name',
        derivedFrom:
            'add_internal, adw-view-stack.c:1170-1172 — C stores NULL; the name fallback is a deliberate, shared port deviation',
        page: { name: 'learn' },
        title: 'learn',
        icon: '',
        visible: true,
    },
    {
        rule: 'an explicit title wins',
        derivedFrom: 'adw_view_stack_add_titled, adw-view-stack.c:2219',
        page: { name: 'learn', title: 'Learn' },
        title: 'Learn',
        icon: '',
        visible: true,
    },
    {
        rule: 'an EXPLICITLY empty title stays empty — only an absent one falls back',
        derivedFrom:
            'add_internal, adw-view-stack.c:1171 `page->title = g_strdup (title);` — "" is a title, NULL is not',
        page: { name: 'learn', title: '' },
        title: '',
        icon: '',
        visible: true,
    },
    {
        rule: 'a `-symbolic` suffix is stripped from the icon NAME',
        derivedFrom: 'PAGE_PROP_ICON_NAME is a name string, adw-view-stack.c:393-396 + :1887-1912',
        page: { name: 'learn', icon: 'go-next-symbolic' },
        title: 'learn',
        icon: 'go-next',
        visible: true,
    },
    {
        rule: 'a name without the suffix is passed through untouched',
        derivedFrom: 'PAGE_PROP_ICON_NAME, adw-view-stack.c:393-396',
        page: { name: 'learn', icon: 'view-refresh' },
        title: 'learn',
        icon: 'view-refresh',
        visible: true,
    },
    {
        rule: 'an absent icon is the EMPTY STRING, never undefined — a switcher reads `.icon.length`',
        derivedFrom:
            'PAGE_PROP_ICON_NAME defaults to NULL (adw-view-stack.c:393-396); "" is the agreed JS stand-in both renderers already assume',
        page: { name: 'learn' },
        title: 'learn',
        icon: '',
        visible: true,
    },
    {
        rule: 'a page declared hidden keeps `visible: false` in its descriptor',
        derivedFrom: 'PAGE_PROP_VISIBLE, adw-view-stack.c — default TRUE, set by adw_view_stack_page_set_visible',
        page: { name: 'learn', visible: false },
        title: 'learn',
        icon: '',
        visible: false,
    },
    {
        rule: 'a page named "" resolves to an empty title, not to a synthesized one',
        derivedFrom:
            'add_internal, adw-view-stack.c:1170-1171 — the name is stored verbatim; web used to invent `page-<index>`',
        page: { name: '' },
        title: '',
        icon: '',
        visible: true,
    },
];

/** One `normalizeIconName` expectation. */
export interface ViewStackIconNameVector {
    /** The declared `icon-name`. */
    icon: string | null | undefined;
    normalized: string;
    rule: string;
}

/**
 * `normalizeIconName` — the one home for a `-symbolic` strip that appeared
 * eleven times across the web package and zero times in NS, plus the token guard
 * that appeared exactly ONCE (`<adw-split-button>`) and was missing from every
 * other copy.
 *
 * The guard rows are not hypothetical: `<gtk-menu-button>` interpolated the raw
 * name into `class="adw-icon adw-menu-button-icon adw-icon--<name>"`, so
 * `icon-name="a b"` shipped a stray `b` class — for its own icon and for every
 * JSON menu entry's. NOTHING in the build was in a position to notice, because
 * the one element that DID guard passed its own spec.
 */
export const VIEW_STACK_ICON_NAME_VECTORS: ReadonlyArray<ViewStackIconNameVector> = [
    { icon: 'go-next-symbolic', normalized: 'go-next', rule: 'the suffix is stripped' },
    { icon: 'view-refresh', normalized: 'view-refresh', rule: 'a plain name is untouched' },
    { icon: undefined, normalized: '', rule: 'undefined becomes the empty string' },
    { icon: null, normalized: '', rule: 'null becomes the empty string' },
    { icon: '', normalized: '', rule: 'the empty string stays empty' },
    {
        icon: 'go-symbolic-next',
        normalized: 'go-symbolic-next',
        rule: 'the match is END-anchored — a mid-name `-symbolic` survives',
    },
    {
        icon: 'go-next-symbolic-symbolic',
        normalized: 'go-next-symbolic',
        rule: 'exactly ONE suffix is stripped, not repeated',
    },
    { icon: 'symbolic', normalized: 'symbolic', rule: 'the separating hyphen is part of the suffix' },
    { icon: 'a b', normalized: '', rule: 'a SPACE is two class tokens — the second one used to be injected' },
    {
        icon: 'go-next-symbolic evil',
        normalized: '',
        rule: 'the strip runs first and does not rescue it — `-symbolic` is not the end of the string',
    },
    { icon: 'go_next', normalized: 'go_next', rule: 'an underscore is a legal identifier character' },
    { icon: 'GoNext2', normalized: 'GoNext2', rule: 'case and digits are legal' },
    {
        icon: 'org.gnome.Builder',
        normalized: '',
        rule: 'a reverse-DNS application icon is not one token — it never had a mask class either',
    },
    { icon: 'icon"onload=x', normalized: '', rule: 'a quote cannot reach an attribute value' },
    { icon: '  go-next  ', normalized: '', rule: 'surrounding whitespace is not trimmed away, it is rejected' },
];
