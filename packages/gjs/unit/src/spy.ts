// https://github.com/mysticatea/spy

/** Spy. */
export type Spy<T extends (...args: any[]) => any> = T & Spy.CallInformation<T>

export namespace Spy {
    /** Information for calls on a spy. */
    export interface CallInformation<T extends (...args: any[]) => any> {
        /** Information for each call. */
        readonly calls: ReadonlyArray<Call<T>>

        /** Information for each returned call. */
        readonly returnedCalls: ReadonlyArray<ReturnedCall<T>>

        /** Information for each thrown call. */
        readonly thrownCalls: ReadonlyArray<ThrownCall<T>>

        /** Information of the first call. */
        readonly firstCall: Call<T> | null

        /** Information of the last call. */
        readonly lastCall: Call<T> | null

        /** Information of the first returned call. */
        readonly firstReturnedCall: ReturnedCall<T> | null

        /** Information of the last returned call. */
        readonly lastReturnedCall: ReturnedCall<T> | null

        /** Information of the first thrown call. */
        readonly firstThrownCall: ThrownCall<T> | null

        /** Information of the last thrown call. */
        readonly lastThrownCall: ThrownCall<T> | null

        /** Reset calls. */
        reset(): void
    }

    /** Information for each call. */
    export type Call<T extends (...args: any[]) => any> =
        | ReturnedCall<T>
        | ThrownCall<T>

    /** Information for each returned call. */
    export interface ReturnedCall<T extends (...args: any[]) => any> {
        type: "return"
        this: This<T>
        arguments: Parameters<T>
        return: ReturnType<T>
    }

    /** Information for each thrown call. */
    export interface ThrownCall<T extends (...args: any[]) => any> {
        type: "throw"
        this: This<T>
        arguments: Parameters<T>
        throw: any
    }
}

type This<T> = T extends (this: infer TT, ...args: any[]) => any
    ? TT
    : undefined

/**
 * Create a spy.
 */
export function spy(): Spy<() => void>

/**
 * Create a spy with a certain behavior.
 * @param f The function of the spy's behavior.
 */
export function spy<T extends (...args: any[]) => any>(f: T): Spy<T>

// Implementation
export function spy<T extends (...args: any[]) => any>(f?: T): Spy<T> {
    const calls = [] as Spy.Call<T>[]

    function spy(this: This<T>, ...args: Parameters<T>): ReturnType<T> {
        let retv: ReturnType<T>
        try {
            retv = f ? f.apply(this, args) : undefined
        } catch (error) {
            calls.push({
                type: "throw",
                this: this,
                arguments: args,
                throw: error,
            })
            throw error
        }

        calls.push({
            type: "return",
            this: this,
            arguments: args,
            return: retv,
        })

        return retv
    }

    Object.defineProperties(spy, {
        calls: descriptors.calls(calls),
        returnedCalls: descriptors.returnedCalls,
        thrownCalls: descriptors.thrownCalls,
        firstCall: descriptors.firstCall,
        lastCall: descriptors.lastCall,
        firstReturnedCall: descriptors.firstReturnedCall,
        lastReturnedCall: descriptors.lastReturnedCall,
        firstThrownCall: descriptors.firstThrownCall,
        lastThrownCall: descriptors.lastThrownCall,
        reset: descriptors.reset,
        toString: descriptors.toString(f),
    })

    return spy as Spy<T>
}

const descriptors = {
    calls(value: ReadonlyArray<Spy.Call<any>>): PropertyDescriptor {
        return { value, configurable: true }
    },

    returnedCalls: {
        get: function returnedCalls(
            this: Spy.CallInformation<any>,
        ): ReadonlyArray<Spy.ReturnedCall<any>> {
            return this.calls.filter(isReturned)
        },
        configurable: true,
    } as PropertyDescriptor,

    thrownCalls: {
        get: function thrownCalls(
            this: Spy.CallInformation<any>,
        ): ReadonlyArray<Spy.ThrownCall<any>> {
            return this.calls.filter(isThrown)
        },
        configurable: true,
    } as PropertyDescriptor,

    firstCall: {
        get: function firstCall(
            this: Spy.CallInformation<any>,
        ): Spy.Call<any> | null {
            return this.calls[0] || null
        },
        configurable: true,
    } as PropertyDescriptor,

    lastCall: {
        get: function lastCall(
            this: Spy.CallInformation<any>,
        ): Spy.Call<any> | null {
            return this.calls[this.calls.length - 1] || null
        },
        configurable: true,
    } as PropertyDescriptor,

    firstReturnedCall: {
        get: function firstReturnedCall(
            this: Spy.CallInformation<any>,
        ): Spy.ReturnedCall<any> | null {
            for (let i = 0; i < this.calls.length; ++i) {
                const call = this.calls[i]
                if (isReturned(call)) {
                    return call
                }
            }
            return null
        },
        configurable: true,
    } as PropertyDescriptor,

    lastReturnedCall: {
        get: function lastReturnedCall(
            this: Spy.CallInformation<any>,
        ): Spy.ReturnedCall<any> | null {
            for (let i = this.calls.length - 1; i >= 0; --i) {
                const call = this.calls[i]
                if (isReturned(call)) {
                    return call
                }
            }
            return null
        },
        configurable: true,
    } as PropertyDescriptor,

    firstThrownCall: {
        get: function firstThrownCall(
            this: Spy.CallInformation<any>,
        ): Spy.ThrownCall<any> | null {
            for (let i = 0; i < this.calls.length; ++i) {
                const call = this.calls[i]
                if (isThrown(call)) {
                    return call
                }
            }
            return null
        },
        configurable: true,
    } as PropertyDescriptor,

    lastThrownCall: {
        get: function lastThrownCall(
            this: Spy.CallInformation<any>,
        ): Spy.ThrownCall<any> | null {
            for (let i = this.calls.length - 1; i >= 0; --i) {
                const call = this.calls[i]
                if (isThrown(call)) {
                    return call
                }
            }
            return null
        },
        configurable: true,
    } as PropertyDescriptor,

    reset: {
        value: function reset(this: Spy.CallInformation<any>): void {
            ;(this.calls as any[]).length = 0
        },
        configurable: true,
    } as PropertyDescriptor,

    toString(f: ((...args: any[]) => any) | undefined): PropertyDescriptor {
        return {
            value: function toString() {
                return `/* The spy of */ ${f ? f.toString() : "function(){}"}`
            },
            configurable: true,
        }
    },
}

function isReturned(call: Spy.Call<any>): call is Spy.ReturnedCall<any> {
    return call.type === "return"
}

function isThrown(call: Spy.Call<any>): call is Spy.ThrownCall<any> {
    return call.type === "throw"
}
