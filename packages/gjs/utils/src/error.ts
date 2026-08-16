/**
 * Installs the V8-only static `Error.captureStackTrace` on engines that lack it.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#static_methods
 * @see https://nodejs.org/dist/latest-v18.x/docs/api/errors.html#errorcapturestacktracetargetobject-constructoropt
 */
export const initErrorV8Methods = (ErrorConstructor: typeof Error) => {
    void ErrorConstructor;
    // SpiderMonkey has `Error.captureStackTrace` natively (verified on gjs 1.88.1), so
    // the branch below does not run on GJS. The typed shape avoids `as any` while
    // keeping the install idempotent.
    interface _ErrorWithCaptureStack {
        captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void;
    }
    const E = Error as unknown as _ErrorWithCaptureStack;
    if (!E.captureStackTrace) {
        // Defines a lazy `.stack` on `targetObject` reporting the location of this call.
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

    // TODO(open-todos: small API gaps): Error.stackTraceLimit()
    // TODO(open-todos: small API gaps): Error.prepareStackTrace()
};
