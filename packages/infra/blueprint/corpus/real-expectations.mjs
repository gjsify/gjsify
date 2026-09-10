// WHAT THE ELEVEN SHIPPED `.blp` FILES SHOULD PROJECT TO, WRITTEN BY HAND
//
// The companion of `expectations.mjs`, for the other half of the corpus. That file
// holds one small file per LANGUAGE RULE; this one holds the eleven `.blp` a shipped
// build already compiles, which ADR 0053 clause 6 keeps as the probe against reality —
// a corpus written by the person who will write the parser proves that person
// self-consistent and nothing else.
//
// Written under the same discipline: by reading the `.blp` and the `SharedNode`
// contract, never by compiling anything, and never by shaping a tree to match a golden
// under `real/`. The goldens were consulted for one thing only, the SPELLING of a class
// name — `Adw.Bin` is `AdwBin` and `ToggleButton` is `GtkToggleButton` — because a typo
// there would fail for a reason that has nothing to do with the projection.
//
// THE TYPEDEFS ARE IMPORTED, NOT RESTATED
//
// `LossKind` is a closed vocabulary, and `check-blueprint-corpus.mjs` already holds a
// runtime copy of it that its own comment says is kept in step BY HAND. A third copy
// here would be the one that drifts: it could admit a kind the rules file never
// declared, and nothing would say so. So this file imports and adds no vocabulary.
//
// One field is used differently, and deliberately. Under `RULE_EXPECTATIONS` `file` is
// a name under `rules/`; here it is the repo-relative `source` from
// `CORPUS_REAL_FILES`, because these files are referenced where they live rather than
// copied. The slug is the name of the GOLDEN, not of the subject.
//
// WHAT THE REAL FILES ADD TO THE FOUR FINDINGS IN `expectations.mjs`
//
// Those four hold here and are not repeated per entry. Four more only real files show:
//
//  1. A BARE TYPE NAME NEEDS THE `using` LINES TO RESOLVE. Three files write
//     `ToggleButton sidebarToggleButton {` with no namespace, and the tag here is
//     `GtkToggleButton`. The `using` lines project to nothing — GIR class names carry
//     their namespace already — and are still CONSUMED: a projection that reads only the
//     token cannot produce the tag. `24-unqualified-type.blp` was written for this after
//     the eleven turned it up, and the note on `18-multiple-imports.blp` was corrected.
//
//  2. TWO SIBLINGS CAN CARRY THE SAME `slot`. `[end]` appears twice under one
//     `Adw.HeaderBar` and `[start]` twice under one `Gtk.ActionBar`, while `content:`
//     may appear at most once. Finding 1 of `expectations.mjs` says `slot` cannot say
//     WHICH construct it came from; this says the two constructs also differ in
//     cardinality, and the shape records neither.
//
//  3. THE ROOT TAG OF A TEMPLATE FILE CAN NAME A WRAPPER, NOT THE SUBJECT. Both
//     `adw-blueprint-layout` files project to `AdwBin` because their own comments
//     record that `AdwHeaderBar` and `AdwToolbarView` are FINAL types and cannot be a
//     template parent. The widget each file is about sits one level down at
//     `slot: 'child'`, so the root tag is a GTK restriction showing through.
//
//  4. DROPPING BOTH ENDS OF A MUTUAL BINDING LEAVES A TREE THAT IS WHOLE AND INERT.
//     `13-binding.blp` loses a PROPERTY, so its projection is visibly short of the
//     source. In the three split-view files the two bindings are each other's mirror —
//     `active: bind splitView.show-sidebar` and `show-sidebar: bind
//     sidebarToggleButton.active` — and neither property is written any other way, so
//     nothing is missing from the projected tree and the toggle button controls
//     nothing. A loss that leaves no gap is the one no reader of the tree will notice.
//
// The two conventions both files follow — which line a loss names, and that `children`
// is in source order — are stated once, in the header of `expectations.mjs`.
//
// @import {CorpusExpectation} from './expectations.mjs'

/** @type {readonly CorpusExpectation[]} */
export const REAL_EXPECTATIONS = [
    {
        file: 'showcases/dom/canvas2d-fireworks/src/gjs/fireworks-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 1100, 'default-height': 700, title: 'Fireworks — Canvas 2D' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            children: [
                                {
                                    tag: 'GtkToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: {
                                        'icon-name': 'media-playback-pause-symbolic',
                                        'tooltip-text': 'Pause Rendering',
                                    },
                                },
                            ],
                        },
                        {
                            tag: 'AdwOverlaySplitView',
                            props: {
                                'sidebar-width-fraction': 0.3,
                                'min-sidebar-width': 280,
                                'max-sidebar-width': 400,
                            },
                            children: [
                                {
                                    tag: 'GtkScrolledWindow',
                                    slot: 'sidebar',
                                    props: { 'hscrollbar-policy': 'never' },
                                    children: [
                                        {
                                            tag: 'GtkBox',
                                            props: {
                                                orientation: 'vertical',
                                                spacing: 12,
                                                'margin-top': 12,
                                                'margin-bottom': 12,
                                                'margin-start': 12,
                                                'margin-end': 12,
                                            },
                                            children: [
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Fireworks' },
                                                    children: [
                                                        { tag: 'AdwSpinRow', props: { title: 'Particle Count' } },
                                                        { tag: 'AdwSpinRow', props: { title: 'Auto Interval (ms)' } },
                                                        { tag: 'AdwSpinRow', props: { title: 'Max Burst Radius' } },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Auto Fireworks', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                { tag: 'GtkBox', slot: 'content', props: { hexpand: true, vexpand: true } },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$FireworksWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            {
                kind: 'breakpoint',
                line: 10,
                detail: 'the whole `[breakpoint] Adw.Breakpoint` child: `condition ("max-width: 799sp")` and two setters on `splitView`',
            },
            {
                kind: 'breakpoint',
                line: 19,
                detail: 'the second `[breakpoint] Adw.Breakpoint` child: `condition ("min-width: 800sp")` and two setters on `splitView`',
            },
            { kind: 'object-id', line: 32, detail: 'the id `sidebarToggleButton`, which the binding on line 49 needs' },
            {
                kind: 'binding',
                line: 35,
                detail: '`active: bind splitView.show-sidebar` — the property is dropped entirely, not defaulted',
            },
            {
                kind: 'object-id',
                line: 39,
                detail: 'the id `pauseButton`, which the TypeScript half looks up on the template',
            },
            {
                kind: 'object-id',
                line: 45,
                detail: 'the id `splitView`, which the binding on line 35 and both breakpoints need',
            },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
            { kind: 'object-id', line: 65, detail: 'the id `particleCountRow`' },
            { kind: 'object-id', line: 69, detail: 'the id `autoIntervalRow`' },
            { kind: 'object-id', line: 73, detail: 'the id `maxBurstRadiusRow`' },
            { kind: 'object-id', line: 77, detail: 'the id `autoFireworksRow`' },
            {
                kind: 'object-id',
                line: 85,
                detail: 'the id `canvasContainer`, the one id the whole showcase is built around',
            },
        ],
        note: 'Line 32 writes `ToggleButton` with no namespace and this says `GtkToggleButton` — see finding 1 in the header of this file. `sidebar-width-fraction: 0.30` says `0.3` for the reason `17-numeric-forms.blp` gives.',
    },
    {
        file: 'showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 1280, 'default-height': 720, title: 'Jelly Jumper — Excalibur.js' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            children: [
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: {
                                        'icon-name': 'media-playback-pause-symbolic',
                                        'tooltip-text': 'Pause Game',
                                    },
                                },
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: { 'icon-name': 'audio-volume-high-symbolic', 'tooltip-text': 'Mute Audio' },
                                },
                            ],
                        },
                        { tag: 'GtkBox', props: { hexpand: true, vexpand: true } },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$JellyJumperWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            { kind: 'object-id', line: 14, detail: 'the id `pauseButton`' },
            { kind: 'object-id', line: 19, detail: 'the id `audioButton`' },
            { kind: 'object-id', line: 25, detail: 'the id `canvasContainer`' },
        ],
        note: 'The two buttons both carry `slot: end` and their ORDER is what puts pause left of audio — see finding 2 in the header of this file.',
    },
    {
        file: 'showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 1100, 'default-height': 700, title: 'Three.js Teapot' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            children: [
                                {
                                    tag: 'GtkToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: {
                                        'icon-name': 'media-playback-pause-symbolic',
                                        'tooltip-text': 'Pause Rendering',
                                    },
                                },
                            ],
                        },
                        {
                            tag: 'AdwOverlaySplitView',
                            props: {
                                'sidebar-width-fraction': 0.3,
                                'min-sidebar-width': 280,
                                'max-sidebar-width': 400,
                            },
                            children: [
                                {
                                    tag: 'GtkScrolledWindow',
                                    slot: 'sidebar',
                                    props: { 'hscrollbar-policy': 'never' },
                                    children: [
                                        {
                                            tag: 'GtkBox',
                                            props: {
                                                orientation: 'vertical',
                                                spacing: 12,
                                                'margin-top': 12,
                                                'margin-bottom': 12,
                                                'margin-start': 12,
                                                'margin-end': 12,
                                            },
                                            children: [
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Geometry' },
                                                    children: [
                                                        { tag: 'AdwComboRow', props: { title: 'Tessellation Level' } },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Display Lid', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Display Body', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Display Bottom', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Snug Lid', active: false },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Original Scale', active: false },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Material' },
                                                    children: [{ tag: 'AdwComboRow', props: { title: 'Shading' } }],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                { tag: 'GtkBox', slot: 'content', props: { hexpand: true, vexpand: true } },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$TeapotWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            {
                kind: 'breakpoint',
                line: 10,
                detail: 'the whole `[breakpoint] Adw.Breakpoint` child: `condition ("max-width: 799sp")` and two setters on `splitView`',
            },
            {
                kind: 'breakpoint',
                line: 19,
                detail: 'the second `[breakpoint] Adw.Breakpoint` child: `condition ("min-width: 800sp")` and two setters on `splitView`',
            },
            { kind: 'object-id', line: 32, detail: 'the id `sidebarToggleButton`, which the binding on line 49 needs' },
            { kind: 'binding', line: 35, detail: '`active: bind splitView.show-sidebar`' },
            { kind: 'object-id', line: 39, detail: 'the id `pauseButton`' },
            {
                kind: 'object-id',
                line: 45,
                detail: 'the id `splitView`, which the binding on line 35 and both breakpoints need',
            },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
            { kind: 'object-id', line: 65, detail: 'the id `tessRow`' },
            { kind: 'object-id', line: 69, detail: 'the id `lidRow`' },
            { kind: 'object-id', line: 74, detail: 'the id `bodyRow`' },
            { kind: 'object-id', line: 79, detail: 'the id `bottomRow`' },
            { kind: 'object-id', line: 84, detail: 'the id `fitLidRow`' },
            { kind: 'object-id', line: 89, detail: 'the id `nonblinnRow`' },
            { kind: 'object-id', line: 98, detail: 'the id `shadingRow`' },
            { kind: 'object-id', line: 105, detail: 'the id `glAreaContainer`' },
        ],
    },
    {
        file: 'showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 1100, 'default-height': 700, title: 'LDraw Loader' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        { tag: 'AdwHeaderBar' },
                        {
                            tag: 'GtkBox',
                            props: { orientation: 'horizontal', hexpand: true, vexpand: true },
                            children: [
                                {
                                    tag: 'GtkScrolledWindow',
                                    props: { 'width-request': 320, hexpand: false, 'hscrollbar-policy': 'never' },
                                    children: [
                                        {
                                            tag: 'GtkBox',
                                            props: {
                                                orientation: 'vertical',
                                                spacing: 12,
                                                'margin-top': 12,
                                                'margin-bottom': 12,
                                                'margin-start': 12,
                                                'margin-end': 12,
                                            },
                                            children: [
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Model' },
                                                    children: [{ tag: 'AdwComboRow', props: { title: 'Model' } }],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Rendering' },
                                                    children: [
                                                        { tag: 'AdwSwitchRow', props: { title: 'Flat Colors' } },
                                                        { tag: 'AdwSwitchRow', props: { title: 'Merge Model' } },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Smooth Normals', active: true },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Display' },
                                                    children: [
                                                        { tag: 'AdwSpinRow', props: { title: 'Building Step' } },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Display Lines', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Conditional Lines', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                { tag: 'GtkSeparator', props: { orientation: 'vertical' } },
                                { tag: 'GtkBox', props: { hexpand: true, vexpand: true } },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$LDrawWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            { kind: 'object-id', line: 35, detail: 'the id `modelRow`' },
            { kind: 'object-id', line: 43, detail: 'the id `flatColorsRow`' },
            { kind: 'object-id', line: 47, detail: 'the id `mergeModelRow`' },
            { kind: 'object-id', line: 51, detail: 'the id `smoothNormalsRow`' },
            { kind: 'object-id', line: 60, detail: 'the id `buildingStepRow`' },
            { kind: 'object-id', line: 64, detail: 'the id `displayLinesRow`' },
            { kind: 'object-id', line: 69, detail: 'the id `conditionalLinesRow`' },
            { kind: 'object-id', line: 81, detail: 'the id `glAreaContainer`' },
        ],
        note: 'The one sidebar showcase that builds its sidebar from a `Gtk.Box` rather than `Adw.OverlaySplitView`, so it carries no breakpoint and no binding at all: near enough the same UI as the other three, and a projection that loses far less of it.',
    },
    {
        file: 'showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 1100, 'default-height': 700, title: 'Pixel Post-Processing' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            children: [
                                {
                                    tag: 'GtkToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: {
                                        'icon-name': 'media-playback-pause-symbolic',
                                        'tooltip-text': 'Pause Rendering',
                                    },
                                },
                            ],
                        },
                        {
                            tag: 'AdwOverlaySplitView',
                            props: {
                                'sidebar-width-fraction': 0.3,
                                'min-sidebar-width': 280,
                                'max-sidebar-width': 400,
                            },
                            children: [
                                {
                                    tag: 'GtkScrolledWindow',
                                    slot: 'sidebar',
                                    props: { 'hscrollbar-policy': 'never' },
                                    children: [
                                        {
                                            tag: 'GtkBox',
                                            props: {
                                                orientation: 'vertical',
                                                spacing: 12,
                                                'margin-top': 12,
                                                'margin-bottom': 12,
                                                'margin-start': 12,
                                                'margin-end': 12,
                                            },
                                            children: [
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Post-Processing' },
                                                    children: [
                                                        { tag: 'AdwSpinRow', props: { title: 'Pixel Size' } },
                                                        { tag: 'AdwSpinRow', props: { title: 'Normal Edge' } },
                                                        { tag: 'AdwSpinRow', props: { title: 'Depth Edge' } },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            props: { title: 'Pixel-Aligned Panning', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                { tag: 'GtkBox', slot: 'content', props: { hexpand: true, vexpand: true } },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$PixelWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            {
                kind: 'breakpoint',
                line: 10,
                detail: 'the whole `[breakpoint] Adw.Breakpoint` child: `condition ("max-width: 799sp")` and two setters on `splitView`',
            },
            {
                kind: 'breakpoint',
                line: 19,
                detail: 'the second `[breakpoint] Adw.Breakpoint` child: `condition ("min-width: 800sp")` and two setters on `splitView`',
            },
            { kind: 'object-id', line: 32, detail: 'the id `sidebarToggleButton`, which the binding on line 49 needs' },
            { kind: 'binding', line: 35, detail: '`active: bind splitView.show-sidebar`' },
            { kind: 'object-id', line: 39, detail: 'the id `pauseButton`' },
            {
                kind: 'object-id',
                line: 45,
                detail: 'the id `splitView`, which the binding on line 35 and both breakpoints need',
            },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
            { kind: 'object-id', line: 65, detail: 'the id `pixelSizeRow`' },
            { kind: 'object-id', line: 69, detail: 'the id `normalEdgeRow`' },
            { kind: 'object-id', line: 73, detail: 'the id `depthEdgeRow`' },
            { kind: 'object-id', line: 77, detail: 'the id `pixelAlignRow`' },
            { kind: 'object-id', line: 85, detail: 'the id `glAreaContainer`' },
        ],
    },
    {
        file: 'showcases/gtk/adw-blueprint-layout/src/header-bar.blp',
        node: {
            tag: 'AdwBin',
            children: [
                {
                    tag: 'AdwHeaderBar',
                    slot: 'child',
                    children: [
                        {
                            tag: 'AdwWindowTitle',
                            slot: 'title-widget',
                            props: { title: 'Text Editor', subtitle: 'notes.md' },
                        },
                        {
                            tag: 'GtkButton',
                            slot: 'start',
                            props: { 'icon-name': 'go-previous-symbolic', 'tooltip-text': 'Back' },
                        },
                        {
                            tag: 'GtkMenuButton',
                            slot: 'end',
                            props: { 'icon-name': 'open-menu-symbolic', 'tooltip-text': 'Main Menu' },
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 6,
                detail: 'the template class `$GalleryHeaderBar`; only its parent type `Adw.Bin` survives, as the root tag',
            },
            {
                kind: 'translatable',
                line: 9,
                detail: 'the `_()` marking on `Text Editor`; the string survives, its translatability does not',
            },
            { kind: 'translatable', line: 16, detail: 'the `_()` marking on `Back`' },
            {
                kind: 'styles',
                line: 18,
                detail: 'the style class `flat` on the back button — a list, and `props` holds no lists (ADR 0049)',
            },
            { kind: 'object-id', line: 22, detail: 'the id `menuButton`' },
            { kind: 'translatable', line: 24, detail: 'the `_()` marking on `Main Menu`' },
            { kind: 'styles', line: 26, detail: 'the style class `flat` on the menu button' },
        ],
        note: 'The root tag is `AdwBin` and the file is about the header bar under it — see finding 3 in the header of this file. `subtitle: "notes.md"` on line 10 is the one caption here that is NOT translatable, and the projection spells it exactly like the three that are.',
    },
    {
        file: 'showcases/gtk/adw-blueprint-layout/src/toolbar-view.blp',
        node: {
            tag: 'AdwBin',
            children: [
                {
                    tag: 'AdwToolbarView',
                    slot: 'child',
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            slot: 'top',
                            children: [
                                {
                                    tag: 'AdwWindowTitle',
                                    slot: 'title-widget',
                                    props: { title: 'Documents', subtitle: '12 items' },
                                },
                            ],
                        },
                        {
                            tag: 'AdwStatusPage',
                            slot: 'content',
                            props: {
                                'icon-name': 'folder-documents-symbolic',
                                title: 'Your library',
                                description: 'Content sits between the toolbars and scrolls independently of them.',
                            },
                        },
                        {
                            tag: 'GtkActionBar',
                            slot: 'bottom',
                            children: [
                                {
                                    tag: 'GtkButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'list-add-symbolic', 'tooltip-text': 'Add' },
                                },
                                {
                                    tag: 'GtkButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'list-remove-symbolic', 'tooltip-text': 'Remove' },
                                },
                                { tag: 'GtkLabel', slot: 'center', props: { label: 'Selection: none' } },
                                {
                                    tag: 'GtkButton',
                                    slot: 'end',
                                    props: { 'icon-name': 'send-to-symbolic', 'tooltip-text': 'Share' },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 6,
                detail: 'the template class `$GalleryToolbarView`; only its parent type `Adw.Bin` survives, as the root tag',
            },
            { kind: 'translatable', line: 11, detail: 'the `_()` marking on `Documents`' },
            { kind: 'translatable', line: 12, detail: 'the `_()` marking on `12 items`' },
            { kind: 'translatable', line: 18, detail: 'the `_()` marking on `Your library`' },
            { kind: 'translatable', line: 19, detail: 'the `_()` marking on the status page description' },
            { kind: 'translatable', line: 27, detail: 'the `_()` marking on `Add`' },
            { kind: 'styles', line: 29, detail: 'the style class `flat` on the add button' },
            { kind: 'translatable', line: 35, detail: 'the `_()` marking on `Remove`' },
            { kind: 'styles', line: 37, detail: 'the style class `flat` on the remove button' },
            { kind: 'translatable', line: 42, detail: 'the `_()` marking on `Selection: none`' },
            { kind: 'translatable', line: 48, detail: 'the `_()` marking on `Share`' },
            { kind: 'styles', line: 50, detail: 'the style class `flat` on the share button' },
        ],
        note: 'Three slot spellings under `AdwToolbarView` — `top`, `content`, `bottom` — of which only `content` came from a property, and four more under the action bar below it. Nothing in the projected tree says which came from a bracket.',
    },
    {
        file: 'showcases/gtk/effect-adw-services/src/window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { title: 'Effect services', 'default-width': 620, 'default-height': 640 },
            children: [
                {
                    tag: 'AdwToolbarView',
                    slot: 'content',
                    children: [
                        {
                            tag: 'AdwHeaderBar',
                            slot: 'top',
                            children: [
                                {
                                    tag: 'AdwWindowTitle',
                                    slot: 'title-widget',
                                    props: { title: 'Effect services', subtitle: 'effect/FileSystem over Gio.File' },
                                },
                            ],
                        },
                        {
                            tag: 'GtkScrolledWindow',
                            slot: 'content',
                            props: { 'hscrollbar-policy': 'never' },
                            children: [
                                {
                                    tag: 'AdwClamp',
                                    props: { 'maximum-size': 560 },
                                    children: [
                                        {
                                            tag: 'GtkBox',
                                            props: {
                                                orientation: 'vertical',
                                                spacing: 18,
                                                'margin-top': 24,
                                                'margin-bottom': 24,
                                                'margin-start': 12,
                                                'margin-end': 12,
                                            },
                                            children: [
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: {
                                                        title: 'Read a directory',
                                                        description:
                                                            'Every keystroke is a Stream element; the read runs as a fiber owned by this window.',
                                                    },
                                                    children: [{ tag: 'AdwEntryRow', props: { title: 'Path' } }],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Entries' },
                                                    children: [
                                                        {
                                                            tag: 'AdwActionRow',
                                                            props: { title: 'Waiting', subtitle: 'Type a path above.' },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Fiber activity' },
                                                    children: [
                                                        {
                                                            tag: 'AdwActionRow',
                                                            props: { title: 'Reads started', subtitle: '0' },
                                                        },
                                                        {
                                                            tag: 'AdwActionRow',
                                                            props: {
                                                                title: 'Superseded and interrupted',
                                                                subtitle: '0',
                                                            },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 11,
                detail: 'the template class `$EffectServicesWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            { kind: 'translatable', line: 12, detail: 'the `_()` marking on the window title `Effect services`' },
            {
                kind: 'translatable',
                line: 20,
                detail: 'the `_()` marking on `Effect services`, the same string a second time',
            },
            { kind: 'translatable', line: 21, detail: 'the `_()` marking on `effect/FileSystem over Gio.File`' },
            { kind: 'translatable', line: 40, detail: 'the `_()` marking on `Read a directory`' },
            { kind: 'translatable', line: 41, detail: 'the `_()` marking on the group description' },
            { kind: 'object-id', line: 43, detail: 'the id `pathRow`' },
            { kind: 'translatable', line: 44, detail: 'the `_()` marking on `Path`' },
            {
                kind: 'object-id',
                line: 48,
                detail: 'the id `resultGroup`, which the TypeScript half adds rows to at runtime',
            },
            { kind: 'translatable', line: 49, detail: 'the `_()` marking on `Entries`' },
            { kind: 'object-id', line: 51, detail: 'the id `statusRow`' },
            { kind: 'translatable', line: 52, detail: 'the `_()` marking on `Waiting`' },
            { kind: 'translatable', line: 53, detail: 'the `_()` marking on `Type a path above.`' },
            { kind: 'translatable', line: 58, detail: 'the `_()` marking on `Fiber activity`' },
            { kind: 'object-id', line: 60, detail: 'the id `fibersRow`' },
            { kind: 'translatable', line: 61, detail: 'the `_()` marking on `Reads started`' },
            { kind: 'object-id', line: 65, detail: 'the id `interruptedRow`' },
            { kind: 'translatable', line: 66, detail: 'the `_()` marking on `Superseded and interrupted`' },
        ],
        note: 'The file states in its own header that it exists so that every caption is reachable by xgettext. Twelve `_()` markings, and this projection is where all twelve stop being reachable — the loss `09-translatable.blp` isolates, at the size a real interface reaches.',
    },
    {
        file: 'templates/adw-canvas2d/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — Canvas 2D' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [{ tag: 'AdwHeaderBar' }, { tag: 'GtkBox', props: { hexpand: true, vexpand: true } }],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$MainWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            {
                kind: 'object-id',
                line: 14,
                detail: 'the id `canvasContainer`, which the scaffolded TypeScript looks up',
            },
        ],
        note: 'The three `templates/*/src/main-window.blp` differ in one string, so this tree is also the next two with the title changed. Three entries, one shape: a parser that passes here passes all three, and the eleven probes are fewer than eleven distinct probes.',
    },
    {
        file: 'templates/adw-game/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — Game' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [{ tag: 'AdwHeaderBar' }, { tag: 'GtkBox', props: { hexpand: true, vexpand: true } }],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$MainWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            { kind: 'object-id', line: 14, detail: 'the id `canvasContainer`' },
        ],
    },
    {
        file: 'templates/adw-webgl/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — WebGL' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [{ tag: 'AdwHeaderBar' }, { tag: 'GtkBox', props: { hexpand: true, vexpand: true } }],
                },
            ],
        },
        lost: [
            {
                kind: 'template',
                line: 4,
                detail: 'the template class `$MainWindow`; only its parent type `Adw.ApplicationWindow` survives, as the root tag',
            },
            { kind: 'object-id', line: 14, detail: 'the id `canvasContainer`' },
        ],
    },
];
