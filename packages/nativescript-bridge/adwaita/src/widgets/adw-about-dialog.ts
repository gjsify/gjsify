// AdwAboutDialog — a Libadwaita-style about dialog for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlay holding a centered card with
// the app icon glyph, name, version, developer, comments, and a close button.
// Mirrors `Adw.AboutDialog`'s common fields. `present()` reveals the overlay,
// `close()` hides it; tapping the close button or the scrim closes it.
//
// FIDELITY: approximated. A native `alert()` can't render the rich multi-field
// about layout, so this is an in-page modal card the consumer adds to their
// layout (e.g. as the top child of the app's root `GridLayout`) and reveals on
// demand — NOT a separate OS window. COMPROMISES: no backdrop blur / drop shadow
// (CSS subset has neither) and no slide/fade animation; the dimmed-scrim card LOOK
// and the field set + present/close are faithful. The app icon is a glyph `Label`
// (no icon-theme lookup), and `links` (website/issue) are rendered as plain text
// rows, not tappable hyperlinks.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-about-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (AdwAboutWindow)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (AdwDialog sheet + dimming)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { aboutDialogVisibility } from '@gjsify/adwaita-core';
import { Button, GridLayout, ItemSpec, Label, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when the dialog is closed. */
export const CLOSED = 'closed';

export class AdwAboutDialog extends GridLayout {
    protected readonly _card: StackLayout;
    protected readonly _iconLabel: Label;
    protected readonly _nameLabel: Label;
    protected readonly _versionLabel: Label;
    protected readonly _developerLabel: Label;
    protected readonly _commentsLabel: Label;
    protected readonly _websiteLabel: Label;
    protected readonly _copyrightLabel: Label;

    private _applicationName = '';
    private _applicationIcon = '';
    private _developerName = '';
    private _version = '';
    private _comments = '';
    private _website = '';
    private _copyright = '';

    constructor() {
        super();

        this.className = 'adw-about-dialog';
        this.visibility = 'collapse';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const scroller = new ScrollView();
        scroller.orientation = 'vertical';
        scroller.verticalAlignment = 'middle';
        scroller.horizontalAlignment = 'center';
        GridLayout.setColumn(scroller, 0);
        GridLayout.setRow(scroller, 0);

        const card = new StackLayout();
        card.orientation = 'vertical';
        card.className = 'adw-about-dialog-card';
        scroller.content = card;
        this.addChild(scroller);
        this._card = card;

        this._iconLabel = this._addCardLabel(card, 'adw-about-dialog-icon');
        this._nameLabel = this._addCardLabel(card, 'adw-about-dialog-name');
        this._versionLabel = this._addCardLabel(card, 'adw-about-dialog-version');
        this._developerLabel = this._addCardLabel(card, 'adw-about-dialog-developer');
        this._commentsLabel = this._addCardLabel(card, 'adw-about-dialog-comments');
        this._websiteLabel = this._addCardLabel(card, 'adw-about-dialog-website');
        this._copyrightLabel = this._addCardLabel(card, 'adw-about-dialog-copyright');

        const closeButton = new Button();
        closeButton.text = 'Close';
        closeButton.className = 'adw-about-dialog-close';
        closeButton.set('androidElevation', 0);
        closeButton.addEventListener('tap', () => this.close());
        card.addChild(closeButton);

        // A dialog nobody has written to yet is SEVEN empty labels, all visible —
        // the same blank lines the visibility rules exist to remove. Every setter
        // re-renders the whole card, so one call here is what covers the state
        // before the first one.
        this._render();
    }

    private _addCardLabel(card: StackLayout, className: string): Label {
        const label = new Label();
        label.className = className;
        label.horizontalAlignment = 'center';
        label.textWrap = true;
        card.addChild(label);
        return label;
    }

    /** The application name (bold, centered). */
    get applicationName(): string {
        return this._applicationName;
    }

    set applicationName(value: string) {
        this._applicationName = value ?? '';
        this._render();
    }

    /** A glyph standing in for the app icon (no icon-theme lookup in the NS subset). */
    get applicationIcon(): string {
        return this._applicationIcon;
    }

    set applicationIcon(value: string) {
        this._applicationIcon = value ?? '';
        this._render();
    }

    /** The version string. */
    get version(): string {
        return this._version;
    }

    set version(value: string) {
        this._version = value ?? '';
        this._render();
    }

    /** The developer/author name. */
    get developerName(): string {
        return this._developerName;
    }

    set developerName(value: string) {
        this._developerName = value ?? '';
        this._render();
    }

    /** A short comments/description line. */
    get comments(): string {
        return this._comments;
    }

    set comments(value: string) {
        this._comments = value ?? '';
        this._render();
    }

    /** The website URL (plain text — not a tappable link in this subset). */
    get website(): string {
        return this._website;
    }

    set website(value: string) {
        this._website = value ?? '';
        this._render();
    }

    /** The copyright line. */
    get copyright(): string {
        return this._copyright;
    }

    set copyright(value: string) {
        this._copyright = value ?? '';
        this._render();
    }

    /**
     * Push the seven strings onto their labels, and COLLAPSE the ones with nothing
     * to say.
     *
     * Every label used to be unconditionally visible, so an about dialog without a
     * version rendered a blank line where the version belongs — the exact case
     * `aboutDialogVisibility` answers for the browser port (`adw-about-dialog.c`
     * binds each part's `visible` to a closure over the property that feeds it).
     * Same input, two different dialogs, and nothing said so.
     *
     * The core's record covers a nineteen-part dialog; this port is a flat card, so
     * it reads the parts it has. `copyright` is NOT one of them: upstream has no
     * copyright LABEL, it derives the string into the Legal page this port does not
     * build (`legalSectionVisible` takes it as a separate argument). It therefore
     * keeps the same non-empty rule directly. The website row is the core's
     * `websiteRow`, which is the flat-card equivalent here.
     */
    private _render(): void {
        const visibility = aboutDialogVisibility({
            applicationName: this._applicationName,
            applicationIcon: this._applicationIcon,
            developerName: this._developerName,
            version: this._version,
            comments: this._comments,
            website: this._website,
        });
        const show = (label: Label, text: string, shown: boolean): void => {
            label.text = text;
            label.visibility = shown ? 'visible' : 'collapse';
        };
        show(this._iconLabel, this._applicationIcon, visibility.appIcon);
        show(this._nameLabel, this._applicationName, visibility.appName);
        show(this._versionLabel, this._version, visibility.version);
        show(this._developerLabel, this._developerName, visibility.developerName);
        show(this._commentsLabel, this._comments, visibility.commentsLabel);
        show(this._websiteLabel, this._website, visibility.websiteRow);
        show(this._copyrightLabel, this._copyright, this._copyright.length > 0);
    }

    /** Reveal the about overlay. */
    present(): void {
        this.visibility = 'visible';
    }

    /** Hide the about overlay and emit `closed`. */
    close(): void {
        this.visibility = 'collapse';
        const data: EventData = { eventName: CLOSED, object: this };
        this.notify(data);
    }

    /** Whether the dialog is currently shown. */
    get open(): boolean {
        return this.visibility === 'visible';
    }

    set open(value: boolean | string) {
        if (xmlBoolean(value, false)) this.present();
        else this.close();
    }
}
