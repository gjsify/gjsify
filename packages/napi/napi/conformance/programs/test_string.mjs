// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_string/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_string', targets: ['test_string'] };

const kInsufficientIdx = 3;

export default async function run(h) {
    const t = h.loadAddon('test_string');

    const asciiCases = [
        '', 'hello world',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        '?!@#$%^&*()_+-=[]{}/.,<>\'"\\',
    ];
    const latin1Cases = [
        { str: '¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿', utf8Length: 62, utf8InsufficientIdx: 1 },
        { str: 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþ', utf8Length: 126, utf8InsufficientIdx: 1 },
    ];
    const unicodeCases = [{ str: '\u{2003}\u{2101}\u{2001}\u{202}\u{2011}', utf8Length: 14, utf8InsufficientIdx: 1 }];

    const latin1 = (str) => {
        for (const fn of ['TestLatin1', 'TestLatin1AutoLength', 'TestLatin1External', 'TestLatin1ExternalAutoLength', 'TestPropertyKeyLatin1', 'TestPropertyKeyLatin1AutoLength'])
            h.emit(fn, t[fn](str) === str);
        h.emit('Latin1Length', t.Latin1Length(str) === str.length);
        if (str !== '') h.emit('TestLatin1Insufficient', t.TestLatin1Insufficient(str) === str.slice(0, kInsufficientIdx));
    };
    const unicode = (str, utf8Length, utf8InsufficientIdx) => {
        for (const fn of ['TestUtf8', 'TestUtf16', 'TestUtf8AutoLength', 'TestUtf16AutoLength', 'TestUtf16External', 'TestUtf16ExternalAutoLength', 'TestPropertyKeyUtf8', 'TestPropertyKeyUtf8AutoLength', 'TestPropertyKeyUtf16', 'TestPropertyKeyUtf16AutoLength'])
            h.emit(fn, t[fn](str) === str);
        h.emit('Utf8Length', t.Utf8Length(str) === utf8Length);
        h.emit('Utf16Length', t.Utf16Length(str) === str.length);
        if (str !== '') {
            h.emit('TestUtf8Insufficient', t.TestUtf8Insufficient(str) === str.slice(0, utf8InsufficientIdx));
            h.emit('TestUtf16Insufficient', t.TestUtf16Insufficient(str) === str.slice(0, kInsufficientIdx));
        }
    };

    asciiCases.forEach(latin1);
    asciiCases.forEach((s) => unicode(s, s.length, kInsufficientIdx));
    latin1Cases.forEach((it) => latin1(it.str));
    latin1Cases.forEach((it) => unicode(it.str, it.utf8Length, it.utf8InsufficientIdx));
    unicodeCases.forEach((it) => unicode(it.str, it.utf8Length, it.utf8InsufficientIdx));

    // Oversized-length guards throw the shim's "Invalid argument".
    h.emit('TestLargeUtf8', h.caughtFull(() => t.TestLargeUtf8()));
    h.emit('TestLargeLatin1', h.caughtFull(() => t.TestLargeLatin1()));
    h.emit('TestLargeUtf16', h.caughtFull(() => t.TestLargeUtf16()));

    // Round-trip of a 64 KiB buffer must not corrupt memory.
    t.TestMemoryCorruption(' '.repeat(64 * 1024));
    h.emit('TestMemoryCorruption', 'ok');
}
