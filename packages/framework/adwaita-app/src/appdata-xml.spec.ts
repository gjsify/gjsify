// @gjsify/adwaita-app — metainfo XML tokeniser tests.
// Runs on GJS + Node (pure string work, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { decodeXmlEntities, scanXml, type XmlOpenTag, type XmlToken } from './appdata-xml.js';

const names = (tokens: XmlToken[]): string[] =>
    tokens.filter((token) => token.kind === 'open').map((token) => (token as XmlOpenTag).name);

const text = (tokens: XmlToken[]): string =>
    tokens
        .filter((token) => token.kind === 'text')
        .map((token) => (token as { text: string }).text)
        .join('');

const firstOpen = (tokens: XmlToken[], name: string): XmlOpenTag =>
    tokens.find((token) => token.kind === 'open' && token.name === name) as XmlOpenTag;

export default async () => {
    await describe('scanXml', async () => {
        await it('reports elements, attributes and text in document order', () => {
            const tokens = scanXml('<component type="desktop"><id>org.example.App</id></component>');
            expect(tokens.length).toBe(5);
            expect(tokens[0]).toStrictEqual({
                kind: 'open',
                name: 'component',
                attributes: { type: 'desktop' },
                selfClosing: false,
            });
            expect(tokens[1]).toStrictEqual({ kind: 'open', name: 'id', attributes: {}, selfClosing: false });
            expect(tokens[2]).toStrictEqual({ kind: 'text', text: 'org.example.App' });
            expect(tokens[3]).toStrictEqual({ kind: 'close', name: 'id' });
            expect(tokens[4]).toStrictEqual({ kind: 'close', name: 'component' });
        });

        await it('marks a self-closing element and emits no close token for it', () => {
            const tokens = scanXml('<a><br/><c /></a>');
            expect(names(tokens)).toEqualArray(['a', 'br', 'c']);
            expect(firstOpen(tokens, 'br').selfClosing).toBe(true);
            expect(firstOpen(tokens, 'c').selfClosing).toBe(true);
            expect(tokens.filter((token) => token.kind === 'close').length).toBe(1);
        });

        await it('reads xml:lang as the literal attribute name AppStream writes', () => {
            const tokens = scanXml('<name xml:lang="de-DE">Name</name>');
            expect(firstOpen(tokens, 'name').attributes['xml:lang']).toBe('de-DE');
        });

        await it('accepts single-quoted attribute values', () => {
            const tokens = scanXml("<url type='homepage'>x</url>");
            expect(firstOpen(tokens, 'url').attributes.type).toBe('homepage');
        });

        // A licence string or a release note legitimately contains `>`. Scanning to the first
        // `>` would end the tag inside the attribute value, turn the rest of the attribute
        // list into text, and hand the field reader a name it never saw in the document.
        await it('does not end a tag at a > inside an attribute value', () => {
            const tokens = scanXml('<release version="1.0" summary="a > b"><p>ok</p></release>');
            expect(firstOpen(tokens, 'release').attributes.summary).toBe('a > b');
            expect(firstOpen(tokens, 'release').attributes.version).toBe('1.0');
            expect(names(tokens)).toEqualArray(['release', 'p']);
        });

        await it('skips comments, the XML declaration and a doctype', () => {
            const tokens = scanXml(
                '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE component>\n<!-- a <fake> tag --><id>x</id>',
            );
            expect(names(tokens)).toEqualArray(['id']);
            expect(text(tokens).trim()).toBe('x');
        });

        await it('takes CDATA verbatim, without entity decoding', () => {
            const tokens = scanXml('<p><![CDATA[a & b <not-a-tag>]]></p>');
            expect(names(tokens)).toEqualArray(['p']);
            expect(text(tokens)).toBe('a & b <not-a-tag>');
        });

        // Not a tidiness rule: an unterminated tag at EOF that is silently dropped takes the
        // last field of a truncated metainfo file with it and reports nothing at all.
        await it('reports an unterminated tag at EOF as text', () => {
            const tokens = scanXml('<id>x</id><name attr="unclosed');
            expect(names(tokens)).toEqualArray(['id']);
            expect(text(tokens)).toBe('x<name attr="unclosed');
        });

        await it('emits no empty text tokens between adjacent tags', () => {
            expect(scanXml('<a><b></b></a>').filter((token) => token.kind === 'text').length).toBe(0);
        });
    });

    await describe('decodeXmlEntities', async () => {
        await it('resolves the five predefined entities', () => {
            expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
        });

        await it('resolves decimal and hexadecimal character references', () => {
            expect(decodeXmlEntities('&#65;&#x42;&#x1F600;')).toBe('AB\u{1F600}');
        });

        // A hand-written metainfo file leaves `&` unescaped more often than any other
        // character. Dropping an unknown reference would turn "Tom & Jerry" into "Tom "
        // and cut a developer name short on Windows alone.
        await it('leaves an unknown or malformed reference verbatim', () => {
            expect(decodeXmlEntities('Tom & Jerry')).toBe('Tom & Jerry');
            expect(decodeXmlEntities('&nbsp;')).toBe('&nbsp;');
            expect(decodeXmlEntities('&#0;')).toBe('&#0;');
            expect(decodeXmlEntities('&#x110000;')).toBe('&#x110000;');
        });

        // A lone surrogate is not a character. `String.fromCodePoint` accepts one and the
        // result breaks every later string operation, including the Pango markup the
        // release notes become.
        await it('refuses a surrogate half', () => {
            expect(decodeXmlEntities('&#xD800;')).toBe('&#xD800;');
        });

        await it('decodes entities inside attribute values too', () => {
            const tokens = scanXml('<developer id="a&amp;b"><name>x</name></developer>');
            expect(firstOpen(tokens, 'developer').attributes.id).toBe('a&b');
        });
    });
};
