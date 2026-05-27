// Probe script — built with gjsify and run as GJS app.
// Prints a JSON object with terminal introspection results so run.mjs
// can assert correct behaviour with and without @gjsify/terminal-native.

import { isatty } from 'node:tty';
import process from 'node:process';
import { hasNativeTerminal } from '@gjsify/terminal-native';

// oxlint-disable-next-line typescript/no-explicit-any -- @gjsify/terminal-native extends process.stdout with .columns/.rows not in @types/node
const stdout = process.stdout as any;
// oxlint-disable-next-line typescript/no-explicit-any -- @gjsify/terminal-native extends process.stdin with .isTTY/.setRawMode not in @types/node
const stdin = process.stdin as any;

const result = {
    native_loaded: hasNativeTerminal(),
    isatty_stdout: isatty(1),
    isatty_result_type: typeof isatty(1),
    columns: typeof stdout.columns === 'number' ? stdout.columns : -1,
    rows: typeof stdout.rows === 'number' ? stdout.rows : -1,
    columns_positive: (stdout.columns ?? 0) > 0,
    rows_positive: (stdout.rows ?? 0) > 0,
    stdin_has_isTTY: 'isTTY' in stdin,
    stdin_has_setRaw: typeof stdin.setRawMode === 'function',
    set_raw_mode_ok: (() => {
        if (typeof stdin.setRawMode !== 'function') return 'no_setRawMode';
        try {
            // Only enter raw mode if stdin is actually a TTY; otherwise
            // tcgetattr returns an error and set_raw_mode returns false.
            if (!stdin.isTTY) return 'skipped_no_tty';
            stdin.setRawMode(true);
            stdin.setRawMode(false);
            return 'ok';
        } catch (e) {
            return String((e as Error)?.message ?? e);
        }
    })(),
};

// Use print() — the GJS built-in — so the output isn't mixed with console.log.
// oxlint-disable-next-line typescript/no-explicit-any -- print() is a GJS built-in not present in TypeScript's lib.dom.d.ts or @types/node
(globalThis as any).print(JSON.stringify(result));
