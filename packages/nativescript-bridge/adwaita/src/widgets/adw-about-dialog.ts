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
// The card has no subpages, so the What's New, Troubleshooting and Details doors land
// on it as labels: `release-notes` shows the core's `releaseNotesBuffer` text (the
// buffer rebuilt by the two release-notes setters only, as `update_release_notes` is),
// `debug-info` its verbatim text with no Copy button, and `add_link (title, url)` one
// "title: url" line each. `new_from_appdata` is refused by name: it needs AppStream.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-about-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (AdwAboutWindow)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (AdwDialog sheet + dimming)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_ABOUT_DIALOG_LABELS,
    type ReleaseNotesSegment,
    aboutDialogVisibility,
    refuseNewFromAppdata,
    releaseNotesBuffer,
    stripMnemonic,
} from '@gjsify/adwaita-core';
import { Button, GridLayout, ItemSpec, Label, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { findDialogHost, type DialogHost } from './window-state.js';
import type { View } from '@nativescript/core';

/** Event name emitted when the dialog is closed. */
export const CLOSED = 'closed';

export class AdwAboutDialog extends withSignals(GridLayout) {
    static readonly GTypeName: string = 'AdwAboutDialog';

    protected readonly _card: StackLayout;
    protected readonly _iconLabel: Label;
    protected readonly _nameLabel: Label;
    protected readonly _versionLabel: Label;
    protected readonly _developerLabel: Label;
    protected readonly _commentsLabel: Label;
    protected readonly _websiteLabel: Label;
    protected readonly _copyrightLabel: Label;
    protected readonly _releaseNotesLabel: Label;
    protected readonly _linksLabel: Label;
    protected readonly _debugInfoLabel: Label;

    private _applicationName = '';
    private _applicationIcon = '';
    private _developerName = '';
    private _version = '';
    private _comments = '';
    private _website = '';
    private _copyright = '';
    private _releaseNotes = '';
    private _releaseNotesVersion = '';
    private _debugInfo = '';
    private _links: { title: string; url: string }[] = [];
    /** The What's New buffer; `version` alone never rebuilds it. */
    private _releaseNotesSegments: ReleaseNotesSegment[] = [];
    /** The window `present (parent)` mounted this in, so closing can take it back out. */
    private _host: DialogHost | null = null;

    constructor(props?: ConstructProps<AdwAboutDialog>) {
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
        this._releaseNotesLabel = this._addCardLabel(card, 'adw-about-dialog-release-notes');
        this._websiteLabel = this._addCardLabel(card, 'adw-about-dialog-website');
        this._linksLabel = this._addCardLabel(card, 'adw-about-dialog-links');
        this._copyrightLabel = this._addCardLabel(card, 'adw-about-dialog-copyright');
        this._debugInfoLabel = this._addCardLabel(card, 'adw-about-dialog-debug-info');

        const closeButton = new Button();
        closeButton.text = 'Close';
        closeButton.className = 'adw-about-dialog-close';
        closeButton.set('androidElevation', 0);
        closeButton.addEventListener('tap', () => this.close());
        card.addChild(closeButton);

        // A dialog nobody has written to yet is TEN empty labels, all visible —
        // the same blank lines the visibility rules exist to remove. Every setter
        // re-renders the whole card, so one call here is what covers the state
        // before the first one.
        this._render();

        applyConstructProps(this, props);
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

    /** AppStream release-notes markup, shown as the What's New text. */
    get releaseNotes(): string {
        return this._releaseNotes;
    }

    set releaseNotes(value: string) {
        this._releaseNotes = value ?? '';
        this._updateReleaseNotes();
    }

    /** The version the release-notes heading names, else `version`. */
    get releaseNotesVersion(): string {
        return this._releaseNotesVersion;
    }

    set releaseNotesVersion(value: string) {
        this._releaseNotesVersion = value ?? '';
        this._updateReleaseNotes();
    }

    /** Debugging information, shown verbatim. */
    get debugInfo(): string {
        return this._debugInfo;
    }

    set debugInfo(value: string) {
        this._debugInfo = value ?? '';
        this._render();
    }

    /** `adw_about_dialog_add_link`: an extra link; `_` marks a mnemonic. */
    add_link(title: string, url: string): void {
        this._links.push({ title, url });
        this._render();
    }

    /** `adw_about_dialog_new_from_appdata`, refused by name. */
    static new_from_appdata(_resourcePath: string, _releaseNotesVersion?: string | null): never {
        refuseNewFromAppdata();
    }

    private _updateReleaseNotes(): void {
        this._releaseNotesSegments = releaseNotesBuffer(
            {
                releaseNotes: this._releaseNotes,
                releaseNotesVersion: this._releaseNotesVersion,
                version: this._version,
            },
            ADW_ABOUT_DIALOG_LABELS,
        ).segments;
        this._render();
    }

    /**
     * Push the ten strings onto their labels, and COLLAPSE the ones with nothing
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
            debugInfo: this._debugInfo,
            releaseNotes: this._releaseNotes,
            hasCustomLinks: this._links.length > 0,
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
        show(
            this._releaseNotesLabel,
            this._releaseNotesSegments.map((segment) => segment.text).join(''),
            visibility.whatsNewRow,
        );
        show(
            this._linksLabel,
            this._links.map((link) => `${stripMnemonic(link.title)}: ${link.url}`).join('\n'),
            this._links.length > 0,
        );
        show(this._debugInfoLabel, this._debugInfo, visibility.troubleshootingRow);
    }

    /**
     * Reveal the about overlay — `adw_dialog_present`.
     *
     * With a `parent` it is hosted in that widget's window like every other AdwDialog, so the
     * window's back handling closes it first. Without one it must already sit in a layout.
     */
    present(parent?: View | null): void {
        if (this.open) return;
        if (this.parent === null || this.parent === undefined) {
            const host = findDialogHost(parent ?? null);
            if (host === null) {
                throw new Error(
                    `${this.constructor.name} has no window to appear in: pass a widget that sits inside an ` +
                        'Adw.Window / Adw.ApplicationWindow to present(), or add the dialog to a layout first.',
                );
            }
            host._hostDialog(this);
            this._host = host;
        }
        this.visibility = 'visible';
    }

    /** Hide the about overlay, take it out of its window and emit `closed`. */
    close(): void {
        this.visibility = 'collapse';
        if (this._host !== null) {
            this._host._unhostDialog(this);
            this._host = null;
        }
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
