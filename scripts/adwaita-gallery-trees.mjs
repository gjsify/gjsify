// The ONE source the Solid, Vue and React snippets in the Adwaita gallery are
// emitted from — one host element tree per gallery block, in `@gjsify/gtk-host`'s
// own vocabulary.
//
// WHY NOT THE PREVIEW MARKUP, which was the obvious candidate
//
// Each gallery block already carries `adw-*` element markup in its `preview` slot,
// and `scripts/check-vocabulary-alignment.mjs` already holds that element list
// against GTK. So the markup looks like a source that is machine-checked and free.
// It is not, and the gap is structural rather than cosmetic — MEASURED across the
// 48 preview fragments on the ten gallery pages:
//
//   · 198 elements. 114 spell a tag `gtk-host` also has; 84 do NOT — 42%.
//     15 distinct tags, led by `<adw-button>` (28 uses, GTK spells it `gtk-button`),
//     `<adw-sidebar-item>`, `<adw-view-stack-page>`, `<adw-tab-page>` and
//     `<adw-toggle>` (libadwaita GObjects that are not GtkWidgets, so they have no
//     tag in a table of concrete widgets at all), `<adw-card>` (a style class, not
//     a widget) and plain HTML `<button>`/`<div>`/`<span>`.
//   · On the 114 that DO match, 159 attribute uses map to a `gtk-host` prop and 35
//     do not. Those 35 are 12 distinct attributes, and none of them is a spelling
//     difference: `icon` vs `iconName` plus the `-symbolic` suffix (18 uses),
//     `items` vs a `Gio.ListModel`, `min`/`max`/`step` vs a `Gtk.Adjustment`,
//     `size` vs a size request, `open` vs a `present()` call.
//
// THE ELEMENT COUNTS ABOVE PREDATE the nine elements that took their GIR names
// (ADR 0034 clause 1, § Amendment 5), so the not-matching side is smaller today and
// `<adw-button>` reads `<gtk-button>` in the previews. They are left as measured
// rather than adjusted by hand: the structural argument does not turn on the size of
// the gap, and a number nothing recomputes is folklore whichever way it is edited.
//
// Translating that mechanically needs a hand-written alias table of 15 tags and 12
// attribute SEMANTICS. `WEB_ELEMENT_ALIGNMENT` in the vocabulary check is already
// the tag half of it — and its own header explains why a second one is refused:
// two parallel hand-maintained tables joined by nothing, which is the arrangement
// ADR 0029 § 4 rejects. A translation table is worse than that one, because it
// would map behaviour and not just names, and nothing could hold it.
//
// So the source is written once, HERE, in the vocabulary that actually runs, and
// `scripts/check-adwaita-gallery-trees.mjs` holds every tag, prop and placement in
// it against `gtk-host`'s generated tables and its descriptor policies.
//
// WHAT IS IN AND WHAT IS OUT
//
// A block gets a tree only when its widget can be written DECLARATIVELY and
// COMPLETELY. `refusals` below names every block that cannot, with the reason —
// because a snippet that renders a combo row without its items, or a view switcher
// with no stack, teaches something false about the port.

/**
 * @typedef {Object} TreeNode
 * @property {string} tag                            a `gtk-host` tag, e.g. 'adw-header-bar'
 * @property {string} [slot]                         placement in the parent's descriptor
 * @property {Record<string, string|number|boolean|string[]>} [props]
 * @property {TreeNode[]} [children]
 */

/**
 * @typedef {Object} GalleryTree
 * @property {string} widget   the `<AdwWidget title="…">` this belongs to
 * @property {string} page     the gallery page it sits on
 * @property {string} [note]   one line emitted above the snippet in every dialect
 * @property {TreeNode} root
 */

import { gtkHostTree } from './adwaita-gallery-shared-trees.mjs';

/** @type {readonly GalleryTree[]} */
export const ADWAITA_GALLERY_TREES = [
    // ------------------------------------------------------------- boxed-lists
    // Authored once in `adwaita-gallery-shared-trees.mjs` and rendered by both this
    // file's three dialects and the NativeScript XML beside it — ADR 0027 § 9's
    // criterion at the size that file's census reaches. The seven that carry it are
    // the blocks whose two trees needed no alias to line up; every block that still
    // needs one is in its divergence ledger with the measured reason.
    gtkHostTree('Adw.PreferencesGroup'),
    {
        widget: 'Adw.ActionRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [
                {
                    tag: 'adw-action-row',
                    props: { title: 'Wi-Fi', subtitle: 'Connected to Highgarden 5GHz', activatable: true },
                    children: [
                        { tag: 'gtk-image', slot: 'prefix', props: { iconName: 'network-wireless-symbolic' } },
                        {
                            tag: 'gtk-button',
                            slot: 'suffix',
                            props: { iconName: 'go-next-symbolic', cssClasses: ['flat'], valign: 'center' },
                        },
                    ],
                },
            ],
        },
    },
    gtkHostTree('Adw.SwitchRow'),
    gtkHostTree('Adw.EntryRow'),
    {
        widget: 'Adw.PasswordEntryRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [{ tag: 'adw-password-entry-row', props: { title: 'Password', text: 'correct-horse-battery' } }],
        },
    },
    gtkHostTree('Adw.ExpanderRow'),
    {
        widget: 'Adw.ButtonRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [
                {
                    tag: 'adw-button-row',
                    props: {
                        title: 'Add account',
                        startIconName: 'list-add-symbolic',
                        cssClasses: ['suggested-action'],
                    },
                },
            ],
        },
    },
    // ----------------------------------------------------------------- buttons
    {
        widget: 'Adw.ButtonContent',
        page: 'buttons',
        root: {
            tag: 'gtk-button',
            props: { cssClasses: ['suggested-action', 'pill'] },
            children: [
                { tag: 'adw-button-content', props: { label: 'Download', iconName: 'folder-download-symbolic' } },
            ],
        },
    },
    {
        widget: 'Gtk.Button',
        page: 'buttons',
        root: {
            tag: 'gtk-box',
            props: { orientation: 'horizontal', spacing: 12, halign: 'center' },
            children: [
                { tag: 'gtk-button', props: { label: 'Pill', cssClasses: ['pill'] } },
                { tag: 'gtk-button', props: { iconName: 'list-add-symbolic', cssClasses: ['circular'] } },
                { tag: 'gtk-button', props: { label: 'Suggested', cssClasses: ['suggested-action'] } },
                { tag: 'gtk-button', props: { label: 'Delete', cssClasses: ['destructive-action'] } },
                { tag: 'gtk-button', props: { label: 'Flat', cssClasses: ['flat'] } },
            ],
        },
    },
    {
        widget: 'Adw.SplitButton',
        page: 'buttons',
        // The menu is a PORTABLE MENU MODEL (ADR 0042) — the same value the browser and
        // NativeScript renderers take. It is why this block has a snippet at all: the
        // property's GObject type is `GMenuModel`, which has no literal spelling, and
        // the refusal that stood here said so.
        root: {
            tag: 'adw-split-button',
            props: {
                label: 'Save',
                menuModel: [
                    { label: 'Save as…', action: 'app.save-as' },
                    { label: 'Export', action: 'app.export' },
                    { label: 'Print', action: 'app.print' },
                ],
            },
        },
    },
    {
        widget: 'Gtk.MenuButton',
        page: 'buttons',
        root: {
            tag: 'gtk-menu-button',
            props: {
                iconName: 'open-menu-symbolic',
                cssClasses: ['flat'],
                menuModel: [
                    { label: 'Preferences', action: 'app.preferences' },
                    { label: 'Keyboard Shortcuts', action: 'win.show-help-overlay' },
                    { label: 'About', action: 'app.about' },
                ],
            },
        },
    },
    // ---------------------------------------------------------------- controls
    {
        widget: 'Gtk.Entry',
        page: 'controls',
        root: { tag: 'gtk-entry', props: { placeholderText: 'Search files…', widthRequest: 280 } },
    },
    // ------------------------------------------------------------------ layout
    {
        widget: 'Adw.Clamp',
        page: 'layout',
        // A refusal until #1368 landed, and the refusal probe is what said so: the
        // moment `AdwClamp` gained a `single`/`set_child` policy, `probe:refusals`
        // reported `<adw-clamp>` as ACCEPTED and failed. A stale refusal tells a
        // reader a port cannot do something it now can.
        root: {
            tag: 'adw-clamp',
            props: { maximumSize: 400, tighteningThreshold: 300 },
            children: [
                {
                    tag: 'gtk-label',
                    props: {
                        label: 'This content is clamped: it stops growing past the maximum size and stays centred.',
                        wrap: true,
                        xalign: 0,
                        cssClasses: ['card'],
                    },
                },
            ],
        },
    },
    {
        widget: 'Adw.HeaderBar',
        page: 'layout',
        root: {
            tag: 'adw-header-bar',
            children: [
                {
                    tag: 'gtk-button',
                    slot: 'start',
                    props: { iconName: 'go-previous-symbolic', cssClasses: ['flat'] },
                },
                { tag: 'adw-window-title', slot: 'title', props: { title: 'Text Editor', subtitle: 'notes.md' } },
                {
                    tag: 'gtk-menu-button',
                    slot: 'end',
                    props: { iconName: 'open-menu-symbolic', cssClasses: ['flat'] },
                },
            ],
        },
    },
    {
        widget: 'Adw.ToolbarView',
        page: 'layout',
        // The bottom bar is a `<gtk-box cssClasses={['toolbar']}>` and not a
        // `Gtk.ActionBar`, which is what the Blueprint and GJS tabs use: `gtk-host`
        // has no child policy for `GtkActionBar`, so a child inside one is refused
        // by name with `uncurated-placement`. Measured, not assumed.
        root: {
            tag: 'adw-toolbar-view',
            children: [
                {
                    tag: 'adw-header-bar',
                    slot: 'top',
                    children: [
                        {
                            tag: 'adw-window-title',
                            slot: 'title',
                            props: { title: 'Documents', subtitle: '12 items' },
                        },
                    ],
                },
                {
                    tag: 'adw-status-page',
                    slot: 'content',
                    props: {
                        iconName: 'folder-documents-symbolic',
                        title: 'Your library',
                        description: 'Content sits between the toolbars and scrolls independently of them.',
                    },
                },
                {
                    tag: 'gtk-box',
                    slot: 'bottom',
                    props: { cssClasses: ['toolbar'], spacing: 6 },
                    children: [
                        { tag: 'gtk-button', props: { iconName: 'list-add-symbolic', cssClasses: ['flat'] } },
                        { tag: 'gtk-button', props: { iconName: 'list-remove-symbolic', cssClasses: ['flat'] } },
                        { tag: 'gtk-label', props: { label: 'Selection: none', hexpand: true } },
                        { tag: 'gtk-button', props: { iconName: 'send-to-symbolic', cssClasses: ['flat'] } },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.WrapBox',
        page: 'layout',
        // A REFUSAL UNTIL THIS BRANCH. `adw-wrap-box` was a generated tag with no
        // curated placement rule, so every child was an `uncurated-placement` — for a
        // container whose entire purpose is holding children. The policy is now in
        // `descriptors/adw.ts`, so the block gets the tree it always could have had.
        //
        // The eight chips are the block's own preview, so the four tabs on the page
        // read as one widget written four ways rather than as four examples.
        root: {
            tag: 'adw-wrap-box',
            props: { childSpacing: 8, lineSpacing: 8 },
            children: ['Design', 'Adwaita', 'GNOME', 'GTK', 'TypeScript', 'Storybook', 'Wrapping', 'Layout'].map(
                (label) => ({ tag: 'gtk-button', props: { label, cssClasses: ['pill'] } }),
            ),
        },
    },
    // -------------------------------------------------------------- navigation
    {
        widget: 'Adw.OverlaySplitView',
        page: 'navigation',
        // Curated by #1368 as two setter-backed slots; measured accepted by
        // `probe:refusals`, which had been claiming the opposite.
        root: {
            tag: 'adw-overlay-split-view',
            props: { showSidebar: true },
            children: [
                {
                    tag: 'adw-toolbar-view',
                    slot: 'sidebar',
                    children: [
                        {
                            tag: 'adw-header-bar',
                            slot: 'top',
                            children: [{ tag: 'adw-window-title', slot: 'title', props: { title: 'Library' } }],
                        },
                        {
                            tag: 'adw-status-page',
                            slot: 'content',
                            props: { iconName: 'folder-music-symbolic', title: 'Sections' },
                        },
                    ],
                },
                {
                    tag: 'adw-toolbar-view',
                    slot: 'content',
                    children: [
                        {
                            tag: 'adw-header-bar',
                            slot: 'top',
                            children: [{ tag: 'adw-window-title', slot: 'title', props: { title: 'Your Library' } }],
                        },
                        {
                            tag: 'adw-status-page',
                            slot: 'content',
                            props: {
                                iconName: 'folder-music-symbolic',
                                title: 'Your Library',
                                description: 'Toggle the sidebar to browse sections.',
                            },
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.NavigationSplitView',
        page: 'navigation',
        // The same two slots as the overlay sibling, and ONE difference that only a
        // run finds: GTK refuses anything but an `Adw.NavigationPage` in them.
        // `probe:refusals` reported `rejected-child` — not `uncurated-placement` —
        // for a bare `<adw-toolbar-view>`, which is the host saying "the container
        // is curated, the CHILD TYPE is wrong". Hence the pages below.
        root: {
            tag: 'adw-navigation-split-view',
            props: { showContent: true },
            children: [
                {
                    tag: 'adw-navigation-page',
                    slot: 'sidebar',
                    props: { tag: 'sidebar', title: 'Mailboxes' },
                    children: [
                        {
                            tag: 'adw-toolbar-view',
                            children: [
                                {
                                    tag: 'adw-header-bar',
                                    slot: 'top',
                                    children: [
                                        { tag: 'adw-window-title', slot: 'title', props: { title: 'Mailboxes' } },
                                    ],
                                },
                                {
                                    tag: 'adw-status-page',
                                    slot: 'content',
                                    props: { iconName: 'mail-unread-symbolic', title: 'Mailboxes' },
                                },
                            ],
                        },
                    ],
                },
                {
                    tag: 'adw-navigation-page',
                    slot: 'content',
                    props: { tag: 'content', title: 'All Mail' },
                    children: [
                        {
                            tag: 'adw-toolbar-view',
                            children: [
                                {
                                    tag: 'adw-header-bar',
                                    slot: 'top',
                                    children: [
                                        { tag: 'adw-window-title', slot: 'title', props: { title: 'All Mail' } },
                                    ],
                                },
                                {
                                    tag: 'adw-status-page',
                                    slot: 'content',
                                    props: {
                                        iconName: 'mail-unread-symbolic',
                                        title: 'All Mail',
                                        description: 'Select a conversation from the list to read it here.',
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.NavigationView',
        page: 'navigation',
        root: {
            tag: 'adw-navigation-view',
            children: [
                {
                    tag: 'adw-navigation-page',
                    props: { tag: 'root', title: 'Contacts' },
                    children: [
                        {
                            tag: 'adw-toolbar-view',
                            children: [
                                {
                                    tag: 'adw-header-bar',
                                    slot: 'top',
                                    children: [
                                        { tag: 'adw-window-title', slot: 'title', props: { title: 'Contacts' } },
                                    ],
                                },
                                {
                                    tag: 'adw-status-page',
                                    slot: 'content',
                                    props: { title: 'Contacts', description: 'Push a page to see the transition.' },
                                },
                            ],
                        },
                    ],
                },
                {
                    tag: 'adw-navigation-page',
                    props: { tag: 'detail', title: 'Ada Lovelace' },
                    children: [
                        {
                            tag: 'adw-toolbar-view',
                            children: [
                                {
                                    tag: 'adw-header-bar',
                                    slot: 'top',
                                    children: [
                                        { tag: 'adw-window-title', slot: 'title', props: { title: 'Ada Lovelace' } },
                                    ],
                                },
                                {
                                    tag: 'adw-status-page',
                                    slot: 'content',
                                    props: {
                                        iconName: 'avatar-default-symbolic',
                                        title: 'Ada Lovelace',
                                        description: 'Mathematician and writer, the first computer programmer.',
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // ------------------------------------------------------------ presentation
    {
        widget: 'Adw.Avatar',
        page: 'presentation',
        root: {
            tag: 'adw-avatar',
            props: { text: 'Ada Lovelace', size: 96, showInitials: true, iconName: 'avatar-default-symbolic' },
        },
    },
    gtkHostTree('Adw.Banner'),
    gtkHostTree('Adw.ShortcutLabel'),
    {
        widget: 'Adw.Spinner',
        page: 'presentation',
        // `size` on the web element is a size REQUEST on GTK — `Adw.Spinner` has no
        // size property of its own, it fills what it is given.
        root: { tag: 'adw-spinner', props: { widthRequest: 48, heightRequest: 48 } },
    },
    {
        widget: 'Adw.StatusPage',
        page: 'presentation',
        root: {
            tag: 'adw-status-page',
            props: {
                iconName: 'folder-symbolic',
                title: 'No Documents',
                description: 'Documents you create or open will appear here.',
            },
            children: [
                {
                    tag: 'gtk-button',
                    props: { label: 'New Document', cssClasses: ['pill', 'suggested-action'], halign: 'center' },
                },
            ],
        },
    },
    gtkHostTree('Adw.WindowTitle'),
];

/**
 * Every gallery block that gets NO framework snippet, and why.
 *
 * Kept beside the trees rather than in prose: `check-adwaita-gallery-trees.mjs`
 * holds this list and the list above against the gallery's own block titles, so a
 * block can neither be silently skipped nor silently left with a stale refusal.
 *
 * `uncurated-placement` is `gtk-host`'s own refusal, raised by name when a child is
 * placed into a widget whose descriptor declares no child policy. It is a property
 * of the descriptor table on `main`, not of the widget, and it moves when the table
 * does.
 */
export const ADWAITA_GALLERY_REFUSALS = {
    // Measured by `showcases/gtk/adwaita-gallery-solid/src/refusals.ts`: the host
    // raises `uncurated-placement` BY NAME when the child is materialised — for
    // every entry in this group, and the probe fails if any starts being accepted.
    // NOT counted here any more: this note read "Nine of them", and a widget leaves
    // this group the day its descriptor is curated, which is the second time a
    // hand-kept number beside this list went stale. The list is the count.
    //
    // COUNT THE GROUP, not the probe. This note read "13 of 13", and the probe has
    // driven ELEVEN placements since it landed in #1376 — never thirteen. Two of the
    // eleven are not entries here at all: a split view that raises `rejected-child`
    // rather than `uncurated-placement`, and a `gtk-action-bar` that is no gallery
    // block. Thirteen is the count from before two placements turned out to be
    // ACCEPTED and left the list, restated beside a list that was already shorter —
    // a number kept by hand next to the thing it counts.
    //
    // THE ARM THIS NOTE ASKED FOR EXISTS: arm 5b of
    // `check-generated-website-data.mjs` holds the two lists against each other in
    // both directions — an `uncurated-placement` entry whose GType has acquired a
    // curated descriptor under `packages/framework/gtk-host/src/descriptors/` fails,
    // and so does an entry no placement probes, a probed parent that is neither an
    // entry here nor ledgered in the probe, and a ledgered parent nothing probes. It
    // is what caught `Adw.WrapBox` the moment its descriptor landed, before the
    // gallery could ship a refusal that had stopped being true.
    'Adw.PreferencesDialog': 'uncurated-placement: a page cannot be a child of AdwPreferencesDialog.',
    'Adw.BottomSheet': 'uncurated-placement: no child policy for the sheet or the content.',
    'Adw.Carousel': 'uncurated-placement: AdwCarousel has no child policy.',
    'Adw.Sidebar': 'uncurated-placement — and its items are AdwSidebarItem GObjects, which have no tag either.',
    'Adw.TabView': 'uncurated-placement — and its pages are AdwTabPage GObjects, which have no tag either.',
    'Adw.ToggleGroup': 'uncurated-placement — and its toggles are AdwToggle GObjects, which have no tag either.',
    'Adw.ViewSwitcher':
        'uncurated-placement — and its `stack` is a widget REFERENCE, where the three dialects diverge.',
    // The rest are not placement refusals: the widget cannot be written as a static
    // tree at all, in any dialect.
    'Adw.Toast': 'AdwToast is a GObject, not a GtkWidget: it has no tag in a table of concrete widgets.',
    'Adw.AlertDialog': 'its responses are add_response() calls and it is shown with present(); neither is markup.',
    'Adw.AboutDialog': 'a dialog is opened with present(), so a static tree renders nothing a reader would see.',
    'Adw.ViewSwitcherBar': 'its `stack` is a widget reference, and a ref is spelled differently in all three dialects.',
    'Adw.InlineViewSwitcher':
        'its `stack` is a widget reference, and a ref is spelled differently in all three dialects.',
    'Adw.ComboRow':
        'its model is a Gio.ListModel, and nothing turns the portable list form into one at the ParamSpec seam.',
    'Adw.SpinRow': 'its range is a Gtk.Adjustment, a GObject that is not a widget.',
    // `Adw.SplitButton` and `Gtk.MenuButton` USED TO BE HERE — "its menu is a
    // Gio.MenuModel, built imperatively". ADR 0042 gave that model a portable value
    // form and `coerce` turns one into a real `Gio.Menu` at the ParamSpec seam, so both
    // blocks are trees above.
    //
    // THE TWO LIST BLOCKS STAY, AND HALF THE REASON IS GONE. ADR 0046 gave the list its
    // portable value form too — `AdwListModelInput`, the same one three renderers already
    // took — so what is missing is no longer a VALUE but the seam: `coerce` has no branch
    // turning a plain array into a `Gtk.StringList` the way it turns one into a `Gio.Menu`.
    // That branch is a `@gjsify/gtk-host` change and is tracked in `status/open-todos.md`
    // under "A portable list model reaches every renderer except GTK".
    'Gtk.DropDown':
        'its model is a Gtk.StringList, and nothing turns the portable list form into one at the ParamSpec seam.',
};
