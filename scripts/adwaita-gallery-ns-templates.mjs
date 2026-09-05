// The ONE source the NativeScript XML template in every Adwaita gallery block is
// emitted from — one view tree per block, in `@gjsify/adwaita-nativescript`'s own
// element names.
//
// WHY A SECOND SOURCE, AND NOT A TRANSLATION OF `adwaita-gallery-trees.mjs`
//
// The Solid/Vue/React trees beside this file are written in `@gjsify/gtk-host`'s
// vocabulary, and that vocabulary is GTK's: `gtk-label`, `gtk-button`, `cssClasses`,
// `iconName`. NativeScript's is a different widget set on a different toolkit —
// `Label`, `GtkButton`, `class`, an `iconName` that is an SVG SOURCE rather than a name.
// A generator that turned one into the other would need exactly the hand-written
// alias table of tags AND semantics that `adwaita-gallery-trees.mjs` refuses in its
// own header, one toolkit further apart. So the port describes itself, here, and
// `scripts/check-generated-website-data.mjs` holds every element and property in it
// against the widget classes that actually ship.
//
// WHAT IS IN AND WHAT IS OUT
//
// A block gets a template only when its widget can be INFLATED FROM XML completely.
// NativeScript's Builder reaches a widget through two doors and no others:
//
//   · An ATTRIBUTE, which arrives as a STRING. `component-builder`'s
//     `setPropertyValue` ends in `instance[name] = value` with no conversion at all
//     for a plain accessor (only NativeScript `Property` objects carry a
//     `valueConverter`, and these widgets are plain classes). So a property whose
//     value is an ARRAY or another VIEW cannot be written as an attribute, and one
//     that takes a number or a boolean only works if its setter coerces — which is
//     why the probe asserts the value it READS BACK and its TYPE, not that the
//     attribute was present.
//   · A CHILD, which arrives at `_addChildFromBuilder(name, view)`. `LayoutBase`'s
//     inherited implementation ignores the name and calls `addChild`, which drops
//     the child into the composed widget's first cell instead of into the slot it
//     asked for. Only a widget that OVERRIDES that method can take an XML child, and
//     `widgets/builder-slots.ts` holds the rule they share.
//
// `refusals` below names every block that cannot pass through either door, with the
// reason — because a template that shows a combo row without its items, or a view
// switcher with no stack, teaches something false about the port.

/**
 * @typedef {Object} NsNode
 * @property {string} tag                    an XML element name: `AdwClamp` from this
 *                                           package, or `Label` from NativeScript core
 * @property {string} [slot]                 the PARENT's own property name, which is what
 *                                           NativeScript's complex-property syntax spells:
 *                                           `<adw:AdwToolbarView.topBar>`
 * @property {Record<string, string|number|boolean>} [props]
 * @property {NsNode[]} [children]
 */

/**
 * @typedef {Object} NsTemplate
 * @property {string} widget   the `<AdwWidget title="…">` this belongs to
 * @property {string} page     the gallery page it sits on
 * @property {string} [note]   one line emitted as a comment above the template
 * @property {NsNode} root
 */

import { nativeScriptTree } from './adwaita-gallery-shared-trees.mjs';

/** @type {readonly NsTemplate[]} */
export const ADWAITA_GALLERY_NS_TEMPLATES = [
    // ------------------------------------------------------------- boxed-lists
    // Authored once in `adwaita-gallery-shared-trees.mjs` and rendered by both this
    // port and the three framework dialects beside it — ADR 0027 § 9's criterion at
    // the size that file's census reaches. Seven blocks needed no alias to line up;
    // every block that still needs one is in its divergence ledger with the reason.
    nativeScriptTree('Adw.PreferencesGroup'),
    {
        widget: 'Adw.ActionRow',
        page: 'boxed-lists',
        // The prefix icon and the chevron the GTK snippet carries are NOT here, and
        // the reason is one door up: `GtkImage.iconName` takes an SVG SOURCE, not an icon
        // name, so a template that wanted one would have to inline the whole
        // document into an attribute. The measured pattern in this port is an `id`
        // in the markup and the icon assigned in the code-behind — which is what the
        // TypeScript tab beside this one does.
        root: {
            tag: 'AdwPreferencesGroup',
            children: [
                {
                    tag: 'AdwActionRow',
                    props: { title: 'Wi-Fi', subtitle: 'Connected to Highgarden 5GHz', activatable: true },
                },
            ],
        },
    },
    nativeScriptTree('Adw.SwitchRow'),
    nativeScriptTree('Adw.EntryRow'),
    {
        widget: 'Adw.PasswordEntryRow',
        page: 'boxed-lists',
        root: {
            tag: 'AdwPreferencesGroup',
            children: [
                {
                    tag: 'AdwPasswordEntryRow',
                    props: { title: 'Password', text: 'correct-horse-battery', revealed: false },
                },
            ],
        },
    },
    {
        widget: 'Adw.SpinRow',
        page: 'boxed-lists',
        // A refusal in the framework trees, and a template here: the range is a
        // `Gtk.Adjustment` on GTK — a GObject that is not a widget and has no tag in any
        // element model — and the portable value of it here (ADR 0047). The attribute
        // carries that value as JSON, which is the door `adw-spin-row.ts`'s setter opens;
        // it is why this widget is not in `ADWAITA_GALLERY_NS_REFUSALS` beside the ones
        // whose object property no attribute can carry.
        root: {
            tag: 'AdwPreferencesGroup',
            children: [
                {
                    tag: 'AdwSpinRow',
                    props: {
                        title: 'Copies',
                        value: 3,
                        adjustment: JSON.stringify({ lower: 1, upper: 20, stepIncrement: 1 }),
                    },
                },
            ],
        },
    },
    {
        widget: 'Adw.ButtonRow',
        page: 'boxed-lists',
        root: {
            tag: 'AdwPreferencesGroup',
            children: [{ tag: 'AdwButtonRow', props: { title: 'Add account' } }],
        },
    },
    // ----------------------------------------------------------------- buttons
    {
        widget: 'Adw.ButtonContent',
        page: 'buttons',
        // No `iconName`: it is an SVG source string. `label` is the half a template can
        // hold, and the loader beside it assigns the icon by id.
        root: { tag: 'AdwButtonContent', props: { id: 'download', label: 'Download' } },
    },
    {
        widget: 'Gtk.Button',
        page: 'buttons',
        root: {
            tag: 'StackLayout',
            props: { orientation: 'horizontal' },
            children: [
                { tag: 'GtkButton', props: { text: 'Pill', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'Suggested', variant: 'suggested' } },
                { tag: 'GtkButton', props: { text: 'Delete', variant: 'destructive' } },
                { tag: 'GtkButton', props: { text: 'Flat', variant: 'flat' } },
            ],
        },
    },
    // ---------------------------------------------------------------- controls
    {
        widget: 'Gtk.Entry',
        page: 'controls',
        root: { tag: 'GtkEntry', props: { placeholderText: 'Search files…' } },
    },
    // ------------------------------------------------------------------ layout
    {
        widget: 'Adw.Clamp',
        page: 'layout',
        root: {
            tag: 'AdwClamp',
            props: { maximumSize: 400, tighteningThreshold: 300 },
            children: [
                {
                    tag: 'Label',
                    props: {
                        class: 'card',
                        textWrap: true,
                        text: 'This content is clamped: it stops growing past the maximum size and stays centred.',
                    },
                },
            ],
        },
    },
    {
        widget: 'Adw.HeaderBar',
        page: 'layout',
        root: {
            tag: 'AdwHeaderBar',
            children: [
                { tag: 'GtkButton', slot: 'startBox', props: { text: '‹', variant: 'flat' } },
                {
                    tag: 'AdwWindowTitle',
                    slot: 'titleWidget',
                    props: { title: 'Text Editor', subtitle: 'notes.md' },
                },
                { tag: 'GtkButton', slot: 'endBox', props: { text: '≡', variant: 'flat' } },
            ],
        },
    },
    {
        widget: 'Adw.ToolbarView',
        page: 'layout',
        root: {
            tag: 'AdwToolbarView',
            children: [
                {
                    tag: 'AdwHeaderBar',
                    slot: 'topBar',
                    props: { title: 'Documents', subtitle: '12 items' },
                },
                {
                    tag: 'AdwStatusPage',
                    slot: 'content',
                    props: {
                        id: 'library',
                        title: 'Your library',
                        description: 'Content sits between the toolbars and scrolls independently of them.',
                    },
                },
                {
                    tag: 'AdwHeaderBar',
                    slot: 'bottomBar',
                    children: [
                        {
                            tag: 'AdwWindowTitle',
                            slot: 'titleWidget',
                            props: { title: 'Selection: none' },
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.WrapBox',
        page: 'layout',
        // The NativeScript widget takes an XML child through `_addChildFromBuilder`
        // and puts it where a wrap box puts children.
        //
        // THIS COMMENT USED TO OPEN "a refusal in the framework trees — `gtk-host` has
        // no child policy for `AdwWrapBox`", and that stopped being true the day the
        // policy landed in `descriptors/adw.ts`: the framework trees carry this block.
        // Nothing held the claim, because it is a sentence in one file ABOUT the other
        // one — which is the gap arm 11 of `check-generated-website-data.mjs` now
        // measures for the trees themselves.
        root: {
            tag: 'AdwWrapBox',
            props: { childSpacing: 8, lineSpacing: 8 },
            children: [
                { tag: 'GtkButton', props: { text: 'Design', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'Adwaita', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'GNOME', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'GTK', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'TypeScript', variant: 'pill' } },
                { tag: 'GtkButton', props: { text: 'Storybook', variant: 'pill' } },
            ],
        },
    },
    // ------------------------------------------------------------ presentation
    {
        widget: 'Adw.Avatar',
        page: 'presentation',
        root: { tag: 'AdwAvatar', props: { text: 'Ada Lovelace', size: 96 } },
    },
    nativeScriptTree('Adw.Banner'),
    nativeScriptTree('Adw.ShortcutLabel'),
    {
        widget: 'Adw.Spinner',
        page: 'presentation',
        root: { tag: 'AdwSpinner', props: { spinning: true, size: 48 } },
    },
    {
        widget: 'Adw.StatusPage',
        page: 'presentation',
        // `iconText` and not `iconName`: the icon property is an SVG source, the text one
        // is the glyph fallback this port exposes for exactly the case where a name
        // is all the caller has.
        root: {
            tag: 'AdwStatusPage',
            props: {
                iconText: '\u{1F4C1}',
                title: 'No Documents',
                description: 'Documents you create or open will appear here.',
            },
        },
    },
    nativeScriptTree('Adw.WindowTitle'),
    // ---------------------------------------------------------------- feedback
    {
        widget: 'Adw.AboutDialog',
        page: 'feedback',
        // A refusal in the framework trees, where a dialog is opened with `present()`
        // and a static tree renders nothing. The NativeScript dialog is a VIEW whose
        // whole surface is strings, and `open` is an ordinary property — so the
        // template declares the dialog and leaves it closed, which is the state a
        // reader can actually see in a tree.
        root: {
            tag: 'AdwAboutDialog',
            props: {
                applicationName: 'Adwaita Gallery',
                version: '1.0.0',
                developerName: 'The GNOME Project',
                comments: 'A tour of the Adwaita widgets on NativeScript.',
                website: 'https://gjsify.org',
                copyright: '© 2026 The GNOME Project',
                open: false,
            },
        },
    },
    nativeScriptTree('Adw.ExpanderRow'),
    // ----------------------------------------------------------- view-switching
    {
        widget: 'Adw.Carousel',
        page: 'view-switching',
        root: {
            tag: 'AdwCarousel',
            children: [
                { tag: 'AdwStatusPage', props: { iconText: '\u2460', title: 'Welcome' } },
                { tag: 'AdwStatusPage', props: { iconText: '\u2461', title: 'Sync' } },
                { tag: 'AdwStatusPage', props: { iconText: '\u2462', title: 'Done' } },
            ],
        },
    },
    // -------------------------------------------------------------- navigation
    {
        widget: 'Adw.NavigationSplitView',
        page: 'navigation',
        // Both panes are ordinary views here. GTK takes an `Adw.NavigationPage` in
        // these slots and nothing else — the difference the framework trees carry as
        // two `<adw-navigation-page>` wrappers.
        root: {
            tag: 'AdwNavigationSplitView',
            children: [
                {
                    tag: 'AdwToolbarView',
                    slot: 'sidebar',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'Mailboxes' } },
                        { tag: 'AdwStatusPage', slot: 'content', props: { title: 'Mailboxes' } },
                    ],
                },
                {
                    tag: 'AdwToolbarView',
                    slot: 'content',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'All Mail' } },
                        {
                            tag: 'AdwStatusPage',
                            slot: 'content',
                            props: {
                                title: 'All Mail',
                                description: 'Select a conversation from the list to read it here.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.OverlaySplitView',
        page: 'navigation',
        root: {
            tag: 'AdwOverlaySplitView',
            children: [
                {
                    tag: 'AdwToolbarView',
                    slot: 'sidebar',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'Library' } },
                        { tag: 'AdwStatusPage', slot: 'content', props: { title: 'Sections' } },
                    ],
                },
                {
                    tag: 'AdwToolbarView',
                    slot: 'content',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'Your Library' } },
                        {
                            tag: 'AdwStatusPage',
                            slot: 'content',
                            props: { title: 'Your Library', description: 'Toggle the sidebar to browse sections.' },
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.NavigationView',
        page: 'navigation',
        // Document order is stack order: the first child is registered and pushed, so
        // the template alone shows a populated view rather than an empty one. The
        // page TAG a `push` needs is not in the markup — that is the loader's half.
        root: {
            tag: 'AdwNavigationView',
            children: [
                {
                    tag: 'AdwToolbarView',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'Contacts' } },
                        {
                            tag: 'AdwStatusPage',
                            slot: 'content',
                            props: { title: 'Contacts', description: 'Push a page to see the transition.' },
                        },
                    ],
                },
                {
                    tag: 'AdwToolbarView',
                    children: [
                        { tag: 'AdwHeaderBar', slot: 'topBar', props: { title: 'Ada Lovelace' } },
                        {
                            tag: 'AdwStatusPage',
                            slot: 'content',
                            props: {
                                title: 'Ada Lovelace',
                                description: 'Mathematician and writer, the first computer programmer.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.BottomSheet',
        page: 'navigation',
        root: {
            tag: 'AdwBottomSheet',
            props: { open: true },
            children: [
                {
                    tag: 'AdwStatusPage',
                    slot: 'content',
                    props: { title: 'Now Playing', description: 'The sheet slides up over this.' },
                },
                {
                    tag: 'AdwPreferencesGroup',
                    slot: 'sheet',
                    props: { title: 'Queue' },
                    children: [
                        { tag: 'AdwActionRow', props: { title: 'Blue Monday', subtitle: 'New Order' } },
                        { tag: 'AdwActionRow', props: { title: 'Just Like Heaven', subtitle: 'The Cure' } },
                    ],
                },
            ],
        },
    },
    // ---------------------------------------------------------------- feedback
    {
        widget: 'Adw.PreferencesDialog',
        page: 'feedback',
        root: {
            tag: 'AdwPreferencesDialog',
            props: { title: 'Preferences', open: false },
            children: [
                {
                    tag: 'AdwPreferencesPage',
                    props: { title: 'General' },
                    children: [
                        {
                            tag: 'AdwPreferencesGroup',
                            props: { title: 'Appearance' },
                            children: [{ tag: 'AdwSwitchRow', props: { title: 'Dark mode', active: true } }],
                        },
                    ],
                },
            ],
        },
    },
];

/**
 * Every gallery block that gets NO NativeScript XML template, and why.
 *
 * Kept beside the templates rather than in prose: `check-generated-website-data.mjs`
 * holds this list and the list above against the gallery's own block titles, so a
 * block can neither be silently skipped nor silently left with a stale refusal.
 *
 * The reasons fall into three kinds, and the difference matters to a reader deciding
 * whether to reach for XML at all:
 *
 *   · A property that is not a STRING and not a number — an array of options, a
 *     menu, another view. `setPropertyValue` assigns the attribute verbatim, so
 *     there is no notation in which an XML attribute could carry one.
 *   · A CHILD the widget cannot place, because it does not override
 *     `_addChildFromBuilder` and `LayoutBase`'s default drops the child into the
 *     composed widget's first cell.
 *   · Not a `View` at all, so NativeScript's Builder has nothing to instantiate.
 */
export const ADWAITA_GALLERY_NS_REFUSALS = {
    // --- a property XML cannot carry ---
    'Gtk.DropDown': 'GtkDropDown.model is a list of items; an XML attribute is a string.',
    'Adw.ComboRow': 'AdwComboRow.model is a list of items; an XML attribute is a string.',
    'Gtk.MenuButton': 'GtkMenuButton.menuModel is a portable menu model; an XML attribute is a string.',
    'Adw.SplitButton': 'AdwSplitButton.menuModel is a portable menu model; an XML attribute is a string.',
    'Adw.ToggleGroup': 'AdwToggleGroup.options is an array of toggles; an XML attribute is a string.',
    'Adw.Sidebar': 'AdwSidebar.items and .sections are arrays of item descriptors; an XML attribute is a string.',
    'Adw.TabView': 'AdwTabView.views and .tabs are arrays; an XML attribute is a string.',
    'Adw.ViewSwitcherBar': 'AdwViewSwitcherBar.stack points at another VIEW, which no attribute can name.',
    'Adw.ViewSwitcher': 'AdwViewSwitcher.views is an array of page descriptors; an XML attribute is a string.',
    'Adw.InlineViewSwitcher':
        'AdwInlineViewSwitcher.views is an array of page descriptors; an XML attribute is a string.',
    // --- not a View ---
    // The BLOCK is titled `Adw.Toast`, and the widget its NativeScript window would
    // show is `AdwToastOverlay` — which IS a View and IS in the ELEMENTS map, so
    // "not a View" was a true sentence about the wrong object.
    'Adw.Toast':
        'AdwToastOverlay takes no XML child (it overrides no _addChildFromBuilder) and a toast is raised by calling showToast(), which is not markup.',
    'Adw.AlertDialog': 'AdwAlertDialog extends Observable, not View: it has no place in a view tree.',
};
