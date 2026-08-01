// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_threadsafe_function/test.js
// Original: Copyright (c) Node.js contributors. MIT.
//
// The headline Phase-1 cross-thread test: a native (libuv) producer thread
// pushes binding.ARRAY_LENGTH ints (9999..0) through the threadsafe function;
// the JS callback on the main thread collects them in order, then StopThread
// releases the tsfn and its finalizer (join_the_threads) resolves. This
// exercises napi_create/call/release_threadsafe_function plus the accessors
// napi_get_threadsafe_function_context (the producer reads the hint) — real
// foreign-thread → single JSContext marshalling via the GLib main context.
//
// The addon links libuv (uv_thread_create / uv_hrtime); the harness preloads
// the host libuv so it resolves at dlopen — the host's job, as Node embeds it.
//
// DROPPED (noted, not weakened):
//  - the fork()-based testUnref rapid-teardown cases — `gjs -m` has no
//    child_process/fork;
//  - the non-blocking busy-wait legs (StartThreadNonblocking) whose point is a
//    timing-dependent napi_queue_full — nondeterministic in-transcript (the
//    same-thread queue_full is asserted deterministically by the p1 tsfn gate);
//  - the max_queue_size=0 (unbounded) legs: the producer busy-waits 200 ms
//    every 1000 pushes, so completion is wall-clock/timing bound and does not
//    reliably drain under manual loop pumping even on the Node reference;
//  - the abort legs — they target the newer-node "finalizer after queue drain
//    on abort" behavior that the reference node here predates (see the removed
//    test_threadsafe_function_abort).
// The full-delivery, in-order blocking (bounded queue), no-native-marshaller
// and alternative-reference paths are ported in full.
export const meta = { dir: 'test_threadsafe_function', targets: ['binding'], suite: 'node-api', libuv: true };

export default async function run(h) {
    const binding = h.loadAddon('binding');
    const N = binding.ARRAY_LENGTH;
    const expected = Array.from({ length: N }, (_, i) => N - 1 - i);

    // Drive the main loop until `done()` (bounded so a stall fails loudly on
    // both runtimes rather than hanging).
    async function drainUntil(done) {
        for (let i = 0; i < 500000 && !done(); i++) await h.tick();
        return done();
    }

    // A JS-marshaller run: collect all values in order, then StopThread.
    async function runJS(starter, maxQueueSize) {
        const array = [];
        let resolved = false;
        binding[starter](
            function testCallback(value) {
                array.push(value);
                if (array.length === N) {
                    binding.StopThread(() => {
                        resolved = true;
                    }, false);
                }
            },
            false /* abort */,
            false /* launchSecondary */,
            maxQueueSize,
        );
        const ok = await drainUntil(() => resolved);
        const inOrder = array.length === expected.length && array.every((v, i) => v === expected[i]);
        return { finished: ok, len: array.length, inOrder, first: array[0], last: array[array.length - 1] };
    }

    const bounded = await runJS('StartThread', binding.MAX_QUEUE_SIZE);
    h.emit('blocking.bounded', bounded.finished, bounded.len, bounded.inOrder, bounded.first, bounded.last);

    // Alternative-reference marshaller (call_ref path): the js function is
    // passed but marshalled through a separate napi_ref, not the tsfn's own.
    const altRef = await runJS('StartThreadNoJsFunc', binding.MAX_QUEUE_SIZE);
    h.emit('alt-ref', altRef.finished, altRef.len, altRef.inOrder, altRef.first, altRef.last);

    // No-native-marshaller path (call_js == NULL → default call-into-JS with no
    // arguments). Count invocations; each receives zero arguments.
    {
        let count = 0;
        let zeroArgs = true;
        let resolved = false;
        binding.StartThreadNoNative(
            function testCallback() {
                count++;
                if (arguments.length !== 0) zeroArgs = false;
                if (count === N) {
                    binding.StopThread(() => {
                        resolved = true;
                    }, false);
                }
            },
            false,
            false,
            binding.MAX_QUEUE_SIZE,
        );
        const ok = await drainUntil(() => resolved);
        h.emit('no-native', ok, count, zeroArgs);
    }
}
