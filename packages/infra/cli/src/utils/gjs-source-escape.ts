// Build-time rewrite: a `--app gjs` bundle must not contain a raw U+0000 byte.
//
// GJS hands module source to SpiderMonkey as a NUL-TERMINATED C string, so a raw
// U+0000 in the emitted file truncates it at that point. Everything after is
// silently discarded and the error names whatever construct happened to be open
// when the text ran out:
//
//   SyntaxError: `` literal not terminated before end of script
//
// which points at the wrong place entirely and never mentions a NUL.
//
// This is easy to hit and hard to diagnose. `'\u0000'` in TypeScript source is an
// ESCAPE — six harmless ASCII characters — but the minifier is free to inline the
// constant and emit the CHARACTER:
//
//   const P = '\u0000'; … return `${P}${i}${P}`   // source: escaped, loads fine
//   … return`<NUL>${e}<NUL>`                      // minified: raw byte, will not load
//
// so the same code builds and runs unminified and breaks under `--minify`, which is
// the default. A real consumer hit exactly this with an IMAP literal marker — NUL
// being the one byte that cannot occur in IMAP response text is precisely why it
// was chosen as the marker.
//
// Node and browsers load a raw NUL in source without complaint (U+0000 is a legal
// source character per the spec), so no other target notices and nothing upstream
// is going to change. Escaping it on the way out is gjsify's job.
//
// The rewrite is safe as a plain text substitution: in valid JS a raw NUL can only
// appear inside a string, a template literal, a regex or a comment, and `\x00`
// denotes exactly U+0000 in all four — so the meaning is preserved wherever it sits.
//
// `\x00` and NOT `\0`: `\0` followed by a digit is a legacy octal escape, which is a
// SyntaxError in a template literal and under strict mode. A digit right after the
// marker is exactly the shape that triggered this (`\0${index}\0`), so `\0` would
// trade one unloadable bundle for another.

// Built with `String.fromCharCode(0)` rather than written as a U+0000 escape, for the
// reason this module documents above: the minifier may inline a string constant as the
// CHARACTER, and a raw NUL in the CLI's own gjs bundle is precisely the failure this
// code exists to prevent. The spec file states the same rule, for the same reason.
const NUL = String.fromCharCode(0);

/**
 * Replace every raw U+0000 in `code` with the `\x00` escape.
 *
 * Returns the rewritten code and how many were replaced, so the caller can skip
 * writing the file (and reporting) in the overwhelmingly common zero case.
 */
export function escapeRawNulForGjs(code: string): { code: string; replaced: number } {
    // A plain split rather than a `code.replace()` over a U+0000 regex literal: a regex
    // holding a control character is what `no-control-regex` exists to catch, and
    // suppressing that rule in the ONE file whose subject IS raw NULs would switch the
    // check off exactly where it is most likely to be right about something else later.
    //
    // `split` always yields one more piece than separators, so `parts.length - 1` IS the
    // count — and the zero case returns the original string with nothing rebuilt.
    const parts = code.split(NUL);
    const replaced = parts.length - 1;
    return { code: replaced === 0 ? code : parts.join('\\x00'), replaced };
}
