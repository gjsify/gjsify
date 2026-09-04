// The one error L2 throws, in its own module because five modules throw it.
//
// Same shape and the same reason as `@gjsify/gtk-host/style`'s
// `UnknownUtilityError`, one layer up: a named class so a consumer can tell "this
// layer does not answer for that" from a bug in their own code, and a message that
// names WHAT arrived, WHY GTK cannot take it, and WHAT to write instead. A bare
// `Error` makes the first impossible and the third optional.
//
// It is a SEPARATE class from `UnknownUtilityError` rather than a re-export,
// because the two answer different questions and a caller catching one should not
// silently catch the other: `UnknownUtilityError` means "this utility or property
// is not in the style vocabulary", while this one means "the primitive, its prop,
// or the combination has no GTK answer". A `<Text numberOfLines>` refusal and a
// `bg-nonsuch` refusal are not the same defect and do not have the same fix.

/**
 * The sentence, without throwing it.
 *
 * `@gjsify/react-native/prop-table` has to hand a consumer the message a render WOULD
 * have thrown, and ADR 0039 § 1 says it is the same string rather than a paraphrase.
 * Two template literals that happen to agree are not that: the format is here once and
 * both the throw and the static answer are built from it.
 */
export const primitiveErrorMessage = (primitive: string, subject: string, detail: string): string =>
    `@gjsify/react-native: <${primitive}>${subject === '' ? '' : ` ${subject}`} — ${detail}`;

/**
 * How a VALUE reads inside a subject — `prop "accessibilityRole" = "keyboardkey"`.
 *
 * Here rather than in `resolve.ts`, where it started, because the per-value refusals
 * are answerable statically now (ADR 0039 § Amendment, #1555) and `prop-table.ts` has
 * to build the same subject the throw does. Two formatters that happen to agree are
 * not one string.
 */
export const describeValue = (value: unknown): string =>
    typeof value === 'string'
        ? `"${value}"`
        : value !== null && typeof value === 'object'
          ? Object.prototype.toString.call(value)
          : String(value);

/** A primitive, prop or combination this layer cannot answer for, and why. */
export class PrimitiveError extends Error {
    override readonly name = 'PrimitiveError';
    /** The primitive the refusal is about — `View`, `Text`, … */
    readonly primitive: string;
    /** The prop, utility or combination that caused it. Empty when it is the primitive itself. */
    readonly subject: string;

    constructor(primitive: string, subject: string, detail: string) {
        super(primitiveErrorMessage(primitive, subject, detail));
        this.primitive = primitive;
        this.subject = subject;
    }
}
