// AdwBanner — a Libadwaita-style banner strip for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (columns `*, auto`): a message `Label`
// in column 0 and an optional action `Button` in column 1, on an accent-tinted
// rounded strip. Mirrors `Adw.Banner`: `title`, `buttonLabel`, `revealed`, and a
// `buttonClicked` event. Styled via the `adw-banner` CSS class.
//
// Visual spec: accent-tinted background (libadwaita has no standalone _banner.scss;
// the look is the accent color at the standard banner tint), rounded corners.
// Reference: refs/libadwaita/src/stylesheet/_colors.scss (accent #3584e4 light / #78aeed dark)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Button, GridLayout, ItemSpec, Label, type EventData } from '@nativescript/core';

/** Event name emitted when the banner's action button is tapped. */
export const BUTTON_CLICKED = 'buttonClicked';

export class AdwBanner extends GridLayout {
    /** The message label (column 0). */
    protected readonly _titleLabel: Label;
    /** The action button (column 1, created lazily — only in the tree when a label is set). */
    protected readonly _button: Button;
    private _hasButton = false;
    private _revealed = true;

    constructor() {
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
        button.className = 'adw-banner-button';
        // Adwaita buttons are FLAT — kill the Android Material elevation/shadow.
        button.set('androidElevation', 0);
        GridLayout.setColumn(button, 1);
        this._button = button;

        button.addEventListener('tap', () => {
            const data: EventData = { eventName: BUTTON_CLICKED, object: this };
            this.notify(data);
        });
    }

    /** The banner message text. */
    get title(): string {
        return this._titleLabel.text ?? '';
    }

    set title(value: string) {
        this._titleLabel.text = value ?? '';
    }

    /**
     * The action button label. Setting a non-empty value adds the button to the
     * tree; setting empty removes it — so a banner with no button label shows no
     * button, matching `Adw.Banner`.
     */
    get buttonLabel(): string {
        return this._hasButton ? (this._button.text ?? '') : '';
    }

    set buttonLabel(value: string) {
        const text = value ?? '';
        this._button.text = text;
        const wantButton = text.length > 0;
        if (wantButton && !this._hasButton) {
            this.addChild(this._button);
            this._hasButton = true;
        } else if (!wantButton && this._hasButton) {
            this.removeChild(this._button);
            this._hasButton = false;
        }
    }

    /** Whether the banner is shown. Toggles the view's `visibility`. */
    get revealed(): boolean {
        return this._revealed;
    }

    set revealed(value: boolean) {
        this._revealed = !!value;
        this.visibility = this._revealed ? 'visible' : 'collapse';
    }
}
