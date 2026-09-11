// THE SIZE the GNOME UI is drawn at — the half of the font problem that shipping faces does not
// fix.
//
// WHAT WAS MEASURED, on Windows 11 / GTK 4.22.4 with the published 0.50.0 runtime bundle:
//
//   gtk-font-name      "Segoe UI 9"          ascent+descent 16.0 px
//   pango resolution   96 dpi
//   monitor            1600x1200, scale 1
//
// GTK on Windows takes the system UI font from the shell, and Windows' is **9 pt**. GNOME's is
// **11 pt** — that is the size the Adwaita stylesheet's spacing, line heights and control metrics
// are drawn against. At 96 dpi the difference is 12 px against ~14.7 px, about 20 % smaller, which
// is exactly the "the font is a bit small" a user reports without being able to name.
//
// THE POLICY, and it is a choice rather than a derivation. Two things are wrong at once on that
// host: the FAMILY is not a GNOME one, and the SIZE is not GNOME's. This corrects the SIZE and
// leaves the FAMILY alone.
//
//   • A Windows user's shell font is a legitimate preference, and Segoe UI at 11 pt is a GNOME
//     app that respects its host. Segoe UI at 9 pt is not — it is Adwaita drawn at the wrong
//     scale, which is a rendering defect rather than a preference.
//   • The reverse choice — forcing `Adwaita Sans 11` — is defensible and deliberately not the
//     default: it overrides a setting the user may have chosen (Windows' own text-size setting
//     moves `gtk-font-name`), and it would take effect on hosts where the bundled face never
//     arrived, replacing one substitution with another. `applyGnomeUiFont({ family })` is there
//     for an application that wants it.
//   • RAISE ONLY. A host already at 11 pt or above is left untouched, so a user who enlarged
//     their system text does not get it shrunk back to GNOME's default by a toolkit.
//
// Split from `fonts.ts` and free of any GI import so the DECISION runs as a unit test on node,
// with no display, no font map and no Gtk.Settings — the same split `font-dir.ts` makes for the
// directory question, and for the same reason: the part that can only be exercised on a real GTK
// should be the part that has nothing left to decide.

/**
 * The point size GNOME's interface is designed at — `org.gnome.desktop.interface font-name`'s
 * default has been `Cantarell 11` and is now `Adwaita Sans 11`.
 */
export const GNOME_UI_FONT_POINT_SIZE = 11;

/** What {@link planUiFont} decided, and why. */
export interface UiFontPlan {
    /** The `gtk-font-name` to set, or `undefined` when nothing should change. */
    readonly next: string | undefined;
    /**
     * `raised` — the host's size was below GNOME's and is corrected;
     * `family` — a family override was asked for and applied;
     * `kept` — the host is already at or above the target size and nothing was asked for;
     * `unparsed` — the current value carries no point size this can reason about.
     */
    readonly kind: 'raised' | 'family' | 'kept' | 'unparsed';
    /** The family in effect after the plan, for reporting. */
    readonly family: string | undefined;
    /** The point size in effect after the plan, for reporting. */
    readonly size: number | undefined;
}

export interface PlanUiFontOptions {
    /** Target point size. Defaults to {@link GNOME_UI_FONT_POINT_SIZE}. */
    readonly size?: number;
    /** Force this family too. Off by default — see the policy note at the top of this file. */
    readonly family?: string;
}

/**
 * Decide the `gtk-font-name` for a host whose current one is `current`.
 *
 * PARSED HERE RATHER THAN THROUGH `Pango.FontDescription.from_string`, which is the obvious
 * tool and the wrong one for this job: that parser NEVER fails — an unparsable tail becomes part
 * of the family — so every malformed value would come back as a description with size 0, and
 * "this host has no size I can read" would be indistinguishable from "this host asked for 0 pt".
 * The distinction is the whole point of the `unparsed` arm: a value this cannot read is left
 * exactly as it is, because silently rewriting a setting one does not understand is worse than
 * a font that is 2 pt small.
 *
 * The grammar accepted is the one `gtk-font-name` actually carries: a family, optional style
 * words, then a trailing size — `Segoe UI 9`, `Cantarell Bold 11`, `Adwaita Sans 11.5`. A
 * fractional size is kept fractional; Pango's own `to_string` emits those.
 */
export function planUiFont(current: string | undefined, options: PlanUiFontOptions = {}): UiFontPlan {
    const target = options.size ?? GNOME_UI_FONT_POINT_SIZE;
    const text = (current ?? '').trim();
    // A trailing decimal number, with at least one non-space character of family before it.
    const match = /^(.*\S)\s+(\d+(?:\.\d+)?)$/.exec(text);
    if (match === null) {
        return { next: undefined, kind: 'unparsed', family: text === '' ? undefined : text, size: undefined };
    }
    const head = match[1] as string;
    const size = Number.parseFloat(match[2] as string);
    const family = options.family ?? head;
    const nextSize = size < target ? target : size;
    if (family === head && nextSize === size) {
        return { next: undefined, kind: 'kept', family: head, size };
    }
    // `String` is the right serialiser and not a shortcut: it writes `11` for an integer and
    // keeps `11.5` fractional, which is exactly the spelling `gtk-font-name` carries.
    return {
        next: `${family} ${String(nextSize)}`,
        kind: options.family !== undefined && options.family !== head ? 'family' : 'raised',
        family,
        size: nextSize,
    };
}
