import { describe, it, expect, assert, spy, on } from '@gjsify/unit';

import { Event, EventTarget } from "@gjsify/dom-events";
import process from 'process';

export const ErrorHandlerTest = async () => {
    await describe("The default error handler", async () => {

        // TODO: FIXME
        await on([], async () => {
            await it("should dispatch an ErrorEvent if a listener threw an error", async () => {
                const originalConsoleError = console.error
                const f = spy((_message, _source, _lineno, _colno, _error) => {})
                const consoleError = spy((..._: any[]) => {})
                const target = new EventTarget()
                const error = new Error("test error")
                target.addEventListener("foo", () => {
                    throw error
                })

                window.onerror = f

                try {
                    target.dispatchEvent(new Event("foo"))
                } finally {
                    window.onerror = null
                }

                assert.strictEqual(f.calls.length, 1, "f should be called.")
                // TODO: fails on Deno
                // assert.strictEqual(f.calls[0].arguments[0], error.message)
                // assert.strictEqual(f.calls[0].arguments[4], error)
                assert.strictEqual(
                    consoleError.calls.length,
                    1,
                    "console.error should be called.",
                )
                assert.strictEqual(consoleError.calls[0].arguments[0], error)
            })
        })

        // TODO: FIXME
        await on([], async () => {
            await it("should emit an uncaughtException event if a listener threw an error", async () => {
                const onUncaughtException = spy(_event => {})
                const target = new EventTarget()
                const error = new Error("test error")
                target.addEventListener("foo", () => {
                    throw error
                })

                process.on("uncaughtException", onUncaughtException)
                target.dispatchEvent(new Event("foo"))
                process.removeListener("uncaughtException", onUncaughtException);

                TODO: assert.strictEqual(onUncaughtException.calls.length, 1, "onUncaughtException should be called.")

                // TODO: this are currently not the same objects, see https://gitlab.gnome.org/GNOME/gjs/-/issues/523
                // assert.strictEqual(onUncaughtException.calls[0].arguments[0], error)
                TODO: expect(onUncaughtException.calls[0].arguments[0].message).toBe(error.message)
                TODO: expect(onUncaughtException.calls[0].arguments[0].stack?.trim()).toBe(error.stack?.trim())
            })
        })
    })
}