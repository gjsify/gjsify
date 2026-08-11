// <adw-shortcut-label> — a keyboard shortcut, drawn as keycaps.
// Attributes: accelerator (`<Control>C`, `<Shift>A Home`, `<Alt>1...9`,
//   `Control_L&Control_R`, `<Control>C+<Control>X`), disabled-text (the
//   placeholder shown when `accelerator` is empty).
// Events: `notify::accelerator`, `notify::disabled-text` (CustomEvent, bubbles),
//   mirroring the AdwShortcutLabel GObject notify signals.
//
// The whole parse — four nesting levels and the fixed keycap order — is
// `@gjsify/adwaita-core`'s `parseShortcutLabel` (ADR 0004). This element only
// turns its nodes into DOM, which is the split that keeps a second renderer from
// re-deriving the grammar and drifting.
//
// TEXT, NOT MARKUP. The C builds pango markup: `&lt;` for a literal `<`, and
// `%s <small><b>%s</b></small>` for the `L`/`R` subscript of a sided modifier
// (adw-shortcut-label.c:195, :253-266). Core returns `{ label, sideMarker }`
// instead, so the escaping is `textContent`'s job here and the subscript is a
// real `<sub>` — nothing parses a markup string back apart.
//
// DIRECTION IS READ, NOT ASSUMED. `parse_sequence` picks its arrow from the
// widget's text direction (:439), so the element resolves its own computed
// direction at render time rather than defaulting to LTR.
//
// Reference: refs/libadwaita/src/adw-shortcut-label.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss:33-58
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { parseShortcutLabel } from '@gjsify/adwaita-core';

export class AdwShortcutLabel extends HTMLElement {
    private _initialized = false;

    static get observedAttributes() {
        return ['accelerator', 'disabled-text'];
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;
            // `GTK_ACCESSIBLE_ROLE_LABEL` (:88). The accessible NAME is set from
            // the parse below, because the keycaps read as a pile of single
            // letters otherwise.
            if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
        }
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true }));
    }

    get accelerator(): string {
        return this.getAttribute('accelerator') ?? '';
    }

    set accelerator(value: string) {
        this.setAttribute('accelerator', value);
    }

    get disabledText(): string {
        return this.getAttribute('disabled-text') ?? '';
    }

    set disabledText(value: string) {
        this.setAttribute('disabled-text', value);
    }

    private _render() {
        const { nodes, accessibleLabel, error } = parseShortcutLabel(this.accelerator, {
            disabledText: this.disabledText,
            direction: this._direction(),
        });

        this.replaceChildren(...nodes.map((node) => this._nodeElement(node)));
        this.setAttribute('aria-label', accessibleLabel);

        // `g_warning ("Failed to parse %s, part of accelerator '%s'")` (:532).
        // The partial render is upstream's too — it keeps what it built.
        if (error) {
            console.warn(`adw-shortcut-label: failed to parse ${error}, part of accelerator '${this.accelerator}'`);
        }
    }

    /**
     * The rendered direction, which is what the sequence arrow follows.
     *
     * `getComputedStyle` is the only thing that sees an inherited `dir` — the
     * attribute alone is set on an ancestor most of the time. A detached element
     * has no computed style to read, so the attribute is the fallback.
     */
    private _direction(): 'ltr' | 'rtl' {
        const computed = this.isConnected ? getComputedStyle(this).direction : '';
        if (computed === 'rtl' || computed === 'ltr') return computed;
        return this.closest('[dir="rtl"]') ? 'rtl' : 'ltr';
    }

    private _nodeElement(node: ReturnType<typeof parseShortcutLabel>['nodes'][number]): HTMLElement {
        if (node.kind === 'separator' || node.kind === 'disabled') {
            // `dim_label` (:359-368) — both the separators and the placeholder,
            // which upstream tells apart only by position (a placeholder is the
            // only child). The extra class on the placeholder is this port's:
            // `.dimmed` still applies, and a consumer can now style the
            // "no shortcut" state without matching on child count.
            const label = document.createElement('span');
            label.className = node.kind === 'disabled' ? 'dimmed adw-shortcut-label-disabled' : 'dimmed';
            label.textContent = node.text;
            return label;
        }

        // One combination is one BOX of keycaps, LTR even in an RTL context
        // (:375-380): the modifier order is a property of the shortcut, not of
        // the surrounding text.
        const box = document.createElement('span');
        box.className = 'adw-shortcut-label-keys';
        box.setAttribute('dir', 'ltr');

        for (const key of node.keys) {
            const cap = document.createElement('span');
            cap.className = 'keycap';
            cap.textContent = key.label;

            if (key.sideMarker) {
                const marker = document.createElement('sub');
                marker.className = 'adw-shortcut-label-side';
                marker.textContent = key.sideMarker;
                cap.append(marker);
            }

            box.append(cap);
        }

        return box;
    }
}

customElements.define('adw-shortcut-label', AdwShortcutLabel);
