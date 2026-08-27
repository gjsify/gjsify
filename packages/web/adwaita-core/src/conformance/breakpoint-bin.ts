// Breakpoint-bin conformance vectors — the spec every renderer is held to.
//
// The three rules here are the ones a port gets wrong by guessing: which breakpoint
// wins when two match, what happens to a property both of them set, and what the
// restore restores to.
//
// Reference: refs/libadwaita/src/adw-breakpoint-bin.c
// Reference: refs/libadwaita/src/adw-breakpoint.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One pick expectation: which breakpoint a size selects. */
export interface BreakpointPickVector {
    /** Conditions, in the order they are added. */
    conditions: readonly string[];
    /** The size to evaluate against. */
    size: { width: number; height: number };
    /** Index of the expected pick, or null for none. */
    pick: number | null;
    rule: string;
}

/**
 * `adw_breakpoint_bin_size_allocate` iterates backwards and takes the first match:
 * "Iterate in reverse order since we prioritize breakpoints added last" (:432).
 *
 * CORE-ONLY: GAP — no renderer drives this table yet. The NativeScript bin binds
 * breakpoints to a view's post-layout size and runs its own callbacks; moving it onto
 * `BreakpointBinState` is a diff with its own spec surface, and the rule lands first so
 * the React Native set is written against it. Tracked in #1343.
 */
export const BREAKPOINT_PICK_VECTORS: ReadonlyArray<BreakpointPickVector> = [
    { conditions: [], size: { width: 800, height: 600 }, pick: null, rule: 'no breakpoints, no pick' },
    {
        conditions: ['max-width: 720sp'],
        size: { width: 500, height: 600 },
        pick: 0,
        rule: 'one breakpoint, condition holds',
    },
    {
        conditions: ['max-width: 720sp'],
        size: { width: 900, height: 600 },
        pick: null,
        rule: 'one breakpoint, condition does not hold',
    },
    {
        conditions: ['max-width: 720sp', 'max-width: 400sp'],
        size: { width: 300, height: 600 },
        pick: 1,
        rule: 'both match: the one added LAST wins, which here is also the narrower',
    },
    {
        conditions: ['max-width: 400sp', 'max-width: 720sp'],
        size: { width: 300, height: 600 },
        pick: 1,
        rule: 'both match, added the other way round: the LAST still wins, and it is the WIDER one',
    },
    {
        conditions: ['max-width: 400sp', 'max-width: 720sp'],
        size: { width: 500, height: 600 },
        pick: 1,
        rule: 'only the second matches',
    },
    {
        conditions: ['max-width: 720sp', 'max-height: 400sp'],
        size: { width: 500, height: 300 },
        pick: 1,
        rule: 'the two axes are independent conditions, and the later one still wins',
    },
    {
        conditions: ['max-width: 720sp and max-height: 400sp'],
        size: { width: 500, height: 600 },
        pick: null,
        rule: 'an `and` needs both halves',
    },
    {
        conditions: ['max-width: 400sp', 'not-a-condition'],
        size: { width: 300, height: 600 },
        pick: 0,
        rule: 'an unparseable condition never matches (adw_breakpoint_check_condition returns FALSE for a null one, adw-breakpoint.c:1831), so the earlier valid one is picked',
    },
];

/**
 * One transition expectation, written as object and property NAMES rather than real widgets.
 *
 * The object is spelled out on every setter rather than left implicit, because rule 2's skip
 * keys on object AND property (`setter_equal`, adw-breakpoint.c:1060): a table with one
 * object in it cannot tell a correct implementation from one that drops the object half.
 * Measured — with every setter on a single object, blinding the skip to the object left the
 * whole suite green.
 */
export interface BreakpointTransitionVector {
    /** Each breakpoint as `[condition, [[object, property, value] …]]`; originals are `orig:<object>.<property>`. */
    breakpoints: readonly [string, readonly (readonly [string, string, string])[]][];
    /** Sizes to evaluate in order. */
    sizes: readonly { width: number; height: number }[];
    /** Expected writes per evaluation, `object.property=value`; `null` is "no transition". */
    writes: readonly (readonly string[] | null)[];
    rule: string;
}

/**
 * `adw_breakpoint_transition` (adw-breakpoint.c:1781): restore the outgoing setters to
 * their originals, skipping any the incoming breakpoint also sets, then write the
 * incoming values.
 *
 * CORE-ONLY: GAP — no renderer drives this table yet. The NativeScript bin binds
 * breakpoints to a view's post-layout size and runs its own callbacks; moving it onto
 * `BreakpointBinState` is a diff with its own spec surface, and the rule lands first so
 * the React Native set is written against it. Tracked in #1343.
 */
export const BREAKPOINT_TRANSITION_VECTORS: ReadonlyArray<BreakpointTransitionVector> = [
    {
        breakpoints: [['max-width: 720sp', [['view', 'collapsed', 'true']]]],
        sizes: [{ width: 500, height: 600 }],
        writes: [['view.collapsed=true']],
        rule: 'entering a breakpoint writes its setters',
    },
    {
        breakpoints: [['max-width: 720sp', [['view', 'collapsed', 'true']]]],
        sizes: [
            { width: 500, height: 600 },
            { width: 900, height: 600 },
        ],
        writes: [['view.collapsed=true'], ['view.collapsed=orig:view.collapsed']],
        rule: 'leaving restores the ORIGINAL, which was captured when the setter was registered',
    },
    {
        breakpoints: [['max-width: 720sp', [['view', 'collapsed', 'true']]]],
        sizes: [
            { width: 500, height: 600 },
            { width: 400, height: 600 },
        ],
        writes: [['view.collapsed=true'], null],
        rule: 'staying inside the same breakpoint produces no transition at all',
    },
    {
        breakpoints: [
            ['max-width: 720sp', [['view', 'collapsed', 'true']]],
            ['max-width: 400sp', [['view', 'collapsed', 'false']]],
        ],
        sizes: [
            { width: 500, height: 600 },
            { width: 300, height: 600 },
        ],
        writes: [['view.collapsed=true'], ['view.collapsed=false']],
        rule: 'a property BOTH set is written once, not restored and re-set',
    },
    {
        breakpoints: [
            [
                'max-width: 720sp',
                [
                    ['view', 'collapsed', 'true'],
                    ['view', 'title', 'narrow'],
                ],
            ],
            ['max-width: 400sp', [['view', 'collapsed', 'false']]],
        ],
        sizes: [
            { width: 500, height: 600 },
            { width: 300, height: 600 },
        ],
        writes: [
            ['view.collapsed=true', 'view.title=narrow'],
            ['view.title=orig:view.title', 'view.collapsed=false'],
        ],
        rule: 'only the property the incoming breakpoint does NOT set is restored, and restores come first',
    },
    {
        breakpoints: [
            [
                'max-width: 720sp',
                [
                    ['sidebar', 'collapsed', 'true'],
                    ['content', 'collapsed', 'true'],
                ],
            ],
            ['max-width: 400sp', [['sidebar', 'collapsed', 'false']]],
        ],
        sizes: [
            { width: 500, height: 600 },
            { width: 300, height: 600 },
        ],
        writes: [
            ['sidebar.collapsed=true', 'content.collapsed=true'],
            ['content.collapsed=orig:content.collapsed', 'sidebar.collapsed=false'],
        ],
        rule: 'the skip keys on OBJECT and property: the incoming breakpoint sets `collapsed` on the sidebar only, so the content is still restored',
    },
    {
        breakpoints: [
            [
                'max-width: 720sp',
                [
                    ['sidebar', 'collapsed', 'true'],
                    ['content', 'collapsed', 'true'],
                ],
            ],
        ],
        sizes: [
            { width: 500, height: 600 },
            { width: 900, height: 600 },
        ],
        writes: [
            ['sidebar.collapsed=true', 'content.collapsed=true'],
            ['sidebar.collapsed=orig:sidebar.collapsed', 'content.collapsed=orig:content.collapsed'],
        ],
        rule: 'leaving to NO breakpoint restores every setter, one per object',
    },
    {
        breakpoints: [
            ['max-width: 400sp', [['view', 'collapsed', 'true']]],
            ['max-width: 720sp', [['view', 'title', 'wide']]],
        ],
        sizes: [{ width: 300, height: 600 }],
        writes: [['view.title=wide']],
        rule: 'the later breakpoint wins outright, so the earlier one never applies and never restores',
    },
];
