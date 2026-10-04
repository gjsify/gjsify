// <gtk-editable-label> — `GtkEditableLabel`, a label you click and edit in place.
//
// IT IS A STACK, NOT A FIELD. The C builds `stack > { label, entry }`, puts a
// `Gtk.Text` in the entry slot, and `editing` IS "the entry is the stack's visible child"
// (gtkeditablelabel.c:319-331,595-599). Two elements therefore stand for one widget, and
// which of them shows is the whole of its state — `.editing` on the host is the class the
// C adds and removes around every transition (gtkeditablelabel.c:609-663), and it is what
// libadwaita's `editablelabel > stack > text` selector keys on.
//
// THE KEYS ARE THE BEHAVIOUR. Enter on the label starts editing; Enter in the entry COMMITS
// (the drafted text becomes the label's); Escape in the entry DISCARDS it (the entry is
// reset to what the label says, gtkeditablelabel.c:637-656). A click on the label starts
// editing — the gesture is on the LABEL, not on the widget (gtkeditablelabel.c:193-215,
// 351-353) — and focus leaving the widget commits after the C's 100 ms grace period, which
// exists so a focus move INSIDE the widget is not read as leaving
// (gtkeditablelabel.c:293-318). `editable` FALSE stops editing without committing and
// refuses to start it (gtkeditablelabel.c:414-427).
//
// `text` is `Gtk.Editable:text`, what the label shows. While the entry is visible it holds a
// DRAFT, which is why the C syncs the label from `notify::text` only while it is not
// editing (gtkeditablelabel.c:237-248) and why a discarded edit resets the entry rather
// than the label.
//
// A11y: GTK declares no role for this widget (`gtkeditablelabel.c` calls no
// `set_accessible_role`) and makes it focusable (gtkeditablelabel.c:320), so the host owns
// the tab stop while it shows the label and the entry holds it while it edits.
//
// NOT PORTED, one line each, declared in `check-adwaita-element-properties.mjs`: the
// drag-and-drop target and source (GTK drops a string onto the label and drags its text out,
// gtkeditablelabel.c:250-291), the context menu (a `Gtk.PopoverMenu` over a right click,
// gtkeditablelabel.c:145-190) and `Gtk.Editable`'s undo stack (`enable-undo`, which no
// attribute can carry and a native input does not expose).
//
// Reference: refs/gtk/gtk/gtkeditablelabel.c:40-95 (the node tree and the keys),
//   193-215,237-248,293-331,414-427,609-663 (gesture, text sync, focus grace, editable,
//   start/stop editing)
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss:1-11,90-97
//   (`label {}`, `editablelabel > stack > text`)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** The C's grace period between a focus leaving the widget and the commit it triggers. */
const FOCUS_OUT_GRACE_MS = 100;

export class GtkEditableLabel extends HTMLElement {
    private _label!: HTMLSpanElement;
    private _entry!: HTMLInputElement;
    private _initialized = false;
    private _grace: ReturnType<typeof setTimeout> | null = null;

    static get observedAttributes() {
        return ['text', 'editable', 'editing'];
    }

    /** `Gtk.Editable:text` — what the label shows, which is the committed draft. */
    get text(): string {
        return this.getAttribute('text') ?? '';
    }

    set text(value: string) {
        this.setAttribute('text', value ?? '');
    }

    /** `Gtk.Editable:editable` — defaults TRUE. FALSE refuses to start editing. */
    get editable(): boolean {
        const raw = this.getAttribute('editable');
        return raw === null ? true : raw !== 'false';
    }

    set editable(value: boolean) {
        if (value) this.removeAttribute('editable');
        else this.setAttribute('editable', 'false');
    }

    /**
     * `GtkEditableLabel:editing` — TRUE while the entry is the stack's visible child, so it
     * is the ATTRIBUTE as on every other boolean here. Setting it is what starts or stops
     * editing, because the C's property setter does exactly that (gtkeditablelabel.c:406-411).
     */
    get editing(): boolean {
        return this.hasAttribute('editing');
    }

    set editing(value: boolean) {
        this.toggleAttribute('editing', !!value);
    }

    /** `gtk_editable_label_start_editing` — refused while `editable` is FALSE, as in the C. */
    startEditing(): void {
        if (!this.editable) return;
        this.editing = true;
    }

    /**
     * `gtk_editable_label_stop_editing` — `commit` decides whether the drafted text becomes
     * the label's; FALSE resets the entry to the label instead (gtkeditablelabel.c:637-656).
     */
    stopEditing(commit = false): void {
        if (!this.editing) return;
        if (commit) this.setAttribute('text', this._entry.value);
        this.editing = false;
    }

    /** The inner native entry, for focus and selection. */
    get entry(): HTMLInputElement {
        return this._entry;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._label = document.createElement('span');
        this._label.className = 'adw-editable-label-label';
        this._label.addEventListener('click', () => this.startEditing());

        this._entry = document.createElement('input');
        this._entry.className = 'adw-editable-label-entry';
        this._entry.type = 'text';
        // The C moves focus onto the entry to start editing and back onto the widget to stop
        // (gtkeditablelabel.c:614,652), so the host is the tab stop only while it shows the
        // label — otherwise a Tab would walk through two controls for one widget.
        this._entry.tabIndex = -1;
        this._entry.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                // Consumed here: Enter in the entry is its `activate` signal
                // (gtkeditablelabel.c:232-234), and letting it reach the widget would start
                // editing again the moment the commit stopped it.
                event.stopPropagation();
                this.stopEditing(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.stopEditing(false);
            }
        });

        this.replaceChildren(this._label, this._entry);
        // Enter and Space start editing as a KEY BINDING of the WIDGET, not of the label node
        // inside it (gtkeditablelabel.c:54-63), so the listener is on the host.
        this.addEventListener('keydown', (event) => {
            if (this.editing || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            this.startEditing();
        });
        // Leaving the WIDGET is what commits, not leaving the entry, and the C waits out its
        // grace period first so a focus move WITHIN the widget is not read as leaving it.
        this.addEventListener('focusout', (event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && this.contains(next)) return;
            if (this._grace !== null) clearTimeout(this._grace);
            this._grace = setTimeout(() => {
                this._grace = null;
                if (this.editing) this.stopEditing(true);
            }, FOCUS_OUT_GRACE_MS);
        });

        this._render();
    }

    disconnectedCallback() {
        if (this._grace !== null) clearTimeout(this._grace);
        this._grace = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        switch (name) {
            case 'text':
                // The label's text only follows the property while nothing is being drafted,
                // which is the condition `text_changed` tests in the C.
                if (!this.editing) this._render();
                break;
            case 'editable':
                if (value === 'false') this.stopEditing(false);
                break;
            case 'editing':
                this._render();
                if (this.editing) this._entry.focus();
                else this.focus();
                this.dispatchEvent(
                    new CustomEvent('notify::editing', { bubbles: true, detail: { editing: this.editing } }),
                );
                break;
        }
    }

    private _render(): void {
        const editing = this.editing;
        this.classList.toggle('editing', editing);
        this._label.hidden = editing;
        this._entry.hidden = !editing;
        this._label.textContent = this.text;
        this._entry.value = this.text;
        // The tab stop FOLLOWS the state: the widget is focusable while it shows the label
        // and hands the focus to the entry while it edits (gtkeditablelabel.c:614,652), so
        // a Tab never reaches a control the user cannot see.
        if (editing) this.removeAttribute('tabindex');
        else this.setAttribute('tabindex', '0');
    }
}

customElements.define('gtk-editable-label', GtkEditableLabel);
