import '@gjsify/node-globals/register/process';
import { run } from '@gjsify/unit';
import { hasNativeTerminal } from '@gjsify/terminal-native';
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
 * The prebuild check is the whole probe. `hasNativeTerminal()` is false off GJS,
 * where `imports.gi` does not exist, and that leg has no terminal to watch
 * either — the same condition the reason below names — so there is nothing here
 * to reach GI for, and no reason to guard the guard.
 */
const NO_TTY = !hasNativeTerminal()
    ? 'the GjsifyTerminal prebuild is not installed, so no transition can be made'
    : process.stdin.isTTY
      ? ''
      : 'fd 0 is not a terminal on this host, so setRawMode changes nothing and can owe nothing';

const skip: Record<string, string> = NO_TTY
    ? {
          'setRawMode(true) records the debt Process exit pays': NO_TTY,
          'setRawMode(false) pays the debt instead of leaving a stale undo': NO_TTY,
      }
    : {};
// One skip of its own, and NOT the one above: this case needs a VERDICT, not a
// terminal. Off GJS there is no prebuild, so `setRawMode` has no transition to
// report and takes the env/GLib fallback, where `isRaw` follows the argument
// rather than the device — a different contract, asserted by the suites that own
// it. Guarding it with `NO_TTY` instead would hide it on the GJS leg too, where
// fd 999 is exactly the descriptor that answers false.
if (!hasNativeTerminal()) {
    skip['setRawMode leaves isRaw false when the transition did not happen'] =
        'the GjsifyTerminal prebuild is not installed, so there is no verdict to honour';
}

run({ testSuite, terminalFallbackTestSuite }, { skip });
