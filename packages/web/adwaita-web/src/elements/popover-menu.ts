// The menu INSIDE a `<gtk-popover>` — one implementation for both menu-bearing
// elements (ADR 0042).
//
// `<adw-split-button>` and `<gtk-menu-button>` are different buttons with the same
// popup: `GtkMenuButton` builds it in both cases, and the split button's dropdown half
// IS one. Before the portable menu model each element built its own rows, and the two
// disagreed about everything a model can carry — one drew icons and an `id`, the other
// drew neither; neither drew a section, a submenu, an accelerator, or a check.
//
// WHAT THIS DRAWS, which is what `GtkPopoverMenu` draws:
//
//   · a SECTION is inlined with a separator on each boundary (never a leading one) and
//     an optional heading — the split `flattenMenu` decides, not this file;
//   · a SUBMENU is a row that SWAPS THE PAGE, with a back row above the new list. That
//     is `GtkPopoverMenu`'s own shape (it is a stack of pages with a back button), and
//     it is what keeps "the user opened it" true — inlining a submenu would offer items
//     nobody asked for;
//   · CHECK and RADIO decorations, and the dim of an insensitive row, from
//     `resolveMenuItemState` — never from a field on the item, because `GMenuModel` has
//     no such field;
//   · an ACCELERATOR, right-aligned and dimmed (`popover.menu accelerator`). It is
//     DISPLAY ONLY: nothing here binds a key, exactly as in GTK, where the binding
//     comes from `gtk_application_set_accels_for_action`.
//
// THE KEYS ARE SPLIT, and the split is the reason this file registers a listener at all.
// `<gtk-popover>` owns the LIST keys for every surface that has rows — Arrow up/down with
// wrap, Home/End, Enter/Space to activate, Escape to dismiss — walking `.adw-popover-item`
// and skipping what cannot take focus. Re-implementing those here would be a second copy
// of one arithmetic on the same rows, and both copies would move the focus.
//
// What a popover cannot own is what makes a MENU a menu: LEFT and RIGHT change the PAGE.
// GTK puts that rule on the row rather than on the surface too —
// `gtk_model_button_focus` (`refs/gtk/gtk/gtkmodelbutton.c:1174-1210`): a focused NORMAL
// row with a `menu-name` takes GTK_DIR_RIGHT into that submenu (`:1189-1195`), and a
// focused TITLE row — the back row at the top of an open page — takes GTK_DIR_LEFT out of
// it (`:1182-1188`). Both are the row's own answer to a direction, which is why Left from
// the middle of a submenu does nothing in GTK and does nothing here.
//
// ARIA IS DERIVED, NOT DECLARED. `role` follows the item's menu role
// (`menuitem`/`menuitemcheckbox`/`menuitemradio`) and `aria-checked` follows `toggled`,
// so a screen reader hears the same three-way distinction a sighted reader sees. A row
// the action group disables is `aria-disabled` AND `disabled`, so it is announced and
// unclickable rather than merely dim.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (the page stack, the attribute list)
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss:68-90 (separator, accelerator, check/radio)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+.

import { flattenMenu, menuNodeAt, resolveMenuItemState } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuItem, AdwMenuModel, AdwMenuPath } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';
import type { GtkPopover } from './gtk-popover.js';

/**
 * Called when the reader chooses an item, with the path that addresses it in the WHOLE
 * model — never the item itself. The element resolves it through its own state, which is
 * what dismisses the menu, so handing over a second copy of the item would give the
 * activation two sources.
 */
export type PopoverMenuActivate = (path: AdwMenuPath) => void;

/** The label of the row that leaves a submenu. `GtkPopoverMenu` draws the parent's own label. */
const BACK_LABEL = 'Back';

/**
 * The rows of one popover, and which page is showing.
 *
 * A view rather than a function because a submenu is a NAVIGATION: the open page has to
 * survive between renders, and it has to reset when the popover closes — a menu that
 * reopens three levels deep is a menu the reader cannot get out of.
 */
export class PopoverMenuView {
    private _model: AdwMenuModel = [];
    private _actions: AdwMenuActions | null = null;
    private _title = '';
    /** The submenu whose items are showing; `[]` is the root page. */
    private _page: AdwMenuPath = [];
    /** The rows that OPEN a page — what ArrowRight acts on. Rebuilt by every render. */
    private _openers = new Set<HTMLElement>();
    /** The row that LEAVES a page — what ArrowLeft acts on. */
    private _backRow: HTMLElement | null = null;
    /** The canonical text of the model showing, so an unchanged re-render keeps the page. */
    private _key = '[]';
    private _rows: HTMLButtonElement[] = [];

    constructor(
        private readonly surface: GtkPopover,
        /** Class prefix for the element's own hooks — `adw-menu-button`, `adw-split-button-menu`. */
        private readonly prefix: string,
        private readonly onActivate: PopoverMenuActivate,
    ) {
        // On the SURFACE, not on each row: rows are replaced by every render and a
        // per-row listener would have to be rebound with them, which is how one gets
        // forgotten. The surface outlives every page.
        this.surface.addEventListener('keydown', (event) => this._onKeyDown(event));
    }

    /**
     * LEFT and RIGHT, which change the page. Every other key belongs to `<gtk-popover>`.
     *
     * The act is the row's own CLICK, not a second copy of what opening a page means:
     * `switch_menu` is one behaviour in GTK too, reached by a pointer and by a direction
     * alike. `preventDefault` before it, for the reason the popover's own Enter handler
     * gives — a focused `<button>` would otherwise also activate natively.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const active = document.activeElement as HTMLElement | null;
        if (active === null || !this.surface.contains(active)) return;
        if (event.key === 'ArrowRight' && this._openers.has(active)) {
            event.preventDefault();
            active.click();
            return;
        }
        if (event.key === 'ArrowLeft' && active === this._backRow) {
            event.preventDefault();
            active.click();
        }
    }

    /** Every row of the open page, in order — including the ones no key can reach. */
    get rows(): readonly HTMLButtonElement[] {
        return this._rows;
    }

    /**
     * The rows a key can actually REACH, which is the only list worth focusing into.
     *
     * A hidden row is not rendered and a DISABLED one cannot take focus, so
     * `element.focus()` on either is a silent no-op — and a no-op after `render()` has
     * replaced the row that had focus leaves `document.activeElement` on `<body>`,
     * OUTSIDE an open popover. Measured under real keys: Tab then walked to the control
     * BEHIND the popup and every arrow was dead, because both keydown listeners are
     * element-scoped and the event no longer fired inside either. Escape was the only
     * way out.
     *
     * The predicate lived in the two ELEMENTS (their open path) and not in the two page
     * changes here, which is how it came to be applied in two places out of four. One
     * list, so there is no fourth place to forget.
     */
    get focusableRows(): readonly HTMLButtonElement[] {
        return this._rows.filter((row) => !row.hidden && !row.disabled);
    }

    /**
     * Put focus on a page, counting only rows a key can reach.
     *
     * `skip` is how many reachable rows to pass — 1 when ENTERING a submenu, because the
     * back row is reachable and the reader was going to the first item past it. The
     * fallback to the first reachable row is what covers a submenu whose every item is
     * disabled: focus lands on the back row, which is always reachable, and the reader
     * can still leave with Left, Enter or Escape.
     */
    private focusPage(skip: number): void {
        const rows = this.focusableRows;
        (rows[skip] ?? rows[0])?.focus();
    }

    setModel(model: AdwMenuModel): void {
        // A CHANGED model invalidates the open page: the submenu it named may not exist
        // any more, and rendering a page that is gone leaves an empty popover with a
        // back row and no way to see what happened. An UNCHANGED one must not — every
        // element re-render calls this, and resetting unconditionally shut the submenu
        // the reader had just opened.
        const key = JSON.stringify(model);
        if (key !== this._key) {
            this._key = key;
            this._page = [];
        }
        this._model = model;
    }

    setActions(actions: AdwMenuActions | null): void {
        this._actions = actions;
    }

    setTitle(title: string): void {
        this._title = title;
    }

    /** Return to the root page — called when the popover closes. */
    reset(): void {
        this._page = [];
    }

    /** The items of the page currently showing. */
    private currentItems(): AdwMenuModel {
        if (this._page.length === 0) return this._model;
        const node = menuNodeAt(this._model, this._page);
        return node !== null && node.kind !== 'item' ? node.items : this._model;
    }

    /** Rebuild the surface's children from the model. */
    render(): void {
        this.surface.replaceChildren();
        this._rows = [];
        this._openers = new Set();
        this._backRow = null;

        const open = menuNodeAt(this._model, this._page);
        if (this._page.length > 0 && open !== null && open.kind === 'submenu') {
            this.surface.appendChild(this.backRow(open.label));
        } else if (this._title.length > 0) {
            this.surface.appendChild(this.heading(this._title, `${this.prefix}-title`));
        }

        // Keyed on the section's PATH, never on its label: two sections may be headed
        // the same, and comparing labels swallowed the second heading.
        let headed = '';
        for (const row of flattenMenu(this.currentItems(), this._page)) {
            if (row.separated) this.surface.appendChild(this.separator());
            // A section heading belongs to the SECTION, and `flattenMenu` deliberately
            // does not carry it — a heading is a DOM node, not a menu row, so the label
            // is read off the node the row's path leads through.
            const parentPath = row.path.slice(0, -1);
            const key = parentPath.join('.');
            if (key !== headed) {
                headed = key;
                const heading = this.sectionHeading(parentPath);
                if (heading !== null) {
                    this.surface.appendChild(this.heading(heading, 'adw-popover-section-title'));
                }
            }
            if (row.node.kind === 'submenu') {
                this.surface.appendChild(this.submenuRow(row.node.label, row.node.icon, row.path));
            } else {
                this.surface.appendChild(this.itemRow(row.node, row.path));
            }
        }
    }

    /** The label of the section at `path`, or `null` when it is not a labelled section. */
    private sectionHeading(path: AdwMenuPath): string | null {
        if (path.length <= this._page.length) return null;
        const parent = menuNodeAt(this._model, path);
        return parent !== null && parent.kind === 'section' && parent.label !== undefined ? parent.label : null;
    }

    private heading(text: string, extraClass: string): HTMLElement {
        const el = document.createElement('div');
        el.className = `adw-popover-title ${extraClass}`;
        el.textContent = text;
        return el;
    }

    private separator(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'adw-popover-separator';
        // A separator is decoration: it must not be walked as a row by a screen reader
        // any more than it is by `<gtk-popover>`'s `.adw-popover-item` selector.
        el.setAttribute('role', 'separator');
        return el;
    }

    /** A row, with the class that makes `<gtk-popover>` treat it as navigable. */
    private baseRow(extra: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `adw-popover-item ${extra}`;
        button.tabIndex = -1;
        this._rows.push(button);
        return button;
    }

    private backRow(label: string): HTMLButtonElement {
        const button = this.baseRow(`${this.prefix}-item adw-popover-back`);
        button.setAttribute('role', 'menuitem');
        button.appendChild(createGtkImage('go-previous', `${this.prefix}-item-icon`));
        const text = document.createElement('span');
        text.className = `${this.prefix}-item-label`;
        // The parent's own label names where Back goes; `Back` alone is the fallback for
        // a submenu that has none.
        text.textContent = label.length > 0 ? label : BACK_LABEL;
        button.appendChild(text);
        button.addEventListener('click', () => {
            this._page = this._page.slice(0, -1);
            this.render();
            this.focusPage(0);
        });
        this._backRow = button;
        return button;
    }

    private submenuRow(label: string, icon: string | undefined, path: AdwMenuPath): HTMLButtonElement {
        const button = this.baseRow(`${this.prefix}-item`);
        button.setAttribute('role', 'menuitem');
        // A submenu OPENS something, so it is a menu with a popup, not a command.
        button.setAttribute('aria-haspopup', 'menu');
        if (icon !== undefined && icon.length > 0) {
            button.appendChild(createGtkImage(icon, `${this.prefix}-item-icon`));
        }
        const text = document.createElement('span');
        text.className = `${this.prefix}-item-label`;
        text.textContent = label;
        button.appendChild(text);
        button.appendChild(createGtkImage('go-next', 'adw-popover-item-arrow'));
        button.addEventListener('click', () => {
            this._page = [...path];
            this.render();
            // Past the back row, which is where the reader was going — counted in
            // REACHABLE rows, so a disabled first item does not strand focus on <body>.
            this.focusPage(1);
        });
        this._openers.add(button);
        return button;
    }

    private itemRow(item: AdwMenuItem, path: AdwMenuPath): HTMLButtonElement {
        const state = resolveMenuItemState(item, this._actions ?? undefined);
        const button = this.baseRow(`${this.prefix}-item`);
        // `hidden-when` removes the row from the reader's world, not just from view:
        // `hidden` on a button also takes it out of the accessibility tree.
        button.hidden = !state.visible;
        button.disabled = !state.sensitive;
        if (!state.sensitive) button.setAttribute('aria-disabled', 'true');

        if (state.role === 'normal') {
            button.setAttribute('role', 'menuitem');
        } else {
            button.setAttribute('role', state.role === 'check' ? 'menuitemcheckbox' : 'menuitemradio');
            button.setAttribute('aria-checked', String(state.toggled));
            const mark = document.createElement('span');
            mark.className = `adw-popover-item-check ${state.role === 'radio' ? 'radio' : ''}`.trim();
            // The tick is drawn by CSS off `aria-checked`, so an unchecked row still
            // reserves the space and the labels of a group line up.
            button.appendChild(mark);
        }

        // An item that asked for NO icon gets no icon node — the emptiness of the
        // DECLARED name, not whether it resolved: `<gtk-image>` draws `image-missing`
        // for a name that was given and is merely undrawable, which is the one case a
        // reader needs to see.
        if (item.icon !== undefined && item.icon.length > 0) {
            button.appendChild(createGtkImage(item.icon, `${this.prefix}-item-icon`));
        }

        const label = document.createElement('span');
        label.className = `${this.prefix}-item-label`;
        // `use-markup` says the label IS Pango markup. The browser has no Pango, and
        // handing author markup to `innerHTML` would be an injection door in a renderer
        // that has no other one, so the text is shown verbatim and the flag is carried
        // for the GTK path. Stated rather than silently honoured.
        label.textContent = item.label;
        button.appendChild(label);

        if (item.accel !== undefined && item.accel.length > 0) {
            const accel = document.createElement('span');
            accel.className = 'adw-popover-item-accel';
            accel.textContent = item.accel;
            button.appendChild(accel);
        }

        button.addEventListener('click', () => {
            if (!state.sensitive) return;
            this.onActivate(path);
        });
        return button;
    }
}
