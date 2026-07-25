// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_date/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_date', targets: ['test_date'] };

export default async function run(h) {
    const t = h.loadAddon('test_date');

    // napi_create_date → a real Date; napi_is_date across value kinds.
    const d = t.createDate(1549183351);
    h.emit('createDate.isDate', t.isDate(d));
    h.emit('createDate.value', d instanceof Date ? d.getTime() : 'not-a-date');
    h.emit('isDate(new Date)', t.isDate(new Date(1549183351)));
    h.emit('isDate(2.4)', t.isDate(2.4));
    h.emit('isDate(string)', t.isDate('not a date'));
    h.emit('isDate(undefined)', t.isDate(undefined));
    h.emit('isDate(null)', t.isDate(null));
    h.emit('isDate({})', t.isDate({}));

    // napi_get_date_value.
    h.emit('getDateValue', t.getDateValue(new Date(1549183351)));
}
