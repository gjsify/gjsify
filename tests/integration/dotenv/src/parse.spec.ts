// SPDX-License-Identifier: BSD-2-Clause
// Ported from https://github.com/motdotla/dotenv/blob/v17.4.2/tests/test-parse.js
// Original: Copyright (c) 2015, Scott Motte. BSD-2-Clause.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Exercises dotenv.parse() on the upstream kitchen-sink .env fixture.
// Hits every documented quoting/escaping/comment/export-keyword branch
// plus the Buffer-input + line-ending matrix.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { ENV_PATH } from './fixtures.js';

export default async () => {
    const parsed = parse(readFileSync(ENV_PATH, { encoding: 'utf8' }));

    await describe('dotenv.parse() — kitchen-sink .env fixture', async () => {
        await it('returns an object', () => {
            expect(typeof parsed).toBe('object');
            expect(parsed).toBeTruthy();
        });

        await it('sets basic environment variable', () => {
            expect(parsed.BASIC).toBe('basic');
        });

        await it('reads after a skipped line', () => {
            expect(parsed.AFTER_LINE).toBe('after_line');
        });

        await it('defaults empty values to empty string (unquoted)', () => {
            expect(parsed.EMPTY).toBe('');
        });

        await it('defaults empty values to empty string (single quotes)', () => {
            expect(parsed.EMPTY_SINGLE_QUOTES).toBe('');
        });

        await it('defaults empty values to empty string (double quotes)', () => {
            expect(parsed.EMPTY_DOUBLE_QUOTES).toBe('');
        });

        await it('defaults empty values to empty string (backticks)', () => {
            expect(parsed.EMPTY_BACKTICKS).toBe('');
        });

        await it('escapes single quoted values', () => {
            expect(parsed.SINGLE_QUOTES).toBe('single_quotes');
        });

        await it('respects surrounding spaces in single quotes', () => {
            expect(parsed.SINGLE_QUOTES_SPACED).toBe('    single quotes    ');
        });

        await it('escapes double quoted values', () => {
            expect(parsed.DOUBLE_QUOTES).toBe('double_quotes');
        });

        await it('respects surrounding spaces in double quotes', () => {
            expect(parsed.DOUBLE_QUOTES_SPACED).toBe('    double quotes    ');
        });

        await it('respects double quotes inside single quotes', () => {
            expect(parsed.DOUBLE_QUOTES_INSIDE_SINGLE).toBe('double "quotes" work inside single quotes');
        });

        await it('respects spacing for badly formed brackets', () => {
            expect(parsed.DOUBLE_QUOTES_WITH_NO_SPACE_BRACKET).toBe('{ port: $MONGOLAB_PORT}');
        });

        await it('respects single quotes inside double quotes', () => {
            expect(parsed.SINGLE_QUOTES_INSIDE_DOUBLE).toBe("single 'quotes' work inside double quotes");
        });

        await it('respects backticks inside single quotes', () => {
            expect(parsed.BACKTICKS_INSIDE_SINGLE).toBe('`backticks` work inside single quotes');
        });

        await it('respects backticks inside double quotes', () => {
            expect(parsed.BACKTICKS_INSIDE_DOUBLE).toBe('`backticks` work inside double quotes');
        });

        await it('parses backtick-quoted values', () => {
            expect(parsed.BACKTICKS).toBe('backticks');
        });

        await it('parses backtick-quoted values with surrounding spaces', () => {
            expect(parsed.BACKTICKS_SPACED).toBe('    backticks    ');
        });

        await it('respects double quotes inside backticks', () => {
            expect(parsed.DOUBLE_QUOTES_INSIDE_BACKTICKS).toBe('double "quotes" work inside backticks');
        });

        await it('respects single quotes inside backticks', () => {
            expect(parsed.SINGLE_QUOTES_INSIDE_BACKTICKS).toBe("single 'quotes' work inside backticks");
        });

        await it('respects both single and double quotes inside backticks', () => {
            expect(parsed.DOUBLE_AND_SINGLE_QUOTES_INSIDE_BACKTICKS).toBe(
                'double "quotes" and single \'quotes\' work inside backticks',
            );
        });

        await it('expands \\n newlines but only inside double quotes', () => {
            expect(parsed.EXPAND_NEWLINES).toBe('expand\nnew\nlines');
        });

        await it('does NOT expand newlines in unquoted values', () => {
            expect(parsed.DONT_EXPAND_UNQUOTED).toBe('dontexpand\\nnewlines');
        });

        await it('does NOT expand newlines in single-quoted values', () => {
            expect(parsed.DONT_EXPAND_SQUOTED).toBe('dontexpand\\nnewlines');
        });

        await it('ignores fully commented lines', () => {
            // upstream: t.notOk(parsed.COMMENTS) — the key never appears
            expect(parsed.COMMENTS).toBeFalsy();
        });

        await it('ignores inline comments', () => {
            expect(parsed.INLINE_COMMENTS).toBe('inline comments');
        });

        await it('preserves # inside single quotes and strips inline comment', () => {
            expect(parsed.INLINE_COMMENTS_SINGLE_QUOTES).toBe('inline comments outside of #singlequotes');
        });

        await it('preserves # inside double quotes and strips inline comment', () => {
            expect(parsed.INLINE_COMMENTS_DOUBLE_QUOTES).toBe('inline comments outside of #doublequotes');
        });

        await it('preserves # inside backticks and strips inline comment', () => {
            expect(parsed.INLINE_COMMENTS_BACKTICKS).toBe('inline comments outside of #backticks');
        });

        await it('treats # character as start of comment in unquoted values (no space required)', () => {
            expect(parsed.INLINE_COMMENTS_SPACE).toBe('inline comments start with a');
        });

        await it('respects equals signs in values', () => {
            expect(parsed.EQUAL_SIGNS).toBe('equals==');
        });

        await it('retains inner double quotes (unquoted JSON)', () => {
            expect(parsed.RETAIN_INNER_QUOTES).toBe('{"foo": "bar"}');
        });

        await it('retains inner double quotes (single-quoted JSON)', () => {
            expect(parsed.RETAIN_INNER_QUOTES_AS_STRING).toBe('{"foo": "bar"}');
        });

        await it('retains inner quotes (backtick-quoted JSON with embedded apostrophe)', () => {
            expect(parsed.RETAIN_INNER_QUOTES_AS_BACKTICKS).toBe('{"foo": "bar\'s"}');
        });

        await it('trims surrounding whitespace from unquoted values', () => {
            expect(parsed.TRIM_SPACE_FROM_UNQUOTED).toBe('some spaced out string');
        });

        await it('parses email addresses completely', () => {
            expect(parsed.USERNAME).toBe('therealnerdybeast@example.tld');
        });

        await it('parses keys and values surrounded by spaces', () => {
            expect(parsed.SPACED_KEY).toBe('parsed');
        });

        await it('ignores the export keyword', () => {
            expect(parsed.EXPORT_IS_DECLARED).toBe('parsed');
        });

        await it('ignores the export keyword and extra spacing', () => {
            expect(parsed.EXPORT_IS_DECLARED_WITH_SPACING).toBe('parsed');
        });

        await it('ignores export keyword and parses value', () => {
            expect(parsed.EXPORT_IS_DECLARED_WITH_SOME_VALUE).toBe('some_value');
        });

        await it('ignores export keyword and parses value with spacing', () => {
            expect(parsed.EXPORT_IS_DECLARED_WITH_SOME_VALUE_SPACED).toBe('some_value');
        });

        await it('ignores export keyword and parses value with trailing spacing', () => {
            expect(parsed.EXPORT_IS_DECLARED_WITH_SOME_VALUE_AND_SPACING).toBe('some_value');
        });
    });

    await describe('dotenv.parse() — Buffer input + line endings', async () => {
        await it('parses a Buffer into an object', () => {
            const payload = parse(Buffer.from('BUFFER=true'));
            expect(payload.BUFFER).toBe('true');
        });

        await it('last duplicate key wins', () => {
            const duplicate = parse(Buffer.from('DUP=one\nDUP=two'));
            expect(duplicate.DUP).toBe('two');
        });

        const expectedPayload = { SERVER: 'localhost', PASSWORD: 'password', DB: 'tests' };

        await it('parses (\\r) line endings', () => {
            const r = parse(Buffer.from('SERVER=localhost\rPASSWORD=password\rDB=tests\r'));
            expect(r).toStrictEqual(expectedPayload);
        });

        await it('parses (\\n) line endings', () => {
            const n = parse(Buffer.from('SERVER=localhost\nPASSWORD=password\nDB=tests\n'));
            expect(n).toStrictEqual(expectedPayload);
        });

        await it('parses (\\r\\n) line endings', () => {
            const rn = parse(Buffer.from('SERVER=localhost\r\nPASSWORD=password\r\nDB=tests\r\n'));
            expect(rn).toStrictEqual(expectedPayload);
        });
    });
};
