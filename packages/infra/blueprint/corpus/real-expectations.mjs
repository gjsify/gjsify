// WHAT THE SHIPPED `.blp` FILES SHOULD PROJECT TO, WRITTEN BY HAND
//
// The companion of `expectations.mjs`, for the other half of the corpus. That file
// holds one small file per LANGUAGE RULE; this one holds every `.blp` a shipped
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
//  1. A BARE TYPE NAME RESOLVES AGAINST Gtk, AND ONLY Gtk. Three files write
//     `ToggleButton sidebarToggleButton {` with no namespace, and the tag here is
//     `GtkToggleButton`. So a projection that reads only the token cannot produce the
//     tag: it needs the GIR. What it does NOT need is the import list. Measured on
//     0.20.4: a bare `Bin` is refused as "Namespace Gtk does not contain a type called
//     Bin" even with `using Adw 1;` in the file, and every file must open with `using
//     Gtk` anyway. `24-unqualified-type.blp` was written for this after the eleven
//     turned it up.
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
//     WHAT THE FILE IS ABOUT IS NOW SAID OUT LOUD, and this finding is why ADR 0066 made
//     `template` a field rather than leaving the class to be inferred from the tag. The
//     root here is `{ tag: 'AdwBin', template: 'GalleryHeaderBar' }`: the restriction is
//     still visible in the tag, and the subject is no longer missing beside it.
//
//  4. DROPPING BOTH ENDS OF A MUTUAL BINDING LEAVES A TREE THAT IS WHOLE AND INERT.
//     `13-binding.blp` loses a PROPERTY, so its projection is visibly short of the
//     source. In the three split-view files the two bindings are each other's mirror —
//     `active: bind splitView.show-sidebar` and `show-sidebar: bind
//     sidebarToggleButton.active` — and neither property is written any other way, so
//     nothing is missing from the projected tree and the toggle button controls
//     nothing. A loss that leaves no gap is the one no reader of the tree will notice.
//
// AND ONE NUMBER OF ADR 0053'S CENSUS IS OFF
//
// Its § Context row for object ids reads "41 of those". The ids declared below are 48,
// counted one per `Type id {` line plus the ids written on a property-assigned object
// (`content: Gtk.Box canvasContainer {`, which a grep for a leading type token misses). 48
// is the number to carry: it is the one an entry here names node by node, so it is the one
// that fails loudly when a file changes. They were 47 `object-id` LOSSES until ADR 0066 made
// them `id` fields, and the count moved by one because the twelfth file arrived with the
// same PR that stopped them being losses.
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
            template: 'FireworksWindow',
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
                                    id: 'sidebarToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    id: 'pauseButton',
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
                            id: 'splitView',
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
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'particleCountRow',
                                                            props: { title: 'Particle Count' },
                                                        },
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'autoIntervalRow',
                                                            props: { title: 'Auto Interval (ms)' },
                                                        },
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'maxBurstRadiusRow',
                                                            props: { title: 'Max Burst Radius' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'autoFireworksRow',
                                                            props: { title: 'Auto Fireworks', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    tag: 'GtkBox',
                                    id: 'canvasContainer',
                                    slot: 'content',
                                    props: { hexpand: true, vexpand: true },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
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
            {
                kind: 'binding',
                line: 35,
                detail: '`active: bind splitView.show-sidebar` — the property is dropped entirely, not defaulted',
            },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
        ],
        note: 'Line 32 writes `ToggleButton` with no namespace and this says `GtkToggleButton` — see finding 1 in the header of this file. `sidebar-width-fraction: 0.30` says `0.3` for the reason `17-numeric-forms.blp` gives.',
    },
    {
        file: 'showcases/dom/excalibur-jelly-jumper/src/gjs/jelly-jumper-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'JellyJumperWindow',
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
                                    id: 'pauseButton',
                                    slot: 'end',
                                    props: {
                                        'icon-name': 'media-playback-pause-symbolic',
                                        'tooltip-text': 'Pause Game',
                                    },
                                },
                                {
                                    tag: 'GtkButton',
                                    id: 'audioButton',
                                    slot: 'end',
                                    props: { 'icon-name': 'audio-volume-high-symbolic', 'tooltip-text': 'Mute Audio' },
                                },
                            ],
                        },
                        { tag: 'GtkBox', id: 'canvasContainer', props: { hexpand: true, vexpand: true } },
                    ],
                },
            ],
        },
        lost: [],
        note: 'The two buttons both carry `slot: end` and their ORDER is load-bearing — measured on libadwaita 1.9, `AdwHeaderBar` PREPENDS into its end box, so the second `[end]` child (audio) sits LEFT of the first (pause). See finding 2 in the header of this file.',
    },
    {
        file: 'showcases/dom/three-geometry-teapot/src/gjs/teapot-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'TeapotWindow',
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
                                    id: 'sidebarToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    id: 'pauseButton',
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
                            id: 'splitView',
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
                                                        {
                                                            tag: 'AdwComboRow',
                                                            id: 'tessRow',
                                                            props: { title: 'Tessellation Level' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'lidRow',
                                                            props: { title: 'Display Lid', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'bodyRow',
                                                            props: { title: 'Display Body', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'bottomRow',
                                                            props: { title: 'Display Bottom', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'fitLidRow',
                                                            props: { title: 'Snug Lid', active: false },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'nonblinnRow',
                                                            props: { title: 'Original Scale', active: false },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Material' },
                                                    children: [
                                                        {
                                                            tag: 'AdwComboRow',
                                                            id: 'shadingRow',
                                                            props: { title: 'Shading' },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    tag: 'GtkBox',
                                    id: 'glAreaContainer',
                                    slot: 'content',
                                    props: { hexpand: true, vexpand: true },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
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
            { kind: 'binding', line: 35, detail: '`active: bind splitView.show-sidebar`' },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
        ],
    },
    {
        file: 'showcases/dom/three-loader-ldraw/src/gjs/ldraw-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'LDrawWindow',
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
                                                    children: [
                                                        {
                                                            tag: 'AdwComboRow',
                                                            id: 'modelRow',
                                                            props: { title: 'Model' },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Rendering' },
                                                    children: [
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'flatColorsRow',
                                                            props: { title: 'Flat Colors' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'mergeModelRow',
                                                            props: { title: 'Merge Model' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'smoothNormalsRow',
                                                            props: { title: 'Smooth Normals', active: true },
                                                        },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    props: { title: 'Display' },
                                                    children: [
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'buildingStepRow',
                                                            props: { title: 'Building Step' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'displayLinesRow',
                                                            props: { title: 'Display Lines', active: true },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'conditionalLinesRow',
                                                            props: { title: 'Conditional Lines', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                { tag: 'GtkSeparator', props: { orientation: 'vertical' } },
                                { tag: 'GtkBox', id: 'glAreaContainer', props: { hexpand: true, vexpand: true } },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [],
        note: 'The one sidebar showcase that builds its sidebar from a `Gtk.Box` rather than `Adw.OverlaySplitView`, so it carries no breakpoint and no binding at all: near enough the same UI as the other three, and a projection that loses far less of it.',
    },
    {
        file: 'showcases/dom/three-postprocessing-pixel/src/gjs/pixel-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'PixelWindow',
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
                                    id: 'sidebarToggleButton',
                                    slot: 'start',
                                    props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar' },
                                },
                                {
                                    tag: 'GtkButton',
                                    id: 'pauseButton',
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
                            id: 'splitView',
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
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'pixelSizeRow',
                                                            props: { title: 'Pixel Size' },
                                                        },
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'normalEdgeRow',
                                                            props: { title: 'Normal Edge' },
                                                        },
                                                        {
                                                            tag: 'AdwSpinRow',
                                                            id: 'depthEdgeRow',
                                                            props: { title: 'Depth Edge' },
                                                        },
                                                        {
                                                            tag: 'AdwSwitchRow',
                                                            id: 'pixelAlignRow',
                                                            props: { title: 'Pixel-Aligned Panning', active: true },
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    tag: 'GtkBox',
                                    id: 'glAreaContainer',
                                    slot: 'content',
                                    props: { hexpand: true, vexpand: true },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        lost: [
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
            { kind: 'binding', line: 35, detail: '`active: bind splitView.show-sidebar`' },
            {
                kind: 'binding',
                line: 49,
                detail: '`show-sidebar: bind sidebarToggleButton.active`, the mirror of line 35',
            },
        ],
    },
    {
        file: 'showcases/gtk/adw-blueprint-layout/src/header-bar.blp',
        node: {
            tag: 'AdwBin',
            template: 'GalleryHeaderBar',
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
                            id: 'menuButton',
                            slot: 'end',
                            props: { 'icon-name': 'open-menu-symbolic', 'tooltip-text': 'Main Menu' },
                        },
                    ],
                },
            ],
        },
        lost: [
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
            { kind: 'translatable', line: 24, detail: 'the `_()` marking on `Main Menu`' },
            { kind: 'styles', line: 26, detail: 'the style class `flat` on the menu button' },
        ],
        note: 'The root tag is `AdwBin` and the file is about the header bar under it — see finding 3 in the header of this file. `subtitle: "notes.md"` on line 10 is the one caption here that is NOT translatable, and the projection spells it exactly like the three that are.',
    },
    {
        file: 'showcases/gtk/adw-blueprint-layout/src/toolbar-view.blp',
        node: {
            tag: 'AdwBin',
            template: 'GalleryToolbarView',
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
        note: 'Three slot spellings under `AdwToolbarView` — `top`, `content`, `bottom` — of which only `content` came from a property, and four more slotted children under the action bar below it (`start` twice, `center`, `end`). Nothing in the projected tree says which came from a bracket.',
    },
    {
        file: 'showcases/gtk/effect-adw-services/src/window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'EffectServicesWindow',
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
                                                    children: [
                                                        { tag: 'AdwEntryRow', id: 'pathRow', props: { title: 'Path' } },
                                                    ],
                                                },
                                                {
                                                    tag: 'AdwPreferencesGroup',
                                                    id: 'resultGroup',
                                                    props: { title: 'Entries' },
                                                    children: [
                                                        {
                                                            tag: 'AdwActionRow',
                                                            id: 'statusRow',
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
                                                            id: 'fibersRow',
                                                            props: { title: 'Reads started', subtitle: '0' },
                                                        },
                                                        {
                                                            tag: 'AdwActionRow',
                                                            id: 'interruptedRow',
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
            { kind: 'translatable', line: 12, detail: 'the `_()` marking on the window title `Effect services`' },
            {
                kind: 'translatable',
                line: 20,
                detail: 'the `_()` marking on `Effect services`, the same string a second time',
            },
            { kind: 'translatable', line: 21, detail: 'the `_()` marking on `effect/FileSystem over Gio.File`' },
            { kind: 'translatable', line: 40, detail: 'the `_()` marking on `Read a directory`' },
            { kind: 'translatable', line: 41, detail: 'the `_()` marking on the group description' },
            { kind: 'translatable', line: 44, detail: 'the `_()` marking on `Path`' },
            { kind: 'translatable', line: 49, detail: 'the `_()` marking on `Entries`' },
            { kind: 'translatable', line: 52, detail: 'the `_()` marking on `Waiting`' },
            { kind: 'translatable', line: 53, detail: 'the `_()` marking on `Type a path above.`' },
            { kind: 'translatable', line: 58, detail: 'the `_()` marking on `Fiber activity`' },
            { kind: 'translatable', line: 61, detail: 'the `_()` marking on `Reads started`' },
            { kind: 'translatable', line: 66, detail: 'the `_()` marking on `Superseded and interrupted`' },
        ],
        note: 'The file states in its own header that it exists so that every caption is reachable by xgettext. Twelve `_()` markings, and this projection is where all twelve stop being reachable — the loss `09-translatable.blp` isolates, at the size a real interface reaches.',
    },
    {
        file: 'templates/adw-canvas2d/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'MainWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — Canvas 2D' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        { tag: 'AdwHeaderBar' },
                        { tag: 'GtkBox', id: 'canvasContainer', props: { hexpand: true, vexpand: true } },
                    ],
                },
            ],
        },
        lost: [],
        note: 'The three `templates/*/src/main-window.blp` differ in one string, so this tree is also the next two with the title changed. Three entries, one shape: a parser that passes here passes all three, and the twelve probes are fewer than twelve distinct probes.',
    },
    {
        file: 'templates/adw-game/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'MainWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — Game' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        { tag: 'AdwHeaderBar' },
                        { tag: 'GtkBox', id: 'canvasContainer', props: { hexpand: true, vexpand: true } },
                    ],
                },
            ],
        },
        lost: [],
    },
    {
        file: 'templates/adw-webgl/src/main-window.blp',
        node: {
            tag: 'AdwApplicationWindow',
            template: 'MainWindow',
            props: { 'default-width': 800, 'default-height': 600, title: 'new-gjsify-app — WebGL' },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'content',
                    props: { orientation: 'vertical' },
                    children: [
                        { tag: 'AdwHeaderBar' },
                        { tag: 'GtkBox', id: 'canvasContainer', props: { hexpand: true, vexpand: true } },
                    ],
                },
            ],
        },
        lost: [],
    },
    {
        file: 'templates/gtk-minimal/src/main-window.blp',
        node: {
            tag: 'GtkApplicationWindow',
            template: 'MainWindow',
            props: { title: 'new-gjsify-app', 'default-width': 480, 'default-height': 280 },
            children: [
                {
                    tag: 'GtkBox',
                    slot: 'child',
                    props: {
                        orientation: 'vertical',
                        spacing: 12,
                        'margin-top': 24,
                        'margin-bottom': 24,
                        'margin-start': 24,
                        'margin-end': 24,
                    },
                    children: [
                        { tag: 'GtkLabel', props: { label: 'Hello from gjsify!' } },
                        { tag: 'GtkLabel', id: 'hint', props: { xalign: 0.5 } },
                    ],
                },
            ],
        },
        lost: [
            {
                kind: 'comment',
                line: 17,
                detail: 'five comment lines in two blocks, saying why the tree lives here rather than in the callback that used to build it; neither exit carries them',
            },
            {
                kind: 'translatable',
                line: 20,
                detail: 'the `_()` marking on `Hello from gjsify!` — the one thing this file was written to gain',
            },
            {
                kind: 'styles',
                line: 22,
                detail: 'the style class `title-2` — a list, and `props` holds no lists (ADR 0049)',
            },
        ],
        note: 'The first probe that is neither Adwaita nor a showcase: plain `Gtk.ApplicationWindow`, `child:` rather than `content:`, and the only real file whose caption is the POINT — it was converted from a TypeScript `new Gtk.Label({ label: ... })` that xgettext could not see. So the `translatable` loss here is not incidental: a projection that drops it turns the conversion back into the thing it replaced.',
    },
];
