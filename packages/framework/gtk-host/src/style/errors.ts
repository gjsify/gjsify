// The one error the style partition throws, in its own module because THREE
// modules throw it and none of them owns the other two.
//
// It lived in `paint.ts` while paint was the only half. Leaving it there would
// have made `layout.ts` import the paint half to get at an error class, which
// reads as a dependency between the halves and is not one — the dispatch in
// `resolve.ts` is what composes them, and it throws this too.

/** A utility class, property or combination this vocabulary cannot answer for, and why. */
export class UnknownUtilityError extends Error {
    override readonly name = 'UnknownUtilityError';
    readonly utility: string;
    constructor(utility: string, detail: string) {
        super(`@gjsify/gtk-host/style: "${utility}" — ${detail}`);
        this.utility = utility;
    }
}
