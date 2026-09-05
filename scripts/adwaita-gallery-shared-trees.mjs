// The gallery blocks whose widget tree is authored ONCE and rendered by both the
// GTK host and the NativeScript port — ADR 0027 § 9's acceptance criterion, at the
// size the gallery actually reaches today.
//
// WHAT ADR 0027 § 9 ASKS FOR
//
// "The same authored tree, rendered through the GTK host and through `adwaita-web`,
// satisfies the same `@gjsify/adwaita-core/conformance` vectors with no per-surface
// markup branch." `scripts/check-vocabulary-alignment.mjs` holds the NAMES across the
// renderers and prints the distance every run; what nothing held until this file is
// whether the gallery's own two authored trees — `adwaita-gallery-trees.mjs` for
// Solid/Vue/React and `adwaita-gallery-ns-templates.mjs` for the NativeScript XML —
// DESCRIBE THE SAME UI. They are written by hand, independently, so a block can
// render two different examples of one widget on one page and nothing notices.
//
// THE CENSUS THAT SIZED THIS FILE
//
// 40 gallery blocks. 23 carry BOTH a `gtk-host` tree and a NativeScript template;
// the other 17 are refused by one renderer or by both, with a reason already
// recorded beside each list. Of those 23, measured node by node with the tag-case
// rule below as the ONLY transform:
//
//   ·  7 identical — this file.
//   ·  4 same shape and same tags, one renderer lacking a property the other sets.
//   ·  3 same shape, needing a tag, slot or property RENAME to line up.
//   ·  9 genuinely different compositions — of which TWO are different only because
//      two authors picked different examples, which is the whole point of the
//      question and is why the ledger below diagnoses them as `content` rather than
//      leaving them filed with the seven the renderers really do force apart.
//
// Every one of the 16 is in {@link ADWAITA_GALLERY_TREE_DIVERGENCES} with the
// measured reason, and arm 11 of `check-generated-website-data.mjs` fails the day
// one of them CONVERGES and is still ledgered — the same self-retiring shape as the
// refusal lists it sits beside.
//
// WHY THIS IS NOT THE ALIAS TABLE BOTH GENERATORS REFUSE
//
// `adwaita-gallery-trees.mjs`'s header refuses a translator between the two
// vocabularies — "a hand-written alias table of 15 tags and 12 attribute SEMANTICS
// … it would map behaviour and not just names, and nothing could hold it" — and
// `adwaita-gallery-ns-templates.mjs` refuses it again from the other side. That
// refusal stands and this file does not weaken it.
//
// A block joins this file only when its tree needs NO alias at all: the same widget
// names, the same property names, the same values, in the same order. The single
// transform is {@link hostTagOf}, which turns the GIR class name a block is authored
// in into the `gtk-host` tag — `AdwPreferencesGroup` -> `adw-preferences-group`, a
// deterministic case rule and not a lookup, and the exact inverse of the
// `gtypeOfTag` the framework generator already runs in the other direction. Arm 11
// asserts the round trip, so the two cannot drift apart into a table.
//
// The vocabulary is the GIR class name because that is the one spelling both
// renderers already agree on (ADR 0034 clause 1: named from the GIR). Authoring in
// either renderer's own spelling would make one of them the reference and the other
// a translation, which is what this file exists to stop.

/**
 * @typedef {Object} SharedNode
 * @property {string} tag                  a GIR class name, e.g. 'AdwPreferencesGroup'
 * @property {string} [slot]               placement in the parent — see the note in
 *                                         {@link ADWAITA_GALLERY_TREE_DIVERGENCES}: the two
 *                                         renderers spell slots differently, so no shared
 *                                         tree uses one yet
 * @property {Record<string, string|number|boolean>} [props]
 * @property {SharedNode[]} [children]
 */

/**
 * @typedef {Object} SharedTree
 * @property {string} widget   the `<AdwWidget title="…">` this belongs to
 * @property {string} page     the gallery page it sits on
 * @property {SharedNode} root
 */

/** @type {readonly SharedTree[]} */
export const ADWAITA_GALLERY_SHARED_TREES = [
    {
        widget: 'Adw.PreferencesGroup',
        page: 'boxed-lists',
        root: {
            tag: 'AdwPreferencesGroup',
            props: { title: 'Account', description: 'Manage how this device signs in and syncs.' },
            children: [
                { tag: 'AdwEntryRow', props: { title: 'Display name', text: 'Grace Hopper' } },
                {
                    tag: 'AdwSwitchRow',
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
        widget: 'Adw.SwitchRow',
        page: 'boxed-lists',
        root: {
            tag: 'AdwPreferencesGroup',
            children: [
                {
                    tag: 'AdwSwitchRow',
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
            tag: 'AdwPreferencesGroup',
            children: [{ tag: 'AdwEntryRow', props: { title: 'Display name', text: 'Ada Lovelace' } }],
        },
    },
    {
        widget: 'Adw.ExpanderRow',
        page: 'boxed-lists',
        // Its rows go through `add_row()`, which had no `gtk-host` policy until
        // `AdwExpanderRow` was curated — so this block was a framework refusal, and the
        // refusal is what the probe found stale the moment the descriptor landed. An
        // unslotted child IS the disclosure here: `defaultSlot: 'row'`. On the
        // NativeScript side the disclosure is a builder slot, so the rows are markup
        // there too.
        //
        // THE TWO TREES USED TO SHOW TWO DIFFERENT EXAMPLES — "Proxy settings" with a
        // host and an authentication toggle on the framework tabs, "Advanced" with a
        // developer-mode toggle and an endpoint on the NativeScript one, the children in
        // the opposite order. Neither renderer forced that; both can carry either. The
        // block's own `preview` fragment decides, because a gallery block is one widget
        // written several ways and not several examples — the same argument
        // `Adw.WrapBox`'s tree already makes about its chips.
        root: {
            tag: 'AdwPreferencesGroup',
            children: [
                {
                    tag: 'AdwExpanderRow',
                    props: {
                        title: 'Proxy settings',
                        subtitle: 'Route traffic through a custom proxy',
                        expanded: true,
                    },
                    children: [
                        { tag: 'AdwEntryRow', props: { title: 'Host', text: 'proxy.example.com' } },
                        { tag: 'AdwSwitchRow', props: { title: 'Use authentication' } },
                    ],
                },
            ],
        },
    },
    {
        widget: 'Adw.Banner',
        page: 'presentation',
        root: {
            tag: 'AdwBanner',
            props: { title: 'Metered connection: updates paused', buttonLabel: 'Resume', revealed: true },
        },
    },
    {
        widget: 'Adw.ShortcutLabel',
        page: 'presentation',
        root: { tag: 'AdwShortcutLabel', props: { accelerator: '<Control>C' } },
    },
    {
        widget: 'Adw.WindowTitle',
        page: 'presentation',
        root: { tag: 'AdwWindowTitle', props: { title: 'Inbox', subtitle: '3 unread messages' } },
    },
];

/**
 * `AdwPreferencesGroup` -> `adw-preferences-group`, the only transform in this file.
 *
 * A case rule and not a lookup: the namespace is split off first and the remainder
 * kebab-cased, which is the exact inverse of `gtypeOfTag` in
 * `generate-adwaita-framework-snippets.mjs`. Arm 11 asserts the round trip on every
 * shared tag, so the day one of the two grows a special case the other does not, the
 * gate says so instead of the gallery quietly shipping two spellings.
 */
export const hostTagOf = (gtype) => {
    const parts = /^(Adw|Gtk)([A-Z]\w*)$/.exec(gtype);
    if (parts === null) throw new Error(`adwaita-gallery-shared-trees: ${gtype} is not a GIR class name`);
    const [, ns, rest] = parts;
    return `${ns.toLowerCase()}-${rest.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
};

const SHARED_BY_WIDGET = new Map(ADWAITA_GALLERY_SHARED_TREES.map((tree) => [tree.widget, tree]));

/** Every gallery block this file is the single source of. */
export const SHARED_WIDGETS = new Set(SHARED_BY_WIDGET.keys());

const entryFor = (widget) => {
    const tree = SHARED_BY_WIDGET.get(widget);
    // A typo here would otherwise reach a generator as `undefined.root`, and a Node
    // stack trace in a generator reads like a broken generator rather than a name
    // that is not in this list.
    if (tree === undefined) throw new Error(`adwaita-gallery-shared-trees: ${widget} is not a shared block`);
    return tree;
};

// Fresh nodes on both sides rather than the authored ones: two arrays handing out the
// same objects would let a consumer's edit reach the other renderer.
const rebuild = (node, tagOf) => ({
    tag: tagOf(node.tag),
    ...(node.slot === undefined ? {} : { slot: node.slot }),
    ...(node.props === undefined ? {} : { props: { ...node.props } }),
    ...(node.children === undefined ? {} : { children: node.children.map((child) => rebuild(child, tagOf)) }),
});

/**
 * The shared block as `adwaita-gallery-trees.mjs` needs it: `gtk-host` tags.
 */
export const gtkHostTree = (widget) => {
    const tree = entryFor(widget);
    return { widget: tree.widget, page: tree.page, root: rebuild(tree.root, hostTagOf) };
};

/**
 * The shared block as `adwaita-gallery-ns-templates.mjs` needs it.
 *
 * NO transform, and that asymmetry is the point rather than an oversight: the
 * NativeScript port's XML element names ARE the GIR class names (ADR 0034 clause 1),
 * so the vocabulary this file is authored in is already the one that ships there.
 */
export const nativeScriptTree = (widget) => {
    const tree = entryFor(widget);
    return { widget: tree.widget, page: tree.page, root: rebuild(tree.root, (tag) => tag) };
};

/**
 * Every gallery block that has a tree on BOTH renderers and is still authored twice,
 * with the measured distance and why it stands.
 *
 * `kind` names what a reader would have to do to close it, and they are not the same
 * job:
 *
 *   · `property` — the two trees agree on shape, tags and every shared property. One
 *     renderer has no such property to set. Closing it is a renderer change.
 *   · `vocabulary` — same shape, different SPELLINGS for the same thing. Closing it
 *     is the convergence `scripts/check-vocabulary-alignment.mjs` already counts down
 *     ("Distance to one vocabulary"), and a block lands here for free when it does.
 *   · `composition` — the two trees are different UIs. Closing it needs a decision
 *     about what the block should show, and sometimes a renderer change first.
 *   · `content` — same widget, same renderer capability, DIFFERENT EXAMPLE. Nothing
 *     forces these; they are what two independently authored trees produce. The
 *     block's own `preview` fragment is the authority, and in every case here it is
 *     the NativeScript template that drifted from it.
 *
 * Checked back like the two refusal lists it sits beside: arm 11 of
 * `check-generated-website-data.mjs` fails on an entry whose two trees have become
 * identical (move it into {@link ADWAITA_GALLERY_SHARED_TREES}), on an entry for a
 * block that has no pair, and on a paired block that is neither shared nor ledgered.
 */
export const ADWAITA_GALLERY_TREE_DIVERGENCES = {
    // --- one renderer has no such property ---
    'Adw.Avatar':
        'property: the NativeScript `AdwAvatar` sets only `size` and `text`, so `showInitials` and `iconName` have nowhere to go.',
    'Adw.ButtonRow':
        'property: `AdwButtonRow.startIconName` exists on both and means different things — an icon NAME on GTK, an Adwaita symbolic SVG STRING on NativeScript — and the port has no `cssClasses`.',
    'Adw.PasswordEntryRow':
        'property: `revealed` is a NativeScript-side property; `gtk-host` has none on `adw-password-entry-row`, because libadwaita exposes the peek icon rather than the state.',
    'Gtk.Entry':
        'property: `widthRequest` is a GTK size request; the NativeScript `GtkEntry` sets `editable`, `field`, `maxLength`, `placeholderText`, `text` and `textLength` and nothing about layout.',
    // --- same shape, different spellings ---
    'Adw.Clamp':
        'vocabulary: one `GtkLabel` against one `Label`, and `label`/`wrap`/`cssClasses` against `text`/`textWrap`/`class`. Same values on both sides; only the names differ.',
    'Adw.HeaderBar':
        'vocabulary: the three slots are spelled `start`/`title`/`end` against `startBox`/`titleWidget`/`endBox`, and the trailing button is a `GtkMenuButton` on GTK where the port has no menu widget.',
    'Adw.Spinner':
        'vocabulary: `Adw.Spinner` has no size of its own and fills what it is given, so GTK sets `widthRequest`/`heightRequest` where the port exposes `size` and `spinning`.',
    // --- different UI ---
    'Adw.ActionRow':
        'composition: the prefix icon and the chevron are two children on GTK and none on NativeScript, where `GtkImage.iconName` takes an SVG source no attribute can carry.',
    'Adw.ButtonContent':
        'composition: GTK wraps the content in a `gtk-button`; the port declares the content alone, and its `iconName` is an SVG source, so the label is the half a template holds.',
    'Adw.NavigationSplitView':
        'composition: GTK refuses anything but an `Adw.NavigationPage` in either pane, so its tree carries two wrappers the port does not need.',
    'Adw.NavigationView':
        'composition: same two `AdwNavigationPage` wrappers as the split view, plus the page `tag` a GTK push needs and NativeScript reads from the code-behind.',
    'Adw.OverlaySplitView':
        'composition: an `AdwHeaderBar` title is a slotted `AdwWindowTitle` child on GTK and a plain `title` property on the port, so the GTK tree has two nodes more.',
    'Adw.StatusPage':
        'composition: the GTK tree carries an action button the port has no room for, and the icon is `iconName` against the glyph fallback `iconText`.',
    'Adw.ToolbarView':
        'composition: the bottom bar is a `gtk-box` of four buttons on GTK — `Gtk.ActionBar` has no child policy — and a second `AdwHeaderBar` on the port.',
    // --- nothing forces these ---
    'Adw.WrapBox':
        'content: the block preview and the framework tabs show eight chips, the NativeScript template six, and it spells `TypeScript` where the other three spell `Typescript`. Plus the `label`/`cssClasses` against `text`/`variant` vocabulary gap.',
    'Gtk.Button':
        'content: the preview and the framework tabs show five buttons, the NativeScript template four — the icon-only circular one is missing, and its icon would be an SVG source. Plus a `GtkBox` against a `StackLayout` and the `label`/`cssClasses` gap.',
};
