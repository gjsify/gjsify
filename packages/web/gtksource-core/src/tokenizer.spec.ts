import { describe, expect, it } from '@gjsify/unit';

import { sixAssemblerLang } from './fixtures.js';
import { parseLanguage } from './lang.js';
import { schemeStyleName, Tokenizer } from './tokenizer.js';

const language = parseLanguage(sixAssemblerLang, { strict: true });
const asm = new Tokenizer(language);

const tokens = (line: string): string[] =>
    asm.tokenize(line).tokens.map((token) => `${token.start}-${token.end}:${token.style}`);

export default async () => {
    await describe('gtksource-core: Tokenizer on the real 6502-assembler.lang', async () => {
        await it('highlights an instruction line', () => {
            expect(tokens('lda #$01 ; set A')).toStrictEqual([
                '0-3:instruction',
                '4-5:operator',
                '5-8:number',
                '9-16:comment',
            ]);
        });

        await it('does not take a longer word for an instruction', () => {
            expect(tokens('ldax')).toStrictEqual(['0-4:variable']);
            expect(tokens('LDA')).toStrictEqual(['0-3:instruction']);
        });

        await it('highlights labels only at the start of the line', () => {
            expect(tokens('loop:')).toStrictEqual(['0-5:label']);
            expect(tokens('  indented:')).toStrictEqual(['2-10:variable']);
        });

        await it('highlights hex, binary and decimal numbers', () => {
            expect(tokens('$FF @101 42')).toStrictEqual(['0-3:number', '4-8:number', '9-11:number']);
        });

        await it('highlights a directive only with its leading dot', () => {
            expect(tokens('.ORG $0600')).toStrictEqual(['0-4:preprocessor', '5-10:number']);
            expect(tokens('ORG $0600')).toStrictEqual(['0-3:variable', '4-9:number']);
        });

        await it('colours the capture groups of define inside the constant', () => {
            expect(tokens('define foo $10')).toStrictEqual([
                '0-6:preprocessor',
                '6-7:constant',
                '7-10:variable',
                '10-14:constant',
            ]);
        });

        await it('styles a string, its escape and its quotes', () => {
            expect(tokens('"a\\n"')).toStrictEqual(['0-2:string', '2-4:def:special-char', '4-5:string']);
        });

        await it('ends an unterminated string at the end of the line', () => {
            const first = asm.tokenize('"abc');
            expect(first.tokens.map((token) => token.style)).toStrictEqual(['string']);
            expect(first.state.stack.length).toBe(0);
            expect(asm.tokenize('lda', first.state).tokens.map((token) => token.style)).toStrictEqual(['instruction']);
        });

        await it('keeps a comment from swallowing the next line', () => {
            const results = asm.tokenizeText('; a comment\nlda');
            expect(results.map((line) => line.tokens.map((token) => token.style))).toStrictEqual([
                ['comment'],
                ['instruction'],
            ]);
        });

        await it('maps token styles to scheme style names', () => {
            expect(schemeStyleName(language, 'instruction')).toBe('def:keyword');
            expect(schemeStyleName(language, 'def:special-char')).toBe('def:special-char');
            expect(schemeStyleName(language, 'unmapped')).toBe('6502-assembler:unmapped');
        });
    });

    await describe('gtksource-core: Tokenizer across lines', async () => {
        const block = new Tokenizer(
            parseLanguage(
                `<language id="c"><styles><style id="c" name="C" map-to="def:comment"/><style id="w" name="W"/></styles>
  <definitions>
    <context id="c">
      <include>
        <context id="block" style-ref="c"><start>/\\*</start><end>\\*/</end>
          <include><context id="todo" style-ref="w"><match>TODO</match></context></include>
        </context>
        <context ref="plain"/>
      </include>
    </context>
    <context id="plain" style-ref="w"><match>w+</match></context>
  </definitions></language>`,
                { strict: true },
            ),
        );

        await it('carries an open span to the next line and closes it there', () => {
            const results = block.tokenizeText('a /* x\nTODO y */ b');
            expect(results[0].tokens.map((token) => `${token.start}-${token.end}:${token.style}`)).toStrictEqual([
                '2-6:c',
            ]);
            expect(results[0].state.stack.length).toBe(1);
            expect(results[1].tokens.map((token) => `${token.start}-${token.end}:${token.style}`)).toStrictEqual([
                '0-4:w',
                '4-9:c',
            ]);
            expect(results[1].state.stack.length).toBe(0);
        });

        await it('flattens a context reference into its parent', () => {
            expect(block.tokenize('www').tokens.map((token) => token.style)).toStrictEqual(['w']);
        });
    });
};
