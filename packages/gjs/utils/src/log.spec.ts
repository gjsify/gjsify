import { describe } from '@gjsify/unit';
// import { logSignals } from '@gjsify/utils';
// import type { StructuredLogData } from '@gjsify/utils';

const _createUncaughtException = async () => {
    throw new Error('top level error');
};

const _sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export default async () => {
    await describe('logSignals', async () => {
        // TODO(open-todos: logSignals has no test): `it.failing` is NOT the tool
        // here, which is why this one outlived the sweep that retired its
        // eleven siblings. The spec below deliberately produces an UNHANDLED
        // REJECTION (`createUncaughtException()` is called without `await` —
        // that is the event it is testing for), and an unhandled rejection is
        // raised outside the callback's promise chain: `it.failing` cannot
        // catch it, and on Node the default handler terminates the process. So
        // reviving it as-is would not park a failure, it would make the whole
        // `@gjsify/utils` suite non-deterministic.
        // What it needs is a real design — install a temporary
        // rejection handler, assert the signal fired, restore — which is a
        // test to WRITE, not a marker to convert.
        // await it("should emit an uncaughtException event on a top level throw", async () => {
        //     const onUnhandledRejection = spy((_self, _data: StructuredLogData, _promiseData) => {});
        //     const signalHandlerId = logSignals.connect("unhandledRejection", onUnhandledRejection);
        // 	createUncaughtException();
        // 	await sleep(10);
        //     logSignals.disconnect(signalHandlerId)
        //     assert.strictEqual(onUnhandledRejection.calls.length, 1, "onUnhandledRejection should be called.")
        //     // assert.strictEqual(onUnhandledRejection.calls[0].arguments[0], error)
        // })
    });
};
