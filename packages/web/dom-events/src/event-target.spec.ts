import { describe, it, assert, Spy, spy, beforeEach } from '@gjsify/unit';

import { Event, EventTarget } from "@gjsify/dom-events";
import { AbortSignal } from "@gjsify/abort-controller";

export const EventTargetTest = async () => {
    await describe("EventTarget.constructor", async () => {

        await it("should not throw", async () => {
            assert(new EventTarget())
        })

        await it("should throw a TypeError if called as a function.", async () => {
            assert.throws(() => {
                // @ts-expect-error
                EventTarget() // eslint-disable-line new-cap
            }, TypeError)
        })
    })

    await describe("EventTarget.removeEventListener method", async () => {
        let target: EventTarget

        beforeEach(async () => {
            target = new EventTarget();
        });

        await it("should do nothing if callback is nothing.", async () => {
            target.removeEventListener("foo", null)
            target.removeEventListener("foo", undefined)
        })
    })

    await describe("EventTarget.dispatchEvent method", async () => {
        let target: EventTarget;

        beforeEach(async () => {
            target = new EventTarget();
        });

        await it("should throw a TypeError if the argument was not present", async () => {
            assert.throws(() => {
                // @ts-expect-error
                target.dispatchEvent()
            }, TypeError)
        })

        await it("should not throw even if listeners don't exist", async () => {
            const retv = target.dispatchEvent(new Event("foo"))
            assert.strictEqual(retv, true)
        })

        await it("should not throw even if empty object had been added", async () => {
            const f = {}
            target.addEventListener("foo", f as EventListener)
            const retv = target.dispatchEvent(new Event("foo"))
            assert.strictEqual(retv, true)
        })

        await it("should call obj.handleEvent method even if added later", async () => {
            const event = new Event("foo")
            const f: { handleEvent?: Spy<(event: Event) => void> } = {}
            target.addEventListener("foo", f as EventListener)
            f.handleEvent = spy()
            const retv = target.dispatchEvent(event)

            assert.strictEqual(
                f.handleEvent.calls.length,
                1,
                "handleEvent should be called",
            )
            assert.strictEqual(f.handleEvent.calls[0].this, f)
            assert.strictEqual(f.handleEvent.calls[0].arguments[0], event)
            assert.strictEqual(retv, true)
        })

        await it("should call a registered listener.", async () => {
            const f1 = spy((_event: Event) => {})
            const f2 = spy((_event: Event) => {})
            target.addEventListener("foo", f1)
            target.addEventListener("bar", f2)

            const event = new Event("foo")
            const retv = target.dispatchEvent(event)

            assert.strictEqual(f1.calls.length, 1, "foo should be called once")
            assert.strictEqual(
                f1.calls[0].arguments.length,
                1,
                "the argument of callback should be one",
            )
            assert.strictEqual(
                f1.calls[0].arguments[0],
                event,
                "the argument of callback should be the given Event object",
            )
            assert.strictEqual(f2.calls.length, 0, "bar should not be called")
            assert.strictEqual(retv, true)
        })

        await it("should not call subsequent listeners if a listener called `event.stopImmediatePropagation()`.", async () => {
            const f1 = spy((_event: Event) => {})
            const f2 = spy((event: Event) => {
                event.stopImmediatePropagation()
            })
            const f3 = spy((_event: Event) => {})
            const f4 = spy((_event: Event) => {})
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)
            target.addEventListener("foo", f4)

            const retv = target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called")
            assert.strictEqual(f3.calls.length, 0, "f3 should not be called")
            assert.strictEqual(f4.calls.length, 0, "f4 should not be called")
            assert.strictEqual(retv, true)
        })

        await it("should return true even if a listener called 'event.preventDefault()' if the event is not cancelable.", async () => {
            target.addEventListener("foo", event => {
                event.preventDefault()
            })
            const retv = target.dispatchEvent(new Event("foo"))

            assert.strictEqual(retv, true)
        })

        await it("should return false if a listener called 'event.preventDefault()' and the event is cancelable.", async () => {
            target.addEventListener("foo", event => {
                event.preventDefault()
            })
            const retv = target.dispatchEvent(
                new Event("foo", { cancelable: true }),
            )

            assert.strictEqual(retv, false)
        })

        await it("should return true even if a listener called 'event.preventDefault()' if passive option is present.", async () => {
            target.addEventListener(
                "foo",
                event => {
                    event.preventDefault()
                },
                { passive: true },
            )
            const retv = target.dispatchEvent(
                new Event("foo", { cancelable: true }),
            )

            assert.strictEqual(retv, true)
        })

        await it("should return false if a listener called 'event.returnValue = false' and the event is cancelable.", async () => {
            target.addEventListener("foo", event => {
                event.returnValue = false
            })
            const retv = target.dispatchEvent(
                new Event("foo", { cancelable: true }),
            )

            assert.strictEqual(retv, false)
        })

        await it("should remove a listener if once option is present.", async () => {
            const f1 = spy()
            const f2 = spy()
            const f3 = spy()
            target.addEventListener("foo", f1, { once: true })
            target.addEventListener("foo", f2, { once: true })
            target.addEventListener("foo", f3, { once: true })

            const retv = target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called once")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called once")
            assert.strictEqual(f3.calls.length, 1, "f3 should be called once")
            assert.strictEqual(retv, true)
        })

        await it("should handle removing in event listeners correctly. Remove 0 at 0.", async () => {
            const f1 = spy(() => {
                target.removeEventListener("foo", f1)
            })
            const f2 = spy()
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called once")
            assert.strictEqual(f2.calls.length, 2, "f2 should be called twice")
            assert.strictEqual(f3.calls.length, 2, "f3 should be called twice")
        })

        await it("should handle removing in event listeners correctly. Remove 1 at 0.", async () => {
            const f1 = spy(() => {
                target.removeEventListener("foo", f2)
            })
            const f2 = spy()
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 0, "f2 should not be called")
            assert.strictEqual(f3.calls.length, 2, "f3 should be called twice")
        })

        await it("should handle removing in event listeners correctly. Remove 0 at 1.", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.removeEventListener("foo", f1)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called once")
            assert.strictEqual(f2.calls.length, 2, "f2 should be called twice")
            assert.strictEqual(f3.calls.length, 2, "f3 should be called twice")
        })

        await it("should handle removing in event listeners correctly. Remove 1 at 1.", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.removeEventListener("foo", f2)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called once")
            assert.strictEqual(f3.calls.length, 2, "f3 should be called twice")
        })

        await it("should handle removing in event listeners correctly. Remove 2 at 1.", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.removeEventListener("foo", f3)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 2, "f2 should be called twice")
            assert.strictEqual(f3.calls.length, 0, "f3 should be not called")
        })

        await it("should handle removing in event listeners correctly. Remove 2 at 2.", async () => {
            const f1 = spy()
            const f2 = spy()
            const f3 = spy(() => {
                target.removeEventListener("foo", f3)
            })
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 2, "f2 should be called twice")
            assert.strictEqual(f3.calls.length, 1, "f3 should be called once")
        })

        await it("should handle removing in event listeners correctly along with once flag.", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.removeEventListener("foo", f2)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2, { once: true })
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called once")
            assert.strictEqual(f3.calls.length, 2, "f3 should be called twice")
        })

        await it("should handle removing in event listeners correctly along with once flag. (2)", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.removeEventListener("foo", f3)
            })
            const f3 = spy()
            const f4 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2, { once: true })
            target.addEventListener("foo", f3)
            target.addEventListener("foo", f4)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called once")
            assert.strictEqual(f3.calls.length, 0, "f3 should not be called")
            assert.strictEqual(f4.calls.length, 2, "f4 should be called twice")
        })

        await it("should handle removing once and remove", async () => {
            const f1 = spy(() => {
                target.removeEventListener("foo", f1)
            })
            target.addEventListener("foo", f1, { once: true })

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called once")
        })

        await it("should handle once in nested dispatches", async () => {
            const f1 = spy(() => {
                target.dispatchEvent(new Event("foo"))
                assert.strictEqual(
                    f2.calls.length,
                    1,
                    "f2 should be called only once",
                )
            })
            const f2 = spy()
            target.addEventListener("foo", f1, { once: true })
            target.addEventListener("foo", f2, { once: true })

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(
                f1.calls.length,
                1,
                "f1 should be called only once",
            )
            assert.strictEqual(
                f2.calls.length,
                1,
                "f2 should be called only once",
            )
        })

        await it("should not call the listeners that were added after the 'dispatchEvent' method call.", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.addEventListener("foo", f3)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 2, "f2 should be called twice")
            assert.strictEqual(f3.calls.length, 1, "f3 should be called once")
        })

        await it("should not call the listeners that were added after the 'dispatchEvent' method call. (the last listener is removed at first dispatch)", async () => {
            const f1 = spy()
            const f2 = spy(() => {
                target.addEventListener("foo", f3)
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2, { once: true })

            target.dispatchEvent(new Event("foo"))
            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 2, "f1 should be called twice")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called once")
            assert.strictEqual(f3.calls.length, 1, "f3 should be called once")
        })

        await it("should catch exceptions that are thrown from listeners and call the error handler.", async () => {
            const error = new Error("test")
            const f1 = spy()
            const f2 = spy(() => {
                throw error
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called")
            // TODO: Fixme
            // assert.strictEqual(f3.calls.length, 1, "f3 should be called")
        })

        await it("should catch exceptions that are thrown from listeners and call the error handler, even if the exception was not an Error object.", async () => {
            const error = "error"
            const f1 = spy()
            const f2 = spy(() => {
                throw error
            })
            const f3 = spy()
            target.addEventListener("foo", f1)
            target.addEventListener("foo", f2)
            target.addEventListener("foo", f3)

            target.dispatchEvent(new Event("foo"))

            assert.strictEqual(f1.calls.length, 1, "f1 should be called")
            assert.strictEqual(f2.calls.length, 1, "f2 should be called")
            // TODO: Fixme
            // assert.strictEqual(f3.calls.length, 1, "f3 should be called")
        })

        await it("should throw a InvalidStateError if the given event is being used", async () => {
            const event = new Event("foo")
            const f = spy(() => {
                target.dispatchEvent(event)
            })
            target.addEventListener("foo", f, { once: true })
            target.dispatchEvent(event)

            assert.strictEqual(f.calls.length, 1, "f should be called")
            assert.strictEqual(f.calls[0].type, "throw" as const)
            assert.strictEqual(f.calls[0].throw.name, "InvalidStateError")
            assert.strictEqual(f.calls[0].throw.code, 11)
            // assertError("This event has been in dispatching.")
        })

        await it("should not call event listeners if given event was stopped", async () => {
            const event = new Event("foo")
            const f = spy()

            event.stopPropagation()
            target.addEventListener("foo", f)
            target.dispatchEvent(event)

            assert.strictEqual(f.calls.length, 0, "f should not be called")
        })
    })
}