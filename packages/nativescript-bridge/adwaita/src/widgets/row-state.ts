// Adwaita row + window-title state for NativeScript — the pure half.
//
// Serves FOUR widgets jointly (`adw-action-row.ts`, `adw-switch-row.ts`,
// `adw-button-row.ts`, `adw-window-title.ts`) because in libadwaita they share one
// derivation: the `string_is_not_empty` label-visibility closure, declared in the
// action row and re-declared verbatim in the button row and window title. It is
// HEADLESS in `@gjsify/adwaita-core` (ADR 0004), shared with `@gjsify/adwaita-web`
// and pinned by the conformance vectors.
//
// What this module adds is only how a state becomes NativeScript: NS has no `hidden`
// attribute, it has `View.visibility`, and its "sensitive" flag is spelled
// `isUserInteractionEnabled`.
//
// TYPE-only imports from `@nativescript/core`, so this module is unit-testable
// off-device; `adw-action-row.ts` cannot be, because `extends GridLayout` evaluates
// the bare specifier at module-eval.
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
    adwaitaAccentBgColor,
    deriveRowLabels,
} from '@gjsify/adwaita-core';
import type { AdwAccentColorName, AdwRowLabelInput, AdwRowLabels, ButtonRowRenderState } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

export { ActionRowState, ButtonRowState, SwitchRowState, WindowTitleState };
export type { AdwRowLabels, ButtonRowRenderState };

/** The two `View.visibility` values an Adwaita row ever assigns. */
export type NsVisibility = 'visible' | 'collapse';

/**
 * `visibility` for a shown/hidden view. `'collapse'` rather than `'hidden'`: a hidden
 * NS view still occupies its space, so an empty subtitle would leave its whole line
 * behind — the one thing the binding exists to prevent.
 */
export function nsVisibility(shown: boolean): NsVisibility {
    return shown ? 'visible' : 'collapse';
}

/** The NativeScript form of a title/subtitle label pair. */
export interface NsRowLabelVisuals {
    title: string;
    titleVisibility: NsVisibility;
    subtitle: string;
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
    startIcon: string;
    startIconVisibility: NsVisibility;
    endIcon: string;
    endIconVisibility: NsVisibility;
}

/**
 * What a button row must apply to its two icons.
 *
 * The TITLE half of `ButtonRowRenderState` is deliberately not mapped here: the NS
 * button row reuses the action row's title `Label` and its title state, so routing the
 * title through a second state object would give one label two sources of truth.
 * {@link rowLabelVisuals} paints it.
 *
 * The icon payload is the symbolic SVG SOURCE, not GTK's icon name, because `GtkImage`
 * renders SVG rather than resolving a name. `ButtonRowState` is indifferent: its rule
 * is `string_is_not_empty`, which reads the first byte.
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
 * The fill an `AdwButtonRow`'s two symbolic icons take.
 *
 * `row.button` paints its title in `--accent-color` and libadwaita moves it with
 * the accent; here the icons are bitmaps rendered in a colour, so the value has
 * to be RESOLVED rather than inherited, and it has to be resolved again whenever
 * the accent changes. An explicit `pinned` colour wins — that is how a caller
 * gives a `destructive-action` row its red — and an empty pin means "follow",
 * not "freeze on the blue that was current when you asked".
 *
 * Lives here, in the module with no `@nativescript/core` value imports, because
 * `AdwButtonRow extends AdwActionRow extends GridLayout` and no spec can import
 * it off-device. A rule inside that class is a rule nothing checks.
 */
export function buttonRowIconColor(pinned: string | null | undefined, accent: AdwAccentColorName): string {
    return pinned || adwaitaAccentBgColor(accent);
}

/**
 * Whether a view is "sensitive" in the sense the `activatable-widget` binding reads
 * (`GtkWidget:sensitive` → `GtkListBoxRow:activatable`).
 *
 * NativeScript has no `sensitive`; `isUserInteractionEnabled` is the nearest flag it
 * surfaces (its own docs map it to `gtk_widget_set_can_target`). The two differ in GTK
 * — an insensitive widget is also greyed out, a can't-target one is not — but it is the
 * only property NS has for "the user cannot operate this". An untouched view reports
 * `true`, which is also GTK's default.
 */
export function isViewSensitive(view: Pick<View, 'isUserInteractionEnabled'> | null | undefined): boolean {
    if (!view) return true;
    return view.isUserInteractionEnabled !== false;
}
