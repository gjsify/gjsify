// AdwAboutDialog — a Libadwaita-style about dialog for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` overlay holding a centered card with
// the app icon, name, version, developer, comments, and a close button.
// Mirrors `Adw.AboutDialog`'s common fields. `present()` reveals the overlay,
// `close()` hides it; tapping the close button or the scrim closes it.
//
// FIDELITY: approximated. A native `alert()` can't render the rich multi-field
// about layout, so this is an in-page modal card the consumer adds to their
// layout (e.g. as the top child of the app's root `GridLayout`) and reveals on
// demand — NOT a separate OS window. COMPROMISES: no backdrop blur / drop shadow
// (CSS subset has neither) and no slide/fade animation; the dimmed-scrim card LOOK
// and the field set + present/close are faithful. `application-icon` is a `Gtk.Image` at
// pixel-size 128 (as `adw-about-dialog.ui`), so it resolves through the icon theme like any
// icon name; a name nothing carries draws the `image-missing` glyph, never the name as text.
//
// LINKS are tappable buttons: website, support-url, issue-url and every `add_link`. A tap
// emits `activate-link` (payload `{ uri }`, handled accumulator): a handler returning true keeps
// the default, which is `Gio.AppInfo.launch_default_for_uri` over the platform host. The
// website shows whenever `website` is set, since libadwaita moves it onto the Details page
// (`flatCardShowsWebsite`) and this card has none.
//
// The card has no subpages, so the What's New, Troubleshooting, Details, Credits, Legal and
// Acknowledgements pages land on it as labels: `release-notes` shows the core's
// `releaseNotesBuffer` text (the buffer rebuilt by the two release-notes setters only, as
// `update_release_notes` is), `debug-info` its text with a Copy Text button, `add_link (title,
// url)`, `support-url` and `issue-url` one link button each. The credit lists,
// `translator-credits` and `add_credit_section` / `add_acknowledgement_section` become one
// block per core group, `license`, `license-type`, `copyright` and `add_legal_section` one
// block per core legal section — as plain text, so a markup link shows its text only.
// Left out: `add_other_app` / `other-apps-title` and the debug-info Save As.
// `new_from_appdata` is refused by name: it needs AppStream.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-about-dialog`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (AdwAboutWindow)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (AdwDialog sheet + dimming)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_ABOUT_DIALOG_LABELS,
    ADW_LICENSE_DEFAULTS,
    type AdwCreditsSection,
    type AdwCreditsSectionInput,
    type AdwLegalSectionInput,
    type AdwLicenseState,
    type ReleaseNotesSegment,
    aboutDialogVisibility,
    HandledAccumulator,
    acknowledgementSections,
    createAppInfo,
    creditsSections,
    flatCardShowsWebsite,
    isLicenseType,
    legalMarkupText,
    legalSections,
    legalVisible,
    licenseTypeForNick,
    refuseNewFromAppdata,
    releaseNotesBuffer,
    setLicense,
    setLicenseType,
    stripMnemonic,
} from '@gjsify/adwaita-core';
import { Button, GridLayout, ItemSpec, Label, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import { nativeClipboardHost } from '../clipboard-host.js';
import { nativePlatformHost } from '../platform-host.js';
import { GtkImage } from './gtk-image.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { findDialogHost, type DialogHost } from './window-state.js';
import type { View } from '@nativescript/core';

/** Event name emitted when the dialog is closed. */
export const CLOSED = 'closed';

/** Event name emitted when a link is tapped, before it is opened. */
export const ACTIVATE_LINK = 'activate-link';

/** The pixel size `adw-about-dialog.ui` gives the application icon. */
const APPLICATION_ICON_PIXEL_SIZE = 128;

const appInfo = createAppInfo(nativePlatformHost);

/** A credits page as text: per group its heading (if any) and one line per person. */
function creditsText(groups: ReadonlyArray<AdwCreditsSection>): string {
    return groups
        .map((group) => [...(group.title === null ? [] : [group.title]), ...group.people.map((p) => p.name)].join('\n'))
        .join('\n\n');
}

export class AdwAboutDialog extends withSignals(GridLayout) {
    static readonly GTypeName: string = 'AdwAboutDialog';

    protected readonly _card: StackLayout;
    protected readonly _appIcon: GtkImage;
    protected readonly _nameLabel: Label;
    protected readonly _versionLabel: Label;
    protected readonly _developerLabel: Label;
    protected readonly _commentsLabel: Label;
    protected readonly _websiteButton: Button;
    protected readonly _supportButton: Button;
    protected readonly _issueButton: Button;
    protected readonly _creditsLabel: Label;
    protected readonly _acknowledgementsLabel: Label;
    protected readonly _legalLabel: Label;
    protected readonly _releaseNotesLabel: Label;
    protected readonly _linksBox: StackLayout;
    protected readonly _debugInfoLabel: Label;
    protected readonly _copyButton: Button;

    private _applicationName = '';
    private _applicationIcon = '';
    private _developerName = '';
    private _version = '';
    private _comments = '';
    private _website = '';
    private _supportUrl = '';
    private _issueUrl = '';
    private _copyright = '';
    private _licenseState: AdwLicenseState = { ...ADW_LICENSE_DEFAULTS };
    private _developers: string[] = [];
    private _designers: string[] = [];
    private _artists: string[] = [];
    private _documenters: string[] = [];
    private _translatorCredits = '';
    private _releaseNotes = '';
    private _releaseNotesVersion = '';
    private _debugInfo = '';
    private _links: { title: string; url: string }[] = [];
    private _creditSections: AdwCreditsSectionInput[] = [];
    private _acknowledgementSections: AdwCreditsSectionInput[] = [];
    private _legalSections: AdwLegalSectionInput[] = [];
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

        const icon = new GtkImage();
        icon.className = 'adw-icon adw-about-dialog-icon';
        icon.pixelSize = APPLICATION_ICON_PIXEL_SIZE;
        icon.horizontalAlignment = 'center';
        card.addChild(icon);
        this._appIcon = icon;
        this._nameLabel = this._addCardLabel(card, 'adw-about-dialog-name');
        this._versionLabel = this._addCardLabel(card, 'adw-about-dialog-version');
        this._developerLabel = this._addCardLabel(card, 'adw-about-dialog-developer');
        this._commentsLabel = this._addCardLabel(card, 'adw-about-dialog-comments');
        this._releaseNotesLabel = this._addCardLabel(card, 'adw-about-dialog-release-notes');
        this._websiteButton = this._addLinkButton(card, 'adw-about-dialog-website');
        this._linksBox = new StackLayout();
        this._linksBox.className = 'adw-about-dialog-links';
        card.addChild(this._linksBox);
        this._supportButton = this._addLinkButton(card, 'adw-about-dialog-support');
        this._issueButton = this._addLinkButton(card, 'adw-about-dialog-issue');
        this._creditsLabel = this._addCardLabel(card, 'adw-about-dialog-credits');
        this._acknowledgementsLabel = this._addCardLabel(card, 'adw-about-dialog-acknowledgements');
        this._legalLabel = this._addCardLabel(card, 'adw-about-dialog-legal');
        this._debugInfoLabel = this._addCardLabel(card, 'adw-about-dialog-debug-info');

        const copyButton = new Button();
        copyButton.text = stripMnemonic(ADW_ABOUT_DIALOG_LABELS.copyText);
        copyButton.className = 'adw-about-dialog-copy';
        copyButton.set('androidElevation', 0);
        copyButton.addEventListener('tap', () => this._copyDebugInfo());
        card.addChild(copyButton);
        this._copyButton = copyButton;

        const closeButton = new Button();
        closeButton.text = 'Close';
        closeButton.className = 'adw-about-dialog-close';
        closeButton.set('androidElevation', 0);
        closeButton.addEventListener('tap', () => this.close());
        card.addChild(closeButton);

        // A dialog nobody has written to yet is a card of empty labels, all visible —
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

    /** A link row: tapping it activates whatever URI the render last gave it. */
    private _addLinkButton(parent: StackLayout, className: string): Button {
        const button = new Button();
        button.className = `adw-about-dialog-link ${className}`;
        button.set('androidElevation', 0);
        parent.addChild(button);
        return button;
    }

    /**
     * `activate-link`: emit with GTK's handled accumulator, then launch unless a handler
     * returned true. A URI the host cannot launch is dropped, as a failed launch is.
     */
    private _activateLink(uri: string): void {
        const accumulator = new HandledAccumulator();
        this.notify({ eventName: ACTIVATE_LINK, object: this, uri, accumulator } as EventData);
        if (accumulator.stopped) return;
        try {
            appInfo.launch_default_for_uri(uri, null);
        } catch {
            // no scheme, nothing to open
        }
    }

    /** Point a link button at `uri`; the tap handler is replaced, never stacked. */
    private _setLink(button: Button, title: string, uri: string, shown: boolean): void {
        button.text = title;
        button.visibility = shown ? 'visible' : 'collapse';
        const slot = button as Button & { _uriTap?: () => void };
        if (slot._uriTap) button.removeEventListener('tap', slot._uriTap);
        slot._uriTap = () => this._activateLink(uri);
        button.addEventListener('tap', slot._uriTap);
    }

    /** The application name (bold, centered). */
    get applicationName(): string {
        return this._applicationName;
    }

    set applicationName(value: string) {
        this._applicationName = value ?? '';
        this._render();
    }

    /** The icon name, drawn like any `Gtk.Image` icon name. */
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

    /** The website URL, a link button. */
    get website(): string {
        return this._website;
    }

    set website(value: string) {
        this._website = value ?? '';
        this._render();
    }

    /** The support-questions URL, a link button. */
    get supportUrl(): string {
        return this._supportUrl;
    }

    set supportUrl(value: string) {
        this._supportUrl = value ?? '';
        this._render();
    }

    /** The issue-tracker URL, a link button. */
    get issueUrl(): string {
        return this._issueUrl;
    }

    set issueUrl(value: string) {
        this._issueUrl = value ?? '';
        this._render();
    }

    /** The copyright line, the first part of the Legal text. */
    get copyright(): string {
        return this._copyright;
    }

    set copyright(value: string) {
        this._copyright = value ?? '';
        this._render();
    }

    /** The custom licence text, `''` for a stock licence. */
    get license(): string {
        return this._licenseState.license;
    }

    set license(value: string) {
        this._licenseState = setLicense(this._licenseState, value ?? '').state;
        this._render();
    }

    /**
     * A `Gtk.License` value. A string from an XML attribute is an integer or a licence nick;
     * anything outside `Gtk.License` is refused, as the C setter does.
     */
    get licenseType(): number {
        return this._licenseState.licenseType;
    }

    set licenseType(value: number | string) {
        const nick = typeof value === 'string' ? licenseTypeForNick(value.trim()) : undefined;
        const type = nick ?? xmlNumber(value, -1);
        this._licenseState = setLicenseType(this._licenseState, type).state;
        this._render();
    }

    /** Names for the "Code by" credits; each line is `Name`, `Name <email>` or `Name https://url`. */
    get developers(): string[] {
        return this._developers;
    }

    set developers(value: string[]) {
        this._developers = [...(value ?? [])];
        this._render();
    }

    /** Names for the "Design by" credits. */
    get designers(): string[] {
        return this._designers;
    }

    set designers(value: string[]) {
        this._designers = [...(value ?? [])];
        this._render();
    }

    /** Names for the "Artwork by" credits. */
    get artists(): string[] {
        return this._artists;
    }

    set artists(value: string[]) {
        this._artists = [...(value ?? [])];
        this._render();
    }

    /** Names for the "Documentation by" credits. */
    get documenters(): string[] {
        return this._documenters;
    }

    set documenters(value: string[]) {
        this._documenters = [...(value ?? [])];
        this._render();
    }

    /** The translators, one per line; the untranslated gettext sentinel shows nothing. */
    get translatorCredits(): string {
        return this._translatorCredits;
    }

    set translatorCredits(value: string) {
        this._translatorCredits = value ?? '';
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

    /** `adw_about_dialog_add_credit_section`: a Credits block; `name` may be `null`. */
    add_credit_section(name: string | null, people: string[]): void {
        this._creditSections.push({ title: name, people: [...people] });
        this._render();
    }

    /** `adw_about_dialog_add_acknowledgement_section`: an Acknowledgements block. */
    add_acknowledgement_section(name: string | null, people: string[]): void {
        this._acknowledgementSections.push({ title: name, people: [...people] });
        this._render();
    }

    /** `adw_about_dialog_add_legal_section`: a Legal block. A `license_type` outside `Gtk.License` is refused. */
    add_legal_section(title: string, copyright: string | null, license_type: number, license: string | null): void {
        if (!isLicenseType(license_type)) return;
        this._legalSections.push({ title, copyright, licenseType: license_type, license });
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
     * Push the card's strings onto their labels, and COLLAPSE the ones with nothing
     * to say.
     *
     * Every label used to be unconditionally visible, so an about dialog without a
     * version rendered a blank line where the version belongs — the exact case
     * `aboutDialogVisibility` answers for the browser port (`adw-about-dialog.c`
     * binds each part's `visible` to a closure over the property that feeds it).
     * Same input, two different dialogs, and nothing said so.
     *
     * The core's record covers a nineteen-part dialog; this port is a flat card, so
     * it reads the parts it has. Upstream has no copyright label, it derives the string
     * into the Legal page, so `copyright` reaches the card through `legalSections`. The
     * website row is the core's `websiteRow`, which is the flat-card equivalent here.
     */
    private _render(): void {
        const credits = creditsSections({
            developers: this._developers,
            designers: this._designers,
            artists: this._artists,
            documenters: this._documenters,
            translatorCredits: this._translatorCredits,
            creditSections: this._creditSections,
        });
        const acknowledgements = acknowledgementSections(this._acknowledgementSections);
        const legalInput = {
            copyright: this._copyright,
            licenseType: this._licenseState.licenseType,
            license: this._licenseState.license,
            legalSections: this._legalSections,
        };
        const visibility = aboutDialogVisibility({
            applicationName: this._applicationName,
            applicationIcon: this._applicationIcon,
            developerName: this._developerName,
            version: this._version,
            comments: this._comments,
            website: this._website,
            supportUrl: this._supportUrl,
            issueUrl: this._issueUrl,
            debugInfo: this._debugInfo,
            releaseNotes: this._releaseNotes,
            hasCustomLinks: this._links.length > 0,
            hasCredits: credits.length > 0,
            hasLegal: legalVisible(legalInput),
            hasAcknowledgements: acknowledgements.length > 0,
        });
        const show = (label: Label, text: string, shown: boolean): void => {
            label.text = text;
            label.visibility = shown ? 'visible' : 'collapse';
        };
        this._appIcon.iconName = this._applicationIcon;
        this._appIcon.visibility = visibility.appIcon ? 'visible' : 'collapse';
        show(this._nameLabel, this._applicationName, visibility.appName);
        show(this._versionLabel, this._version, visibility.version);
        show(this._developerLabel, this._developerName, visibility.developerName);
        show(this._commentsLabel, this._comments, visibility.commentsLabel);
        this._setLink(
            this._websiteButton,
            stripMnemonic(ADW_ABOUT_DIALOG_LABELS.websiteRow),
            this._website,
            flatCardShowsWebsite(visibility),
        );
        this._setLink(
            this._supportButton,
            stripMnemonic(ADW_ABOUT_DIALOG_LABELS.supportRow),
            this._supportUrl,
            visibility.supportRow,
        );
        this._setLink(
            this._issueButton,
            stripMnemonic(ADW_ABOUT_DIALOG_LABELS.issueRow),
            this._issueUrl,
            visibility.issueRow,
        );
        show(this._creditsLabel, creditsText(credits), visibility.creditsRow);
        show(this._acknowledgementsLabel, creditsText(acknowledgements), visibility.acknowledgementsRow);
        show(
            this._legalLabel,
            legalSections(legalInput)
                .map((section) =>
                    [section.title ?? '', legalMarkupText(section.markup)].filter((part) => part.length > 0).join('\n'),
                )
                .join('\n\n'),
            visibility.legalRow,
        );
        show(
            this._releaseNotesLabel,
            this._releaseNotesSegments.map((segment) => segment.text).join(''),
            visibility.whatsNewRow,
        );
        this._linksBox.removeChildren();
        for (const link of this._links) {
            const button = this._addLinkButton(this._linksBox, 'adw-about-dialog-links-item');
            this._setLink(button, stripMnemonic(link.title), link.url, true);
        }
        this._linksBox.visibility = this._links.length > 0 ? 'visible' : 'collapse';
        show(this._debugInfoLabel, this._debugInfo, visibility.troubleshootingRow);
        this._copyButton.visibility = visibility.troubleshootingRow ? 'visible' : 'collapse';
    }

    /** Copy Text: the debug info to the platform clipboard. A host without one keeps the text on screen. */
    private _copyDebugInfo(): void {
        const text = this._debugInfo;
        void Promise.resolve()
            .then(() => nativeClipboardHost.writeText(text))
            .catch(() => undefined);
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
