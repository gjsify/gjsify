// <adw-about-dialog> — The standard Adwaita "About" dialog (the web counterpart
// of Adw.AboutDialog). It is a modal AdwDialog (a full-cover scrim + a centred,
// scrollable floating sheet) hosting a navigation view: the main page shows the
// app icon, name, developer name and a version pill, with preference rows that
// navigate to the Details, Credits and Legal subpages.
//
// Like Adw.AboutDialog the dialog is presented imperatively — `present()` (or
// setting the `open` attribute) reveals it; Escape, a scrim click, the header
// close button, or `close()` dismisses it. The header title fades in once the
// main page is scrolled (mirroring AdwAboutDialog's update_headerbar_cb).
//
// Properties / attributes (all reflected, mirroring the AdwAboutDialog GObject
// properties of the same name, hyphenated):
//   application-name   the application's display name (shown as a title-1)
//   application-icon   a symbolic icon name (with or without -symbolic) — the
//                        large app icon; falls back to a generic glyph
//   developer-name     the developer / vendor line below the name
//   version            the version, shown as a clickable pill
//   comments           a longer description (shown on the Details page)
//   website            the application's website URL (a Website link row)
//   support-url        a support-forum URL (a Support Questions link row)
//   issue-url          an issue-tracker URL (a Report an Issue link row)
//   copyright          the copyright line (shown on the Legal page)
//   license            the license text/name (shown on the Legal page); when a
//                        `license-url` is also given the name becomes a link
//   license-url        a URL the license name links to
//   open               (boolean) whether the dialog is presented
//
// List-valued credits are set via properties (string arrays), mirroring the
// AdwAboutDialog `developers` / `designers` / `artists` / `documenters`
// properties — entries may be `Name`, `Name <email>` or `Name https://url`,
// matching the AdwAboutDialog credit syntax.
//
// Events (CustomEvent, bubbles):
//   `notify::open` (detail = { open }) when the presented state changes —
//     mirrors the Adw.Dialog `open` notification.
//   `closed` when the dialog is dismissed — mirrors Adw.Dialog::closed.
//   `activate-link` (detail = { uri }) when a link row is activated — mirrors
//     AdwAboutDialog::activate-link (not cancelled here; the browser navigates).
//
// Reference: refs/libadwaita/src/adw-about-dialog.c (AdwAboutDialog behaviour)
// Reference: refs/libadwaita/src/adw-about-dialog.ui (navigation page tree)
// Reference: refs/libadwaita/src/adw-dialog.c (floating-sheet present/close)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating sheet)
// Reference: refs/adwaita-web/adwaita-web/scss/_about_dialog.scss (web layout)
// Copyright (c) 2022-2024 GNOME Foundation Inc. / Purism SPC (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A credit person — a plain name, or a name paired with a link (email / URL). */
interface CreditEntry {
    name: string;
    uri: string | null;
}

/** Parse an AdwAboutDialog credit string: `Name`, `Name <email>`, `Name https://…`. */
function parseCredit(raw: string): CreditEntry {
    const trimmed = raw.trim();
    // `Name <email-or-url>` — the bracketed part is the link target.
    const angle = /^(.*?)\s*<([^>]+)>$/.exec(trimmed);
    if (angle) {
        const target = angle[2].trim();
        const uri = target.includes('@') && !/^[a-z][a-z0-9+.-]*:/i.test(target) ? `mailto:${target}` : target;
        return { name: angle[1].trim(), uri };
    }
    // `Name https://url` — a trailing bare URL is the link target.
    const url = /^(.*?)\s+((?:https?|mailto):\S+)$/.exec(trimmed);
    if (url) {
        return { name: url[1].trim(), uri: url[2].trim() };
    }
    return { name: trimmed, uri: null };
}

export class AdwAboutDialog extends HTMLElement {
    private _initialized = false;

    // Layout nodes (rebuilt from attributes on each render).
    private _scrimEl!: HTMLDivElement;
    private _sheetEl!: HTMLDivElement;
    private _navView!: HTMLElement;
    private _scrollEl!: HTMLDivElement;
    private _mainToolbarEl!: HTMLDivElement;

    // List-valued credit properties (no attribute form — set imperatively).
    private _developers: string[] = [];
    private _designers: string[] = [];
    private _artists: string[] = [];
    private _documenters: string[] = [];

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
            'open',
        ];
    }

    // --- Reflected scalar properties ---

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

    /** Whether the dialog is presented. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    // --- List-valued credit properties (no attribute form) ---

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

        // The full-cover modal scrim — clicking it dismisses the dialog.
        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-about-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this.close());

        // The centred floating sheet.
        this._sheetEl = document.createElement('div');
        this._sheetEl.className = 'adw-about-dialog-sheet';
        this._sheetEl.setAttribute('role', 'dialog');
        this._sheetEl.setAttribute('aria-modal', 'true');

        this.replaceChildren(this._scrimEl, this._sheetEl);

        // Escape dismisses while open (mirrors AdwDialog's close shortcut).
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.open) {
                event.stopPropagation();
                this.close();
            }
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
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
            // Move focus into the sheet for keyboard dismissal.
            requestAnimationFrame(() => this._sheetEl.focus());
        }
    }

    /** Rebuild the sheet contents from the current attributes / credit lists. */
    private _render(): void {
        const appName = this.applicationName || 'Application';
        this._sheetEl.setAttribute('aria-label', `About ${appName}`);

        // The navigation view (main page + subpages) lives inside the sheet.
        this._navView = document.createElement('adw-navigation-view');
        this._navView.append(this._buildMainPage(appName));

        const detailsPage = this._buildDetailsPage();
        if (detailsPage) this._navView.append(detailsPage);

        const creditsPage = this._buildCreditsPage();
        if (creditsPage) this._navView.append(creditsPage);

        const legalPage = this._buildLegalPage();
        if (legalPage) this._navView.append(legalPage);

        this._sheetEl.replaceChildren(this._navView);
        this._sheetEl.tabIndex = -1;

        this.classList.toggle('open', this.open);
    }

    /** A navigation page wrapping a header bar (with the close button) + content. */
    private _buildPage(tag: string, title: string, showClose: boolean): {
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
        header.setAttribute('title', title);

        if (showClose) {
            // The close button — drawn with a CSS "×" glyph (no window-close
            // symbolic icon ships in @gjsify/adwaita-icons, the same approach as
            // adw-tab-view's close affordance).
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'adw-button flat circular adw-about-dialog-close';
            close.setAttribute('aria-label', 'Close');
            close.addEventListener('click', () => this.close());
            const endApply = () => {
                const end = (header as { endSection?: HTMLElement | null }).endSection ?? null;
                if (end) end.appendChild(close);
            };
            // The header bar builds its sections in its own connectedCallback;
            // append the close button once that has run.
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
            // The main page's header title fades in once the content scrolls.
            toolbar.classList.add('main-page');
            scroll.addEventListener('scroll', () => this._updateHeaderTitle());
        }

        return { page, body, header };
    }

    /** The main page: icon, name, developer, version pill, navigation rows. */
    private _buildMainPage(appName: string): HTMLElement {
        const { page, body } = this._buildPage('main', `About ${appName}`, true);

        // App icon — a large symbolic glyph. A given application-icon resolves
        // to its `.adw-icon--<name>` mask class; absent one, fall back to the
        // GTK default generic `application-x-executable` glyph.
        const icon = (this.applicationIcon || 'application-x-executable').replace(/-symbolic$/, '');
        const iconEl = document.createElement('span');
        iconEl.className = `adw-about-dialog-icon adw-icon adw-icon--${icon}`;
        iconEl.setAttribute('aria-hidden', 'true');
        body.appendChild(iconEl);

        // App name — title-1.
        const nameEl = document.createElement('span');
        nameEl.className = 'adw-about-dialog-name';
        nameEl.textContent = appName;
        body.appendChild(nameEl);

        // Developer / vendor.
        if (this.developerName) {
            const devEl = document.createElement('span');
            devEl.className = 'adw-about-dialog-developer';
            devEl.textContent = this.developerName;
            body.appendChild(devEl);
        }

        // Version pill.
        if (this.version) {
            const versionEl = document.createElement('span');
            versionEl.className = 'adw-about-dialog-version';
            versionEl.textContent = this.version;
            body.appendChild(versionEl);
        }

        // The navigation preference rows (Details / Credits / Legal). Only the
        // rows whose corresponding subpage has content are shown — mirroring the
        // AdwAboutDialog group visibility bindings.
        const group = document.createElement('adw-preferences-group');
        let hasRows = false;

        if (this._hasDetails()) {
            group.appendChild(this._buildNavRow('Details', 'details'));
            hasRows = true;
        }
        if (this._hasCredits()) {
            group.appendChild(this._buildNavRow('Credits', 'credits'));
            hasRows = true;
        }
        if (this._hasLegal()) {
            group.appendChild(this._buildNavRow('Legal', 'legal'));
            hasRows = true;
        }

        if (hasRows) {
            const groupWrap = document.createElement('div');
            groupWrap.className = 'adw-about-dialog-rows';
            groupWrap.appendChild(group);
            body.appendChild(groupWrap);
        }

        return page;
    }

    /** An activatable row that pushes a subpage, with a trailing go-next chevron. */
    private _buildNavRow(title: string, tag: string): HTMLElement {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', title);
        row.setAttribute('activatable', '');

        const chevron = document.createElement('span');
        chevron.setAttribute('slot', 'suffix');
        chevron.className = 'adw-icon adw-icon--go-next adw-about-dialog-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        row.appendChild(chevron);

        row.addEventListener('activated', () => {
            const nav = this._navView as unknown as { push?: (tag: string) => void };
            nav.push?.(tag);
        });

        return row;
    }

    private _hasDetails(): boolean {
        return Boolean(this.comments || this.website || this.supportUrl || this.issueUrl);
    }

    private _hasCredits(): boolean {
        return (
            this._developers.length > 0 ||
            this._designers.length > 0 ||
            this._artists.length > 0 ||
            this._documenters.length > 0
        );
    }

    private _hasLegal(): boolean {
        return Boolean(this.copyright || this.license);
    }

    /** The Details page: comments + website / support / issue link rows. */
    private _buildDetailsPage(): HTMLElement | null {
        if (!this._hasDetails()) return null;
        const { page, body } = this._buildPage('details', 'Details', false);

        if (this.comments) {
            const comments = document.createElement('p');
            comments.className = 'adw-about-dialog-comments';
            comments.textContent = this.comments;
            body.appendChild(comments);
        }

        const links: Array<[string, string]> = [];
        if (this.website) links.push(['Website', this.website]);
        if (this.supportUrl) links.push(['Support Questions', this.supportUrl]);
        if (this.issueUrl) links.push(['Report an Issue', this.issueUrl]);

        if (links.length > 0) {
            const group = document.createElement('adw-preferences-group');
            for (const [title, uri] of links) group.appendChild(this._buildLinkRow(title, uri));
            const wrap = document.createElement('div');
            wrap.className = 'adw-about-dialog-rows';
            wrap.appendChild(group);
            body.appendChild(wrap);
        }

        return page;
    }

    /** A link row that opens a URL in a new tab and emits `activate-link`. */
    private _buildLinkRow(title: string, uri: string): HTMLElement {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', title);
        row.setAttribute('activatable', '');
        row.classList.add('adw-about-dialog-link-row');

        const chevron = document.createElement('span');
        chevron.setAttribute('slot', 'suffix');
        chevron.className = 'adw-icon adw-icon--go-next adw-about-dialog-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        row.appendChild(chevron);

        row.addEventListener('activated', () => {
            this.dispatchEvent(new CustomEvent('activate-link', { bubbles: true, detail: { uri } }));
            window.open(uri, '_blank', 'noopener,noreferrer');
        });

        return row;
    }

    /** The Credits page: a group per non-empty credit section. */
    private _buildCreditsPage(): HTMLElement | null {
        if (!this._hasCredits()) return null;
        const { page, body } = this._buildPage('credits', 'Credits', false);

        const sections: Array<[string, string[]]> = [
            ['Code by', this._developers],
            ['Design by', this._designers],
            ['Artwork by', this._artists],
            ['Documentation by', this._documenters],
        ];

        for (const [title, people] of sections) {
            if (people.length === 0) continue;
            const group = document.createElement('adw-preferences-group');
            group.setAttribute('title', title);
            for (const person of people) group.appendChild(this._buildCreditRow(person));
            const wrap = document.createElement('div');
            wrap.className = 'adw-about-dialog-rows';
            wrap.appendChild(group);
            body.appendChild(wrap);
        }

        return page;
    }

    /** A credit row — a plain title, or a link row when the entry carries a URI. */
    private _buildCreditRow(raw: string): HTMLElement {
        const { name, uri } = parseCredit(raw);
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', name);

        if (uri) {
            row.setAttribute('activatable', '');
            row.classList.add('adw-about-dialog-link-row');
            const chevron = document.createElement('span');
            chevron.setAttribute('slot', 'suffix');
            chevron.className = 'adw-icon adw-icon--go-next adw-about-dialog-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            row.appendChild(chevron);
            row.addEventListener('activated', () => {
                this.dispatchEvent(new CustomEvent('activate-link', { bubbles: true, detail: { uri } }));
                window.open(uri, '_blank', 'noopener,noreferrer');
            });
        }

        return row;
    }

    /** The Legal page: copyright + license text. */
    private _buildLegalPage(): HTMLElement | null {
        if (!this._hasLegal()) return null;
        const { page, body } = this._buildPage('legal', 'Legal', false);

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
                const link = document.createElement('a');
                link.href = this.licenseUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = this.license;
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
