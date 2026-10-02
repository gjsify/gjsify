// <gtk-header-bar> — GTK's titlebar widget: a horizontal bar that packs children at the
// start and at the end and shows the window's title in the middle, with the window-frame
// buttons GTK would otherwise ask the window manager for.
//
// THE CSS TREE, PORTED VERBATIM (gtkheaderbar.c:99-116, `gtk_header_bar_init` :649-675):
//
//   headerbar
//   ╰── windowhandle
//       ╰── box
//           ├── box.start ── [windowcontrols.start] ── [other children]
//           ├── [Title Widget]
//           ╰── box.end ──── [other children] ──────── [windowcontrols.end]
//
// The centre is the `GtkCenterBox`'s centre child, so the title is centred on the WHOLE bar
// rather than on the space the two ends leave — which is why `_box` lays out as a flex row
// with `order` on the three children and the title's own box is `flex: 1`.
//
// THE THREE WAYS A CHILD GETS THERE (gtkheaderbar.c:678-701, `gtk_header_bar_pack` :843-861):
//   `start` packs from the start — an APPEND; `end` packs from the end — a PREPEND, so the
//   first `[end]` child sits nearest the edge and each later one lands in front of it; a
//   child with NO type packs from the start. There is no `center` slot: the centre is
//   `title-widget`, and the buildable's `"title"` is the DEPRECATED spelling of it
//   (gtkheaderbar.c:683-686), so both spellings are accepted here as well.
//
// THE DERIVED TITLE IS A LABEL, NOT A WINDOW TITLE. `construct_title_label` (gtkheaderbar.c:274-290)
// builds a plain `GtkLabel` — `title` style class, `valign=center`, no wrap,
// `single-line-mode`, `ellipsize=END`, `width-chars=5` (MIN_TITLE_CHARS, :117) — and
// `Gtk.HeaderBar` has no `title` property at all. `update_title` (:250-271) fills it from
// the ROOT window's title, and failing that from `g_get_application_name()`, and failing
// THAT from `g_get_prgname()`. This element reproduces the first step against the nearest
// `<gtk-window>`/`<adw-window>` ancestor; for the two GLib fallbacks — a PROCESS name, which
// is what those two are — the page's own `<title>` is the only thing a browser has, and it is
// the same fact one level up. An app that wants something richer sets a `slot="title"`
// child, which is the whole of `Gtk.HeaderBar:title-widget`.
//
// THE EITHER/OR, IN BOTH DIRECTIONS. `gtk_header_bar_set_title_widget` empties the centre
// bin before installing (:319-341) and rebuilds the derived label when the widget goes back
// to NULL (:332-336) — so a centre widget takes the title away and GIVING IT BACK restores
// it, which is the asymmetry `<adw-header-bar>` documents as its own missing half.
//
// `show-title-buttons` (default TRUE, :657) is what CREATES the two controls and what
// REMOVES them again (:798-826): `create_window_controls` builds a `GTK_PACK_START` one,
// PREPENDS it into the start box and binds `decoration-layout` and `use-native-controls` to
// it, then builds a `GTK_PACK_END` one, APPENDS it into the end box and binds the same two
// properties. The `empty`↔`visible` binding beside them (:238, :247) is why a bar with no
// buttons for its side shows nothing at all. `Gtk.WindowControls` draws those buttons from
// the FRAME it sits in, so a bar outside a window shows none either way.
//
// `default-decoration` — the 37px variant libadwaita draws at `_header-bar.scss:53-75` — is
// NOT derived here. It is set by `update_default_decoration` (:205-236), and only a
// `GtkWindow` that installs an EMPTY header bar for itself ever asks for it, through the
// internal `_gtk_header_bar_track_default_decoration` (:242-248). A bar that has children is
// never in that mode, and one the page wrote is never empty.
//
// A11Y: `role="group"`, GtkHeaderBar's own accessible role (:644).
//
// Reference: refs/gtk/gtk/gtkheaderbar.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_header-bar.scss (GtkHeaderBar)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { bindSlottedChildren } from '../slotted-children.js';

// Registers <gtk-window-controls>: `show-title-buttons` builds two of them, so importing
// the bar alone must still define them.
import './gtk-window-controls.js';

export class GtkHeaderBar extends HTMLElement {
    private _initialized = false;
    private _handle!: HTMLDivElement;
    private _box!: HTMLDivElement;
    private _startBox!: HTMLDivElement;
    private _endBox!: HTMLDivElement;
    /** The two `GtkWindowControls`, present only while `show-title-buttons` is true (:798-826). */
    private _startControls: HTMLElement | null = null;
    private _endControls: HTMLElement | null = null;
    /** The derived `GtkLabel`, or `null` while a `title-widget` holds the centre. */
    private _titleLabel: HTMLElement | null = null;
    /** The child that took the centre — read back out of `_box`, never stored as truth. */
    private _centre: HTMLElement | null = null;
    private _centreObserver: MutationObserver | null = null;

    static get observedAttributes() {
        return ['decoration-layout', 'show-title-buttons'];
    }

    /** `Gtk.HeaderBar:decoration-layout` — bound to both controls (:231-236, :240-245). */
    get decorationLayout(): string | null {
        return this.getAttribute('decoration-layout');
    }

    set decorationLayout(value: string | null) {
        if (value === null) this.removeAttribute('decoration-layout');
        else this._write('decoration-layout', value);
    }

    /** `Gtk.HeaderBar:show-title-buttons` — whether the standard frame controls are built. */
    get showTitleButtons(): boolean {
        return this.getAttribute('show-title-buttons') !== 'false';
    }

    set showTitleButtons(value: boolean) {
        this._write('show-title-buttons', String(value));
    }

    /** `Gtk.HeaderBar:title-widget`, read as the element that holds the centre — or `null`. */
    get titleWidget(): HTMLElement | null {
        return this._centre;
    }

    /** `setAttribute` for a write that changes nothing; every GObject setter here returns early. */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._followCentre();
            return;
        }
        this._initialized = true;

        this.setAttribute('role', 'group');

        this._startBox = document.createElement('div');
        this._startBox.className = 'adw-gtk-header-bar-start';
        this._endBox = document.createElement('div');
        this._endBox.className = 'adw-gtk-header-bar-end';
        this._box = document.createElement('div');
        this._box.className = 'adw-gtk-header-bar-box';
        this._box.append(this._startBox, this._endBox);
        this._handle = document.createElement('div');
        this._handle.className = 'adw-gtk-header-bar-handle';
        this._handle.appendChild(this._box);

        this._renderTitleButtons();

        bindSlottedChildren(this, [
            { name: 'start', into: this._startBox },
            { name: 'title', into: this._box },
            // The DEPRECATED buildable spelling of the same slot (:683-686), kept because a
            // tree authored at the property position writes it.
            { name: 'title-widget', into: this._box },
            // `end` is a CONSUME, not an `into` slot: `gtk_header_bar_pack_end` is a PREPEND
            // (gtkheaderbar.c:847-858) and a slot with an `into` is routed with `appendChild`
            // whichever `consume` it also carries, so the two together quietly packed the end
            // in the wrong order.
            { name: 'end', consume: (node) => this._endBox.prepend(node) },
            // An untyped `<child>` packs from the start (:698).
            { into: this._startBox },
        ]).install(this._handle);

        this._followCentre();
    }

    disconnectedCallback() {
        this._centreObserver?.disconnect();
        this._centreObserver = null;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'show-title-buttons') this._renderTitleButtons();
        else this._bindDecorationLayout();
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._property(name) } }),
        );
    }

    private _property(name: string): boolean | string | null {
        return name === 'show-title-buttons' ? this.showTitleButtons : this.decorationLayout;
    }

    /**
     * `create_window_controls` and its inverse, `gtk_header_bar_set_show_title_buttons`
     * (gtkheaderbar.c:198-249, :798-826): the start controls are PREPENDED into the start
     * box, the end controls APPENDED into the end box, and setting the property false
     * REMOVES both — which is why a bar with the property off has no controls at all rather
     * than hidden ones.
     */
    private _renderTitleButtons(): void {
        if (!this.showTitleButtons) {
            this._startControls?.remove();
            this._endControls?.remove();
            this._startControls = null;
            this._endControls = null;
            return;
        }
        if (this._startControls === null) {
            this._startControls = document.createElement('gtk-window-controls');
            this._startControls.setAttribute('side', 'start');
            this._startBox.prepend(this._startControls);
            this._endControls = document.createElement('gtk-window-controls');
            this._endControls.setAttribute('side', 'end');
            this._endBox.appendChild(this._endControls);
        }
        this._bindDecorationLayout();
    }

    /** The two `G_BINDING_SYNC_CREATE` bindings onto the controls (:229-247). */
    private _bindDecorationLayout(): void {
        for (const controls of [this._startControls, this._endControls]) {
            if (controls === null) continue;
            const layout = this.decorationLayout;
            if (layout === null) controls.removeAttribute('decoration-layout');
            else controls.setAttribute('decoration-layout', layout);
        }
    }

    /**
     * The two things `gtk_header_bar_root` connects to (gtkheaderbar.c:362-376): the centre
     * either/or, which changes what belongs in the middle in BOTH directions — `set_title_widget`
     * empties the bin before installing and rebuilds the derived label when it is handed back
     * to NULL (:319-341) — and `notify::title` on the ROOT, which re-runs `update_title`.
     */
    private _followCentre(): void {
        this._centreObserver?.disconnect();
        this._centreObserver = new MutationObserver(() => this._syncCentre());
        // `_box`'s only other children are the two side boxes and the derived label itself.
        this._centreObserver.observe(this._box, { childList: true });
        const root = this.closest('gtk-window, adw-window');
        if (root !== null) {
            this._centreObserver.observe(root, { attributes: true, attributeFilter: ['title'] });
        }
        this._syncCentre();
    }

    /** The child of `_box` that is neither a side box nor the derived label. */
    private _centreChild(): HTMLElement | null {
        for (const child of this._box.children) {
            if (child === this._startBox || child === this._endBox || child === this._titleLabel) continue;
            if (child instanceof HTMLElement) return child;
        }
        return null;
    }

    private _syncCentre(): void {
        this._centre = this._centreChild();
        if (this._centre !== null) this._dropTitleLabel();
        else if (this._titleLabel === null) this._constructTitleLabel();
        else this._updateTitle();
    }

    /** `construct_title_label` (gtkheaderbar.c:274-290), with `width-chars=5` as CSS. */
    private _constructTitleLabel(): void {
        const label = document.createElement('gtk-label');
        label.className = 'title adw-gtk-header-bar-title';
        this._titleLabel = label;
        this._box.appendChild(label);
        this._updateTitle();
    }

    /** `gtk_header_bar_set_title_widget`'s first act: the centre bin goes empty (:323). */
    private _dropTitleLabel(): void {
        this._titleLabel?.remove();
        this._titleLabel = null;
    }

    /**
     * `update_title` (gtkheaderbar.c:250-271): the root window's title, then the two GLib
     * process-name fallbacks — which is what the page's own `<title>` stands in for here.
     */
    private _updateTitle(): void {
        const label = this._titleLabel;
        if (label === null) return;
        const root = this.closest('gtk-window, adw-window');
        const title = root?.getAttribute('title') ?? document.title;
        if (title === '') label.removeAttribute('label');
        else label.setAttribute('label', title);
    }
}

customElements.define('gtk-header-bar', GtkHeaderBar);
