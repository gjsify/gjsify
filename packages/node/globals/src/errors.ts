// See https://nodejs.org/dist/latest-v18.x/docs/api/errors.html#errorcapturestacktracetargetobject-constructoropt
if (!Error.captureStackTrace) {

    /** Create .stack property on a target object */
    Error.captureStackTrace = function(targetObject: object, constructorOpt?: Function) {
        const container = new Error();

        const target = constructorOpt || targetObject;

        Object.defineProperty(target, 'stack', {
            configurable: true,
            get: function getStack() {
                var stack = container.stack;
    
                Object.defineProperty(this, 'stack', {
                    value: stack
                });
    
                return stack;
            }
        });
    }
}