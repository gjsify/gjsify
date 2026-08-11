// Shortcut-label rendering for NativeScript — the pure half.
//
// The grammar, the keycap order and the label lookup are core's
// `parseShortcutLabel` (ADR 0004). What is NativeScript-shaped is the TREE, and
// three of its edges are decisions rather than transcription:
//
//   1. NO `gap`. GTK's `border-spacing: 6px` applies at BOTH levels (between the
//      boxes and between the keycaps inside one). NS has no `gap` and its CSS
//      subset has no `:first-child`, so the 6px is a margin carried by a class,
//      and WHICH nodes carry it is decided here rather than by a selector.
//   2. NO NESTED TEXT. The `L`/`R` marker of a sided modifier rides inside its
//      keycap (a `<sub>` on the web) and an NS `Label` cannot contain another
//      Label, so a keycap is a `StackLayout` holding a text Label. It keeps that
//      shape when there is no marker too: one keycap shape means one theme rule
//      and one serialisation, and the second view costs nothing next to a
//      per-case shape the theme would have to style twice.
//   3. THE APPLE GLYPHS ARE REACHABLE HERE. libadwaita picks them with
//      `#ifdef __APPLE__`. The browser element cannot know its platform and
//      leaves the option at its default; a NativeScript app CAN (`isIOS`), so
//      this renderer resolves it — the two `platform: 'apple'` vectors are
//      drivable on this target even though they are not on the web one.
//
// Returns a DESCRIPTION of the tree rather than views, because
// `adw-shortcut-label.ts` `extends StackLayout` and evaluates the bare
// `@nativescript/core` specifier at module eval — it is unresolvable off-device,
// and a description is what a spec suite can hold against
// `SHORTCUT_LABEL_VECTORS`. The widget walks this with no structural decision of
// its own, so there is exactly one place a divergence can live.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss:33-58
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { parseShortcutLabel } from '@gjsify/adwaita-core';
import type { ShortcutKeycap, ShortcutLabelNode, ShortcutLabelOptions } from '@gjsify/adwaita-core';

/** The host `StackLayout`'s own class. */
export const SHORTCUT_LABEL_CLASS = 'adw-shortcut-label';
/** One combination — the keycaps of a single accelerator, drawn side by side. */
export const SHORTCUT_LABEL_KEYS_CLASS = 'adw-shortcut-label-keys';
/** One keycap. libadwaita's own name, so the theme rule reads like the SCSS. */
export const SHORTCUT_LABEL_KEYCAP_CLASS = 'keycap';
/** The text inside a keycap — the Label a `<span>`'s text node stands in for. */
export const SHORTCUT_LABEL_CAP_TEXT_CLASS = 'adw-shortcut-label-cap-text';
/** The `L`/`R` marker of a sided modifier key, inside the cap it belongs to. */
export const SHORTCUT_LABEL_SIDE_CLASS = 'adw-shortcut-label-side';
/** `dim_label` — the separators, and the half the placeholder shares with them. */
export const SHORTCUT_LABEL_DIMMED_CLASS = 'dimmed';
/** The disabled placeholder, so a consumer can style it without counting children. */
export const SHORTCUT_LABEL_DISABLED_CLASS = 'adw-shortcut-label-disabled';
/** Carries the 6px GTK gets from `border-spacing` — every child but the first. */
export const SHORTCUT_LABEL_SPACED_CLASS = 'adw-shortcut-label-spaced';

/** A node of the view tree: `box` is a horizontal `StackLayout`, `label` a `Label`. */
export interface ShortcutLabelViewSpec {
    readonly kind: 'box' | 'label';
    /** The view's `className`, space-separated as NS holds it. */
    readonly className: string;
    /** A label's text; `''` for a box. */
    readonly text: string;
    /** A box's children; empty for a label. */
    readonly children: readonly ShortcutLabelViewSpec[];
    /** `style.direction` to pin, or `null` to inherit it. */
    readonly direction: 'ltr' | null;
}

/** What the widget rebuilds itself from. */
export interface ShortcutLabelRenderPlan {
    /** The host's children, in visual order. */
    readonly children: readonly ShortcutLabelViewSpec[];
    /** The name a screen reader announces for the whole label. */
    readonly accessibleLabel: string;
    /** The fragment that failed to parse, or `null` — `children` is the partial result. */
    readonly error: string | null;
}

const box = (
    className: string,
    children: readonly ShortcutLabelViewSpec[],
    direction: 'ltr' | null = null,
): ShortcutLabelViewSpec => ({ kind: 'box', className, text: '', children, direction });

const label = (className: string, text: string): ShortcutLabelViewSpec => ({
    kind: 'label',
    className,
    text,
    children: [],
    direction: null,
});

/** `className` plus the 6px spacing class, for every child after the first. */
const spaced = (className: string, index: number): string =>
    index === 0 ? className : `${className} ${SHORTCUT_LABEL_SPACED_CLASS}`;

/**
 * Which modifier glyph set to draw — `#ifdef __APPLE__` upstream, and on
 * NativeScript that is iOS. Split out so the choice is a value the suite can
 * drive both sides of, rather than a branch reachable only on a device.
 */
export function shortcutLabelPlatform(isIos: boolean): 'default' | 'apple' {
    return isIos ? 'apple' : 'default';
}

/**
 * The direction the sequence arrow follows.
 *
 * NS's `direction` is an INHERITED CSS property that resolves to `null` until
 * the view is attached, which is exactly when a widget built in its constructor
 * would read it — so the null case is LTR and the widget re-reads on load.
 */
export function shortcutLabelDirection(direction: 'ltr' | 'rtl' | null | undefined): 'ltr' | 'rtl' {
    return direction === 'rtl' ? 'rtl' : 'ltr';
}

/** One keycap: the text, plus the side marker riding inside the same cap. */
function keycapSpec(key: ShortcutKeycap, index: number): ShortcutLabelViewSpec {
    const children = [label(SHORTCUT_LABEL_CAP_TEXT_CLASS, key.label)];
    if (key.sideMarker) children.push(label(SHORTCUT_LABEL_SIDE_CLASS, key.sideMarker));
    return box(spaced(SHORTCUT_LABEL_KEYCAP_CLASS, index), children);
}

function nodeSpec(node: ShortcutLabelNode, index: number): ShortcutLabelViewSpec {
    if (node.kind === 'disabled') {
        return label(spaced(`${SHORTCUT_LABEL_DIMMED_CLASS} ${SHORTCUT_LABEL_DISABLED_CLASS}`, index), node.text);
    }
    if (node.kind === 'separator') return label(spaced(SHORTCUT_LABEL_DIMMED_CLASS, index), node.text);

    // `gtk_widget_set_direction (box, GTK_TEXT_DIR_LTR)` (adw-shortcut-label.c:380):
    // the modifier order belongs to the shortcut, not to the surrounding text —
    // only the sequence ARROW flips, and core has already flipped it.
    return box(spaced(SHORTCUT_LABEL_KEYS_CLASS, index), node.keys.map(keycapSpec), 'ltr');
}

/** The view tree for one accelerator, with the accessible name and any parse error. */
export function shortcutLabelRenderPlan(
    accelerator: string,
    options: ShortcutLabelOptions = {},
): ShortcutLabelRenderPlan {
    const { nodes, accessibleLabel, error } = parseShortcutLabel(accelerator, options);
    return { children: nodes.map(nodeSpec), accessibleLabel, error };
}
