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

/**
 * Replace every raw U+0000 in `code` with the `\x00` escape.
 *
 * Returns the rewritten code and how many were replaced, so the caller can skip
 * writing the file (and reporting) in the overwhelmingly common zero case.
 */
export function escapeRawNulForGjs(code: string): { code: string; replaced: number } {
    let replaced = 0;
    const out = code.replace(/\u0000/g, () => {
        replaced++;
        return '\\x00';
    });
    return { code: out, replaced };
}
