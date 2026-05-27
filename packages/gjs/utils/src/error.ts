/**
 * Defines the static Error.captureStackTrace method,
 * this is not present in SpiderMonkey because it comes from V8
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#static_methods
 * @see https://nodejs.org/dist/latest-v18.x/docs/api/errors.html#errorcapturestacktracetargetobject-constructoropt
 */
export const initErrorV8Methods = (ErrorConstructor: typeof Error) => {
    void ErrorConstructor;
    // The V8 `Error.captureStackTrace` static is non-standard but Node-portable;
    // SpiderMonkey 140 added it natively (so this whole branch is dead on GJS
    // 1.86+). The typed shape avoids `as any` while keeping the install
    // idempotent.
    interface _ErrorWithCaptureStack {
        captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void;
    }
    const E = Error as unknown as _ErrorWithCaptureStack;
    if (!E.captureStackTrace) {
        /**
         * A non-standard V8 function.
         * Creates a .stack property on targetObject, which when accessed returns a string representing the location in the code at which Error.captureStackTrace() was called.
         */
        E.captureStackTrace = function (targetObject: object, constructorOpt?: Function) {
            const container = new Error();

            const target = constructorOpt || targetObject;

            Object.defineProperty(target, 'stack', {
                configurable: true,
                get: function getStack() {
                    var stack = container.stack;

                    Object.defineProperty(this, 'stack', {
                        value: stack,
                    });

                    return stack;
                },
            });
        };
    }

    // TODO Error.stackTraceLimit()
    // TODO Error.prepareStackTrace()
};
