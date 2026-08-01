// https://github.com/mysticatea/spy

/** A permissive function type used as a constraint for the spy generic parameter. */
// oxlint-disable-next-line typescript/no-explicit-any -- constraint-only alias: `any` here allows spy to wrap any function signature
type AnyFunction = (...args: any[]) => any;

/** Spy. */
export type Spy<T extends AnyFunction> = T & Spy.CallInformation<T>;

export namespace Spy {
    /** Information for calls on a spy. */
    export interface CallInformation<T extends AnyFunction> {
        /** Information for each call. */
        readonly calls: ReadonlyArray<Call<T>>;

        /** Information for each returned call. */
        readonly returnedCalls: ReadonlyArray<ReturnedCall<T>>;

        /** Information for each thrown call. */
        readonly thrownCalls: ReadonlyArray<ThrownCall<T>>;

        /** Information of the first call. */
        readonly firstCall: Call<T> | null;

        /** Information of the last call. */
        readonly lastCall: Call<T> | null;

        /** Information of the first returned call. */
        readonly firstReturnedCall: ReturnedCall<T> | null;

        /** Information of the last returned call. */
        readonly lastReturnedCall: ReturnedCall<T> | null;

        /** Information of the first thrown call. */
        readonly firstThrownCall: ThrownCall<T> | null;

        /** Information of the last thrown call. */
        readonly lastThrownCall: ThrownCall<T> | null;

        /** Reset calls. */
        reset(): void;
    }

    /** Information for each call. */
    export type Call<T extends AnyFunction> = ReturnedCall<T> | ThrownCall<T>;

    /** Information for each returned call. */
    export interface ReturnedCall<T extends AnyFunction> {
        type: 'return';
        this: This<T>;
        arguments: Parameters<T>;
        return: ReturnType<T>;
    }

    /** Information for each thrown call. */
    export interface ThrownCall<T extends AnyFunction> {
        type: 'throw';
        this: This<T>;
        arguments: Parameters<T>;
        throw: unknown;
    }
}

// oxlint-disable-next-line typescript/no-explicit-any -- conditional type for extracting `this` context from a function signature
type This<T> = T extends (this: infer TT, ...args: any[]) => any ? TT : undefined;

/**
 * Create a spy.
 */
export function spy(): Spy<() => void>;

/**
 * Create a spy with a certain behavior.
 * @param f The function of the spy's behavior.
 */
export function spy<T extends AnyFunction>(f: T): Spy<T>;

// Implementation
export function spy<T extends AnyFunction>(f?: T): Spy<T> {
    const calls = [] as Spy.Call<T>[];

    function spy(this: This<T>, ...args: Parameters<T>): ReturnType<T> {
        let retv: ReturnType<T>;
        try {
            retv = f ? f.apply(this, args) : undefined;
        } catch (error) {
            calls.push({
                type: 'throw',
                this: this,
                arguments: args,
                throw: error,
            });
            throw error;
        }

        calls.push({
            type: 'return',
            this: this,
            arguments: args,
            return: retv,
        });

        return retv;
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
    });

    return spy as Spy<T>;
}

const descriptors = {
    calls(value: ReadonlyArray<Spy.Call<AnyFunction>>): PropertyDescriptor {
        return { value, configurable: true };
    },

    returnedCalls: {
        get: function returnedCalls(
            this: Spy.CallInformation<AnyFunction>,
        ): ReadonlyArray<Spy.ReturnedCall<AnyFunction>> {
            return this.calls.filter(isReturned);
        },
        configurable: true,
    } as PropertyDescriptor,

    thrownCalls: {
        get: function thrownCalls(this: Spy.CallInformation<AnyFunction>): ReadonlyArray<Spy.ThrownCall<AnyFunction>> {
            return this.calls.filter(isThrown);
        },
        configurable: true,
    } as PropertyDescriptor,

    firstCall: {
        get: function firstCall(this: Spy.CallInformation<AnyFunction>): Spy.Call<AnyFunction> | null {
            return this.calls[0] || null;
        },
        configurable: true,
    } as PropertyDescriptor,

    lastCall: {
        get: function lastCall(this: Spy.CallInformation<AnyFunction>): Spy.Call<AnyFunction> | null {
            return this.calls[this.calls.length - 1] || null;
        },
        configurable: true,
    } as PropertyDescriptor,

    firstReturnedCall: {
        get: function firstReturnedCall(this: Spy.CallInformation<AnyFunction>): Spy.ReturnedCall<AnyFunction> | null {
            for (let i = 0; i < this.calls.length; ++i) {
                const call = this.calls[i];
                if (isReturned(call)) {
                    return call;
                }
            }
            return null;
        },
        configurable: true,
    } as PropertyDescriptor,

    lastReturnedCall: {
        get: function lastReturnedCall(this: Spy.CallInformation<AnyFunction>): Spy.ReturnedCall<AnyFunction> | null {
            for (let i = this.calls.length - 1; i >= 0; --i) {
                const call = this.calls[i];
                if (isReturned(call)) {
                    return call;
                }
            }
            return null;
        },
        configurable: true,
    } as PropertyDescriptor,

    firstThrownCall: {
        get: function firstThrownCall(this: Spy.CallInformation<AnyFunction>): Spy.ThrownCall<AnyFunction> | null {
            for (let i = 0; i < this.calls.length; ++i) {
                const call = this.calls[i];
                if (isThrown(call)) {
                    return call;
                }
            }
            return null;
        },
        configurable: true,
    } as PropertyDescriptor,

    lastThrownCall: {
        get: function lastThrownCall(this: Spy.CallInformation<AnyFunction>): Spy.ThrownCall<AnyFunction> | null {
            for (let i = this.calls.length - 1; i >= 0; --i) {
                const call = this.calls[i];
                if (isThrown(call)) {
                    return call;
                }
            }
            return null;
        },
        configurable: true,
    } as PropertyDescriptor,

    reset: {
        value: function reset(this: Spy.CallInformation<AnyFunction>): void {
            (this.calls as Spy.Call<AnyFunction>[]).length = 0;
        },
        configurable: true,
    } as PropertyDescriptor,

    toString(f: AnyFunction | undefined): PropertyDescriptor {
        return {
            value: function toString() {
                return `/* The spy of */ ${f ? f.toString() : 'function(){}'}`;
            },
            configurable: true,
        };
    },
};

function isReturned(call: Spy.Call<AnyFunction>): call is Spy.ReturnedCall<AnyFunction> {
    return call.type === 'return';
}

function isThrown(call: Spy.Call<AnyFunction>): call is Spy.ThrownCall<AnyFunction> {
    return call.type === 'throw';
}
