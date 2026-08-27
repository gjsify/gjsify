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

/** @type {readonly GalleryTree[]} */
export const ADWAITA_GALLERY_TREES = [
    // ------------------------------------------------------------- boxed-lists
    {
        widget: 'Adw.PreferencesGroup',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            props: { title: 'Account', description: 'Manage how this device signs in and syncs.' },
            children: [
                { tag: 'adw-entry-row', props: { title: 'Display name', text: 'Grace Hopper' } },
                {
                    tag: 'adw-switch-row',
                    props: {
                        title: 'Sync over Wi-Fi only',
                        subtitle: 'Avoid using mobile data for backups',
                        active: true,
                    },
                },
            ],
        },
    },
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
    {
        widget: 'Adw.SwitchRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [
                {
                    tag: 'adw-switch-row',
                    props: {
                        title: 'Automatic updates',
                        subtitle: 'Download and install updates without asking',
                        active: true,
                    },
                },
            ],
        },
    },
    {
        widget: 'Adw.EntryRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [{ tag: 'adw-entry-row', props: { title: 'Display name', text: 'Ada Lovelace' } }],
        },
    },
    {
        widget: 'Adw.PasswordEntryRow',
        page: 'boxed-lists',
        root: {
            tag: 'adw-preferences-group',
            children: [{ tag: 'adw-password-entry-row', props: { title: 'Password', text: 'correct-horse-battery' } }],
        },
    },
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
    // ---------------------------------------------------------------- controls
    {
        widget: 'Gtk.Entry',
        page: 'controls',
        root: { tag: 'gtk-entry', props: { placeholderText: 'Search files…', widthRequest: 280 } },
    },
    // ------------------------------------------------------------------ layout
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
    // -------------------------------------------------------------- navigation
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
    {
        widget: 'Adw.Banner',
        page: 'presentation',
        root: {
            tag: 'adw-banner',
            props: { title: 'Metered connection: updates paused', buttonLabel: 'Resume', revealed: true },
        },
    },
    {
        widget: 'Adw.ShortcutLabel',
        page: 'presentation',
        root: { tag: 'adw-shortcut-label', props: { accelerator: '<Control>C' } },
    },
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
    {
        widget: 'Adw.WindowTitle',
        page: 'presentation',
        root: { tag: 'adw-window-title', props: { title: 'Inbox', subtitle: '3 unread messages' } },
    },
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
    // raises `uncurated-placement` BY NAME when the child is materialised. 13 of 13,
    // and the probe fails if any of them starts being accepted.
    'Adw.Clamp': 'uncurated-placement, naming AdwClamp. PR #1368 curates it; nothing here depends on that.',
    'Adw.WrapBox': 'uncurated-placement: AdwWrapBox has no child policy.',
    'Adw.PreferencesDialog': 'uncurated-placement: a page cannot be a child of AdwPreferencesDialog.',
    'Adw.NavigationSplitView': 'uncurated-placement: neither pane can be a child.',
    'Adw.OverlaySplitView': 'uncurated-placement: neither pane can be a child.',
    'Adw.BottomSheet': 'uncurated-placement: no child policy for the sheet or the content.',
    'Adw.Carousel': 'uncurated-placement: AdwCarousel has no child policy.',
    'Adw.ExpanderRow': 'uncurated-placement: its rows go through add_row(), which no policy declares.',
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
    'Adw.ComboRow': 'its items are a Gio.ListModel; a row without them teaches the wrong thing.',
    'Adw.SpinRow': 'its range is a Gtk.Adjustment, a GObject that is not a widget.',
    'Adw.SplitButton': 'its menu is a Gio.MenuModel, built imperatively.',
    'Gtk.MenuButton': 'its menu is a Gio.MenuModel, built imperatively.',
    'Gtk.DropDown': 'its options are a Gtk.StringList model, built imperatively.',
};
