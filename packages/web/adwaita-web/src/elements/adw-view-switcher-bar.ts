// <adw-view-switcher-bar> — The narrow BOTTOM bar of icon-over-label buttons
// bound to an <adw-view-stack>, the web counterpart of Adw.ViewSwitcherBar. It
// owns no pages: it reads the bound stack's `pages`, renders one homogeneous
// button per page, and is two-way synced to the stack's visible child.
//
// The derivations are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004):
// the per-button model (`buildViewSwitcherButtons`, so this bar and the header
// switcher cannot disagree about what a page looks like) and — the rule this
// port was missing entirely — `ViewSwitcherBarState`, which is `reveal` AND
// MORE THAN ONE VISIBLE PAGE (`update_bar_revealed`,
// adw-view-switcher-bar.c:104-126). A bar bound to a one-page stack used to show
// an empty strip that libadwaita keeps collapsed.
//
// Also fixed here, from the same C: `disconnectedCallback` removed the stack
// listener and `connectedCallback` only re-added it when `ref && !this._stack`,
// so a bar that was detached and re-inserted never tracked its stack again. In
// C the handlers are bound in `set_stack` and released only in `dispose`
// (:330-341, :218-221) — realize/unrealize never touch them.
//
// Attributes:
//   stack    — the id of the <adw-view-stack> to drive (like <label for>).
//   reveal   — boolean; the REQUEST (`Adw.ViewSwitcherBar:reveal`, default off).
//   revealed — the legacy spelling of `reveal`, still accepted as the request.
// Properties:
//   stack    — the bound AdwViewStack element (get/set; set also accepts an id).
//   reveal   — the request (get/set).
//   revealed — READ-ONLY: whether the bar is actually shown, i.e. the request
//              AND more than one visible page.
// Methods:
//   setStack(stack) — bind to a stack element (or null); rebuilds the buttons.
//   refresh()       — rebuild after pages were added to the bound stack without
//                     changing its selection (see the note in `_rebuild`).
// Reference: refs/libadwaita/src/adw-view-switcher-bar.c (AdwViewSwitcherBar)
// Reference: refs/libadwaita/src/adw-view-switcher.c (the switcher it embeds)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-view-switcher-bar.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { ViewSwitcherBarState, buildViewSwitcherButtons, viewSwitcherPagesFromStack } from '@gjsify/adwaita-core';

import type { AdwViewStack } from './adw-view-stack.js';
import { applyDescription, applyIndicator, applySwitcherIcon } from './view-switcher-dom.js';
import { type AdwIcon, createAdwIcon } from './adw-icon.js';

/** The DOM nodes one bar button owns — the bar paints the derived model onto them. */
interface BarButtonNodes {
    button: HTMLButtonElement;
    icon: AdwIcon;
    label: HTMLSpanElement;
    indicator: HTMLSpanElement;
}

export class AdwViewSwitcherBar extends HTMLElement {
    private readonly _barState = new ViewSwitcherBarState();
    private _barEl!: HTMLDivElement;
    private _nodes: BarButtonNodes[] = [];
    private _stack: AdwViewStack | null = null;
    private _initialized = false;
    private readonly _onStackNotify = (): void => this._rebuild();

    static get observedAttributes() {
        return ['stack', 'reveal', 'revealed'];
    }

    constructor() {
        super();
        this._barState.subscribe(() => this._applyRevealed());
    }

    /** The bound stack element, or null when unbound. */
    get stack(): AdwViewStack | null {
        return this._stack;
    }

    set stack(value: AdwViewStack | string | null) {
        this.setStack(this._resolveStack(value));
    }

    /** Whether the layout asked for the bar — `Adw.ViewSwitcherBar:reveal`. */
    get reveal(): boolean {
        return this._barState.reveal;
    }

    set reveal(value: boolean) {
        if (value) this.setAttribute('reveal', '');
        else {
            this.removeAttribute('reveal');
            this.removeAttribute('revealed');
        }
    }

    /**
     * Whether the bar is actually shown. READ-ONLY: a one-page stack keeps it
     * collapsed however loudly the layout asks (adw-view-switcher-bar.c:125).
     * Write {@link reveal} to make the request.
     */
    get revealed(): boolean {
        return this._barState.revealed;
    }

    connectedCallback() {
        if (!this._initialized) {
            this._initialized = true;
            this._barEl = document.createElement('div');
            this._barEl.className = 'adw-view-switcher-bar-box';
            this._barEl.setAttribute('role', 'tablist');
            this.replaceChildren(this._barEl);
        }
        this._barState.setReveal(this._readReveal());

        // Resolve the `stack` id ref now that the element is in the document —
        // the referenced stack is normally earlier in the DOM (content above a
        // bottom bar), so its pages are ready.
        const ref = this.getAttribute('stack');
        if (ref && !this._stack) {
            this.setStack(this._resolveStack(ref));
            return;
        }
        // Re-attaching must re-bind: `disconnectedCallback` released the
        // listener, and the old `ref && !this._stack` guard could never take it
        // back. In C the binding survives unrealize entirely.
        this._bindStack();
        this._rebuild();
    }

    disconnectedCallback() {
        this._unbindStack();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'reveal' || name === 'revealed') {
            this._barState.setReveal(this._readReveal());
            return;
        }
        if (name === 'stack') {
            this.setStack(this._resolveStack(value));
        }
    }

    /** Bind to a stack element (or null). Unbinds the previous one and rebuilds. */
    setStack(stack: AdwViewStack | null): void {
        this._unbindStack();
        this._stack = stack;
        this._bindStack();
        this._rebuild();
    }

    /**
     * Rebuild the buttons by hand.
     *
     * Kept as public API — a consumer that mutates a page in place still has a
     * way to say so — but no longer the ONLY way: the stack emits
     * `items-changed` now and this bar binds it, which is the mechanism
     * libadwaita uses (adw-view-switcher-bar.c:340,
     * adw-view-switcher.c:258-263).
     */
    refresh(): void {
        this._rebuild();
    }

    private _readReveal(): boolean {
        return this.hasAttribute('reveal') || this.hasAttribute('revealed');
    }

    private _bindStack(): void {
        this._stack?.addEventListener('notify::visible-child', this._onStackNotify);
        // `update_bar_revealed` runs on the pages model's `items-changed` too
        // (adw-view-switcher-bar.c:340), which is the half that was missing: a
        // page added without moving the selection, or a non-selected page
        // hidden, changes the COUNT the reveal is decided from.
        this._stack?.addEventListener('items-changed', this._onStackNotify);
    }

    private _unbindStack(): void {
        this._stack?.removeEventListener('notify::visible-child', this._onStackNotify);
        this._stack?.removeEventListener('items-changed', this._onStackNotify);
    }

    private _resolveStack(value: AdwViewStack | string | null): AdwViewStack | null {
        if (value === null) return null;
        if (typeof value === 'string') return (document.getElementById(value) as AdwViewStack | null) ?? null;
        return value;
    }

    private _rebuild(): void {
        if (!this._initialized) return;

        const stackPages = this._stack?.pages ?? [];
        // The page count is half the reveal derivation, so it is fed on every
        // rebuild — `update_bar_revealed` is re-run from set_stack and from
        // items-changed for exactly this reason (:340-343, :277).
        this._barState.setPages(stackPages);

        const pages = viewSwitcherPagesFromStack(stackPages);
        const models = buildViewSwitcherButtons(pages, this._stack?.visibleChildIndex ?? -1, 'narrow');

        // Nodes are recreated only when the page COUNT moves. A selection change
        // must not replace the button the user is standing on — `selection_changed_cb`
        // only re-marks the existing buttons (adw-view-switcher.c:265-295), and a
        // wholesale replace would drop keyboard focus mid-interaction.
        if (models.length !== this._nodes.length) {
            this._barEl.replaceChildren();
            this._nodes = models.map((model) => this._buildButton(model.pageIndex));
            this._barEl.append(...this._nodes.map((nodes) => nodes.button));
        }

        models.forEach((model, index) => {
            const nodes = this._nodes[index];
            if (!nodes) return;

            nodes.button.hidden = !model.visible;
            nodes.button.classList.toggle('active', model.selected);
            nodes.button.setAttribute('aria-selected', String(model.selected));
            nodes.button.tabIndex = model.selected ? 0 : -1;

            applySwitcherIcon(nodes.icon, model.iconName);
            nodes.label.textContent = model.label;
            nodes.label.hidden = model.label.length === 0;
            applyIndicator(nodes.indicator, model.badgeLabel, model.needsAttention);
            applyDescription(nodes.button, model.description);

            if (model.label) nodes.button.removeAttribute('aria-label');
            else nodes.button.setAttribute('aria-label', model.iconName);
        });

        this._applyRevealed();
    }

    private _buildButton(pageIndex: number): BarButtonNodes {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-view-switcher-bar-button';
        button.setAttribute('role', 'tab');

        const icon = createAdwIcon(null, 'adw-view-switcher-bar-icon');

        const label = document.createElement('span');
        label.className = 'adw-view-switcher-bar-label';

        const indicator = document.createElement('span');
        indicator.className = 'adw-view-switcher-bar-indicator';
        indicator.setAttribute('aria-hidden', 'true'); // announced via aria-description

        button.append(icon, label, indicator);
        button.addEventListener('click', () => {
            if (this._stack) this._stack.visibleChildIndex = pageIndex;
        });

        return { button, icon, label, indicator };
    }

    private _applyRevealed(): void {
        this.hidden = !this._barState.revealed;
    }
}

customElements.define('adw-view-switcher-bar', AdwViewSwitcherBar);
