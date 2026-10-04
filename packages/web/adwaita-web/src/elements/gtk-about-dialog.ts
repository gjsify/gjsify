// <gtk-about-dialog> — GTK's own "About" window, the browser counterpart of
// `GtkAboutDialog`, and NOT the libadwaita one `<adw-about-dialog>` ports: this widget
// is a `GtkWindow` whose headerbar holds a `GtkStackSwitcher` over a four-page
// `GtkStack` — main, Credits, License, System — and whose main page is a column of
// centred labels under a dialog-size logo (gtkaboutdialog.ui).
//
// The DIALOG CHROME IS `<adw-dialog>`'s, not a copy of it: this element extends
// `AdwDialog`, so the full-cover scrim, the floating sheet, `present()`/`close()`,
// `can-close`, Escape, the Tab trap, the initial focus and the return-focus are the ones
// `adw-dialog.ts` already implements, and the only thing added here is the header hook
// (`decorateHeader`) that puts the switcher where GTK puts it — in the title position,
// with NO title text, exactly as the `.ui` declares. That is also why there is no
// `aria-modal` anywhere below: `elements/modal-surface.ts` owns the declaration.
//
// WHAT IS PORTED FROM `gtkaboutdialog.c`, AND WHERE IT SHOWS
//
//   · `update_name_version` (:1066-1082): the window title is `About <program-name>`
//     and the name label is BOLD; the version label is visible only when a version was
//     set. An UNSET `program-name` falls back to `g_get_application_name()`, which in a
//     document is `document.title` — the same "the application calls itself whatever
//     its own name is" rule, and the reason the element shows something for a dialog
//     that named nothing.
//   · the three page-visibility rules: License exists only for
//     `license-type == custom && license != NULL && license[0] != 0`
//     (`update_license_button_visibility`, :686-696), System only for a non-empty
//     `system-information` (:700-710), and Credits for any of authors / documenters /
//     artists / credit sections / a `translator-credits` that is not an untranslated
//     gettext sentinel (:700-717). The STACK SWITCHER is visible when any of the three
//     is (`update_stack_switcher_visibility`, :657-670), which is why a dialog with
//     none shows an EMPTY headerbar — GTK's own answer.
//   · `set_license_type` (:2259-2313): any type other than `custom` OVERWRITES `license`
//     with the warranty preamble, links it to that licence's URL (falling back to
//     `website` for a licence whose row has no URL, which is what `unknown` does), and
//     forces `wrap-license` TRUE. `gtk_license_info` (:126-146) is the table, held once
//     in `@gjsify/adwaita-core` as `ADW_LICENSES`; the preamble is GTK's own string,
//     which differs from libadwaita's in its first words and in the newline.
//   · `stack_visible_child_notify` (:297-333): the Credits, License and System pages are
//     populated LAZILY, the first time the stack shows them. A credits grid for 300
//     authors is not built by a dialog that is never opened to it.
//   · `populate_credits_page` (:2029-2080) order and headings — "Created by",
//     "Documented by", "Translated by", "Design by", then the app's own sections — with
//     the translator list split on newlines and the untranslated sentinel suppressed
//     (`translatorCreditsPeople`, `creditsSections`).
//   · `add_credits_section` (:1903-2027): a two-column grid, the heading in column 0
//     right-aligned, each name in column 1, and a blank row after every section ("skip
//     one at the end").
//   · `text_buffer_new` (:1903-1990 in `gtkaboutdialog.c`; the License and System text
//     views): `<http://…>` and `<mail@host>` angle-bracket links and bare `http(s)` URLs
//     become clickable spans, everything else stays literal.
//   · `emit_activate_link` (:646-655) + the `activate-link` accumulator: the signal is
//     `BOOLEAN__STRING` with `_gtk_boolean_handled_accumulator`, so a handler returning
//     TRUE suppresses the default navigation — which is what `preventDefault()` on the
//     cancelable CustomEvent spells.
//   · `gtk_widget_class_add_binding_action (…, GDK_KEY_Escape, …, "window.close")`
//     (:725): the base class's Escape handling, through the shared modal surface.
//
// KNOWN_GAPS — one property, and it is a TYPE the attribute could have carried:
//   · `logo` (`Gdk.Paintable`) is taken as a URL string and drawn as an `<img>`, because
//     the browser has no paintable object and an attribute can hold a URL. `logo-icon-name`
//     overrides it, as in the C (`gtk_about_dialog_set_logo_icon_name` overwrites the
//     paintable and notifies `logo` back to NULL).
//   · The `<a href="…">` markup form a credit line may carry is NOT recognised as a link
//     (`add_credits_section` leaves it to the label's Pango parser, :2160-2164): this
//     renderer builds DOM nodes, not markup, so such a line shows its markup literally.
//     The link syntax that DOES work is the same one everywhere else — `Ada <ada@x.org>`
//     or `Ada https://example.org`.
//   · The visited-link colour (`update_links_cb`, :720-747) is not tracked: a clicked
//     link does not stay a second colour, which is the one state GTK keeps across a
//     dialog's whole life.
//
// Attributes (the GObject property names, hyphenated):
//   program-name, version, copyright, comments, license, license-type,
//   system-information, website, website-label, translator-credits, logo-icon-name,
//   wrap-license — plus `open`/`can-close`/`title`/`content-width`/`content-height`/
//   `presentation-mode`/`show-header` from the `<adw-dialog>` chrome it extends.
//
// Properties with no attribute form, exactly as in the C (a `GStrv` is not a string and
// `authors` is `char **`): `authors`, `documenters`, `artists`, and
// `addCreditSection(name, people)` for the app's own sections. `logo` takes a URL.
//
// Events (bubbling CustomEvents): `notify::open` (`{ open }`), `closed` and
// `activate-link` (`{ uri }`, CANCELABLE) from the base class, plus `notify::<prop>` for
// every property this element reflects.
//
// A11y: role `dialog` on the sheet, from `AdwModalSurface`. The switcher is a row of
// toggle buttons naming the three pages, and the sheet's `aria-label` is the window
// title, since the headerbar carries no text of its own.
//
// Reference: refs/gtk/gtk/gtkaboutdialog.c (every derivation cited above by line)
// Reference: refs/gtk/gtk/ui/gtkaboutdialog.ui (the page tree and the headerbar)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss:46-56
//   (window.aboutdialog: a FLAT titlebar and `image.large-icons` at 128px)
// Reference: packages/web/adwaita-web/src/elements/adw-dialog.ts (the chrome reused)
// Copyright (c) 2008-2024 Red Hat, Inc. / The GTK authors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the icon nodes
// are <gtk-image>; the licence table and the credit parsing come from
// @gjsify/adwaita-core (ADR 0004).

import { ADW_LICENSES, GTK_LICENSE, parseCreditPerson, translatorCreditsPeople } from '@gjsify/adwaita-core';

import { AdwDialog } from './adw-dialog.js';
import { createGtkImage } from './gtk-image.js';

/** The four `GtkStackPage` titles of the `.ui`, mnemonics absent (they carry none). */
const PAGE_TITLES = {
    main: 'About',
    credits: 'Credits',
    license: 'License',
    system: 'System',
} as const;

/** The three pages behind the switcher, in stack order. */
const EXTRA_PAGES = ['credits', 'license', 'system'] as const;
type ExtraPage = (typeof EXTRA_PAGES)[number];

/** The `GtkLicense` nicks `packages/framework/gtk-host` generates, in enum order. */
const LICENSE_NICKS = [
    'unknown',
    'custom',
    'gpl-2-0',
    'gpl-3-0',
    'lgpl-2-1',
    'lgpl-3-0',
    'bsd',
    'mit-x11',
    'artistic',
    'gpl-2-0-only',
    'gpl-3-0-only',
    'lgpl-2-1-only',
    'lgpl-3-0-only',
    'agpl-3-0',
    'agpl-3-0-only',
    'bsd-3',
    'apache-2-0',
    'mpl-2-0',
    '0bsd',
] as const;

/**
 * GTK's licence preamble (`gtk_about_dialog_set_license_type`, :2301) — NOT
 * libadwaita's `ADW_LICENSE_WARRANTY_TEMPLATE`, which says "This application" and has no
 * newline. Both strings are translatable and they are not translations of each other.
 * The C template is `'This program comes with absolutely no warranty.\nSee the
 * <a href="%s">%s</a> for details.'`; `_licenseMarkup` composes the same three runs —
 * text, link, text — as DOM, because the scan it uses for plain licence text would read
 * the `<a href>` as an email address.
 */

export class GtkAboutDialog extends AdwDialog {
    private _built = false;
    private _logo = '';
    private _switcherEl!: HTMLDivElement;
    private _stackEl!: HTMLDivElement;
    private _pages = new Map<string, HTMLElement>();
    private _populated = new Set<string>();
    private _authors: string[] = [];
    private _documenters: string[] = [];
    private _artists: string[] = [];
    private _creditSections: Array<{ name: string; people: string[] }> = [];

    static get observedAttributes(): string[] {
        return [
            ...AdwDialog.observedAttributes,
            'program-name',
            'version',
            'copyright',
            'comments',
            'license',
            'license-type',
            'system-information',
            'website',
            'website-label',
            'translator-credits',
            'logo-icon-name',
            'wrap-license',
        ];
    }

    // ------------------------------------------------------------ properties

    /** The program name; unset falls back to the document's own title (`g_get_application_name`). */
    get programName(): string {
        return this.getAttribute('program-name') ?? '';
    }

    set programName(value: string) {
        this.setAttribute('program-name', value);
    }

    get version(): string {
        return this.getAttribute('version') ?? '';
    }

    set version(value: string) {
        this.setAttribute('version', value);
    }

    get copyright(): string {
        return this.getAttribute('copyright') ?? '';
    }

    set copyright(value: string) {
        this.setAttribute('copyright', value);
    }

    get comments(): string {
        return this.getAttribute('comments') ?? '';
    }

    set comments(value: string) {
        this.setAttribute('comments', value);
    }

    get license(): string {
        return this.getAttribute('license') ?? '';
    }

    set license(value: string) {
        // `set_license` (:1279) stores the text AND forces the type to CUSTOM, in
        // that order — a MIT-typed dialog that is given licence text becomes custom.
        this.setAttribute('license', value);
        this.setAttribute('license-type', 'custom');
    }

    /** The `GtkLicense` nick — `unknown`, `custom`, `mit-x11`, … */
    get licenseType(): string {
        const value = this.getAttribute('license-type');
        return value !== null && LICENSE_NICKS.includes(value as (typeof LICENSE_NICKS)[number]) ? value : 'unknown';
    }

    set licenseType(value: string) {
        if (LICENSE_NICKS.includes(value as (typeof LICENSE_NICKS)[number])) this.setAttribute('license-type', value);
        else this.removeAttribute('license-type');
    }

    get systemInformation(): string {
        return this.getAttribute('system-information') ?? '';
    }

    set systemInformation(value: string) {
        this.setAttribute('system-information', value);
    }

    get website(): string {
        return this.getAttribute('website') ?? '';
    }

    set website(value: string) {
        this.setAttribute('website', value);
    }

    get websiteLabel(): string {
        return this.getAttribute('website-label') ?? '';
    }

    set websiteLabel(value: string) {
        this.setAttribute('website-label', value);
    }

    get translatorCredits(): string {
        return this.getAttribute('translator-credits') ?? '';
    }

    set translatorCredits(value: string) {
        this.setAttribute('translator-credits', value);
    }

    /** The named-icon logo; overrides {@link logo}, as in the C. */
    get logoIconName(): string {
        return this.getAttribute('logo-icon-name') ?? '';
    }

    set logoIconName(value: string) {
        this.setAttribute('logo-icon-name', value);
    }

    /** Whether the License page's text view WRAPS (`populate_license_page`, :2157). */
    get wrapLicense(): boolean {
        return this.hasAttribute('wrap-license');
    }

    set wrapLicense(value: boolean) {
        this.toggleAttribute('wrap-license', value);
    }

    /**
     * A logo URL, drawn as an `<img>`.
     *
     * `GtkAboutDialog:logo` is a `GdkPaintable`, which is the one GObject property here
     * an attribute could have carried and cannot: there is no paintable in a document.
     * A URL is the honest browser stand-in and the override order is the C's.
     */
    get logo(): string {
        return this._logo;
    }

    set logo(value: string) {
        this._logo = value;
        if (this._built) this._renderLogo();
    }

    /** The people whose names the Credits page shows — `GtkAboutDialog:authors`. */
    get authors(): string[] {
        return [...this._authors];
    }

    set authors(value: readonly string[]) {
        this._authors = [...value];
        this._creditsChanged();
    }

    get documenters(): string[] {
        return [...this._documenters];
    }

    set documenters(value: readonly string[]) {
        this._documenters = [...value];
        this._creditsChanged();
    }

    get artists(): string[] {
        return [...this._artists];
    }

    set artists(value: readonly string[]) {
        this._artists = [...value];
        this._creditsChanged();
    }

    /** `gtk_about_dialog_add_credit_section` — an extra titled group on the Credits page. */
    addCreditSection(name: string, people: readonly string[]): void {
        this._creditSections.push({ name, people: [...people] });
        this._creditsChanged();
    }

    private _creditsChanged(): void {
        // The C latches the page visible the moment a credit is set and never clears it;
        // recomputing from the inputs is the same rule without the stale flag, and it is
        // what `creditsSections` exists to be read by.
        this._populated.delete('credits');
        if (this._built) this._renderAbout();
    }

    // ------------------------------------------------------------ lifecycle

    connectedCallback(): void {
        if (this._built) {
            // A re-attach (AdwDialog.present on a dialog already in the document) must
            // not rebuild the subtree — the DOM already exists.
            super.connectedCallback();
            return;
        }
        // BEFORE `super.connectedCallback()`, which renders and therefore calls
        // `decorateHeader` — the switcher is what that hook installs.
        this._switcherEl = document.createElement('div');
        this._switcherEl.className = 'adw-gtk-about-dialog-switcher';
        this._switcherEl.setAttribute('role', 'tablist');
        this._switcherEl.setAttribute('aria-label', 'Pages');

        super.connectedCallback();
        // `_stackEl` before `_build`, which appends the pages to it — and `_built`
        // goes last: `setAttribute('title')` below re-enters through
        // `attributeChangedCallback`, and rendering on an empty `_pages` map throws.
        this._stackEl = document.createElement('div');
        this._stackEl.className = 'adw-gtk-about-dialog-stack';
        this._stackEl.dataset.transitionType = 'crossfade';

        // GTK's window title is `About <name>` whatever the headerbar shows, and the
        // headerbar shows no text of its own — so the title is what assistive tech reads.
        this.setAttribute('title', `About ${this.programName || document.title}`);
        // The base adopts the author's light-DOM children into `contentArea` on
        // connect; rebuilding around them must keep them, AFTER the dialog's own UI —
        // which is also where children appended later land (`slotted-children.spec.ts`
        // pins the equality, path and index).
        const adopted = [...this.contentArea.childNodes];
        this.contentArea.replaceChildren(this._build());
        for (const node of adopted) this.contentArea.appendChild(node);
        // `_build` hides every page but `main`, which is `gtk_stack_set_visible_child_name
        // (…, "main")`; the three visibility rules then decide which of the others exist.
        this._renderAbout();
        this._built = true;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        super.attributeChangedCallback(name, oldValue, newValue);
        if (!this._built) return;
        if (oldValue === newValue) return;
        if (name === 'license' || name === 'license-type' || name === 'website') {
            // `set_license` sets the type to CUSTOM and `set_license_type` overwrites
            // the text, so either one can invalidate the other's rendering.
            this._populated.delete('license');
        }
        if (name === 'system-information') this._populated.delete('system');
        if (name === 'website' || name === 'website-label' || name === 'license' || name === 'license-type') {
            this._renderMain();
            this._populateLicense();
        }
        if (name === 'wrap-license') this._populateLicense();
        if (name === 'system-information') this._populateSystem();
        this._renderAbout();
    }

    /**
     * The headerbar carries the stack switcher and nothing else, exactly as
     * `gtkaboutdialog.ui` declares it (`title-widget` → the switcher, no title).
     */
    protected override decorateHeader(header: HTMLElement): void {
        const title = header.querySelector('.adw-dialog-title');
        // The switcher takes the title's place; the title carries no text of its own here.
        if (title !== null) {
            title.replaceWith(this._switcherEl);
        } else {
            header.prepend(this._switcherEl);
        }
        this._renderSwitcher();
    }

    /** Which stack page is showing — `gtk_stack_get_visible_child_name`. */
    get visiblePage(): string {
        return this._stackEl.dataset.visible ?? 'main';
    }

    /**
     * Show a page of the stack — `gtk_stack_set_visible_child_name`. The switcher buttons
     * call it, and it is the one way the stack's lazy population (`stack_visible_child_notify`)
     * runs: a page is built the first time it is shown, not before.
     */
    showPage(name: string): void {
        this._populatePage(name);
        for (const [key, page] of this._pages) page.hidden = key !== name;
        this._stackEl.dataset.visible = name;
        this._renderSwitcher();
    }

    // ------------------------------------------------------------ rendering

    private _build(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'adw-gtk-about-dialog-box';

        const head = document.createElement('div');
        head.className = 'adw-gtk-about-dialog-head';

        const logoSlot = document.createElement('div');
        logoSlot.className = 'adw-gtk-about-dialog-logo-slot';
        head.appendChild(logoSlot);
        this._renderLogo();

        const name = document.createElement('div');
        name.className = 'adw-gtk-about-dialog-name';
        name.textContent = this.programName || document.title;
        head.appendChild(name);

        for (const page of ['main', ...EXTRA_PAGES]) {
            const element = document.createElement('div');
            element.className = 'adw-gtk-about-dialog-page';
            element.dataset.page = page;
            element.hidden = page !== 'main';
            this._pages.set(page, element);
            this._stackEl.appendChild(element);
        }
        this._renderMain();
        head.appendChild(this._stackEl);
        root.appendChild(head);
        return root;
    }

    private _renderAbout(): void {
        this.setAttribute('title', `About ${this.programName || document.title}`);
        for (const page of EXTRA_PAGES) {
            const element = this._pages.get(page);
            if (element === undefined) continue;
            // `gtk_stack_page_set_visible` — and a page that stops being visible is also
            // dropped from the switcher, because the switcher lists the pages the stack
            // holds and no more.
            const visible = this._pageVisible(page);
            if (element.hidden === !visible) continue;
            element.hidden = !visible;
            if (!visible) this._populated.delete(page);
        }
        if (this._pages.get(this._stackEl.dataset.visible ?? 'main')?.hidden !== false) {
            this._stackEl.dataset.visible = 'main';
            this._pages.get('main')!.hidden = false;
        }
        this._renderMain();
        this._renderSwitcher();
    }

    /** The three visibility rules, one predicate each, as in the C. */
    private _pageVisible(page: ExtraPage): boolean {
        if (page === 'credits') return this._creditsPeople().length > 0;
        if (page === 'license') return this.licenseType === 'custom' && this.license.length > 0;
        return this.systemInformation.length > 0;
    }

    /** `add_credits_section`'s input, in `populate_credits_page`'s order. */
    private _creditsPeople(): Array<{ title: string; people: readonly string[] }> {
        const sections: Array<{ title: string; people: readonly string[] }> = [];
        if (this._authors.length > 0) sections.push({ title: 'Created by', people: this._authors });
        if (this._documenters.length > 0) sections.push({ title: 'Documented by', people: this._documenters });
        const translators = translatorCreditsPeople(this.translatorCredits);
        if (translators.length > 0) sections.push({ title: 'Translated by', people: translators });
        if (this._artists.length > 0) sections.push({ title: 'Design by', people: this._artists });
        for (const section of this._creditSections) sections.push({ title: section.name, people: section.people });
        return sections;
    }

    /** Whether the stack switcher has anything to show (`update_stack_switcher_visibility`). */
    private _visiblePages(): ExtraPage[] {
        return EXTRA_PAGES.filter((page) => this._pages.get(page)?.hidden === false);
    }

    private _renderSwitcher(): void {
        if (this._switcherEl === undefined) return;
        const pages = this._visiblePages();
        // GTK hides the whole switcher (`gtk_widget_set_visible (about->stack_switcher,
        // any_visible)`), which is why an about dialog with no credits, licence or system
        // information shows an EMPTY headerbar.
        this._switcherEl.hidden = pages.length === 0;
        this._switcherEl.replaceChildren(
            ...pages.map((page) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'adw-gtk-about-dialog-switcher-item';
                button.setAttribute('role', 'tab');
                button.textContent = PAGE_TITLES[page];
                button.classList.toggle('checked', this._stackEl.dataset.visible === page);
                button.setAttribute('aria-selected', String(this._stackEl.dataset.visible === page));
                button.addEventListener('click', () => this.showPage(page));
                return button;
            }),
        );
    }

    private _renderLogo(): void {
        const slot = this.contentArea.querySelector('.adw-gtk-about-dialog-logo-slot');
        if (slot === null) return;
        // `set_logo_icon_name` overwrites the paintable, and notifies `logo` back to NULL:
        // the icon name wins whenever it is set, which is the only precedence there is.
        if (this.logoIconName.length > 0) {
            slot.replaceChildren(createGtkImage(this.logoIconName, 'adw-gtk-about-dialog-logo'));
            return;
        }
        if (this._logo.length > 0) {
            const image = document.createElement('img');
            image.className = 'adw-gtk-about-dialog-logo';
            image.src = this._logo;
            image.alt = '';
            slot.replaceChildren(image);
            return;
        }
        slot.replaceChildren();
    }

    /** The main page: version, comments, website, copyright, licence — in `.ui` order. */
    private _renderMain(): void {
        const page = this._pages.get('main');
        if (page === undefined) return;
        const rows: HTMLElement[] = [];

        const label = (text: string, className: string): HTMLElement => {
            const element = document.createElement('div');
            element.className = className;
            element.textContent = text;
            return element;
        };

        if (this.version.length > 0) rows.push(label(this.version, 'adw-gtk-about-dialog-version'));
        if (this.comments.length > 0) rows.push(label(this.comments, 'adw-gtk-about-dialog-comments'));
        // `update_website` (:1009-1041): a URL with no label shows the word "Website", a
        // label with no URL shows the label alone and is NOT a link, and neither shows
        // anything when both are unset.
        if (this.website.length > 0) {
            rows.push(
                this.websiteLabel.length > 0
                    ? this._link(this.websiteLabel, this.website, 'adw-gtk-about-dialog-website')
                    : this._link('Website', this.website, 'adw-gtk-about-dialog-website'),
            );
        } else if (this.websiteLabel.length > 0) {
            rows.push(label(this.websiteLabel, 'adw-gtk-about-dialog-website'));
        }
        if (this.copyright.length > 0) rows.push(label(this.copyright, 'adw-gtk-about-dialog-copyright'));
        const licence = this._licenseMarkup();
        if (licence !== null) rows.push(licence);

        page.replaceChildren(...rows);
    }

    /**
     * The licence label: the text `license` holds, with its `<…>` and bare-URL links
     * turned into spans — or, for a known type, the warranty preamble `set_license_type`
     * composes. The preamble keeps its `<a href>` markup and is read with
     * `gtk_label_set_markup` (:2354), a REAL link: it never goes through the
     * `text_buffer_new` scan below, which would read `<a href="…">` as an email
     * address. Same split here.
     */
    private _licenseMarkup(): HTMLElement | null {
        const type = this.licenseType;
        const index = LICENSE_NICKS.indexOf(type as (typeof LICENSE_NICKS)[number]);
        const licenseType =
            index >= 0 ? (index as (typeof GTK_LICENSE)[keyof typeof GTK_LICENSE]) : GTK_LICENSE.UNKNOWN;
        const element = document.createElement('div');
        element.className = 'adw-gtk-about-dialog-license';
        if (licenseType !== GTK_LICENSE.CUSTOM && licenseType !== GTK_LICENSE.UNKNOWN) {
            const info = ADW_LICENSES[licenseType]!;
            // A licence row with no URL of its own links to the WEBSITE, which is what
            // `set_license_type` does for `unknown` and for a row whose `url` is NULL.
            const url = info.url ?? this.website;
            element.append(
                document.createTextNode('This program comes with absolutely no warranty.\nSee the '),
                this._link(info.name ?? '', url, 'adw-gtk-about-dialog-license-link'),
                document.createTextNode(' for details.'),
            );
            return element;
        }
        if (licenseType === GTK_LICENSE.UNKNOWN || this.license.length === 0) return null;
        this._fillWithLinks(element, this.license);
        return element;
    }

    /** The License page — a text view whose wrap mode is `wrap-license`. */
    private _populateLicense(): void {
        const page = this._pages.get('license');
        if (page === undefined) return;
        const view = document.createElement('div');
        view.className = 'adw-gtk-about-dialog-text-view';
        // `populate_license_page` (:2157-2166): WRAP_WORD when `wrap-license`, else NONE.
        if (this.wrapLicense) view.classList.add('wrap');
        const markup = this._licenseMarkup();
        if (markup !== null) {
            const body = document.createElement('div');
            body.className = 'adw-gtk-about-dialog-text';
            // The main label's runs, cloned — including the preamble's real link.
            body.replaceChildren(...[...markup.childNodes].map((node) => node.cloneNode(true)));
            view.appendChild(body);
        }
        page.replaceChildren(this._frame(view));
    }

    /** The System page — a text view with no wrap mode of its own. */
    private _populateSystem(): void {
        const page = this._pages.get('system');
        if (page === undefined) return;
        const view = document.createElement('div');
        view.className = 'adw-gtk-about-dialog-text-view';
        const body = document.createElement('div');
        body.className = 'adw-gtk-about-dialog-text';
        this._fillWithLinks(body, this.systemInformation);
        view.appendChild(body);
        page.replaceChildren(this._frame(view));
    }

    /** The Credits page — the scrolled, framed grid `populate_credits_page` fills. */
    private _populateCredits(): void {
        const page = this._pages.get('credits');
        if (page === undefined) return;

        const grid = document.createElement('div');
        grid.className = 'adw-gtk-about-dialog-credits-grid';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', PAGE_TITLES.credits);

        for (const section of this._creditsPeople()) {
            const heading = document.createElement('div');
            heading.className = 'adw-gtk-about-dialog-credits-heading';
            heading.textContent = section.title;
            grid.appendChild(heading);
            for (const person of section.people) {
                const parsed = parseCreditPerson(person);
                const row = document.createElement('div');
                row.className = 'adw-gtk-about-dialog-credits-person';
                if (parsed.link !== null) {
                    row.appendChild(this._link(parsed.name, parsed.uri ?? '', 'adw-gtk-about-dialog-credits-link'));
                } else {
                    row.textContent = parsed.name;
                }
                grid.appendChild(row);
            }
            // "skip one at the end" — an empty row so consecutive sections do not touch.
            grid.appendChild(document.createElement('div'));
        }
        page.replaceChildren(this._frame(grid));
    }

    /**
     * `stack_visible_child_notify` (:297-333): each of the three pages is built the first
     * time the stack SHOWS it, and never rebuilt after. A credits grid for three hundred
     * authors is not work a dialog nobody opened it for.
     */
    private _populatePage(name: string): void {
        if (this._populated.has(name)) return;
        this._populated.add(name);
        if (name === 'credits') this._populateCredits();
        else if (name === 'license') this._populateLicense();
        else if (name === 'system') this._populateSystem();
    }

    /** The framed scrolled window the three extra pages sit in (`has-frame`). */
    private _frame(content: HTMLElement): HTMLElement {
        const scrolled = document.createElement('div');
        scrolled.className = 'adw-gtk-about-dialog-scrolled';
        const viewport = document.createElement('div');
        viewport.className = 'adw-view';
        viewport.appendChild(content);
        scrolled.appendChild(viewport);
        return scrolled;
    }

    private _link(text: string, uri: string, className: string): HTMLElement {
        const link = document.createElement('a');
        link.className = className;
        link.href = uri;
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            this._activateLink(uri);
        });
        return link;
    }

    /**
     * `text_buffer_new` (:1903-2028 of `gtkaboutdialog.c`) for the plain-DOM case: split
     * the string into literal runs and links. A `<…>` run is an email when it carries no
     * scheme and a URL when it does; a bare `http://` or `https://` run ends at the first
     * of space, newline, tab or `>`, which is `strpbrk (r1, " \n\t>")`.
     */
    private _fillWithLinks(target: HTMLElement, text: string): void {
        for (const part of splitLinks(text)) {
            if (part.uri === null) {
                target.appendChild(document.createTextNode(part.text));
                continue;
            }
            const link = document.createElement('a');
            link.href = part.uri;
            link.rel = 'noopener noreferrer';
            link.textContent = part.text;
            link.addEventListener('click', (event) => {
                event.preventDefault();
                this._activateLink(part.uri!);
            });
            target.appendChild(link);
        }
    }

    /**
     * `emit_activate_link` (:646-655): the `BOOLEAN__STRING` accumulator. A handler that
     * returns TRUE says it took over, which is `preventDefault()` here — and only then
     * does the default `Gtk.UriLauncher` navigation not happen.
     */
    private _activateLink(uri: string): void {
        const event = new CustomEvent('activate-link', {
            bubbles: true,
            cancelable: true,
            detail: { uri },
        });
        if (this.dispatchEvent(event)) window.open(uri, '_blank', 'noopener,noreferrer');
    }
}

/** One run of `text_buffer_new`'s output: literal text, or a link with its URI. */
interface LinkPart {
    readonly text: string;
    readonly uri: string | null;
}

/** The terminator set a bare URL ends at (`strpbrk (r1, " \n\t>")`). */
const URL_TERMINATORS = ' \n\t>';

/**
 * `text_buffer_new`'s scan, in order: the first `<` and the first `>` after it, the
 * earliest bare `http://` or `https://` and where it ends, and the C's own precedence —
 * a URL that starts AT or just after the `<` wins, which leaves the bracket in the text.
 */
export function splitLinks(text: string): LinkPart[] {
    const parts: LinkPart[] = [];
    let rest = text;
    while (rest.length > 0) {
        let bracket = rest.indexOf('<');
        let bracketEnd = bracket < 0 ? -1 : rest.indexOf('>', bracket);
        const httpAt = rest.indexOf('http://');
        const httpsAt = rest.indexOf('https://');
        let urlAt = httpAt;
        if (httpAt < 0 || (httpsAt >= 0 && httpsAt < httpAt)) urlAt = httpsAt;
        let urlEnd = -1;
        if (urlAt >= 0) {
            urlEnd = URL_TERMINATORS.split('').reduce((found, character) => {
                if (found >= 0) return found;
                const at = rest.indexOf(character, urlAt);
                return at < 0 ? -1 : at;
            }, -1);
            if (urlEnd < 0) urlEnd = rest.length;
        }
        if (urlAt >= 0 && (bracket < 0 || bracketEnd < 0 || urlAt <= bracket + 1)) {
            bracket = urlAt;
            bracketEnd = urlEnd;
        }
        if (bracket < 0 || bracketEnd < 0) {
            parts.push({ text: rest, uri: null });
            break;
        }
        if (bracket > 0) parts.push({ text: rest.slice(0, bracket), uri: null });
        const isEmail = rest[bracket] === '<';
        const body = isEmail ? rest.slice(bracket + 1, bracketEnd) : rest.slice(bracket, bracketEnd);
        parts.push({ text: body, uri: isEmail ? `mailto:${body}` : body });
        rest = rest.slice(bracketEnd + (isEmail ? 1 : 0));
    }
    return parts;
}

customElements.define('gtk-about-dialog', GtkAboutDialog);
