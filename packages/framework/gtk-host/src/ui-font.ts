// THE SIZE the GNOME UI is drawn at — the half of the font problem that shipping faces does not
// fix.
//
// WHAT WAS MEASURED, on all three platforms, in the shipped artifact with the GTK closure from
// the bundle itself — and measured as `ascent + descent` in PIXELS out of `Pango.Font.get_metrics`,
// NOT as point sizes:
//
//   platform                gtk-font-name              pango    ascent+descent
//   Linux (GNOME, the ref)  "Adwaita Sans 11"          96 dpi   19.0 px
//   macOS 15.7.9 x86_64     ".AppleSystemUIFont 12"    96 dpi   18.8 px
//   Windows 11              "Segoe UI 9"               96 dpi   16.0 px
//
// POINTS ARE NOT COMPARABLE ACROSS PLATFORMS and reading them as if they were is how this note
// got its first number wrong. It said "about 20 % smaller", derived from the ratio 9:11 — the
// measured gap is 16.0 px against 19.0, i.e. **16 %**. macOS makes the trap concrete: its
// `gtk-xft-dpi` reports 72 while Pango renders at 96, so a points-only comparison draws the wrong
// conclusion there twice over.
//
// TWO THINGS FOLLOW, and both are measurements rather than arguments:
//
//   • THE GAP IS WINDOWS-ALONE. macOS at 18.8 px against GNOME's 19.0 is the same size to within
//     a rounding error; it has no size problem to fix.
//   • RAISE-ONLY IS RIGHT, and not merely defensive. macOS asks for 12 pt, so `size` leaves it
//     untouched (12 >= 11) — which is exactly the correct outcome on the one host we have that
//     tests the rule. A policy that set 11 unconditionally would have made macOS slightly WORSE.
//
// THREE STATES, AND THE CONSUMER PICKS. Two things can be wrong at once on that host — the FAMILY
// is not a GNOME one and the SIZE is not GNOME's — and which of them an application wants
// corrected is not something a toolkit can derive:
//
//   • `system`  — `gtk-font-name` is left exactly as the host set it. On Windows that is
//                 `Segoe UI 9`, size included. Somebody who deliberately set 9 pt keeps 9 pt.
//   • `size`    — keep the host's family, raise the size to GNOME's 11. RAISE ONLY, so a user who
//                 enlarged their system text is never shrunk back by a toolkit.
//   • `adwaita` — `Adwaita Sans 11`, so a GNOME application looks identical on every platform.
//
// `size` USED TO BE THE HARD-WIRED DEFAULT, and that was the unclear middle: it respects the
// system font only HALF — the family is honoured, the size overruled — so `system` was not
// expressible at all. Once anything applied the policy the original size was gone, and with it
// the one state a user who chose 9 pt actually wanted. Two clean states are more honest than one
// blended one, and a third that splits the difference is a legitimate choice as long as it is
// CHOSEN.
//
// WHICH MEANS THE ORIGINAL VALUE HAS TO BE REMEMBERED BEFORE ANYTHING WRITES IT. `system` is not
// "do not call the function": a consumer that offers these three in a preferences dialog must be
// able to go from `adwaita` BACK to `system` at runtime, and after the first write the host's own
// value is not reconstructible from anything on the system. `fonts.ts` captures it on first
// contact and `uiFontBaseline()` hands it back; this module takes it as an argument so the
// decision stays pure.
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

/**
 * The GNOME UI face, and the family `@gjsify/gtk-runtime-<target>` bundles.
 *
 * `Adwaita Sans` rather than `Cantarell`, which it succeeded: adwaita-fonts ships no Cantarell,
 * so naming it here would ask for a family no bundle carries.
 */
export const ADWAITA_UI_FONT_FAMILY = 'Adwaita Sans';

/** Which of the three states an application wants. See the note at the top of this file. */
export type UiFontPolicy = 'system' | 'size' | 'adwaita';

/**
 * The three states, in the order a preferences dialog should offer them.
 *
 * Exported so a consumer building that dialog enumerates them instead of hard-coding three
 * strings that then drift from this type — the settings UI and the policy are two copies of one
 * list otherwise, and only one of them is checked by the compiler.
 */
export const UI_FONT_POLICIES: readonly UiFontPolicy[] = ['system', 'size', 'adwaita'];

/** The reasons a plan gives. See {@link UiFontPlan.kind}. */
export type UiFontPlanKind = 'raised' | 'family' | 'restored' | 'kept' | 'unparsed' | 'uninitialised';

/** What {@link planUiFont} or {@link planUiFontPolicy} decided, and why. */
export interface UiFontPlan {
    /** The `gtk-font-name` to set, or `undefined` when nothing should change. */
    readonly next: string | undefined;
    /**
     * `raised` — the host's size was below GNOME's and is corrected;
     * `family` — a family override was asked for and applied;
     * `restored` — the host's ORIGINAL value is being put back (the `system` policy);
     * `kept` — nothing to do: the setting already says what the policy wants;
     * `unparsed` — the current value carries no point size this can reason about;
     * `uninitialised` — there was no `Gtk.Settings` to act on, so the policy did NOT run.
     *
     * THE LAST TWO ARE NOT THE SAME ANSWER and used to be reported as one. Both leave
     * `gtk-font-name` alone, which is why collapsing them looked harmless — but `unparsed` means
     * the policy ran and correctly declined, while `uninitialised` means it never ran at all. A
     * consumer that calls this before `Gtk.init()` gets a plan that reads exactly like a host
     * that needed nothing, so the setting it built is dead and its own log line says so in words
     * that look fine. Learn6502 shipped that: `ui-font: policy=size -> unparsed (unchanged)` on
     * macOS AND Windows, from a call at module scope, with the size correction never applied on
     * the one platform it exists for.
     */
    readonly kind: UiFontPlanKind;
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

export interface PlanUiFontPolicyOptions extends PlanUiFontOptions {
    /** Which of the three states to plan for. */
    readonly policy: UiFontPolicy;
    /** `gtk-font-name` as it stands right now. */
    readonly current: string | undefined;
    /**
     * `gtk-font-name` as this PROCESS first found it, before anything wrote to it.
     *
     * Only the `system` policy reads it, and without it that policy cannot exist: once a value
     * has been overwritten the host's own is not recoverable — not from GTK, not from the
     * display, not from GSettings (Windows has none, and on Linux the setting a user actually
     * chose may itself have been a session-level override). `fonts.ts` captures it on first
     * contact; `uiFontBaseline()` is the reader.
     */
    readonly baseline?: string | undefined;
}

/**
 * Decide `gtk-font-name` for one of the three {@link UiFontPolicy} states.
 *
 * Pure, like {@link planUiFont} it builds on, so all three states and the way back are exercised
 * as unit tests on node with no display and no `Gtk.Settings`. {@link applyUiFontPolicy} in
 * `fonts.ts` is the half that writes.
 */
export function planUiFontPolicy(options: PlanUiFontPolicyOptions): UiFontPlan {
    const { policy, current, baseline } = options;

    if (policy === 'system') {
        // RESTORE, not "reason about". The baseline is a value this process READ off the host, so
        // it is put back verbatim — parsing it would invent a second opinion about a string GTK
        // itself produced, and an unparsable host value (the `unparsed` arm) must still be
        // restorable. That asymmetry is deliberate: this policy's job is to undo the others.
        if (baseline === undefined) {
            // Nothing was ever captured, so there is nothing to go back to. Reported as `kept`
            // rather than as a failure: a host whose `gtk-font-name` was unset is a real state,
            // and "leave it alone" is the correct answer for it.
            return { next: undefined, kind: 'kept', family: undefined, size: undefined };
        }
        if (baseline === current) return describe(baseline, 'kept');
        return describe(baseline, 'restored');
    }

    // `family` is FORWARDED here, and dropping it was a silent hole: `PlanUiFontOptions.family`
    // is in the option type of every policy (`ApplyUiFontPolicyOptions` extends it), so
    // `applyUiFontPolicy({ policy: 'size', family: 'Inter' })` type-checks, reads as "the host's
    // size rule, my face" — and used to write the HOST's family. `planUiFont` has always honoured
    // the option; only this hand-off dropped it, which is the one way an option can be wrong that
    // neither the compiler nor a warning can reach.
    if (policy === 'size') return planUiFont(current, { size: options.size, family: options.family });

    // `adwaita` — the GNOME font at GNOME's size, the same on every platform. NOT raise-only and
    // NOT dependent on the current value: that is the whole point of the state, and a consumer
    // who wants the host's size with the GNOME face passes `size` explicitly.
    //
    // It therefore works from an UNPARSED current value too, where `planUiFont` correctly refuses
    // to act: there is nothing to preserve here, so there is nothing a malformed value can spoil.
    const family = options.family ?? ADWAITA_UI_FONT_FAMILY;
    const size = options.size ?? GNOME_UI_FONT_POINT_SIZE;
    const next = `${family} ${String(size)}`;
    if (next === (current ?? '').trim()) return { next: undefined, kind: 'kept', family, size };
    return { next, kind: 'family', family, size };
}

/** Split a `gtk-font-name` for REPORTING only — the value itself is passed through untouched. */
function describe(value: string, kind: UiFontPlanKind): UiFontPlan {
    const match = /^(.*\S)\s+(\d+(?:\.\d+)?)$/.exec(value.trim());
    return {
        next: kind === 'kept' ? undefined : value,
        kind,
        family: match ? (match[1] as string) : value.trim() || undefined,
        size: match ? Number.parseFloat(match[2] as string) : undefined,
    };
}
