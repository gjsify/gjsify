// The tokenizer is driven through a RECORDING sink and its token stream is
// asserted directly — there is no tree builder in this file, so a tokenizer bug
// cannot hide behind one.
//
// Every case asserts the WHOLE stream: count and content in one comparison. A
// count on its own is green today against a broken tree — `querySelectorAll('li')`
// answers 3 for `<ul><li>one<li>two<li>three</ul>` with all three items nested
// inside the first — which is the failure class ADR 0026 exists to close.

import { describe, expect, it } from '@gjsify/unit';

import { RAWTEXT_ELEMENTS, RCDATA_ELEMENTS, tokenize } from './html/tokenizer.js';
import type { DoctypeToken, TokenAttribute, TreeSink } from './html/tree-sink.js';

type Token =
    | { kind: 'doctype'; doctype: DoctypeToken }
    | { kind: 'open'; name: string; attrs: TokenAttribute[]; selfClosing: boolean }
    | { kind: 'close'; name: string }
    | { kind: 'text'; text: string }
    | { kind: 'comment'; data: string };

class RecordingSink implements TreeSink {
    readonly tokens: Token[] = [];

    onDoctype(doctype: DoctypeToken): void {
        this.tokens.push({ kind: 'doctype', doctype });
    }

    onOpenTag(name: string, attrs: TokenAttribute[], selfClosing: boolean): void {
        this.tokens.push({ kind: 'open', name, attrs, selfClosing });
    }

    onCloseTag(name: string): void {
        this.tokens.push({ kind: 'close', name });
    }

    onText(text: string): void {
        this.tokens.push({ kind: 'text', text });
    }

    onComment(data: string): void {
        this.tokens.push({ kind: 'comment', data });
    }
}

function tokensOf(html: string): Token[] {
    const sink = new RecordingSink();
    tokenize(html, sink);
    return sink.tokens;
}

/** One line per token, so a single comparison pins both the count and the values. */
function printed(html: string): string[] {
    return tokensOf(html).map((token) => {
        switch (token.kind) {
            case 'doctype':
                return `doctype ${token.doctype.name}`;
            case 'open': {
                const attrs = token.attrs.map((a) => ` ${a.name}=${JSON.stringify(a.value)}`).join('');
                return `open ${token.name}${attrs}${token.selfClosing ? ' /' : ''}`;
            }
            case 'close':
                return `close ${token.name}`;
            case 'text':
                return `text ${JSON.stringify(token.text)}`;
            default:
                return `comment ${JSON.stringify(token.data)}`;
        }
    });
}

/** Raw text-token values, for content that JSON escaping would make unreadable. */
function texts(html: string): string[] {
    return tokensOf(html)
        .filter((token): token is Extract<Token, { kind: 'text' }> => token.kind === 'text')
        .map((token) => token.text);
}

function attributesOf(html: string): TokenAttribute[] {
    const open = tokensOf(html).find((token): token is Extract<Token, { kind: 'open' }> => token.kind === 'open');
    return open === undefined ? [] : open.attrs;
}

function doctypeOf(html: string): DoctypeToken | undefined {
    const found = tokensOf(html).find(
        (token): token is Extract<Token, { kind: 'doctype' }> => token.kind === 'doctype',
    );
    return found?.doctype;
}

const REPLACEMENT = '\uFFFD';
// A literal U+0000 in a source file reaches the gjs bundle as a raw NUL byte,
// where the module loader reads it as end-of-script. Computed, never written.
const NUL = String.fromCharCode(0);

export default async () => {
    await describe('html/tokenizer', async () => {
        await describe('tags', async () => {
            await it('emits one start tag with a lowercased name', async () => {
                expect(printed('<DIV>')).toStrictEqual(['open div']);
            });

            await it('emits an end tag and drops its attributes', async () => {
                expect(printed('</DIV class="x">')).toStrictEqual(['close div']);
            });

            await it('flags a self-closing start tag', async () => {
                expect(printed('<br/><br />')).toStrictEqual(['open br /', 'open br /']);
            });

            await it('keeps a quoted attribute value containing ">"', async () => {
                expect(printed('<div class="a>b">x')).toStrictEqual(['open div class="a>b"', 'text "x"']);
            });

            await it('drops a tag that never closes, keeping the text before it', async () => {
                // eof-in-tag: the token is discarded whole, so nothing half-parsed
                // reaches the sink.
                expect(printed('x<div class="a')).toStrictEqual(['text "x"']);
            });

            await it('emits "<" as text when no tag name follows', async () => {
                // One text token, not three: the run is merged across the stray "<",
                // so a tree builder never has to join text nodes.
                expect(printed('a < b')).toStrictEqual(['text "a < b"']);
                expect(printed('<3>')).toStrictEqual(['text "<3>"']);
            });

            await it('emits nothing at all for "</>"', async () => {
                expect(printed('a</>b')).toStrictEqual(['text "ab"']);
            });

            await it('separates a text run from the tag that follows it', async () => {
                expect(printed('a<b>c</b>')).toStrictEqual(['text "a"', 'open b', 'text "c"', 'close b']);
            });

            await it('normalises CRLF and lone CR to LF', async () => {
                expect(texts('<p>a\r\nb\rc</p>')).toStrictEqual(['a\nb\nc']);
            });
        });

        await describe('attributes', async () => {
            await it('reads double-quoted, single-quoted and unquoted values', async () => {
                expect(printed(`<a href="x" title='y' rel=nofollow>`)).toStrictEqual([
                    'open a href="x" title="y" rel="nofollow"',
                ]);
            });

            await it('gives a bare attribute the empty string', async () => {
                // `<input disabled>` reports hasAttribute('disabled') === false under
                // the XML scanner this replaces.
                expect(attributesOf('<input disabled>')).toStrictEqual([{ name: 'disabled', value: '' }]);
            });

            await it('gives an attribute with "=" and no value the empty string', async () => {
                expect(attributesOf('<div class=>')).toStrictEqual([{ name: 'class', value: '' }]);
            });

            await it('keeps the FIRST of two attributes with the same name', async () => {
                expect(attributesOf('<a HREF="x" href="y">')).toStrictEqual([{ name: 'href', value: 'x' }]);
            });

            await it('does not end an unquoted value at "/"', async () => {
                // A solidus is an ordinary value character here, so this element is
                // NOT self-closing and its href keeps the slash.
                expect(printed('<a href=x/>')).toStrictEqual(['open a href="x/"']);
            });

            await it('takes a leading "=" as part of the attribute name', async () => {
                expect(attributesOf('<div =a>')).toStrictEqual([{ name: '=a', value: '' }]);
            });

            await it('reads attributes separated by newlines', async () => {
                expect(printed('<div\n  id="a"\n  class="b"\n>')).toStrictEqual(['open div id="a" class="b"']);
            });

            await it('keeps hyphenated and data- attribute names', async () => {
                expect(attributesOf('<article data-adid="1" aria-label="x">')).toStrictEqual([
                    { name: 'data-adid', value: '1' },
                    { name: 'aria-label', value: 'x' },
                ]);
            });
        });

        await describe('character references', async () => {
            await it('decodes named and numeric references in text', async () => {
                expect(texts('hello &amp; goodbye')).toStrictEqual(['hello & goodbye']);
                expect(texts('28&#034;')).toStrictEqual(['28"']);
                expect(texts('&#x3C;tag&#x3E;')).toStrictEqual(['<tag>']);
            });

            await it('re-maps the C1 range to Windows-1252', async () => {
                // `&#128;` has meant the euro sign for longer than the spec has said so.
                expect(texts('&#128;')).toStrictEqual(['€']);
            });

            await it('replaces NUL, surrogates and out-of-range code points', async () => {
                expect(texts('&#0;&#xD800;&#x110000;')).toStrictEqual([REPLACEMENT + REPLACEMENT + REPLACEMENT]);
            });

            await it('leaves a lone ampersand alone', async () => {
                expect(texts('AT&T &')).toStrictEqual(['AT&T &']);
                expect(texts('&#;&#x;')).toStrictEqual(['&#;&#x;']);
            });

            await it('decodes a semicolon-less reference in text', async () => {
                expect(texts('a&amp b')).toStrictEqual(['a& b']);
            });

            await it('does NOT decode a semicolon-less reference before "=" in an attribute', async () => {
                // The scraping trap: without this rule `?a=1&copy=2` becomes `?a=1©=2`
                // and the URL points nowhere.
                expect(attributesOf('<a href="?a=1&amp=2">')).toStrictEqual([{ name: 'href', value: '?a=1&amp=2' }]);
                expect(attributesOf('<a href="?a=1&amp;b=2">')).toStrictEqual([{ name: 'href', value: '?a=1&b=2' }]);
            });

            await it('decodes references in an unquoted attribute value', async () => {
                expect(attributesOf('<a href=a&#38;b>')).toStrictEqual([{ name: 'href', value: 'a&b' }]);
            });

            await it('passes NUL through in text and replaces it everywhere else', async () => {
                expect(texts(`a${NUL}b`)).toStrictEqual([`a${NUL}b`]);
                expect(texts(`<style>a${NUL}b</style>`)).toStrictEqual([`a${REPLACEMENT}b`]);
                expect(attributesOf(`<div id="a${NUL}b">`)).toStrictEqual([{ name: 'id', value: `a${REPLACEMENT}b` }]);
            });
        });

        await describe('raw text and RCDATA', async () => {
            await it('keeps markup inside <script> as text', async () => {
                // The XML scanner this replaces returns "var a = 1  2;" here — it eats
                // everything between "<" and ">" as a tag.
                expect(printed('<script>var a = 1 < 2 && 3 > 4;</script>')).toStrictEqual([
                    'open script',
                    'text "var a = 1 < 2 && 3 > 4;"',
                    'close script',
                ]);
            });

            await it('leaks no JSON-LD into the surrounding text', async () => {
                expect(printed('<script type="application/ld+json">{"a":"<b> & c"}</script><h2>T</h2>')).toStrictEqual([
                    'open script type="application/ld+json"',
                    'text "{\\"a\\":\\"<b> & c\\"}"',
                    'close script',
                    'open h2',
                    'text "T"',
                    'close h2',
                ]);
            });

            await it('treats every raw-text element as raw text, references included', async () => {
                for (const name of RAWTEXT_ELEMENTS) {
                    expect(printed(`<${name}>a &amp; <b>c</${name}>`)).toStrictEqual([
                        `open ${name}`,
                        'text "a &amp; <b>c"',
                        `close ${name}`,
                    ]);
                }
                expect(RAWTEXT_ELEMENTS.size).toBeGreaterThan(1);
            });

            await it('decodes references in every RCDATA element', async () => {
                // Same shape as raw text, opposite answer — which is why both sets are
                // driven with the same input.
                for (const name of RCDATA_ELEMENTS) {
                    expect(printed(`<${name}>a &amp; <b>c</${name}>`)).toStrictEqual([
                        `open ${name}`,
                        'text "a & <b>c"',
                        `close ${name}`,
                    ]);
                }
                expect(RCDATA_ELEMENTS.size).toBeGreaterThan(1);
            });

            await it('does not treat <noscript> as raw text', async () => {
                // Raw text only when scripting is enabled, and nothing here runs
                // scripts — a consumer wants the markup inside it.
                expect(printed('<noscript><b>x</b></noscript>')).toStrictEqual([
                    'open noscript',
                    'open b',
                    'text "x"',
                    'close b',
                    'close noscript',
                ]);
            });

            await it('ends raw text only at an APPROPRIATE end tag', async () => {
                expect(printed('<script>x</scriptx>y</script>')).toStrictEqual([
                    'open script',
                    'text "x</scriptx>y"',
                    'close script',
                ]);
                expect(printed('<script>x</SCRIPT >')).toStrictEqual(['open script', 'text "x"', 'close script']);
                expect(printed('<script>x</script/>')).toStrictEqual(['open script', 'text "x"', 'close script']);
            });

            await it('keeps a script open across a double-escaped inner end tag', async () => {
                // Measured against parse5: an ad tag writing markup into the page
                // otherwise ends here and spills the rest of its JavaScript into the
                // document as text.
                expect(printed('<script>document.write("<!--<script></script>-->")</script><p>a</p>')).toStrictEqual([
                    'open script',
                    'text "document.write(\\"<!--<script></script>-->\\")"',
                    'close script',
                    'open p',
                    'text "a"',
                    'close p',
                ]);
            });

            await it('lets an end tag inside a script comment close the script', async () => {
                // One escape level only: `<!--` alone does not protect the end tag.
                expect(printed('<script><!-- a </script> b --></script>')).toStrictEqual([
                    'open script',
                    'text "<!-- a "',
                    'close script',
                    'text " b -->"',
                    'close script',
                ]);
            });

            await it('gives no escape levels to the other raw-text elements', async () => {
                expect(printed('<style><!--<style></style>--></style>')).toStrictEqual([
                    'open style',
                    'text "<!--<style>"',
                    'close style',
                    'text "-->"',
                    'close style',
                ]);
            });

            await it('does not end raw text at "</script" cut off by EOF', async () => {
                expect(printed('<script>a</script')).toStrictEqual(['open script', 'text "a</script"']);
            });

            await it('emits no text token for empty raw text', async () => {
                expect(printed('<script></script>')).toStrictEqual(['open script', 'close script']);
            });

            await it('enters raw text even when the start tag is self-closing', async () => {
                expect(printed('<title/>x</title>')).toStrictEqual(['open title /', 'text "x"', 'close title']);
            });
        });

        await describe('comments', async () => {
            await it('reads an ordinary comment', async () => {
                expect(printed('<!-- c --><p>')).toStrictEqual(['comment " c "', 'open p']);
            });

            await it('reads the abrupt-close forms as empty comments', async () => {
                expect(printed('<!-->')).toStrictEqual(['comment ""']);
                expect(printed('<!--->')).toStrictEqual(['comment ""']);
                expect(printed('<!---->')).toStrictEqual(['comment ""']);
            });

            await it('closes a comment on "--!>" too', async () => {
                expect(printed('<!--a--!>b')).toStrictEqual(['comment "a"', 'text "b"']);
            });

            await it('keeps interior dashes', async () => {
                expect(printed('<!-- a -- b -->')).toStrictEqual(['comment " a -- b "']);
            });

            await it('does not open a second comment inside one', async () => {
                expect(printed('<!--<!-->')).toStrictEqual(['comment "<!"']);
            });

            await it('emits an unterminated comment at EOF', async () => {
                expect(printed('<!--a')).toStrictEqual(['comment "a"']);
            });

            await it('reads bogus comments', async () => {
                expect(printed('<!x>')).toStrictEqual(['comment "x"']);
                expect(printed('<?php echo 1; ?>')).toStrictEqual(['comment "?php echo 1; ?"']);
                expect(printed('<![CDATA[x]]>')).toStrictEqual(['comment "[CDATA[x]]"']);
                expect(printed('</ x>')).toStrictEqual(['comment " x"']);
            });
        });

        await describe('doctype', async () => {
            await it('reads a lowercased name', async () => {
                expect(doctypeOf('<!DOCTYPE HTML>')).toStrictEqual({
                    name: 'html',
                    publicId: null,
                    systemId: null,
                    forceQuirks: false,
                });
            });

            await it('reads public and system identifiers', async () => {
                const doctype = doctypeOf(
                    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" ' +
                        '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
                );
                expect(doctype).toStrictEqual({
                    name: 'html',
                    publicId: '-//W3C//DTD XHTML 1.0 Strict//EN',
                    systemId: 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd',
                    forceQuirks: false,
                });
            });

            await it('reads a system-only identifier', async () => {
                expect(doctypeOf('<!DOCTYPE html SYSTEM "about:legacy-compat">')).toStrictEqual({
                    name: 'html',
                    publicId: null,
                    systemId: 'about:legacy-compat',
                    forceQuirks: false,
                });
            });

            await it('forces quirks on a nameless or truncated declaration', async () => {
                expect(doctypeOf('<!DOCTYPE>')).toStrictEqual({
                    name: null,
                    publicId: null,
                    systemId: null,
                    forceQuirks: true,
                });
                expect(doctypeOf('<!DOCTYPE html')).toStrictEqual({
                    name: 'html',
                    publicId: null,
                    systemId: null,
                    forceQuirks: true,
                });
            });

            await it('places the doctype before the document it introduces', async () => {
                expect(printed('<!DOCTYPE html><html><head><title>T</title></head></html>')).toStrictEqual([
                    'doctype html',
                    'open html',
                    'open head',
                    'open title',
                    'text "T"',
                    'close title',
                    'close head',
                    'close html',
                ]);
            });
        });

        await describe('a document-shaped stream', async () => {
            await it('tokenises implied end tags and void elements without closing anything itself', async () => {
                // The tokenizer reports what is written; deciding that `<li>` closes the
                // previous one, and that `<img>` never closes, is the tree builder's job.
                expect(printed('<ul><li>one<li>two</ul><img src="x">')).toStrictEqual([
                    'open ul',
                    'open li',
                    'text "one"',
                    'open li',
                    'text "two"',
                    'close ul',
                    'open img src="x"',
                ]);
            });
        });
    });
};
