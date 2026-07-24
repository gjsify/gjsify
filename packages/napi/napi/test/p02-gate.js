// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.2 GATE (js_native_api core: classes, calls, props, errors).
//
// Runs as a legacy GJS script:
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 30 gjs test/p02-gate.js
//
// Asserts the ObjectWrap-style class surface (napi_define_class + reserved-
// slot wrap), call/construct with the must-not-abort contract, property/
// array/element ops, key enumeration, freeze/seal, the full error surface
// (code + created-while-pending), instanceof, run_script, strict_equals,
// lossy UTF-8, and the this-parity rules.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

let failures = 0;
function check(name, actual, expected) {
    if (!Object.is(actual, expected)) {
        failures++;
        printerr(`FAIL ${name}: got ${String(actual)}, expected ${String(expected)}`);
    }
}
function checkThrows(name, fn, type) {
    try {
        fn();
        failures++;
        printerr(`FAIL ${name}: expected a throw`);
        return undefined;
    } catch (err) {
        if (type && !(err instanceof type)) {
            failures++;
            printerr(`FAIL ${name}: wrong error type: ${String(err)}`);
        }
        return err;
    }
}

const c = loadAddon('test/class-addon/build/Release/class.node');

// ---- ObjectWrap-style class (the better-sqlite3 shape) ----
const { Counter } = c;
check('Counter is function', typeof Counter, 'function');
check('static describe()', Counter.describe(), 'Counter');
check('describe on proto absent', typeof Counter.prototype.describe, 'undefined');

const counter = new Counter(5);
check('instance instanceof', counter instanceof Counter, true);
check('proto method shared', Object.getPrototypeOf(counter) === Counter.prototype, true);
check('increment()', counter.increment(), 6);
check('increment() again', counter.increment(), 7);
check('accessor get', counter.value, 7);
counter.value = 41;
check('accessor set', counter.value, 41);
check('increment after set', counter.increment(), 42);
// Accessor is defined on the prototype as a real accessor.
const desc = Object.getOwnPropertyDescriptor(Counter.prototype, 'value');
check('accessor descriptor get', typeof desc.get, 'function');
check('accessor descriptor set', typeof desc.set, 'function');
check('accessor enumerable', desc.enumerable, true);
// Two instances carry independent native state.
const counter2 = new Counter(100);
check('second instance state', counter2.increment(), 101);
check('first instance unaffected', counter.value, 42);
// Constructor without `new` → TypeError via napi_get_new_target guard.
const newErr = checkThrows('Counter() without new throws', () => Counter(1), TypeError);
check('without-new code', newErr && newErr.code, 'ERR_NEW_REQUIRED');
// Method on a foreign receiver → unwrap fails → Illegal invocation.
checkThrows('foreign receiver throws', () => Counter.prototype.increment.call({}), TypeError);
// dispose: napi_remove_wrap returns the same pointer; second unwrap fails.
check('dispose()', counter2.dispose(), true);
checkThrows('method after dispose throws', () => counter2.increment(), TypeError);

// ---- call/construct + §6 must-not-abort ----
check('callAndCatch normal', c.callAndCatch((x) => x + 1, 41).value, 42);
check('callAndCatch receives arg', c.callAndCatch((x) => x, 'y').value, 'y');
const thrownNull = c.callAndCatch(() => { throw null; });
check('thrown null caught', thrownNull.threw, true);
check('thrown null EXACT', thrownNull.value, null);
const thrownUndef = c.callAndCatch(() => { throw undefined; });
check('thrown undefined caught', thrownUndef.threw, true);
check('thrown undefined EXACT', thrownUndef.value, undefined);
const thrownErr = c.callAndCatch(() => { throw new RangeError('boom'); });
check('thrown error caught', thrownErr.threw, true);
check('thrown error identity', thrownErr.value instanceof RangeError, true);
check('callStatus non-fn = napi_function_expected(5)', c.callStatus(42), 5);
class JsPoint { constructor(x) { this.x = x; } }
check('construct JS class', c.construct(JsPoint, 7).x, 7);
check('construct napi class', c.construct(Counter, 3).increment(), 4);

// ---- property/array/element ops ----
const props = c.propsExercise();
check('propsExercise all ok', props.ok, true);
check('deleted element is hole', 2 in props.arr, false);
check('array survives round-trip', props.arr[0], 10);

// names(): enumerable, string-keyed, prototype chain included.
const withProto = Object.create({ inherited: 3 });
withProto.own = 1;
Object.defineProperty(withProto, 'hidden', { value: 2, enumerable: false });
const names = c.names(withProto);
check('names includes own', names.includes('own'), true);
check('names includes inherited', names.includes('inherited'), true);
check('names excludes non-enumerable', names.includes('hidden'), false);
// ownNames(): own only, incl. non-enumerable, numbers kept.
const numKeyed = { 7: 'seven', a: 1 };
Object.defineProperty(numKeyed, 'h', { value: 0, enumerable: false });
const own = c.ownNames(numKeyed);
check('ownNames keeps number', own.includes(7), true);
check('ownNames includes hidden', own.includes('h'), true);
check('ownNames excludes proto', own.includes('toString'), false);

// freeze/seal
const frozen = c.freeze({ a: 1 });
check('freeze works', Object.isFrozen(frozen), true);
const sealed = c.seal({ b: 2 });
check('seal works', Object.isSealed(sealed), true);
check('sealed not frozen', Object.isFrozen(sealed), false);

// prototype
check('proto of []', c.proto([]) === Array.prototype, true);
check('proto of null-proto obj', c.proto(Object.create(null)), null);
check('proto of counter', c.proto(counter) === Counter.prototype, true);

// ---- error surface ----
const err = c.makeError('ERR_X', 'msg-x');
check('create_error instanceof', err instanceof Error, true);
check('create_error message', err.message, 'msg-x');
check('create_error code', err.code, 'ERR_X');
check('create_type_error', c.makeTypeError('T', 'm') instanceof TypeError, true);
check('create_range_error', c.makeRangeError('R', 'm') instanceof RangeError, true);
check('create_syntax_error', c.makeSyntaxError('S', 'm') instanceof SyntaxError, true);
const coded = checkThrows('throw_error throws', () => c.throwCoded(), Error);
check('throw_error code', coded && coded.code, 'ERR_GATE');
check('throw_error message', coded && coded.message, 'coded throw');
const ranged = checkThrows('throw_range_error throws', () => c.throwRange(), RangeError);
check('throw_range code', ranged && ranged.code, 'ERR_RANGE');
check('is_error(Error)', c.isError(new Error('e')), true);
check('is_error(TypeError subclass)', c.isError(new (class E extends TypeError {})()), true);
check('is_error(plain)', c.isError({}), false);
check('is_error(string)', c.isError('nope'), false);
// napi_create_error while an exception is pending (SqliteError pattern).
const whilePending = c.errorWhilePending();
check('error built while pending', whilePending instanceof Error, true);
check('while-pending code', whilePending.code, 'ERR_WHILE_PENDING');
check('while-pending message', whilePending.message, 'built while pending');

// ---- instanceof / run_script / strict_equals ----
check('instanceOf true', c.instanceOf(counter, Counter), true);
check('instanceOf false', c.instanceOf({}, Counter), false);
check('instanceOf Error subclass', c.instanceOf(new RangeError('x'), Error), true);
checkThrows('instanceOf throwing hasInstance propagates', () =>
    c.instanceOf({}, new Proxy(function () {}, {
        get() { throw new Error('trap'); },
    })));
check('runScript expression', c.runScript('6 * 7'), 42);
c.runScript("globalThis.__p02marker = 'set'");
check('runScript side effect', globalThis.__p02marker, 'set');
delete globalThis.__p02marker;
checkThrows('runScript throw propagates', () => c.runScript('throw new Error("s")'), Error);
check('strictEquals same', c.strictEquals('a', 'a'), true);
check('strictEquals NaN', c.strictEquals(NaN, NaN), false);
check('strictEquals diff types', c.strictEquals(1, '1'), false);

// ---- string parity ----
check('lossy utf8 -> U+FFFD', c.lossyUtf8(), '�hi');
check('property key utf16', c.propertyKey(), 'pk');

// ---- this parity ----
const bare = c.thisKind;
check('sloppy this -> global', bare(), 'global');
check('primitive this boxed', bare.call(42), 'boxed:object');
check('napi fn constructible', typeof new (c.thisKind)(), 'object');

// ---- GC stress across the new surface ----
imports.system.gc();
check('class after GC', counter.increment(), 43);
check('error after GC', c.makeError('E', 'm').code, 'E');
check('runScript after GC', c.runScript('1 + 1'), 2);

if (failures > 0) throw new Error(`${failures} check(s) failed`);
print('P0.2 GATE: PASS');
