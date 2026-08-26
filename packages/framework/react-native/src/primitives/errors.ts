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

/** A primitive, prop or combination this layer cannot answer for, and why. */
export class PrimitiveError extends Error {
    override readonly name = 'PrimitiveError';
    /** The primitive the refusal is about — `View`, `Text`, … */
    readonly primitive: string;
    /** The prop, utility or combination that caused it. Empty when it is the primitive itself. */
    readonly subject: string;

    constructor(primitive: string, subject: string, detail: string) {
        super(`@gjsify/react-native: <${primitive}>${subject === '' ? '' : ` ${subject}`} — ${detail}`);
        this.primitive = primitive;
        this.subject = subject;
    }
}
