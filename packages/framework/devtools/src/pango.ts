// @gjsify/devtools — the Adwaita markup trap, as a check a caller can run.
//
// WHY THIS EXISTS: a widget property that Pango parses as markup turns a bare `&` or `<` into a
// PARSE ERROR, and the label then renders BLANK. No exception, no failed assertion, no stderr —
// just an empty label, which is only noticed when someone opens a screenshot of the app. German
// UI text is full of `&` ("Kosten & Förderung"), so this is a recurring class rather than a typo.
// It was found in a consumer app by reading screenshots, which is exactly the kind of defect no
// existing check catches: a blank label is a RENDERED outcome, not a type error.
//
// SO IT IS A FUNCTION AND NOT A LINT RULE. The one-line heuristic belongs to whoever wants it —
// an oxlint rule, a `check` script, a test assertion — and this package owns the part that is hard
// to get right and easy to get wrong: WHICH properties are markup sinks. That list is verified
// against the `@girs/adw-1` documentation where it says anything at all, and the two classes the
// GIR contradicts are excluded below. A rule built on a guessed sink list is worse than no rule.
//
// WHAT IT DOES NOT SEE: a value composed at runtime. Those need `GLib.markup_escape_text()` (or
// `Adw`-aware escaping) at the point of use — so the check is a first pass over LITERALS, never a
// claim that a rendered string is clean.

/**
 * Adw properties whose value Pango parses as markup, as `ClassName` → the properties it applies to.
 *
 * The `use-markup` / `*-use-markup` properties are the documented switches, and their DEFAULTS are
 * what decide membership. Read out of `@girs/adw-1`:
 *
 * · `AdwPreferencesRow:use-markup` — `@default true`, "whether to use Pango markup for the title
 *   label … subclasses may also use it for other labels, such as subtitle". So every
 *   `AdwPreferencesRow` subclass has markup `title` AND `subtitle` unless it opts out.
 * · `AdwBanner:use-markup` and `AdwToast:use-markup` — both `@default true`, for the title.
 * · `AdwAlertDialog:heading-use-markup` and `:body-use-markup` — both **`@default false`**, so
 *   `heading` and `body` are PLAIN TEXT by default and marking them raw would be a false finding.
 *   This is where a sink list copied from a consumer's own script goes wrong.
 * · `AdwMessageDialog` (deprecated since 1.6) is absent for the same practical reason: its heading
 *   and body went through markup, but it has no toggle to read a default off and no reason to be
 *   written in new code.
 * · `AdwPreferencesGroup`, `AdwPreferencesPage` and `AdwStatusPage` carry no toggle and no GIR note;
 *   their titles and descriptions are markup in libadwaita's implementation. Included, and noted
 *   here as the one group not backed by GIR documentation, so a future correction has a home.
 * · `AdwAboutDialog`/`AdwAboutWindow` — the GIR documents `comments` ("can also contain links and
 *   Pango markup") and `license` ("can contain Pango markup and links") in prose. `debug_info` is
 *   in the same class and explicitly cannot, which is why it is not here.
 *
 * `Gtk.Label:label` and `AdwWindowTitle:title` are plain text and are deliberately absent: a rule
 * that reports `&` in those teaches its audience to switch it off.
 */
export const PANGO_MARKUP_SINKS: Readonly<Record<string, readonly string[]>> = {
    AdwAboutDialog: ['comments', 'license'],
    AdwAboutWindow: ['comments', 'license'],
    AdwActionRow: ['title', 'subtitle'],
    AdwBanner: ['title'],
    AdwComboRow: ['title', 'subtitle'],
    AdwEntryRow: ['title', 'subtitle'],
    AdwExpanderRow: ['title', 'subtitle'],
    AdwPreferencesGroup: ['title', 'description'],
    AdwPreferencesPage: ['title', 'description'],
    AdwSpinRow: ['title', 'subtitle'],
    AdwStatusPage: ['title', 'description'],
    AdwSwitchRow: ['title', 'subtitle'],
    AdwToast: ['title'],
};

/**
 * A `&` that does not open an entity, or a `<` that does not open a tag.
 *
 * Deliberately wider than the five XML entities: Pango accepts any named entity (`&nbsp;` is
 * ordinary) and both numeric forms, so a narrower pattern would report text that renders correctly.
 * The `<` side likewise accepts a tag (`<b>`, `</b>`, `<span …>`) — markup is a legal string to
 * write, it is only the RAW characters that abort the parse.
 */
const RAW_MARKUP = /&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)|<(?![a-zA-Z/!?])/;

/** The raw markup characters in `text`, deduplicated; empty when the string parses as markup. */
export function rawPangoMarkupIn(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(RAW_MARKUP)) found.add(match[0]);
    return [...found];
}

/**
 * Would `text` render BLANK as an Adw markup property?
 *
 * The single-character cases are answered first because they are the ones that read as deliberate:
 * an author who wrote `"&"` or `"<"` meant them, and flagging it teaches nothing.
 */
export function hasRawPangoMarkup(text: string): boolean {
    if (text.length < 2) return false;
    return RAW_MARKUP.test(text);
}

/** Is `property` of `className` (e.g. `'AdwActionRow'`, `'title'`) a markup sink? */
export function isPangoMarkupSink(className: string, property: string): boolean {
    const properties = PANGO_MARKUP_SINKS[className];
    return properties ? properties.includes(property) : false;
}
