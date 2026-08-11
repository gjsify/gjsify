// Banner conformance vectors — the spec both renderers are held to.
//
// `revealed` and `use-markup` are why this table exists: they decide whether anything
// is on screen and how the title is read, and the two ports were wrong on BOTH in
// opposite directions — so comparing the ports to each other could not have caught it.
//
// Reference: refs/libadwaita/src/adw-banner.c
// Reference: refs/libadwaita/src/adw-banner.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One property-default expectation. */
export interface BannerDefaultVector {
    /** The `Adw.Banner` property name, as GObject spells it. */
    property: 'title' | 'button-label' | 'revealed' | 'use-markup' | 'button-style';
    /** The `GParamSpec` default. */
    value: string | boolean;
    rule: string;
}

/**
 * The five `GParamSpec` defaults. `revealed: false` and `use-markup: true` were wrong
 * in both ports in opposite directions — a banner showed itself on a device and stayed
 * hidden in the browser.
 */
export const BANNER_DEFAULT_VECTORS: ReadonlyArray<BannerDefaultVector> = [
    { property: 'title', value: '', rule: 'empty string, not NULL — the setter rejects NULL (:612)' },
    { property: 'button-label', value: '', rule: 'empty label, so no button (:408-411 with :663)' },
    {
        property: 'revealed',
        value: false,
        rule: 'FALSE (:456-459) — "Banners are hidden by default" (:47); NS started at true',
    },
    {
        property: 'use-markup',
        value: true,
        rule: 'TRUE (:422-425) — markup is ON unless disabled; both ports had it opt-in',
    },
    {
        property: 'button-style',
        value: 'default',
        rule: 'ADW_BANNER_BUTTON_DEFAULT (:443-447), i.e. the grey button (Since 1.7)',
    },
];

/** One button-visibility expectation. */
export interface BannerButtonVisibleVector {
    /** The `button-label` value, or `null` for the `NULL` the C setter accepts. */
    label: string | null;
    /** Whether `gtk_widget_set_visible` is handed a true value. */
    visible: boolean;
    rule: string;
}

/**
 * `adw_banner_set_button_label` — `gtk_widget_set_visible (button, label && label[0])`,
 * a FIRST-CHARACTER test. The whitespace rows are the ones that matter: a renderer that
 * trimmed before testing would hide a button GTK draws.
 */
export const BANNER_BUTTON_VISIBLE_VECTORS: ReadonlyArray<BannerButtonVisibleVector> = [
    { label: 'Resume', visible: true, rule: 'an ordinary label shows the button' },
    { label: '', visible: false, rule: 'the empty string is the documented "no button" value (:401)' },
    { label: null, visible: false, rule: 'NULL is accepted by the setter and is also "no button" (:647)' },
    { label: ' ', visible: true, rule: 'label[0] is a space — a character, so the button IS shown' },
    { label: '  ', visible: true, rule: 'no trimming happens anywhere on this path' },
    { label: '_R', visible: true, rule: 'the mnemonic marker is a character like any other here' },
    { label: '0', visible: true, rule: 'a C string test, not a JS truthiness one' },
];

/** One button-label text expectation. */
export interface BannerButtonTextVector {
    label: string;
    /** What a renderer without an accelerator layer paints. */
    text: string;
    rule: string;
}

/**
 * The banner button's text after mnemonic resolution.
 *
 * The template pins the BUTTON to `use-underline=True` with no property to turn it off
 * and the TITLE label to `use-underline=False`, so the same underscore is an
 * accelerator marker in the button and a literal in the title — hence no title
 * counterpart to this table.
 */
export const BANNER_BUTTON_TEXT_VECTORS: ReadonlyArray<BannerButtonTextVector> = [
    { label: '_Resume', text: 'Resume', rule: 'the marker is removed and marks the R (adw-banner.ui:33)' },
    { label: 'Resume', text: 'Resume', rule: 'a label without markers is painted verbatim' },
    { label: 'Save __As', text: 'Save _As', rule: 'a doubled marker is one literal underscore' },
    { label: 'Update_', text: 'Update', rule: 'a trailing lone marker marks nothing and is dropped' },
    { label: '', text: '', rule: 'empty in, empty out' },
    { label: 'Ü_bersicht', text: 'Übersicht', rule: 'non-ASCII text is untouched; only the marker goes' },
];

/** One `button-style` → style-class expectation. */
export interface BannerButtonStyleVector {
    /** The `AdwBannerButtonStyle` nick. */
    style: 'default' | 'suggested';
    classes: readonly string[];
    rule: string;
}

/**
 * `adw_banner_set_button_style`'s switch (Since 1.7) — the property adds or removes
 * exactly one class and touches nothing else.
 */
export const BANNER_BUTTON_STYLE_VECTORS: ReadonlyArray<BannerButtonStyleVector> = [
    { style: 'default', classes: [], rule: 'ADW_BANNER_BUTTON_DEFAULT removes .suggested-action (:766)' },
    { style: 'suggested', classes: ['suggested-action'], rule: 'ADW_BANNER_BUTTON_SUGGESTED adds it (:769)' },
];

/** One `button-style` attribute-parsing expectation. */
export interface BannerButtonStyleParseVector {
    /** The renderer-level string — an HTML attribute, an XML property. */
    input: string | null;
    /** The `AdwBannerButtonStyle` it resolves to. */
    style: 'default' | 'suggested';
    rule: string;
}

/**
 * Turning a renderer-supplied STRING into the enum. Not a C behaviour and cannot be:
 * `adw_banner_set_button_style` range-guards an `AdwBannerButtonStyle` it has already
 * been handed, so an unrepresentable string never reaches it. Falling back to the
 * property default is what `g_object_set` does with an invalid nick.
 */
export const BANNER_BUTTON_STYLE_PARSE_VECTORS: ReadonlyArray<BannerButtonStyleParseVector> = [
    { input: 'suggested', style: 'suggested', rule: 'the enum nick, as GObject spells it' },
    { input: 'default', style: 'default', rule: 'the other nick, spelled explicitly' },
    { input: null, style: 'default', rule: 'attribute absent → the property default' },
    { input: '', style: 'default', rule: 'attribute present but empty is not a nick' },
    { input: 'SUGGESTED', style: 'default', rule: 'nicks are lowercase; GObject parsing is case-sensitive' },
    { input: 'destructive', style: 'default', rule: 'the enum has exactly two members (:23-35)' },
];
