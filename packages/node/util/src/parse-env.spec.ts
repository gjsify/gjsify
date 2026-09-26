// Ported from refs/node/test/parallel/test-util-parse-env.js, with the fixture
// refs/node/test/fixtures/dotenv/valid.env inlined (tests carry no fixture files here).
// Original: MIT license, Node.js contributors.

import { describe, it, expect } from '@gjsify/unit';
import * as util from 'node:util';

const VALID_ENV = `BASIC=basic

# COMMENTS=work
#BASIC=basic2
#BASIC=basic3

# previous line intentionally left blank
AFTER_LINE=after_line
A="B=C"
B=C=D
EMPTY=
EMPTY_SINGLE_QUOTES=''
EMPTY_DOUBLE_QUOTES=""
EMPTY_BACKTICKS=\`\`
SINGLE_QUOTES='single_quotes'
SINGLE_QUOTES_SPACED='    single quotes    '
DOUBLE_QUOTES="double_quotes"
DOUBLE_QUOTES_SPACED="    double quotes    "
DOUBLE_QUOTES_INSIDE_SINGLE='double "quotes" work inside single quotes'
DOUBLE_QUOTES_WITH_NO_SPACE_BRACKET="{ port: $MONGOLAB_PORT}"
SINGLE_QUOTES_INSIDE_DOUBLE="single 'quotes' work inside double quotes"
BACKTICKS_INSIDE_SINGLE='\`backticks\` work inside single quotes'
BACKTICKS_INSIDE_DOUBLE="\`backticks\` work inside double quotes"
BACKTICKS=\`backticks\`
BACKTICKS_SPACED=\`    backticks    \`
DOUBLE_QUOTES_INSIDE_BACKTICKS=\`double "quotes" work inside backticks\`
SINGLE_QUOTES_INSIDE_BACKTICKS=\`single 'quotes' work inside backticks\`
DOUBLE_AND_SINGLE_QUOTES_INSIDE_BACKTICKS=\`double "quotes" and single 'quotes' work inside backticks\`
EXPAND_NEWLINES="expand\\nnew\\nlines"
DONT_EXPAND_UNQUOTED=dontexpand\\nnewlines
DONT_EXPAND_SQUOTED='dontexpand\\nnewlines'
# COMMENTS=work
INLINE_COMMENTS=inline comments # work #very #well
INLINE_COMMENTS_SINGLE_QUOTES='inline comments outside of #singlequotes' # work
INLINE_COMMENTS_DOUBLE_QUOTES="inline comments outside of #doublequotes" # work
INLINE_COMMENTS_BACKTICKS=\`inline comments outside of #backticks\` # work
INLINE_COMMENTS_SPACE=inline comments start with a#number sign. no space required.
EQUAL_SIGNS=equals==
RETAIN_INNER_QUOTES={"foo": "bar"}
RETAIN_INNER_QUOTES_AS_STRING='{"foo": "bar"}'
RETAIN_INNER_QUOTES_AS_BACKTICKS=\`{"foo": "bar's"}\`
TRIM_SPACE_FROM_UNQUOTED=    some spaced out string
SPACE_BEFORE_DOUBLE_QUOTES=   "space before double quotes"
EMAIL=therealnerdybeast@example.tld
    SPACED_KEY = parsed
EDGE_CASE_INLINE_COMMENTS="VALUE1" # or "VALUE2" or "VALUE3"

MULTI_DOUBLE_QUOTED="THIS
IS
A
MULTILINE
STRING"

MULTI_SINGLE_QUOTED='THIS
IS
A
MULTILINE
STRING'

MULTI_BACKTICKED=\`THIS
IS
A
"MULTILINE'S"
STRING\`
export EXPORT_EXAMPLE = ignore export

MULTI_NOT_VALID_QUOTE="
MULTI_NOT_VALID=THIS
IS NOT MULTILINE
`;

const EXPECTED: Record<string, string> = {
    A: 'B=C',
    B: 'C=D',
    AFTER_LINE: 'after_line',
    BACKTICKS: 'backticks',
    BACKTICKS_INSIDE_DOUBLE: '`backticks` work inside double quotes',
    BACKTICKS_INSIDE_SINGLE: '`backticks` work inside single quotes',
    BACKTICKS_SPACED: '    backticks    ',
    BASIC: 'basic',
    DONT_EXPAND_SQUOTED: 'dontexpand\\nnewlines',
    DONT_EXPAND_UNQUOTED: 'dontexpand\\nnewlines',
    DOUBLE_AND_SINGLE_QUOTES_INSIDE_BACKTICKS: 'double "quotes" and single \'quotes\' work inside backticks',
    DOUBLE_QUOTES: 'double_quotes',
    DOUBLE_QUOTES_INSIDE_BACKTICKS: 'double "quotes" work inside backticks',
    DOUBLE_QUOTES_INSIDE_SINGLE: 'double "quotes" work inside single quotes',
    DOUBLE_QUOTES_SPACED: '    double quotes    ',
    DOUBLE_QUOTES_WITH_NO_SPACE_BRACKET: '{ port: $MONGOLAB_PORT}',
    EDGE_CASE_INLINE_COMMENTS: 'VALUE1',
    EMAIL: 'therealnerdybeast@example.tld',
    EMPTY: '',
    EMPTY_BACKTICKS: '',
    EMPTY_DOUBLE_QUOTES: '',
    EMPTY_SINGLE_QUOTES: '',
    EQUAL_SIGNS: 'equals==',
    EXPORT_EXAMPLE: 'ignore export',
    EXPAND_NEWLINES: 'expand\nnew\nlines',
    INLINE_COMMENTS: 'inline comments',
    INLINE_COMMENTS_BACKTICKS: 'inline comments outside of #backticks',
    INLINE_COMMENTS_DOUBLE_QUOTES: 'inline comments outside of #doublequotes',
    INLINE_COMMENTS_SINGLE_QUOTES: 'inline comments outside of #singlequotes',
    INLINE_COMMENTS_SPACE: 'inline comments start with a',
    MULTI_BACKTICKED: 'THIS\nIS\nA\n"MULTILINE\'S"\nSTRING',
    MULTI_DOUBLE_QUOTED: 'THIS\nIS\nA\nMULTILINE\nSTRING',
    MULTI_NOT_VALID: 'THIS',
    MULTI_NOT_VALID_QUOTE: '"',
    MULTI_SINGLE_QUOTED: 'THIS\nIS\nA\nMULTILINE\nSTRING',
    RETAIN_INNER_QUOTES: '{"foo": "bar"}',
    RETAIN_INNER_QUOTES_AS_BACKTICKS: '{"foo": "bar\'s"}',
    RETAIN_INNER_QUOTES_AS_STRING: '{"foo": "bar"}',
    SINGLE_QUOTES: 'single_quotes',
    SINGLE_QUOTES_INSIDE_BACKTICKS: "single 'quotes' work inside backticks",
    SINGLE_QUOTES_INSIDE_DOUBLE: "single 'quotes' work inside double quotes",
    SINGLE_QUOTES_SPACED: '    single quotes    ',
    SPACED_KEY: 'parsed',
    SPACE_BEFORE_DOUBLE_QUOTES: 'space before double quotes',
    TRIM_SPACE_FROM_UNQUOTED: 'some spaced out string',
};

/** `{ ...obj }` in key order, so a mismatch names the key instead of the whole object. */
function sorted(obj: Record<string, string>): Array<[string, string]> {
    return Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]!]);
}

export default async () => {
    await describe('util.parseEnv', async () => {
        await it('parses the valid.env fixture', () => {
            expect(sorted(util.parseEnv(VALID_ENV))).toStrictEqual(sorted(EXPECTED));
        });

        // The prototype is deliberately NOT asserted: Node 24 returns an ordinary
        // object and Node 27 (refs/node) a null-prototype one.
        await it('returns no keys for empty input', () => {
            expect(Object.keys(util.parseEnv(''))).toStrictEqual([]);
        });

        await it('lets a later duplicate key win', () => {
            expect(util.parseEnv('FOO=bar\nFOO=baz\n').FOO).toBe('baz');
        });

        await it('drops \\r from Windows line endings', () => {
            expect(sorted(util.parseEnv('A=1\r\nB="two"\r\n'))).toStrictEqual([
                ['A', '1'],
                ['B', 'two'],
            ]);
        });

        await it('rejects a non-string with ERR_INVALID_ARG_TYPE', () => {
            for (const value of [null, undefined, {}, []]) {
                let code: unknown;
                try {
                    util.parseEnv(value as unknown as string);
                } catch (err) {
                    code = (err as { code?: unknown }).code;
                }
                expect(code).toBe('ERR_INVALID_ARG_TYPE');
            }
        });
    });
};
