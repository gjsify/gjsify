// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_conversions/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_conversions', targets: ['test_conversions'] };

export default async function run(h) {
    const t = h.loadAddon('test_conversions');
    const testSym = Symbol('test');

    // napi_get_value_bool: strict — only real booleans pass, else throws.
    h.emit('asBool(false)', t.asBool(false));
    h.emit('asBool(true)', t.asBool(true));
    for (const [lbl, v] of [
        ['undefined', undefined], ['null', null], ['NaN', Number.NaN], ['0', 0], ['""', ''],
        ["'0'", '0'], ['1', 1], ["'1'", '1'], ["'true'", 'true'], ['{}', {}], ['[]', []], ['sym', testSym],
    ])
        h.emit('asBool!', lbl, h.caught(() => t.asBool(v)));

    // napi_get_value_int32/uint32/int64: coerce-then-truncate for numbers, throw otherwise.
    for (const [name, fn] of [['asInt32', t.asInt32], ['asUInt32', t.asUInt32], ['asInt64', t.asInt64]]) {
        for (const v of [0, 1, 1.0, 1.1, 1.9, 0.9, 999.9, Number.NaN]) h.emit(name, h.fmt(v), '=>', fn(v));
        for (const [lbl, v] of [
            ['undefined', undefined], ['null', null], ['false', false], ['""', ''], ["'1'", '1'], ['{}', {}], ['[]', []], ['sym', testSym],
        ])
            h.emit(name + '!', lbl, h.caught(() => fn(v)));
    }
    h.emit('asInt32(-1)', t.asInt32(-1));
    h.emit('asInt64(-1)', t.asInt64(-1));
    h.emit('asUInt32(-1)', t.asUInt32(-1));

    // napi_get_value_double.
    for (const v of [0, 1, 1.0, 1.1, 1.9, 0.9, 999.9, -1, Number.NaN]) h.emit('asDouble', h.fmt(v), '=>', t.asDouble(v));
    for (const [lbl, v] of [
        ['undefined', undefined], ['null', null], ['false', false], ['""', ''], ["'1'", '1'], ['{}', {}], ['[]', []], ['sym', testSym],
    ])
        h.emit('asDouble!', lbl, h.caught(() => t.asDouble(v)));

    // napi_get_value_string_utf8.
    h.emit('asString("")', t.asString(''));
    h.emit('asString("test")', t.asString('test'));
    for (const [lbl, v] of [
        ['undefined', undefined], ['null', null], ['false', false], ['1', 1], ['1.1', 1.1], ['NaN', Number.NaN], ['{}', {}], ['[]', []], ['sym', testSym],
    ])
        h.emit('asString!', lbl, h.caught(() => t.asString(v)));

    // napi_coerce_to_bool.
    for (const [lbl, v] of [
        ['true', true], ['1', 1], ['-1', -1], ["'true'", 'true'], ["'false'", 'false'], ['{}', {}], ['[]', []], ['sym', testSym],
        ['false', false], ['undefined', undefined], ['null', null], ['0', 0], ['NaN', Number.NaN], ['""', ''],
    ])
        h.emit('toBool', lbl, t.toBool(v));

    // napi_coerce_to_number.
    for (const [lbl, v] of [
        ['0', 0], ['1', 1], ['1.1', 1.1], ['-1', -1], ["'0'", '0'], ["'1'", '1'], ["'1.1'", '1.1'], ['[]', []],
        ['false', false], ['null', null], ['""', ''], ['NaN', Number.NaN], ['{}', {}], ['undefined', undefined],
    ])
        h.emit('toNumber', lbl, t.toNumber(v));
    // Symbol→number throws an ENGINE TypeError (message differs V8/SpiderMonkey);
    // the upstream test asserts only the TYPE, so print that.
    h.emit('toNumber(sym)!', h.caughtName(() => t.toNumber(testSym)));

    // napi_coerce_to_object — print constructor + primitive it boxes.
    const shape = (o) => `${o && o.constructor ? o.constructor.name : 'null'}:${typeof o === 'object' && o !== null ? JSON.stringify(o.valueOf()) : String(o)}`;
    for (const [lbl, v] of [
        ['{}', {}], ['{test:1}', { test: 1 }], ['[]', []], ['[1,2,3]', [1, 2, 3]],
        ['false', false], ['true', true], ["''", ''], ['0', 0],
    ])
        h.emit('toObject', lbl, shape(t.toObject(v)));
    h.emit('toObject(false)!==false', t.toObject(false) !== false);

    // napi_coerce_to_string.
    for (const [lbl, v] of [
        ['""', ''], ["'test'", 'test'], ['undefined', undefined], ['null', null], ['false', false], ['true', true],
        ['0', 0], ['1.1', 1.1], ['NaN', Number.NaN], ['{}', {}], ['[]', []], ['[1,2,3]', [1, 2, 3]],
    ])
        h.emit('toString', lbl, t.toString(v));
    h.emit('toString({toString})', t.toString({ toString: () => 'test' }));
    h.emit('toString(sym)!', h.caughtName(() => t.toString(testSym)));

    // testNull.*: the NULL-argument matrix returns a status-string object.
    for (const k of [
        'getValueBool', 'getValueInt32', 'getValueUint32', 'getValueInt64', 'getValueDouble',
        'coerceToBool', 'coerceToObject', 'coerceToString',
        'getValueStringUtf8', 'getValueStringLatin1', 'getValueStringUtf16',
    ]) {
        const o = t.testNull[k]();
        const keys = Object.keys(o).sort();
        h.emit('testNull.' + k, keys.map((kk) => `${kk}=${o[kk]}`).join('|'));
    }
}
