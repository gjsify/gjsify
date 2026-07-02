// SPDX-License-Identifier: MIT
//
// The @gjsify/node-gi cross-runtime proof: several unchanged `gi://` sources each
// build AND run with BYTE-IDENTICAL output on FOUR runtimes — gjs (native gi://),
// node, bun and deno (the `@gjsify/node-gi` reverse bridge, one Node-API binary).
//
//   gjsify build src/<s>.ts --app gjs   → gjs  -m dist/<s>.gjs.mjs
//   gjsify build src/<s>.ts --app node  → node|bun|deno  dist/<s>.node.mjs
//
// gjs is the reference; every other runtime must match it exactly AND the fixed
// golden below. A runtime not on PATH is skipped with a diagnostic, so this runs
// gjs+node in the light CI leg and all four where bun+deno are installed. Run via
// `node --test quad.e2e.mjs`. See harness.mjs for the build/run/compare mechanics.
import { test } from 'node:test';
import { runScenario, availableRuntimes } from './harness.mjs';

// The capstone: functions, enums/flags/constants, GObject construct + props +
// counted signals, a static+instance method, a registerClass subclass (custom
// property + signal + method + vfunc_constructed) and a bounded GLib main loop.
const CAPSTONE_GOLDEN = [
    'node-gi dual example',
    'basename-fn: gjs',
    'bus-session: 2',
    'priority-default: 0',
    'action-name: greet',
    'action-enabled: true',
    'action-enabled-after: false',
    'notify-count: 2',
    'file-basename: share',
    'counter: describe="built@10 count=12" bumps=2 constructed=1',
    'ticks: 3',
    'done',
].join('\n');

// GVariant build/deepUnpack, enums/flags, and deterministic GLib string helpers.
const VARIANTS_GOLDEN = [
    'node-gi variants example',
    'escape: &lt;a href=&quot;x&quot;&gt;&amp;',
    'sha256: 7d495005c88274b02f770a0002308018f14c9f68e7043f231d5de28758fe1e77',
    'filetype-dir: 2',
    'checksum-sha256: 2',
    'variant-tuple: type=(sib) s=node-gi i=42 b=true',
    'variant-dict: lang=typescript',
    'variant-string: hello-variant',
    'done',
].join('\n');

// Property round-trips, multi-handler notify + disconnect, a registerClass custom signal.
const SIGNALS_GOLDEN = [
    'node-gi signals example',
    'name: act',
    'enabled-after-set: false',
    'notify: a=2 b=3',
    'ping-total: 5',
    'done',
].join('\n');

const SCENARIOS = [
    { name: 'capstone', srcFile: 'src/app.ts', base: 'app', golden: CAPSTONE_GOLDEN },
    { name: 'variants', srcFile: 'src/variants.ts', base: 'variants', golden: VARIANTS_GOLDEN },
    { name: 'signals', srcFile: 'src/signals.ts', base: 'signals', golden: SIGNALS_GOLDEN },
];

test('quad-runtime: gi:// sources run byte-identically on gjs/node/bun/deno', async (t) => {
    t.diagnostic(`runtimes on PATH: ${availableRuntimes().join(', ')}`);
    for (const scenario of SCENARIOS) {
        await t.test(scenario.name, (st) => {
            const outputs = runScenario(st, scenario);
            st.diagnostic(`${scenario.name}: matched on ${Object.keys(outputs).join(', ')}`);
        });
    }
});
