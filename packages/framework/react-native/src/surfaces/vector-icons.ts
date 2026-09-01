// `@expo/vector-icons` — `Ionicons`, onto the icon theme's own vocabulary.
//
// AN ICON FONT IS THE WRONG SHAPE FOR A DESKTOP, and that is what makes this a real
// mapping rather than a shim. `@expo/vector-icons` renders a CODEPOINT from a bundled
// font file; a GTK icon is an SVG the icon theme owns, addressed by NAME, resolved at
// the scale factor of the surface it lands on and recoloured from CSS. So the useful
// thing to build is not "load their font" but "translate their vocabulary" — which is
// reusable (the same mechanism takes `MaterialIcons` next, as a table and its
// measurement rather than new code) and gives an application the desktop's icons,
// which is what a desktop user recognises.
//
// THE ONE DESIGN DECISION: an unmapped name is a NAMED REFUSAL. GTK draws
// `image-missing` for an icon name it does not have and reports nothing — the exit-0
// failure mode — so a table that silently fell through would put a broken-image glyph
// in a shipped screen. `icon-map.ts` holds the table, its two provenances, and the
// refusal that lists what is mapped.
//
// `size` and `color` are the two props every one of these components takes, and both
// go where the primitive table says: `size` is `Gtk.Image:pixel-size`, `color` joins
// the paint half of the style partition, which is how a symbolic icon is tinted.

import { createElement, type ReactElement } from 'react';

import { Icon, type IconProps } from '../components.js';
import { ioniconName } from './icon-map.js';

export interface IoniconsProps extends Omit<IconProps, 'name'> {
    /** An Ionicons name — `home`, `chevron-forward`, `checkmark-circle`. */
    name: string;
}

/**
 * An Ionicons name, drawn as the icon theme's own symbolic icon.
 *
 * The translation happens HERE and not in L2: `primitives/table.ts`' `Icon` row takes
 * a GTK icon name as a plain string, so the primitive stays free of any third-party
 * library's spelling and the next glyph vocabulary is a second table.
 */
export function Ionicons({ name, ...rest }: IoniconsProps): ReactElement {
    return createElement(Icon, { ...rest, name: ioniconName(name) });
}

// The map itself is NOT re-exported. This module mirrors `@expo/vector-icons`' export
// surface, and the ADR 0036 gate judges an import against the table — a name upstream
// does not have would be refused there, correctly, so exporting it would advertise
// something the gate then refuses. `surfaces/icon-map.ts` is the import for tooling.

export * from '../generated/unsupported-vector-icons.js';
