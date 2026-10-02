// The ONE source the NativeScript XML template in every Adwaita gallery block is
// emitted from — one view tree per block, in `@gjsify/adwaita-nativescript`'s own
// element names.
//
// WHY A SECOND SOURCE, AND NOT A TRANSLATION OF `adwaita-gallery-trees.mjs`
//
// The Solid/Vue/React trees beside this file are written in `@gjsify/gtk-host`'s
// vocabulary, and that vocabulary is GTK's: `gtk-label`, `gtk-button`, `cssClasses`,
// `iconName`. NativeScript's is a different widget set on a different toolkit —
// `GtkButton`, `styleClasses`, an `iconName` that is an SVG SOURCE rather than a name.
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
            tag: 'GtkBox',
            props: { orientation: 'horizontal', spacing: 12 },
            children: [
                { tag: 'GtkButton', props: { label: 'Pill', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'Suggested', styleClasses: 'suggested-action' } },
                { tag: 'GtkButton', props: { label: 'Delete', styleClasses: 'destructive-action' } },
                { tag: 'GtkButton', props: { label: 'Flat', styleClasses: 'flat' } },
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
                    tag: 'GtkLabel',
                    props: {
                        styleClasses: 'card',
                        wrap: true,
                        label: 'This content is clamped: it stops growing past the maximum size and stays centred.',
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
                { tag: 'GtkButton', slot: 'startBox', props: { label: '‹', styleClasses: 'flat' } },
                {
                    tag: 'AdwWindowTitle',
                    slot: 'titleWidget',
                    props: { title: 'Text Editor', subtitle: 'notes.md' },
                },
                { tag: 'GtkButton', slot: 'endBox', props: { label: '≡', styleClasses: 'flat' } },
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
                { tag: 'GtkButton', props: { label: 'Design', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'Adwaita', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'GNOME', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'GTK', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'TypeScript', styleClasses: 'pill' } },
                { tag: 'GtkButton', props: { label: 'Storybook', styleClasses: 'pill' } },
            ],
        },
    },
    // ------------------------------------------------------------ presentation
    {
        widget: 'Adw.Avatar',
        page: 'presentation',
        // `showInitials` and not `iconName`: the icon property is an SVG SOURCE (the
        // same reason `AdwStatusPage` below reaches for `iconText`), and an unset one
        // already falls back to the Adwaita person glyph — so the attribute worth
        // showing is the one that CHOOSES between the two, which is a boolean and
        // carries through XML.
        root: { tag: 'AdwAvatar', props: { text: 'Ada Lovelace', size: 96, showInitials: true } },
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
        // The carousel draws no indicator, as upstream: the dots are their own widget, bound
        // by id, which the indicator resolves once the loaded tree holds the carousel.
        root: {
            tag: 'GtkBox',
            props: { orientation: 'vertical' },
            children: [
                {
                    tag: 'AdwCarousel',
                    id: 'carousel',
                    children: [
                        { tag: 'AdwStatusPage', props: { iconText: '\u2460', title: 'Welcome' } },
                        { tag: 'AdwStatusPage', props: { iconText: '\u2461', title: 'Sync' } },
                        { tag: 'AdwStatusPage', props: { iconText: '\u2462', title: 'Done' } },
                    ],
                },
                { tag: 'AdwCarouselIndicatorDots', props: { carousel: 'carousel' } },
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
    'Gtk.PopoverMenu':
        'The NativeScript port builds its menus through GtkMenuButton.menuModel, a portable menu model; ' +
        'an XML attribute is a string, and there is no view for the menu on its own ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.PopoverMenuBar':
        'The NativeScript port has no menu-bar view: GtkMenuButton.menuModel is its only menu-carrying ' +
        'widget, and it opens ONE menu from a button rather than a bar of them ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.PopoverBin':
        'The NativeScript port has no popover container: GtkBox.addChild appends a child eagerly and ' +
        'nothing in it owns a popup, so there is nothing for a second property to attach ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.Popover':
        'The NativeScript port has no standalone popover surface: GtkMenuButton.menuModel builds the menu a ' +
        "popover would show, but the port has no view that takes arbitrary content as a popup's child " +
        '(status/open-todos/adwaita-ports.md).',
    'Adw.SplitButton': 'AdwSplitButton.menuModel is a portable menu model; an XML attribute is a string.',
    'Adw.ToggleGroup': 'AdwToggleGroup.options is an array of toggles; an XML attribute is a string.',
    'Adw.Sidebar': 'AdwSidebar.items and .sections are arrays of item descriptors; an XML attribute is a string.',
    // The adaptive trio. A layout upstream is a GObject rather than a view, so an XML
    // template has nothing to name for one, and every child of a multi-layout view is
    // paired with a slot by a method call rather than by a placement.
    'Adw.BreakpointBin':
        'The port has no breakpoint-bin view, so its breakpoints have nowhere to live: AdwNavigationSplitView carries ONE condition on an attribute and a list of them is not markup (status/open-todos/adwaita-ports.md).',
    'Adw.MultiLayoutView':
        'The port has no multi-layout view, and what it would hold is not a view either: a layout is a GObject upstream, and AdwNavigationSplitView is ONE arrangement rather than a set of them.',
    'Adw.LayoutSlot':
        'The port has no layout-slot view, and nothing in it takes a child by ID: AdwNavigationSplitView has named panes, and a hole a layout fills is not one of them.',
    'Adw.TabView': 'AdwTabView.views and .tabs are arrays; an XML attribute is a string.',
    'Adw.ViewSwitcherBar':
        'AdwViewStack takes its titled pages as AdwViewStackPage records, which are not views and not in the widgets barrel these templates are written against.',
    'Adw.ViewSwitcher': 'AdwViewSwitcher.views is an array of page descriptors; an XML attribute is a string.',
    'Adw.InlineViewSwitcher':
        'AdwInlineViewSwitcher.views is an array of page descriptors; an XML attribute is a string.',
    // --- no such widget in the port ---
    'Gtk.Scale':
        'The NativeScript port has no standalone scale yet: AdwSliderRow is the boxed-list row, and it renders the @nativescript/core Slider inside that row rather than the widget Gtk.Scale is (status/open-todos/adwaita-ports.md).',
    'Gtk.SpinButton':
        'The NativeScript port has no standalone spin button yet: AdwSpinRow is the boxed-list row, and it composes Label and StackLayout itself instead (status/open-todos/adwaita-ports.md).',
    'Gtk.PasswordEntry':
        'The NativeScript port has no password entry yet: GtkEntry is the plain field and AdwPasswordEntryRow is its boxed-list row, and neither is the widget Gtk.PasswordEntry is (status/open-todos/adwaita-ports.md).',
    'Gtk.SearchEntry':
        'The NativeScript port has no search entry yet: GtkEntry has no leading search icon, no clear button and no search-changed signal to hang them on (status/open-todos/adwaita-ports.md).',
    'Gtk.ListView':
        'The NativeScript port has no list view: GtkBox.addChild appends every child eagerly, and the ' +
        'per-item factory that would replace it has no counterpart there yet (status/open-todos/adwaita-ports.md).',
    'Gtk.GridView':
        'The NativeScript port has no grid view: GtkBox.addChild appends every child eagerly and lays them out ' +
        'in one direction, with no column count to reflow (status/open-todos/adwaita-ports.md).',
    'Gtk.ColumnView':
        'The NativeScript port has no column view: AdwDataGrid.columns is the nearest thing and takes rows of ' +
        'pre-formatted values, not a factory per column (status/open-todos/adwaita-ports.md).',
    'Gtk.TreeExpander':
        'The NativeScript port has no tree expander, and GtkDropDown.model is its only list-model widget: a ' +
        'flat one, with no depth for an expander to indent (status/open-todos/adwaita-ports.md).',
    'Gtk.Notebook':
        "The NativeScript port has no notebook: @nativescript/core's TabView (ui/tab-view) owns its own tab " +
        'strip, which is exactly what Gtk.Notebook IS, and it has no separate content-only stack to hold its ' +
        "pages — the port's content-only half is AdwViewStack, and a TabView cannot be pointed at one " +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.StackSidebar':
        'The NativeScript port has no bare sidebar list either: AdwTabView draws the strip itself, and ' +
        'AdwNavigationSplitView (sidebarWidth, isSidebarCollapsed) is the one place the port has a sidebar at ' +
        'all — it navigates, so it cannot be pointed at the AdwViewStack the port does have ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.StackSwitcher':
        'The NativeScript port has no bare switcher: AdwTabView is the widget that draws a tab strip, and its ' +
        'selectedIndex is the only knob it exposes — so the orientation the widget itself carries has no counterpart ' +
        'there, and there is no content-only strip to point at the AdwViewStack the port does have ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.Stack':
        'The NativeScript port has no content-only stack: AdwTabView is the widget it has, and its tab strip ' +
        'lives inside it (AdwTabView.pages), so there is no separate switcher to point at the content. The ' +
        'content-only half the port does have is AdwViewStack, whose add() takes a view and a name — and its ' +
        'own header records that its visibility switch is "instant, no cross-fade", so neither of the two ' +
        '*homogeneous axes nor the transition vocabulary has anything to land on ' +
        '(status/open-todos/adwaita-ports.md).',
    'Gtk.EditableLabel':
        'The NativeScript port has no editable label: GtkLabel carries the text and GtkEntry is the only editable surface it has, and the swap between the two is the widget (status/open-todos/adwaita-ports.md).',
    'Gtk.SearchBar':
        'The NativeScript port has no search bar: GtkBox lays its children out unconditionally and GtkEntry has no way to be revealed, so there is no strip to put one in (status/open-todos/adwaita-ports.md).',
    // The five GTK layout containers. `Gtk.Fixed` is the one the platform would cover
    // outright — `AbsoluteLayout` IS it — but the port has no view that takes a position
    // from an XML attribute, and the block is about the widget rather than about the
    // platform (status/open-todos/adwaita-ports.md).
    'Gtk.AspectFrame':
        "The NativeScript port has no aspect frame to shape a child with: GtkBox lays its children out in a StackLayout, and nothing there turns one child's size into a ratio (status/open-todos/adwaita-ports.md).",
    'Gtk.CenterBox':
        'The NativeScript port has no centre box to pin a start, a centre and an end child into: GtkBox has one layout and one child order, which is a different fact (status/open-todos/adwaita-ports.md).',
    'Gtk.Fixed':
        'The NativeScript port has no fixed view to place a child at an offset: GtkBox stacks its children rather than positioning them (status/open-todos/adwaita-ports.md).',
    'Gtk.Frame':
        'The NativeScript port has no frame view to draw a border and a title in around a child, and GtkBox is a plain stack the theme has nothing to frame (status/open-todos/adwaita-ports.md).',
    'Gtk.Grid':
        'The NativeScript port has no grid widget: GtkBox is a StackLayout and NativeScript has no subgrid, so every row would resolve its own auto tracks and stagger the columns (theme/adwaita.css:864-868).',
    'Gtk.Separator':
        'The NativeScript port has no separator view to put between the children of a GtkBox yet (status/open-todos/adwaita-ports.md).',
    'Gtk.Text':
        'The NativeScript port has no standalone text node: GtkEntry is the single-line field such a node would be the delegate of, and GtkLabel is its read-only twin (status/open-todos/adwaita-ports.md).',
    'Gtk.TextView':
        'The NativeScript port has no multi-line editor: GtkEntry is single-line by construction and @nativescript/core has no view the port themes as one (status/open-todos/adwaita-ports.md).',
    'Gtk.ToggleButton':
        'The NativeScript port has no toggle button yet: GtkButton has no checked state to build one on (status/open-todos/adwaita-ports.md).',
    'Gtk.DrawingArea':
        'The NativeScript port has no drawing surface: GtkBox is the container one would sit in and it has no child that paints, so a drawing area there would be an empty box with a size request (status/open-todos/adwaita-ports.md).',
    'Gtk.GraphicsOffload':
        'The NativeScript port has no compositor passthrough to wrap anything in: a video or a web view sits in a GtkBox cell and is composited like every other view, so the wrapper would be a plain container with no property of its own to set (status/open-todos/adwaita-ports.md).',
    'Gtk.GLArea':
        'The NativeScript port has no GL view, so there is nothing to render into and no context to keep current: GtkBox would hold a plain View instead, and a View has no render signal for GtkBox to forward (status/open-todos/adwaita-ports.md).',
    'Gtk.DragIcon':
        'A drag icon is not a widget an application builds — it belongs to a drag operation and dies with it — and @nativescript/core has no drag gesture to attach one to. The port has the pieces a dragged row would show and nothing that starts the drag: GtkLabel.set_markup is the whole of the label side and GtkBox.addChild the whole of the container, so an icon here would be a child nothing ever shows (status/open-todos/adwaita-ports.md).',
    'Gtk.Overlay':
        'The NativeScript port has no overlay view: GtkBox appends every child to the layout, and there is nothing in it to stack one over another (status/open-todos/adwaita-ports.md).',
    'Gtk.Revealer':
        'The NativeScript port has no revealer view: GtkBox has no transition to run between a collapsed and an expanded child (status/open-todos/adwaita-ports.md).',
    'Gtk.Paned':
        'The NativeScript port has no paned view: GtkBox has no divider to place between two children, and so no second slot to take (status/open-todos/adwaita-ports.md).',
    'Gtk.Expander':
        'The NativeScript port has no bare expander view: AdwExpanderRow is the disclosure it does have, and this is the Gtk one with no boxed-list row around it (status/open-todos/adwaita-ports.md).',
    'Gtk.CheckButton':
        'The NativeScript port has no checkbox view: GtkBox is the container one would sit in and @nativescript/core ships nothing under its ui/ to put in it. The boolean idiom the port does have is AdwSwitchRow (status/open-todos/adwaita-ports.md).',
    'Gtk.Switch':
        'The NativeScript port composes the platform Switch inside AdwSwitchRow and has no standalone one; a NativeScript Switch is one boolean, while the GTK widget also carries the backend half behind a state-set signal (status/open-todos/adwaita-ports.md).',
    'Gtk.ProgressBar':
        "The NativeScript port has no progress widget: the nearest thing it builds is AdwSpinRow, which is a titled row with a stepper and not a bar, and the theme's CSS subset has no trough to nest anything in (status/open-todos/adwaita-ports.md).",
    'Gtk.LevelBar':
        'The NativeScript port has no segmented-bar view: AdwSpinner is the only indicator it has and it takes no value, and GtkBox offers no run of equal children to divide into segments (status/open-todos/adwaita-ports.md).',
    'Gtk.Spinner':
        'The NativeScript port ships AdwSpinner for the libadwaita spinner and has no view for the GTK one; AdwSpinner is the whole picture there, and the reduced-motion icon swap GTK does has no counterpart (status/open-todos/adwaita-ports.md).',
    // Four more the port has no view for, each with the NEIGHBOUR class the reason names —
    // `GtkButton` and `GtkBox` ship, so the sentences stay checkable against real members.
    'Gtk.LinkButton':
        'The port has no link button: GtkButton takes a label and an iconName and nothing that follows a uri, so neither the destination nor the visited state it draws has anywhere to live (status/open-todos/adwaita-ports.md).',
    'Gtk.ScaleButton':
        'The port has no scale button: GtkButton.child takes one view, and the value a scale button draws on its icon has no slider behind it (status/open-todos/adwaita-ports.md).',
    'Gtk.ColorDialogButton':
        'The port has no colour dialog button: GtkButton.child takes one view and @nativescript/core exports no colour-picker view, so the swatch it would host has nothing to collect the next colour from (status/open-todos/adwaita-ports.md).',
    'Gtk.FontDialogButton':
        'The port has no font dialog button: GtkButton.child takes a view but there is no font-picker view in @nativescript/core, so the two GtkLabel children the font_desc names cannot be filled from a chooser (status/open-todos/adwaita-ports.md).',
    'Adw.Bin':
        'The NativeScript port has no bin view: AdwClamp is the nearest one-child view it ships, and there is no plain one-child container beside it (status/open-todos/adwaita-ports.md).',
    'Adw.ClampScrollable':
        'The NativeScript port has no scrolling clamp: AdwClamp holds its child at a width but does not scroll it (status/open-todos/adwaita-ports.md).',
    'Adw.PreferencesRow':
        'The NativeScript port has no bare preferences row: AdwActionRow is the row it ships, and a title-only base has no template of its own (status/open-todos/adwaita-ports.md).',
    'Adw.TabButton':
        'The NativeScript port has no tab button: AdwTabView is the only tab widget it ships, and its page counter is not a separate view (status/open-todos/adwaita-ports.md).',
    'Adw.ViewSwitcherSidebar':
        "The NativeScript port has no view-switcher sidebar: it ships AdwViewStack but not an AdwSidebar to drive from it, and nothing binds a stack's page list into one (status/open-todos/adwaita-ports.md).",
    'Adw.TabOverview':
        'The NativeScript port has no tab overview: AdwTabView is the only tab widget it ships, and there is no view to stack a thumbnail grid over it with (status/open-todos/adwaita-ports.md).',
    // --- the gtk/windows page: three bars and two windows, none of them a View ---
    'Gtk.ActionBar':
        'The port HAS GtkActionBar, and GtkActionBar.pack_start is what a template would route a child ' +
        'through — but the gallery block shows the three packed widgets that make a bar a bar, and ' +
        'GtkBox.addChild appends every child into ONE layout, so an XML template could only show an empty ' +
        'bar (status/open-todos/adwaita-ports.md).',
    'Gtk.HeaderBar':
        'The port has no titlebar widget: AdwHeaderBar.pack_start puts a button in a side box, and the ' +
        'GTK centre is a plain derived GtkLabel the markup cannot spell, so a template could only show a ' +
        'bar with no title (status/open-todos/adwaita-ports.md).',
    'Gtk.WindowControls':
        'The port has no window-frame buttons at all, and GtkBox.addChild is the nearest container it could ' +
        'hold them in — there is nothing behind it that reads a decoration layout, which is where every one ' +
        'of those buttons comes from (status/open-todos/adwaita-ports.md).',
    'Gtk.Window':
        "NativeScript's Page IS the window, so there is no window view to inflate: GtkBox.addChild is the " +
        'content surface, and the frame properties the block documents — deletable, resizable, maximized, ' +
        'decorated — have no counterpart on a Page (status/open-todos/adwaita-ports.md).',
    'Gtk.ApplicationWindow':
        "NativeScript's Page IS the window, and its menubar would be a Gio.MenuModel on the application, " +
        'which GtkBox.addChild cannot take and no XML attribute carries (status/open-todos/adwaita-ports.md).',
    'Adw.Dialog':
        'The NativeScript port has no generic dialog: the three it ships are AdwAlertDialog, AdwAboutDialog and AdwPreferencesDialog, and each substitutes the platform\'s own sheet rather than an in-app card ("There is NO custom in-app modal here", adw-alert-dialog.ts). A content-agnostic dialog has no platform sheet to be, and AdwBottomSheet is the only in-app surface the port has (status/open-todos/adwaita-ports.md).',
    'Adw.ShortcutsDialog':
        'The port has no shortcuts dialog and nothing to build one from: AdwShortcutLabel is its whole shortcut surface, and that is ONE keycap rather than a list of rows, so there is no section and no item class to add. The generic-dialog refusal beside it applies for the same reason — a phone has no keyboard to list (status/open-todos/adwaita-ports.md).',
    // --- not a View ---
    // --- the scrolling trio: one root, and the two halves it is made of ---
    'Gtk.ScrolledWindow':
        'The NativeScript port has no scrolling container yet: GtkBox lays its children out and nothing else, so there is no view whose children a GtkBox could stand in for (status/open-todos/adwaita-ports.md).',
    'Gtk.Scrollbar':
        'The NativeScript port has no scrollbar view, and AdwSliderRow is a slider row rather than one — its adjustment belongs to a row, not to a movable thumb (status/open-todos/adwaita-ports.md).',
    'Gtk.Viewport':
        'The NativeScript port has no viewport view to clip a GtkBox against a window, and the scrolling container it would live in is absent too (status/open-todos/adwaita-ports.md).',
    'Gtk.WindowHandle':
        'The NativeScript port has no titlebar handle: AdwHeaderBar draws the strip but nothing can move the window from it, which is the whole of the widget (status/open-todos/adwaita-ports.md).',
    // --- not a View ---
    // The BLOCK is titled `Adw.Toast`, and the widget its NativeScript window would
    // show is `AdwToastOverlay` — which IS a View and IS in the ELEMENTS map, so
    // "not a View" was a true sentence about the wrong object.
    'Adw.Toast':
        'AdwToastOverlay takes no XML child (it overrides no _addChildFromBuilder) and a toast is raised by calling showToast(), which is not markup.',
    'Adw.AlertDialog': 'AdwAlertDialog extends Observable, not View: it has no place in a view tree.',
    // --- the GTK dialogs: the port has no such widget, and the members below are the ones a
    // port of each would have to reach for ---
    'Gtk.AboutDialog':
        "The NativeScript port has no such dialog: AdwAboutDialog is the about dialog it ships, and it takes applicationName and version and nothing else — GTK's credits grid, stack switcher and licence page have no member to land in (status/open-todos/adwaita-ports.md).",
    'Gtk.EmojiChooser':
        'The NativeScript port has no emoji chooser and no popover to host one: AdwComboRow opens the platform action() sheet instead, and @nativescript/core ships no emoji set to fill a grid with (status/open-todos/adwaita-ports.md).',
    'Gtk.PageSetupUnixDialog':
        'The NativeScript port has no page setup dialog: AdwPreferencesDialog is its only page surface, and GtkBox has no page-setup model to read a paper size or four margins from (status/open-todos/adwaita-ports.md).',
    'Gtk.PrintUnixDialog':
        'The NativeScript port has no print dialog: AdwPreferencesDialog has no printer list and no capabilities, and @nativescript/core ships nothing that talks to a print backend (status/open-todos/adwaita-ports.md).',
};
