// Wrap-box spacing for NativeScript — the pure half.
//
// `Adw.WrapBox` has no NativeScript counterpart for most of what it does: NS
// `WrapLayout` exposes exactly three knobs — `orientation`, `itemWidth`,
// `itemHeight` — so `justify`, `align` and `justify-last-line` have nowhere to
// land, and the line-breaking engine runs in native code that cannot be fed a
// decision. What DOES port is the spacing property contract, and the NS widget
// got all of it wrong: it defaulted to 6 DIPs where libadwaita defaults to 0
// (adw-wrap-box.c:285-287, :393-395), and it baked the spacing into each child's
// margin at add time, so changing the property afterwards did nothing at all
// while C forces a re-layout.
//
// Free of `@nativescript/core` imports — like `icon-path.ts`, `row-press.ts`,
// `chrome.ts` and `split-view-width.ts` — so the spec suite exercises the
// shipping code rather than a transcription of it. The widget class cannot serve
// that role: it `extends WrapLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * `Adw.WrapBox:child-spacing` / `:line-spacing` default, in DIPs.
 *
 * Both are `g_param_spec_int (…, 0, G_MAXINT, 0, …)` — adw-wrap-box.c:285-287
 * and :393-395. The port used to default both to 6, so identical markup was
 * looser on a phone than in the browser and an EMPTY wrap box was already 12
 * DIPs tall.
 */
export const DEFAULT_WRAP_BOX_SPACING = 0;

/**
 * Normalise one spacing property, the way `adw_wrap_box_set_child_spacing` does.
 *
 * C clamps a negative value to 0 before anything else happens
 * (adw-wrap-box.c:587-588, :927-928); the property's declared minimum is 0, so
 * without the clamp GObject would reject it outright. The non-numeric cases have
 * no C counterpart — the property is an `int` — and resolve to the default, so a
 * `NaN` can never reach a native layout pass.
 */
export function normalizeWrapBoxSpacing(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WRAP_BOX_SPACING;
    return parsed;
}

/**
 * Whether writing `next` over `current` is a change the widget must act on.
 *
 * The comparison happens AFTER the clamp (adw-wrap-box.c:592-593, :930-931), so
 * a negative value written over a spacing of 0 is an early return: it neither
 * reaches the layout nor notifies. On this port the same predicate decides
 * whether every child's margin is rewritten.
 */
export function wrapBoxSpacingChanges(current: number, next: unknown): boolean {
    return normalizeWrapBoxSpacing(next) !== normalizeWrapBoxSpacing(current);
}

/**
 * The uniform margin that gives an NS `WrapLayout` child its share of the gaps.
 *
 * `WrapLayout` has no gap property, so the inter-item spacing has to come out of
 * the children: half of it on each facing edge adds up to the whole gap between
 * any two neighbours. The margin string is NS's `top right bottom left`
 * shorthand.
 *
 * This is the one place the port is knowingly looser than libadwaita: the halves
 * on the OUTER edges are an inset `Adw.WrapBox` does not have. It is invisible
 * at the default spacing of 0 and bounded by half a gap otherwise, where the
 * alternative — negative margins on the container — is not something the NS CSS
 * subset can be trusted with.
 */
export function wrapBoxChildMargin(childSpacing: number, lineSpacing: number): string {
    const alongLine = normalizeWrapBoxSpacing(childSpacing) / 2;
    const betweenLines = normalizeWrapBoxSpacing(lineSpacing) / 2;
    return `${betweenLines} ${alongLine} ${betweenLines} ${alongLine}`;
}
