// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_threadsafe_function_shutdown/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// binding() creates an unref'd tsfn and detaches 32 std::threads that hammer
// napi_call_threadsafe_function until it stops returning napi_ok, i.e. until the
// env tears the tsfn down. Passes iff shutdown is clean while those foreign
// threads are still pushing — finalize_env_tsfns racing live producers. Upstream
// forks a child and asserts code === 0; the deterministic equivalent is to pump
// the loop and emit a marker only a clean run reaches.
export const meta = { dir: 'test_threadsafe_function_shutdown', targets: ['binding'], suite: 'node-api' };

export default async function run(h) {
    const binding = h.loadAddon('binding');
    binding();
    await h.drain(20);
    h.emit('ok');
}
