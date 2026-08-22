// The `An+B` microsyntax, shared by `:nth-child()` and its three siblings — and,
// through the parser's positional expansion, by `:first-child`, `:last-child`,
// `:only-child` and the three `-of-type` forms.
//
// https://drafts.csswg.org/css-syntax/#anb-microsyntax

export interface NthFormula {
    a: number;
    b: number;
}

/** `2n`, `-n+3`, `+3n - 2`; the plain-integer and keyword forms are separate. */
const AN_PLUS_B = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/;
const INTEGER = /^[+-]?\d+$/;

/** Throws a `SyntaxError` naming the argument it could not read. */
export function parseNth(text: string): NthFormula {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === 'odd') return { a: 2, b: 1 };
    if (trimmed === 'even') return { a: 2, b: 0 };

    const match = AN_PLUS_B.exec(trimmed);
    if (match !== null) {
        const coefficient = match[1];
        const a = coefficient === '' || coefficient === '+' ? 1 : coefficient === '-' ? -1 : Number(coefficient);
        return { a, b: match[3] === undefined ? 0 : Number(match[2] + match[3]) };
    }
    if (INTEGER.test(trimmed)) return { a: 0, b: Number(trimmed) };

    throw new SyntaxError("'" + text + "' is not a valid An+B argument");
}

/** `index` counts from 1, as the CSS definition does. */
export function matchesNth(formula: NthFormula, index: number): boolean {
    if (formula.a === 0) return index === formula.b;
    const offset = index - formula.b;
    // The step has to be taken a non-negative number of times, so the sign of
    // the remaining distance must follow the sign of `a`.
    return formula.a > 0 ? offset >= 0 && offset % formula.a === 0 : offset <= 0 && offset % formula.a === 0;
}
