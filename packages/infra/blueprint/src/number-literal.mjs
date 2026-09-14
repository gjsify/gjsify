// One reading of a Blueprint number literal, shared by every exit of the AST.
//
// `NumberValue.raw` (ast.d.mts) keeps the SOURCE SPELLING because the two exits want different
// things from it: the XML exit reproduces the oracle's formatting and the projection wants a
// JavaScript number. What they share is the step before either — the sign, and the digits with
// the `_` separators removed — and that step was written twice, and the second copy was the one
// that was wrong: `Number("1_000")` is `NaN`, and once the underscores were stripped there,
// `Number("-0x10")` still was, because JavaScript reads no sign on a hex string, while the XML
// exit had split the sign off all along. Both exits read through this function now, so a form
// the tokenizer admits is read one way or refused in one place.
//
// The oracle validates in its tokenizer: `0xZZ` matches its NUMBER pattern (and this parser's,
// which is the same regex) and `get_number` then raises "0xZZ is not a valid number literal".
// The parser asks the same question at the same point, so neither exit meets a literal it
// cannot read — and the error names the line, where a bare `BigInt()` failure named nothing.

/**
 * @param {string} raw  the source spelling, sign included
 * @returns {{ negative: boolean, digits: string }}  `digits` is what `BigInt()` or `Number()` reads: unsigned, `_` removed
 * @throws {Error}  the oracle's own sentence, for the caller to locate
 */
export function numberLiteral(raw) {
    const cleaned = raw.replaceAll('_', '');
    const negative = cleaned.startsWith('-');
    const digits = negative || cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    // `int(s, 16)` for `0x…`, else `float(s)` where a `.` is present, else `int(s)` — the three
    // arms of the oracle's `get_number`, as the set of strings each accepts.
    const readable = digits.startsWith('0x') ? /^0x[0-9A-Fa-f]+$/.test(digits) : /^(?:\d+\.?\d*|\.\d+)$/.test(digits);
    if (!readable) throw new Error(`\`${raw}\` is not a valid number literal`);
    return { negative, digits };
}
