// `Gtk.Align` on a target that has no GI — the value table, and what each member means to
// NativeScript.
//
// ADR 0034 § 4: for an enum the convergent spelling is the NICK, because a nick is a string
// and a string is the only thing that survives an XML attribute. The CONSTANT is a second
// accepted spelling, so a snippet ported off GJS keeps working, and it needs a value table
// because there is no typelib here to read one from.
//
// THE VALUES ARE NOT THE POSITIONS, AND THAT IS WHY THIS FILE DERIVES THEM RATHER THAN
// LISTING THEM. `GTK_ALIGN_BASELINE` was deprecated in GTK 4.12 and made an ALIAS of
// `GTK_ALIGN_BASELINE_FILL`, so the two share the value 4 and every member after them sits
// one below its position. Both obvious ways to get the numbers in-repo therefore disagree
// with GTK on 2 of the 7 members — MEASURED 2026-09-05:
//
//   · the position in `GtkAlignNick` (`packages/framework/gtk-host/src/generated/props.ts`)
//     gives baseline 5 and baseline-center 6;
//   · `@girs/gtk-4.0@4.1.0` declares `enum Align` with no initialisers, so TypeScript's
//     implicit numbering gives the same 5 and 6 — and ADR 0034 § Context already records
//     that this is a declaration-only enum which emits nothing, the runtime values coming
//     from the typelib;
//   · `Gtk-4.0.gir` (`gtk4`, org.gnome.Sdk/50) and the installed typelib read through
//     `gjs -m` both give baseline 4 and baseline-center 5.
//
// So exactly ONE GIR fact is authored here — {@link GTK_ALIGN_ALIASES} — and the seven
// numbers fall out of it. Seven hand-typed integers would have been seven chances to be
// wrong about a thing no gate in this repository can look up; one alias is one, and it
// carries the deprecation that caused it.
//
// WHAT THE GATE CAN AND CANNOT HOLD. `scripts/check-nativescript-xml-doors.mjs` holds the
// nick list against `GtkAlignNick`, holds each alias against the member set, and holds the
// per-axis mapping against a printed refusal for every member with no counterpart. It
// does not yet hold the aliasing itself. That is now a gap rather than an impossibility:
// #1585 landed `@gjsify/gtk-host`'s `generated/enum-values.mts`, a committed in-repo table
// that names `GtkAlign.baseline` 4 alongside `baseline-fill` 4 in `ENUM_ALIASES`, and a
// committed file is reachable from a `checkout` + `setup-node` job with no `@girs` install.
// Reading it from here retires this declaration; until then the pin is
// `construct-props.spec.ts`, which asserts the seven derived numbers literally, so the table
// cannot drift without a test being edited to say so.
//
// Reference: refs/gtk gtk/gtkenums.h (GtkAlign)

/**
 * Every `Gtk.Align` member, in GIR declaration order.
 *
 * Held against `GtkAlignNick` in `packages/framework/gtk-host/src/generated/props.ts` —
 * in-repo, GIR-derived, emitted by a generator that has never heard of this port — so this
 * array is a copy that cannot drift rather than a second source.
 */
export const GTK_ALIGN_NICKS = [
    'fill',
    'start',
    'end',
    'center',
    'baseline-fill',
    'baseline',
    'baseline-center',
] as const;

/**
 * The members that are a SECOND NAME for another member rather than a value of their own,
 * as alias to the member it stands for.
 *
 * The single authored GIR fact in this file. An alias takes its target's number and does
 * not consume one, which is what shifts every later member below its position.
 *
 * `baseline` is here because GTK 4.12 deprecated `GTK_ALIGN_BASELINE` in favour of
 * `GTK_ALIGN_BASELINE_FILL` and gave the new name the SAME value — "a different name for
 * `GTK_ALIGN_BASELINE`", as the GIR doc on `baseline-fill` puts it — rather than adding a
 * member. That is the whole of the off-by-one below it.
 */
export const GTK_ALIGN_ALIASES: Readonly<Record<string, string>> = {
    baseline: 'baseline-fill',
};

/**
 * Every `Gtk.Align` member, nick to constant.
 *
 * Six distinct values across seven nicks: `baseline` and `baseline-fill` are the same
 * member under two names.
 */
export const GTK_ALIGN: Readonly<Record<string, number>> = (() => {
    const values: Record<string, number> = {};
    let next = 0;
    for (const nick of GTK_ALIGN_NICKS) {
        const target = GTK_ALIGN_ALIASES[nick];
        if (target !== undefined && target in values) {
            values[nick] = values[target];
            continue;
        }
        values[nick] = next;
        next += 1;
    }
    return values;
})();

/**
 * `Gtk.Align` to `View.horizontalAlignment`.
 *
 * FOUR OF THE SEVEN MEMBERS MAP, not two. ADR 0034 § Context measured NativeScript's
 * horizontal vocabulary as `'left' | 'center' | 'right' | 'stretch'` and concluded that
 * `start` and `end` have no counterpart; `@nativescript/core` 9.0.21-next.15 declares
 * `'start' | 'left' | 'center' | 'right' | 'end' | 'stretch'` (`core-types/index.ts:127`),
 * and its shared layout pass resolves `start`/`end` against the view's own `direction`
 * (`ui/core/view/view-helper/view-helper-common.ts:98-111`) — the same direction-relative
 * meaning GTK gives them. The remainder is the three baselines and nothing else.
 */
export const NS_HORIZONTAL_ALIGNMENT: Readonly<Record<string, string>> = {
    fill: 'stretch',
    start: 'start',
    end: 'end',
    center: 'center',
};

/**
 * `Gtk.Align` to `View.verticalAlignment`.
 *
 * NativeScript's vertical vocabulary is `'top' | 'middle' | 'bottom' | 'stretch'` — no
 * `center` and no `start`/`end`, so all four mapped members are genuinely translated here
 * rather than passed through. GTK's vertical `start`/`end` are not direction-relative
 * (`gtkenums.h` scopes that to the horizontal context), which is why they can be top and
 * bottom without asking the view which way its text runs.
 */
export const NS_VERTICAL_ALIGNMENT: Readonly<Record<string, string>> = {
    fill: 'stretch',
    start: 'top',
    end: 'bottom',
    center: 'middle',
};

/**
 * Why a `Gtk.Align` member has no NativeScript counterpart on either axis.
 *
 * ADR 0034 § 1's declared remainder: a member that is absent from both maps and absent from
 * here is a silent omission, and the gate fails on it.
 */
export const GTK_ALIGN_REFUSALS: Readonly<Record<string, string>> = {
    'baseline-fill':
        'NativeScript aligns boxes, not text baselines — no layout in @nativescript/core reads a baseline, ' +
        'and there is no property to route this to.',
    baseline: 'the deprecated alias of baseline-fill, refused for the same reason and by the same absence.',
    'baseline-center':
        'baseline alignment again, and NativeScript has no way to centre on a baseline it does not measure.',
};

/** The refusal reason for `nick`, for an error message that says why and not only no. */
export function gtkAlignRefusal(nick: string): string {
    return GTK_ALIGN_REFUSALS[nick] ?? 'it is not a member this surface maps.';
}
