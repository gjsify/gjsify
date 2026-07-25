// SPDX-License-Identifier: MIT
// utf-8-validate consumer workout — ONE source, Node (golden) + GJS-shim.
// utf-8-validate is a tiny pure-sync N-API addon (ws's UTF-8 checker). Its
// default export is `isValidUTF8(buffer) -> boolean`. Exercises Buffer input +
// a boolean napi return over a spread of valid/invalid byte sequences.

import isValidUTF8 from 'utf-8-validate';

const out = [];
const log = (...p) => out.push(p.join(' '));

log('=== utf-8-validate workout ===');
log('native isValidUTF8 is fn', typeof isValidUTF8 === 'function');

const cases = [
    ['empty', []],
    ['ascii', [0x68, 0x69]], // "hi"
    ['2-byte é', [0xc3, 0xa9]],
    ['3-byte €', [0xe2, 0x82, 0xac]],
    ['4-byte 😀', [0xf0, 0x9f, 0x98, 0x80]],
    ['lone continuation', [0x80]],
    ['truncated 2-byte', [0xc3]],
    ['overlong slash', [0xc0, 0xaf]],
    ['bad tail', [0xe2, 0x28, 0xa1]],
    ['surrogate D800', [0xed, 0xa0, 0x80]],
    ['0xff', [0xff]],
    ['mixed valid', [0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0x7a]],
];

for (const [label, bytes] of cases) {
    const buf = Buffer.from(bytes);
    log(`${label}: ${isValidUTF8(buf)}`);
}

// a larger valid buffer
const big = Buffer.from('gjsify läuft — 日本語 🚀'.repeat(50), 'utf8');
log('big valid', isValidUTF8(big), 'len', big.length);
// corrupt one byte inside a multibyte sequence
const bad = Buffer.from(big);
bad[bad.length - 1] = 0xff;
log('big corrupted', isValidUTF8(bad));

log('=== workout complete ===');
console.log(out.join('\n'));
