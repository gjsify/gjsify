// GtkButton — the Adwaita-styled GTK button for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). libadwaita ships no
// button type: it styles `GtkButton` through `_buttons.scss`, so the widget is GTK's and
// the Adwaita part is the stylesheet — which is exactly what the `styleClasses` property
// below carries. The file used to be `adw-button.ts` exporting `AdwButton`, and that prefix
// named the design system while claiming to name the widget.
//
// IT WAS A TEXT-ONLY `@nativescript/core` `Button`, AND THAT WAS FOUR DOCUMENTED
// DIVERGENCES. `Gtk.Button` has one child and three ways to fill it — `label`,
// `icon-name`, `child` — and the platform `Button` can only ever be the first: it extends
// `TextBase` and hosts no child view. The gallery measured what that cost, and it was not
// one snippet: the icon-only `.circular` variant "has no counterpart at all", a button
// wrapping an `Adw.ButtonContent` had to be a hand-built `@nativescript/core` StackLayout
// carrying the Adwaita classes, an `Adw.ActionRow`'s trailing chevron had to be a bare
// `Gtk.Image` rather than a flat button, and every click was a `tap` listener where GJS
// spells it `connect('clicked', …)`.
//
// So this is now a TAPPABLE `GridLayout` with one star cell, which is the construction
// every other button-shaped widget in this port already uses: `AdwImageButton` (a centred
// `Image`), `AdwSplitButton` (a `Label` OR a `GtkImage` per part), `AdwButtonRow`. What it
// costs is stated rather than hidden:
//
//   · the platform's automatic `:highlighted` state goes with the platform `Button`, so
//     the press-darken is wired by hand through `attachRowPressFeedback` — the same helper
//     the activatable rows use, and the same `*:highlighted` shades;
//   · `.adw-button`'s `color` and `font-weight` cannot reach a `GridLayout`, which has no
//     text, so the label carries `.adw-button-label` and the theme styles that in both
//     schemes — modelled on `.adw-button-content-label`, which already had to exist for
//     exactly this reason one widget over;
//   · `text` IS GONE. It was NativeScript's name for the label, INHERITED rather than
//     declared, so no gate could see it diverging from `Gtk.Button:label` —
//     `check-nativescript-widget-coverage.mjs` said so in as many words: "a divergence no
//     gate sees because `text` is inherited rather than declared here". `label` is the GIR
//     name and is the only one now, which is a breaking change in the same shape as the
//     methods-and-signals one before it.
//
// `clicked` IS THE SIGNAL, and `tap` still is too. NativeScript emits `tap`; a GJS snippet
// writes `button.connect('clicked', …)`, and `withSignals` turns that into an
// `addEventListener` for whatever name it is given — so the button re-emits its own `tap`
// under GTK's name and both lines reach the same handler. `AdwSplitButton` already emits
// `clicked` for its action half, which is where the name comes from.
//
// THE ICON IS AN SVG SOURCE, NOT A THEME NAME. `iconName` takes the Adwaita symbolic SVG
// string (e.g. `listAddSymbolic` from `@gjsify/adwaita-icons`), because nothing on this
// runtime resolves an icon-theme name — the same door `GtkImage`, `AdwAvatar` and
// `AdwStatusPage` already have, and the reason the gallery carries a `glyph` divergence
// kind at all. A SIBLING CHANGE is making theme names resolve on this port; when it lands
// the door converts underneath this property and nothing here moves, because the property
// is already spelled `iconName`.
//
// Reference: refs/gtk gtk/gtkbutton.c (GtkButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.

import { GridLayout, ItemSpec, Label, type View } from '@nativescript/core';

import { buttonSlotAfterWrite, buttonSlotDetaches, type ButtonSlot } from './button-slot.js';
import { GtkImage } from './gtk-image.js';
import { labelDisplayText } from './label-text.js';
import { attachRowPressFeedback } from './row-press.js';
import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './style-classes.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

/** Event name emitted when the button is tapped. Mirrors `Gtk.Button::clicked`. */
export const GTK_BUTTON_CLICKED = 'clicked';

/** The class the button's own label carries, so the theme can give it Adwaita's type. */
export const GTK_BUTTON_LABEL_CLASS = 'adw-button-label';

export class GtkButton extends withSignals(GridLayout) {
    private _styleClasses: string[] = [];
    private _label = '';
    private _iconName = '';
    private _useUnderline = false;
    private _slot: ButtonSlot = 'empty';
    /** The view currently in the single cell, whichever slot filled it. */
    private _content: View | null = null;

    constructor(props?: ConstructProps<GtkButton>) {
        super();

        this.className = classNameWith('adw-button', this._styleClasses);
        // `star` (not `auto`) so the single cell FILLS the button — the same reason
        // `AdwImageButton` gives: an `auto` cell shrinks to its content and pins it
        // top-left, where a filled cell lets the content's centre alignment centre it.
        this.addRow(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'star'));

        // Adwaita darkens a button on press rather than showing a Material ripple, and
        // NativeScript auto-applies `:highlighted` only to `Button` — which this is no
        // longer. Same helper, same shades in the theme.
        attachRowPressFeedback(this);

        this.addEventListener('tap', () => {
            this.notify({ eventName: GTK_BUTTON_CLICKED, object: this });
        });

        applyConstructProps(this, props);
    }

    // --- content: one child, three ways to fill it, last write wins ---

    /**
     * `Gtk.Button:label` — the button's text.
     *
     * Writing it REPLACES whatever was in the child, which is `gtk_button_set_label`
     * building a fresh `GtkLabel` and handing it to `set_child`. An empty label is still a
     * label: the button keeps its child and shows nothing, rather than collapsing.
     */
    get label(): string {
        return this._label;
    }

    set label(value: string) {
        this._label = value ?? '';
        this._fill('label', this._label);
    }

    /**
     * `Gtk.Button:icon-name` — an Adwaita symbolic SVG string, not a theme name (see the
     * header). Writing it replaces the child, as `gtk_button_set_icon_name` does.
     */
    get iconName(): string {
        return this._iconName;
    }

    set iconName(value: string) {
        this._iconName = value ?? '';
        this._fill('icon', this._iconName);
    }

    /**
     * `Gtk.Button:child` — any view, which is how a button wraps an `Adw.ButtonContent`.
     *
     * `null` empties the button. Setting it also hands an `AdwButtonContent` the host it
     * needs: that widget stamps `image-text-button` on the button around it, which C gets
     * from `gtk_widget_get_ancestor` and NativeScript has no rooting protocol for — so the
     * button that receives the content is what tells it.
     */
    get child(): View | null {
        return this._slot === 'child' ? this._content : null;
    }

    set child(view: View | null) {
        this._fill('child', view ?? null);
    }

    /** `gtk_button_set_child`. The method spelling of {@link child}. */
    set_child(view: View | null): void {
        this.child = view;
    }

    /** `gtk_button_get_child`. */
    get_child(): View | null {
        return this.child;
    }

    /**
     * XML inflation — every child a template declares is THE button's child.
     *
     * Without this, `LayoutBase`'s default calls `addChild`, which drops the view into the
     * cell without the slot bookkeeping: a second child would paint on top of the first
     * and `child` would read back `null`, both at exit 0.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }

    // --- properties ---

    /**
     * `Gtk.Button:use-underline` — whether an `_` in {@link label} marks a mnemonic.
     *
     * The marker is REMOVED and no key is bound: NativeScript has no accelerator layer.
     * Same reduction `Adw.ButtonContent` and `Gtk.Label` make, through the same helper.
     */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        this._useUnderline = xmlBoolean(raw, this._useUnderline);
        if (this._slot === 'label') this._fill('label', this._label);
    }

    /**
     * The style classes this button carries (`GtkWidget:css-classes`), without the
     * `adw-button` class that makes it a button — GTK's own rule for the property.
     *
     * IT WAS `variant`, AN ENUM, AND THAT WAS ONE LOOK AT A TIME (ADR 0049). Its own doc
     * said so: "`pill` is the rounded SHAPE and combines with no other variant here (set
     * the shape OR the accent intent)". GTK holds a LIST, so `.pill.suggested-action` is
     * an ordinary Adwaita button and was unreachable through the enum. The names are the
     * CLASS names now, not the web element's attribute spellings: `suggested-action`,
     * not `suggested`.
     *
     * NOT `cssClasses`: `ViewBase` owns that name as a live `Set<string>` the CSS engine
     * rebuilds on every `className` write, and shadowing it kills the widget in its own
     * constructor — see `style-classes.ts`.
     *
     * From XML it is a space-separated list, which is what an attribute can carry:
     * `<gtk:Button styleClasses="pill suggested-action" />`.
     */
    get styleClasses(): string[] {
        return [...this._styleClasses];
    }

    set styleClasses(value: string | null | undefined) {
        this._setClasses(normalizeStyleClasses(value));
    }

    // --- style classes, under GTK's own method names ---

    /** `gtk_widget_add_css_class`. A class the button already carries is a no-op. */
    add_css_class(name: string): void {
        this._setClasses(withCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_remove_css_class`. A class it does not carry is a no-op. */
    remove_css_class(name: string): void {
        this._setClasses(withoutCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._styleClasses.includes((name ?? '').trim());
    }

    /** `gtk_widget_get_css_classes` — the list, without the widget's own CSS name. */
    get_css_classes(): string[] {
        return [...this._styleClasses];
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list, as in C. */
    set_css_classes(names: readonly string[]): void {
        this._setClasses(normalizeStyleClasses([...names].join(' ')));
    }

    private _setClasses(classes: readonly string[]): void {
        this._styleClasses = [...classes];
        this.className = classNameWith('adw-button', this._styleClasses);
    }

    /**
     * Put `value` in the single cell under `wrote`'s slot, detaching whatever the previous
     * slot had parented.
     *
     * The detach is the whole reason `button-slot.ts` exists: two views left in one
     * `GridLayout` cell paint on top of each other and nothing complains.
     */
    private _fill(wrote: 'label' | 'icon' | 'child', value: unknown): void {
        const next = buttonSlotAfterWrite(wrote, value);
        if (buttonSlotDetaches(this._slot, next)) this._detach();
        this._slot = next;

        if (next === 'empty') {
            this._detach();
            return;
        }
        if (next === 'child') {
            const view = value as View;
            if (this._content === view) return;
            this._detach();
            this._adopt(view);
            // NS has no rooting protocol, so the content is told which view plays the
            // `GtkButton` ancestor `adw_button_content_root` finds. Duck-typed rather than
            // imported: `adw-button-content.ts` imports this module's sibling
            // `gtk-image.ts` and importing the content back would be a module cycle.
            const content = view as unknown as { hostButton?: View | null };
            if ('hostButton' in content) content.hostButton = this;
            return;
        }
        if (next === 'label') {
            const label = this._content instanceof Label ? this._content : this._adopt(new Label());
            label.className = GTK_BUTTON_LABEL_CLASS;
            label.text = labelDisplayText(this._label, false, this._useUnderline);
            return;
        }
        const image = this._content instanceof GtkImage ? this._content : this._adopt(new GtkImage());
        image.iconName = this._iconName;
    }

    private _detach(): void {
        if (this._content) this.removeChild(this._content);
        this._content = null;
    }

    /** Parent `view` in the single cell, centred, and remember it as the content. */
    private _adopt<T extends View>(view: T): T {
        view.horizontalAlignment = 'center';
        view.verticalAlignment = 'middle';
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this.addChild(view);
        this._content = view;
        return view;
    }
}
