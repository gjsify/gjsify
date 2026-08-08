// Sidebar model for NativeScript — the pure half.
//
// The behaviour itself is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004)
// as `SidebarState`: the flat index space, the out-of-range rule, the
// items-changed selection adjustment, the selection-vs-activation split. What is
// NativeScript-specific is only the flat `setItems(labels)` convenience surface
// this bridge has always exposed, and the row class string.
//
// This module is deliberately FREE of `@nativescript/core` value imports — like
// `icon-path.ts`, `row-press.ts` and `avatar-color.ts` — so the spec suite can
// exercise the REAL code off-device. `adw-sidebar.ts` cannot serve that role: it
// `extends ScrollView`, which evaluates the bare `@nativescript/core` specifier
// at module-eval and is unresolvable on GJS/Node.
//
// What this replaces: the widget used to carry a re-typed copy of
// `ToggleGroupState` (bounded index, reset-to-0 on a shorter list, notify on
// change) plus its own row fan-out loop — a copy of logic `@gjsify/adwaita-core`
// already owned, on top of which the sidebar-specific derivations were missing
// entirely.
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
 * section, which renders no header at all (a first + untitled section's header is
 * bound to a non-empty title, adw-sidebar.c:1521-1527).
 */
export function sidebarSectionsFromLabels(labels: readonly string[]): AdwSidebarSectionSpec[] {
    return [{ items: labels.map((title) => ({ title })) }];
}

/**
 * The class string one navigation row carries.
 *
 * `selectionVisible` is false in page mode, where libadwaita tracks the
 * selection but never paints it (adw-sidebar.c:2948-2951) — its rows are plain
 * boxed-list `AdwActionRow`s with no selected state.
 */
export function sidebarRowClassName(selected: boolean, selectionVisible: boolean): string {
    return selected && selectionVisible ? 'adw-sidebar-row active' : 'adw-sidebar-row';
}
