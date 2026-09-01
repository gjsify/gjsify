// The theming seam: an application's OWN GTK CSS document, and Adwaita's named
// colours set from its design tokens.
//
// `sheet.ts` owns the GENERATED document — one rule per distinct utility set, keyed
// by a content hash — and deliberately owns nothing else. What it left with no
// answer is the other half an application needs: a stylesheet the project wrote, and
// a palette. This module is that half, and it is a REGISTRY rather than a setter
// because the shape it has to fit is several named themes with one selected at
// runtime, not one document installed at startup.
//
// THREE DECISIONS, ALL MEASURED ON gtk 4.22.4 / libadwaita 1.9.3. Every one of them
// is a case where the plausible guess is wrong.
//
// 1. **`Adw.StyleManager:accent-color` cannot carry a design token's accent — on
//    ANY runtime — because it is an ENUM.** `AdwAccentColor` has nine members
//    (BLUE, TEAL, GREEN, YELLOW, ORANGE, RED, PINK, PURPLE, SLATE, measured), so
//    `rgb(17 34 51)` has no representation in it. The accent is therefore a CSS
//    custom property: `--accent-bg-color` and its 47 siblings, redefined on
//    `:root`, which is what Adwaita's own rules resolve against. Measured end to
//    end — a `:root` override changes what a `var()` reader sees, and therefore
//    what every Adwaita rule reading the same name paints.
//
//    IT IS ALSO READ-ONLY, on every closure measured — and the "writability varies
//    by runtime" story this module briefly told is kept as an INCIDENT, because the
//    wrong reason travelled further than the right one. libadwaita installs the
//    ParamSpec `G_PARAM_READABLE | G_PARAM_STATIC_STRINGS`, no WRITABLE flag, since
//    1.6 and still at 1.10.alpha.1 (`refs/libadwaita/src/adw-style-manager.c`), and
//    documents it as the current SYSTEM accent; assigning throws `Property
//    AdwStyleManager.accent-color is not writable`. `theme.spec.ts` prints the flag
//    on every run: read-only on linux/1.9.3 and on all three published runtime
//    bundles (win32-x64, darwin-x64, darwin-arm64).
//
//    What looked like "writable on darwin" was that leg going red for a different
//    reason. The vector read the spec through `GObject.Object.find_property.call(…)`,
//    which answers null over the reverse bridge (#1438), so what failed was the
//    `spec === null` assertion two lines ABOVE the flag — the flag was never read
//    there at all. A red assertion on another operating system is not by itself a
//    fact about that operating system, and reading it as one put a wrong premise
//    into a product decision and onto a published page before CI could contradict
//    it.
//
//    So the accent is a custom property because of the ENUM, which holds on every
//    runtime whatever the flag says, and that ordering is deliberate: a conclusion
//    resting on a property's writability breaks the moment someone measures the flag
//    somewhere else, and it invites "just set the property" — which reaches nine
//    colours where a flag ever allowed it and silently ignores the application's own
//    accent token everywhere else. Nothing here reads or writes that property, and
//    nothing branches on its writability.
//
//    The legacy `@define-color accent_bg_color …` spelling still works too, and is
//    NOT what this module emits: `--accent-bg-color` is the current one, and mixing
//    the two spellings is how you get a definition nothing reads. Which is also why
//    an underscored name is a named refusal here rather than a custom property that
//    silently defines nothing.
//
// 2. **The priority is the whole design, and it is not APPLICATION.** Measured, in
//    both directions:
//
//      - libadwaita's own stylesheet sits at exactly `STYLE_PROVIDER_PRIORITY_THEME`
//        (200): an override at 199 loses to it, one at 201 wins, and one at 200 wins
//        ONLY by being added later. So a theme document must be strictly above 200
//        or its effect depends on load order — which is not a design, it is a race.
//      - the generated sheet is at `STYLE_PROVIDER_PRIORITY_APPLICATION` (600). At
//        that same priority the order decides again, and a theme installed after the
//        sheet CLOBBERS the author's utility classes: `className="text-…"` silently
//        loses to a theme rule. Measured.
//      - priority outranks specificity: a low-specificity rule at 400 beats a
//        high-specificity one at 200. So "the theme is more specific" cannot be used
//        to reason about this, and the number is the only lever.
//
//    `STYLE_PROVIDER_PRIORITY_SETTINGS` (400) is GTK's own named value in the one
//    gap that satisfies both constraints, and measured to do so order-independently:
//    a theme at 400 beats Adwaita whichever is installed first, and loses to the
//    generated sheet whichever is installed first. A utility class always wins over
//    the theme, which is the right way round — the class is what the author wrote at
//    the element.
//
// 3. **One provider, whose document is REPLACED.** The obvious switch is to remove
//    the old provider and add the new one; measured, both work. Reloading a single
//    installed provider also works, including reloading it to the empty string,
//    which restores Adwaita's own values exactly. One provider is chosen because it
//    is installed once and can therefore never be installed at the wrong position
//    relative to the generated sheet, and because "which providers are on the
//    display" stops depending on how many times a user has switched theme.
//
// A MEASUREMENT TRAP worth writing down, because it cost a wrong conclusion: reading
// the switch back through a `Gtk.WidgetPaintable` render node reports the OLD colour
// after a provider is removed — the paintable's node is cached and a removal does
// not invalidate it, while a subsequent add does. That reads exactly like "removal
// does not work" and is not. Resolving `var(--name)` through a widget's `get_color()`
// shows the removal taking effect immediately. Assert the resolved value, never the
// pixel.

import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import { assertContained, installProvider, StyleSheetError } from './document.js';

/**
 * Where a theme document is installed. See decision 2 for why it is this number.
 *
 * Exported because it is the fact a reader has to check against their own providers,
 * and because a consumer installing a fourth document needs to know what it has to
 * sit between.
 */
export const THEME_PROVIDER_PRIORITY: number = Gtk.STYLE_PROVIDER_PRIORITY_SETTINGS;

/**
 * The named colours libadwaita defines, measured rather than read.
 *
 * MEASURED on libadwaita 1.9.3 by resolving `var(--<name>, <sentinel>)` on a real
 * widget and checking the sentinel did NOT come back — the only test that
 * distinguishes "the name exists" from "the name is a typo that defines nothing".
 * `theme.spec.ts` re-measures both directions against the libadwaita that is
 * running, so a release that renames one goes red here rather than in a window.
 *
 * The list is what a theme may OVERRIDE, and overriding a name libadwaita does not
 * define is the exact silent failure this set exists to catch: `--acccent-bg-color`
 * is a perfectly valid custom property that nothing ever reads.
 */
export const ADWAITA_NAMED_COLORS: readonly string[] = [
    'accent-color',
    'accent-bg-color',
    'accent-fg-color',
    'destructive-color',
    'destructive-bg-color',
    'destructive-fg-color',
    'success-color',
    'success-bg-color',
    'success-fg-color',
    'warning-color',
    'warning-bg-color',
    'warning-fg-color',
    'error-color',
    'error-bg-color',
    'error-fg-color',
    'window-bg-color',
    'window-fg-color',
    'view-bg-color',
    'view-fg-color',
    'headerbar-bg-color',
    'headerbar-fg-color',
    'headerbar-border-color',
    'headerbar-backdrop-color',
    'headerbar-shade-color',
    'headerbar-darker-shade-color',
    'sidebar-bg-color',
    'sidebar-fg-color',
    'sidebar-backdrop-color',
    'sidebar-shade-color',
    'sidebar-border-color',
    'secondary-sidebar-bg-color',
    'secondary-sidebar-fg-color',
    'card-bg-color',
    'card-fg-color',
    'card-shade-color',
    'dialog-bg-color',
    'dialog-fg-color',
    'popover-bg-color',
    'popover-fg-color',
    'popover-shade-color',
    'thumbnail-bg-color',
    'thumbnail-fg-color',
    'shade-color',
    'scrollbar-outline-color',
    'overview-bg-color',
    'overview-fg-color',
    'active-toggle-bg-color',
    'active-toggle-fg-color',
];

/**
 * Names that are NOT custom properties, and the claim each one carries.
 *
 * Without this direction the set above could name every string in GTK and still
 * pass. `borders` is the interesting row: it is a real Adwaita colour under the
 * LEGACY `@define-color` mechanism and is not a CSS variable, which is exactly the
 * confusion decision 1 is about. `accent_bg_color` is the same point in the other
 * spelling — the underscored legacy name of a variable that does exist.
 */
export const NOT_ADWAITA_NAMED_COLORS: readonly string[] = [
    'borders',
    'accent_bg_color',
    'window_bg_color',
    'acccent-bg-color',
];

/**
 * Membership test for {@link ADWAITA_NAMED_COLORS}, derived and not exported.
 *
 * One exported name for one table: a second public spelling of the same 48 strings
 * is a second thing to keep in step, and the only reader that needs the set is
 * `assertNamedColor` below.
 */
const IS_ADWAITA_NAMED_COLOR: ReadonlySet<string> = new Set(ADWAITA_NAMED_COLORS);

/** One named look: a GTK CSS document, a palette, and which desktops default to it. */
export interface Theme {
    /** How the application asks for it. Also what a refusal names. */
    readonly name: string;
    /**
     * The application's own GTK CSS document.
     *
     * Goes through the same containment probe as a generated rule, and for a
     * stronger reason: this is the document this package did not write.
     */
    readonly css?: string;
    /**
     * Adwaita named colours to redefine, WITHOUT the `--` prefix.
     *
     * `{ 'accent-bg-color': 'rgb(53 132 228)' }`. Emitted as a `:root` block ahead of
     * {@link Theme.css}, so a rule in {@link Theme.css} redefining one of these names
     * WINS — the last definition in a document is the one that applies.
     */
    readonly namedColors?: Readonly<Record<string, string>>;
    /**
     * The `process.platform` values this theme is the default for.
     *
     * Data on the theme rather than a table in the registry, because "this look
     * belongs on macOS" is a fact about the look.
     */
    readonly defaultOn?: readonly string[];
}

/**
 * The one theme shipped now, and it deliberately changes nothing.
 *
 * A GTK application should look like the desktop it is running on, and the accent is
 * the user's — they picked it in Settings and expect their applications to use it.
 * So the neutral theme is an EMPTY document, and that is a statement rather than a
 * placeholder: selecting it is how an application returns to Adwaita exactly, which
 * is measurably true because reloading the provider to the empty string restores
 * every named colour to libadwaita's own value.
 *
 * It is also what makes the registry useful with one theme registered: there is
 * always something to switch back TO.
 */
export const NEUTRAL_THEME: Theme = {
    name: 'neutral',
    defaultOn: ['linux', 'darwin', 'win32'],
};

export interface ThemeRegistryOptions {
    /**
     * Where the provider is installed. Omitted means the default display — the right
     * answer for an application and the wrong one for a test, which is why it is
     * injectable at all.
     */
    readonly display?: Gdk.Display | null;
    /** Provider priority. Defaults to {@link THEME_PROVIDER_PRIORITY}; see decision 2. */
    readonly priority?: number;
}

/**
 * Named themes, one selected, swapped on a single provider.
 *
 * NOT a module-level singleton, unlike the token configuration one layer up. A
 * registry holds a `Gdk.Display` and a `Gtk.CssProvider`, so a test that could not
 * make its own would have to share the session's — and the registry is exactly the
 * object whose whole behaviour is "what is installed on the display right now".
 */
export class ThemeRegistry {
    readonly #provider = new Gtk.CssProvider();
    readonly #themes = new Map<string, Theme>();
    readonly #options: ThemeRegistryOptions;
    /** The display the provider is on, or null while it is on none. */
    #installedOn: Gdk.Display | null = null;
    #current: string | null = null;

    constructor(options: ThemeRegistryOptions = {}) {
        this.#options = options;
    }

    /**
     * Add a theme, refusing anything that would be a silent no-op.
     *
     * The document is PROBED here rather than at selection, so the error names the
     * line that declared the theme instead of the line that switched to it — which
     * may be a user clicking a row in the application's settings, hours later.
     */
    register(theme: Theme): this {
        if (theme.name === '') throw new StyleSheetError('a theme needs a name — an unnamed one cannot be selected');
        if (this.#themes.has(theme.name)) {
            throw new StyleSheetError(
                `a theme named "${theme.name}" is already registered. Re-registering would silently replace it, and a look that changed without the name changing is the hardest kind to attribute`,
            );
        }
        for (const name of Object.keys(theme.namedColors ?? {})) {
            assertNamedColor(theme.name, name);
        }
        const document = this.documentOf(theme);
        if (document !== '') assertContained(document, `theme "${theme.name}"`);
        this.#themes.set(theme.name, theme);
        return this;
    }

    /** The registered names, in registration order. */
    get names(): readonly string[] {
        return [...this.#themes.keys()];
    }

    /** The selected theme's name, or null before anything is selected. */
    get current(): string | null {
        return this.#current;
    }

    /** The document a theme produces. Exposed because a test that cannot read it proves nothing. */
    documentOf(theme: Theme): string {
        const colors = Object.entries(theme.namedColors ?? {});
        const parts: string[] = [];
        // The palette FIRST, so a theme's own `css` can redefine a name its own
        // palette set: at equal specificity the LAST definition in a document wins.
        // NOT so its rules can read the palette — measured, `var()` resolves the same
        // whichever comes first, because a custom property computes independently of
        // source order.
        if (colors.length > 0) {
            parts.push(`:root {\n${colors.map(([name, value]) => `    --${name}: ${value};`).join('\n')}\n}`);
        }
        if (theme.css !== undefined && theme.css.trim() !== '') parts.push(theme.css.trim());
        return parts.join('\n');
    }

    /**
     * Switch to a registered theme, replacing whatever was loaded.
     *
     * Idempotent, and cheap enough to call from a settings row's handler: the
     * document was probed at registration, so this is one `load_from_string` plus, on
     * the first call only, one `add_provider_for_display`.
     */
    select(name: string): void {
        const theme = this.#themes.get(name);
        if (theme === undefined) {
            throw new StyleSheetError(
                `"${name}" is not a registered theme. Known: ${this.names.join(', ') || '(none registered)'}`,
            );
        }
        this.#provider.load_from_string(this.documentOf(theme));
        this.#current = name;
        this.#install();
    }

    /**
     * Select the theme that declares itself the default for `platform`.
     *
     * The platform is a PARAMETER and this module never reads `process.platform`
     * itself — the same discipline the intent seam one layer up argues for. It keeps
     * a `process` read (and the OS declaration that comes with one) out of a package
     * whose job is GTK, and it lets a settings screen preview another desktop's look
     * by passing that desktop's name.
     *
     * The last registered match wins, so an application registering its own theme
     * after the neutral one gets its own.
     */
    selectDefault(platform: string): void {
        let chosen: string | null = null;
        for (const [name, theme] of this.#themes) {
            if (theme.defaultOn?.includes(platform) === true) chosen = name;
        }
        if (chosen === null) {
            throw new StyleSheetError(
                `no registered theme declares itself the default on "${platform}". Registered: ${
                    this.names.join(', ') || '(none)'
                }. Give one a \`defaultOn\`, or call select() with a name`,
            );
        }
        this.select(chosen);
    }

    /**
     * Take the theme document off the display, leaving nothing behind.
     *
     * Selecting the neutral theme reloads the document to empty, which is all an
     * application needs. It is NOT all a TEST needs, and the difference was measured
     * in this file's own spec: a vector that read "libadwaita's own accent" read the
     * PREVIOUS vector's green instead, because that registry's provider was still on
     * the shared display with a `--accent-bg-color` in it — and the assertion named
     * "back to Adwaita exactly" then passed against the green. Ownership belongs with
     * whoever created the registry, so there has to be a way to give it up.
     *
     * The provider is removed from the display it was INSTALLED on rather than from
     * whatever `Gdk.Display.get_default()` answers now. A later `select()` installs
     * again: position relative to the generated sheet is decided by the priority
     * numbers, not by insertion order, so re-installing cannot land in the wrong
     * place (decision 2).
     */
    dispose(): void {
        if (this.#installedOn === null) return;
        Gtk.StyleContext.remove_provider_for_display(this.#installedOn, this.#provider);
        this.#installedOn = null;
        this.#current = null;
    }

    #install(): void {
        if (this.#installedOn !== null) return;
        this.#installedOn = installProvider(
            this.#provider,
            'the theme',
            this.#options.display,
            this.#options.priority ?? THEME_PROVIDER_PRIORITY,
        );
    }
}

/** A named colour that would define nothing, refused with the reason it would. */
function assertNamedColor(theme: string, name: string): void {
    if (IS_ADWAITA_NAMED_COLOR.has(name)) return;
    const underscored = name.includes('_');
    throw new StyleSheetError(
        `theme "${theme}" sets "${name}", which libadwaita does not define as a named colour. ` +
            (underscored
                ? `Underscores are the LEGACY \`@define-color ${name}\` spelling, which is a different mechanism: emitted as a custom property it defines something nothing reads. The current spelling is "${name.replace(/_/g, '-')}"`
                : 'A custom property nobody reads is a theme that silently does nothing, which is why this is refused rather than emitted') +
            `. Known: ${[...ADWAITA_NAMED_COLORS].sort().join(', ')}`,
    );
}
