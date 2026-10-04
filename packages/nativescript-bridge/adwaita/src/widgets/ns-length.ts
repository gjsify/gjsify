// A NativeScript length, read as a number of DIPs.
//
// WHY A READER AT ALL. `View.marginLeft`, `minWidth` and their siblings are CSS properties
// whose `Style` getter answers the PARSED value, not what was written: `{ value: 0, unit: 'px' }`
// for the `zeroLength` default and `{ value: 12, unit: 'dip' }` after `marginLeft = 12`
// (`ui/styling/style-properties.ts`, `CoreTypes.LengthType`). `Number(view.marginLeft)` is
// `NaN` for either, which `|| 0` turns into a silent zero — so every reader that took a
// margin or a minimum back as a number read nothing on a device while the off-device double,
// which stores the number it was given, agreed with the test. Reading through this keeps
// both shapes working, and the double starts its minimums as the object a device answers.
//
// No `@nativescript/core` import, so specs reach it off-device.

/** A length as NativeScript hands it back: a number, a CSS-ish string, or `{ value, unit }`. */
export type NsLength = number | string | { value: number; unit?: string } | null | undefined;

/**
 * The number of DIPs `length` is, or `null` when it is not a plain length — `auto`, a
 * percentage, an unparseable string, nothing.
 */
export function lengthValue(length: NsLength): number | null {
    if (typeof length === 'object' && length !== null) {
        if (length.unit === '%') return null;
        return Number.isFinite(length.value) ? length.value : null;
    }
    if (typeof length === 'string') {
        const text = length.trim();
        if (text === '' || text.endsWith('%')) return null;
        const parsed = Number.parseFloat(text);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return typeof length === 'number' && Number.isFinite(length) ? length : null;
}
