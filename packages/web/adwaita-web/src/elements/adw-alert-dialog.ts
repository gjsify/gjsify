// <adw-alert-dialog> — A modal dialog presenting a message or a question (the
// web counterpart of Adw.AlertDialog). It renders a fixed full-cover scrim with
// a centred dialog box on top, holding a bold heading, body text, an optional
// extra-child slot, and one or more response buttons. Each response is a button
// with a unique string ID and a label; one may carry the suggested or
// destructive appearance.
//
// Responses are declared imperatively via add_response() / addResponse() (the
// Adw.AlertDialog API), or via <adw-alert-response> children consumed at connect
// time. The dialog is hidden until `present()` (or setting the `open` attribute)
// reveals it; Escape / scrim-click dismiss it — respecting the `close-response`
// — unless can-close is suppressed by the close response.
//
// Attributes:
//   heading    (the bold heading text)
//   body       (the body text below the heading)
//   open       (boolean — whether the dialog is shown; default closed)
//   prefer-wide-layout (boolean — lay responses out horizontally when they fit)
//
// Buttons are stacked vertically by default (the Adw.AlertDialog default at
// medium sizes) and laid out horizontally when prefer-wide-layout is set and
// there are no more than two of them — mirroring the libadwaita measure/allocate
// heuristic in spirit.
//
// Events:
//   `response` (CustomEvent, bubbles, `detail = { response }`) when a response
//     button is activated OR the dialog is dismissed (then `response` is the
//     close-response ID) — mirrors the Adw.AlertDialog::response signal.
//   `notify::heading` / `notify::body` / `notify::open` (CustomEvent, bubbles)
//     mirroring the matching GObject properties.
//
// Reference: refs/libadwaita/src/adw-alert-dialog.c (AdwAlertDialog behaviour)
// Reference: refs/libadwaita/src/adw-dialog.c (shared dialog base — Escape/close)
// Reference: refs/libadwaita/src/stylesheet/widgets/_dialogs.scss (floating-sheet)
// Reference: refs/adwaita-web/adwaita-web/scss/_dialog.scss (alert layout)
// Copyright (c) 2022 Purism SPC / 2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** Response button appearance — mirrors Adw.ResponseAppearance. */
export type AdwResponseAppearance = 'default' | 'suggested' | 'destructive';

interface ResponseInfo {
    id: string;
    label: string;
    appearance: AdwResponseAppearance;
    enabled: boolean;
    button: HTMLButtonElement;
}

/**
 * A single response declared in markup. Child of <adw-alert-dialog>; its `id`
 * attribute is the response ID, its text content the label. Optional
 * `appearance="suggested|destructive"` and `enabled="false"` mirror the
 * GtkBuildable `<response>` element attributes. Consumed at connect time.
 */
export class AdwAlertResponse extends HTMLElement {
    static get observedAttributes() {
        return ['id', 'appearance', 'enabled'];
    }
}

export class AdwAlertDialog extends HTMLElement {
    private _initialized = false;
    private _scrimEl!: HTMLDivElement;
    private _dialogEl!: HTMLDivElement;
    private _headingEl!: HTMLHeadingElement;
    private _bodyEl!: HTMLParagraphElement;
    private _childEl!: HTMLDivElement;
    private _responseAreaEl!: HTMLDivElement;

    private _responses: ResponseInfo[] = [];
    private _byId = new Map<string, ResponseInfo>();
    private _defaultResponse: string | null = null;
    private _closeResponse = 'close';
    // Set while a response is being emitted from a button so the close handler
    // does not also fire the close-response (mirrors AdwAlertDialog's
    // block_close_response flag).
    private _blockCloseResponse = false;

    static get observedAttributes() {
        return ['heading', 'body', 'open', 'prefer-wide-layout'];
    }

    /** The heading of the dialog. */
    get heading(): string {
        return this.getAttribute('heading') ?? '';
    }

    set heading(value: string) {
        this.setAttribute('heading', value);
    }

    /** The body text of the dialog. */
    get body(): string {
        return this.getAttribute('body') ?? '';
    }

    set body(value: string) {
        this.setAttribute('body', value);
    }

    /** Whether the dialog is currently shown. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
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
        return this._defaultResponse;
    }

    set defaultResponse(value: string | null) {
        this.setDefaultResponse(value);
    }

    /** The ID passed to `response` when the dialog is dismissed. */
    get closeResponse(): string {
        return this._closeResponse;
    }

    set closeResponse(value: string) {
        this.setCloseResponse(value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot any declared <adw-alert-response> children before we take
        // over the subtree; everything else becomes the extra child.
        const declared = Array.from(this.querySelectorAll(':scope > adw-alert-response')) as AdwAlertResponse[];
        const declaredSet = new Set<Node>(declared);
        const extraChildren = Array.from(this.childNodes).filter((n) => !declaredSet.has(n));

        // The fixed full-cover scrim. Clicking it dismisses the dialog.
        this._scrimEl = document.createElement('div');
        this._scrimEl.className = 'adw-alert-dialog-scrim';
        this._scrimEl.addEventListener('click', () => this._dismiss());

        // The centred dialog box.
        this._dialogEl = document.createElement('div');
        this._dialogEl.className = 'adw-alert-dialog-box';
        this._dialogEl.setAttribute('role', 'alertdialog');
        this._dialogEl.setAttribute('aria-modal', 'true');
        // Clicks inside the box must not bubble to the scrim's dismiss handler.
        this._dialogEl.addEventListener('click', (event) => event.stopPropagation());

        // The scrolled message area (heading + body + extra child).
        const messageArea = document.createElement('div');
        messageArea.className = 'adw-alert-dialog-message';

        this._headingEl = document.createElement('h2');
        this._headingEl.className = 'adw-alert-dialog-heading';

        this._bodyEl = document.createElement('p');
        this._bodyEl.className = 'adw-alert-dialog-body';

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-alert-dialog-child';
        for (const child of extraChildren) this._childEl.appendChild(child);

        messageArea.append(this._headingEl, this._bodyEl, this._childEl);

        // The response button area.
        this._responseAreaEl = document.createElement('div');
        this._responseAreaEl.className = 'adw-alert-dialog-responses';

        this._dialogEl.append(messageArea, this._responseAreaEl);
        this.replaceChildren(this._scrimEl, this._dialogEl);

        // Escape dismisses the dialog when open (mirrors the AdwDialog Escape
        // shortcut → close-response).
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.open) {
                event.stopPropagation();
                this._dismiss();
            }
        });

        // Adopt declared responses now that the response area exists.
        for (const el of declared) {
            const id = el.getAttribute('id');
            if (!id) continue;
            const appearance = (el.getAttribute('appearance') ?? 'default') as AdwResponseAppearance;
            this.addResponse(id, (el.textContent ?? '').trim());
            if (appearance !== 'default') this.setResponseAppearance(id, appearance);
            if (el.getAttribute('enabled') === 'false') this.setResponseEnabled(id, false);
        }

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'heading') {
            this.dispatchEvent(new CustomEvent('notify::heading', { bubbles: true, detail: { heading: this.heading } }));
        } else if (name === 'body') {
            this.dispatchEvent(new CustomEvent('notify::body', { bubbles: true, detail: { body: this.body } }));
        } else if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
            if (this.open) this._focusInitial();
        }
    }

    /** Present the dialog. `parent` is accepted for API parity; unused. */
    present(_parent?: unknown): void {
        this.open = true;
    }

    /** Adds a response button with the given ID and label. */
    addResponse(id: string, label: string): void {
        if (this._byId.has(id)) {
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

        const info: ResponseInfo = { id, label, appearance: 'default', enabled: true, button };
        button.addEventListener('click', () => this._activateResponse(info));

        this._responses.push(info);
        this._byId.set(id, info);
        if (this._responseAreaEl) this._responseAreaEl.appendChild(button);
        this._render();
    }

    /** Adds multiple responses at once — id/label pairs (Adw.add_responses parity). */
    addResponses(...idLabelPairs: string[]): void {
        for (let i = 0; i + 1 < idLabelPairs.length; i += 2) {
            this.addResponse(idLabelPairs[i], idLabelPairs[i + 1]);
        }
    }

    /** Removes a response. */
    removeResponse(id: string): void {
        const info = this._byId.get(id);
        if (!info) return;
        info.button.remove();
        this._responses = this._responses.filter((r) => r !== info);
        this._byId.delete(id);
        if (this._defaultResponse === id) this._defaultResponse = null;
        this._render();
    }

    /** Whether a response with the given ID exists. */
    hasResponse(id: string): boolean {
        return this._byId.has(id);
    }

    /** Gets a response's label. */
    getResponseLabel(id: string): string | null {
        return this._byId.get(id)?.label ?? null;
    }

    /** Sets a response's label. */
    setResponseLabel(id: string, label: string): void {
        const info = this._byId.get(id);
        if (!info) return;
        info.label = label;
        info.button.textContent = label;
    }

    /** Gets a response's appearance. */
    getResponseAppearance(id: string): AdwResponseAppearance | null {
        return this._byId.get(id)?.appearance ?? null;
    }

    /** Sets a response's appearance (default / suggested / destructive). */
    setResponseAppearance(id: string, appearance: AdwResponseAppearance): void {
        const info = this._byId.get(id);
        if (!info) return;
        info.appearance = appearance;
        info.button.classList.toggle('suggested-action', appearance === 'suggested');
        info.button.classList.toggle('destructive-action', appearance === 'destructive');
    }

    /** Gets whether a response is enabled. */
    getResponseEnabled(id: string): boolean {
        return this._byId.get(id)?.enabled ?? false;
    }

    /** Sets whether a response is enabled (disabled buttons can't be activated). */
    setResponseEnabled(id: string, enabled: boolean): void {
        const info = this._byId.get(id);
        if (!info) return;
        info.enabled = enabled;
        info.button.disabled = !enabled;
    }

    /** Sets the default response — its button is highlighted as the suggested one. */
    setDefaultResponse(id: string | null): void {
        this._defaultResponse = id;
        this._render();
    }

    /** Sets the close response — emitted on dismissal (Escape / scrim click). */
    setCloseResponse(id: string): void {
        this._closeResponse = id;
    }

    // ── internals ──────────────────────────────────────────────────────────

    /** A response button was activated: close, then emit `response`. */
    private _activateResponse(info: ResponseInfo): void {
        if (!info.enabled) return;
        this._blockCloseResponse = true;
        this.open = false;
        this._blockCloseResponse = false;
        this._emitResponse(info.id);
    }

    /** Dismissal (Escape / scrim) — close, then emit the close-response. */
    private _dismiss(): void {
        if (!this.open) return;
        this.open = false;
        if (this._blockCloseResponse) return;
        this._emitResponse(this._closeResponse);
    }

    private _emitResponse(response: string): void {
        this.dispatchEvent(new CustomEvent('response', { bubbles: true, detail: { response } }));
    }

    /** Move focus to the default response button (or the first enabled one). */
    private _focusInitial(): void {
        const target =
            (this._defaultResponse ? this._byId.get(this._defaultResponse)?.button : undefined) ??
            this._responses.find((r) => r.enabled)?.button;
        target?.focus();
    }

    private _render(): void {
        this.classList.toggle('open', this.open);

        const heading = this.heading;
        this._headingEl.textContent = heading;
        this._headingEl.hidden = heading.length === 0;

        const body = this.body;
        this._bodyEl.textContent = body;
        this._bodyEl.hidden = body.length === 0;

        this._childEl.hidden = this._childEl.childElementCount === 0;

        // Layout: stack vertically by default; lay out horizontally only when
        // prefer-wide-layout is set and there are at most two responses (the
        // AdwAlertDialog heuristic for keeping wide buttons readable).
        const horizontal = this.preferWideLayout && this._responses.length <= 2;
        this._responseAreaEl.classList.toggle('horizontal', horizontal);

        // Reflect the default response on its button (suggested highlight) unless
        // the response already carries an explicit appearance.
        for (const info of this._responses) {
            const isDefault = info.id === this._defaultResponse && info.appearance === 'default';
            info.button.classList.toggle('default-response', isDefault);
        }
    }
}

customElements.define('adw-alert-response', AdwAlertResponse);
customElements.define('adw-alert-dialog', AdwAlertDialog);
