// SPDX-License-Identifier: MIT
// Ported from chalk upstream test/level.js + test/instance.js
// (https://github.com/chalk/chalk/blob/main/test/level.js /instance.js —
// the published tarball strips test/, so the upstream URL is the canonical
// source).
// Original: Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>. MIT.
// Rewritten for @gjsify/unit — behavior preserved, AVA dialect adapted.
//
// Validates the level-gating contract: chalk.level controls whether ANSI
// escape codes are emitted, propagates from chain children back to the
// root, and is honoured by isolated `new Chalk({ level })` instances.
//
// The upstream `execaNode(_fixture.js)` case that asserts "colors disabled
// when not supported by the TTY" is intentionally omitted here — it
// exercises supports-color's spawn-time TTY probe, which the suite already
// covers structurally by asserting that level=0 strips every emit path.
// The actual @gjsify/{tty,process} integration is unit-tested in those
// packages directly. (See `status/integration-coverage.md` → chalk.)

import { describe, it, expect } from '@gjsify/unit';
import chalk, { Chalk } from 'chalk';

// CSI prefix shorthand (ESC + '['). Keeping assertions readable while
// preserving exact byte-equality with chalk's emitted ANSI sequences.
const E = '[';

export default async () => {
    await describe('chalk — level gating', async () => {
        await it('does not output colors when chalk.level = 0', () => {
            const oldLevel = chalk.level;
            chalk.level = 0;
            try {
                expect(chalk.red('foo')).toBe('foo');
                expect(chalk.bgBlue.underline('bar')).toBe('bar');
                expect(chalk.rgb(255, 0, 0)('rgb')).toBe('rgb');
                expect(chalk.hex('#FF0000')('hex')).toBe('hex');
                expect(chalk.ansi256(201)('a256')).toBe('a256');
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('outputs basic 4-bit codes when chalk.level = 1', () => {
            const oldLevel = chalk.level;
            chalk.level = 1;
            try {
                expect(chalk.red('foo')).toBe(`${E}31mfoo${E}39m`);
                // 24-bit truecolor request downsampled to 4-bit (bright red).
                expect(chalk.hex('#FF0000')('foo')).toBe(`${E}91mfoo${E}39m`);
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('outputs 8-bit codes when chalk.level = 2', () => {
            const oldLevel = chalk.level;
            chalk.level = 2;
            try {
                expect(chalk.red('foo')).toBe(`${E}31mfoo${E}39m`);
                expect(chalk.hex('#FF0000')('foo')).toBe(`${E}38;5;196mfoo${E}39m`);
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('outputs 24-bit truecolor when chalk.level = 3', () => {
            const oldLevel = chalk.level;
            chalk.level = 3;
            try {
                expect(chalk.red('foo')).toBe(`${E}31mfoo${E}39m`);
                expect(chalk.hex('#FF0000')('foo')).toBe(`${E}38;2;255;0;0mfoo${E}39m`);
                expect(chalk.rgb(0, 128, 255).bold('go')).toBe(`${E}38;2;0;128;255m${E}1mgo${E}22m${E}39m`);
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('enables/disables on the global chalk.level, not per-chain', () => {
            const oldLevel = chalk.level;
            chalk.level = 1;
            try {
                const { red } = chalk;
                expect(red.level).toBe(1);
                chalk.level = 0;
                expect(red.level).toBe(chalk.level);
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('propagates level changes from a child color back to chalk', () => {
            const oldLevel = chalk.level;
            chalk.level = 1;
            try {
                const { red } = chalk;
                expect(red.level).toBe(1);
                expect(chalk.level).toBe(1);
                red.level = 0;
                expect(red.level).toBe(0);
                expect(chalk.level).toBe(0);
                chalk.level = 1;
                expect(red.level).toBe(1);
                expect(chalk.level).toBe(1);
            } finally {
                chalk.level = oldLevel;
            }
        });

        await it('strips a multi-style chain output when level = 0', () => {
            const oldLevel = chalk.level;
            chalk.level = 0;
            try {
                // The whole point of the level=0 contract — every chain stage
                // becomes a no-op and the final output equals the input.
                const decorated = chalk.red.bgGreen.underline.bold('multi-style payload');
                expect(decorated).toBe('multi-style payload');
                // Make sure the ESC char () appears nowhere.
                expect(decorated.indexOf('')).toBe(-1);
            } finally {
                chalk.level = oldLevel;
            }
        });
    });

    await describe('chalk — isolated Chalk({ level }) instances', async () => {
        await it('creates an isolated context where colors are disabled', () => {
            chalk.level = 1;
            const instance = new Chalk({ level: 0 });
            // Instance is silenced; global chalk still emits.
            expect(instance.red('foo')).toBe('foo');
            expect(chalk.red('foo')).toBe(`${E}31mfoo${E}39m`);
            instance.level = 2;
            expect(instance.red('foo')).toBe(`${E}31mfoo${E}39m`);
        });

        await it('validates `level` is an integer in [0, 3]', () => {
            expect(() => {
                new Chalk({ level: 10 });
            }).toThrow();
            expect(() => {
                new Chalk({ level: -1 });
            }).toThrow();
        });

        await it('accepts every valid level (0, 1, 2, 3)', () => {
            // Constructor must not throw for any of the four valid levels.
            for (const lvl of [0, 1, 2, 3] as const) {
                const inst = new Chalk({ level: lvl });
                expect(inst.level).toBe(lvl);
            }
        });

        await it('isolated instance level=0 strips all chain output', () => {
            const inst = new Chalk({ level: 0 });
            expect(inst.red.bgBlue.bold.underline('payload')).toBe('payload');
            expect(inst.rgb(255, 0, 0)('truecolor')).toBe('truecolor');
        });

        await it('isolated instance level=3 keeps 24-bit truecolor', () => {
            const inst = new Chalk({ level: 3 });
            expect(inst.hex('#00FF00')('go')).toBe(`${E}38;2;0;255;0mgo${E}39m`);
            expect(inst.bgHex('#00FF00')('go')).toBe(`${E}48;2;0;255;0mgo${E}49m`);
        });
    });
};
