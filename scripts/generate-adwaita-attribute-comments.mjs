#!/usr/bin/env node
// What each attribute in the gallery's HTML fence MEANS, written into that fence as
// an inline comment and derived from the GIR the widget's GObject property lives in.
//
// THE INCIDENT, AND WHY THE ANSWER IS A GENERATED COMMENT
//
// The gallery used to answer this in a pane beside the fence, listing every
// `observedAttributes` name with the value the preview passes. It was generated for
// a measured reason — hand-written attribute prose had not survived: across the 37
// blocks that join to an element, 110 of the observed attributes were named somewhere
// on their page and **54 were not**, all four of `<adw-toolbar-view>`'s among them,
// and eight of `<adw-overlay-split-view>`'s including the `breakpoint` its own
// section is about. `<adw-wrap-box>` shipped with no pane at all over 14 attributes
// because the reader could not see the declaration.
//
// What that pane could never say is what an attribute IS. It described what the
// preview PASSES — the fence one tab to the left already shows that — so a reader
// who did not recognise `selected` learned that it was `"0"` and nothing else. The
// pane is gone; this is what fills the gap it left, in the markup a reader copies,
// because an HTML comment is inert in the DOM and the fence is ONE source: the
// window shows it and mounts it (see `website/src/components/AdwWidget.astro`).
//
// THE SAME 110-AGAINST-54 SHAPE WAS ALREADY RE-FORMING BY HAND. Measured over the 40
// fences on 2026-09-09: seven carried an authored HTML comment and four of those
// glossed an attribute — `model` on `<gtk-drop-down>`, `stack` on
// `<adw-view-switcher-bar>`, the absent `editable` on `<gtk-entry>`, and
// `allow-scroll-wheel` on `<adw-carousel>`. Four of 193 attribute occurrences, with
// nothing holding the other 189 and nothing checking the four. So the gloss is
// GENERATED here and the two authored ones that say something the GIR cannot are
// LEDGERED ({@link AUTHORED_MEANINGS}) rather than left to a hand.
//
// WHERE THE MEANING COMES FROM
//
// The custom elements mirror GObject properties, so an attribute's meaning is
// derivable: tag -> GType -> GIR property -> the first sentence of its `<doc>`. The
// GIR is read directly, which is the arrangement ADR 0028 § 1 already settled for
// the widget table, and for the same reason: it is complete, offline, and the only
// source for the question. `@girs/*`'s vocabulary subpath carries names, nicks and
// `SINCE` (ADR 0029) and no doc text at all, so it cannot answer this one.
//
// WHICH ATTRIBUTES GET A COMMENT — THE LINE, AND WHY IT IS DRAWN THERE
//
// Not all of them. A comment per attribute would put 193 lines into 40 fences whose
// median is 8 lines, and the great majority of GIR property docs are a restatement of
// the property's own name: "The subtitle for this row.", "The displayed label.",
// "Whether the row is expanded." Emitting those makes the markup a reader copies
// worse, and it is the same complaint the pane was deleted for — information that
// costs a line and says nothing.
//
// So an attribute is commented iff its doc's first sentence carries a word the NAME
// does not already imply. That is decided mechanically, in {@link residue}: content
// words minus the attribute's own name, minus the element's name, minus a closed list
// of English function words, minus {@link PRESENTATION_WORDS} (the vocabulary a
// property doc spends on the fact that a property is displayed, which a documentation
// fence says by existing), minus the corpus's own SHARED VOCABULARY — every word
// occurring in {@link SHARED_VOCABULARY_MIN_DOCS} or more of the docs this gallery
// shows, which by construction distinguishes none of them. What is left is the
// residue; an empty residue is a restatement.
//
// The counts both ways are emitted into the generated module and printed on every
// run, so the line is measured rather than asserted, and moving it moves a number a
// reviewer can see.
//
// AN ENUM'S NICKS ARE DELIBERATELY NOT PRINTED. They are the one thing no name and no
// doc sentence carries, and the GIR has them — but the fence is the WEB port's markup
// and the accepted value vocabulary is that port's own, not libadwaita's. Printing
// GIR nicks beside a web attribute asserts a vocabulary this generator has not read.
// It would have added exactly one comment (`display-mode` on
// `<adw-inline-view-switcher>`, whose doc sentence is "The display mode.") and needed
// a second source to be true.
//
// TWO COMMITTED OUTPUTS, AND THE SECOND IS WHAT MAKES A DROPPED COMMENT RED
//
//   1. the `.mdx` fences themselves — what ships, and what a reader reads;
//   2. `scripts/adwaita-attribute-meanings.mjs` — every attribute the gallery sets,
//      with its sentence or `null` where the name suffices.
//
// The second is a second copy of the text on purpose, and it is the ADR 0028
// arrangement: `--check` here re-derives BOTH from the GIR and refuses a drift, and
// it runs in `main.yml`'s `tree-checks` job, the one with `gtk4-devel` and
// `libadwaita-devel` in its image. The two jobs that run
// `check-generated-website-data.mjs` are `checkout` + `setup-node` and have no GIR at
// all, so without the module they could not tell a hand-edited comment from a
// generated one. With it, arm 12 there holds every fence against the module byte for
// byte, on every PR, GIR or no GIR.
//
// PROVENANCE, AND THE SKEW IT DOES NOT HIDE. The module records the namespace and the
// highest member `version` each GIR declares — libadwaita 1.9 / GTK 4.24 as read here
// — and NOT the directory it was read from, which differs between a distro install
// and a flatpak SDK and would make the byte check fail for the machine rather than
// for the data. A libadwaita upgrade that rewords a property doc IS a red gate whose
// repair is a re-run, and the diff is then the upstream doc change arriving on the
// site. That is the honest failure, not a false one.
//
// Usage: node scripts/generate-adwaita-attribute-comments.mjs [--check]

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The title -> tag rule, shared rather than re-spelled: its own header records that a
// second spelling WAS the drift here the day the `adw-` prefix stopped being constant.
import { galleryElementTag } from '../website/src/components/attr-sample.mjs';
import { observedAttributes } from './adwaita-elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The generated module, and the one arm 12 of `check-generated-website-data.mjs` reads. */
export const MEANINGS_MODULE = 'scripts/adwaita-attribute-meanings.mjs';

/**
 * The generated output nothing formats, and arm 10 of `check-generated-website-data.mjs`
 * holds its `.oxfmtrc.json` exemption.
 *
 * The `.mdx` fences need no entry: `**\/*.mdx` is already ignored tree-wide.
 */
export const ATTRIBUTE_OXFMT_EXEMPT_OUTPUTS = [MEANINGS_MODULE];

/** The gallery pages. Both namespaces, because a web tag carries its library's prefix. */
export const GALLERY_DOC_DIRS = ['website/src/content/docs/adwaita', 'website/src/content/docs/gtk'];

/** The two GIR namespaces the gallery's tags come from, `Adw-1` first so `Adw` wins a tie. */
const GIR_NAMESPACES = [
    { namespace: 'Adw', file: 'Adw-1.gir' },
    { namespace: 'Gtk', file: 'Gtk-4.0.gir' },
];

// ---------------------------------------------------------------------------
// the ledgers
// ---------------------------------------------------------------------------

/**
 * Every attribute a gallery fence sets that has NO GIR property of that name, with
 * what it is instead.
 *
 * A DECLARED SET, not a swallowed error. Each entry is a real divergence between the
 * web port's markup surface and libadwaita's property surface, and each is checked
 * back: an attribute here that has grown a GIR property fails, an attribute with no
 * property and no entry fails, and every `girProperty` named must still resolve on
 * that element's own GType chain. 20 entries over 9 elements, which is 20 of the 107
 * distinct attributes the gallery sets.
 *
 * NONE of them gets a generated comment, and that is the conservative reading rather
 * than a gap. A doc borrowed across a rename can be false: `<gtk-entry disabled>` is
 * the INVERSE of `Gtk.Widget:sensitive` ("Whether the widget responds to input"), so
 * the sentence read verbatim says the opposite of what the attribute does. What the
 * entry buys is the evidence — the property it corresponds to, machine-checked to
 * exist — so a reader and a later generator can both find where the meaning lives.
 */
export const ATTRIBUTE_MEANING_LEDGER = {
    // `present()` / `close()` is the whole libadwaita API; the element exposes the
    // state as an attribute so a page can declare a dialog open. ADR 0033's
    // preference for a declarative template is what this is.
    'adw-about-dialog open': { kind: 'declarative-state' },
    'adw-alert-dialog open': { kind: 'declarative-state' },
    'adw-preferences-dialog open': { kind: 'declarative-state' },

    // `<adw-alert-response>` is not a widget at all: it is the markup form of
    // `Adw.AlertDialog.add_response()` plus `set_response_appearance()`, so there is
    // no `AdwAlertResponse` GType for a property to live on.
    'adw-alert-response id': { kind: 'not-a-widget' },
    'adw-alert-response appearance': { kind: 'not-a-widget' },

    // An icon NAME under a shorter spelling. Each of these three sets
    // `iconName`/`createGtkImage` from the attribute, so the value space is the icon
    // theme's, exactly as the GIR property says.
    'adw-avatar icon': { kind: 'renamed', girProperty: 'icon-name' },
    'adw-status-page icon': { kind: 'renamed', girProperty: 'icon-name' },
    'gtk-button icon': { kind: 'renamed', girProperty: 'icon-name' },

    // The browser spelling of the same thing: the element writes `button.title`.
    'gtk-button tooltip': { kind: 'renamed', girProperty: 'tooltip-text' },

    // A style class the port exposes as a boolean attribute — `buttonStyleClasses`
    // in `@gjsify/adwaita-core` maps the five to CSS, and libadwaita has no property
    // for any of them because a style class is a list entry there (ADR 0049).
    'gtk-button flat': { kind: 'style-class' },
    'gtk-button suggested': { kind: 'style-class' },
    'gtk-button destructive': { kind: 'style-class' },
    'gtk-button circular': { kind: 'style-class' },
    'gtk-button pill': { kind: 'style-class' },

    // `<gtk-entry>` speaks the HTML form vocabulary rather than GTK's, deliberately
    // and visibly: /gtk/controls/ already carries an authored comment saying it has
    // no `editable` because it is "the browser spelling of a field". Three of them,
    // and `disabled` is the INVERSE of the property it corresponds to.
    'gtk-entry value': { kind: 'renamed', girProperty: 'text' },
    'gtk-entry placeholder': { kind: 'renamed', girProperty: 'placeholder-text' },
    'gtk-entry disabled': { kind: 'inverted', girProperty: 'sensitive' },

    // The value is an element ID, resolved with `getElementById`, where the GIR
    // property holds the object itself. Same shape as `stack` on
    // `<adw-view-switcher-bar>`, which does have a property of that name and is
    // therefore in {@link AUTHORED_MEANINGS} instead.
    'adw-carousel-indicator-dots for': { kind: 'id-reference', girProperty: 'carousel' },

    // Port-added and CSS-backed: `resolveSpinnerSize` turns the attribute into a
    // pixel box, and `AdwSpinner` has no size property — a GTK spinner takes its
    // size from its allocation.
    'adw-spinner size': { kind: 'port-only' },

    // Port-added: it titles the popover AND becomes the button's `aria-label`.
    // `Gtk.MenuButton` has `label`, and no title.
    'gtk-menu-button menu-title': { kind: 'port-only' },
};

/** The kinds an entry may carry, and which of them owe a `girProperty`. */
const LEDGER_KINDS = {
    'declarative-state': { girProperty: false },
    'not-a-widget': { girProperty: false },
    renamed: { girProperty: true },
    inverted: { girProperty: true },
    'id-reference': { girProperty: true },
    'style-class': { girProperty: false },
    'port-only': { girProperty: false },
};

/**
 * Attributes whose meaning belongs to the WEB port and not to the GIR property of the
 * same name, where the page's own authored comment stands and this generator emits
 * none.
 *
 * Two, and both are the same fact: the GIR property holds an OBJECT and the attribute
 * takes a string. `Gio.ListModel` against a JSON array, `Adw.ViewStack` against an
 * element id. The GIR sentence is true of the property and false of the markup, which
 * is the one case where a generated gloss would be worse than the hand.
 *
 * `must` is the substring the fence has to keep carrying, so removing the authored
 * comment is a red gate rather than a quiet loss — the mechanism the 110-against-54
 * measurement says a hand needs.
 */
export const AUTHORED_MEANINGS = {
    'gtk-drop-down model': { must: '`model` is a JSON array of strings' },
    'adw-view-switcher-bar stack': { must: '`stack` takes the id of the <adw-view-stack> to bind to.' },
};

// ---------------------------------------------------------------------------
// the restatement rule
// ---------------------------------------------------------------------------

/** Crude singularisation, so `lines` and `line` are one word. Enough for one corpus. */
const stem = (word) =>
    word
        .replace(/ies$/, 'y')
        .replace(/(sses|shes|ches|xes)$/, 's')
        .replace(/([^s])s$/, '$1');

/**
 * A word list in the same shape the corpus is read in.
 *
 * STEMMED at construction, not compared raw: `stem` turns `this` into `thi` and `is`
 * into `i`, so a list spelling them normally matched nothing and the two rode into the
 * shared vocabulary on document frequency instead — which worked, and hid whether the
 * grammar list was doing anything at all.
 */
function stemmed(list) {
    return new Set(
        list
            .split(/\s+/)
            .filter((word) => word !== '')
            .map(stem),
    );
}

/**
 * English grammar words. A closed class, so this list carries no judgement about any
 * particular attribute — which is the property that makes the rule re-derivable.
 *
 * `s` is in it for the POSSESSIVE: `application's` tokenises to `application` + `s`,
 * and that stray `s` was a one-word residue all by itself — it is why
 * `<adw-about-dialog website>` was commented with "The URL of the application's
 * website.", a sentence that says nothing the name does not.
 */
const FUNCTION_WORDS = stemmed(
    `a an the this that these those and or but if when while of for to in on at by with from as
     is are was were be been being will would can could should may might must do does did not no
     nor it its their there here they them which who whom whose what how than then so such all
     any each other another own same too very only into out over under also both
     s`,
);

/**
 * The vocabulary a property doc spends on the fact that a property is SHOWN.
 *
 * A documentation fence says that by existing, so these words never distinguish one
 * attribute from another — and left in, they were the whole junk half of the output.
 * Measured: they alone were the residue of nine attributes whose sentence says nothing
 * ("The title to display.", "The copyright information.", "Whether the banner is
 * currently revealed.", "The spacing between lines.", "Whether the sidebar widget is
 * shown.").
 *
 * Every word here is checked back: one that is the residue of no attribute in the
 * corpus is stale and fails, so the list cannot quietly grow into a place where a
 * comment is suppressed by hand.
 */
const PRESENTATION_WORDS = stemmed(
    'display show shown currently current information inside contain between below set url widget',
);

/**
 * How many of the corpus's docs a word must appear in before it stops distinguishing
 * them.
 *
 * DERIVED rather than listed, which is what keeps the domain boilerplate out without
 * naming any of it: "preference" and "represented" are in 10 and 8 of these docs
 * ("The title of the preference represented by this row." is 8 elements' answer for
 * `title`), "application" in 5, "item" in 8. A hand-written list of those is a hand
 * written about attributes; a document-frequency floor is not.
 */
const SHARED_VOCABULARY_MIN_DOCS = 4;

/** The content words of a string, stemmed, in occurrence order. */
const words = (text) => (text.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []).map(stem);

/**
 * The first sentence of a GIR `<doc>`, with GIR's own markup resolved.
 *
 * The first PARAGRAPH first: a property doc's second paragraph is the caveat
 * ("interpreted as Pango markup unless …"), which is a second sentence's worth of
 * detail rather than the meaning. Then the first sentence of it.
 */
export const firstSentence = (doc) => {
    if (doc === null || doc === undefined) return null;
    const paragraph = doc
        .split(/\n\s*\n/)[0]
        .replaceAll('\n', ' ')
        // `[property@PreferencesRow:use-markup]` -> `PreferencesRow:use-markup`, and the
        // same for the class/iface/method/func/enum forms gi-docgen accepts.
        .replaceAll(/\[(?:property|class|iface|method|func|ctor|enum|flags|signal|vfunc|id|type)@([^\]]+)\]/g, '$1')
        .replaceAll(/%(TRUE|FALSE|NULL)/g, '$1')
        .replaceAll(/(?<![\w`])#([A-Z]\w+)/g, '$1')
        .replaceAll(/\s+/g, ' ')
        .trim();
    const sentence = /^(.*?[.!?])(\s|$)/.exec(paragraph);
    return (sentence === null ? paragraph : sentence[1]).trim();
};

/**
 * The words of `sentence` that neither the attribute name, the element name, the
 * closed word lists nor the corpus's shared vocabulary account for.
 *
 * Empty means the sentence restates the name, and the fence says it already.
 */
export const residue = (sentence, tag, attribute, shared) => {
    const implied = new Set([...words(tag), ...words(attribute)]);
    const out = [];
    for (const word of new Set(words(sentence))) {
        if (implied.has(word) || FUNCTION_WORDS.has(word) || PRESENTATION_WORDS.has(word)) continue;
        if (shared.has(word)) continue;
        out.push(word);
    }
    return out;
};

// ---------------------------------------------------------------------------
// the GIR
// ---------------------------------------------------------------------------

/**
 * Where a `.gir` may live, in the order ADR 0028 § 1 measured: the distro's devel
 * packages first, then the flatpak SDK runtimes, with an explicit override ahead of
 * both. Named on every run, never guessed — a missing GIR is an exit, not a skip,
 * because this generator is the only thing that can see the doc text at all.
 */
export function girDirectories() {
    const candidates = [];
    for (const dir of (process.env.GJSIFY_GIR_DIRS ?? '').split(':')) if (dir !== '') candidates.push(dir);
    candidates.push('/usr/share/gir-1.0');
    for (const base of (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':')) {
        if (base !== '') candidates.push(join(base, 'gir-1.0'));
    }
    for (const base of [join(homedir(), '.local/share/flatpak/runtime'), '/var/lib/flatpak/runtime']) {
        const sdk = join(base, 'org.gnome.Sdk');
        let arches = [];
        try {
            arches = readdirSync(sdk);
        } catch {
            arches = [];
        }
        for (const arch of arches) {
            let branches = [];
            try {
                branches = readdirSync(join(sdk, arch));
            } catch {
                branches = [];
            }
            for (const branch of branches) candidates.push(join(sdk, arch, branch, 'active/files/share/gir-1.0'));
        }
    }
    return candidates;
}

/** The first directory carrying every namespace this generator reads, or `null`. */
export function findGirDirectory() {
    for (const dir of girDirectories()) {
        if (GIR_NAMESPACES.every(({ file }) => existsSync(join(dir, file)))) return dir;
    }
    return null;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text) =>
    text.replaceAll(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-z]+));/g, (whole, hex, dec, name) => {
        if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
        if (dec !== undefined) return String.fromCodePoint(Number(dec));
        return Object.hasOwn(XML_ENTITIES, name) ? XML_ENTITIES[name] : whole;
    });

/** `1.9` > `1.10`? No: compared numerically, field by field. */
const laterVersion = (a, b) => {
    if (a === null) return b;
    const parts = (v) => v.split('.').map(Number);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? a : b;
    }
    return a;
};

/**
 * Every class and interface of one namespace, keyed by GType name.
 *
 * A REGEX READER over one well-known file, deliberately, and it is the same shape
 * `girs-vocabulary.mts` had before ADR 0029 moved the vocabulary into `@girs/*`. What
 * it needs is narrow — the type chain and one doc string per property — and pulling an
 * XML parser into a script that has to run with no `node_modules` is not available
 * anyway.
 *
 * INTERFACES ARE NOT OPTIONAL (ADR 0028 § 9): GObject installs an interface's
 * properties on the implementor at runtime while GIR keeps them once, on the
 * interface, so `orientation` is on `Gtk.Orientable` and not on `GtkBox`. The walk
 * below takes `<implements>` before `parent`.
 */
function readNamespace(dir, { namespace, file }) {
    const xml = readFileSync(join(dir, file), 'utf8');
    const classes = new Map();
    let libraryVersion = null;
    const opens = [...xml.matchAll(/<(class|interface)\s([^>]*?)>/gs)];
    for (let i = 0; i < opens.length; i++) {
        const attribute = (name) => new RegExp(`${name}="([^"]*)"`).exec(opens[i][2])?.[1] ?? null;
        const gtype = attribute('glib:type-name');
        if (gtype === null) continue;
        const body = xml.slice(opens[i].index, i + 1 < opens.length ? opens[i + 1].index : xml.length);
        const properties = new Map();
        for (const property of body.matchAll(/<property\s([^>]*?)>(.*?)<\/property>/gs)) {
            const name = /name="([^"]*)"/.exec(property[1])?.[1];
            if (name === undefined) continue;
            const doc = /<doc\s[^>]*?>(.*?)<\/doc>/s.exec(property[2])?.[1];
            const since = /version="([0-9]+(?:\.[0-9]+)*)"/.exec(property[1])?.[1] ?? null;
            if (since !== null) libraryVersion = laterVersion(libraryVersion, since);
            properties.set(name, { doc: doc === undefined ? null : unescapeXml(doc) });
        }
        // A property with no doc and no children is self-closing, and it still exists.
        for (const property of body.matchAll(/<property\s([^>]*?)\/>/g)) {
            const name = /name="([^"]*)"/.exec(property[1])?.[1];
            if (name !== undefined && !properties.has(name)) properties.set(name, { doc: null });
        }
        classes.set(gtype, {
            namespace,
            parent: attribute('parent'),
            implements: [...body.matchAll(/<implements name="([^"]*)"/g)].map((m) => m[1]),
            properties,
        });
    }
    // Members carry `version` too; the highest one a namespace declares is the closest
    // thing the file has to the library version it describes (there is no other).
    for (const version of xml.matchAll(/<(?!include\b)[a-z:-]+\s[^>]*?\sversion="([0-9]+(?:\.[0-9]+)*)"/g)) {
        libraryVersion = laterVersion(libraryVersion, version[1]);
    }
    return { classes, libraryVersion };
}

/** The two namespaces merged, plus a chain-walking property lookup. */
export function readGir(dir) {
    const classes = new Map();
    const provenance = [];
    for (const namespace of GIR_NAMESPACES) {
        const read = readNamespace(dir, namespace);
        for (const [gtype, entry] of read.classes) if (!classes.has(gtype)) classes.set(gtype, entry);
        provenance.push({ namespace: namespace.namespace, version: read.libraryVersion });
    }
    /** `Gtk.Widget` or a bare `Widget` inside `ns` -> the GType name it is keyed under. */
    const gtypeOf = (reference, namespace) => {
        const [prefix, name] = reference.includes('.') ? reference.split('.') : [namespace, reference];
        return `${prefix === 'GObject' ? 'G' : prefix}${name}`;
    };
    const property = (gtype, name, seen = new Set()) => {
        if (seen.has(gtype)) return null;
        seen.add(gtype);
        const entry = classes.get(gtype);
        if (entry === undefined) return null;
        if (entry.properties.has(name)) return { owner: gtype, ...entry.properties.get(name) };
        for (const iface of entry.implements) {
            const found = property(gtypeOf(iface, entry.namespace), name, seen);
            if (found !== null) return found;
        }
        return entry.parent === null ? null : property(gtypeOf(entry.parent, entry.namespace), name, seen);
    };
    return { classes, provenance, property };
}

/** `adw-action-row` -> `AdwActionRow`. The inverse of the tag rule of ADR 0034 clause 1. */
export const gtypeOfTag = (tag) => {
    const split = tag.indexOf('-');
    const prefix = tag.slice(0, split);
    const rest = tag.slice(split + 1);
    const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);
    return `${pascal(prefix)}${rest.split('-').map(pascal).join('')}`;
};

// ---------------------------------------------------------------------------
// the fences
// ---------------------------------------------------------------------------

/**
 * The fence a reader COPIES, per gallery block: the `web` fragment where a block has
 * one and the `preview` fragment otherwise.
 *
 * `web` is `AdwWidget`'s `MARKUP_OVERRIDE` — the markup shown in place of the preview
 * window's own fence — and exactly one block uses it. `<adw-toast-overlay>`'s preview
 * fence paints a toast out of the overlay's internal DOM and says so in its own first
 * comment: "NOT the markup a reader copies". Commenting the fence nobody is shown, and
 * leaving the one they are shown bare, is the inversion to avoid.
 */
export function galleryFences(root) {
    const fences = [];
    for (const dir of GALLERY_DOC_DIRS) {
        const absolute = join(root, dir);
        for (const file of readdirSync(absolute).sort()) {
            if (!file.endsWith('.mdx')) continue;
            const rel = `${dir}/${file}`;
            const text = readFileSync(join(absolute, file), 'utf8');
            for (const block of text.matchAll(/<AdwWidget\s([^>]*)>(.*?)<\/AdwWidget>/gs)) {
                const title = /title="([^"]*)"/.exec(block[1])?.[1] ?? null;
                const bodyStart = block.index + block[0].indexOf('>', block.index === 0 ? 0 : 0) + 1;
                const found = new Map();
                for (const slot of ['preview', 'web']) {
                    const pattern = new RegExp(`<Fragment slot="${slot}">\\s*\`\`\`html\\n(.*?)(^[ \\t]*\`\`\`)`, 'ms');
                    const fence = pattern.exec(block[2]);
                    if (fence === null) continue;
                    const start = block.index + block[0].indexOf(block[2]) + fence.index + fence[0].indexOf(fence[1]);
                    found.set(slot, { start, end: start + fence[1].length, body: fence[1] });
                }
                const slot = found.has('web') ? 'web' : 'preview';
                const fence = found.get(slot);
                if (fence === undefined) continue;
                fences.push({
                    rel,
                    title,
                    slot,
                    // The element this block is ABOUT, which is what decides where a gloss
                    // belongs — see {@link commentableIn}.
                    subject: title === null ? null : galleryElementTag(title),
                    ...fence,
                    blockStart: bodyStart,
                });
            }
        }
    }
    return fences;
}

/**
 * Does a gloss for `tag` belong in THIS fence?
 *
 * An attribute is glossed where its element is DOCUMENTED — in the block that block is
 * about — and an element no block is about is glossed wherever it appears, because the
 * reader has nowhere else to meet it.
 *
 * MEASURED, and this is the rule's whole reason. Glossing every element in every fence
 * put 62 comment lines into 332 lines of markup and **19 of them were the same sentence**:
 * `<adw-status-page description>`, which is the filler content of nineteen other widgets'
 * previews. `Adw.StatusPage` has a block of its own, where that gloss is exactly right and
 * where the reader is when they need it. Scaffolding is not documentation, and repeating a
 * widget's gloss on every page that borrows it is the "too little value" the attribute pane
 * was deleted for, one tab over.
 *
 * The child elements — `<adw-view-stack-page>`, `<adw-sidebar-item>`, `<adw-toggle>`,
 * `<adw-alert-response>` — have no block, so the second clause keeps them covered. Which
 * makes the partition complete: every attribute the gallery sets is glossed somewhere, or
 * its name suffices, or it is ledgered.
 */
export const commentableIn = (fence, tag, subjects) => tag === fence.subject || !subjects.has(tag);

/** Half-open `[start, end)` of every HTML comment, so a tag inside one is not markup. */
const commentRanges = (markup) => {
    const ranges = [];
    for (let at = markup.indexOf('<!--'); at !== -1; at = markup.indexOf('<!--', at + 4)) {
        const close = markup.indexOf('-->', at + 4);
        const end = close === -1 ? markup.length : close + 3;
        ranges.push([at, end]);
        at = end - 4;
    }
    return ranges;
};

/**
 * Every `adw-*` / `gtk-*` opening tag in `markup`, in source order, with the offset of
 * its `<`, the attributes that instance sets and the value each one carries.
 *
 * PER INSTANCE, which is the difference from the union the deleted attribute pane
 * showed: /adwaita/buttons/ paints five `<gtk-button>`s, one per style, and a comment
 * has to name what the button BELOW it carries rather than what the fence carries
 * between them.
 *
 * A QUOTE-AWARE walk rather than `/<tag[^>]*>/`, because an attribute value may hold a
 * `>` — `<gtk-drop-down>`'s `model` carries JSON. Comments are skipped.
 *
 * `values` is a Map beside the `attributes` list rather than a second walk of the same
 * markup: arm 13 of `check-generated-website-data.mjs` needs what a fence SETS and this
 * loop already parses it. `null` is a bare attribute (`active`), which is a different
 * fact from the empty string (`accelerator=""`) and stays distinguishable. Values are
 * the fence's own bytes, entities included — decoding is the caller's, because only the
 * caller knows which vocabulary it is decoding INTO.
 */
export function markupElements(markup) {
    const comments = commentRanges(markup);
    const elements = [];
    for (const open of markup.matchAll(/<((?:adw|gtk)-[a-z0-9-]+)(?=[\s/>]|$)/g)) {
        if (comments.some(([from, to]) => open.index >= from && open.index < to)) continue;
        let at = open.index + open[0].length;
        let quote = '';
        while (at < markup.length && (quote !== '' || markup[at] !== '>')) {
            const char = markup[at];
            if (quote === '') {
                if (char === '"' || char === "'") quote = char;
            } else if (char === quote) quote = '';
            at += 1;
        }
        const attributes = [];
        const values = new Map();
        const inside = markup.slice(open.index + open[0].length, at);
        for (const found of inside.matchAll(
            /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
        )) {
            const name = found[1].toLowerCase();
            if (attributes.includes(name)) continue;
            attributes.push(name);
            values.set(name, found[2] ?? found[3] ?? found[4] ?? null);
        }
        elements.push({ tag: open[1], start: open.index, attributes, values });
    }
    return elements;
}

/** The one comment shape this generator writes, and the only one it removes. */
const GENERATED_COMMENT = /^([ \t]*)<!-- ([a-z][a-z0-9-]*): (.+) -->$/;

/**
 * Is `line` one of ours?
 *
 * The shape alone is not enough to claim a line: an authored comment could open with
 * `word:`. The name has to be an attribute some element in this pillar OBSERVES, which
 * is what makes the test a join rather than a guess — and measured over the seven
 * authored comments the gallery carries, none matches the shape at all (four open with
 * a backtick, three with a capital).
 */
export const generatedComment = (line, attributeNames) => {
    const match = GENERATED_COMMENT.exec(line);
    if (match === null) return null;
    if (!attributeNames.has(match[2])) return null;
    return { indent: match[1], attribute: match[2], sentence: match[3] };
};

/** `<!-- selected: The position of the selected item. -->` */
export const commentLine = (indent, attribute, sentence) => `${indent}<!-- ${attribute}: ${sentence} -->`;
// ---------------------------------------------------------------------------
// placement, and everything that needs no GIR
// ---------------------------------------------------------------------------

/** Every generated comment line removed, so a rewrite is idempotent. */
function stripGenerated(body, attributeNames) {
    return body
        .split('\n')
        .filter((line) => generatedComment(line, attributeNames) === null)
        .join('\n');
}

/** One fence, comments stripped and re-inserted from `meanings`. */
function rewriteFence(body, { attributeNames, meanings, problems, fence, subjects }) {
    const stripped = stripGenerated(body, attributeNames);
    const lines = stripped.split('\n');
    // Offset of the first character of each line, so an element's `<` finds its line.
    const lineStart = [];
    let at = 0;
    for (const line of lines) {
        lineStart.push(at);
        at += line.length + 1;
    }
    /** @type {Map<number, string[]>} line index -> comment lines to insert above it */
    const insertions = new Map();
    let comments = 0;
    for (const element of markupElements(stripped)) {
        if (!commentableIn(fence, element.tag, subjects)) continue;
        const index = lineStart.findLastIndex((start) => start <= element.start);
        const line = lines[index];
        const column = element.start - lineStart[index];
        const wanted = element.attributes.flatMap((attribute) => {
            const sentence = meanings[element.tag]?.[attribute];
            return sentence === undefined || sentence === null ? [] : [[attribute, sentence]];
        });
        if (wanted.length === 0) continue;
        if (line.slice(0, column).trim() !== '') {
            problems.push(
                `${fence.rel}: <${element.tag}> does not start its line, so a comment above it would gloss the ` +
                    'element before it. Put the tag on its own line.',
            );
            continue;
        }
        const indent = line.slice(0, column);
        const above = insertions.get(index) ?? [];
        for (const [attribute, sentence] of wanted) above.push(commentLine(indent, attribute, sentence));
        insertions.set(index, above);
        comments += wanted.length;
    }
    const out = [];
    for (const [index, line] of lines.entries()) {
        for (const comment of insertions.get(index) ?? []) out.push(comment);
        out.push(line);
    }
    return { body: out.join('\n'), comments };
}

/**
 * Place `meanings` into every gallery fence, and hold everything that can be held
 * WITHOUT a GIR.
 *
 * ONE implementation, two callers, and that is the point of the split. {@link derive}
 * calls it with the sentences it just read out of the GIR; arm 12 of
 * `check-generated-website-data.mjs` calls it with the COMMITTED sentences in
 * `scripts/adwaita-attribute-meanings.mjs`, in two jobs that are `checkout` +
 * `setup-node` and have no GIR at all. A second placement implementation there would
 * be a check of a rule the fences were not written with.
 *
 * What it holds: the partition (every attribute a fence sets is glossed, name-sufficing,
 * ledgered as divergent or ledgered as authored — exactly one of the four), both ledgers
 * in the stale direction, the authored glosses' own text, and the fence bytes.
 */
export function applyMeanings(root, meanings) {
    const { byTag, unreadable } = observedAttributes(root);
    const problems = [];
    if (unreadable.length > 0) {
        problems.push(
            `${unreadable.length} element(s) declare an observedAttributes this reader cannot resolve ` +
                `(${unreadable.join(', ')}). An unreadable element is one whose attributes go unglossed while ` +
                'looking done — extend the reader in scripts/adwaita-elements.mjs.',
        );
    }
    const attributeNames = new Set([...byTag.values()].flat());
    const fences = galleryFences(root);
    const subjects = new Set(fences.map((fence) => fence.subject).filter((tag) => byTag.has(tag)));

    /** `tag attr` -> the fences that set it. */
    const set = new Map();
    for (const fence of fences) {
        for (const element of markupElements(fence.body)) {
            const observed = byTag.get(element.tag);
            if (observed === undefined) {
                problems.push(`${fence.rel}: <${element.tag}> is not an element this pillar registers`);
                continue;
            }
            for (const attribute of element.attributes) {
                if (!observed.includes(attribute)) continue;
                const key = `${element.tag} ${attribute}`;
                if (!set.has(key)) set.set(key, []);
                if (!set.get(key).includes(fence)) set.get(key).push(fence);
            }
        }
    }

    // The partition. A key in none of the three is an attribute nothing decided, which
    // renders as a fence with no comment — the state that reads identical to "its name
    // suffices" and is the whole reason this is a check and not a lookup.
    for (const [key, carriers] of set) {
        const [tag, attribute] = key.split(' ');
        const places = [
            meanings[tag] !== undefined && Object.hasOwn(meanings[tag], attribute) ? 'gloss' : null,
            Object.hasOwn(ATTRIBUTE_MEANING_LEDGER, key) ? 'divergence' : null,
            Object.hasOwn(AUTHORED_MEANINGS, key) ? 'authored' : null,
        ].filter((place) => place !== null);
        if (places.length === 1) continue;
        problems.push(
            places.length === 0
                ? `<${tag} ${attribute}> (${carriers[0].rel}) is decided nowhere: no gloss, no divergence entry ` +
                      'and no authored entry. An undecided attribute renders exactly like one whose name suffices.'
                : `<${tag} ${attribute}> is decided ${places.length} times over (${places.join(', ')})`,
        );
    }

    // …and the stale direction of each ledger. An entry about an attribute no fence sets
    // any more reads as considered when it is merely forgotten.
    for (const [key, entry] of Object.entries(ATTRIBUTE_MEANING_LEDGER)) {
        const kind = LEDGER_KINDS[entry.kind];
        if (kind === undefined) {
            problems.push(
                `ATTRIBUTE_MEANING_LEDGER["${key}"]: unknown kind "${entry.kind}" — the kinds are ` +
                    `${Object.keys(LEDGER_KINDS).join(', ')}, and the kind is what says what the attribute IS.`,
            );
            continue;
        }
        if (!set.has(key)) {
            problems.push(`ATTRIBUTE_MEANING_LEDGER["${key}"]: no gallery fence sets that attribute any more`);
        }
        if (kind.girProperty && entry.girProperty === undefined) {
            problems.push(`ATTRIBUTE_MEANING_LEDGER["${key}"]: kind "${entry.kind}" must name the girProperty`);
        }
        if (!kind.girProperty && entry.girProperty !== undefined) {
            problems.push(`ATTRIBUTE_MEANING_LEDGER["${key}"]: kind "${entry.kind}" takes no girProperty`);
        }
    }
    for (const [key, entry] of Object.entries(AUTHORED_MEANINGS)) {
        const carriers = set.get(key);
        if (carriers === undefined) {
            problems.push(`AUTHORED_MEANINGS["${key}"]: no gallery fence sets that attribute any more`);
            continue;
        }
        if (!carriers.some((fence) => fence.body.includes(entry.must))) {
            problems.push(
                `AUTHORED_MEANINGS["${key}"]: no fence setting it still carries ${JSON.stringify(entry.must)}. ` +
                    'The authored gloss is what stands in for the GIR sentence here, so losing it is a loss of ' +
                    'the meaning and not a formatting change; restore it or drop the entry.',
            );
        }
    }
    for (const tag of Object.keys(meanings)) {
        for (const attribute of Object.keys(meanings[tag])) {
            if (set.has(`${tag} ${attribute}`)) continue;
            problems.push(`${MEANINGS_MODULE} glosses <${tag} ${attribute}>, which no gallery fence sets`);
        }
    }

    // The fences themselves, spliced in document order so the offsets of one read stay valid.
    let commentLines = 0;
    for (const fence of fences) {
        const rewritten = rewriteFence(fence.body, { attributeNames, meanings, problems, fence, subjects });
        commentLines += rewritten.comments;
        fence.rewritten = rewritten.body;
    }
    /** @type {Map<string, string>} */
    const files = new Map();
    for (const rel of new Set(fences.map((fence) => fence.rel))) {
        const original = readFileSync(join(root, rel), 'utf8');
        let out = '';
        let cursor = 0;
        for (const fence of fences.filter((f) => f.rel === rel).sort((a, b) => a.start - b.start)) {
            out += original.slice(cursor, fence.start) + fence.rewritten;
            cursor = fence.end;
        }
        files.set(rel, out + original.slice(cursor));
    }

    if (fences.length === 0) problems.push('no <AdwWidget> preview fence found at all — the reader is broken');
    if (set.size === 0) problems.push('no gallery fence sets an observed attribute — the join proved nothing');

    return { byTag, fences, set, subjects, files, commentLines, problems };
}

/** The counts the generated module publishes, so a hand-edited one is a red gate. */
export const meaningCounts = (meanings, applied) => ({
    set: applied.set.size,
    glossed: Object.values(meanings)
        .flatMap((entries) => Object.values(entries))
        .filter((s) => s !== null).length,
    nameSuffices: Object.values(meanings)
        .flatMap((entries) => Object.values(entries))
        .filter((s) => s === null).length,
    divergent: Object.keys(ATTRIBUTE_MEANING_LEDGER).length,
    authored: Object.keys(AUTHORED_MEANINGS).length,
    commentLines: applied.commentLines,
});

// ---------------------------------------------------------------------------
// the GIR half
// ---------------------------------------------------------------------------

/**
 * Read the GIR and decide every attribute the gallery sets.
 *
 * The half that cannot run without a `.gir`, and the half `--check` is about.
 */
export function derive(root, gir) {
    const problems = [];
    const { byTag, fences, set } = applyMeanings(root, {});
    // Every attribute the gallery sets, in the shape the module commits: tag -> attr ->
    // the GIR sentence, or `null` where the name suffices. Ledgered attributes are
    // absent — their entry is the decision.
    /** @type {Map<string, string>} */
    const sentences = new Map();
    for (const key of [...set.keys()].sort()) {
        if (Object.hasOwn(ATTRIBUTE_MEANING_LEDGER, key) || Object.hasOwn(AUTHORED_MEANINGS, key)) continue;
        const [tag, attribute] = key.split(' ');
        const found = gir.property(gtypeOfTag(tag), attribute);
        if (found === null) {
            problems.push(
                `<${tag} ${attribute}> has no GIR property of that name and no ATTRIBUTE_MEANING_LEDGER entry. ` +
                    'That is a divergence between this port and libadwaita, not an error to swallow — declare ' +
                    'what the attribute is instead.',
            );
            continue;
        }
        sentences.set(key, firstSentence(found.doc));
    }
    for (const [key, entry] of Object.entries(ATTRIBUTE_MEANING_LEDGER)) {
        const [tag, attribute] = key.split(' ');
        if (gir.property(gtypeOfTag(tag), attribute) !== null) {
            problems.push(
                `ATTRIBUTE_MEANING_LEDGER["${key}"]: ${gtypeOfTag(tag)}:${attribute} IS a GIR property now, ` +
                    `so the "${entry.kind}" entry is stale — remove it and let the gloss be generated.`,
            );
        }
        if (entry.girProperty !== undefined && gir.property(gtypeOfTag(tag), entry.girProperty) === null) {
            problems.push(
                `ATTRIBUTE_MEANING_LEDGER["${key}"]: names ${gtypeOfTag(tag)}:${entry.girProperty}, and the GIR ` +
                    'has no such property on that chain. The named property is the evidence that this is a ' +
                    'rename rather than a gap.',
            );
        }
    }

    // The shared vocabulary of exactly this corpus, then the residue rule.
    const documentFrequency = new Map();
    for (const sentence of sentences.values()) {
        if (sentence === null) continue;
        for (const word of new Set(words(sentence))) {
            documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
        }
    }
    // The grammar and presentation lists are excluded from the REPORT rather than from
    // the test: a word in both is accounted for twice, and the printed set should say
    // what the frequency floor bought on its own.
    const shared = new Set(
        [...documentFrequency.entries()]
            .filter(([, count]) => count >= SHARED_VOCABULARY_MIN_DOCS)
            .filter(([word]) => !FUNCTION_WORDS.has(word) && !PRESENTATION_WORDS.has(word))
            .map(([word]) => word),
    );
    const frequencyFloor = new Set(
        [...documentFrequency.entries()].filter(([, count]) => count >= SHARED_VOCABULARY_MIN_DOCS).map(([w]) => w),
    );

    const presentationUsed = new Set();
    /** @type {Record<string, Record<string, string | null>>} */
    const meanings = {};
    for (const [key, sentence] of sentences) {
        const [tag, attribute] = key.split(' ');
        meanings[tag] ??= {};
        if (sentence === null) {
            // A GIR property with no doc at all. Nothing to say, and nothing to hide.
            meanings[tag][attribute] = null;
            continue;
        }
        for (const word of new Set(words(sentence))) {
            if (PRESENTATION_WORDS.has(word) && !frequencyFloor.has(word)) presentationUsed.add(word);
        }
        if (residue(sentence, tag, attribute, frequencyFloor).length === 0) {
            meanings[tag][attribute] = null;
            continue;
        }
        if (sentence.includes('--')) {
            problems.push(
                `<${tag} ${attribute}>: its GIR sentence carries "--", which an HTML comment cannot ` +
                    `(${JSON.stringify(sentence)}). Ledger it or normalise the text.`,
            );
            meanings[tag][attribute] = null;
            continue;
        }
        meanings[tag][attribute] = sentence;
    }
    for (const word of PRESENTATION_WORDS) {
        if (presentationUsed.has(word)) continue;
        problems.push(
            `PRESENTATION_WORDS: "${word}" is the residue of no attribute in this corpus. A stale entry is a ` +
                'gloss suppressed by a list nobody re-measured.',
        );
    }

    const applied = applyMeanings(root, meanings);
    return { meanings, shared, byTag, fences, applied, problems: [...problems, ...applied.problems] };
}

/** The generated module: every attribute the gallery sets, its verdict, and the counts. */
function meaningsModule({ meanings, provenance, counts }) {
    const literal = (value) => (value === null ? 'null' : `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`);
    const rows = Object.keys(meanings)
        .sort()
        .map(
            (tag) =>
                `    '${tag}': {\n${Object.keys(meanings[tag])
                    .sort()
                    .map((attribute) => `        '${attribute}': ${literal(meanings[tag][attribute])},`)
                    .join('\n')}\n    },`,
        )
        .join('\n');
    const divergences = Object.entries(ATTRIBUTE_MEANING_LEDGER)
        .map(([key, entry]) => `    '${key}': '${entry.kind}',`)
        .sort()
        .join('\n');
    const authored = Object.keys(AUTHORED_MEANINGS)
        .sort()
        .map((key) => `    '${key}',`)
        .join('\n');
    // Emitted field by field rather than through `JSON.stringify` + a quote swap: this
    // file's bytes are compared EXACTLY by two checks and nothing formats it, so the
    // trailing commas and the quoting have to be the config's own from the start.
    const object = (entries, indent) =>
        `{\n${entries.map(([key, value]) => `${indent}    ${key}: ${value},`).join('\n')}\n${indent}}`;
    return `// GENERATED by scripts/generate-adwaita-attribute-comments.mjs — do not edit.
//
// What every attribute the Adwaita gallery's HTML fences SET means, read out of the GIR
// property it mirrors. A sentence is the comment that fence carries; \`null\` is "the
// attribute's own name says it already", and the fence carries no comment for it.
//
// WHY THE TEXT IS COMMITTED TWICE. It is in the fences, which is what ships and what a
// reader copies. It is here so the jobs with NO GIR can still fail on a hand-edited or
// deleted comment: \`check-generated-website-data.mjs\` (arm 12) runs on \`checkout\` +
// \`setup-node\` on Linux and Windows and holds every fence against these bytes, while the
// generator's own \`--check\` re-derives them from the GIR in \`main.yml\`'s \`tree-checks\`
// image. Two checks, one text, and neither can go green while the other's half is wrong.

/** Tag -> attribute -> its GIR gloss, or \`null\` where the attribute's name suffices. */
export const ADWAITA_ATTRIBUTE_MEANINGS = {
${rows}
};

/**
 * The attributes a fence sets that have NO GIR property of that name, and what each is
 * instead — a declared divergence between this port's markup surface and libadwaita's
 * property surface. The reasons are in the generator's \`ATTRIBUTE_MEANING_LEDGER\`; none
 * of them carries a generated gloss.
 */
export const ADWAITA_ATTRIBUTE_DIVERGENCES = {
${divergences}
};

/** Attributes whose gloss is AUTHORED on the page, because the GIR's is not true of the markup. */
export const ADWAITA_ATTRIBUTE_AUTHORED = [
${authored}
];

/** What the line between "glossed" and "the name says it" cost, measured. */
export const ADWAITA_ATTRIBUTE_MEANING_COUNTS = ${object(
        Object.entries(counts).map(([key, value]) => [key, String(value)]),
        '',
    )};

/**
 * The GIR these sentences were read from: the namespace and the highest member version it
 * declares, which is the closest thing a \`.gir\` carries to a library version.
 *
 * NOT the directory it was found in. A distro install and a flatpak SDK differ there, and
 * the byte check would then fail for the machine instead of for the data.
 */
export const ADWAITA_ATTRIBUTE_MEANING_PROVENANCE = [
${provenance
    .map(
        (entry) =>
            `    ${object(
                [
                    ['namespace', `'${entry.namespace}'`],
                    ['version', entry.version === null ? 'null' : `'${entry.version}'`],
                ],
                '    ',
            )},`,
    )
    .join('\n')}
];
`;
}

/**
 * A generator that WRITES on import rewrites the very files the gate that imports it is
 * about to check, with the gate's own `process.argv` — a shape this repository has paid
 * for twice. So the writer runs only when this file IS the program.
 */
const RUN_AS_PROGRAM = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
const CHECK = process.argv.includes('--check');

/**
 * What the COMMITTED text was read from, scraped out of the generated module rather than
 * imported: this file is that module's writer, and importing its own output would make a
 * missing or half-written module an import error instead of a message.
 */
const ADWAITA_MEANING_PROVENANCE_HINT = (() => {
    try {
        const text = readFileSync(join(ROOT, MEANINGS_MODULE), 'utf8');
        const found = [...text.matchAll(/namespace: '([^']+)',\s*\n\s*version: '([^']+)'/g)];
        return found.length === 0
            ? 'an unrecorded GIR'
            : found.map(([, ns, version]) => `${ns} ${version}`).join(' / ');
    } catch {
        return 'an unrecorded GIR';
    }
})();

if (RUN_AS_PROGRAM) {
    const dir = findGirDirectory();
    if (dir === null) {
        console.error(
            'generate-adwaita-attribute-comments: no directory carries both Adw-1.gir and Gtk-4.0.gir.\n' +
                'Searched, in order:\n' +
                `${girDirectories()
                    .map((candidate) => `  - ${candidate}`)
                    .join('\n')}\n` +
                'On Fedora that is `gtk4-devel` + `libadwaita-devel`; an `org.gnome.Sdk` flatpak carries one too.\n' +
                'Set GJSIFY_GIR_DIRS to override. An exit and not a skip: the doc text is the only thing this\n' +
                'generator reads, so a run without it would check nothing and report that it passed.',
        );
        process.exit(1);
    }
    const gir = readGir(dir);
    const derived = derive(ROOT, gir);
    const counts = meaningCounts(derived.meanings, derived.applied);
    const module = meaningsModule({ meanings: derived.meanings, provenance: gir.provenance, counts });

    // The PROVENANCE rides on every failure, not only on the success line. A machine
    // whose libadwaita predates a widget reports that widget's attributes as having no
    // GIR property — measured against an `org.gnome.Sdk` flatpak two releases back
    // (Adw 1.8 / Gtk 4.20), which reads `<adw-sidebar mode>` as a divergence because
    // `AdwSidebar` arrived in 1.8's successor. Without the version in the message that
    // is indistinguishable from a real finding, and the reader repairs the wrong thing.
    const read = `GIR ${gir.provenance.map((entry) => `${entry.namespace} ${entry.version}`).join(' / ')} from ${dir}`;
    if (derived.problems.length > 0) {
        console.error(`generate-adwaita-attribute-comments: the join does not hold (${read}):`);
        for (const problem of derived.problems) console.error(`  ${problem}`);
        console.error(
            `\n  If that GIR is older than the one ${MEANINGS_MODULE} was generated against ` +
                `(${ADWAITA_MEANING_PROVENANCE_HINT}), the finding is the version, not the data.`,
        );
        process.exit(1);
    }

    const outputs = [...derived.applied.files.entries(), [MEANINGS_MODULE, module]];
    const drift = [];
    for (const [rel, content] of outputs) {
        const abs = join(ROOT, rel);
        const have = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
        if (have === content) continue;
        if (CHECK) {
            drift.push(`${rel}: ${have === null ? 'missing' : 'out of date'}`);
            continue;
        }
        writeFileSync(abs, content);
    }

    const summary =
        `${counts.set} attribute(s) set by ${derived.fences.length} fence(s): ${counts.glossed} glossed, ` +
        `${counts.nameSuffices} where the name suffices, ${counts.divergent} with no GIR property, ` +
        `${counts.authored} authored — ${counts.commentLines} comment line(s), GIR ` +
        `${gir.provenance.map((entry) => `${entry.namespace} ${entry.version}`).join(' / ')} from ${dir}`;

    if (CHECK) {
        if (drift.length > 0) {
            console.error(`generate-adwaita-attribute-comments: committed output is stale (${read}):`);
            for (const line of drift) console.error(`  ${line}`);
            console.error(
                '\nRe-run: node scripts/generate-adwaita-attribute-comments.mjs\n' +
                    `  The committed text was read from ${ADWAITA_MEANING_PROVENANCE_HINT}. A different version ` +
                    'here is version skew, and the diff is then the upstream doc change.',
            );
            process.exit(1);
        }
        console.log(`generate-adwaita-attribute-comments --check: OK. ${summary}`);
    } else {
        console.log(`generate-adwaita-attribute-comments: ${summary}`);
        console.log(
            `  shared vocabulary (>= ${SHARED_VOCABULARY_MIN_DOCS} docs): ${[...derived.shared].sort().join(' ')}`,
        );
    }
}
