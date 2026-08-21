// Named character references, keyed by the text BETWEEN `&` and the end of the
// reference — the trailing `;` is part of the key on purpose. HTML's own table
// carries both spellings for the legacy references (`&amp;` and `&amp`), and the
// decoder resolves by longest match against exactly these keys, so a key that
// ends in `;` automatically wins over its semicolon-less prefix.
//
// This is HTML's predefined set: the five XML references plus the semicolon-less
// and uppercase legacy spellings the spec table lists for four of them. ADR 0026
// §5 decides the full table (~2200 entries) is generated from the spec data and
// committed; the decoder needs no change when it lands, because it derives its
// longest-match window from the keys below.

export const NAMED_REFERENCES: Record<string, string> = {
    'AMP;': '&',
    AMP: '&',
    'amp;': '&',
    amp: '&',
    'apos;': "'",
    'GT;': '>',
    GT: '>',
    'gt;': '>',
    gt: '>',
    'LT;': '<',
    LT: '<',
    'lt;': '<',
    lt: '<',
    'QUOT;': '"',
    QUOT: '"',
    'quot;': '"',
    quot: '"',
};
