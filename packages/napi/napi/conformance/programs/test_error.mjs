// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_error/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_error', targets: ['test_error'] };

export default async function run(h) {
    const t = h.loadAddon('test_error');

    // napi_is_error across every native error subtype + a user subclass.
    class MyError extends Error {}
    for (const [lbl, v] of [
        ['Error', new Error('e')],
        ['TypeError', new TypeError('e')],
        ['SyntaxError', new SyntaxError('e')],
        ['RangeError', new RangeError('e')],
        ['ReferenceError', new ReferenceError('e')],
        ['URIError', new URIError('e')],
        ['EvalError', new EvalError('e')],
        ['MyError', new MyError('e')],
        ['{}', {}],
        ["'str'", 'non-object'],
    ])
        h.emit('checkError', lbl, t.checkError(v));

    // napi_throw / napi_throw_*_error — name+message round-trip.
    h.emit(
        'throwExisting',
        h.caughtFull(() => t.throwExistingError()),
    );
    h.emit(
        'throwError',
        h.caughtFull(() => t.throwError()),
    );
    h.emit(
        'throwRange',
        h.caughtFull(() => t.throwRangeError()),
    );
    h.emit(
        'throwType',
        h.caughtFull(() => t.throwTypeError()),
    );
    h.emit(
        'throwSyntax',
        h.caughtFull(() => t.throwSyntaxError()),
    );

    // napi_throw with an arbitrary value: the thrown value IS the argument.
    for (const [lbl, v] of [
        ['42', 42],
        ['{}', {}],
        ['[]', []],
        ['sym', Symbol('xyzzy')],
        ['true', true],
        ["'ball'", 'ball'],
        ['undefined', undefined],
        ['null', null],
        ['NaN', NaN],
    ]) {
        let same = 'no-throw';
        try {
            t.throwArbitrary(v);
        } catch (e) {
            same = e === v;
        }
        h.emit('throwArbitrary', lbl, same);
    }

    // *ErrorCode variants attach a code.
    const code = (fn) => {
        try {
            fn();
            return 'no-throw';
        } catch (e) {
            return `${e.code}|${e.message}`;
        }
    };
    h.emit(
        'throwErrorCode',
        code(() => t.throwErrorCode()),
    );
    h.emit(
        'throwRangeErrorCode',
        code(() => t.throwRangeErrorCode()),
    );
    h.emit(
        'throwTypeErrorCode',
        code(() => t.throwTypeErrorCode()),
    );
    h.emit(
        'throwSyntaxErrorCode',
        code(() => t.throwSyntaxErrorCode()),
    );

    // napi_create_*_error — instance class + message.
    const desc = (e, Ctor) => `${e instanceof Ctor}|${e.message}`;
    h.emit('createError', desc(t.createError(), Error));
    h.emit('createRangeError', desc(t.createRangeError(), RangeError));
    h.emit('createTypeError', desc(t.createTypeError(), TypeError));
    h.emit('createSyntaxError', desc(t.createSyntaxError(), SyntaxError));

    // napi_create_*_error with a code — class, message, code, name.
    const descCode = (e, Ctor) => `${e instanceof Ctor}|${e.message}|${e.code}|${e.name}`;
    h.emit('createErrorCode', descCode(t.createErrorCode(), Error));
    h.emit('createRangeErrorCode', descCode(t.createRangeErrorCode(), RangeError));
    h.emit('createTypeErrorCode', descCode(t.createTypeErrorCode(), TypeError));
    h.emit('createSyntaxErrorCode', descCode(t.createSyntaxErrorCode(), SyntaxError));
}
