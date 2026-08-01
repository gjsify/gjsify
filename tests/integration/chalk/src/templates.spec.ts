// SPDX-License-Identifier: MIT
// Ported from chalk upstream test/chalk.js
// (https://github.com/chalk/chalk/blob/main/test/chalk.js — the RGB/hex/
// ansi256 cases). The published tarball strips test/, so the upstream
// URL is the canonical source.
// Original: Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, AVA dialect adapted.
//
// Validates chalk's color-model APIs: `chalk.rgb(r, g, b)`, `chalk.hex(...)`,
// `chalk.ansi256(idx)` and their `.bg*` counterparts, plus the colour-space
// downsampling chain that maps 24-bit input → 8-bit (level 2) → 4-bit
// (level 1) when the terminal advertises lower support. The `new Chalk({
// level })` instance API is the cleanest way to assert downsampling without
// mutating the global `chalk.level`.

import { describe, it, expect } from '@gjsify/unit';
import chalk, { Chalk } from 'chalk';

// CSI prefix shorthand (ESC + '['). Keeping assertions readable while
// preserving exact byte-equality with chalk's emitted ANSI sequences.
const E = '[';

export default async () => {
    chalk.level = 3;

    await describe('chalk — truecolor + RGB/hex/ansi256 chain API', async () => {
        await it('chalk.rgb emits 24-bit foreground SGR sequence', () => {
            // CSI 38;2;<r>;<g>;<b> m → close [39m
            expect(chalk.rgb(255, 0, 0)('text')).toBe(`${E}38;2;255;0;0mtext${E}39m`);
        });

        await it('chalk.rgb chains with modifiers (underline)', () => {
            expect(chalk.rgb(255, 0, 0).underline('text')).toBe(`${E}38;2;255;0;0m${E}4mtext${E}24m${E}39m`);
        });

        await it('chalk.bgRgb emits 24-bit background SGR sequence', () => {
            // CSI 48;2;<r>;<g>;<b> m → close [49m
            expect(chalk.bgRgb(0, 128, 255)('text')).toBe(`${E}48;2;0;128;255mtext${E}49m`);
        });

        await it('chalk.hex parses a 6-digit hex into truecolor RGB', () => {
            expect(chalk.hex('#FF0000')('hello')).toBe(`${E}38;2;255;0;0mhello${E}39m`);
        });

        await it('chalk.bgHex parses a 6-digit hex into truecolor background', () => {
            expect(chalk.bgHex('#FF0000')('hello')).toBe(`${E}48;2;255;0;0mhello${E}49m`);
        });

        await it('chalk.ansi256 emits the 8-bit indexed foreground SGR', () => {
            // CSI 38;5;<idx> m → close [39m
            expect(chalk.ansi256(201)('text')).toBe(`${E}38;5;201mtext${E}39m`);
        });

        await it('chalk.bgAnsi256 emits the 8-bit indexed background SGR', () => {
            // CSI 48;5;<idx> m → close [49m
            expect(chalk.bgAnsi256(201)('text')).toBe(`${E}48;5;201mtext${E}49m`);
        });

        await it('rgb + bgRgb chain together with both close codes', () => {
            expect(chalk.rgb(255, 0, 0).bgRgb(0, 0, 255)('text')).toBe(
                `${E}38;2;255;0;0m${E}48;2;0;0;255mtext${E}49m${E}39m`,
            );
        });

        await it('hex chained with .bold composes the modifier reset', () => {
            expect(chalk.hex('#00FF00').bold('go')).toBe(`${E}38;2;0;255;0m${E}1mgo${E}22m${E}39m`);
        });

        await it('downsamples 24-bit hex to 4-bit on a level=1 instance', () => {
            // #FF0000 → bright red → SGR 91. Background → SGR 101.
            expect(new Chalk({ level: 1 }).hex('#FF0000')('hello')).toBe(`${E}91mhello${E}39m`);
            expect(new Chalk({ level: 1 }).bgHex('#FF0000')('hello')).toBe(`${E}101mhello${E}49m`);
        });

        await it('downsamples 24-bit hex to 8-bit on a level=2 instance', () => {
            // #FF0000 → ANSI-256 index 196.
            expect(new Chalk({ level: 2 }).hex('#FF0000')('hello')).toBe(`${E}38;5;196mhello${E}39m`);
            expect(new Chalk({ level: 2 }).bgHex('#FF0000')('hello')).toBe(`${E}48;5;196mhello${E}49m`);
        });

        await it('keeps 24-bit hex intact on a level=3 instance', () => {
            expect(new Chalk({ level: 3 }).bgHex('#FF0000')('hello')).toBe(`${E}48;2;255;0;0mhello${E}49m`);
        });
    });
};
