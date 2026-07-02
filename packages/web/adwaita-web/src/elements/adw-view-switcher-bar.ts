// <adw-view-switcher-bar> — The narrow BOTTOM bar of icon-over-label buttons
// bound to an <adw-view-stack>, the web counterpart of Adw.ViewSwitcherBar. It
// owns no pages of its own: it reads the bound stack's `pages`, renders one
// homogeneous icon-over-label button per page, and is two-way synced to the
// stack's visible child — tapping a button sets the stack's visible page, and a
// change to the stack (from anywhere) re-highlights the matching button. The
// active button's label is accent-coloured (via the `.active` CSS class).
//
// A `revealed` flag lets an adaptive layout flip the bar on/off: shown on narrow
// screens, hidden on wide ones where a header-bar <adw-view-switcher> takes over
// (mirrors Adw.ViewSwitcherBar `reveal` driven by an Adw.Breakpoint).
//
// Attributes:
//   stack     — the id of the <adw-view-stack> to drive (like <label for>).
//   revealed  — boolean; when absent the bar is hidden (matches `reveal`).
// Properties (mirroring Adw.ViewSwitcherBar):
//   stack     — the bound AdwViewStack element (get/set; set also accepts an id).
//   revealed  — whether the bar is shown (get/set).
// Methods:
//   setStack(stack) — bind to a stack element (or null); rebuilds the buttons.
//   refresh()       — rebuild the buttons after late page adds to the stack.
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c (AdwViewSwitcherBar)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss (.narrow policy)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-view-switcher-bar.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwViewStack } from './adw-view-stack.js';

export class AdwViewSwitcherBar extends HTMLElement {
    private _barEl!: HTMLDivElement;
    private _buttons: HTMLButtonElement[] = [];
    private _stack: AdwViewStack | null = null;
    private _revealed = false;
    private _initialized = false;
    private _onStackNotify = (): void => this._syncActive();

    static get observedAttributes() {
        return ['stack', 'revealed'];
    }

    /** The bound stack element, or null when unbound. */
    get stack(): AdwViewStack | null {
        return this._stack;
    }

    set stack(value: AdwViewStack | string | null) {
        this.setStack(this._resolveStack(value));
    }

    /** Whether the bar is revealed (shown). Hidden when false. */
    get revealed(): boolean {
        return this._revealed;
    }

    set revealed(value: boolean) {
        if (value) this.setAttribute('revealed', '');
        else this.removeAttribute('revealed');
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;
            this._barEl = document.createElement('div');
            this._barEl.className = 'adw-view-switcher-bar-box';
            this._barEl.setAttribute('role', 'tablist');
            this.replaceChildren(this._barEl);
        }
        this._revealed = this.hasAttribute('revealed');
        this._applyRevealed();
        // Resolve the `stack` id ref now that the element is in the document — the
        // referenced stack is normally earlier in the DOM (content above a bottom
        // bar), so its pages are ready.
        const ref = this.getAttribute('stack');
        if (ref && !this._stack) this.setStack(this._resolveStack(ref));
        else this._syncActive();
    }

    disconnectedCallback() {
        if (this._stack) this._stack.removeEventListener('notify::visible-child', this._onStackNotify);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'revealed') {
            this._revealed = this.hasAttribute('revealed');
            this._applyRevealed();
            return;
        }
        if (name === 'stack') {
            this.setStack(this._resolveStack(value));
        }
    }

    /** Bind to a stack element (or null). Unbinds the previous one and rebuilds. */
    setStack(stack: AdwViewStack | null): void {
        if (this._stack) this._stack.removeEventListener('notify::visible-child', this._onStackNotify);
        this._stack = stack;
        if (stack) stack.addEventListener('notify::visible-child', this._onStackNotify);
        this._rebuild();
    }

    /** Rebuild the buttons — call after adding pages to the bound stack. */
    refresh(): void {
        this._rebuild();
    }

    private _resolveStack(value: AdwViewStack | string | null): AdwViewStack | null {
        if (value === null) return null;
        if (typeof value === 'string') {
            return (document.getElementById(value) as AdwViewStack | null) ?? null;
        }
        return value;
    }

    private _rebuild(): void {
        if (!this._initialized) return;
        this._barEl.replaceChildren();
        this._buttons = [];
        const pages = this._stack?.pages ?? [];

        pages.forEach((page, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'adw-view-switcher-bar-button';
            button.setAttribute('role', 'tab');

            const iconEl = document.createElement('span');
            iconEl.className = `adw-icon adw-view-switcher-bar-icon${page.icon ? ` adw-icon--${page.icon}` : ''}`;
            iconEl.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
            iconEl.hidden = page.icon.length === 0;

            const labelEl = document.createElement('span');
            labelEl.className = 'adw-view-switcher-bar-label';
            labelEl.textContent = page.title;
            labelEl.hidden = page.title.length === 0;

            button.append(iconEl, labelEl);
            // An icon-only button (no title) needs an accessible name.
            if (page.icon && !page.title) button.setAttribute('aria-label', page.icon);

            button.addEventListener('click', () => {
                if (this._stack) this._stack.visibleChildIndex = index;
            });

            this._barEl.appendChild(button);
            this._buttons.push(button);
        });

        this._syncActive();
    }

    private _syncActive(): void {
        const selected = this._stack?.visibleChildIndex ?? -1;
        this._buttons.forEach((button, index) => {
            const isActive = index === selected;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;
        });
    }

    private _applyRevealed(): void {
        this.hidden = !this._revealed;
    }
}

customElements.define('adw-view-switcher-bar', AdwViewSwitcherBar);
