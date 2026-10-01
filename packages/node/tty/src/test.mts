import '@gjsify/node-globals/register/process';
import { run } from '@gjsify/unit';
import { hasNativeTerminal } from '@gjsify/terminal-native';
import { isatty } from './index.js';
import testSuite from './index.spec.js';
import terminalFallbackTestSuite from './terminal-fallback.gjs.spec.js';

/**
 * Why the two `setRawMode` wiring tests stand down on this host, or `''` when it
 * can run them. A claim exists only where the transition really happened, and
 * `set_raw_mode` returns false for anything that is not a terminal — so with no
 * TTY on fd 0 there is no debt to observe, and asserting anyway would assert the
 * bug. Stated as a skip with its reason rather than run green having checked
 * nothing.
 *
 * The catch is a real failure mode, not a shrug: both probes reach GI, which the
 * Node leg's host has no way to answer, and a leg that cannot answer has no
 * terminal to watch — the same condition the reason below names.
 */
function noTtyReason(): string {
    let prebuild = false;
    let tty = false;
    try {
        prebuild = hasNativeTerminal();
        tty = prebuild && isatty(0);
    } catch {
        /* no GI on this leg */
    }
    if (tty) return '';
    return prebuild
        ? 'fd 0 is not a terminal on this host, so setRawMode changes nothing and can owe nothing'
        : 'the GjsifyTerminal prebuild is not installed, so no transition can be made';
}

const NO_TTY = noTtyReason();

const skip: Record<string, string> = NO_TTY
    ? {
          'setRawMode(true) records the debt Process exit pays': NO_TTY,
          'setRawMode(false) pays the debt instead of leaving a stale undo': NO_TTY,
      }
    : {};

run({ testSuite, terminalFallbackTestSuite }, { skip });
