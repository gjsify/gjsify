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
export const primitiveErrorMessage = (primitive: string, subject: string, detail: string, where = ''): string =>
    `@gjsify/react-native: <${primitive}>${subject === '' ? '' : ` ${subject}`} — ${detail}${
        where === '' ? '' : ` ${where}`
    }`;

/**
 * Which element, as far as the author's own words can say it.
 *
 * A refusal names a PRIMITIVE, and an application has many elements per primitive: a
 * consumer with twenty-five `<View className="flex-1 bg-canvas">` sites gets a message
 * that identifies none of them, and the stack is this package's own frames
 * (`usePlan`, `View`, `renderWithHooks`) with no component names in a bundle. Finding
 * the element took patching the built `lib/` to print `props.className`, which is not
 * a thing a consumer should have to do.
 *
 * TWO FIELDS, NOT A PROPS DUMP, and each is a deliberate choice. `className` is what
 * the author wrote and is how they will search for it; `testID` is the other thing
 * they chose the value of. `children` is a React tree, `style` can be a large object,
 * and `nativeID` is refused by name (`primitives/table.ts`) so it can never be
 * present.
 *
 * CAPPED, because a computed class list is ordinary authoring — 24 of the measured
 * application's `className=` sites are arrays or joins — and a refusal that scrolls is
 * a refusal nobody reads. An array is flattened the way `splitVariants` flattens one,
 * so the message shows what the element resolved to rather than the expression.
 */
export const describeElement = (props: {
    className?: string | readonly (string | false | null | undefined)[] | null;
    testID?: unknown;
}): string => {
    const parts: string[] = [];
    const className = Array.isArray(props.className)
        ? props.className.filter((token): token is string => typeof token === 'string').join(' ')
        : typeof props.className === 'string'
          ? props.className
          : '';
    const trimmed = className.trim().replace(/\s+/gu, ' ');
    if (trimmed !== '') {
        parts.push(`className="${trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed}"`);
    }
    if (typeof props.testID === 'string' && props.testID !== '') {
        parts.push(`testID="${props.testID}"`);
    }
    return parts.length === 0 ? '' : `[${parts.join(' ')}]`;
};

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
    /**
     * The author's own handle on the element — `[className="…"]` — or empty.
     *
     * Optional, so every existing throw and `prop-table`'s static answers produce the
     * same string they did before. ADR 0039 § 1 asks that the static answer and the
     * thrown message be one string, and an optional argument is how both stay one.
     */
    readonly where: string;

    constructor(primitive: string, subject: string, detail: string, where = '') {
        super(primitiveErrorMessage(primitive, subject, detail, where));
        this.primitive = primitive;
        this.subject = subject;
        this.where = where;
    }
}
