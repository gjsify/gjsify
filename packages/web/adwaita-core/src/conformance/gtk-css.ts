// GTK CSS loaded through `Gtk.CssProvider` as observable behaviour (ADR 0119 § 9).
//
// A vector is a stylesheet (one or more providers with their priorities), a widget tree written in
// GTK's names, and what GTK does with it: the parser errors it reports and the values a widget then
// shows. GTK exposes no computed style, so a reading is what GTK DOES expose: `Gtk.Widget.get_color()`
// for `color`, `measure()` for the minimum size, and two pixels of the widget rendered through a
// `Gtk.WidgetPaintable` — its centre, and one pixel inside the top edge where an inset ring is drawn.
// A port reads the same values from its own rendering and the vectors hold both to the same numbers.
//
// THE ORACLE is GTK under `gjs`, run with `scripts/headless-run` (`gtk-css.gjs.spec.ts`). Every row
// was measured there on GTK 4.22.5 before a translator existed.
//
// `errors` is GTK's own refusals, `<line>:<col>: <message>` with the START of the section GTK names.
// The subset's own refusals (`":backdrop" is not carried on the web (ADR 0119)`) are not parser
// errors in GTK, so they are no reading here; the core spec of the translator holds them.

import type { ConstructHarness } from './constructs.js';

/** The widgets a vector tree is built from, by GTK type name. */
export type GtkCssWidget = 'GtkBox' | 'GtkCheckButton';

/** One widget of a vector tree. */
export interface GtkCssNode {
    readonly widget: GtkCssWidget;
    /** The probe a reading names it by. */
    readonly id?: string;
    readonly classes?: readonly string[];
    /** `Gtk.Widget:name`, the `#name` of a selector. */
    readonly name?: string;
    /** Check buttons with the same key are one group; the first one is the group's leader. */
    readonly group?: string;
    readonly active?: boolean;
    readonly sensitive?: boolean;
    readonly children?: readonly GtkCssNode[];
}

export interface GtkCssSheet {
    readonly css: string;
    readonly priority: number;
}

export interface GtkCssScene {
    readonly sheets: readonly GtkCssSheet[];
    readonly tree: GtkCssNode;
}

export type GtkCssReadingKey = 'color' | 'size' | 'center' | 'edge';

/**
 * What a widget shows. `color` is `rgb(r,g,b)` or `rgba(r,g,b,a)`; `size` the minimum
 * `[width, height]` including padding and border; `center` and `edge` are `[r, g, b, a]`, straight
 * (not premultiplied) alpha, of the pixel at the centre and at `(width / 2, 1)`.
 */
export interface GtkCssReading {
    readonly color?: string;
    readonly size?: readonly [number, number];
    readonly center?: readonly [number, number, number, number];
    readonly edge?: readonly [number, number, number, number];
}

export interface GtkCssResult {
    readonly errors: readonly string[];
    readonly probes: Readonly<Record<string, GtkCssReading>>;
}

/** What a driver hands the vectors. */
export interface GtkCssSubject {
    readonly name: string;
    readonly isOracle: boolean;
    /** Loads the sheets into providers on the display, builds and shows the tree, reads, tears down. */
    render(scene: GtkCssScene, reads: Readonly<Record<string, readonly GtkCssReadingKey[]>>): Promise<GtkCssResult>;
}

export const GTK_CSS_ROWS = ['parser', 'selector', 'priority', 'color', 'swatch'] as const;

export type GtkCssRow = (typeof GTK_CSS_ROWS)[number];

export interface GtkCssVector {
    readonly row: GtkCssRow;
    readonly rule: string;
    readonly scene: GtkCssScene;
    readonly reads: Readonly<Record<string, readonly GtkCssReadingKey[]>>;
    readonly shows: { readonly errors: readonly string[]; readonly probes: Readonly<Record<string, GtkCssReading>> };
}

/** A pixel channel may differ by this much: filters and blending round differently per renderer. */
export const GTK_CSS_PIXEL_TOLERANCE = 2;

const APPLICATION = 600;
const USER = 800;

const RED = 'rgb(255,0,0)';
const BLUE = 'rgb(0,0,255)';

function sheet(css: string, priority = APPLICATION): readonly GtkCssSheet[] {
    return [{ css, priority }];
}

/** A check button `probe` inside a box with `classes`, for a selector read through `color`. */
function probed(css: string, check: Omit<GtkCssNode, 'widget' | 'id'> = {}, box: readonly string[] = ['wrap']) {
    return {
        sheets: sheet(css),
        tree: { widget: 'GtkBox', classes: box, children: [{ widget: 'GtkCheckButton', id: 'probe', ...check }] },
    } as const satisfies GtkCssScene;
}

const COLOR = { probe: ['color'] } as const;

// Learn6502's `primary-color-selector.css`, flattened the way its GNOME build hands it to GTK
// (lightningcss, `targets: { firefox: 60 << 16 }`), with the custom properties the selector reads
// resolved to plain colours so the reading does not depend on the theme.
const SWATCH_CSS = [
    '.primary-color-selector checkbutton.primary { min-height: 24px; min-width: 24px; background-clip: content-box; border-radius: 9999px; padding: 6px; box-shadow: inset 0 0 0 3px transparent; }',
    '.primary-color-selector checkbutton.primary radio { -gtk-icon-source: none; border: none; background: none; box-shadow: none; min-width: 12px; min-height: 12px; padding: 0; transform: none; }',
    '.primary-color-selector checkbutton.primary:checked { box-shadow: inset 0 0 0 3px rgb(0,0,255); }',
    '.primary-color-selector checkbutton.primary:disabled { filter: saturate(0.4) brightness(1.05); opacity: 0.7; }',
    '.primary-color-selector checkbutton.primary.primary-red { background-color: rgb(255,0,0); }',
].join('\n');

function swatch(state: { active?: boolean; sensitive?: boolean }): GtkCssScene {
    return {
        sheets: sheet(SWATCH_CSS),
        tree: {
            widget: 'GtkBox',
            classes: ['primary-color-selector'],
            children: [
                { widget: 'GtkCheckButton', group: 'primary' },
                {
                    widget: 'GtkCheckButton',
                    id: 'swatch',
                    group: 'primary',
                    classes: ['primary', 'primary-red'],
                    ...state,
                },
            ],
        },
    };
}

const SWATCH_READS = { swatch: ['size', 'center', 'edge'] } as const;

/**
 * CORE-ONLY: GAP — no port translates GTK CSS yet, so only the GJS oracle drives these rows. The
 * web drives them once the translator and the layered host land (ADR 0119 steps 2 and 3). Tracked
 * in #2298.
 */
export const GTK_CSS_VECTORS: readonly GtkCssVector[] = [
    // --- What GTK's parser refuses, and how much of the sheet it drops with it. ---
    {
        row: 'parser',
        rule: 'nesting is refused: the nested rule reads as a property and is dropped, what precedes it stays',
        scene: probed('.wrap checkbutton { color: rgb(255,0,0); label { color: rgb(0,0,255); } }'),
        reads: COLOR,
        shows: {
            errors: ['1:42: No property named "label"', "1:42: Expected ';' at end of block"],
            probes: { probe: { color: RED } },
        },
    },
    {
        row: 'parser',
        rule: ':has() is an unknown pseudo-class, and the rule is dropped',
        scene: probed('checkbutton:has(label) { color: rgb(255,0,0); }'),
        reads: COLOR,
        shows: { errors: ['1:12: Unknown pseudoclass'], probes: { probe: { color: 'rgb(46,52,54)' } } },
    },
    {
        row: 'parser',
        rule: 'a property GTK does not know drops that declaration only',
        scene: probed('.wrap checkbutton { display: flex; color: rgb(255,0,0); }'),
        reads: COLOR,
        shows: { errors: ['1:21: No property named "display"'], probes: { probe: { color: RED } } },
    },
    {
        row: 'parser',
        rule: 'a length without a unit drops that declaration only (Learn6502 main-button.css)',
        scene: probed('.wrap checkbutton { padding-bottom: 16; color: rgb(255,0,0); }'),
        reads: COLOR,
        shows: { errors: ['1:37: Unit is missing.'], probes: { probe: { color: RED } } },
    },
    {
        row: 'parser',
        rule: 'errors are located by line and column of the source',
        scene: probed('.wrap checkbutton {\n  colr: rgb(0,0,255);\n  padding: 1;\n  color: rgb(255,0,0);\n}'),
        reads: COLOR,
        shows: {
            errors: ['2:3: No property named "colr"', '3:12: Unit is missing.'],
            probes: { probe: { color: RED } },
        },
    },
    {
        row: 'parser',
        rule: '@media takes no browser media feature, and the block is dropped',
        scene: probed('@media (min-width: 3px) { checkbutton { color: rgb(255,0,0); } }'),
        reads: COLOR,
        shows: { errors: ["1:9: Undefined @media feature 'min-width'"], probes: { probe: { color: 'rgb(46,52,54)' } } },
    },
    // --- Selectors of the inventory. ---
    {
        row: 'selector',
        rule: 'a node name and a style class select the widget',
        scene: probed('checkbutton.pick { color: rgb(255,0,0); }', { classes: ['pick'] }),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    {
        row: 'selector',
        rule: 'a descendant selector reaches through the box by its class',
        scene: probed('.wrap checkbutton { color: rgb(255,0,0); }'),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    {
        row: 'selector',
        rule: '> selects a direct child only',
        scene: {
            sheets: sheet(
                '.outer > checkbutton { color: rgb(255,0,0); } .inner > checkbutton { color: rgb(0,0,255); }',
            ),
            tree: {
                widget: 'GtkBox',
                classes: ['outer'],
                children: [
                    { widget: 'GtkCheckButton', id: 'child' },
                    {
                        widget: 'GtkBox',
                        classes: ['inner'],
                        children: [{ widget: 'GtkCheckButton', id: 'grandchild' }],
                    },
                ],
            },
        },
        reads: { child: ['color'], grandchild: ['color'] },
        shows: { errors: [], probes: { child: { color: RED }, grandchild: { color: BLUE } } },
    },
    {
        row: 'selector',
        rule: '#name selects Gtk.Widget:name',
        scene: probed('#main-button { color: rgb(255,0,0); }', { name: 'main-button' }),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    {
        row: 'selector',
        rule: ':not(.class) excludes a widget that carries the class',
        scene: {
            sheets: sheet('.wrap checkbutton:not(.off) { color: rgb(255,0,0); }'),
            tree: {
                widget: 'GtkBox',
                classes: ['wrap'],
                children: [
                    { widget: 'GtkCheckButton', id: 'on' },
                    { widget: 'GtkCheckButton', id: 'off', classes: ['off'] },
                ],
            },
        },
        reads: { on: ['color'], off: ['color'] },
        shows: { errors: [], probes: { on: { color: RED }, off: { color: 'rgb(46,52,54)' } } },
    },
    {
        row: 'selector',
        rule: ':checked and :disabled follow the widget state',
        scene: {
            sheets: sheet(
                '.wrap checkbutton:checked { color: rgb(255,0,0); } .wrap checkbutton:disabled { color: rgb(0,0,255); }',
            ),
            tree: {
                widget: 'GtkBox',
                classes: ['wrap'],
                children: [
                    { widget: 'GtkCheckButton', id: 'checked', active: true },
                    { widget: 'GtkCheckButton', id: 'disabled', sensitive: false },
                ],
            },
        },
        reads: { checked: ['color'], disabled: ['color'] },
        shows: { errors: [], probes: { checked: { color: RED }, disabled: { color: BLUE } } },
    },
    // --- Priority: a higher provider wins whatever the specificity. ---
    {
        row: 'priority',
        rule: 'a provider of higher priority beats a more specific selector of a lower one',
        scene: {
            sheets: [
                { css: '.wrap checkbutton.pick { color: rgb(0,0,255); }', priority: APPLICATION },
                { css: 'checkbutton { color: rgb(255,0,0); }', priority: USER },
            ],
            tree: probed('', { classes: ['pick'] }).tree,
        },
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    {
        row: 'priority',
        rule: 'inside one provider the more specific selector wins, whatever the order',
        scene: probed('.wrap checkbutton.pick { color: rgb(255,0,0); } checkbutton { color: rgb(0,0,255); }', {
            classes: ['pick'],
        }),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    // --- Named colours, colour functions and custom properties. ---
    {
        row: 'color',
        rule: '@define-color names a colour and @name reads it',
        scene: probed('@define-color pick rgb(255,0,0); .wrap checkbutton { color: @pick; }'),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    {
        row: 'color',
        rule: 'alpha() scales the alpha of a colour',
        scene: probed('.wrap checkbutton { color: alpha(rgb(255,0,0), 0.5); }'),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: 'rgba(255,0,0,0.5)' } } },
    },
    {
        row: 'color',
        rule: 'a custom property on :root reaches a widget through var()',
        scene: probed(':root { --pick: rgb(255,0,0); } .wrap checkbutton { color: var(--pick); }'),
        reads: COLOR,
        shows: { errors: [], probes: { probe: { color: RED } } },
    },
    // --- Learn6502's colour selectors: the first consumer (ADR 0119 § Context). ---
    {
        row: 'swatch',
        rule: 'an unchecked swatch is filled with its colour inside the padding, with no ring',
        scene: swatch({}),
        reads: SWATCH_READS,
        shows: {
            errors: [],
            probes: { swatch: { size: [36, 36], center: [255, 0, 0, 255], edge: [0, 0, 0, 0] } },
        },
    },
    {
        row: 'swatch',
        rule: 'a checked swatch draws the ring in the padding',
        scene: swatch({ active: true }),
        reads: SWATCH_READS,
        shows: {
            errors: [],
            probes: { swatch: { size: [36, 36], center: [255, 0, 0, 255], edge: [0, 0, 255, 255] } },
        },
    },
    {
        row: 'swatch',
        rule: 'a disabled swatch is filtered and drawn at 0.7 opacity',
        scene: swatch({ active: true, sensitive: false }),
        reads: SWATCH_READS,
        shows: {
            errors: [],
            probes: { swatch: { size: [36, 36], center: [142, 34, 34, 178], edge: [11, 11, 119, 178] } },
        },
    },
];

function near(actual: unknown, expected: readonly number[]): boolean {
    return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        expected.every((value, index) => Math.abs((actual[index] as number) - value) <= GTK_CSS_PIXEL_TOLERANCE)
    );
}

/** The reading as compared: pixels within the tolerance are written as the expected value. */
function settled(result: GtkCssResult, vector: GtkCssVector): unknown {
    const probes: Record<string, Record<string, unknown>> = {};
    for (const [id, keys] of Object.entries(vector.reads)) {
        const got = result.probes[id] ?? {};
        const want = vector.shows.probes[id] ?? {};
        const out: Record<string, unknown> = {};
        for (const key of keys) {
            const value = got[key];
            const expected = want[key];
            out[key] = Array.isArray(expected) && near(value, expected as readonly number[]) ? expected : value;
        }
        probes[id] = out;
    }
    return { errors: result.errors, probes };
}

export async function driveGtkCssVectors(
    subject: GtkCssSubject,
    harness: ConstructHarness,
    vectors: readonly GtkCssVector[] = GTK_CSS_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GTK CSS from a CssProvider`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const result = await subject.render(vector.scene, vector.reads);
                expect(JSON.stringify(settled(result, vector))).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
