// <adw-about-dialog> — The standard Adwaita "About" dialog (the web counterpart of
// Adw.AboutDialog): a modal AdwDialog (full-cover scrim + centred, scrollable
// floating sheet) hosting a navigation view, whose main page shows the app icon,
// name, developer name and a version pill, followed by up to three preference
// groups of rows that link out or push a subpage.
//
// Presented imperatively — `present()` (or setting `open`) reveals it; Escape, a
// scrim click, the header close button or `close()` dismisses it. The header title
// fades in once the main page is scrolled (`update_headerbar_cb`).
//
// WHICH PAGE A ROW IS ON IS NOT A LAYOUT CHOICE — it is `update_details` and
// `update_support`. `website` is the one input libadwaita deliberately leaves OUT
// of the details predicate, so a dialog whose only extra is a website must not grow
// a Details subpage holding a single link; and there are no fallbacks GTK does not
// have (no "Application" for a missing name, no generic glyph for a missing icon).
// All four derivations come from `@gjsify/adwaita-core` (ADR 0004), which holds them
// once for both renderers and is held to `@gjsify/adwaita-core/conformance`.
//
// Properties / attributes (all reflected, mirroring the AdwAboutDialog GObject
// properties of the same name, hyphenated):
//   application-name   the application's display name (shown as a title-1)
//   application-icon   an icon name, by convention the application ID; drawn in
//                        colour from the app's GResource icons (ADR 0116), else
//                        as a symbolic glyph or `image-missing` (`<gtk-image>`'s
//                        lookup); absent one, no icon is drawn
//   developer-name     the developer / vendor line below the name
//   version            the version, shown as a clickable pill
//   comments           a longer description (Details page)
//   website            the website URL — a Website link row, on the MAIN page
//                        unless the Details page has other content
//   support-url        a support-forum URL (a main-page Support Questions row)
//   issue-url          an issue-tracker URL (a main-page Report an Issue row)
//   copyright          the copyright line (Legal page)
//   license            the license text/name (Legal page); with a `license-url`
//                        the name becomes a link
//   license-url        a URL the license name links to
//   release-notes      AppStream release-notes markup — a What's New row + page,
//                        the buffer from the core's `releaseNotesBuffer`
//   release-notes-version  the version the What's New heading names, else `version`
//   debug-info         an opaque blob — a Troubleshooting row + page with Copy Text
//   open               (boolean) whether the dialog is presented
//
// List-valued credits are set via properties (string arrays), mirroring the
// AdwAboutDialog `developers` / `designers` / `artists` / `documenters` properties
// — entries may be `Name`, `Name <email>` or `Name https://url`, parsed by the
// core's `parseCreditPerson` (`parse_person`). `add_link (title, url)` appends a
// Details-page link row, as on GTK.
//
// NOT implemented here, so the core derivations see them empty: `add_credit_section`,
// `translator-credits`, the Acknowledgements page, and the debug page's "Save As…"
// button (`debug-info-filename`), which needs a file dialog. `new_from_appdata` is
// refused by name: it needs an AppStream parser.
//
// Events (CustomEvent, bubbles): `notify::open` (detail `{ open }`), `closed`, and
// `activate-link` (detail `{ uri }`, CANCELABLE — the signal's `true_handled`
// accumulator means "a handler returned TRUE suppresses the default navigation",
// which is what `preventDefault()` spells).
//
// Reference: refs/libadwaita/src/adw-about-dialog.c (AdwAboutDialog behaviour)
// Reference: refs/libadwaita/src/adw-about-dialog.ui (navigation page tree)
// Reference: refs/libadwaita/src/adw-dialog.c (floating-sheet present/close)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating sheet)
// Reference: refs/adwaita-web/adwaita-web/scss/_about_dialog.scss (web layout)
// Copyright (c) 2022-2024 GNOME Foundation Inc. / Purism SPC (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon nodes are <gtk-image>; the derivations live in @gjsify/adwaita-core.

import {
    ADW_ABOUT_DIALOG_LABELS,
    type AdwCreditPerson,
    GTK_LICENSE,
    type ReleaseNotesSegment,
    Toast,
    aboutDialogVisibility,
    creditsSections,
    legalSectionVisible,
    refuseNewFromAppdata,
    releaseNotesBuffer,
    stripMnemonic,
} from '@gjsify/adwaita-core';

import { webClipboardHost } from '../clipboard-host.js';
import type { AdwToastOverlay } from './adw-toast-overlay.js';
import './adw-toast-overlay.js';
import { createGtkImage } from './gtk-image.js';
import { AdwModalSurface } from './modal-surface.js';
import { WidgetElement } from '../widget-element.js';

/** A template label with its mnemonic marker removed — this renderer has no accelerator layer. */
function rowLabel(key: keyof typeof ADW_ABOUT_DIALOG_LABELS): string {
    return stripMnemonic(ADW_ABOUT_DIALOG_LABELS[key]);
}

export class AdwAboutDialog extends WidgetElement {
    private _initialized = false;

    // Layout nodes (rebuilt from attributes on each render).
    private _scrimEl!: HTMLDivElement;
    private _sheetEl!: HTMLDivElement;
    private _modal!: AdwModalSurface;
    private _navView!: HTMLElement;
    private _scrollEl!: HTMLDivElement;
    private _mainToolbarEl!: HTMLDivElement;

    // List-valued credit properties (no attribute form — set imperatively).
    private _developers: string[] = [];
    private _designers: string[] = [];
    private _artists: string[] = [];
    private _documenters: string[] = [];

    /** `add_link` rows, in order; `has_custom_links` latches with the first. */
    private _links: { title: string; url: string }[] = [];
    /**
     * The What's New buffer. Only the two release-notes setters rebuild it, never
     * `version` (`update_release_notes` is called from those two alone).
     */
    private _releaseNotesSegments: ReleaseNotesSegment[] = [];
    private _toastOverlay!: AdwToastOverlay;

    static get observedAttributes() {
        return [
            'application-name',
            'application-icon',
            'developer-name',
            'version',
            'comments',
            'website',
            'support-url',
            'issue-url',
            'copyright',
            'license',
            'license-url',
            'release-notes',
            'release-notes-version',
            'debug-info',
            'open',
        ];
    }

    /** `adw_about_dialog_new_from_appdata`, refused by name. */
    static new_from_appdata(_resourcePath: string, _releaseNotesVersion?: string | null): never {
        refuseNewFromAppdata();
    }

    get applicationName(): string {
        return this.getAttribute('application-name') ?? '';
    }

    set applicationName(value: string) {
        this.setAttribute('application-name', value);
    }

    get applicationIcon(): string {
        return this.getAttribute('application-icon') ?? '';
    }

    set applicationIcon(value: string) {
        this.setAttribute('application-icon', value);
    }

    get developerName(): string {
        return this.getAttribute('developer-name') ?? '';
    }

    set developerName(value: string) {
        this.setAttribute('developer-name', value);
    }

    get version(): string {
        return this.getAttribute('version') ?? '';
    }

    set version(value: string) {
        this.setAttribute('version', value);
    }

    get comments(): string {
        return this.getAttribute('comments') ?? '';
    }

    set comments(value: string) {
        this.setAttribute('comments', value);
    }

    get website(): string {
        return this.getAttribute('website') ?? '';
    }

    set website(value: string) {
        this.setAttribute('website', value);
    }

    get supportUrl(): string {
        return this.getAttribute('support-url') ?? '';
    }

    set supportUrl(value: string) {
        this.setAttribute('support-url', value);
    }

    get issueUrl(): string {
        return this.getAttribute('issue-url') ?? '';
    }

    set issueUrl(value: string) {
        this.setAttribute('issue-url', value);
    }

    get copyright(): string {
        return this.getAttribute('copyright') ?? '';
    }

    set copyright(value: string) {
        this.setAttribute('copyright', value);
    }

    get license(): string {
        return this.getAttribute('license') ?? '';
    }

    set license(value: string) {
        this.setAttribute('license', value);
    }

    get licenseUrl(): string {
        return this.getAttribute('license-url') ?? '';
    }

    set licenseUrl(value: string) {
        this.setAttribute('license-url', value);
    }

    get releaseNotes(): string {
        return this.getAttribute('release-notes') ?? '';
    }

    set releaseNotes(value: string) {
        this.setAttribute('release-notes', value);
    }

    get releaseNotesVersion(): string {
        return this.getAttribute('release-notes-version') ?? '';
    }

    set releaseNotesVersion(value: string) {
        this.setAttribute('release-notes-version', value);
    }

    get debugInfo(): string {
        return this.getAttribute('debug-info') ?? '';
    }

    set debugInfo(value: string) {
        this.setAttribute('debug-info', value);
    }

    /** `adw_about_dialog_add_link`: a Details-page link row; `_` marks a mnemonic. */
    add_link(title: string, url: string): void {
        this._links.push({ title, url });
        if (this._initialized) this._render();
    }

    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    get developers(): string[] {
        return this._developers;
    }

    set developers(value: string[]) {
        this._developers = [...value];
        if (this._initialized) this._render();
    }

    get designers(): string[] {
        return this._designers;
    }

    set designers(value: string[]) {
        this._designers = [...value];
        if (this._initialized) this._render();
    }

    get artists(): string[] {
        return this._artists;
    }

    set artists(value: string[]) {
        this._artists = [...value];
        if (this._initialized) this._render();
    }

    get documenters(): string[] {
        return this._documenters;
    }

    set documenters(value: string[]) {
        this._documenters = [...value];
        if (this._initialized) this._render();
    }

    /** Present the dialog (the web counterpart of Adw.Dialog.present()). */
    present(): void {
        this.open = true;
    }

    /** Dismiss the dialog (the web counterpart of Adw.Dialog.close()). */
    close(): void {
        this.open = false;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-about-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this.close());

        this._sheetEl = document.createElement('div');
        this._sheetEl.className = 'adw-about-dialog-sheet';
        // AdwDialog:title, whose template default is the bare word. The application
        // name is announced by the title-1 label inside, exactly as the header
        // revealer shows it separately in GTK.
        this._sheetEl.setAttribute('aria-label', ADW_ABOUT_DIALOG_LABELS.dialogTitle);

        // The template's `toast_overlay`, around the navigation view: "Copied to
        // clipboard" is shown inside the sheet.
        this._toastOverlay = document.createElement('adw-toast-overlay') as AdwToastOverlay;
        this._sheetEl.appendChild(this._toastOverlay);

        this.replaceChildren(this._scrimEl, this._sheetEl);

        // The role, `aria-modal`, Escape, the Tab trap and the return-focus. No
        // `initialFocus`: the sheet itself is the fallback, which is what this element
        // used to focus by hand, and the navigation view's first control is better.
        this._modal = new AdwModalSurface({
            host: this,
            surface: this._sheetEl,
            role: 'dialog',
            isOpen: () => this.open,
            onEscape: () => this.close(),
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (oldValue === newValue) return;
        // Before the guard: the heading reads `version` as it is when the NOTES change.
        if (name === 'release-notes' || name === 'release-notes-version') {
            this._releaseNotesSegments = releaseNotesBuffer(
                {
                    releaseNotes: this.releaseNotes,
                    releaseNotesVersion: this.releaseNotesVersion,
                    version: this.version,
                },
                ADW_ABOUT_DIALOG_LABELS,
            ).segments;
        }
        if (!this._initialized) return;
        if (name === 'open') {
            this._syncOpen();
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (!this.open) this.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
            return;
        }
        this._render();
    }

    /** Reflect the presented state onto the host + reset the navigation stack. */
    private _syncOpen(): void {
        this.classList.toggle('open', this.open);
        if (this.open) {
            // Always present the main page; subpages are reached via the rows.
            const nav = this._navView as unknown as { replace?: (tags: string[]) => void };
            nav.replace?.(['main']);
            this._scrollEl.scrollTop = 0;
            this._updateHeaderTitle();
            this._modal.present();
        } else {
            this._modal.dismiss();
        }
    }

    /** The credit groups the Credits page shows, straight from `update_credits`. */
    private _creditsSections() {
        return creditsSections({
            developers: this._developers,
            designers: this._designers,
            artists: this._artists,
            documenters: this._documenters,
        });
    }

    /**
     * Whether the Legal page has anything on it. This element's licence model is the
     * simplified one — a name plus an optional URL — so it maps onto `GtkLicense` as
     * "custom text when a licence is set, unknown otherwise", which is what
     * `adw_about_dialog_set_license` does to the type anyway.
     */
    private _hasLegal(): boolean {
        const licenseType = this.license.length > 0 ? GTK_LICENSE.CUSTOM : GTK_LICENSE.UNKNOWN;
        return legalSectionVisible(this.copyright, licenseType, this.license);
    }

    private _render(): void {
        const sections = this._creditsSections();
        const visibility = aboutDialogVisibility({
            applicationIcon: this.applicationIcon,
            applicationName: this.applicationName,
            developerName: this.developerName,
            version: this.version,
            comments: this.comments,
            website: this.website,
            supportUrl: this.supportUrl,
            issueUrl: this.issueUrl,
            debugInfo: this.debugInfo,
            releaseNotes: this.releaseNotes,
            hasCustomLinks: this._links.length > 0,
            hasCredits: sections.length > 0,
            hasLegal: this._hasLegal(),
        });

        this._navView?.remove();
        this._navView = document.createElement('adw-navigation-view');
        this._navView.append(this._buildMainPage(visibility));

        // A subpage exists exactly when its row does — `details_row` is
        // `has_comments || show_links`, i.e. "the page has content".
        if (visibility.whatsNewRow) this._navView.append(this._buildWhatsNewPage());
        if (visibility.detailsRow) this._navView.append(this._buildDetailsPage(visibility));
        if (visibility.troubleshootingRow) {
            this._navView.append(this._buildTroubleshootingPage(), this._buildDebugInfoPage());
        }
        if (visibility.creditsRow) this._navView.append(this._buildCreditsPage(sections));
        if (visibility.legalRow) this._navView.append(this._buildLegalPage());

        // Straight into the overlay's content box: appended to the overlay itself, the view
        // is re-homed a microtask later, and that move drops the focus `present` put in it.
        const content = this._toastOverlay.querySelector(':scope > .adw-toast-overlay-content');
        (content ?? this._toastOverlay).appendChild(this._navView);

        this.classList.toggle('open', this.open);
    }

    /**
     * A navigation page wrapping a header bar (with the close button) + content.
     * `headerTitle` defaults to the page title; the main page overrides it, because its
     * page title is the dialog's ("About") while its header shows the application name.
     */
    private _buildPage(
        tag: string,
        title: string,
        showClose: boolean,
        headerTitle: string = title,
    ): {
        page: HTMLElement;
        body: HTMLDivElement;
        header: HTMLElement;
    } {
        const page = document.createElement('adw-navigation-page');
        page.setAttribute('title', title);
        page.setAttribute('tag', tag);

        const header = document.createElement('adw-header-bar');
        // The main page's title is hidden until the page is scrolled (CSS), the
        // subpages always show it (AdwAboutDialog update_headerbar_cb).
        header.setAttribute('title', headerTitle);

        if (showClose) {
            // The close button — drawn with a CSS "×" glyph, the same approach and the
            // same reason as adw-tab-view's close affordance: `window-close` IS compiled
            // and does have a mask class; what differs from upstream's
            // `window-close-symbolic` (adw-sheet-controls.c:118) is the button size this
            // header budgets for it.
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'adw-button flat circular adw-about-dialog-close';
            close.setAttribute('aria-label', 'Close');
            close.addEventListener('click', () => this.close());
            const endApply = () => {
                const end = (header as { endSection?: HTMLElement | null }).endSection ?? null;
                if (end) end.appendChild(close);
            };
            // The header bar builds its sections in its own connectedCallback, so the
            // close button can only be appended after that has run.
            queueMicrotask(endApply);
        }

        const scroll = document.createElement('div');
        scroll.className = 'adw-about-dialog-scroll';

        const clamp = document.createElement('div');
        clamp.className = 'adw-about-dialog-clamp';
        const body = document.createElement('div');
        body.className = 'adw-about-dialog-page-body';
        clamp.appendChild(body);
        scroll.appendChild(clamp);

        const toolbar = document.createElement('div');
        toolbar.className = 'adw-about-dialog-toolbar-view';
        toolbar.append(header, scroll);
        page.appendChild(toolbar);

        if (tag === 'main') {
            this._scrollEl = scroll;
            this._mainToolbarEl = toolbar;
            toolbar.classList.add('main-page');
            scroll.addEventListener('scroll', () => this._updateHeaderTitle());
        }

        return { page, body, header };
    }

    private _buildMainPage(visibility: ReturnType<typeof aboutDialogVisibility>): HTMLElement {
        const { page, body } = this._buildPage('main', ADW_ABOUT_DIALOG_LABELS.dialogTitle, true, this.applicationName);

        // Only when one was given: GTK hides the image outright for an empty icon
        // name, and a generic glyph would show an icon for an application that asked
        // for none. A reverse-DNS application id (`org.gnome.Builder`) — what
        // `adw_about_dialog_new_from_appdata` hands to `set_application_icon` in
        // refs/libadwaita/src/adw-about-dialog.c — is not one CSS token, so it draws
        // `image-missing` rather than three stray classes; that is also what GTK draws for
        // it on a machine without the app installed.
        if (visibility.appIcon) {
            body.appendChild(createGtkImage(this.applicationIcon, 'adw-about-dialog-icon'));
        }

        // No fallback: an unset name means no label.
        if (visibility.appName) {
            const nameEl = document.createElement('span');
            nameEl.className = 'adw-about-dialog-name';
            nameEl.textContent = this.applicationName;
            body.appendChild(nameEl);
        }

        if (visibility.developerName) {
            const devEl = document.createElement('span');
            devEl.className = 'adw-about-dialog-developer';
            devEl.textContent = this.developerName;
            body.appendChild(devEl);
        }

        if (visibility.version) {
            const versionEl = document.createElement('span');
            versionEl.className = 'adw-about-dialog-version';
            versionEl.textContent = this.version;
            body.appendChild(versionEl);
        }

        // Three separate preference groups, as in the template (details_group,
        // support_group, credits_legal_group) — groups, not one list, and the
        // stylesheet already spaces consecutive `.adw-about-dialog-rows` apart.
        const detailsGroupRows: HTMLElement[] = [];
        if (visibility.whatsNewRow) {
            detailsGroupRows.push(this._buildNavRow(rowLabel('whatsNewRow'), 'whatsnew'));
        }
        if (visibility.detailsRow) {
            detailsGroupRows.push(this._buildNavRow(rowLabel('detailsRow'), 'details'));
        }
        if (visibility.websiteRow) {
            detailsGroupRows.push(this._buildLinkRow(rowLabel('websiteRow'), this.website));
        }

        const supportGroupRows: HTMLElement[] = [];
        if (visibility.supportRow) {
            supportGroupRows.push(this._buildLinkRow(rowLabel('supportRow'), this.supportUrl));
        }
        if (visibility.issueRow) {
            supportGroupRows.push(this._buildLinkRow(rowLabel('issueRow'), this.issueUrl));
        }
        if (visibility.troubleshootingRow) {
            supportGroupRows.push(this._buildNavRow(rowLabel('troubleshootingRow'), 'troubleshooting'));
        }

        const creditsLegalRows: HTMLElement[] = [];
        if (visibility.creditsRow) creditsLegalRows.push(this._buildNavRow(rowLabel('creditsRow'), 'credits'));
        if (visibility.legalRow) creditsLegalRows.push(this._buildNavRow(rowLabel('legalRow'), 'legal'));

        if (visibility.detailsGroup) body.appendChild(this._buildGroup('details', detailsGroupRows));
        if (visibility.supportGroup) body.appendChild(this._buildGroup('support', supportGroupRows));
        if (visibility.creditsLegalGroup) body.appendChild(this._buildGroup('credits-legal', creditsLegalRows));

        return page;
    }

    /**
     * One `AdwPreferencesGroup` in its spacing wrapper. `data-group` carries the
     * template's widget id so a test — and a reader — can tell the named groups apart;
     * nothing styles off it. The credits sections pass `null`, because the template has
     * no id for them: they are built one per section at runtime.
     */
    private _buildGroup(id: string | null, rows: HTMLElement[], title?: string): HTMLElement {
        const group = document.createElement('adw-preferences-group');
        if (id !== null) group.setAttribute('data-group', id);
        if (title !== undefined) group.setAttribute('title', title);
        for (const row of rows) group.appendChild(row);

        const wrap = document.createElement('div');
        wrap.className = 'adw-about-dialog-rows';
        wrap.appendChild(group);
        return wrap;
    }

    private _buildNavRow(title: string, tag: string): HTMLElement {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', title);
        row.setAttribute('activatable', '');

        const chevron = createGtkImage('go-next', 'adw-about-dialog-chevron');
        chevron.setAttribute('slot', 'suffix');
        row.appendChild(chevron);

        row.addEventListener('activated', () => {
            const nav = this._navView as unknown as { push?: (tag: string) => void };
            nav.push?.(tag);
        });

        return row;
    }

    /**
     * Emit `activate-link` and navigate unless a handler took over. The GObject signal
     * is `BOOLEAN__STRING` with `g_signal_accumulator_true_handled` and its default
     * handler returns `GDK_EVENT_PROPAGATE` ("not handled, do the default"); a handler
     * returning TRUE suppresses it, which is what `preventDefault()` on a cancelable
     * event means — hence the gate on `dispatchEvent`'s return value.
     */
    private _activateLink(uri: string): void {
        const event = new CustomEvent('activate-link', { bubbles: true, cancelable: true, detail: { uri } });
        if (this.dispatchEvent(event)) window.open(uri, '_blank', 'noopener,noreferrer');
    }

    private _buildDetailsPage(visibility: ReturnType<typeof aboutDialogVisibility>): HTMLElement {
        const { page, body } = this._buildPage('details', ADW_ABOUT_DIALOG_LABELS.detailsPage, false);

        if (visibility.commentsLabel) {
            const comments = document.createElement('p');
            comments.className = 'adw-about-dialog-comments';
            comments.textContent = this.comments;
            body.appendChild(comments);
        }

        if (visibility.linksGroup) {
            const rows: HTMLElement[] = [];
            if (visibility.detailsWebsiteRow) {
                rows.push(this._buildLinkRow(rowLabel('websiteRow'), this.website));
            }
            for (const link of this._links) rows.push(this._buildLinkRow(stripMnemonic(link.title), link.url));
            body.appendChild(this._buildGroup('links', rows));
        }

        return page;
    }

    /** The release-notes buffer as tagged runs, white space kept (a GtkTextView). */
    private _buildWhatsNewPage(): HTMLElement {
        const { page, body } = this._buildPage('whatsnew', ADW_ABOUT_DIALOG_LABELS.whatsNewPage, false);
        const notes = document.createElement('div');
        notes.className = 'adw-about-dialog-release-notes';
        for (const segment of this._releaseNotesSegments) {
            const span = document.createElement('span');
            if (segment.tag !== null) span.dataset['tag'] = segment.tag;
            span.textContent = segment.text;
            notes.appendChild(span);
        }
        body.appendChild(notes);
        return page;
    }

    private _buildTroubleshootingPage(): HTMLElement {
        const { page, body } = this._buildPage('troubleshooting', ADW_ABOUT_DIALOG_LABELS.troubleshootingPage, false);
        const intro = document.createElement('p');
        intro.className = 'adw-about-dialog-comments';
        intro.textContent = ADW_ABOUT_DIALOG_LABELS.troubleshootingIntro;
        body.append(intro, this._buildGroup(null, [this._buildNavRow(rowLabel('debugInfoRow'), 'debuginfo')]));
        return page;
    }

    /** The debug text and Copy Text — the `about.copy-property` action on `debug-info`. */
    private _buildDebugInfoPage(): HTMLElement {
        const { page, body } = this._buildPage('debuginfo', ADW_ABOUT_DIALOG_LABELS.debugInfoPage, false);
        const text = document.createElement('pre');
        text.className = 'adw-about-dialog-debug-info';
        text.textContent = this.debugInfo;

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'adw-button pill adw-about-dialog-copy';
        copy.textContent = rowLabel('copyText');
        copy.addEventListener('click', () => this._copyProperty(this.debugInfo));

        body.append(text, copy);
        return page;
    }

    /** `copy_property_cb`: an empty value copies nothing and shows no toast. */
    private _copyProperty(value: string): void {
        if (value.length === 0) return;
        void Promise.resolve(webClipboardHost.writeText(value)).catch(() => undefined);
        this._toastOverlay.add_toast(new Toast({ title: ADW_ABOUT_DIALOG_LABELS.copiedToast }));
    }

    private _buildLinkRow(title: string, uri: string): HTMLElement {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', title);
        row.setAttribute('activatable', '');
        row.classList.add('adw-about-dialog-link-row');

        const chevron = createGtkImage('go-next', 'adw-about-dialog-chevron');
        chevron.setAttribute('slot', 'suffix');
        row.appendChild(chevron);

        row.addEventListener('activated', () => this._activateLink(uri));

        return row;
    }

    private _buildCreditsPage(sections: ReturnType<typeof creditsSections>): HTMLElement {
        const { page, body } = this._buildPage('credits', ADW_ABOUT_DIALOG_LABELS.creditsPage, false);

        for (const section of sections) {
            const rows = section.people.map((person) => this._buildCreditRow(person));
            body.appendChild(this._buildGroup(null, rows, section.title ?? undefined));
        }

        return page;
    }

    /**
     * A credit row — a plain title, or a link row when the entry carries a URI. The gate
     * is `link !== null`, not the URI's truthiness: `"Ada <>"` parses to an EMPTY link,
     * which is still a link in the C (`if (link)` tests the pointer) and still produces
     * an `AdwLinkRow`, to `mailto:`.
     */
    private _buildCreditRow(person: AdwCreditPerson): HTMLElement {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', person.name);

        if (person.link !== null) {
            const uri = person.uri ?? '';
            row.setAttribute('activatable', '');
            row.classList.add('adw-about-dialog-link-row');
            const chevron = createGtkImage('go-next', 'adw-about-dialog-chevron');
            chevron.setAttribute('slot', 'suffix');
            row.appendChild(chevron);
            row.addEventListener('activated', () => this._activateLink(uri));
        }

        return row;
    }

    private _buildLegalPage(): HTMLElement {
        const { page, body } = this._buildPage('legal', ADW_ABOUT_DIALOG_LABELS.legalPage, false);

        if (this.copyright) {
            const copyright = document.createElement('p');
            copyright.className = 'adw-about-dialog-copyright';
            copyright.textContent = this.copyright;
            body.appendChild(copyright);
        }

        if (this.license) {
            const license = document.createElement('p');
            license.className = 'adw-about-dialog-license';
            if (this.licenseUrl) {
                // GTK connects the legal label's `activate-link` to the same
                // handler as the rows, so this link is cancelable too.
                const link = document.createElement('a');
                link.href = this.licenseUrl;
                link.rel = 'noopener noreferrer';
                link.textContent = this.license;
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    this._activateLink(this.licenseUrl);
                });
                license.appendChild(link);
            } else {
                license.textContent = this.license;
            }
            body.appendChild(license);
        }

        return page;
    }

    /** Show the header title only once the main page is scrolled (AdwAboutDialog). */
    private _updateHeaderTitle(): void {
        if (!this._scrollEl || !this._mainToolbarEl) return;
        this._mainToolbarEl.classList.toggle('scrolled', this._scrollEl.scrollTop > 0);
    }
}

customElements.define('adw-about-dialog', AdwAboutDialog);
