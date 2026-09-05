// AdwBanner — a Libadwaita-style banner strip for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `*, auto`): a message `Label`
// in column 0 and an optional action `Button` in column 1, on a neutral tinted
// strip. Mirrors `Adw.Banner`: `title`, `buttonLabel`, `revealed`, `useMarkup`,
// `buttonStyle`, and a `buttonClicked` event.
//
// The DEFAULTS and the derivations are headless in `@gjsify/adwaita-core` (ADR 0004),
// reached through `chrome.ts` — including the two that are easy to get backwards
// (`revealed` defaults FALSE, `use-markup` TRUE) and the mnemonic marker the template
// puts on the button, which must not paint as a literal underscore.
//
// FIDELITY: approximated for the reveal and for markup. `Adw.Banner` slides in through
// a `GtkRevealer`; the NS subset has none, so `revealed` toggles `visibility`. The NS
// CSS subset has no inline markup, so a markup title is reduced to its plain text
// rather than painted with its tags — see `bannerTitleText`.
//
// Reference: refs/libadwaita/src/adw-banner.c (AdwBanner)
// Reference: refs/libadwaita/src/adw-banner.ui (the template both labels come from)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Button, GridLayout, ItemSpec, Label, type EventData } from '@nativescript/core';
import { bannerButtonText, bannerButtonVisible, parseBannerButtonStyle } from '@gjsify/adwaita-core';
import type { AdwBannerButtonStyle } from '@gjsify/adwaita-core';
import { bannerButtonClassName, bannerTitleText, bannerVisibility, defaultBannerProps } from './chrome.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Event name emitted when the banner's action button is tapped. */
export const BUTTON_CLICKED = 'buttonClicked';

/** The banner button's base class, before `button-style` adds its own. */
const BUTTON_BASE_CLASS = 'adw-banner-button';

export class AdwBanner extends GridLayout {
    /** The message label (column 0). */
    protected readonly _titleLabel: Label;
    /** The action button (column 1, only in the tree when a label is set). */
    protected readonly _button: Button;
    private _hasButton = false;
    private readonly _props = defaultBannerProps();

    constructor(props?: ConstructProps<AdwBanner>) {
        super();

        this.className = 'adw-banner';

        this.addColumn(new ItemSpec(1, 'star'));
        this.addColumn(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'auto'));

        const titleLabel = new Label();
        titleLabel.className = 'adw-banner-title';
        titleLabel.textWrap = true;
        GridLayout.setColumn(titleLabel, 0);
        this.addChild(titleLabel);
        this._titleLabel = titleLabel;

        const button = new Button();
        button.className = BUTTON_BASE_CLASS;
        // Adwaita buttons are FLAT — kill the Android Material elevation/shadow.
        button.set('androidElevation', 0);
        GridLayout.setColumn(button, 1);
        this._button = button;

        button.addEventListener('tap', () => {
            const data: EventData = { eventName: BUTTON_CLICKED, object: this };
            this.notify(data);
        });

        // A banner is HIDDEN until revealed (adw-banner.c:456-459). Applying the
        // default here rather than leaving `visibility` untouched is the fix for
        // the divergence: a constructed-but-unrevealed banner used to be on
        // screen on a device and off it in the browser.
        this.visibility = bannerVisibility(this._props.revealed);

        applyConstructProps(this, props);
    }

    /** The banner message. Pango markup when {@link useMarkup}. */
    get title(): string {
        return this._props.title;
    }

    set title(value: string) {
        this._props.title = value ?? '';
        this._renderTitle();
    }

    /**
     * Whether {@link title} is Pango markup. Defaults to TRUE, as in libadwaita
     * (:422-425).
     *
     * NS has no inline-markup layer, so markup is reduced to its plain text —
     * closer to what GTK paints than the raw tags would be.
     */
    get useMarkup(): boolean {
        return this._props.useMarkup;
    }

    set useMarkup(value: boolean | string) {
        this._props.useMarkup = xmlBoolean(value, false);
        this._renderTitle();
    }

    /**
     * The action button label. A non-empty value adds the button to the tree;
     * empty or `null` removes it, matching `label && label[0]` (:663).
     *
     * The template pins the button to `use-underline=True` (adw-banner.ui:33), so
     * the value keeps its mnemonic markers and the PAINTED text drops them.
     */
    get buttonLabel(): string {
        return this._props.buttonLabel;
    }

    set buttonLabel(value: string) {
        const label = value ?? '';
        this._props.buttonLabel = label;
        this._button.text = bannerButtonText(label);

        const wantButton = bannerButtonVisible(label);
        if (wantButton && !this._hasButton) {
            this.addChild(this._button);
            this._hasButton = true;
        } else if (!wantButton && this._hasButton) {
            this.removeChild(this._button);
            this._hasButton = false;
        }
    }

    /**
     * The button's style class — grey (`'default'`) or `.suggested-action`
     * (:764-774). Since 1.7.
     */
    get buttonStyle(): AdwBannerButtonStyle {
        return this._props.buttonStyle;
    }

    set buttonStyle(value: AdwBannerButtonStyle) {
        this._props.buttonStyle = parseBannerButtonStyle(value);
        this._button.className = bannerButtonClassName(this._button.className, this._props.buttonStyle);
    }

    /** Whether the banner is shown. Defaults to FALSE (:456-459). */
    get revealed(): boolean {
        return this._props.revealed;
    }

    set revealed(value: boolean | string) {
        this._props.revealed = xmlBoolean(value, false);
        this.visibility = bannerVisibility(this._props.revealed);
    }

    private _renderTitle(): void {
        this._titleLabel.text = bannerTitleText(this._props.title, this._props.useMarkup);
    }
}
