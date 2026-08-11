// Build-time rewrite: a `--app gjs` bundle must not contain a raw U+0000 byte.
//
// GJS hands module source to SpiderMonkey as a NUL-TERMINATED C string, so a raw U+0000
// truncates the file there. Everything after is silently discarded and the error names
// whatever construct happened to be open when the text ran out — "SyntaxError: `` literal
// not terminated before end of script" — never the NUL.
//
// Easy to hit by accident: `'\u0000'` in TypeScript source is a six-character ESCAPE, but
// the minifier may inline the constant and emit the CHARACTER, so the same code runs
// unminified and breaks under `--minify` (the default). A consumer hit this with an IMAP
// literal marker — NUL cannot occur in IMAP response text, which is why it was the marker.
// Node and browsers load a raw NUL in source per spec, so no other target notices and
// nothing upstream will change; escaping it on the way out is gjsify's job.
//
// Safe as a plain text substitution: in valid JS a raw NUL can only sit inside a string, a
// template literal, a regex or a comment, and `\x00` denotes U+0000 in all four. NOT `\0`,
// which is a legacy octal escape when followed by a digit — a SyntaxError in a template
// literal and under strict mode, and `\0${index}\0` is exactly the shape that triggered it.

/**
 * Replace every raw U+0000 in `code` with the `\x00` escape.
 *
 * Reports how many were replaced so the caller can skip writing the file (and reporting)
 * in the overwhelmingly common zero case.
 */
export function escapeRawNulForGjs(code: string): { code: string; replaced: number } {
    // split/join rather than a regex: a NUL inside a regex is what oxlint's `no-control-regex`
    // exists to flag, and the rule is right in general even though this use is deliberate.
    // fromCharCode also keeps THIS file free of the raw byte it exists to remove.
    const parts = code.split(String.fromCharCode(0));
    return { code: parts.join('\\x00'), replaced: parts.length - 1 };
}
