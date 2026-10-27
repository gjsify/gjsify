// SPDX-License-Identifier: MIT
// PoC harness — the Node leg. Run with the `wasm` import condition so `#host` resolves to
// host.wasm.js instead of host.node.js:
//
//   node --conditions=wasm docs/poc/gobject-wasm/harness/run-node.mjs
//
// NODE_GI_WASM_DIR points at the directory the build scripts emitted node_gi.mjs,
// node_gi.wasm and emnapi.mjs into (default ~/.cache/gjsify-wasm/out).
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { startEngine } from './engine.mjs';
import { runMilestones } from './milestones.mjs';

const outDir = process.env.NODE_GI_WASM_DIR ?? `${homedir()}/.cache/gjsify-wasm/out`;
const engineUrl = pathToFileURL(`${outDir}/node_gi.mjs`).href;

const { ms } = await startEngine(engineUrl);

const gi = await import('../../../../packages/node-gi/node-gi/gi.js');
const native = await import('../../../../packages/node-gi/node-gi/index.js');

const results = {
    host: 'node',
    engine_startup_ms: +ms.toFixed(2),
    ...(await runMilestones(gi, native, Number(process.env.POC_ITERATIONS ?? 200000))),
};
console.log(JSON.stringify(results, null, 2));
process.exit(0);
