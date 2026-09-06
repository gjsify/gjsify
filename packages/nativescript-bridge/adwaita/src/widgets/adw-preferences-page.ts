// AdwPreferencesPage — a Libadwaita-style preferences page for NativeScript.
//
// Renders a REAL NativeScript `ScrollView` wrapping a vertical `StackLayout` that
// holds `AdwPreferencesGroup`s — the page-level wrapper that scrolls its content,
// mirroring `Adw.PreferencesPage`. Styled via the `adw-preferences-page` CSS class
// (see `src/theme/adwaita.css`) — NOT a webview.
//
// The page also carries its IDENTITY — title, name, icon-name, use-underline —
// which is not decoration: `adw_preferences_dialog_add` binds all four onto the
// view-stack page (adw-preferences-dialog.c:707-711), and
// `create_search_row_subtitle` needs the title back the moment a second page is
// visible (`General → Appearance`). None of it is painted by the page itself,
// exactly as in GTK, where a view switcher and the search results show it.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_preferences.scss`.
// Reference: refs/libadwaita/src/adw-preferences-page.c (title/name/use-underline)
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { ScrollView, StackLayout } from '@nativescript/core';
import type { NsSearchableGroup, NsSearchablePage } from './preferences-search.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export class AdwPreferencesPage extends ScrollView implements NsSearchablePage {
    /**
     * The vertical stack that actually holds the groups.
     *
     * NOT `_content`, which is what it was called first. `ContentView` — in this
     * class's chain via `ScrollView` — uses `this._content` as the backing store for
     * its own `content` accessor (`ui/content-view/index.js:12,15-21`). Sharing that
     * name does not shadow the field, it IS the field: `readonly` becomes a
     * compile-time fiction, because `set content` writes it, so any `page.content = x`
     * silently re-points this handle and `addGroup`/`searchGroups`/`groups` then work
     * on the wrong view. No type-checker can catch it — `_content` appears in no
     * `.d.ts` of `@nativescript/core`, only in the compiled JS.
     *
     * Five sibling widgets keep `_content` safely, because their chain runs
     * `GridLayout → LayoutBase → CustomLayoutView` and never reaches `ContentView`.
     * This class and `AdwSidebar` (which calls its stack `_list`) are the two on
     * `ScrollView`, and so the two where the name is taken.
     */
    protected readonly _groups: StackLayout;

    private _title = '';
    private _name = '';
    private _iconName = '';
    private _useUnderline = false;

    constructor(props?: ConstructProps<AdwPreferencesPage>) {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-preferences-page';

        const content = new StackLayout();
        content.orientation = 'vertical';
        content.className = 'adw-preferences-page-content';

        // ScrollView holds exactly one scrollable child via its `content` slot.
        this.content = content;
        this._groups = content;

        // After `_groups`, because a construct prop assigns through the public
        // setters and `addGroup` reads it.
        applyConstructProps(this, props);
    }

    /**
     * `AdwPreferencesPage:title` — shown by a view switcher and by the search
     * results, never by the page itself. `null` is the empty string
     * (`adw_preferences_page_set_title`, adw-preferences-page.c:538).
     */
    get title(): string {
        return this._title;
    }

    set title(value: string) {
        this._title = value ?? '';
    }

    /** `AdwPreferencesPage:name` — the view-stack child name. */
    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value ?? '';
    }

    /** `AdwPreferencesPage:icon-name` — the symbolic a view switcher shows. */
    get iconName(): string {
        return this._iconName;
    }

    set iconName(value: string) {
        this._iconName = value ?? '';
    }

    /**
     * `AdwPreferencesPage:use-underline` — the title carries a mnemonic, which
     * a search-result subtitle strips before showing it (:196-199).
     */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(value: boolean | string) {
        this._useUnderline = xmlBoolean(value, false);
    }

    /** Append a preferences group (or any view) to the page. */
    addGroup(view: View): void {
        this._groups.addChild(view);
    }

    /** Remove a previously-added group from the page. */
    removeGroup(view: View): void {
        this._groups.removeChild(view);
    }

    /**
     * An XML child is a GROUP. `ScrollView`'s inherited `_addChildFromBuilder` sets
     * `content`, which would REPLACE the page's own scroll body — one group in place
     * of all of them, and no error.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.addGroup(view);
    }

    /**
     * The groups this page contributes to a preferences search, in order.
     *
     * Reads the live children so a group added or removed later is indexed
     * without an invalidation step.
     */
    searchGroups(): readonly NsSearchableGroup[] {
        const groups: NsSearchableGroup[] = [];
        const count = this._groups.getChildrenCount();
        for (let index = 0; index < count; index++) {
            const child = this._groups.getChildAt(index) as unknown as Partial<NsSearchableGroup>;
            // A page may hold plain views next to its groups; only something
            // that can enumerate rows is part of the corpus.
            if (typeof child.searchRows === 'function') groups.push(child as NsSearchableGroup);
        }
        return groups;
    }

    /** The vertical content stack holding the groups. */
    get groups(): StackLayout {
        return this._groups;
    }
}
