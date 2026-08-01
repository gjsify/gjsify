// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_bigint/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: TestWords / CreateTooBigBigInt / MakeBigIntWordsThrow exercise the
// napi_*_bigint_words ABI (Phase-0 loud stubs) — this program is ledgered.
export const meta = { dir: 'test_bigint', targets: ['test_bigint'] };

export default async function run(h) {
    const t = h.loadAddon('test_bigint');

    const nums = [
        0n,
        -0n,
        1n,
        -1n,
        100n,
        2121n,
        -1233n,
        986583n,
        -976675n,
        98765432213456789876546896323445679887645323232436587988766545658n,
        -4350987086545760976737453646576078997096876957864353245245769809n,
    ];
    for (const num of nums) {
        const in64 = num > -(2n ** 63n) && num < 2n ** 63n;
        if (in64) {
            h.emit('Int64', h.fmt(num), '=>', t.TestInt64(num));
            h.emit('Lossless64', h.fmt(num), t.IsLossless(num, true));
        } else {
            h.emit('Lossless64', h.fmt(num), t.IsLossless(num, true));
        }
        const inU64 = num >= 0n && num < 2n ** 64n;
        if (inU64) {
            h.emit('Uint64', h.fmt(num), '=>', t.TestUint64(num));
            h.emit('LosslessU64', h.fmt(num), t.IsLossless(num, false));
        } else {
            h.emit('LosslessU64', h.fmt(num), t.IsLossless(num, false));
        }
        h.emit('Words', h.fmt(num), '=>', t.TestWords(num));
    }

    h.emit(
        'CreateTooBig',
        h.caughtFull(() => t.CreateTooBigBigInt()),
    );
    h.emit(
        'WordsThrow',
        h.caughtFull(() => t.MakeBigIntWordsThrow()),
    );
}
