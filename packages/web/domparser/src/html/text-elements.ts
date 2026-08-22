// The two element sets whose CONTENT is character data rather than markup.
//
// Their own file because two unrelated halves of the package read them and only
// one of them wants the tokenizer: the serializer asks "may this element's text
// be escaped?" — the answer is the RAWTEXT set exactly — and importing that
// answer from `tokenizer.ts` would pull 700 lines of state machine into every
// bundle that touches `innerHTML`.

/**
 * Elements whose content is raw text: markup inside them is text and character
 * references are NOT decoded, so `<style>a{b:'&amp;'}</style>` keeps `&amp;`.
 *
 * `noscript` is deliberately absent. It is raw text only when scripting is
 * enabled, and nothing here runs scripts — a scraper wants the markup inside it.
 *
 * The same set answers the serializer's question, because the HTML fragment
 * serialization algorithm names exactly these elements as the ones whose text is
 * written verbatim.
 * https://html.spec.whatwg.org/multipage/parsing.html#serialising-html-fragments
 */
export const RAWTEXT_ELEMENTS: ReadonlySet<string> = new Set([
    'iframe',
    'noembed',
    'noframes',
    'script',
    'style',
    'xmp',
]);

/**
 * Elements whose content is text but WITH character references decoded — the same
 * shape as RAWTEXT and the opposite answer, which is why both are driven with the
 * same input in the spec file. They are NOT in the serializer's verbatim set:
 * `<textarea>&</textarea>` has to be written back as `&amp;`.
 */
export const RCDATA_ELEMENTS: ReadonlySet<string> = new Set(['textarea', 'title']);
