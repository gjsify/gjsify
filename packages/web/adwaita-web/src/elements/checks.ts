// <gtk-check-button> and <adw-radio> — the two form-control primitives, in ONE module,
// for the same reason `scss/_checks.scss` is one partial: upstream merges them
// (`refs/libadwaita/src/stylesheet/widgets/_checks.scss` has no `_radio.scss` beside
// it), and everything but the corner radius, the glyph and the group is shared.
// Splitting them, as `refs/adwaita-web` does, is what lets the two drift apart.
//
// The checkbox has no core class: it is one boolean plus a third state, which ADR 0004
// calls out as too trivial to model. What IS core is the pair a second renderer would
// otherwise re-invent:
//
//   - {@link RadioGroupState} — group exclusivity. The browser gives the inner
//     `<input type="radio" name="…">` exclusivity for free, and STOPS THERE: it
//     unchecks the sibling INPUT and leaves the sibling `<adw-radio>` host's `checked`
//     attribute — the published state, and the selector `_checks.scss` paints from —
//     stale, so a group left to the browser draws two selected radios. The shared
//     state is what repaints the loser.
//   - {@link resolveCheckState} — indeterminate outranks checked, read off the cascade
//     in libadwaita's `_checks.scss`, and what `aria-checked` needs.
//
// NOT DERIVED FROM GTK. `GtkCheckButton` is a GTK widget and libadwaita has no
// `adw-checkbox.c`, so its group semantics (`gtk_check_button_set_group`, whether a
// fresh group starts with a member active) and the exact meaning of
// `GtkCheckButton:inconsistent` are not guessed at. Where a rule was needed the HTML
// one is used and cited as such — clearing `indeterminate` on activation is the HTML
// pre-click activation step, not a reading of GTK.
//
// NAMING. The state attribute is `checked`, not GtkCheckButton's `active`:
// these elements wrap a real `<input>`, `checked` is the spelling every author
// already writes, and it is what the stylesheet selects on. The published event
// follows the attribute (`notify::checked`), not the GObject property.
//
// Attributes (both):
//   checked       — boolean; reflects (and drives) the checked state.
//   indeterminate — boolean; the third state, drawn as a dash. Outranks checked.
//   disabled      — boolean; the control does not respond and is dimmed.
//   label         — the text beside the indicator. When absent, the element's
//                   existing child nodes become the label (so a server-rendered
//                   `<gtk-check-button>Enable</gtk-check-button>` upgrades intact).
// Attributes (<adw-radio> only):
//   name          — the group. Exclusivity is scoped to it, exactly as `name`
//                   scopes `<input type="radio">` — including the empty case:
//                   HTML forms a radio button group only from a NON-EMPTY name,
//                   so a nameless radio checks itself and unchecks nothing.
//   value         — this member's value. Defaults to the label text, so a group
//                   written without values still has distinguishable members.
// Properties: checked / indeterminate / disabled / label (+ name / value).
// Events:
//   `notify::checked` (CustomEvent, bubbles, detail = { checked }) — fires on
//     every change, programmatic included, on EVERY member a radio pick moves.
//
// A11Y: the inner input carries the role (native `checkbox` / `radio`) and an
// explicit `aria-checked` derived from {@link resolveCheckState}, so the
// indeterminate state announces as `mixed` for BOTH — HTML has a native mixed
// checkbox (`input.indeterminate`) but no mixed radio.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_checks.scss
// Reference: refs/adwaita-web/adwaita-web/scss/{_checkbox,_radio}.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as Web Components for @gjsify/adwaita-web.

import { RadioGroupState, resolveCheckState } from '@gjsify/adwaita-core';

/**
 * The document's radio groups. ONE registry, as global as a bare
 * `<input type="radio" name="x">` outside a form is — two independent groups therefore
 * need two names.
 */
const radioGroups = new RadioGroupState();

/**
 * The markup + state shared by `<gtk-check-button>` and `<adw-radio>`.
 *
 * It keeps the `Adw` prefix while the element above it does not, and the split is the
 * same one the stylesheet makes: this class builds `.adw-check-input`,
 * `.adw-check-indicator` and `.adw-check-label`, which are the Adwaita SKIN, and the
 * skin is not what the tag names. It is also not a widget — nothing registers it.
 */
abstract class AdwCheckBase extends HTMLElement {
    protected _input!: HTMLInputElement;
    protected _indicator!: HTMLSpanElement;
    protected _label!: HTMLSpanElement;
    private _initialized = false;

    /** `checkbox` or `radio` — the native control this element is built around. */
    protected abstract get inputType(): 'checkbox' | 'radio';

    /** What a click / Space / arrow key on the control means for this kind. */
    protected abstract activate(): void;

    get checked(): boolean {
        return this.hasAttribute('checked');
    }

    set checked(value: boolean) {
        // `toggleAttribute` with a force flag is a no-op when the attribute already
        // holds that state, so re-setting the current value never notifies.
        this.toggleAttribute('checked', !!value);
    }

    /** Whether the control is in the third, inconsistent state. */
    get indeterminate(): boolean {
        return this.hasAttribute('indeterminate');
    }

    set indeterminate(value: boolean) {
        this.toggleAttribute('indeterminate', !!value);
    }

    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    set disabled(value: boolean) {
        this.toggleAttribute('disabled', !!value);
    }

    get label(): string {
        return this.getAttribute('label') ?? this._label?.textContent ?? '';
    }

    set label(value: string) {
        this.setAttribute('label', value);
    }

    connectedCallback() {
        if (this._initialized) {
            this.onConnected();
            return;
        }
        this._initialized = true;

        // Captured BEFORE the element takes over its own children, so a server-rendered
        // `<gtk-check-button>Enable</gtk-check-button>` keeps its text.
        const authored = [...this.childNodes];

        this._input = document.createElement('input');
        this._input.type = this.inputType;
        this._input.className = 'adw-check-input';

        this._indicator = document.createElement('span');
        this._indicator.className = 'adw-check-indicator';

        this._label = document.createElement('span');
        this._label.className = 'adw-check-label';
        const authoredLabel = this.getAttribute('label');
        if (authoredLabel === null) this._label.append(...authored);
        else this._label.textContent = authoredLabel;

        this.replaceChildren(this._input, this._indicator, this._label);

        // Keyboard (Space, and the arrow keys that move within a radio group)
        // and a direct programmatic `input.click()` both surface as `change`.
        this._input.addEventListener('change', () => this.activate());

        // The indicator and the label cover the control; the input is 0x0, so every
        // pointer click lands on one of them. A click that DID reach the input is already
        // handled above — activating again would undo it.
        this.addEventListener('click', (event) => {
            if (this.disabled) return;
            if (event.target === this._input) return;
            this.activate();
        });

        this.onConnected();
        this.render();
    }

    disconnectedCallback() {
        this.onDisconnected();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'label') {
            this._label.textContent = this.getAttribute('label') ?? '';
        }
        this.render();
        if (name === 'checked') {
            this.dispatchEvent(
                new CustomEvent('notify::checked', { bubbles: true, detail: { checked: this.checked } }),
            );
        }
    }

    protected onConnected(): void {}

    protected onDisconnected(): void {}

    protected render(): void {
        const state = resolveCheckState(this.checked, this.indeterminate);
        this._input.checked = state === 'checked';
        this._input.indeterminate = state === 'indeterminate';
        // Explicit, because HTML has a native mixed CHECKBOX (the property above) but no
        // mixed radio — this is the one spelling that announces the third state for both.
        this._input.setAttribute('aria-checked', state === 'indeterminate' ? 'mixed' : String(state === 'checked'));
        this._input.disabled = this.disabled;
        this._label.hidden = this._label.childNodes.length === 0;
    }
}

/** The Adwaita checkbox — `checkbutton > check` as a custom element. */
export class GtkCheckButton extends AdwCheckBase {
    static get observedAttributes() {
        return ['checked', 'indeterminate', 'disabled', 'label'];
    }

    protected get inputType(): 'checkbox' {
        return 'checkbox';
    }

    protected activate(): void {
        // HTML's pre-click activation steps clear `indeterminate` before the toggle, so a
        // user can always reach a definite state. That rule is the HTML spec's, not a
        // reading of `GtkCheckButton:inconsistent`.
        this.indeterminate = false;
        this.checked = !this.checked;
    }
}

/** The Adwaita radio — `checkbutton > radio`, exclusive within its `name`. */
export class AdwRadio extends AdwCheckBase {
    private _unsubscribe: (() => void) | null = null;

    static get observedAttributes() {
        return ['checked', 'indeterminate', 'disabled', 'label', 'name', 'value'];
    }

    protected get inputType(): 'radio' {
        return 'radio';
    }

    get name(): string {
        return this.getAttribute('name') ?? '';
    }

    set name(value: string) {
        this.setAttribute('name', value);
    }

    /**
     * This member's value. Falls back to the label text so a group authored without
     * values still has members the group state can tell apart.
     */
    get value(): string {
        return this.getAttribute('value') ?? this.label.trim();
    }

    set value(value: string) {
        this.setAttribute('value', value);
    }

    protected activate(): void {
        this.indeterminate = false;
        // An UNNAMED radio is not in a group — HTML forms a radio button group only from
        // a non-empty `name`, so a nameless one checks itself and never unchecks anything.
        // Without this guard every nameless radio in the document would join one `''`
        // group and fight over it.
        if (this.name === '') {
            this.checked = true;
            return;
        }
        // The pick goes through the shared state, never straight onto this element: the
        // member that LOSES the selection is a different element and only the state knows
        // which one it is.
        radioGroups.select(this.name, this.value);
    }

    protected onConnected(): void {
        this._input.name = this.name;
        if (this.name === '') return; // ungrouped — nothing to subscribe to
        this._unsubscribe ??= radioGroups.subscribe((change) => {
            if (change.name !== this.name) return;
            this.checked = change.selected === this.value;
        });
        // A member declared checked seeds the group, so the first user pick
        // knows what it is deselecting.
        if (this.checked) radioGroups.select(this.name, this.value);
    }

    protected onDisconnected(): void {
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    protected render(): void {
        super.render();
        this._input.name = this.name;
    }
}

customElements.define('gtk-check-button', GtkCheckButton);
customElements.define('adw-radio', AdwRadio);
