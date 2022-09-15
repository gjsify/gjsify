import { describe, it, expect, assert, spy } from '@gjsify/unit';

// https://github.com/mysticatea/spy/blob/master/test/index.ts
export default async () => {

    await describe("'spy' function", async () => {
        await it("should return a function.", async () => {
            const f = spy()
            f()
            assert.strictEqual(typeof f, "function")
        })

        await it("should return a function which calls the given function.", async () => {
            let called = false
            const f = spy(() => {
                called = true
            })
            f()
            assert.strictEqual(called, true)
        })

        await it("should return a function which calls the given method.", async () => {
            const box = {
                value: 0,
                set(value: number): void {
                    this.value = value
                },
            }
            box.set = spy(box.set)

            box.set(1)
            assert.strictEqual(box.value, 1)
        })

        await it("should return a function which return the return value of the given function.", async () => {
            const f = spy(() => 777)
            const retv = f()
            assert.strictEqual(retv, 777)
        })

        await it("should return a function which throw the thrown error of the given function.", async () => {
            const f = spy(() => {
                throw 666 //eslint-disable-line no-throw-literal
            })
            let error: any = undefined
            try {
                f()
            } catch (e) {
                error = e
            }
            assert.strictEqual(error, 666)
        })
    });

    await describe("Spy.calls property", async () => {
        await it("should be an array.", async () => {
            const f = spy()
            assert(Array.isArray(f.calls))
        })

        await it("should be empty before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.calls.length, 0)
        })

        await it("should contain call information after called one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.calls.length, 1)
            assert.deepStrictEqual(f.calls[0], {
                type: "return",
                this: undefined,
                arguments: [],
                return: undefined,
            })
        })

        await it("should contain call information after called one time -- with args.", async () => {
            const f = spy()
            f.call(1, 2, 3)
            assert.strictEqual(f.calls.length, 1)
            assert.deepStrictEqual(f.calls[0], {
                type: "return",
                this: 1,
                arguments: [2, 3],
                return: undefined,
            })
        })

        await it("should contain call information after called one time -- with args and return value.", async () => {
            const f = spy(() => -1)
            f.call(1, 2, 3)
            assert.strictEqual(f.calls.length, 1)
            assert.deepStrictEqual(f.calls[0], {
                type: "return",
                this: 1,
                arguments: [2, 3],
                return: -1,
            })
        })

        await it("should contain call information after called two times -- with args and return value.", async () => {
            const f = spy(() => -1)
            f.call(1, 2, 3)
            f.call(4, 5)
            assert.strictEqual(f.calls.length, 2)
            assert.deepStrictEqual(f.calls[0], {
                type: "return",
                this: 1,
                arguments: [2, 3],
                return: -1,
            })
            assert.deepStrictEqual(f.calls[1], {
                type: "return",
                this: 4,
                arguments: [5],
                return: -1,
            })
        })

        await it("should contain call information regardless returned or thrown.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.calls.length, 2)
            assert.deepStrictEqual(f.calls[0], {
                type: "return",
                this: undefined,
                arguments: [false],
                return: 1,
            })
            assert.deepStrictEqual(f.calls[1], {
                type: "throw",
                this: undefined,
                arguments: [true],
                throw: -1,
            })
        })
    });

    await describe("Spy.firstCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.firstCall, null)
        })

        await it("should be 'f.calls[0]' after calling the spy one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.firstCall, f.calls[0])
        })

        await it("should be 'f.calls[0]' after calling the spy two times.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.firstCall, f.calls[0])
        })
    });

    await describe("Spy.lastCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.lastCall, null)
        })

        await it("should be 'f.calls[f.calls.length - 1]' after calling the spy one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.lastCall, f.calls[f.calls.length - 1])
        })

        await it("should be 'f.calls[f.calls.length - 1]' after calling the spy two times.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.lastCall, f.calls[f.calls.length - 1])
        })
    });

    await describe("Spy.returnedCalls property", async () => {
        await it("should be an array.", async () => {
            const f = spy()
            assert(Array.isArray(f.returnedCalls))
        })

        await it("should be empty before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.returnedCalls.length, 0)
        })

        await it("should contain call information that `call.type === 'return'` in `f.calls` after calling the spy one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.returnedCalls.length, 1)
            assert.strictEqual(f.returnedCalls[0], f.calls[0])
        })

        await it("should contain call information that `call.type === 'return'` in `f.calls` after calling the spy two times.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.returnedCalls.length, 2)
            assert.strictEqual(f.returnedCalls[0], f.calls[0])
            assert.strictEqual(f.returnedCalls[1], f.calls[1])
        })

        await it("should not contain call information that `call.type === 'throw'`.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            assert.strictEqual(f.calls.length, 3)
            assert.strictEqual(f.returnedCalls.length, 2)
            assert.strictEqual(f.returnedCalls[0], f.calls[0])
            assert.strictEqual(f.returnedCalls[1], f.calls[2])
        })

        await it("should not contain call information that `call.type === 'throw'`. (2)", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.calls.length, 3)
            assert.strictEqual(f.returnedCalls.length, 1)
            assert.strictEqual(f.returnedCalls[0], f.calls[1])
        })
    });

    await describe("Spy.firstReturnedCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.firstReturnedCall, null)
        })

        await it("should be 'f.returnedCalls[0]' after calling the spy one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.firstReturnedCall, f.returnedCalls[0])
        })

        await it("should be 'f.returnedCalls[0]' after calling the spy two times.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.firstReturnedCall, f.returnedCalls[0])
        })

        await it("should be 'f.returnedCalls[0]' after calling the spy even if `f.calls[0]` was thrown.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            assert.strictEqual(f.firstReturnedCall, f.returnedCalls[0])
        })

        await it("should be null after calling the spy even if all calls were thrown.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.firstReturnedCall, null)
        })
    });

    await describe("Spy.lastReturnedCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.lastReturnedCall, null)
        })

        await it("should be 'f.returnedCalls[f.returnedCalls.length - 1]' after calling the spy one time.", async () => {
            const f = spy()
            f()
            assert.strictEqual(
                f.lastReturnedCall,
                f.returnedCalls[f.returnedCalls.length - 1],
            )
        })

        await it("should be 'f.returnedCalls[f.returnedCalls.length - 1]' after calling the spy two times.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(
                f.lastReturnedCall,
                f.returnedCalls[f.returnedCalls.length - 1],
            )
        })

        await it("should be 'f.returnedCalls[f.returnedCalls.length - 1]' after calling the spy even if `f.calls[f.calls.length - 1]` was thrown.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(
                f.lastReturnedCall,
                f.returnedCalls[f.returnedCalls.length - 1],
            )
        })

        await it("should be null after calling the spy even if all calls were thrown.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.lastReturnedCall, null)
        })
    });

    await describe("Spy.thrownCalls property", async () => {
        await it("should be an array.", async () => {
            const f = spy()
            assert(Array.isArray(f.thrownCalls))
        })

        await it("should be empty before calling the spy.", async () => {
            const f = spy()
            assert.strictEqual(f.thrownCalls.length, 0)
        })

        await it("should contain call information that `call.type === 'throw'` in `f.calls` after calling the spy one time.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(f.thrownCalls.length, 1)
            assert.strictEqual(f.thrownCalls[0], f.calls[0])
        })

        await it("should contain call information that `call.type === 'throw'` in `f.calls` after calling the spy two times.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(f.thrownCalls.length, 2)
            assert.strictEqual(f.thrownCalls[0], f.calls[0])
            assert.strictEqual(f.thrownCalls[1], f.calls[1])
        })

        await it("should not contain call information that `call.type === 'return'`.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.calls.length, 3)
            assert.strictEqual(f.thrownCalls.length, 2)
            assert.strictEqual(f.thrownCalls[0], f.calls[0])
            assert.strictEqual(f.thrownCalls[1], f.calls[2])
        })

        await it("should not contain call information that `call.type === 'return'`. (2)", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            assert.strictEqual(f.calls.length, 3)
            assert.strictEqual(f.thrownCalls.length, 1)
            assert.strictEqual(f.thrownCalls[0], f.calls[1])
        })
    });

    await describe("Spy.firstThrownCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            assert.strictEqual(f.firstThrownCall, null)
        })

        await it("should be 'f.thrownCalls[0]' after calling the spy one time.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(f.firstThrownCall, f.thrownCalls[0])
        })

        await it("should be 'f.thrownCalls[0]' after calling the spy two times.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(f.firstThrownCall, f.thrownCalls[0])
        })

        await it("should be 'f.thrownCalls[0]' after calling the spy even if `f.calls[0]` was returned.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            f(false)
            try {
                f(true)
            } catch {
                // ignore
            }
            assert.strictEqual(f.firstThrownCall, f.thrownCalls[0])
        })

        await it("should be null after calling the spy even if all calls were returned.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.firstThrownCall, null)
        })
    });

    await describe("Spy.lastThrownCall property", async () => {
        await it("should be null before calling the spy.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            assert.strictEqual(f.lastThrownCall, null)
        })

        await it("should be 'f.thrownCalls[f.thrownCalls.length - 1]' after calling the spy one time.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(
                f.lastThrownCall,
                f.thrownCalls[f.thrownCalls.length - 1],
            )
        })

        await it("should be 'f.thrownCalls[f.thrownCalls.length - 1]' after calling the spy two times.", async () => {
            const f = spy(() => {
                throw new Error()
            })
            try {
                f()
            } catch {
                // ignore
            }
            try {
                f()
            } catch {
                // ignore
            }
            assert.strictEqual(
                f.lastThrownCall,
                f.thrownCalls[f.thrownCalls.length - 1],
            )
        })

        await it("should be 'f.thrownCalls[f.thrownCalls.length - 1]' after calling the spy even if `f.calls[f.calls.length - 1]` was returned.", async () => {
            const f = spy((toThrow: boolean) => {
                if (toThrow) {
                    throw -1 //eslint-disable-line no-throw-literal
                }
                return 1
            })
            try {
                f(true)
            } catch {
                // ignore
            }
            f(false)
            assert.strictEqual(
                f.lastThrownCall,
                f.thrownCalls[f.thrownCalls.length - 1],
            )
        })

        await it("should be null after calling the spy even if all calls were returned.", async () => {
            const f = spy()
            f()
            f()
            assert.strictEqual(f.lastThrownCall, null)
        })
    });

    await describe("Spy.reset method", async () => {
        await it("should be a function.", async () => {
            const f = spy()
            assert.strictEqual(typeof f.reset, "function")
        })

        await it("should do nothing before calling the spy.", async () => {
            const f = spy()
            f.reset()
            assert.strictEqual(f.calls.length, 0)
        })

        await it("should clear `f.calls`.", async () => {
            const f = spy()
            f()
            assert.strictEqual(f.calls.length, 1)
            f.reset()
            assert.strictEqual(f.calls.length, 0)
            assert.strictEqual(f.calls[0], undefined)
        })
    });

    await describe("Spy.toString method", async () => {
        await it("should be a function.", async () => {
            const f = spy()
            assert.strictEqual(typeof f.toString, "function")
        })

        await it("should return the original function with a comment. (noop)", async () => {
            const f = spy()
            assert.strictEqual(f.toString(), "/* The spy of */ function(){}")
        })

        await it("should return the original function with a comment. (with f)", async () => {
            const f0 = function original(): number {
                return 777
            }
            const f = spy(f0)
            assert.strictEqual(f.toString(), `/* The spy of */ ${f0}`)
        })
    });
}