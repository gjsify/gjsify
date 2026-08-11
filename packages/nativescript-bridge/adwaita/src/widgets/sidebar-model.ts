// Sidebar model for NativeScript — the pure half.
//
// The behaviour is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// `SidebarState`: the flat index space, the out-of-range rule, the items-changed
// selection adjustment, the selection-vs-activation split. NativeScript-specific
// here is only the flat `setItems(labels)` convenience surface and the row class.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the REAL
// code off-device; `adw-sidebar.ts` cannot, because `extends ScrollView` evaluates
// the bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-sidebar.c
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.

import { SidebarState } from '@gjsify/adwaita-core';
import type { AdwSidebarItemSpec, AdwSidebarSectionSpec, SidebarItemFilter } from '@gjsify/adwaita-core';

// Re-exported so `adw-sidebar.ts` and consumers get both halves from one place.
export { SidebarState };
export type { AdwSidebarItemSpec, AdwSidebarSectionSpec, SidebarItemFilter };

/**
 * The section list a flat `AdwSidebar.setItems(labels)` call means: one untitled
 * section, which renders no header at all (a section header's `visible` is bound to a
 * non-empty title).
 */
export function sidebarSectionsFromLabels(labels: readonly string[]): AdwSidebarSectionSpec[] {
    return [{ items: labels.map((title) => ({ title })) }];
}

/**
 * The class string one navigation row carries. `selectionVisible` is false in page
 * mode, where libadwaita tracks the selection but never paints it — those rows are
 * plain boxed-list `AdwActionRow`s with no selected state.
 */
export function sidebarRowClassName(selected: boolean, selectionVisible: boolean): string {
    return selected && selectionVisible ? 'adw-sidebar-row active' : 'adw-sidebar-row';
}
