// The theming seam, against the GTK and the libadwaita that are running.
//
// Almost nothing in `theme.ts` is a decision this file can check by comparison. Its
// three load-bearing claims are all claims about ANOTHER program's cascade —
// which provider wins, whether a named colour exists, whether a switch takes effect
// — and a claim nothing re-checks is one that decays. So the vectors here mostly
// MEASURE, in both directions, and the reading is done the one way that is sound.
//
// HOW A RESOLVED COLOUR IS READ, AND WHY NOT THE OTHER WAY. Every vector resolves
// `var(--name)` into a `color` on a probe widget and reads `widget.get_color()`. The
// tempting alternative — render the widget through a `Gtk.WidgetPaintable` and sample
// a pixel — reports the OLD colour after a provider is removed, because the
// paintable's render node is cached and a removal does not invalidate it while a
// subsequent add does. That reads exactly like "removing a provider does not work",
// which is false. Measured, and it cost a wrong conclusion before it was caught: the
// resolved value is the truth, the pixel is a picture of a cache.

import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { StyleSheetError } from './document.js';
import { paramSpecs } from '../props.js';
import { StyleSheet } from './sheet.js';
import {
    ADWAITA_NAMED_COLOR_PROBES,
    NEUTRAL_THEME,
    NOT_ADWAITA_NAMED_COLORS,
    THEME_PROVIDER_PRIORITY,
    ThemeRegistry,
    type Theme,
} from './theme.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { installDiagnosticsGate } from '../conformance/index.js';

const threw = (fn: () => unknown): StyleSheetError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof StyleSheetError) return error;
        throw error;
    }
    throw new Error('expected a StyleSheetError, nothing was thrown');
};

/** The sentinel a `var()` fallback returns when the name is not defined anywhere. */
const SENTINEL = 'rgb(9,9,9)';

export default async () => {
    await on(GTK_HOSTS, async () => {
        // `Adw.init()` and not `Gtk.init()`: libadwaita's stylesheet is the other
        // party in every priority vector below, and without it the display carries no
        // theme provider at 200 for a theme document to have to beat.
        Adw.init();
        const diagnostics = installDiagnosticsGate();
        const display = Gdk.Display.get_default();

        // ONE window and ONE probe widget for the whole file. A resolved colour needs
        // a widget that is rooted and realised, and presenting a window per vector is
        // both slow and a source of diagnostics that belong to nothing.
        const window = new Gtk.Window();
        const probe = new Gtk.Label({ label: 'x' });
        probe.add_css_class('gjsify-theme-probe');
        window.set_child(probe);
        window.present();

        /** Read `--name` as this widget resolves it, or null when nothing defines it. */
        const reader = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(display, reader, Gtk.STYLE_PROVIDER_PRIORITY_USER + 100);
        const resolved = (name: string): string | null => {
            reader.load_from_string(`.gjsify-theme-probe { color: var(--${name}, rgb(9 9 9)); }`);
            const value = probe.get_color().to_string();
            return value === SENTINEL ? null : value;
        };
        /** Read a plain declaration the same way, for the priority contests. */
        const colour = (): string => {
            reader.load_from_string('');
            return probe.get_color().to_string();
        };

        const provider = (css: string, priority: number): Gtk.CssProvider => {
            const one = new Gtk.CssProvider();
            one.load_from_string(css);
            Gtk.StyleContext.add_provider_for_display(display, one, priority);
            return one;
        };
        const drop = (one: Gtk.CssProvider): void => Gtk.StyleContext.remove_provider_for_display(display, one);

        // libadwaita's own accent, read before any theme is installed. The reset at
        // the end of the accent vector is asserted against it, so "put it back" is a
        // checked claim rather than a hopeful call.
        const adwaitaAccent = resolved('accent-bg-color');

        await gated(diagnostics, 'the Adwaita named colours, re-measured', async () => {
            await it('defines every name the table claims', async () => {
                // The reason this is measured rather than read: a name libadwaita does
                // not define is a perfectly valid custom property that nothing ever
                // reads, so a theme setting it is a silent no-op.
                const undefinedNames = ADWAITA_NAMED_COLOR_PROBES.filter((name) => resolved(name) === null);
                expect(undefinedNames).toStrictEqual([]);
            });

            await it('defines NONE of the names the table claims are absent', async () => {
                // Without this direction the set could name every string in GTK and
                // still pass. `borders` is the interesting row — a real Adwaita colour
                // under the LEGACY `@define-color` mechanism and not a CSS variable,
                // which is the confusion the whole named-colour refusal is about.
                const present = NOT_ADWAITA_NAMED_COLORS.filter((name) => resolved(name) !== null);
                expect(present).toStrictEqual([]);
            });

            await it('sets an accent no enum could carry, whatever the property allows', async () => {
                // WHAT THIS VECTOR REPLACED ASSERTED `Adw.StyleManager:accent-color`
                // READ-ONLY, and went red on the darwin leg — which was read as "the
                // property is writable there" and is NOT what happened. That leg read
                // the spec through `GObject.Object.find_property.call(…)`, which
                // answers null over the reverse bridge, so the assertion that failed
                // was the `spec === null` one two lines above the flag: the flag was
                // never read there at all. Measured since, on every closure this suite
                // runs on — linux/1.9.3, win32-x64, darwin-x64, darwin-arm64 — the
                // property is read-only, and libadwaita installs the ParamSpec
                // `G_PARAM_READABLE` only, since 1.6 and still at 1.10.alpha.1. A red
                // assertion on another OS is not by itself a fact about that OS.
                //
                // The vector still does not assert the flag, and the reason survives
                // the correction: a ParamSpec FLAG is a fact about the installed
                // libadwaita, which a later release may add to. The claim that holds
                // on every runtime is about the EFFECT, and it is the stronger reason
                // anyway: `accent-color` is an ENUM — `AdwAccentColor`, nine named
                // accents (measured) — and not a colour. So on NO runtime, writable or
                // not, can it carry a design token's `rgb(17 34 51)`. Setting the
                // accent as a custom property is therefore not a workaround for a
                // read-only property; it is the only mechanism that can express the
                // value at all.
                // READ THROUGH THE HOST'S OWN READER, and that is the fix for a
                // SECOND defect this vector carried — one the first was masking.
                // `GObject.Object.find_property.call(SomeClass, …)` returns a spec
                // under gjs and NULL over the reverse bridge (issue #1438: the gap is
                // specifically the `.call()` form against a class the process has not
                // realised, because node-gi's class proxy takes no `g_type_class_ref`;
                // the same call as `SomeClass.find_property(…)` answers on both).
                // `paramSpecs` is the direct form, already used by `gtk-props.spec.ts`,
                // so this is one reader for the package rather than a third spelling.
                const spec = paramSpecs(Adw.StyleManager, 'AdwStyleManager').get('accent-color');
                expect(spec === undefined).toBe(false);

                // Asserted, and this one is safe where the flag is not: a property
                // GAINING a setter is an additive change libadwaita may make, while
                // changing its value type from an enum to a colour would break its own
                // ABI. Different risk class, so it can carry the reason.
                expect(GObject.type_is_a((spec as GObject.ParamSpec).value_type, GObject.TYPE_ENUM)).toBe(true);

                // REPORTED, never asserted, and the log line is where a future change
                // becomes visible without this suite claiming the flag is an invariant
                // of the layer. Read-only on every closure measured so far.
                const writable = ((spec as GObject.ParamSpec).flags & GObject.ParamFlags.WRITABLE) !== 0;
                console.log(
                    `      [measured] Adw.StyleManager:accent-color is ${writable ? 'WRITABLE' : 'read-only'} here — ` +
                        'a ParamSpec flag is a fact about the installed libadwaita, and this layer depends on neither answer',
                );

                // An accent that is not one of the nine, set through the registry and
                // resolved by the same cascade every Adwaita rule reads. THIS is what
                // goes red if someone ever rewires the seam to the property.
                const registry = new ThemeRegistry({ display });
                registry.register({ name: 'token-accent', namedColors: { 'accent-bg-color': 'rgb(17 34 51)' } });
                registry.select('token-accent');
                expect(resolved('accent-bg-color')).toBe('rgb(17,34,51)');

                // PUT BACK, and not out of tidiness: a registry installs its provider
                // on the SHARED display and nothing takes it off again, so a theme
                // left selected here outranks the 199/201 providers the priority group
                // below installs — measured, as a red vector in a group this one does
                // not belong to. Selecting the neutral theme reloads the document to
                // empty, which restores libadwaita's own values exactly; that is the
                // guarantee the neutral default exists to give, used here to keep this
                // vector from deciding the result of the next one.
                registry.register(NEUTRAL_THEME);
                registry.select('neutral');
                expect(resolved('accent-bg-color')).toBe(adwaitaAccent);
            });
        });

        await gated(diagnostics, 'the provider priority, in both directions', async () => {
            await it('puts libadwaita at exactly STYLE_PROVIDER_PRIORITY_THEME', async () => {
                // The number the whole design rests on. An override BELOW 200 loses to
                // Adwaita and one ABOVE it wins, which is what makes 200 itself unusable
                // — at equal priority the later-added provider wins, so a theme there
                // would work or not depending on load order.
                const below = provider(
                    ':root { --accent-bg-color: rgb(1 1 1); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_THEME - 1,
                );
                expect(resolved('accent-bg-color') === 'rgb(1,1,1)').toBe(false);
                drop(below);
                const above = provider(
                    ':root { --accent-bg-color: rgb(2 2 2); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_THEME + 1,
                );
                expect(resolved('accent-bg-color')).toBe('rgb(2,2,2)');
                drop(above);
            });

            await it('sits above Adwaita and below the generated sheet, either load order', async () => {
                // The two constraints together, and the reason the constant is neither
                // THEME nor APPLICATION. Asserted in BOTH orders because at equal
                // priority GTK resolves by insertion, so an order-dependent win would
                // pass a single-order vector and fail in an application whose theme
                // happened to be selected before the first render.
                expect(THEME_PROVIDER_PRIORITY > Gtk.STYLE_PROVIDER_PRIORITY_THEME).toBe(true);
                expect(THEME_PROVIDER_PRIORITY < Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION).toBe(true);

                const themeFirst = provider('.gjsify-theme-probe { color: rgb(77 77 77); }', THEME_PROVIDER_PRIORITY);
                const sheetSecond = provider(
                    '.gjsify-theme-probe { color: rgb(88 88 88); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
                expect(colour()).toBe('rgb(88,88,88)');
                drop(themeFirst);
                drop(sheetSecond);

                const sheetFirst = provider(
                    '.gjsify-theme-probe { color: rgb(88 88 88); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
                const themeSecond = provider('.gjsify-theme-probe { color: rgb(77 77 77); }', THEME_PROVIDER_PRIORITY);
                expect(colour()).toBe('rgb(88,88,88)');
                drop(sheetFirst);
                drop(themeSecond);
            });

            await it('would let a theme at APPLICATION clobber a utility class', async () => {
                // The failure the constant avoids, measured rather than described: at
                // equal priority the later provider wins, so a theme installed after
                // the generated sheet silently beats the class the author wrote at the
                // element. This is the vector that would go red if someone "simplified"
                // the priority to APPLICATION.
                const sheet = provider(
                    '.gjsify-theme-probe { color: rgb(88 88 88); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
                const theme = provider(
                    '.gjsify-theme-probe { color: rgb(77 77 77); }',
                    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
                expect(colour()).toBe('rgb(77,77,77)');
                drop(sheet);
                drop(theme);
            });

            await it('resolves priority BEFORE specificity, so a specific theme rule cannot win', async () => {
                // Rules out the reasoning a reader is most likely to reach for. A
                // high-specificity rule in a lower-priority provider still loses, so
                // "make the theme selector more specific" is not a lever and the number
                // is the only one.
                const specific = provider('window label.gjsify-theme-probe { color: rgb(33 33 33); }', 200);
                const generic = provider('.gjsify-theme-probe { color: rgb(44 44 44); }', 400);
                expect(colour()).toBe('rgb(44,44,44)');
                drop(specific);
                drop(generic);
            });
        });

        await gated(diagnostics, 'the theme registry', async () => {
            await it('sets a named colour that Adwaita’s own rules then resolve', async () => {
                // End to end, and the claim decision 1 rests on: the accent is set as a
                // CUSTOM PROPERTY because the StyleManager property is read-only, and
                // this is what proves the custom property actually reaches the cascade
                // every Adwaita rule reads.
                const registry = new ThemeRegistry({ display });
                registry.register({ name: 'accented', namedColors: { 'accent-bg-color': 'rgb(0 128 0)' } });
                registry.select('accented');
                expect(resolved('accent-bg-color')).toBe('rgb(0,128,0)');
            });

            await it('switches at runtime, and back to Adwaita exactly', async () => {
                // The product direction is several named themes selectable from the
                // application's own settings, so the switch is the feature and not a
                // detail. Returning to the neutral theme restores libadwaita's own
                // value, which is what makes the empty default document a statement
                // rather than a placeholder.
                const registry = new ThemeRegistry({ display });
                const adwaita = resolved('accent-bg-color');
                registry
                    .register(NEUTRAL_THEME)
                    .register({ name: 'green', namedColors: { 'accent-bg-color': 'rgb(0 128 0)' } })
                    .register({ name: 'blue', namedColors: { 'accent-bg-color': 'rgb(0 0 200)' } });

                registry.select('green');
                expect(resolved('accent-bg-color')).toBe('rgb(0,128,0)');
                registry.select('blue');
                expect(resolved('accent-bg-color')).toBe('rgb(0,0,200)');
                expect(registry.current).toBe('blue');
                registry.select('neutral');
                expect(resolved('accent-bg-color')).toBe(adwaita);
                expect(registry.current).toBe('neutral');
            });

            await it('loses to the generated sheet on a property both set', async () => {
                // The two documents in one vector, through the real classes rather than
                // through hand-built providers: whatever the theme says, the class the
                // author wrote at the element wins.
                // The theme is selected AFTER the sheet is installed, deliberately. At
                // equal priority GTK resolves by insertion order, so selecting first
                // would let the sheet win for the wrong reason and the vector would
                // pass with the priority "simplified" to APPLICATION.
                const registry = new ThemeRegistry({ display });
                const sheet = new StyleSheet({ display });
                const name = sheet.classFor(['color: rgb(88 88 88)']);
                sheet.flush();
                probe.add_css_class(name);
                registry.register({ name: 'loud', css: '.gjsify-theme-probe { color: rgb(77 77 77); }' });
                registry.select('loud');
                expect(colour()).toBe('rgb(88,88,88)');
                probe.remove_css_class(name);
                expect(colour()).toBe('rgb(77,77,77)');
            });

            await it('probes an application document before accepting it, at REGISTRATION', async () => {
                // The same discipline the generated sheet has, and here it matters more:
                // this is the document the package did not write. Registration is where
                // it is checked so the error names the line that declared the theme
                // rather than the settings row that switched to it, hours later.
                const registry = new ThemeRegistry({ display });
                const error = threw(() => registry.register({ name: 'broken', css: 'window { font-family: "oops }' }));
                expect(error.message).toContain('disable every rule after it');
                expect(error.message).toContain('broken');
                // …and the registry is not poisoned by the refusal.
                expect(registry.names).toStrictEqual([]);
            });

            await it('refuses a named colour libadwaita does not define', async () => {
                const registry = new ThemeRegistry({ display });
                const error = threw(() =>
                    registry.register({ name: 'typo', namedColors: { 'acccent-bg-color': 'rgb(0 0 0)' } }),
                );
                expect(error.message).toContain('does not define');
                expect(error.message).toContain('accent-bg-color');
            });

            await it('names the current spelling when given the legacy underscored one', async () => {
                // The two mechanisms decision 1 is about. `@define-color accent_bg_color`
                // is real and is NOT a custom property, so emitting `--accent_bg_color`
                // would define something nothing reads — a theme that silently does
                // nothing, which is the failure this refusal exists for.
                const registry = new ThemeRegistry({ display });
                const error = threw(() =>
                    registry.register({ name: 'legacy', namedColors: { accent_bg_color: 'rgb(0 0 0)' } }),
                );
                expect(error.message).toContain('LEGACY');
                expect(error.message).toContain('"accent-bg-color"');
            });

            await it('refuses a second theme under a name already taken', async () => {
                const registry = new ThemeRegistry({ display });
                registry.register({ name: 'one' });
                expect(threw(() => registry.register({ name: 'one' })).message).toContain('already registered');
            });

            await it('refuses a name that is not registered, listing the ones that are', async () => {
                const registry = new ThemeRegistry({ display });
                registry.register(NEUTRAL_THEME);
                const error = threw(() => registry.select('nonsuch'));
                expect(error.message).toContain('nonsuch');
                expect(error.message).toContain('neutral');
            });

            await it('picks the default by platform, letting the application’s own theme win', async () => {
                // The product direction's other half: one look per desktop, chosen by
                // the host OS. The platform is a PARAMETER — this package never reads
                // `process.platform` — which is also what lets a settings screen preview
                // another desktop's look.
                const mac: Theme = { name: 'mac-ish', defaultOn: ['darwin'] };
                const registry = new ThemeRegistry({ display });
                registry.register(NEUTRAL_THEME).register(mac);
                registry.selectDefault('darwin');
                expect(registry.current).toBe('mac-ish');
                // Neutral declares every platform, so a desktop with no dedicated look
                // still resolves — and the LAST match wins, which is how an application
                // registering after the neutral one gets its own.
                registry.selectDefault('win32');
                expect(registry.current).toBe('neutral');
            });

            await it('refuses to guess when nothing declares itself the default', async () => {
                const registry = new ThemeRegistry({ display });
                registry.register({ name: 'only-explicit' });
                expect(threw(() => registry.selectDefault('linux')).message).toContain('no registered theme');
            });

            await it('puts the palette AHEAD of the document, so a theme can read its own colours', async () => {
                const registry = new ThemeRegistry({ display });
                const document = registry.documentOf({
                    name: 'x',
                    namedColors: { 'accent-bg-color': 'rgb(1 2 3)' },
                    css: '.gjsify-theme-probe { color: var(--accent-bg-color); }',
                });
                expect(document.indexOf(':root') < document.indexOf('.gjsify-theme-probe')).toBe(true);
            });

            await it('makes the neutral default an EMPTY document, which is the statement', async () => {
                const registry = new ThemeRegistry({ display });
                expect(registry.documentOf(NEUTRAL_THEME)).toBe('');
            });
        });
    });
};
