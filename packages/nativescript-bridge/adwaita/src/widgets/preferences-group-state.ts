// AdwPreferencesGroup's NativeScript-specific half — the header/listbox visuals.
//
// The derivation itself (which of the title, description, header and listbox
// are shown, and whether the header is `single-line`) is HEADLESS and lives in
// `@gjsify/adwaita-core` as `derivePreferencesGroupHeader` (ADR 0004), shared
// with `@gjsify/adwaita-web` and pinned by the conformance vectors. What is
// NativeScript-specific is only how a state becomes pixels: NS has no `hidden`
// attribute, it has `View.visibility`, and it has no `classList`, so the
// `single-line` style class has to be composed into a `className` string.
//
// The port this replaces derived ONE of the five states — a non-empty title —
// and expressed it by adding and removing the header `Label` from the tree. It
// had no description, no header suffix, no `single-line` (so a title-only
// header could not take libadwaita's 34px floor) and no listbox rule.
//
// This module imports only TYPES from `@nativescript/core` — like
// `icon-path.ts`, `row-press.ts` and `view-stack-state.ts` — so it carries no
// runtime `@nativescript/core` value import and loads, and is unit-testable,
// off-device. `adw-preferences-group.ts` cannot serve that role: it `extends
// StackLayout`, which evaluates the bare specifier at module-eval and is
// unresolvable on GJS/Node.
//
// Reference: refs/libadwaita/src/adw-preferences-group.c:91-156
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss:6-13
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { derivePreferencesGroupHeader } from '@gjsify/adwaita-core';
import type { PreferencesGroupHeaderState } from '@gjsify/adwaita-core';

/** The two `View.visibility` values a preferences group ever assigns. */
export type NsVisibility = 'visible' | 'collapse';

/** The header box's base style class. */
export const PREFERENCES_GROUP_HEADER_CLASS = 'adw-preferences-group-header';

/**
 * The style class libadwaita toggles for a one-line header. Not cosmetic: the
 * stylesheet gives `.single-line` a `min-height` and everything else a bottom
 * margin, so a header without it is laid out as if it had two lines.
 */
export const PREFERENCES_GROUP_SINGLE_LINE_CLASS = 'single-line';

/** What a group knows about itself when it re-derives its visuals. */
export interface NsPreferencesGroupInput {
    /** `AdwPreferencesGroup:title`. */
    title?: string | null;
    /** `AdwPreferencesGroup:description`. */
    description?: string | null;
    /** Whether a `header-suffix` view is set. */
    hasHeaderSuffix?: boolean;
    /** How many children the boxed list holds. */
    rowCount?: number;
}

/** The NativeScript form of {@link PreferencesGroupHeaderState}. */
export interface NsPreferencesGroupVisuals {
    /** `visibility` for the title label. */
    titleVisibility: NsVisibility;
    /** `visibility` for the description label. */
    descriptionVisibility: NsVisibility;
    /** `visibility` for the whole header box. */
    headerVisibility: NsVisibility;
    /** `className` for the header box, carrying `single-line` when it applies. */
    headerClassName: string;
    /** `visibility` for the `.boxed-list` container. */
    listboxVisibility: NsVisibility;
}

/**
 * The five derived states for a group.
 *
 * `useMarkup: false` is deliberate and is the same choice the browser renderer
 * makes: an NS `Label` shows the string verbatim (it has no Pango markup), so
 * visibility must be judged on the string that is actually painted. Rendering
 * markup is a separate, still-open gap; closing it flips this one flag.
 */
export function preferencesGroupHeaderState(input: NsPreferencesGroupInput): PreferencesGroupHeaderState {
    return derivePreferencesGroupHeader({ ...input, useMarkup: false });
}

/**
 * `visibility` / `className` a group must apply for the given inputs.
 *
 * `'collapse'` rather than `'hidden'`: a hidden NS view still occupies its
 * space, which would leave the header's padding behind on a group that has no
 * header — the very thing `update_header_visibility` exists to avoid.
 */
export function preferencesGroupVisuals(input: NsPreferencesGroupInput): NsPreferencesGroupVisuals {
    const state = preferencesGroupHeaderState(input);
    const visibility = (shown: boolean): NsVisibility => (shown ? 'visible' : 'collapse');

    return {
        titleVisibility: visibility(state.titleVisible),
        descriptionVisibility: visibility(state.descriptionVisible),
        headerVisibility: visibility(state.headerVisible),
        headerClassName: state.singleLine
            ? `${PREFERENCES_GROUP_HEADER_CLASS} ${PREFERENCES_GROUP_SINGLE_LINE_CLASS}`
            : PREFERENCES_GROUP_HEADER_CLASS,
        listboxVisibility: visibility(state.listboxVisible),
    };
}
