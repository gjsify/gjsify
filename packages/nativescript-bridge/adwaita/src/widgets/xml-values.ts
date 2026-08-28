// What an XML attribute is worth once NativeScript has handed it over — the one
// rule every non-string property in this package shares.
//
// WHY IT EXISTS
//
// NativeScript's XML Builder assigns an attribute with `instance[name] = value` and
// NOTHING else (`ui/builder/component-builder`'s `setPropertyValue`, final `else`
// branch). Only a NativeScript `Property` object carries a `valueConverter`, and the
// widgets here are plain classes with plain accessors, so `size="96"` arrives as the
// STRING `'96'` and `open="false"` as the STRING `'false'`.
//
// Both then fail SILENTLY, in opposite directions, and the gallery probe measured
// all four shapes on an Android emulator, 2026-08-28:
//
//   · `Number.isFinite('96')` is false, so a validating setter substituted its
//     DEFAULT — `<AdwAvatar size="96">` rendered at 48 and nothing said so.
//   · A state machine that coerces with `Number(v) || 0` took `'3'` to 0 —
//     `<AdwSpinRow value="3" min="1" max="20">` came out 0/0/0.
//   · `!!'false'` is TRUE, so `<AdwPasswordEntryRow revealed="false">` revealed the
//     password and `<AdwAboutDialog open="false">` opened the dialog on load.
//   · `'true'` happens to be truthy, so the boolean case that WORKS works by
//     accident — which is why this is a rule and not four repairs.
//
// A widget property is authored in three notations in this repo (TypeScript, and
// now XML, and a story control), and only XML is a string. Doing the conversion in
// the SETTER rather than at some XML boundary is what keeps the other two callers
// unchanged: a `number` in, the same `number` out.
//
// Kept free of `@nativescript/core` for the same reason `builder-slots.ts` is: the
// spec suite drives it off-device, where the widget classes cannot even be imported.

/**
 * An attribute as a finite number, or `fallback` when it is not one.
 *
 * A string is trimmed and parsed; empty is NOT zero (`Number('')` is 0, which is how
 * a missing value becomes a real setting). `NaN` and `Infinity` are refused, so a
 * caller can keep validating a RANGE without also having to re-check the type.
 */
export function xmlNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    if (text === '') return fallback;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * An attribute as a boolean.
 *
 * Only the two spellings XML can mean are accepted — anything else takes the
 * `fallback` rather than the truthiness of the string, because truthiness is exactly
 * what made `revealed="false"` reveal. `'True'`/`'FALSE'` are accepted too: XML
 * attribute VALUES are not case-normalised by any parser, and a template that means
 * one of the two booleans should not depend on which case its author typed.
 */
export function xmlBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return fallback;
}
