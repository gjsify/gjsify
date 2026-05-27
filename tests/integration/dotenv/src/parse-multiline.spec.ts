// SPDX-License-Identifier: BSD-2-Clause
// Ported from https://github.com/motdotla/dotenv/blob/v17.4.2/tests/test-parse-multiline.js
// Original: Copyright (c) 2015, Scott Motte. BSD-2-Clause.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Validates the multi-line quoting paths: a literal newline inside a
// double-quoted / single-quoted / backtick-quoted value, plus a
// realistic multi-line PEM payload.

import { describe, it, expect } from '@gjsify/unit';
import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { ENV_MULTILINE_PATH } from './fixtures.js';

const MULTI_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnNl1tL3QjKp3DZWM0T3u
LgGJQwu9WqyzHKZ6WIA5T+7zPjO1L8l3S8k8YzBrfH4mqWOD1GBI8Yjq2L1ac3Y/
bTdfHN8CmQr2iDJC0C6zY8YV93oZB3x0zC/LPbRYpF8f6OqX1lZj5vo2zJZy4fI/
kKcI5jHYc8VJq+KCuRZrvn+3V+KuL9tF9v8ZgjF2PZbU+LsCy5Yqg1M8f5Jp5f6V
u4QuUoobAgMBAAE=
-----END PUBLIC KEY-----`;

export default async () => {
    const parsed = parse(readFileSync(ENV_MULTILINE_PATH, { encoding: 'utf8' }));

    await describe('dotenv.parse() — multi-line .env fixture', async () => {
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

        await it('defaults empty values to empty string', () => {
            expect(parsed.EMPTY).toBe('');
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
            expect(parsed.COMMENTS).toBeFalsy();
        });

        await it('respects equals signs in values', () => {
            expect(parsed.EQUAL_SIGNS).toBe('equals==');
        });

        await it('retains inner quotes (unquoted JSON)', () => {
            expect(parsed.RETAIN_INNER_QUOTES).toBe('{"foo": "bar"}');
        });

        await it('retains inner quotes (single-quoted JSON)', () => {
            expect(parsed.RETAIN_INNER_QUOTES_AS_STRING).toBe('{"foo": "bar"}');
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

        await it('parses multi-line strings when using double quotes', () => {
            expect(parsed.MULTI_DOUBLE_QUOTED).toBe('THIS\nIS\nA\nMULTILINE\nSTRING');
        });

        await it('parses multi-line strings when using single quotes', () => {
            expect(parsed.MULTI_SINGLE_QUOTED).toBe('THIS\nIS\nA\nMULTILINE\nSTRING');
        });

        await it('parses multi-line strings when using backticks', () => {
            expect(parsed.MULTI_BACKTICKED).toBe('THIS\nIS\nA\n"MULTILINE\'S"\nSTRING');
        });

        await it('parses a realistic multi-line PEM payload via double quotes', () => {
            expect(parsed.MULTI_PEM_DOUBLE_QUOTED).toBe(MULTI_PEM);
        });
    });
};
