// Adwaita row + window-title state for NativeScript — the pure half.
//
// Serves FOUR widgets jointly (`adw-action-row.ts`, `adw-switch-row.ts`,
// `adw-button-row.ts`, `adw-window-title.ts`) because in libadwaita they share
// one derivation: the `string_is_not_empty` label-visibility closure declared in
// `adw-action-row.c:112-117`, re-declared verbatim in `adw-button-row.c:92-97`
// and inlined by hand in `adw-window-title.c:207-208`. The derivation itself is
// HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004), shared with
// `@gjsify/adwaita-web` and pinned by the conformance vectors.
//
// What this module adds is only how a state becomes NativeScript: NS has no
// `hidden` attribute, it has `View.visibility`, and its "sensitive" flag is
// spelled `isUserInteractionEnabled`.
//
// The port this replaces derived the SUBTITLE half only, and expressed it by
// adding and removing the subtitle `Label` from the tree — so a row with an
// empty TITLE kept a full-height blank title label, and a window title with only
// a subtitle reserved a line above it. `Adw.ActionRow:activatable-widget` and
// `Adw.ButtonRow:end-icon-name` were absent entirely.
//
// This module imports only TYPES from `@nativescript/core` — like `icon-path.ts`,
// `row-press.ts` and `preferences-group-state.ts` — so it carries no runtime
// `@nativescript/core` value import and loads, and is unit-testable, off-device.
// `adw-action-row.ts` cannot serve that role: it `extends GridLayout`, which
// evaluates the bare specifier at module-eval and is unresolvable on GJS/Node.
//
// Reference: refs/libadwaita/src/adw-action-row.c, adw-action-row.ui
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/adw-button-row.c, adw-button-row.ui
// Reference: refs/libadwaita/src/adw-window-title.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ActionRowState,
    ButtonRowState,
    SwitchRowState,
    WindowTitleState,
    deriveRowLabels,
} from '@gjsify/adwaita-core';
import type { AdwRowLabelInput, AdwRowLabels, ButtonRowRenderState } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

export { ActionRowState, ButtonRowState, SwitchRowState, WindowTitleState };
export type { AdwRowLabels, ButtonRowRenderState };

/** The two `View.visibility` values an Adwaita row ever assigns. */
export type NsVisibility = 'visible' | 'collapse';

/**
 * `visibility` for a shown/hidden view.
 *
 * `'collapse'` rather than `'hidden'`: a hidden NS view still occupies its
 * space, so an empty subtitle would leave its whole line behind — which is the
 * one thing the binding exists to prevent.
 */
export function nsVisibility(shown: boolean): NsVisibility {
    return shown ? 'visible' : 'collapse';
}

/** The NativeScript form of a title/subtitle label pair. */
export interface NsRowLabelVisuals {
    /** Text for the title `Label`. */
    title: string;
    /** `visibility` for the title `Label`. */
    titleVisibility: NsVisibility;
    /** Text for the subtitle `Label`. */
    subtitle: string;
    /** `visibility` for the subtitle `Label`. */
    subtitleVisibility: NsVisibility;
}

/** What a row must apply to its two labels for the given title/subtitle. */
export function rowLabelVisuals(input: AdwRowLabelInput): NsRowLabelVisuals {
    return toLabelVisuals(deriveRowLabels(input));
}

/** The same mapping, for a state object that already holds the derivation. */
export function toLabelVisuals(labels: AdwRowLabels): NsRowLabelVisuals {
    return {
        title: labels.title,
        titleVisibility: nsVisibility(labels.titleVisible),
        subtitle: labels.subtitle,
        subtitleVisibility: nsVisibility(labels.subtitleVisible),
    };
}

/** The NativeScript form of an `Adw.ButtonRow`'s two icons. */
export interface NsButtonRowIconVisuals {
    /** Payload for the leading icon. */
    startIcon: string;
    /** `visibility` for the leading icon. */
    startIconVisibility: NsVisibility;
    /** Payload for the trailing icon. */
    endIcon: string;
    /** `visibility` for the trailing icon. */
    endIconVisibility: NsVisibility;
}

/**
 * What a button row must apply to its two icons.
 *
 * The TITLE half of `ButtonRowRenderState` is deliberately not mapped here: the
 * NativeScript button row reuses the action row's title `Label` and therefore
 * its title state, so routing the title through a second state object would give
 * one label two sources of truth — the exact shape this package exists to
 * remove. {@link rowLabelVisuals} paints it.
 *
 * NOTE ON THE ICON PAYLOAD: GTK stores an icon NAME and resolves it through the
 * icon theme; this port stores the symbolic SVG source itself, because `AdwIcon`
 * renders SVG rather than looking a name up. `ButtonRowState` is indifferent —
 * the rule it applies is `string_is_not_empty`, which reads the first byte and
 * does not care what the string means.
 */
export function buttonRowIconVisuals(state: ButtonRowRenderState): NsButtonRowIconVisuals {
    return {
        startIcon: state.startIconName,
        startIconVisibility: nsVisibility(state.startIconVisible),
        endIcon: state.endIconName,
        endIconVisibility: nsVisibility(state.endIconVisible),
    };
}

/**
 * Whether a view is "sensitive" in the sense the `activatable-widget` binding
 * reads (`GtkWidget:sensitive` → `GtkListBoxRow:activatable`,
 * adw-action-row.c:729-732).
 *
 * NativeScript has no `sensitive`; `isUserInteractionEnabled` is the nearest
 * flag it surfaces (its own docs map it to `gtk_widget_set_can_target`). The two
 * are not identical in GTK — an insensitive widget is also greyed out, a
 * can't-target one is not — but `isUserInteractionEnabled` is the only property
 * a NativeScript view has for "the user cannot operate this", so it is what the
 * binding reads here. A view that has never been touched reports `true`, which
 * is also GTK's default.
 */
export function isViewSensitive(view: Pick<View, 'isUserInteractionEnabled'> | null | undefined): boolean {
    if (!view) return true;
    return view.isUserInteractionEnabled !== false;
}
