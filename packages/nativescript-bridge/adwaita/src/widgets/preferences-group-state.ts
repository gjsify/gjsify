// AdwPreferencesGroup's NativeScript-specific half — the header/listbox visuals.
//
// The derivation (which of the title, description, header and listbox are shown, and
// whether the header is `single-line`) is HEADLESS in `@gjsify/adwaita-core` as
// `derivePreferencesGroupHeader` (ADR 0004), shared with `@gjsify/adwaita-web` and
// pinned by the conformance vectors. NativeScript-specific is only how a state becomes
// pixels: NS has no `hidden` attribute but has `View.visibility`, and no `classList`,
// so `single-line` has to be composed into a `className` string.
//
// TYPE-only imports from `@nativescript/core`, so this module is unit-testable
// off-device; `adw-preferences-group.ts` cannot be, because `extends StackLayout`
// evaluates the bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-preferences-group.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_preferences.scss
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
    title?: string | null;
    description?: string | null;
    /** Whether a `header-suffix` view is set. */
    hasHeaderSuffix?: boolean;
    /** How many children the boxed list holds. */
    rowCount?: number;
}

/** The NativeScript form of {@link PreferencesGroupHeaderState}. */
export interface NsPreferencesGroupVisuals {
    titleVisibility: NsVisibility;
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
 * `useMarkup: false` is deliberate and matches the browser renderer: an NS `Label`
 * shows the string verbatim (no Pango markup), so visibility must be judged on the
 * string that is actually painted. Rendering markup is a still-open gap; closing it
 * flips this one flag.
 */
export function preferencesGroupHeaderState(input: NsPreferencesGroupInput): PreferencesGroupHeaderState {
    return derivePreferencesGroupHeader({ ...input, useMarkup: false });
}

/**
 * `visibility` / `className` a group must apply for the given inputs. `'collapse'`
 * rather than `'hidden'`: a hidden NS view still occupies its space, which would leave
 * the header's padding behind on a group that has no header.
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
