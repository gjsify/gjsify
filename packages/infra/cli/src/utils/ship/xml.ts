// The XML escape `gjsify ship`'s document renderers share.
//
// TWO COPIES BECAME ONE. `mime.ts` and `msi.ts` each grew their own — five
// replacements, same entities, same order, byte-identical bodies — one milestone
// apart, by people who never saw the other file. The second copy is where the
// helper goes.
//
// `plist.ts` keeps its own and that divergence CARRIES something: a plist value
// lands only in element CONTENT, so `"` and `'` are left as themselves rather
// than becoming entities a human reading `Info.plist` has to decode. This one is
// used in ATTRIBUTES too — a `.wxs` is almost nothing else — so it escapes both.

/**
 * Escape a value for XML element content or an attribute value.
 *
 * `&` FIRST, or the ampersands the four later replacements introduce are escaped
 * again and `Ship & Co` comes out as `Ship &amp;amp; Co`.
 */
export function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
