// `Adw.SidebarSection` and `Adw.SidebarItem` — the two halves of an `Adw.Sidebar`'s model,
// as the value objects GTK makes them.
//
// NOT VIEWS: both are GObjects the sidebar turns into rows of its own, and a `.blp` writes
// `Adw.SidebarSection { title: "…"; Adw.SidebarItem { … } }` inside an `Adw.Sidebar`. Each
// IS the portable spec it implements (`AdwSidebarSectionSpec`, `AdwSidebarItemSpec`), so
// what a section hands the sidebar is the value `AdwSidebar.sections` already takes and no
// second input shape exists. Under `values/` and not `widgets/` because neither is a
// widget: every gate over `widgets/` holds a class there to the widget rules (a
// construct-props bag, the signal door, the GIR property sweep), and these are the
// constructible values `CONSTRUCTIBLE_VALUES` (`scripts/value-types.mjs`) declares instead.
//
// Items arrive at a section through `_addChildFromBuilder` in document order, as
// `adw_sidebar_section_append` appends them (adw-sidebar-section.c:493), and anything that
// is not an item is refused as the C refuses it with a `g_warning`.
//
// An item's `subtitle` and `iconName` are carried and not drawn: this port's rows are a
// title label (`adw-sidebar.ts` says why), so they reach the model — `selectedItem`
// answers them — exactly as they do through `sections`.
//
// Reference: refs/libadwaita/src/adw-sidebar-item.c (the properties, :246-383)
// Reference: refs/libadwaita/src/adw-sidebar-section.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwSidebarItemSpec, AdwSidebarSectionSpec } from '@gjsify/adwaita-core';

import { xmlBoolean } from '../widgets/xml-values.js';

/** What `new Adw.SidebarItem({ … })` takes. */
export interface AdwSidebarItemProps {
    title?: string | null;
    subtitle?: string | null;
    iconName?: string | null;
    visible?: boolean | string;
    enabled?: boolean | string;
}

export class AdwSidebarItem implements AdwSidebarItemSpec {
    /** `Adw.SidebarItem:title`. */
    title: string;
    /** `Adw.SidebarItem:subtitle`. */
    subtitle: string;
    /** `Adw.SidebarItem:icon-name` — `''` for none. */
    iconName: string;
    /** `Adw.SidebarItem:visible` — bound to the row's `visible`. Default `true`. */
    visible: boolean;
    /** `Adw.SidebarItem:enabled` — bound to the row's `sensitive`. Default `true`. */
    enabled: boolean;

    constructor(props?: AdwSidebarItemProps | null) {
        this.title = props?.title ?? '';
        this.subtitle = props?.subtitle ?? '';
        this.iconName = props?.iconName ?? '';
        this.visible = xmlBoolean(props?.visible, true);
        this.enabled = xmlBoolean(props?.enabled, true);
    }
}

/** What `new Adw.SidebarSection({ … })` takes. */
export interface AdwSidebarSectionProps {
    title?: string | null;
}

export class AdwSidebarSection implements AdwSidebarSectionSpec {
    /** `Adw.SidebarSection:title` — `''` draws a separator instead of a heading. */
    title: string;
    /** The section's items, in the order they were appended. */
    readonly items: AdwSidebarItem[] = [];
    /** The sidebar showing this section, told when an item arrives — see {@link _bindOwner}. */
    private _owner: (() => void) | null = null;

    constructor(props?: AdwSidebarSectionProps | null) {
        this.title = props?.title ?? '';
    }

    /** `adw_sidebar_section_append`. A sidebar already showing the section redraws. */
    append(item: AdwSidebarItem): void {
        this.items.push(item);
        this._owner?.();
    }

    /**
     * Called by the sidebar that takes this section. NativeScript's XML builder hands a
     * `<adw:SidebarSection>` to the sidebar at its START tag, before its items are read, so
     * the items reach a section the sidebar already drew — as `adw_sidebar_section_append` on
     * a section in a sidebar does in C, which the sidebar follows through `items-changed`.
     */
    _bindOwner(owner: () => void): void {
        this._owner = owner;
    }

    /** XML inflation: every child is an item, appended in document order. */
    _addChildFromBuilder(_name: string, child: object): void {
        if (!(child instanceof AdwSidebarItem)) {
            throw new Error(
                `Adw.SidebarSection takes only Adw.SidebarItem children, not \`${child.constructor.name}\`.`,
            );
        }
        this.append(child);
    }
}
