// Navigation-view conformance vectors — the spec both renderers are held to.
//
// This behaviour is a STATE MACHINE, so a vector is not one input and one output: it is a
// SCRIPT of mutations plus the state that must hold once the script has run. Every row
// cites the C function it was derived from.
//
// Pages are referred to by opaque {@link NavigationPageId} labels. A driver keeps
// its own `id → page handle` map and creates a handle the first time an id is
// mentioned (a `NavigationViewState` uses plain objects, `@gjsify/adwaita-web`
// creates an `<adw-navigation-page>`, `@gjsify/adwaita-nativescript` an NS `View`)
// — an id that a script only ever passes to `getPreviousPage` therefore stands for
// a page the view has never seen, which is itself part of the contract.
//
// Every field of {@link NavigationExpectation} is OPTIONAL and only the ones a row
// sets are asserted. `changes` is the core-level payload contract; a renderer suite
// checks the state fields plus the event sequence it can derive from `changes`
// (`reason` → `pushed`/`popped`/`replaced`, `popped` → one `popped` event per entry).
// `removeAfterTransition` is deliberately NOT observable in a renderer that does not
// animate: both current renderers settle the transition immediately, exactly as
// `adw_animation_skip` does in the C when `animate` is FALSE, so a script that wants
// to observe a page surviving until then carries an explicit `finishTransition` step
// and asserts the state after it.
//
// Four rows are the ones a hand-rolled stack machine gets wrong: `pop-ignores-can-pop`,
// `repeated-push-never-duplicates`, `replace-keeps-a-dynamic-page-in-the-new-stack` and
// `pop-to-tag-pops-atomically-past-a-can-pop-false-page`.
//
// Reference: refs/libadwaita/src/adw-navigation-view.c
// Reference: refs/libadwaita/src/adw-back-button.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    AdwNavigationPageProps,
    NavigationChangeReason,
    NavigationDiagnostic,
    NavigationShortcutResult,
} from '../navigation-view.js';

/** An opaque page label. A driver maps it to whatever page handle its renderer uses. */
export type NavigationPageId = string;

/** One mutation in a vector script. Mirrors the `NavigationViewState` surface 1:1. */
export type NavigationStep =
    | { op: 'add'; page: NavigationPageId; props?: AdwNavigationPageProps; expect?: boolean }
    | { op: 'remove'; page: NavigationPageId; expect?: boolean }
    | { op: 'push'; page: NavigationPageId; props?: AdwNavigationPageProps; expect?: boolean }
    | { op: 'pushByTag'; tag: string; expect?: boolean }
    | { op: 'pop'; expect?: boolean }
    | { op: 'popToPage'; page: NavigationPageId; expect?: boolean }
    | { op: 'popToTag'; tag: string; expect?: boolean }
    | {
          op: 'replace';
          pages: readonly (NavigationPageId | null)[];
          /** Registration properties for pages the view has not seen yet. */
          props?: Readonly<Record<NavigationPageId, AdwNavigationPageProps>>;
      }
    | { op: 'replaceWithTags'; tags: readonly string[] }
    | { op: 'setTag'; page: NavigationPageId; tag: string | null; expect?: boolean }
    | { op: 'setTitle'; page: NavigationPageId; title: string; expect?: boolean }
    | { op: 'setCanPop'; page: NavigationPageId; canPop: boolean; expect?: boolean }
    | { op: 'setAnimateTransitions'; value: boolean }
    | { op: 'setPopOnEscape'; value: boolean }
    | { op: 'popFromShortcut'; expect?: NavigationShortcutResult }
    | { op: 'popFromEscape'; expect?: NavigationShortcutResult }
    | { op: 'finishTransition'; expect?: readonly NavigationPageId[] };

/** One emitted `NavigationStackChange`, with page handles written as ids. */
export interface ExpectedNavigationChange {
    reason: NavigationChangeReason;
    stack: readonly NavigationPageId[];
    visiblePage: NavigationPageId | null;
    visiblePageTag: string | null;
    previousVisiblePage: NavigationPageId | null;
    popped: readonly NavigationPageId[];
    removed: readonly NavigationPageId[];
    removeAfterTransition: NavigationPageId | null;
    animate: boolean;
    pop: boolean;
    tagNotify: boolean;
}

/** Per-page state a row may pin down. */
export interface ExpectedPageState {
    page: NavigationPageId;
    /** Whether the view still knows the page at all. */
    registered?: boolean;
    tag?: string | null;
    title?: string;
    canPop?: boolean;
    /** Core-only: whether the page is DYNAMIC (destroyed when popped). */
    removeOnPop?: boolean;
}

/** What must hold once a script has run. Every field is optional. */
export interface NavigationExpectation {
    /** The navigation stack, bottom-first. */
    stack?: readonly NavigationPageId[];
    /** Every registered page, in registration order. */
    pages?: readonly NavigationPageId[];
    visiblePage?: NavigationPageId | null;
    visiblePageTag?: string | null;
    depth?: number;
    animateTransitions?: boolean;
    popOnEscape?: boolean;
    /** `AdwBackButton` visibility. */
    canGoBack?: boolean;
    /** `AdwBackButton`'s tooltip, `null` when there is no back button. */
    backButtonTooltip?: string | null;
    /** `find_page(tag)` results, as `[tag, page-or-null]` pairs (`''` is a legal tag). */
    findPage?: readonly (readonly [string, NavigationPageId | null])[];
    /** `get_previous_page(page)` results, as `[page, previous-or-null]` pairs. */
    previousPage?: readonly (readonly [NavigationPageId, NavigationPageId | null])[];
    pageState?: readonly ExpectedPageState[];
    /** Every diagnostic the script must have produced, in order. */
    diagnostics?: readonly NavigationDiagnostic[];
    /** Every change the script must have emitted, in order. */
    changes?: readonly ExpectedNavigationChange[];
}

/** One conformance row. */
export interface NavigationVector {
    /** Stable name — also the test title. */
    name: string;
    rule: string;
    steps: readonly NavigationStep[];
    expect: NavigationExpectation;
    derivedFrom: string;
}

/**
 * The navigation-view conformance table.
 *
 * Grouped by the C entry point each row exercises: registry (`add`/`remove`/
 * `find_page`), stack (`push`/`pop`/`pop_to_*`/`replace`), page properties
 * (`set_tag`/`set_title`/`set_can_pop`), the transition lifecycle, and the
 * `AdwBackButton` + shortcut derivations that live in `adw-back-button.c` and
 * `pop_shortcut_cb`.
 */
export const NAVIGATION_VIEW_VECTORS: ReadonlyArray<NavigationVector> = [
    // --- add / the auto-push (add_page:1263) ---
    {
        name: 'add-auto-pushes-into-an-empty-view',
        rule: 'the first added page becomes visible, without an animation',
        steps: [{ op: 'add', page: 'A', expect: true }],
        expect: {
            stack: ['A'],
            pages: ['A'],
            visiblePage: 'A',
            visiblePageTag: null,
            depth: 1,
            animateTransitions: true,
            popOnEscape: true,
            pageState: [{ page: 'A', tag: null, title: '', canPop: true, removeOnPop: false }],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'adw_navigation_view_add:2732 → add_page:1284-1285 (push_to_stack with a hardcoded animate=FALSE); page defaults adw_navigation_page_init:794-795; view defaults adw_navigation_view_init:2142-2143',
    },
    {
        name: 'add-does-not-push-onto-a-non-empty-stack',
        rule: 'only an EMPTY stack auto-pushes; a second add merely registers',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
        ],
        expect: {
            stack: ['A'],
            pages: ['A', 'B'],
            visiblePage: 'A',
            depth: 1,
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'add_page:1284-1287 — the else branch only hides the page',
    },
    {
        name: 'add-re-arms-the-auto-push-after-the-stack-is-emptied',
        rule: 'the auto-push condition is "the stack is empty", not "this is the first page ever"',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'replace', pages: [] },
            { op: 'add', page: 'B' },
        ],
        expect: { stack: ['B'], pages: ['A', 'B'], visiblePage: 'B', depth: 1 },
        derivedFrom: 'add_page:1284 (n_items == 0) + adw_navigation_view_replace:3048 g_list_store_remove_all',
    },
    {
        name: 'add-rejects-a-duplicate-tag-and-registers-nothing',
        rule: 'a colliding tag aborts the whole add — the second page is not retained',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'x' }, expect: true },
            { op: 'add', page: 'B', props: { tag: 'x' }, expect: false },
        ],
        expect: {
            stack: ['A'],
            pages: ['A'],
            findPage: [['x', 'A']],
            pageState: [{ page: 'B', registered: false }],
            diagnostics: [{ code: 'duplicate-tag', tag: 'x' }],
        },
        derivedFrom: 'add_page:1272-1277 — the g_critical returns before gtk_widget_set_parent',
    },
    {
        name: 'add-converts-a-pushed-page-into-a-permanent-one',
        rule: 'add() on a DYNAMIC page that is on the stack only clears remove-on-pop',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C' },
            { op: 'add', page: 'C', expect: true },
            { op: 'pop', expect: true },
            { op: 'finishTransition', expect: [] },
        ],
        expect: {
            stack: ['A'],
            pages: ['A', 'C'],
            pageState: [{ page: 'C', registered: true, removeOnPop: false }],
            diagnostics: [],
        },
        derivedFrom: 'adw_navigation_view_add:2725-2730 — the remove_on_pop + parent == self + in-stack shortcut',
    },

    {
        name: 'find-page-accepts-the-empty-string-as-a-tag',
        rule: "'' is a legal g_hash_table key; only a NULL tag is skipped",
        steps: [{ op: 'add', page: 'A', props: { tag: '' } }],
        expect: { findPage: [['', 'A']], visiblePageTag: '' },
        derivedFrom: 'add_page:1281-1282 (only `if (tag)` is skipped) + find_page:2780 g_hash_table_lookup',
    },
    {
        name: 'an-untagged-page-does-not-answer-the-empty-tag',
        rule: 'a NULL tag is never inserted into the tag table',
        steps: [{ op: 'add', page: 'A', props: { tag: null } }],
        expect: { findPage: [['', null]], visiblePageTag: null },
        derivedFrom: 'add_page:1281 — `if (tag) g_hash_table_insert (...)`',
    },
    {
        name: 'tags-are-byte-exact-and-not-unicode-normalised',
        rule: 'g_str_hash/g_str_equal compare bytes, so NFD and NFC are different tags',
        // Spelled with escapes on purpose: the two literals are indistinguishable
        // on screen, and that is exactly what the row is about.
        steps: [{ op: 'add', page: 'A', props: { tag: 'cafe\u0301' } }],
        expect: {
            findPage: [
                ['cafe\u0301', 'A'],
                ['caf\u00e9', null],
            ],
        },
        derivedFrom: 'adw_navigation_view_init:2147 (g_str_hash/g_str_equal) + find_page:2780',
    },

    {
        name: 'push-registers-an-unknown-page-as-dynamic',
        rule: 'a page push() has to register is destroyed again when it is popped',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C', expect: true },
        ],
        expect: {
            stack: ['A', 'C'],
            pages: ['A', 'C'],
            depth: 2,
            pageState: [
                { page: 'A', removeOnPop: false },
                { page: 'C', removeOnPop: true },
            ],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'C'],
                    visiblePage: 'C',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'adw_navigation_view_push:2806 → maybe_add_page:1307-1308 (set_remove_on_pop TRUE) → push_to_stack:2809',
    },
    {
        name: 'push-keeps-an-added-page-permanent',
        rule: 'maybe_add_page returns early for a known page, so it never gains remove-on-pop',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B', expect: true },
            { op: 'pop', expect: true },
            { op: 'finishTransition', expect: [] },
        ],
        expect: { stack: ['A'], pages: ['A', 'B'], pageState: [{ page: 'B', registered: true, removeOnPop: false }] },
        derivedFrom: 'maybe_add_page:1296-1297 — the early TRUE never reaches set_remove_on_pop at :1308',
    },
    {
        name: 'repeated-push-never-duplicates-a-page',
        rule: 'the already-in-stack guard: pushing a stacked page appends nothing and emits nothing',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B', props: { title: 'Detail' } },
            { op: 'push', page: 'B', expect: true },
            { op: 'push', page: 'B', expect: false },
        ],
        expect: {
            stack: ['A', 'B'],
            depth: 2,
            diagnostics: [{ code: 'already-in-stack', title: 'Detail' }],
        },
        derivedFrom: 'push_to_stack:942-952 — g_list_store_find returns before the append and before ::pushed at :958',
    },
    {
        name: 'push-rejects-the-visible-page',
        rule: 'pushing the page that is already visible is the same rejection',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'push', page: 'A', expect: false },
        ],
        expect: { stack: ['A'], diagnostics: [{ code: 'already-in-stack', title: 'Home' }] },
        derivedFrom: 'push_to_stack:942-952',
    },
    {
        name: 'push-by-an-unknown-tag-changes-nothing',
        rule: 'an unknown tag is rejected before any state moves',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'pushByTag', tag: 'nope', expect: false },
        ],
        expect: { stack: ['A'], depth: 1, diagnostics: [{ code: 'tag-not-found', tag: 'nope' }] },
        derivedFrom: 'adw_navigation_view_push_by_tag:2837-2843',
    },
    {
        name: 'push-by-tag-reports-an-already-stacked-page-by-its-tag',
        rule: 'push_to_stack picks the tag wording when it was reached through push_by_tag',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'pushByTag', tag: 'a', expect: false },
        ],
        expect: { stack: ['A'], diagnostics: [{ code: 'already-in-stack', tag: 'a' }] },
        derivedFrom: 'push_to_stack:943-949 (use_tag_for_errors) ← adw_navigation_view_push_by_tag:2845',
    },

    {
        name: 'pop-refuses-at-the-root-page',
        rule: 'the root page has no previous page, so there is nothing to pop to',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'pop', expect: false },
        ],
        expect: { stack: ['A'], depth: 1, diagnostics: [] },
        derivedFrom: 'adw_navigation_view_pop:2881-2884 → get_previous_page:3240-3241 (pos == 0 → NULL)',
    },
    {
        name: 'pop-on-an-empty-view-is-false',
        rule: 'no visible page, nothing to pop',
        steps: [{ op: 'pop', expect: false }],
        expect: { stack: [], visiblePage: null, depth: 0, changes: [] },
        derivedFrom: 'adw_navigation_view_pop:2876-2879',
    },
    {
        name: 'pop-ignores-can-pop',
        rule: 'can-pop gates SHORTCUTS and the back button, never a manual pop()',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'setCanPop', page: 'B', canPop: false, expect: true },
            { op: 'pop', expect: true },
        ],
        expect: { stack: ['A'], visiblePage: 'A', depth: 1 },
        derivedFrom: 'adw_navigation_view_pop:2869-2889 has no can_pop test; the rule is documented at :2559-2561',
    },
    {
        name: 'popping-a-dynamic-page-defers-its-destroy-to-the-transition',
        rule: 'the outgoing visible page is destroyed when the transition ends, not during the pop',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C' },
            { op: 'pop', expect: true },
            { op: 'finishTransition', expect: ['C'] },
        ],
        expect: {
            stack: ['A'],
            pages: ['A'],
            pageState: [{ page: 'C', registered: false }],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'C'],
                    visiblePage: 'C',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'pop',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: 'C',
                    popped: ['C'],
                    removed: [],
                    removeAfterTransition: 'C',
                    animate: true,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'pop_from_stack:1007 skips the outgoing page (`c != old_page`); transition_done_cb:1042-1043 removes it',
    },
    {
        name: 'finish-transition-is-idempotent',
        rule: 'settling an already-settled transition owes nothing',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C' },
            { op: 'pop' },
            { op: 'finishTransition', expect: ['C'] },
            { op: 'finishTransition', expect: [] },
        ],
        expect: { pages: ['A'] },
        derivedFrom: 'transition_done_cb:1032 — `if (self->hiding_page)`, and the pointer is stolen',
    },
    {
        name: 'a-page-pushed-back-before-the-transition-ends-survives',
        rule: 'the deferred destroy goes through remove(), whose on-the-stack check spares it',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C' },
            { op: 'pop' },
            { op: 'push', page: 'C', expect: true },
            { op: 'finishTransition', expect: [] },
        ],
        expect: {
            stack: ['A', 'C'],
            pages: ['A', 'C'],
            pageState: [{ page: 'C', registered: true, removeOnPop: true }],
        },
        derivedFrom: 'switch_page:867-868 → adw_navigation_view_remove:2757 → remove_page:1323-1326 (check_stack)',
    },
    {
        name: 'a-new-transition-settles-the-one-still-owed',
        rule: 'starting a transition on a different page flushes the pending destroy',
        steps: [{ op: 'add', page: 'A' }, { op: 'push', page: 'C' }, { op: 'pop' }, { op: 'push', page: 'E' }],
        expect: {
            stack: ['A', 'E'],
            pages: ['A', 'E'],
            pageState: [{ page: 'C', registered: false }],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'C'],
                    visiblePage: 'C',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'pop',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: 'C',
                    popped: ['C'],
                    removed: [],
                    removeAfterTransition: 'C',
                    animate: true,
                    pop: true,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'E'],
                    visiblePage: 'E',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: ['C'],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'switch_page:860-873 — the pending hiding_page is resolved when a new transition begins',
    },

    {
        name: 'pop-to-page-pops-every-page-above-it-in-one-step',
        rule: 'ONE splice, ONE visible-page change, popped reported TOP-FIRST',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'B' },
            { op: 'push', page: 'C' },
            { op: 'push', page: 'D' },
            { op: 'popToPage', page: 'B', expect: true },
            { op: 'finishTransition', expect: ['D'] },
        ],
        expect: {
            stack: ['A', 'B'],
            pages: ['A', 'B'],
            visiblePage: 'B',
            depth: 2,
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B', 'C'],
                    visiblePage: 'C',
                    visiblePageTag: null,
                    previousVisiblePage: 'B',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B', 'C', 'D'],
                    visiblePage: 'D',
                    visiblePageTag: null,
                    previousVisiblePage: 'C',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'pop',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'D',
                    popped: ['D', 'C'],
                    removed: ['C'],
                    removeAfterTransition: 'D',
                    animate: true,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'pop_from_stack:989-1009 — prepend while walking up, one g_list_store_splice, one switch_page, then ::popped per page',
    },
    {
        name: 'pop-to-tag-pops-atomically-past-a-can-pop-false-page',
        rule: 'a programmatic pop-to is not stopped by an intermediate can-pop=false page',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'add', page: 'B', props: { tag: 'b' } },
            { op: 'add', page: 'C' },
            { op: 'push', page: 'B' },
            { op: 'push', page: 'C' },
            { op: 'setCanPop', page: 'B', canPop: false },
            { op: 'popToTag', tag: 'a', expect: true },
        ],
        expect: {
            stack: ['A'],
            visiblePage: 'A',
            visiblePageTag: 'a',
            depth: 1,
            pages: ['A', 'B', 'C'],
            diagnostics: [],
        },
        derivedFrom:
            'adw_navigation_view_pop_to_tag:2974 → pop_to_page:2932 → pop_from_stack:996; can_pop appears nowhere on this path',
    },
    {
        name: 'pop-to-the-visible-page-is-a-silent-no-op',
        rule: 'no diagnostic, no change — it is simply FALSE',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'popToPage', page: 'B', expect: false },
        ],
        expect: { stack: ['A', 'B'], diagnostics: [] },
        derivedFrom: 'adw_navigation_view_pop_to_page:2923-2924',
    },
    {
        name: 'pop-to-an-off-stack-page-reports-not-in-stack',
        rule: 'registered but not stacked is a DIFFERENT rejection from an unknown tag',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'X', props: { title: 'Extra' } },
            { op: 'push', page: 'B' },
            { op: 'popToPage', page: 'X', expect: false },
        ],
        expect: { stack: ['A', 'B'], diagnostics: [{ code: 'not-in-stack', title: 'Extra' }] },
        derivedFrom: 'adw_navigation_view_pop_to_page:2926-2930',
    },
    {
        name: 'pop-to-an-unknown-tag-reports-tag-not-found',
        rule: 'pop_to_tag resolves first, so an unknown tag never reaches pop_to_page',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'push', page: 'B' },
            { op: 'popToTag', tag: 'nope', expect: false },
        ],
        expect: { stack: ['A', 'B'], diagnostics: [{ code: 'tag-not-found', tag: 'nope' }] },
        derivedFrom: 'adw_navigation_view_pop_to_tag:2966-2972',
    },

    {
        name: 'replace-with-an-empty-array-empties-the-view',
        rule: 'n_pages == 0 leaves no visible page; the added pages stay registered',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'replace', pages: [] },
        ],
        expect: {
            stack: [],
            pages: ['A', 'B'],
            visiblePage: null,
            visiblePageTag: null,
            depth: 0,
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'replace',
                    stack: [],
                    visiblePage: null,
                    visiblePageTag: null,
                    previousVisiblePage: 'B',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'adw_navigation_view_replace:3048 + :3076-3077 switch_page(visible, NULL, TRUE, FALSE, 0); doc at :2992-2993',
    },
    {
        name: 'replace-rejects-a-page-listed-twice',
        rule: 'the second occurrence is dropped, not the whole call',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'add', page: 'B' },
            { op: 'replace', pages: ['A', 'B', 'A'] },
        ],
        expect: { stack: ['A', 'B'], diagnostics: [{ code: 'already-in-stack', title: 'Home' }] },
        derivedFrom: 'adw_navigation_view_replace:3055-3059',
    },
    {
        name: 'replace-skips-null-slots-silently',
        rule: 'a NULL entry is not an error — replace_with_tags relies on it',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'replace', pages: ['A', null, 'B'] },
        ],
        expect: { stack: ['A', 'B'], diagnostics: [] },
        derivedFrom: 'adw_navigation_view_replace:3021-3022 and :3052-3053',
    },
    {
        name: 'replace-with-tags-skips-an-unknown-tag-without-aborting',
        rule: 'every tag is resolved BEFORE any mutation; an unknown one becomes a null slot',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'add', page: 'B', props: { tag: 'b' } },
            { op: 'replaceWithTags', tags: ['a', 'nope', 'b'] },
        ],
        expect: {
            stack: ['A', 'B'],
            visiblePageTag: 'b',
            diagnostics: [{ code: 'tag-not-found', tag: 'nope' }],
        },
        derivedFrom: 'adw_navigation_view_replace_with_tags:3136-3147',
    },
    {
        name: 'replace-keeps-a-dynamic-page-in-the-new-stack',
        rule: 'the destroy loop spares pages the new stack keeps — replacing by the tag of a pushed page must not blank the view',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C', props: { tag: 'c' } },
            { op: 'replaceWithTags', tags: ['c'] },
        ],
        expect: {
            stack: ['C'],
            pages: ['A', 'C'],
            visiblePage: 'C',
            visiblePageTag: 'c',
            depth: 1,
            diagnostics: [],
        },
        derivedFrom:
            'adw_navigation_view_replace:3033-3034 — `get_remove_on_pop (c) && !g_hash_table_contains (added_pages, c)`',
    },
    {
        name: 'replace-destroys-the-dynamic-pages-the-new-stack-drops',
        rule: 'destroyed top-first and IMMEDIATELY — replace does not animate, so nothing is deferred',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'push', page: 'C' },
            { op: 'push', page: 'D' },
            { op: 'replace', pages: ['A'] },
        ],
        expect: {
            stack: ['A'],
            pages: ['A'],
            visiblePage: 'A',
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'C'],
                    visiblePage: 'C',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'C', 'D'],
                    visiblePage: 'D',
                    visiblePageTag: null,
                    previousVisiblePage: 'C',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'replace',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: 'D',
                    popped: [],
                    removed: ['D', 'C'],
                    removeAfterTransition: null,
                    animate: false,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom:
            'adw_navigation_view_replace:3027-3046 (remove_page(self, c, FALSE)); SIGNAL_POPPED appears nowhere in replace',
    },
    {
        name: 'replace-registers-a-fresh-page-as-dynamic',
        rule: 'replace routes new pages through maybe_add_page, so they are destroyed when dropped',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'replace', pages: ['A', 'Z'], props: { Z: { tag: 'z' } } },
        ],
        expect: {
            stack: ['A', 'Z'],
            pages: ['A', 'Z'],
            visiblePageTag: 'z',
            pageState: [{ page: 'Z', removeOnPop: true }],
        },
        derivedFrom: 'adw_navigation_view_replace:3061-3065 → maybe_add_page:1307-1308',
    },
    {
        name: 'replace-never-animates',
        rule: 'replacing the stack has no animation, whatever animate-transitions says',
        steps: [
            { op: 'setAnimateTransitions', value: true },
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'replace', pages: ['A', 'B'] },
        ],
        expect: {
            stack: ['A', 'B'],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'replace',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'adw_navigation_view_replace:3075 switch_page(..., animate = FALSE, 0); doc at :2987',
    },
    {
        name: 'replace-that-keeps-the-visible-page-does-not-notify',
        rule: 'no switch_page when the top of the new stack is the page already shown',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'replace', pages: ['B', 'A'] },
        ],
        expect: {
            stack: ['B', 'A'],
            visiblePage: 'A',
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'replace',
                    stack: ['B', 'A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'adw_navigation_view_replace:3074 — `if (visible_page != new_visible_page)` guards the switch',
    },

    // --- animation gating (switch_page:857-858) ---
    {
        name: 'push-animates-by-default',
        rule: 'push forwards animate-transitions into push_to_stack',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
        ],
        expect: {
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'adw_navigation_view_push:2809 forwards self->animate_transitions',
    },
    {
        name: 'animate-transitions-false-suppresses-the-push-animation',
        rule: 'the property is read at push time, not at construction',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'setAnimateTransitions', value: false },
            { op: 'push', page: 'B' },
        ],
        expect: {
            animateTransitions: false,
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'adw_navigation_view_push:2809 + adw_navigation_view_set_animate_transitions:3383',
    },
    {
        name: 'a-push-into-an-empty-view-never-animates',
        rule: 'with no outgoing page there is nothing to slide away from',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'replace', pages: [] },
            { op: 'push', page: 'B' },
        ],
        expect: {
            stack: ['B'],
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'replace',
                    stack: [],
                    visiblePage: null,
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: true,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'switch_page:857-858 — `if (!prev_page) animate = FALSE;`',
    },

    {
        name: 'remove-off-the-stack-is-immediate-and-frees-the-tag',
        rule: 'an unstacked page is unregistered at once and stops answering find_page',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B', props: { tag: 'b' } },
            { op: 'remove', page: 'B', expect: true },
        ],
        expect: { pages: ['A'], findPage: [['b', null]], pageState: [{ page: 'B', registered: false }] },
        derivedFrom: 'remove_page:1328-1333 — the tag is dropped, then gtk_widget_unparent',
    },
    {
        name: 'remove-while-stacked-is-deferred-to-the-pop',
        rule: 'the page stays until it is popped, then it is destroyed',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'remove', page: 'B', expect: true },
            { op: 'pop', expect: true },
            { op: 'finishTransition', expect: ['B'] },
        ],
        expect: { stack: ['A'], pages: ['A'], pageState: [{ page: 'B', registered: false }] },
        derivedFrom: 'remove_page:1323-1326 (set_remove_on_pop, return) → transition_done_cb:1042',
    },
    {
        name: 'remove-of-an-unknown-page-is-false',
        rule: 'the C guards on the page being parented to this view',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'remove', page: 'Z', expect: false },
        ],
        expect: { pages: ['A'], diagnostics: [] },
        derivedFrom: 'adw_navigation_view_remove:2755 g_return_if_fail (parent == self)',
    },

    {
        name: 'set-tag-rejects-a-tag-another-page-owns',
        rule: 'the reject happens BEFORE the old tag is dropped, so the page keeps it',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'x' } },
            { op: 'add', page: 'B', props: { tag: 'y' } },
            { op: 'setTag', page: 'B', tag: 'x', expect: false },
        ],
        expect: {
            findPage: [
                ['x', 'A'],
                ['y', 'B'],
            ],
            pageState: [{ page: 'B', tag: 'y' }],
            diagnostics: [{ code: 'duplicate-tag', tag: 'x' }],
        },
        derivedFrom: 'adw_navigation_page_set_tag:2456-2460, before the g_hash_table_remove at :2462',
    },
    {
        name: 'set-tag-to-the-same-value-is-a-silent-no-op',
        rule: 'g_strcmp0 short-circuits before any check or notification',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'x' } },
            { op: 'setTag', page: 'A', tag: 'x', expect: false },
        ],
        expect: { findPage: [['x', 'A']], diagnostics: [] },
        derivedFrom: 'adw_navigation_page_set_tag:2448-2449',
    },
    {
        name: 'clearing-a-tag-drops-it-from-the-index',
        rule: 'the old key is removed and a NULL tag is not inserted',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'x' } },
            { op: 'setTag', page: 'A', tag: null, expect: true },
        ],
        expect: { findPage: [['x', null]], visiblePageTag: null, pageState: [{ page: 'A', tag: null }] },
        derivedFrom: 'adw_navigation_page_set_tag:2462-2468',
    },
    {
        name: 'retagging-frees-the-old-tag-for-another-page',
        rule: 'the index follows the rename, so the vacated tag becomes available',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'x' } },
            { op: 'setTag', page: 'A', tag: 'z', expect: true },
            { op: 'add', page: 'B', props: { tag: 'x' }, expect: true },
        ],
        expect: {
            findPage: [
                ['x', 'B'],
                ['z', 'A'],
            ],
            diagnostics: [],
        },
        derivedFrom: 'adw_navigation_page_set_tag:2462-2468',
    },
    {
        name: 'set-title-is-idempotent',
        rule: 'g_set_str returns FALSE for an unchanged title, so nothing notifies',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'setTitle', page: 'A', title: 'Home', expect: false },
            { op: 'setTitle', page: 'A', title: 'Start', expect: true },
        ],
        expect: { pageState: [{ page: 'A', title: 'Start' }] },
        derivedFrom: 'adw_navigation_page_set_title:2518-2519',
    },
    {
        name: 'set-can-pop-is-idempotent',
        rule: 'the value is coerced to a boolean and an unchanged one is dropped',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'setCanPop', page: 'A', canPop: true, expect: false },
            { op: 'setCanPop', page: 'A', canPop: false, expect: true },
        ],
        expect: { pageState: [{ page: 'A', canPop: false }] },
        derivedFrom: 'adw_navigation_page_set_can_pop:2578-2581',
    },

    // --- visible-page-tag notification (switch_page:927-930) ---
    {
        name: 'tag-notify-is-suppressed-when-neither-page-carries-a-tag',
        rule: 'visible-page-tag must not re-notify between two untagged pages',
        steps: [
            { op: 'add', page: 'A', props: { tag: null } },
            { op: 'push', page: 'B', props: { tag: null } },
            { op: 'pop' },
        ],
        expect: {
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: false,
                },
                {
                    reason: 'pop',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: null,
                    previousVisiblePage: 'B',
                    popped: ['B'],
                    removed: [],
                    removeAfterTransition: 'B',
                    animate: true,
                    pop: true,
                    tagNotify: false,
                },
            ],
        },
        derivedFrom: 'switch_page:927-930',
    },
    {
        name: 'tag-notify-fires-when-either-side-carries-a-tag',
        rule: 'the INCOMING page having a tag is enough, even with an untagged outgoing one',
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'push', page: 'B', props: { tag: null } },
            { op: 'pop' },
        ],
        expect: {
            visiblePageTag: 'a',
            changes: [
                {
                    reason: 'add',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: 'a',
                    previousVisiblePage: null,
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: false,
                    pop: false,
                    tagNotify: true,
                },
                {
                    reason: 'push',
                    stack: ['A', 'B'],
                    visiblePage: 'B',
                    visiblePageTag: null,
                    previousVisiblePage: 'A',
                    popped: [],
                    removed: [],
                    removeAfterTransition: null,
                    animate: true,
                    pop: false,
                    tagNotify: true,
                },
                {
                    reason: 'pop',
                    stack: ['A'],
                    visiblePage: 'A',
                    visiblePageTag: 'a',
                    previousVisiblePage: 'B',
                    popped: ['B'],
                    removed: [],
                    removeAfterTransition: 'B',
                    animate: true,
                    pop: true,
                    tagNotify: true,
                },
            ],
        },
        derivedFrom: 'switch_page:927-930 — either side is enough',
    },
    {
        name: 'visible-page-tag-is-null-for-an-untagged-visible-page',
        rule: "null, not '' and not the title",
        steps: [
            { op: 'add', page: 'A', props: { tag: 'a' } },
            { op: 'push', page: 'B', props: { title: 'Detail' } },
        ],
        expect: { visiblePageTag: null, visiblePage: 'B' },
        derivedFrom: 'adw_navigation_view_get_visible_page_tag:3203-3208',
    },

    {
        name: 'previous-page-is-null-at-the-root-and-off-the-stack',
        rule: 'not-found and pos == 0 are both NULL',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'add', page: 'X' },
            { op: 'push', page: 'B' },
        ],
        expect: {
            previousPage: [
                ['B', 'A'],
                ['A', null],
                ['X', null],
                ['Z', null],
            ],
        },
        derivedFrom: 'adw_navigation_view_get_previous_page:3237-3243',
    },

    // --- AdwBackButton (adw-back-button.c) ---
    {
        name: 'no-back-button-on-the-root-page',
        rule: 'no previous page means no button and no tooltip',
        steps: [{ op: 'add', page: 'A', props: { title: 'Home' } }],
        expect: { canGoBack: false, backButtonTooltip: null },
        derivedFrom: 'adw-back-button.c update_page:92-108 + query_tooltip:406-407',
    },
    {
        name: 'the-back-button-tooltip-is-the-previous-page-title',
        rule: 'the title of the page the button would REVEAL, not the visible one',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'push', page: 'B', props: { title: 'Detail' } },
        ],
        expect: { canGoBack: true, backButtonTooltip: 'Home' },
        derivedFrom: 'adw-back-button.c update_page:92 + query_tooltip:411-417',
    },
    {
        name: 'the-back-button-tooltip-falls-back-when-the-previous-title-is-empty',
        rule: '"Back" is a FALLBACK, not the default',
        steps: [
            { op: 'add', page: 'A', props: { title: '' } },
            { op: 'push', page: 'B' },
        ],
        expect: { canGoBack: true, backButtonTooltip: 'Back' },
        derivedFrom: 'adw-back-button.c:417 — `(title && *title) ? title : _("Back")`',
    },
    {
        name: 'can-pop-false-hides-the-back-button',
        rule: 'this is what can-pop is actually for',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'setCanPop', page: 'B', canPop: false },
        ],
        expect: { canGoBack: false, backButtonTooltip: null },
        derivedFrom: 'adw-back-button.c update_page:94-97 — !can_pop forces prev_page NULL',
    },
    {
        name: 'the-back-button-re-appears-when-can-pop-is-turned-back-on',
        rule: 'the derivation is live, not a snapshot taken at the last stack mutation',
        steps: [
            { op: 'add', page: 'A', props: { title: 'Home' } },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'setCanPop', page: 'B', canPop: false },
            { op: 'setCanPop', page: 'B', canPop: true },
        ],
        expect: { canGoBack: true, backButtonTooltip: 'Home' },
        derivedFrom: 'adw-back-button.c:446-450 connects update_page to the page notify::can-pop',
    },

    // --- shortcuts (pop_shortcut_cb:1142, escape_shortcut_cb:1175) ---
    {
        name: 'the-shortcut-pop-stops-without-popping-when-can-pop-is-false',
        rule: 'GDK_EVENT_STOP so the key is NOT forwarded to an enclosing navigation view',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'setCanPop', page: 'B', canPop: false },
            { op: 'popFromShortcut', expect: 'stop' },
        ],
        expect: { stack: ['A', 'B'], depth: 2 },
        derivedFrom: 'pop_shortcut_cb:1150-1152',
    },
    {
        name: 'the-shortcut-pop-stops-at-the-root-when-can-pop-is-false',
        rule: 'can_pop is checked BEFORE the pop attempt, so even the root case stops',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'setCanPop', page: 'A', canPop: false },
            { op: 'popFromShortcut', expect: 'stop' },
        ],
        expect: { stack: ['A'] },
        derivedFrom: 'pop_shortcut_cb:1145-1157',
    },
    {
        name: 'the-shortcut-pop-propagates-at-the-root',
        rule: 'a poppable root that cannot pop lets the key reach an enclosing view',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'popFromShortcut', expect: 'propagate' },
        ],
        expect: { stack: ['A'] },
        derivedFrom: 'pop_shortcut_cb:1154-1157',
    },
    {
        name: 'the-shortcut-pop-propagates-on-an-empty-view',
        rule: 'no visible page — the view has nothing to say about the key',
        steps: [{ op: 'popFromShortcut', expect: 'propagate' }],
        expect: { stack: [] },
        derivedFrom: 'pop_shortcut_cb:1147-1148',
    },
    {
        name: 'escape-pops-by-default',
        rule: 'pop-on-escape defaults to TRUE',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'popFromEscape', expect: 'stop' },
        ],
        expect: { stack: ['A'], popOnEscape: true },
        derivedFrom: 'escape_shortcut_cb:1178-1179 + init:2143',
    },
    {
        name: 'escape-propagates-when-pop-on-escape-is-off',
        rule: 'the gate is on the VIEW, not on the page',
        steps: [
            { op: 'add', page: 'A' },
            { op: 'add', page: 'B' },
            { op: 'push', page: 'B' },
            { op: 'setPopOnEscape', value: false },
            { op: 'popFromEscape', expect: 'propagate' },
        ],
        expect: { stack: ['A', 'B'], popOnEscape: false },
        derivedFrom: 'escape_shortcut_cb:1178-1181',
    },
];

//
// Three suites (core, web, NativeScript) run the SAME scripts against three very
// different widgets. Written out three times, the script interpreter is exactly
// the "duplication instead of a helper" shape that lets one copy drift and pass a
// vector the other two fail. So it lives here, once, over a small per-renderer
// adapter — the table and the way it is executed stay one artefact.

/** Everything a suite must be able to do to its widget to run a vector. */
export interface NavigationVectorAdapter<P> {
    /** The handle for `id`, created on first mention and stable afterwards. */
    page(id: NavigationPageId): P;
    /** The id of a handle — `null` for `null`/`undefined`. */
    idOf(page: P | null | undefined): NavigationPageId | null;
    /**
     * Whether this target actually DEFERS the destroy of the outgoing page to
     * {@link finishTransition}. Only the core does; both renderers settle at once
     * (their transition is CSS, or nothing at all), so their `finishTransition`
     * has nothing left to hand back. The step still RUNS everywhere — it is what
     * makes the final state comparable — but its return value is asserted only
     * where deferral is real.
     */
    defersTransition: boolean;

    add(page: P, props?: AdwNavigationPageProps): boolean;
    remove(page: P): boolean;
    push(page: P, props?: AdwNavigationPageProps): boolean;
    pushByTag(tag: string): boolean;
    pop(): boolean;
    popToPage(page: P): boolean;
    popToTag(tag: string): boolean;
    replace(pages: readonly (P | null)[], props?: (page: P) => AdwNavigationPageProps | undefined): void;
    replaceWithTags(tags: readonly string[]): void;
    setTag(page: P, tag: string | null): boolean;
    setTitle(page: P, title: string): boolean;
    setCanPop(page: P, canPop: boolean): boolean;
    setAnimateTransitions(value: boolean): void;
    setPopOnEscape(value: boolean): void;
    popFromShortcut(): NavigationShortcutResult;
    popFromEscape(): NavigationShortcutResult;
    finishTransition(): readonly P[];

    stack(): readonly P[];
    pages(): readonly P[];
    visiblePage(): P | null;
    visiblePageTag(): string | null;
    depth(): number;
    animateTransitions(): boolean;
    popOnEscape(): boolean;
    canGoBack(): boolean;
    backButtonTooltip(): string | null;
    findPage(tag: string): P | null;
    getPreviousPage(page: P): P | null;
    /**
     * Per-page state. A renderer omits the fields it cannot report — `removeOnPop`
     * is core-only, and the rows that pin it down are therefore checked by the core
     * suite alone. Its renderer-visible consequence (the page disappearing from
     * {@link pages}) is asserted everywhere.
     */
    pageState(page: P): Partial<Omit<ExpectedPageState, 'page'>>;
}

/** What one executed step produced, ready to be compared. */
export interface NavigationStepOutcome {
    /** Position in the script, for a readable failure. */
    index: number;
    step: NavigationStep;
    /** The mutator's return value, with page handles reduced to ids. */
    result: unknown;
    /** What the row demands, or `undefined` when it does not care. */
    expected: unknown;
}

/** Run a vector's script against `adapter`, returning one outcome per step. */
export function runNavigationSteps<P>(
    steps: readonly NavigationStep[],
    adapter: NavigationVectorAdapter<P>,
): NavigationStepOutcome[] {
    const outcomes: NavigationStepOutcome[] = [];
    for (const [index, step] of steps.entries()) {
        let result: unknown;
        let expected: unknown = 'expect' in step ? step.expect : undefined;
        switch (step.op) {
            case 'add':
                result = adapter.add(adapter.page(step.page), step.props);
                break;
            case 'remove':
                result = adapter.remove(adapter.page(step.page));
                break;
            case 'push':
                result = adapter.push(adapter.page(step.page), step.props);
                break;
            case 'pushByTag':
                result = adapter.pushByTag(step.tag);
                break;
            case 'pop':
                result = adapter.pop();
                break;
            case 'popToPage':
                result = adapter.popToPage(adapter.page(step.page));
                break;
            case 'popToTag':
                result = adapter.popToTag(step.tag);
                break;
            case 'replace': {
                const props = step.props;
                adapter.replace(
                    step.pages.map((id) => (id === null ? null : adapter.page(id))),
                    props === undefined
                        ? undefined
                        : (page) => {
                              const id = adapter.idOf(page);
                              return id === null ? undefined : props[id];
                          },
                );
                break;
            }
            case 'replaceWithTags':
                adapter.replaceWithTags(step.tags);
                break;
            case 'setTag':
                result = adapter.setTag(adapter.page(step.page), step.tag);
                break;
            case 'setTitle':
                result = adapter.setTitle(adapter.page(step.page), step.title);
                break;
            case 'setCanPop':
                result = adapter.setCanPop(adapter.page(step.page), step.canPop);
                break;
            case 'setAnimateTransitions':
                adapter.setAnimateTransitions(step.value);
                break;
            case 'setPopOnEscape':
                adapter.setPopOnEscape(step.value);
                break;
            case 'popFromShortcut':
                result = adapter.popFromShortcut();
                break;
            case 'popFromEscape':
                result = adapter.popFromEscape();
                break;
            case 'finishTransition':
                result = adapter.finishTransition().map((page) => adapter.idOf(page));
                if (!adapter.defersTransition) expected = undefined;
                break;
        }
        outcomes.push({ index, step, result, expected });
    }
    return outcomes;
}

/** One state comparison a row asked for. */
export interface NavigationStateCheck {
    /** What is being compared, for the failure message. */
    label: string;
    actual: unknown;
    expected: unknown;
}

/**
 * Reduce a row's {@link NavigationExpectation} to the comparisons `adapter` can
 * actually make, so every suite asserts the same fields in the same way.
 */
export function collectNavigationState<P>(
    expect: NavigationExpectation,
    adapter: NavigationVectorAdapter<P>,
): NavigationStateCheck[] {
    const ids = (pages: readonly (P | null)[]): (NavigationPageId | null)[] => pages.map((page) => adapter.idOf(page));
    const checks: NavigationStateCheck[] = [];
    const add = (label: string, actual: unknown, expected: unknown): void => {
        checks.push({ label, actual, expected });
    };

    if (expect.stack !== undefined) add('stack', ids(adapter.stack()), [...expect.stack]);
    if (expect.pages !== undefined) add('pages', ids(adapter.pages()), [...expect.pages]);
    if (expect.visiblePage !== undefined) add('visiblePage', adapter.idOf(adapter.visiblePage()), expect.visiblePage);
    if (expect.visiblePageTag !== undefined) add('visiblePageTag', adapter.visiblePageTag(), expect.visiblePageTag);
    if (expect.depth !== undefined) add('depth', adapter.depth(), expect.depth);
    if (expect.animateTransitions !== undefined) {
        add('animateTransitions', adapter.animateTransitions(), expect.animateTransitions);
    }
    if (expect.popOnEscape !== undefined) add('popOnEscape', adapter.popOnEscape(), expect.popOnEscape);
    if (expect.canGoBack !== undefined) add('canGoBack', adapter.canGoBack(), expect.canGoBack);
    if (expect.backButtonTooltip !== undefined) {
        add('backButtonTooltip', adapter.backButtonTooltip(), expect.backButtonTooltip);
    }
    for (const [tag, expected] of expect.findPage ?? []) {
        add(`findPage(${JSON.stringify(tag)})`, adapter.idOf(adapter.findPage(tag)), expected);
    }
    for (const [id, expected] of expect.previousPage ?? []) {
        add(`getPreviousPage(${id})`, adapter.idOf(adapter.getPreviousPage(adapter.page(id))), expected);
    }
    for (const state of expect.pageState ?? []) {
        const actual = adapter.pageState(adapter.page(state.page));
        for (const key of ['registered', 'tag', 'title', 'canPop', 'removeOnPop'] as const) {
            // A field the row does not pin down, or one this renderer cannot report,
            // is not a comparison — see NavigationVectorAdapter.pageState.
            if (state[key] === undefined || actual[key] === undefined) continue;
            add(`${state.page}.${key}`, actual[key], state[key]);
        }
    }
    return checks;
}

/** A GObject-style signal a renderer re-emits, reduced to what a suite can observe. */
export interface NavigationEventRecord {
    /** The `AdwNavigationView` signal name, or the `visible-page` property notification. */
    type: 'pushed' | 'popped' | 'replaced' | 'notify::visible-page';
    /** The page the signal is about — `null` for `replaced` and for an emptied view. */
    page: NavigationPageId | null;
}

/**
 * The signal sequence a row's {@link NavigationExpectation.changes} must produce,
 * so the renderer suites can assert their event log without re-deriving the
 * mapping: `'add'`/`'push'` → `::pushed`, `'pop'` → one `::popped` per popped page
 * (top-first), `'replace'` → `::replaced`, and `visible-page` notifies exactly when
 * the visible page actually changed (switch_page:925).
 */
export function navigationEventLog(changes: readonly ExpectedNavigationChange[]): NavigationEventRecord[] {
    const log: NavigationEventRecord[] = [];
    for (const change of changes) {
        if (change.reason === 'add' || change.reason === 'push') {
            log.push({ type: 'pushed', page: change.visiblePage });
        } else if (change.reason === 'pop') {
            for (const page of change.popped) log.push({ type: 'popped', page });
        } else {
            log.push({ type: 'replaced', page: null });
        }
        if (change.previousVisiblePage !== change.visiblePage) {
            log.push({ type: 'notify::visible-page', page: change.visiblePage });
        }
    }
    return log;
}
