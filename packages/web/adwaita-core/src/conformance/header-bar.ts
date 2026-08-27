// Header-bar conformance vectors — the spec every renderer is held to.
//
// Each row is derived from a named function in the libadwaita C source and cites its
// line. Two of them exist because a port already got the rule wrong: the end-packing
// order was mirrored in NativeScript for the life of that widget, and no port at all
// rebuilds the derived title when the title widget is cleared.
//
// Reference: refs/libadwaita/src/adw-header-bar.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One packing-order expectation. Children are named by letter; the result is DRAW order. */
export interface HeaderBarPackVector {
    /** The calls, in order. `start:a` is `pack_start(a)`, `end:a` is `pack_end(a)`. */
    calls: readonly string[];
    /** Expected `state.start`, left to right. */
    start: readonly string[];
    /** Expected `state.end`, left to right. */
    end: readonly string[];
    rule: string;
}

/**
 * `adw_header_bar_pack_start` is `gtk_box_append` (:1083); `adw_header_bar_pack_end`
 * is `gtk_box_prepend` (:1106).
 *
 * CORE-ONLY: GAP — no renderer drives this table yet. Rewiring the NativeScript and web
 * header bars onto `HeaderBarState` is a diff per renderer with its own spec surface, and
 * the rule lands first so the React Native set is written against it. Tracked in #1343.
 */
export const HEADER_BAR_PACK_VECTORS: ReadonlyArray<HeaderBarPackVector> = [
    { calls: [], start: [], end: [], rule: 'an empty bar has both slots empty' },
    { calls: ['start:a'], start: ['a'], end: [], rule: 'one start child' },
    {
        calls: ['start:a', 'start:b'],
        start: ['a', 'b'],
        end: [],
        rule: 'pack_start APPENDS — first packed is furthest from the centre',
    },
    {
        calls: ['end:a', 'end:b'],
        start: [],
        end: ['b', 'a'],
        rule: 'pack_end PREPENDS — first packed sits NEAREST the end, so last in draw order',
    },
    {
        calls: ['end:menu', 'end:search'],
        start: [],
        end: ['search', 'menu'],
        rule: 'the mirrored case a port shipped: libadwaita draws `search | menu`, not `menu | search`',
    },
    {
        calls: ['start:back', 'end:menu', 'start:new', 'end:search'],
        start: ['back', 'new'],
        end: ['search', 'menu'],
        rule: 'the two slots are independent — interleaving the calls changes neither',
    },
    {
        calls: ['end:a', 'end:b', 'end:c'],
        start: [],
        end: ['c', 'b', 'a'],
        rule: 'three deep: each later pack_end goes in FRONT of the previous',
    },
];

/** One title-widget either/or expectation. */
export interface HeaderBarTitleWidgetVector {
    /** `set_title_widget` arguments in order; `null` clears. */
    calls: readonly (string | null)[];
    /** Expected `state.titleWidget`. */
    titleWidget: string | null;
    /** Whether the derived title holds the centre afterwards. */
    derivedPresent: boolean;
    /** What each call returns — `false` is `adw_header_bar_set_title_widget`'s early return. */
    changed: readonly boolean[];
    rule: string;
}

/**
 * `adw_header_bar_set_title_widget` (:1189): same-widget returns early (:1198), the
 * centre is emptied unconditionally (:1201), and a NULL argument calls
 * `construct_title_label` again (:1211, guarded by `self->title_label == NULL` at :1210).
 *
 * CORE-ONLY: GAP — no renderer drives this table yet. Rewiring the NativeScript and web
 * header bars onto `HeaderBarState` is a diff per renderer with its own spec surface, and
 * the rule lands first so the React Native set is written against it. Tracked in #1343.
 */
export const HEADER_BAR_TITLE_WIDGET_VECTORS: ReadonlyArray<HeaderBarTitleWidgetVector> = [
    {
        calls: [],
        titleWidget: null,
        derivedPresent: true,
        changed: [],
        rule: 'a bar with no title widget shows the derived title',
    },
    {
        calls: ['entry'],
        titleWidget: 'entry',
        derivedPresent: false,
        changed: [true],
        rule: 'setting a title widget drops the derived title — the two never stack',
    },
    {
        calls: ['entry', null],
        titleWidget: null,
        derivedPresent: true,
        changed: [true, true],
        rule: 'clearing REBUILDS the derived title (construct_title_label at :1211) — no port does this',
    },
    {
        calls: ['entry', 'entry'],
        titleWidget: 'entry',
        derivedPresent: false,
        changed: [true, false],
        rule: 'the same widget twice is an early return, no notify (:1198)',
    },
    {
        calls: [null],
        titleWidget: null,
        derivedPresent: true,
        changed: [false],
        rule: 'null over null is also the early return — NOT "the derived title was rebuilt"',
    },
    {
        calls: ['a', 'b'],
        titleWidget: 'b',
        derivedPresent: false,
        changed: [true, true],
        rule: 'replacing one title widget with another never shows the derived title in between',
    },
];

/** One title-resolution expectation. */
export interface HeaderBarTitleSourceVector {
    sources: {
        bottomSheetShowsDragHandle?: boolean;
        navigationPageTitle?: string | null;
        dialogTitle?: string | null;
        windowTitle?: string | null;
        applicationName?: string | null;
        programName?: string | null;
    };
    /** What the derived label shows. `''` is `gtk_label_set_text (…, NULL)`. */
    title: string;
    rule: string;
}

/**
 * `update_title` (:475-508). The walk tests POINTERS (`if (!title)` at :491, :494, :501
 * and :504), so an empty string is a value and ends the chain — it does not fall through.
 * Which is the DEFAULT for two of the five sources, not a corner case: the page and dialog
 * titles are `""` until set and never NULL, so only the window title can fall through by
 * being unset.
 *
 * CORE-ONLY: GAP — no renderer drives this table yet. Rewiring the NativeScript and web
 * header bars onto `HeaderBarState` is a diff per renderer with its own spec surface, and
 * the rule lands first so the React Native set is written against it. Tracked in #1343.
 */
export const HEADER_BAR_TITLE_SOURCE_VECTORS: ReadonlyArray<HeaderBarTitleSourceVector> = [
    { sources: {}, title: '', rule: 'nothing to inherit from renders an empty label' },
    {
        sources: { navigationPageTitle: 'Inbox', dialogTitle: 'D', windowTitle: 'W', applicationName: 'A' },
        title: 'Inbox',
        rule: 'the navigation page wins over everything below it',
    },
    {
        sources: { dialogTitle: 'Preferences', windowTitle: 'W', applicationName: 'A' },
        title: 'Preferences',
        rule: 'the dialog is next when there is no navigation page',
    },
    {
        sources: { windowTitle: 'Files', applicationName: 'A', programName: 'p' },
        title: 'Files',
        rule: 'the root window is next — and only when the root IS a window',
    },
    {
        sources: { applicationName: 'Files', programName: 'org.gnome.Nautilus' },
        title: 'Files',
        rule: 'g_get_application_name before g_get_prgname',
    },
    { sources: { programName: 'nautilus' }, title: 'nautilus', rule: 'g_get_prgname is the last resort' },
    {
        sources: { windowTitle: '', applicationName: 'Files' },
        title: '',
        rule: 'an EMPTY window title is a pointer and ends the walk — it does not fall through',
    },
    {
        sources: { navigationPageTitle: '', dialogTitle: 'D', windowTitle: 'W', applicationName: 'A' },
        title: '',
        rule: 'AdwNavigationPage:title DEFAULTS to "" and refuses NULL — an untitled page blanks the bar',
    },
    {
        sources: { dialogTitle: '', windowTitle: 'W', applicationName: 'A' },
        title: '',
        rule: 'AdwDialog:title DEFAULTS to "" and normalises NULL to it — an untitled dialog blanks it too',
    },
    {
        sources: { navigationPageTitle: undefined, dialogTitle: undefined, windowTitle: undefined },
        title: '',
        rule: 'explicit `undefined` is the skipped branch, like an absent key — the shape `{ windowTitle: root?.title }` builds',
    },
    {
        sources: { bottomSheetShowsDragHandle: true, navigationPageTitle: 'Inbox', windowTitle: 'W' },
        title: '',
        rule: 'a bottom sheet showing its drag handle blanks the title outright, before the walk',
    },
    {
        sources: { bottomSheetShowsDragHandle: false, navigationPageTitle: 'Inbox' },
        title: 'Inbox',
        rule: 'a bottom sheet WITHOUT a drag handle does not blank anything',
    },
    {
        sources: { navigationPageTitle: null, dialogTitle: 'D' },
        title: 'D',
        rule: 'an explicit null is "no such ancestor" and falls through, unlike an empty string',
    },
];
