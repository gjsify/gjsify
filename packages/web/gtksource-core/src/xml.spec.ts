import { describe, it, expect } from '@gjsify/unit';
import { childElements, decodeEntities, parseXml, textContent, XmlParseError } from './xml.js';

const refuses = (source: string): string => {
    try {
        parseXml(source);
    } catch (error) {
        if (error instanceof XmlParseError) return error.message;
        throw error;
    }
    return '';
};

export default async () => {
    await describe('xml: parseXml', async () => {
        await it('reads the prolog, comments, attributes and nesting', () => {
            const root = parseXml(`<?xml version="1.0"?>
<!-- lead -->
<a x="1" y='two'><b/><c z="&lt;&amp;">t</c></a>`);
            expect(root.name).toBe('a');
            expect(root.attributes).toStrictEqual({ x: '1', y: 'two' });
            expect(childElements(root).map((e) => e.name)).toStrictEqual(['b', 'c']);
            expect(childElements(root, 'c')[0].attributes.z).toBe('<&');
            expect(textContent(root)).toBe('t');
        });

        await it('decodes entities in text and keeps CDATA literal', () => {
            const root = parseXml('<m>a &gt; b <![CDATA[<&>]]></m>');
            expect(textContent(root)).toBe('a > b <&>');
        });

        await it('keeps attribute names with a leading underscore and a hyphen', () => {
            const root = parseXml('<style-scheme _name="N" parent-scheme="P"/>');
            expect(root.attributes).toStrictEqual({ _name: 'N', 'parent-scheme': 'P' });
        });

        await it('decodes numeric references', () => {
            expect(decodeEntities('&#65;&#x42;')).toBe('AB');
        });

        await it('refuses what it does not understand, naming the offset', () => {
            expect(refuses('<a><b></a>')).toContain('does not match');
            expect(refuses('<a>')).toContain('unclosed element <a>');
            expect(refuses('<a x="1" x="2"/>')).toContain('duplicate attribute x');
            expect(refuses('<a>&nope;</a>')).toContain('unknown entity');
            expect(refuses('<a/><b/>')).toContain('more than one root');
            expect(refuses('text<a/>')).toContain('text outside');
            expect(refuses('<a x=1/>')).toContain('malformed attributes');
            expect(refuses('<a><!-- open</a>')).toContain('unterminated comment');
            expect(refuses('')).toContain('no root');
            expect(refuses('<a>&#0;</a>')).toContain('invalid character reference');
        });
    });
};
