// SPDX-License-Identifier: MIT
// Ported from chalk upstream test/chalk.js
// (https://github.com/chalk/chalk/blob/main/test/chalk.js — the published
// tarball strips test/, so the upstream URL is the canonical source).
// Original: Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, AVA dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import chalk from 'chalk';

// CSI prefix shorthand (ESC + '['). Keeping assertions readable while
// preserving exact byte-equality with chalk's emitted ANSI sequences.
const E = '[';

export default async () => {
    // Pin truecolor so every assertion below is deterministic regardless of
    // host TERM/COLORTERM/CI/FORCE_COLOR detection. This is the same first
    // line the upstream suite executes — chalk.level = 3.
    chalk.level = 3;

    await describe('chalk — base behavior', async () => {
        await it('does not add styling when called as the base function', () => {
            expect(chalk('foo')).toBe('foo');
        });

        await it('supports multiple arguments in the base function', () => {
            expect(chalk('hello', 'there')).toBe('hello there');
        });

        await it('auto-casts arrays and numbers to strings', () => {
            expect(chalk(['hello', 'there'])).toBe('hello,there');
            expect(chalk(123)).toBe('123');
            expect(chalk.bold(['foo', 'bar'])).toBe(`${E}1mfoo,bar${E}22m`);
            expect(chalk.green(98_765)).toBe(`${E}32m98765${E}39m`);
        });

        await it('wraps a string with the correct single-style ANSI codes', () => {
            expect(chalk.underline('foo')).toBe(`${E}4mfoo${E}24m`);
            expect(chalk.red('foo')).toBe(`${E}31mfoo${E}39m`);
            expect(chalk.bgRed('foo')).toBe(`${E}41mfoo${E}49m`);
        });

        await it('emits foreground + background + modifier in chain order', () => {
            expect(chalk.red.bgGreen.underline('foo')).toBe(
                `${E}31m${E}42m${E}4mfoo${E}24m${E}49m${E}39m`,
            );
            expect(chalk.underline.red.bgGreen('foo')).toBe(
                `${E}4m${E}31m${E}42mfoo${E}49m${E}39m${E}24m`,
            );
        });

        await it('reopens colors around nested same-style strings', () => {
            expect(chalk.red('foo' + chalk.underline.bgBlue('bar') + '!')).toBe(
                `${E}31mfoo${E}4m${E}44mbar${E}49m${E}24m!${E}39m`,
            );
        });

        await it('handles nested styles of the same type (color, underline, bg)', () => {
            expect(chalk.red('a' + chalk.yellow('b' + chalk.green('c') + 'b') + 'c')).toBe(
                `${E}31ma${E}33mb${E}32mc${E}39m${E}31m${E}33mb${E}39m${E}31mc${E}39m`,
            );
        });

        await it('emits a reset sequence around `.reset()`-wrapped output', () => {
            expect(chalk.reset(chalk.red.bgGreen.underline('foo') + 'foo')).toBe(
                `${E}0m${E}31m${E}42m${E}4mfoo${E}24m${E}49m${E}39mfoo${E}0m`,
            );
        });

        await it('caches per-style instances on the chain object', () => {
            const { red, green } = chalk;
            const redBold = red.bold;
            const greenBold = green.bold;
            // Different styles → different wrappings.
            expect(red('foo') === green('foo')).toBe(false);
            expect(redBold('bar') === greenBold('bar')).toBe(false);
            expect(green('baz') === greenBold('baz')).toBe(false);
        });

        await it('aliases grey to gray', () => {
            expect(chalk.grey('foo')).toBe(`${E}90mfoo${E}39m`);
        });

        await it('joins multiple positional arguments with a single space', () => {
            expect(chalk.red('foo', 'bar')).toBe(`${E}31mfoo bar${E}39m`);
        });

        await it('still styles falsy values like 0', () => {
            expect(chalk.red(0)).toBe(`${E}31m0${E}39m`);
        });

        await it('does not output escape codes for empty input', () => {
            expect(chalk.red()).toBe('');
            expect(chalk.red.blue.black()).toBe('');
        });

        await it('preserves Function.prototype.{apply,bind,call} semantics', () => {
            expect(Reflect.apply(chalk.grey, null, ['foo'])).toBe(`${E}90mfoo${E}39m`);
            expect(chalk.reset(chalk.red.bgGreen.underline.bind(null)('foo') + 'foo')).toBe(
                `${E}0m${E}31m${E}42m${E}4mfoo${E}24m${E}49m${E}39mfoo${E}0m`,
            );
            expect(chalk.red.blue.black.call(null)).toBe('');
        });

        await it('reopens the color across LF line breaks', () => {
            expect(chalk.grey('hello\nworld')).toBe(
                `${E}90mhello${E}39m\n${E}90mworld${E}39m`,
            );
        });

        await it('reopens the color across CRLF line breaks', () => {
            expect(chalk.grey('hello\r\nworld')).toBe(
                `${E}90mhello${E}39m\r\n${E}90mworld${E}39m`,
            );
        });

        await it('supports the blackBright bright-color alias', () => {
            expect(chalk.blackBright('foo')).toBe(`${E}90mfoo${E}39m`);
        });

        await it('keeps chalk function-prototype helpers callable', () => {
            // chalk itself is callable; .apply/.bind/.call route through the
            // base function (no styling).
            expect(chalk.apply(chalk, ['foo'])).toBe('foo');
            expect(chalk.bind(chalk, 'foo')()).toBe('foo');
            expect(chalk.call(chalk, 'foo')).toBe('foo');
        });
    });
};
