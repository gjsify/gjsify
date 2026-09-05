// Entry-row rendering for NativeScript — the pure half.
//
// The derivation is HEADLESS in `@gjsify/adwaita-core` (ADR 0004); NativeScript-specific
// is the PAINTING of one render snapshot: the CSS subset has no cross-fade, so
// libadwaita's 150 ms empty↔filled title transition collapses to a `visibility` swap at
// the endpoints, and there is no "insensitive" state, so the desensitized pencil is an
// opacity.
//
// No `@nativescript/core` VALUE imports, so specs reach the real painter off-device
// (AGENTS.md). The view interfaces below are STRUCTURAL on purpose: a real `Label`
// satisfies `ToggleableView` and so does a plain object in a spec, so the test drives
// the same function the widget does.
//
// Reference: refs/libadwaita/src/adw-entry-row.c (update_empty, allocate_editable_area)
// Reference: refs/libadwaita/src/adw-password-entry-row.c (notify_visibility_cb)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { EntryRowRenderState, PasswordEntryRowRenderState } from '@gjsify/adwaita-core';
import { viewConcealSymbolic, viewRevealSymbolic } from '@gjsify/adwaita-icons/actions';

/** The two NS visibility values the Adwaita widgets use — `collapse` takes no space. */
export type NsVisibility = 'visible' | 'collapse';

/** A view the render state shows or hides. */
export interface ToggleableView {
    visibility: string;
}

/** A view whose CSS class list the render state drives. */
export interface ClassedView {
    className: string;
}

/** The views an entry row paints, narrowed to what the render state touches. */
export interface EntryRowViews {
    /** The row itself — carries the `focused` / `empty` state classes (C:183-186). */
    row: ClassedView;
    /** The large placeholder title (`empty_title` in adw-entry-row.ui). */
    emptyTitle: ToggleableView;
    /** The small label above the value (`title` in adw-entry-row.ui). */
    title: ToggleableView;
    /** The editable field. */
    field: { text: string; editable: boolean };
    /** The trailing pencil — hidden AND desensitized independently (C:149-150). */
    editIcon: ToggleableView & ClassedView & { opacity: number };
    /** The caps-lock warning slot. */
    indicator: ToggleableView;
    /** The apply button. */
    applyButton: ToggleableView;
}

/** The views a password entry row adds. */
export interface PasswordEntryRowViews {
    /** The masked field. */
    field: { secure: boolean };
    /** The peek toggle, whose `icon` takes an Adwaita symbolic SVG string. */
    peekButton: { iconName: string };
}

/** Base class list of an entry row, before the state classes. */
export const NS_ENTRY_ROW_CLASS = 'adw-row adw-action-row adw-entry-row';

/** Base class list of a password entry row. */
export const NS_PASSWORD_ENTRY_ROW_CLASS = `${NS_ENTRY_ROW_CLASS} adw-password-entry-row`;

/** Class list of the trailing pencil. */
export const NS_EDIT_ICON_CLASS = 'gtk-image adw-entry-edit';

/**
 * Marker class for a desensitized part. NS has no insensitive state, so the
 * class is only a styling hook — {@link NS_INSENSITIVE_OPACITY} is what the user
 * actually sees.
 */
export const NS_INSENSITIVE_CLASS = 'adw-insensitive';

/**
 * Opacity of the desensitized pencil — `$strong_disabled_opacity` 30%
 * (_colors.scss:311), which `> .edit-icon:disabled` takes (_lists.scss:205-207).
 *
 * NOT the general `--disabled-opacity` (50% light / 40% dark): libadwaita gives
 * this one icon a stronger dim than a disabled widget gets, and 0.4 here was the
 * general value applied to the one place that has its own. A second user of
 * {@link NS_INSENSITIVE_CLASS} needs its own number, not this one.
 */
export const NS_INSENSITIVE_OPACITY = 0.3;

/** Map a boolean onto NativeScript's `visibility`. */
export function nsVisibility(visible: boolean): NsVisibility {
    return visible ? 'visible' : 'collapse';
}

/**
 * The row's class list for one render snapshot.
 *
 * `focused` is libadwaita's own class name — `text_state_flags_changed_cb` adds
 * and removes it on the ROW node (adw-entry-row.c:183-186). `empty` has no C
 * counterpart (GTK animates instead of styling), but the NS CSS subset cannot
 * express `:focus-within` at all, so both states have to be reachable as classes
 * or they are not reachable at all on this port.
 */
export function entryRowClassName(base: string, state: EntryRowRenderState): string {
    let className = base;
    if (state.editing) className += ' focused';
    if (state.empty) className += ' empty';
    return className;
}

/**
 * Paint one entry-row render snapshot.
 *
 * The two titles are the endpoints of libadwaita's cross-fade (C:433-439): GTK
 * lerps between them over `EMPTY_ANIMATION_DURATION_MS`, NS swaps at
 * `emptyTarget` because its CSS subset has no transform/animation.
 */
export function applyEntryRowState(views: EntryRowViews, state: EntryRowRenderState, base: string): void {
    views.row.className = entryRowClassName(base, state);
    if (views.field.text !== state.text) views.field.text = state.text;
    views.field.editable = state.editable;
    views.emptyTitle.visibility = nsVisibility(state.emptyTarget === 0);
    views.title.visibility = nsVisibility(state.emptyTarget === 1);
    views.editIcon.visibility = nsVisibility(state.editIconVisible);
    views.editIcon.className = state.editIconSensitive
        ? NS_EDIT_ICON_CLASS
        : `${NS_EDIT_ICON_CLASS} ${NS_INSENSITIVE_CLASS}`;
    views.editIcon.opacity = state.editIconSensitive ? 1 : NS_INSENSITIVE_OPACITY;
    views.indicator.visibility = nsVisibility(state.indicatorVisible);
    views.applyButton.visibility = nsVisibility(state.applyButtonVisible);
}

/**
 * The Adwaita symbolic SVG for a canonical peek icon name.
 *
 * The core names the icon the way the C does (`view-reveal-symbolic` /
 * `view-conceal-symbolic`, adw-password-entry-row.c:68,73); this is the one
 * place that maps a name onto the asset `@gjsify/adwaita-icons` ships.
 */
export function peekIconSvg(iconName: PasswordEntryRowRenderState['peekIconName']): string {
    return iconName === 'view-conceal-symbolic' ? viewConcealSymbolic : viewRevealSymbolic;
}

/** Paint one password-entry-row render snapshot — `notify_visibility_cb` (C:62-81). */
export function applyPasswordEntryRowState(views: PasswordEntryRowViews, state: PasswordEntryRowRenderState): void {
    views.field.secure = !state.revealed;
    views.peekButton.iconName = peekIconSvg(state.peekIconName);
}
