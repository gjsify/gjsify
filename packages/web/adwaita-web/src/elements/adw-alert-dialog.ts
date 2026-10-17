// <adw-alert-dialog> — A modal dialog presenting a message or a question (the
// web counterpart of Adw.AlertDialog). It renders a fixed full-cover scrim with
// a centred dialog box on top, holding a bold heading, body text, an optional
// extra-child slot, and one or more response buttons. Each response is a button
// with a unique string ID and a label; one may carry the suggested or
// destructive appearance.
//
// Responses are declared imperatively via add_response() (the Adw.AlertDialog API),
// or via <adw-alert-response> children consumed at connect time. The dialog is
// hidden until `present()` (or setting the `open` attribute) reveals it; Escape /
// scrim-click dismiss it — respecting the `close-response` — unless can-close is
// suppressed by the close response.
//
// THE GJS FORM RUNS AS WRITTEN: `new Adw.AlertDialog({ heading, close_response })`,
// `add_response(id, label)`, `connect('response', (dialog, id) => …)`, `present(parent)`.
// The response verbs carry libadwaita's snake_case names only — the camelCase
// `addResponse` / `setDefaultResponse` … this element used to publish had no GIR
// counterpart. `present()` attaches a detached dialog to the document: libadwaita adds it
// to the dialog host of `parent`'s ROOT window, and the page is that root here. A dialog
// `present()` attached leaves the document again when it closes, as `adw_dialog_close`
// unparents it from the host; one placed in markup stays where its author put it.
//
// Attributes:
//   heading    (the bold heading text)
//   body       (the body text below the heading)
//   heading-use-markup (boolean — read `heading` as markup rather than plain text)
//   body-use-markup    (boolean — read `body` as markup rather than plain text)
//   close-response     (the response ID emitted on dismissal; default `close`)
//   default-response   (the response ID whose button is highlighted and focused)
//   open       (boolean — whether the dialog is shown; default closed)
//   prefer-wide-layout (boolean — lay responses out horizontally when they fit)
//
// MARKUP IS OPT-IN, and here that MATCHES libadwaita rather than departing from it:
// `Adw.AlertDialog:heading-use-markup` and `:body-use-markup` both default to FALSE
// (`Adw.Banner:use-markup` is the one that defaults to TRUE, which is why
// `adw-banner.ts` documents a deliberate departure and this file does not need to).
// Opting in renders PANGO MARKUP through `renderPangoMarkup`: the string is PARSED by
// `@gjsify/adwaita-core` and turned into nodes one at a time, never handed to
// `innerHTML`. So opting in is no longer an assertion that the string is trusted —
// `<b>` is drawn bold whether or not the author vouched for it, and a tag pango does
// not know comes back as text.
//
// Buttons are stacked vertically by default (the Adw.AlertDialog default at medium
// sizes) and laid out horizontally when prefer-wide-layout is set and there are no more
// than two of them — the libadwaita measure/allocate heuristic in spirit, not to the px.
//
// Signals (declared in `static signals`, reached with `connect`):
//   `response (dialog, id)` when a response button is activated OR the dialog is
//     dismissed (then `id` is the close-response) — Adw.AlertDialog::response. It
//     arrives as a non-bubbling `response` DOM event whose `detail` is `[id]`.
//   `notify::heading` / `notify::body` (CustomEvent, bubbles) mirroring the matching
//     GObject properties; `notify::open` is the web-only `open` attribute's.
//
// The RESPONSE MODEL — the registry (id/label/appearance/enabled), the
// default/close-response semantics and the resolve-to-chosen-id contract — is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link AdwAlertResponses}, composed
// by `@gjsify/adwaita-nativescript` too. This element keeps only the DOM render half.
//
// Reference: refs/libadwaita/src/adw-alert-dialog.c (AdwAlertDialog behaviour)
// Reference: refs/libadwaita/src/adw-dialog.c (shared dialog base — Escape/close)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating-sheet)
// Reference: refs/adwaita-web/adwaita-web/scss/_dialog.scss (alert layout)
// Copyright (c) 2022 Purism SPC / 2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// response model composed from @gjsify/adwaita-core.

import { AdwAlertResponses } from '@gjsify/adwaita-core';
import type { AdwResponseAppearance } from '@gjsify/adwaita-core';
import { propertyOf } from '@gjsify/adwaita-core/tags';

import { dispatchElement, installElementApi } from '../gobject-elements.js';
import { renderPangoMarkup } from '../pango-markup.js';
import type { DispatchedSignals } from '../signals.js';
import { bindEmptySections } from '../empty-sections.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { AdwModalSurface } from './modal-surface.js';
import { booleanAttribute } from '../attributes.js';
import { WidgetElement } from '../widget-element.js';

/** Response button appearance — mirrors Adw.ResponseAppearance. */
export type { AdwResponseAppearance } from '@gjsify/adwaita-core';

/**
 * A single response declared in markup. Child of <adw-alert-dialog>; its `id`
 * attribute is the response ID, its text content the label. Optional
 * `appearance="suggested|destructive"` and `enabled="false"` mirror the
 * GtkBuildable `<response>` element attributes. Consumed at connect time.
 */
export class AdwAlertResponse extends WidgetElement {
    static get observedAttributes() {
        return ['id', 'appearance', 'enabled'];
    }
}

/** The `Adw.AlertDialog` construct properties, in GJS's snake_case or the camelCase GJS also takes. */
export interface AdwAlertDialogProps {
    heading?: string;
    body?: string;
    heading_use_markup?: boolean;
    headingUseMarkup?: boolean;
    body_use_markup?: boolean;
    bodyUseMarkup?: boolean;
    close_response?: string;
    closeResponse?: string;
    default_response?: string | null;
    defaultResponse?: string | null;
    prefer_wide_layout?: boolean;
    preferWideLayout?: boolean;
}

export class AdwAlertDialog extends WidgetElement {
    /** The GTK signals this element dispatches, each with the DOM event it arrives as (ADR 0093). */
    static readonly signals: DispatchedSignals = {
        response: 'response',
        ...Object.fromEntries(
            [
                'heading',
                'body',
                'heading-use-markup',
                'body-use-markup',
                'close-response',
                'default-response',
                'prefer-wide-layout',
            ].map((name) => [`notify::${name}`, `notify::${name}`]),
        ),
    };

    /** `GObject.Object.connect`: installed per instance by `installElementApi`; refuses an undeclared signal. */
    declare connect: (signal: string, handler: (emitter: this, ...args: any[]) => unknown) => number;
    /** `GObject.Object.disconnect`: throws for an id that is not connected. */
    declare disconnect: (id: number) => void;
    /** `GObject.Object.emit`. */
    declare emit: (signal: string, ...args: unknown[]) => void;
    /** `GObject.Object.notify`. */
    declare notify: (name: string) => void;
    /** `GObject.Object.get_property`, by GTK's dashed name. */
    declare get_property: (name: string) => unknown;
    /** `GObject.Object.set_property`. */
    declare set_property: (name: string, value: unknown) => void;

    private _initialized = false;
    /** Set when `present()` attached the dialog, so closing detaches it again. */
    private _attachedByPresent = false;
    private _scrimEl!: HTMLDivElement;
    private _dialogEl!: HTMLDivElement;
    private _headingEl!: HTMLHeadingElement;
    private _bodyEl!: HTMLParagraphElement;
    private _childEl!: HTMLDivElement;
    private _responseAreaEl!: HTMLDivElement;
    private _modal!: AdwModalSurface;

    /** The headless response registry + default/close semantics + resolution (ADR 0004). */
    private _model = new AdwAlertResponses();
    /** The rendered button per registered response id (the DOM half of the model). */
    private readonly _buttons = new Map<string, HTMLButtonElement>();
    // Set while a response is being emitted from a button, so the close handler does not
    // also fire the close-response (AdwAlertDialog's `block_close_response`).
    private _blockCloseResponse = false;

    /**
     * `new Adw.AlertDialog({ heading, body, close_response, default_response })`, the GJS
     * construct bag. Only the `new` form passes one: `document.createElement` and the
     * parser call this with nothing, which is why writing attributes here is allowed.
     */
    constructor(props?: AdwAlertDialogProps) {
        super();
        installElementApi(this);
        for (const [key, value] of Object.entries(props ?? {})) {
            if (value === undefined) continue;
            const member = propertyOf(key);
            if (!(member in this)) throw new Error(`No property ${key} on <adw-alert-dialog>`);
            (this as unknown as Record<string, unknown>)[member] = value;
        }
    }

    static get observedAttributes() {
        return [
            'heading',
            'body',
            'heading-use-markup',
            'body-use-markup',
            'close-response',
            'default-response',
            'open',
            'prefer-wide-layout',
        ];
    }

    get heading(): string {
        return this.getAttribute('heading') ?? '';
    }

    set heading(value: string) {
        this.setAttribute('heading', value);
    }

    get body(): string {
        return this.getAttribute('body') ?? '';
    }

    set body(value: string) {
        this.setAttribute('body', value);
    }

    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    /** Whether {@link heading} is read as markup rather than plain text. */
    get headingUseMarkup(): boolean {
        return this.hasAttribute('heading-use-markup');
    }

    set headingUseMarkup(value: boolean) {
        if (value) this.setAttribute('heading-use-markup', '');
        else this.removeAttribute('heading-use-markup');
    }

    /** Whether {@link body} is read as markup rather than plain text. */
    get bodyUseMarkup(): boolean {
        return this.hasAttribute('body-use-markup');
    }

    set bodyUseMarkup(value: boolean) {
        if (value) this.setAttribute('body-use-markup', '');
        else this.removeAttribute('body-use-markup');
    }

    /** Whether to prefer horizontal button layout when the buttons fit. */
    get preferWideLayout(): boolean {
        return this.hasAttribute('prefer-wide-layout');
    }

    set preferWideLayout(value: boolean) {
        if (value) this.setAttribute('prefer-wide-layout', '');
        else this.removeAttribute('prefer-wide-layout');
    }

    /** The ID of the default response (its button is highlighted). */
    get defaultResponse(): string | null {
        return this._model.defaultResponse;
    }

    set defaultResponse(value: string | null) {
        this.set_default_response(value);
    }

    /** The ID passed to `response` when the dialog is dismissed. */
    get closeResponse(): string {
        return this._model.closeResponse;
    }

    set closeResponse(value: string) {
        this.set_close_response(value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-alert-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._dismiss());

        this._dialogEl = document.createElement('div');
        this._dialogEl.className = 'adw-alert-dialog-box';
        // Clicks inside the box must not bubble to the scrim's dismiss handler.
        this._dialogEl.addEventListener('click', (event) => event.stopPropagation());
        // The role, `aria-modal`, Escape, the Tab trap and the return-focus.
        this._modal = new AdwModalSurface({
            host: this,
            surface: this._dialogEl,
            role: 'alertdialog',
            isOpen: () => this.open,
            onEscape: () => this._dismiss(),
            initialFocus: (focusables) => this._initialFocusTarget(focusables),
        });

        const messageArea = document.createElement('div');
        messageArea.className = 'adw-alert-dialog-message';

        this._headingEl = document.createElement('h2');
        this._headingEl.className = 'adw-alert-dialog-heading';

        this._bodyEl = document.createElement('p');
        this._bodyEl.className = 'adw-alert-dialog-body';

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-alert-dialog-child';

        messageArea.append(this._headingEl, this._bodyEl, this._childEl);

        this._responseAreaEl = document.createElement('div');
        this._responseAreaEl.className = 'adw-alert-dialog-responses';

        // Responses added before the first connect already own a button (`addResponse` is
        // callable at any point in the dialog's life); only the area to hang them in was missing.
        this._responseAreaEl.append(...this._buttons.values());

        this._dialogEl.append(messageArea, this._responseAreaEl);

        // Two slots, both LIVE. An `<adw-alert-response>` is DATA — read for its id, label
        // and appearance and then gone, as GtkBuilder leaves nothing of a `<responses>`
        // entry in the widget tree — so it is consumed rather than re-homed, and
        // `adw_alert_dialog_add_response` is callable at any point in the dialog's life.
        // Everything else is the extra child. `src/slotted-children.ts` has the incident.
        // Installed AFTER the response area exists, because consuming a response fills it.
        bindSlottedChildren(this, [
            {
                claims: (node) => node instanceof Element && node.localName === 'adw-alert-response',
                consume: (node) => this._adoptResponse(node as AdwAlertResponse),
            },
            { name: 'extra-child', into: this._childEl },
            { into: this._childEl },
        ]).install(this._scrimEl, this._dialogEl);

        // `_render` runs from `attributeChangedCallback` and from the response API, and an
        // extra child appended after connect triggers neither. AFTER the routing: this
        // derives once synchronously, and a `hidden` child area is not focusable, so
        // deriving it on the not-yet-filled box sent the initial focus to the default
        // response instead of into the content.
        bindEmptySections(this._childEl);

        // Seed the headless model's text from the parsed markup; the attributes stay the
        // source of truth for what is rendered.
        this._model.heading = this.heading;
        this._model.body = this.body;

        // And the two response IDs. `attributeChangedCallback` returns early until
        // `_initialized`, so an attribute present in the MARKUP — the declarative case
        // these attributes exist for — is never delivered to it. `heading` and `body`
        // survive that only because `_render()` re-reads them from the attribute; these
        // two live in the model and would simply be dropped.
        const closeResponse = this.getAttribute('close-response');
        if (closeResponse !== null) this._model.closeResponse = closeResponse;
        // An absent attribute leaves a `default_response` the construct bag already set.
        const defaultResponse = this.getAttribute('default-response');
        if (defaultResponse !== null) this._model.defaultResponse = defaultResponse;

        this._render();
    }

    /**
     * Take one declared `<adw-alert-response>` as a response. An entry with no `id` is
     * skipped rather than given a generated one: the id is what `response` events carry, so
     * inventing one would hand the consumer a name it never wrote.
     */
    private _adoptResponse(el: AdwAlertResponse): void {
        const id = el.getAttribute('id');
        if (!id) return;
        const appearance = (el.getAttribute('appearance') ?? 'default') as AdwResponseAppearance;
        this.add_response(id, (el.textContent ?? '').trim());
        if (appearance !== 'default') this.set_response_appearance(id, appearance);
        // `enabled` is a value-based boolean attribute (GTK property defaulting to TRUE).
        // Use the shared reader instead of a hand-rolled `=== 'false'` comparison.
        if (!booleanAttribute(el.getAttribute('enabled'), true)) this.set_response_enabled(id, false);
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'heading') {
            // Keep the headless model a complete description of the dialog; the attribute
            // stays the source of truth for the rendered heading.
            this._model.heading = this.heading;
            this.dispatchEvent(
                new CustomEvent('notify::heading', { bubbles: true, detail: { heading: this.heading } }),
            );
        } else if (name === 'body') {
            this._model.body = this.body;
            this.dispatchEvent(new CustomEvent('notify::body', { bubbles: true, detail: { body: this.body } }));
        } else if (name === 'close-response') {
            // The MODEL stays the source of truth for response semantics (see the
            // header) — the attribute is a markup entry point that feeds it, so the
            // setter is not mirrored back and there is no reflection loop. An absent
            // attribute means "leave the model's default", not "reset to `close`".
            if (newValue !== null) this.set_close_response(newValue);
        } else if (name === 'default-response') {
            this.set_default_response(newValue);
        } else if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (this.open) {
                this._modal.present();
            } else {
                this._modal.dismiss();
                if (this._attachedByPresent) {
                    this._attachedByPresent = false;
                    this.remove();
                }
            }
        }
    }

    /**
     * Present the dialog (`adw_dialog_present`). A detached dialog is attached to the document
     * first and detached again when it closes; `parent` names the window it belongs to, and the
     * page is that window's root here, so it does not change where the dialog goes.
     */
    present(_parent?: unknown): void {
        if (!this.isConnected) {
            document.body.appendChild(this);
            this._attachedByPresent = true;
        }
        this.open = true;
    }

    /** `adw_alert_dialog_add_response`: a duplicate id is refused, as libadwaita's g_critical does. */
    add_response(id: string, label: string): void {
        // The core registry UPDATES a duplicate id in place; AdwAlertDialog refuses it,
        // so the guard stays here.
        if (this._model.hasResponse(id)) {
            // Mirror AdwAlertDialog's g_critical without throwing.
            console.warn(
                `[adw-alert-dialog] Trying to add a response with id '${id}', but such a response already exists`,
            );
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-button adw-alert-dialog-response';
        button.textContent = label;
        button.addEventListener('click', () => this._activateResponse(id));

        this._model.addResponse(id, label);
        this._buttons.set(id, button);
        if (this._responseAreaEl) this._responseAreaEl.appendChild(button);
        this._render();
    }

    /** `adw_alert_dialog_remove_response`. */
    remove_response(id: string): void {
        if (!this._model.hasResponse(id)) {
            console.warn(
                `[adw-alert-dialog] Trying to remove a response with id '${id}', but such a response does not exist`,
            );
            return;
        }
        this._buttons.get(id)?.remove();
        this._buttons.delete(id);
        // `AdwAlertResponses` exposes no removal (a gap against
        // `adw_alert_dialog_remove_response`), so the registry is rebuilt from the
        // survivors — core stays the single owner of the response state.
        const survivors = this._model.responses.filter((response) => response.id !== id);
        const rebuilt = new AdwAlertResponses(this._model.heading, this._model.body);
        for (const response of survivors) {
            rebuilt.addResponse(response.id, response.label, {
                appearance: response.appearance,
                enabled: response.enabled,
            });
        }
        rebuilt.closeResponse = this._model.closeResponse;
        rebuilt.defaultResponse = this._model.defaultResponse === id ? null : this._model.defaultResponse;
        this._model = rebuilt;
        this._render();
    }

    /** `adw_alert_dialog_has_response`. */
    has_response(id: string): boolean {
        return this._model.hasResponse(id);
    }

    /** `adw_alert_dialog_get_response_label`; `null` for an unknown id, as the C returns NULL. */
    get_response_label(id: string): string | null {
        return this._model.responses.find((response) => response.id === id)?.label ?? null;
    }

    /** `adw_alert_dialog_set_response_label`. */
    set_response_label(id: string, label: string): void {
        const button = this._buttons.get(id);
        if (!button) return;
        // Re-adding a known id updates it in place (the core registry contract).
        this._model.addResponse(id, label);
        button.textContent = label;
    }

    /** `adw_alert_dialog_get_response_appearance`; `null` for an unknown id. */
    get_response_appearance(id: string): AdwResponseAppearance | null {
        return this._model.hasResponse(id) ? this._model.getResponseAppearance(id) : null;
    }

    /** `adw_alert_dialog_set_response_appearance`. */
    set_response_appearance(id: string, appearance: AdwResponseAppearance): void {
        const button = this._buttons.get(id);
        if (!button) return;
        this._model.setResponseAppearance(id, appearance);
        button.classList.toggle('suggested-action', appearance === 'suggested');
        button.classList.toggle('destructive-action', appearance === 'destructive');
    }

    /** `adw_alert_dialog_get_response_enabled`; `false` for an unknown id, as the C returns FALSE. */
    get_response_enabled(id: string): boolean {
        return this._model.hasResponse(id) ? this._model.getResponseEnabled(id) : false;
    }

    /** `adw_alert_dialog_set_response_enabled`: a disabled button cannot be activated. */
    set_response_enabled(id: string, enabled: boolean): void {
        const button = this._buttons.get(id);
        if (!button) return;
        this._model.setResponseEnabled(id, enabled);
        button.disabled = !enabled;
    }

    /** `adw_alert_dialog_get_default_response`. */
    get_default_response(): string | null {
        return this._model.defaultResponse;
    }

    /** `adw_alert_dialog_set_default_response`: its button is highlighted and takes the focus. */
    set_default_response(id: string | null): void {
        this._model.defaultResponse = id;
        this._render();
    }

    /** `adw_alert_dialog_get_close_response`. */
    get_close_response(): string {
        return this._model.closeResponse;
    }

    /** `adw_alert_dialog_set_close_response`: emitted on dismissal (Escape / scrim click). */
    set_close_response(id: string): void {
        this._model.closeResponse = id;
    }

    /** `adw_alert_dialog_get_heading`. */
    get_heading(): string {
        return this.heading;
    }

    /** `adw_alert_dialog_set_heading`. */
    set_heading(heading: string): void {
        this.heading = heading;
    }

    /** `adw_alert_dialog_get_body`. */
    get_body(): string {
        return this.body;
    }

    /** `adw_alert_dialog_set_body`. */
    set_body(body: string): void {
        this.body = body;
    }

    private _activateResponse(id: string): void {
        if (!this._model.getResponseEnabled(id)) return;
        // `emit_response`: block the close-response, close, then emit the chosen one.
        this._blockCloseResponse = true;
        this.open = false;
        this._blockCloseResponse = false;
        // `resolveById` validates against the registry and falls back to the close
        // response.
        this._emitResponse(this._model.resolveById(id));
    }

    /** Dismissal (Escape / scrim) — close, then emit the close-response. */
    private _dismiss(): void {
        if (!this.open) return;
        this.open = false;
        if (this._blockCloseResponse) return;
        // No choice was made — the core model resolves that to the close response.
        this._emitResponse(this._model.resolveById(null));
    }

    private _emitResponse(response: string): void {
        dispatchElement(this, 'response', [response]);
    }

    /**
     * Where a presented alert puts focus, in the three steps `adw_alert_dialog_grab_focus`
     * takes (refs/libadwaita/src/adw-alert-dialog.c:382): the CONTENT first
     * (`adw_widget_grab_focus_child (priv->scrolled_window)`, :397), then the default
     * widget (:406), then the first response whose `enabled` is set (:413). The default
     * response is rarely the first button — a destructive alert opens on Cancel — and
     * content beats it: an alert carrying an entry is answered by typing into it.
     *
     * `focusables` is the surface's own list, so what "focusable" means is decided once.
     */
    private _initialFocusTarget(focusables: readonly HTMLElement[]): HTMLElement | undefined {
        return focusables.find((el) => this._childEl.contains(el)) ?? this._defaultResponseButton();
    }

    /** The default response button, or the first enabled one. */
    private _defaultResponseButton(): HTMLElement | undefined {
        const defaultId = this._model.defaultResponse;
        const firstEnabledId = this._model.responses.find((response) => response.enabled)?.id;
        // The enabled check covers the DEFAULT too: `focus()` on a disabled button is a
        // no-op, so handing one back left the dialog open with focus outside itself.
        const defaultButton =
            defaultId !== null && this._model.getResponseEnabled(defaultId) ? this._buttons.get(defaultId) : undefined;
        return defaultButton ?? (firstEnabledId ? this._buttons.get(firstEnabledId) : undefined);
    }

    private _render(): void {
        // Before the first connect there is no DOM to render into; `connectedCallback` renders.
        if (!this._initialized) return;
        this.classList.toggle('open', this.open);

        const heading = this.heading;
        if (this.headingUseMarkup) renderPangoMarkup(this._headingEl, heading);
        else this._headingEl.textContent = heading;
        this._headingEl.hidden = heading.length === 0;

        const body = this.body;
        if (this.bodyUseMarkup) renderPangoMarkup(this._bodyEl, body);
        else this._bodyEl.textContent = body;
        this._bodyEl.hidden = body.length === 0;

        // Horizontal only when prefer-wide-layout is set AND there are at most two
        // responses — the AdwAlertDialog heuristic for keeping wide buttons readable.
        const horizontal = this.preferWideLayout && this._model.responses.length <= 2;
        this._responseAreaEl.classList.toggle('horizontal', horizontal);

        // The default response gets the suggested highlight unless it already carries an
        // explicit appearance.
        const defaultId = this._model.defaultResponse;
        for (const response of this._model.responses) {
            const isDefault = response.id === defaultId && response.appearance === 'default';
            this._buttons.get(response.id)?.classList.toggle('default-response', isDefault);
        }
    }
}

customElements.define('adw-alert-response', AdwAlertResponse);
customElements.define('adw-alert-dialog', AdwAlertDialog);
