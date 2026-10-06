import { describe, expect, it } from '@gjsify/unit';

import { hexLang, learnStyle, learnStyleDark, sixAssemblerLang } from './fixtures.js';
import { keywordPattern, parseLanguage } from './lang.js';
import { translateRegex, UnsupportedRegexError } from './regex.js';
import { parseStyleScheme, resolveStyle } from './style.js';
import type { ContextNode } from './types.js';

const search = (nodes: readonly ContextNode[], id: string): ContextNode | undefined => {
    for (const node of nodes) {
        if (node.id === id) return node;
        const nested = search(node.include, id);
        if (nested) return nested;
    }
    return undefined;
};

const find = (nodes: readonly ContextNode[], id: string): ContextNode => {
    const found = search(nodes, id);
    if (!found) throw new Error(`no context ${id}`);
    return found;
};

const refusal = (source: string, extended = false): string | null => {
    try {
        translateRegex(source, { extended });
    } catch (error) {
        if (error instanceof UnsupportedRegexError) return error.construct;
        throw error;
    }
    return null;
};

export default async () => {
    await describe('gtksource-core: parseLanguage on the real 6502-assembler.lang', async () => {
        const lang = parseLanguage(sixAssemblerLang);
        const root = find(lang.definitions, '6502-assembler');

        await it('reads the header and metadata', () => {
            expect(lang.id).toBe('6502-assembler');
            expect(lang.name).toBe('6502 Assembler');
            expect(lang.section).toBe('Source');
            expect(lang.metadata['line-comment-start']).toBe(';');
            expect(lang.metadata.globs).toBe('*.asm;*.s');
        });

        await it('models every construct the file uses, so nothing is unsupported', () => {
            expect(lang.unsupported).toStrictEqual([]);
            expect(parseLanguage(sixAssemblerLang, { strict: true }).id).toBe('6502-assembler');
        });

        await it('keeps the styles with their def: mapping', () => {
            expect(lang.styles.length).toBe(9);
            expect(lang.styles.find((style) => style.id === 'instruction')?.mapTo).toBe('def:keyword');
        });

        await it('captures the comment as a span ending at the end of the line', () => {
            const comment = find(root.include, 'comment');
            expect(comment.start?.source).toBe(';');
            expect(comment.end?.source).toBe('$');
            expect(comment.styleRef).toBe('comment');
        });

        await it('captures the string with its nested escape', () => {
            const string = find(root.include, 'string');
            expect(string.endAtLineEnd).toBe(true);
            expect(string.start?.source).toBe('"');
            const escape = find(string.include, 'escape');
            expect(escape.match?.source).toBe('\\\\.');
            expect(escape.styleRef).toBe('def:special-char');
        });

        await it('captures the number alternatives as an extended match', () => {
            const number = find(root.include, 'number');
            expect(number.match?.extended).toBe(true);
            expect(number.match?.source).toContain('\\$[0-9a-fA-F]+\\b');
        });

        await it('captures all 112 instruction keywords', () => {
            const instructions = find(root.include, 'instructions');
            expect(instructions.keywords.length).toBe(112);
            expect(instructions.keywords[0]).toBe('LDA');
            expect(instructions.keywords[1]).toBe('lda');
        });

        await it('captures the directives with their prefix', () => {
            const preprocessor = find(root.include, 'preprocessor');
            expect(preprocessor.prefix).toBe('^\\s*\\.');
            expect(preprocessor.keywords.length).toBe(22);
            expect(preprocessor.keywords.includes('ORG')).toBe(true);
        });

        await it('captures define-constant with its two sub-patterns', () => {
            const define = find(root.include, 'define-constant');
            expect(define.match?.source).toBe('^\\s*(define)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+(.+)$');
            expect(define.include.map((node) => [node.subPattern, node.styleRef])).toStrictEqual([
                [1, 'preprocessor'],
                [2, 'variable'],
            ]);
        });

        await it('decodes the entities of the operator class', () => {
            expect(find(root.include, 'operator').match?.source).toBe('[\\+\\-\\*\\/\\>\\<\\(\\)\\,\\#\\=\\!\\[\\]]');
        });

        await it('builds the keyword regex the way GtkSourceView does', () => {
            const instructions = find(root.include, 'instructions');
            const regex = translateRegex(keywordPattern(instructions), { extended: false });
            expect(regex.test('lda #$01')).toBe(true);
            expect(regex.test('LDA')).toBe(true);
            expect(regex.test('ldax')).toBe(false);
            expect(regex.test('xlda')).toBe(false);
            const directive = translateRegex(keywordPattern(find(root.include, 'preprocessor')), { extended: false });
            expect(directive.test('  .ORG $0600')).toBe(true);
            expect(directive.test('ORG $0600')).toBe(false);
        });
    });

    await describe('gtksource-core: parseLanguage on hex.lang and on what it must report', async () => {
        await it('parses hex.lang', () => {
            const lang = parseLanguage(hexLang, { strict: true });
            expect(lang.id).toBe('hex');
            expect(find(lang.definitions, 'zero').match?.source).toBe('00');
        });

        await it('reports each unsupported construct with its path', () => {
            const lang = parseLanguage(`<language id="t">
  <styles><style id="s" name="S"/></styles>
  <definitions>
    <define-regex id="x">a</define-regex>
    <context id="t" extend-parent="false">
      <include>
        <context id="a" style-ref="s"><match>(?&gt;a)</match></context>
        <context id="b" style-ref="nope"><match>b</match></context>
        <context ref="missing"/>
        <context ref="other:ctx"/>
        <context id="c"><once/></context>
      </include>
    </context>
  </definitions>
</language>`);
            const found = lang.unsupported.map((entry) => `${entry.construct} @ ${entry.where}`);
            expect(found).toStrictEqual([
                'element define-regex @ language/definitions',
                'attribute extend-parent @ language/definitions/context[id=t]',
                'regex: an atomic group (?>…) @ language/definitions/context[id=t]/include/context[id=a]/match',
                'element once @ language/definitions/context[id=t]/include/context[id=c]',
                'style-ref nope names no style @ language/definitions/context[id=t]/include/context[id=b]',
                'ref missing names no context @ language/definitions/context[id=t]/include/context[ref=missing]',
                'cross-language ref other:ctx @ language/definitions/context[id=t]/include/context[ref=other:ctx]',
            ]);
        });

        await it('throws in strict mode and lists them', () => {
            let message = '';
            try {
                parseLanguage(
                    '<language id="t"><definitions><context id="t" once-only="true"/></definitions></language>',
                    { strict: true },
                );
            } catch (error) {
                message = error instanceof Error ? error.message : '';
            }
            expect(message).toContain('attribute once-only');
        });

        await it('lists a pattern the JS engine rejects in non-strict mode instead of throwing', () => {
            const fabricated =
                '<language id="t"><definitions><context id="t"><match>(a</match></context></definitions></language>';
            const lang = parseLanguage(fabricated);
            const regex = lang.unsupported.filter((entry) => entry.construct.startsWith('regex:'));
            expect(regex.length).toBe(1);
            expect(regex[0].where).toBe('language/definitions/context[id=t]/match');
            let message = '';
            try {
                parseLanguage(fabricated, { strict: true });
            } catch (error) {
                message = error instanceof Error ? error.message : '';
            }
            expect(message).toContain('regex:');
        });
    });

    await describe('gtksource-core: translateRegex', async () => {
        await it('translates every pattern the two real .lang files use, and they match', () => {
            const lang = parseLanguage(sixAssemblerLang);
            const root = find(lang.definitions, '6502-assembler');
            const number = translateRegex(find(root.include, 'number').match?.source ?? '', { extended: true });
            expect(number.exec('lda $FF')?.[0]).toBe('$FF');
            expect(number.exec('x @101')?.[0]).toBe('@101');
            expect(number.exec('lda 42')?.[0]).toBe('42');
            expect(number.test('$zz')).toBe(false);
            const label = translateRegex(find(root.include, 'label').match?.source ?? '', { extended: false });
            expect(label.exec('loop:\n  lda $10')?.[0]).toBe('loop:');
            expect(label.test('  indented:')).toBe(false);
            const define = translateRegex(find(root.include, 'define-constant').match?.source ?? '', {
                extended: false,
            });
            const hit = define.exec('define sprite $0200');
            expect([hit?.[1], hit?.[2], hit?.[3]]).toStrictEqual(['define', 'sprite', '$0200']);
            const operator = translateRegex(find(root.include, 'operator').match?.source ?? '', { extended: false });
            expect(operator.test('#')).toBe(true);
            expect(operator.test('a')).toBe(false);
        });

        await it('matches ^ and $ per line', () => {
            expect(translateRegex('^b$', { extended: false }).test('a\nb\nc')).toBe(true);
        });

        await it('adds caller flags such as sticky', () => {
            const sticky = translateRegex('a', { extended: false, flags: 'y' });
            sticky.lastIndex = 1;
            expect(sticky.test('ba')).toBe(true);
        });

        await it('dedupes caller flags against the always-set m and a leading (?i)', () => {
            expect(translateRegex('a', { extended: false, flags: 'm' }).flags).toBe('m');
            expect(translateRegex('a', { extended: false, flags: 'im' }).flags).toBe('im');
            expect(translateRegex('(?i)a', { extended: false, flags: 'i' }).flags).toBe('im');
        });

        await it('strips whitespace and comments in extended mode, but not inside a class', () => {
            expect(translateRegex('a b # note\n c', { extended: true }).test('abc')).toBe(true);
            expect(translateRegex('[ ]', { extended: true }).test(' ')).toBe(true);
            expect(translateRegex('a\\ b', { extended: true }).test('a b')).toBe(true);
        });

        await it('maps the GtkSourceView word boundaries and a leading (?i)', () => {
            expect(translateRegex('\\%[foo\\%]', { extended: false }).test('a foo b')).toBe(true);
            expect(translateRegex('\\%[foo\\%]', { extended: false }).test('afoo')).toBe(false);
            expect(translateRegex('(?i)foo', { extended: false }).test('FOO')).toBe(true);
        });

        await it('maps (?P<n>), (?P=n) and drops (?#…)', () => {
            expect(translateRegex('(?P<q>a)(?#why)(?P=q)', { extended: false }).test('aa')).toBe(true);
        });

        await it('refuses what a JS RegExp cannot express, naming it', () => {
            const table: ReadonlyArray<readonly [string, string]> = [
                ['a++', 'a possessive quantifier'],
                ['a*+', 'a possessive quantifier'],
                ['a?+', 'a possessive quantifier'],
                ['a{2,3}+', 'a possessive quantifier'],
                ['(?>a)', 'an atomic group (?>…)'],
                ['\\Aa', '\\A (start of subject)'],
                ['a\\Z', '\\Z (end of subject)'],
                ['a\\z', '\\z (end of subject)'],
                ['\\ha', '\\h (horizontal space)'],
                ['a\\R', '\\R (newline sequence)'],
                ['a(?i)b', 'an inline flag group'],
                ['a(?i:b)', 'an inline flag group'],
                ['(a)(?1)', 'recursion or a subroutine call'],
                ['(?R)', 'recursion or a subroutine call'],
                ['\\%{id}', '\\%{id} regex reference'],
                ['\\x{41}', 'braced \\x{…} escape'],
                ['\\p{L}', '\\p{…}/\\P{…} (Unicode property)'],
                ['\\P{Alpha}', '\\p{…}/\\P{…} (Unicode property)'],
                ['[\\p{L}]', '\\p{…}/\\P{…} (Unicode property)'],
                ['\\e', '\\e (ESC character)'],
                ['[a\\e]', '\\e (ESC character)'],
                ['\\g<1>', '\\g<…>/\\g{…} (PCRE group reference)'],
                ['\\g{name}', '\\g<…>/\\g{…} (PCRE group reference)'],
                ["\\g'1'", '\\g<…>/\\g{…} (PCRE group reference)'],
                ['[\\g{1}]', '\\g<…>/\\g{…} (PCRE group reference)'],
                ['\\N{U+0041}', '\\N{U+…} (Unicode codepoint)'],
                ['[\\N{U+0041}]', '\\N{U+…} (Unicode codepoint)'],
                ['(?(1)a', 'a conditional group (?(…)'],
                ['(?|a|b)', 'a branch reset group (?|…)'],
                ['[[:alpha:]]', 'a POSIX character class'],
                ['[\\h]', '\\h (horizontal space)'],
                ['a[b', 'an unterminated character class'],
            ];
            for (const [source, construct] of table)
                expect(`${source} -> ${refusal(source)}`).toBe(`${source} -> ${construct}`);
        });

        await it('accepts the lookalikes it must not mistake for those constructs', () => {
            const accepted = [
                '[\\+\\-\\*]',
                '\\++',
                'a\\+\\+',
                '[+]+',
                '\\\\A',
                '[?]+',
                'a+?',
                'a*?b',
                'a{2,3}?',
                'a{x}+',
                '(?:a)+',
                '(?=a)',
                '(?<!a)b',
                '\\(?>a',
                '[]a]',
                '[^]a]',
            ];
            for (const source of accepted) expect(`${source} -> ${refusal(source)}`).toBe(`${source} -> ${null}`);
        });
    });

    await describe('gtksource-core: style schemes', async () => {
        const light = parseStyleScheme(learnStyle);
        const dark = parseStyleScheme(learnStyleDark);
        const adwaita = parseStyleScheme(`<style-scheme id="Adwaita" name="Adwaita" version="1.0">
  <author>GNOME</author>
  <color name="blue" value="#3584e4"/>
  <color name="green" value="#26a269"/>
  <style name="def:keyword" foreground="blue" bold="true"/>
  <style name="def:comment" foreground="#5e5c64" italic="true" scale="small"/>
  <style name="current-line" background="#f6f5f4"/>
</style-scheme>`);
        const lookup = (id: string) => (id === 'Adwaita' ? adwaita : undefined);

        await it('reads both Learn6502 schemes', () => {
            expect(light.id).toBe('Learn6502');
            expect(light.parentScheme).toBe('Adwaita');
            expect(light.styles.map((style) => style.name)).toStrictEqual(['current-line', 'current-line-number']);
            expect(light.styles[0].background).toBe('#00000018');
            expect(light.unsupported).toStrictEqual([]);
            expect(dark.parentScheme).toBe('Adwaita-dark');
        });

        await it('keeps attributes it does not interpret', () => {
            expect(adwaita.authors).toStrictEqual(['GNOME']);
            expect(adwaita.styles.find((style) => style.name === 'def:comment')?.extra).toStrictEqual({
                scale: 'small',
            });
        });

        await it('lets the scheme override its parent and falls back to it', () => {
            expect(resolveStyle(light, 'current-line', lookup)?.foundIn).toBe('Learn6502');
            expect(resolveStyle(light, 'current-line', lookup)?.background).toBe('#00000018');
            const keyword = resolveStyle(light, 'def:keyword', lookup);
            expect(keyword?.foundIn).toBe('Adwaita');
            expect(keyword?.foreground).toBe('#3584e4');
            expect(keyword?.bold).toBe(true);
            expect(resolveStyle(light, 'def:comment', lookup)?.italic).toBe(true);
            expect(resolveStyle(light, 'no-such-style', lookup)).toBe(undefined);
        });

        await it('refuses a parent loop and a missing parent', () => {
            const a = parseStyleScheme('<style-scheme id="A" parent-scheme="B"/>');
            const b = parseStyleScheme('<style-scheme id="B" parent-scheme="A"/>');
            const both = (id: string) => (id === 'A' ? a : id === 'B' ? b : undefined);
            expect(() => resolveStyle(a, 'x', both)).toThrow();
            expect(() => resolveStyle(light, 'x', () => undefined)).toThrow();
        });

        await it('reports unknown elements', () => {
            const scheme = parseStyleScheme('<style-scheme id="S"><icon name="x"/></style-scheme>');
            expect(scheme.unsupported).toStrictEqual([{ construct: 'element icon', where: 'style-scheme' }]);
        });
    });
};
