// <adw-bottom-sheet> — A content area with a sheet that slides up from the
// bottom edge over the content (the web counterpart of Adw.BottomSheet). The
// content is shown persistently; the sheet is displayed above it when `open` is
// set, with an overlaid drag handle by default. When `modal` is set, a dimming
// layer covers the content and dismisses the sheet on click (unless `can-close`
// is false, in which case a close attempt is signalled instead).
//
// Children are declared as <adw-bottom-sheet-content> (the persistent content)
// and <adw-bottom-sheet-sheet> (the slide-up sheet); both are consumed at
// connect time. Unslotted children fall back to the content, mirroring the
// AdwBottomSheet GtkBuildable default (omitting the child type sets content).
//
// Attributes:
//   open             (boolean — whether the sheet is revealed; default closed)
//   modal            (boolean — dim + block the content while open; default on)
//   can-close        (boolean — user can dismiss via the handle / dimming / Esc;
//                       default on. When off, a dismissal raises `close-attempt`
//                       instead of closing — mirrors Adw.BottomSheet:can-close)
//   show-drag-handle (boolean — overlay the drag handle on the sheet; default on)
//
// Events:
//   `notify::open` (CustomEvent, bubbles, `detail = { open }`) when the revealed
//     state changes — mirrors the Adw.BottomSheet `open` GObject property.
//   `close-attempt` (CustomEvent, bubbles) when a dismissal is attempted while
//     `can-close` is false — mirrors the Adw.BottomSheet `close-attempt` signal.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c (AdwBottomSheet behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_bottom-sheet.scss
// Copyright (c) 2023-2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** The persistent content. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetContent extends HTMLElement {}

/** The slide-up sheet. Child of <adw-bottom-sheet>; consumed at connect time. */
export class AdwBottomSheetSheet extends HTMLElement {}

export class AdwBottomSheet extends HTMLElement {
    private _initialized = false;
    private _contentEl!: HTMLDivElement;
    private _dimmingEl!: HTMLDivElement;
    private _sheetEl!: HTMLDivElement;
    private _dragHandleEl!: HTMLDivElement;

    static get observedAttributes() {
        return ['open', 'modal', 'can-close', 'show-drag-handle'];
    }

    /** Whether the sheet is revealed. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        if (value) this.setAttribute('open', '');
        else this.removeAttribute('open');
    }

    /** Whether the content is dimmed + blocked while the sheet is open. */
    get modal(): boolean {
        return this._boolAttr('modal');
    }

    set modal(value: boolean) {
        this._setBoolAttr('modal', value);
    }

    /** Whether the user can dismiss the sheet (handle / dimming / Escape). */
    get canClose(): boolean {
        return this._boolAttr('can-close');
    }

    set canClose(value: boolean) {
        this._setBoolAttr('can-close', value);
    }

    /** Whether the overlaid drag handle is shown. */
    get showDragHandle(): boolean {
        return this._boolAttr('show-drag-handle');
    }

    set showDragHandle(value: boolean) {
        this._setBoolAttr('show-drag-handle', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot declared children before taking over the subtree. The sheet
        // and content are placed by slot; anything unslotted falls back to the
        // content (the AdwBottomSheet GtkBuildable default).
        const sheetChildren = this._collectSlot('adw-bottom-sheet-sheet', 'sheet');
        const contentChildren = this._collectSlot('adw-bottom-sheet-content', 'content');
        const claimed = new Set<Node>([...sheetChildren, ...contentChildren]);
        const unslotted = Array.from(this.childNodes).filter((n) => !claimed.has(n));

        // Persistent content layer.
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-bottom-sheet-content';
        for (const child of contentChildren) this._contentEl.appendChild(child);
        for (const child of unslotted) this._contentEl.appendChild(child);

        // Dimming layer — covers the content while the sheet is open (modal).
        // Clicking it dismisses the sheet (or raises close-attempt when locked).
        this._dimmingEl = document.createElement('div');
        this._dimmingEl.className = 'adw-bottom-sheet-dimming';
        this._dimmingEl.addEventListener('click', () => this._attemptClose());

        // The slide-up sheet with its overlaid drag handle.
        this._sheetEl = document.createElement('div');
        this._sheetEl.className = 'adw-bottom-sheet-sheet';

        this._dragHandleEl = document.createElement('div');
        this._dragHandleEl.className = 'adw-bottom-sheet-drag-handle';
        this._dragHandleEl.setAttribute('role', 'button');
        this._dragHandleEl.setAttribute('aria-label', 'Drag handle');
        this._dragHandleEl.tabIndex = 0;
        // The handle is the primary pointer affordance for closing the sheet.
        this._dragHandleEl.addEventListener('click', () => this._attemptClose());
        this._dragHandleEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this._attemptClose();
            }
        });

        const sheetBody = document.createElement('div');
        sheetBody.className = 'adw-bottom-sheet-sheet-body';
        for (const child of sheetChildren) sheetBody.appendChild(child);

        this._sheetEl.append(this._dragHandleEl, sheetBody);

        this.replaceChildren(this._contentEl, this._dimmingEl, this._sheetEl);

        // Escape closes the sheet when open (mirrors AdwBottomSheet's Escape
        // shortcut → maybe_close_cb).
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.open) {
                event.stopPropagation();
                this._attemptClose();
            }
        });

        this._render();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (oldValue === newValue) return;
        this._render();
        if (name === 'open') {
            this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open: this.open } }));
        }
    }

    private _attemptClose(): void {
        if (!this.open) return;
        if (!this.canClose) {
            this.dispatchEvent(new CustomEvent('close-attempt', { bubbles: true }));
            return;
        }
        // Keep the attribute in sync without re-entering the guarded callback
        // (it no-ops on an unchanged value, but the notify::open fires from the
        // attribute write below).
        this.open = false;
    }

    private _render(): void {
        this.classList.toggle('open', this.open);
        this.classList.toggle('modal', this.modal);
        this.classList.toggle('has-drag-handle', this.showDragHandle);

        // The dimming layer is only meaningful while modal; it fades in with the
        // sheet and is non-interactive when closed.
        this._dimmingEl.classList.toggle('visible', this.open && this.modal);
        this._dragHandleEl.hidden = !this.showDragHandle;
    }

    /** Read a boolean attribute that defaults to `true` when absent. */
    private _boolAttr(name: string): boolean {
        const value = this.getAttribute(name);
        // Absent attribute → default on; explicit `="false"` → off.
        if (value === null) return name === 'modal' || name === 'can-close' || name === 'show-drag-handle';
        return value !== 'false';
    }

    private _setBoolAttr(name: string, value: boolean): void {
        if (value) this.setAttribute(name, '');
        else this.setAttribute(name, 'false');
    }

    /** Move declared slot children out of the light-DOM tree into a list. */
    private _collectSlot(tag: string, slot: string): Node[] {
        const byElement = Array.from(this.querySelectorAll(`:scope > ${tag}`)).flatMap((el) =>
            Array.from(el.childNodes),
        );
        const bySlotAttr = Array.from(this.querySelectorAll(`:scope > [slot="${slot}"]`));
        return [...byElement, ...bySlotAttr];
    }
}

customElements.define('adw-bottom-sheet-content', AdwBottomSheetContent);
customElements.define('adw-bottom-sheet-sheet', AdwBottomSheetSheet);
customElements.define('adw-bottom-sheet', AdwBottomSheet);
