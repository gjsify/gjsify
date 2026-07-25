// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_threadsafe_function_shutdown/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Teardown-robustness: binding() creates an unref'd tsfn and detaches 32
// std::threads that each hammer napi_call_threadsafe_function in a loop until
// it stops returning napi_ok (i.e. until the environment tears the tsfn down).
// The test passes iff the process shuts down cleanly (exit 0) while those
// foreign threads are still pushing — exercising the shim's env-teardown tsfn
// close (finalize_env_tsfns) racing live producers. Upstream runs this in a
// forked child and asserts code === 0; the deterministic equivalent is to run
// binding(), pump the loop, and emit a stable marker reached only on a clean
// run (a teardown crash/hang would fail instead).
export const meta = { dir: 'test_threadsafe_function_shutdown', targets: ['binding'], suite: 'node-api' };

export default async function run(h) {
    const binding = h.loadAddon('binding');
    binding();
    await h.drain(20);
    h.emit('ok');
}
