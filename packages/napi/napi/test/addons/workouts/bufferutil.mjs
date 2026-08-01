// SPDX-License-Identifier: MIT
// bufferutil consumer workout — ONE source, run on Node (golden) + GJS-shim.
// bufferutil is a tiny pure-sync N-API addon (ws's WebSocket frame masker).
// Exercises Buffer/typed-array argument passing across the napi boundary:
// mask(source, mask, output, offset, length) XORs source into output, and
// unmask(buffer, mask) XORs in place. We assert a full mask->unmask round-trip
// over several lengths + offsets and print deterministic hex.

import bufferutil from 'bufferutil';

const { mask, unmask } = bufferutil;
const out = [];
const log = (...p) => out.push(p.join(' '));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

log('=== bufferutil workout ===');
log('native mask is fn', typeof mask === 'function', 'unmask is fn', typeof unmask === 'function');

const maskKey = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4]);

for (const len of [0, 1, 3, 4, 5, 8, 17, 64]) {
    const src = Buffer.alloc(len);
    for (let i = 0; i < len; i++) src[i] = (i * 7 + 11) & 0xff;
    const masked = Buffer.alloc(len + 2, 0); // +offset headroom
    const offset = len % 2; // 0 or 1
    mask(src, maskKey, masked, offset, len);
    // reference XOR to prove the native did the real thing
    let refOk = true;
    for (let i = 0; i < len; i++) if (masked[offset + i] !== (src[i] ^ maskKey[i & 3])) refOk = false;
    // round-trip: unmask the masked slice back to plaintext
    const slice = masked.subarray(offset, offset + len);
    unmask(slice, maskKey);
    log(
        `len=${len} off=${offset} maskedHex=${hex(masked.subarray(offset, offset + len))} refOk=${refOk} roundtrip=${hex(slice) === hex(src)}`,
    );
}

// unmask twice with the same key is identity (XOR involution)
const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const orig = hex(buf);
unmask(buf, maskKey);
const once = hex(buf);
unmask(buf, maskKey);
log('involution once', once, 'twice-back', hex(buf) === orig);

log('=== workout complete ===');
console.log(out.join('\n'));
