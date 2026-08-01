// SPDX-License-Identifier: MIT
// @gjsify/node-gi/system — the GJS `System` module on Node (standalone import).
import test from 'node:test';
import assert from 'node:assert/strict';

import System, {
    exit,
    gc,
    version,
    programArgs,
    programInvocationName,
    programPath,
    addressOf,
    addressOfGObject,
    refcount,
    breakpoint,
    clearDateCaches,
    dumpHeap,
    dumpMemoryInfo,
} from '../system.js';

test('default export carries the full GJS System surface', () => {
    for (const member of [
        'exit',
        'gc',
        'version',
        'programArgs',
        'programInvocationName',
        'programPath',
        'addressOf',
        'addressOfGObject',
        'refcount',
        'breakpoint',
        'clearDateCaches',
        'dumpHeap',
        'dumpMemoryInfo',
    ]) {
        assert.ok(member in System, `System.${member} missing`);
    }
});

test('named exports match the default export', () => {
    assert.equal(exit, System.exit);
    assert.equal(gc, System.gc);
    assert.equal(version, System.version);
    assert.equal(addressOf, System.addressOf);
    assert.equal(addressOfGObject, System.addressOfGObject);
    assert.equal(refcount, System.refcount);
    assert.equal(breakpoint, System.breakpoint);
    assert.equal(clearDateCaches, System.clearDateCaches);
    assert.equal(dumpHeap, System.dumpHeap);
    assert.equal(dumpMemoryInfo, System.dumpMemoryInfo);
});

test('program identity reflects process.argv', () => {
    // process.argv[1] is the running test file — a non-empty string.
    assert.equal(typeof programInvocationName, 'string');
    assert.equal(typeof System.programInvocationName, 'string');
    assert.equal(programPath, process.argv[1] || null);
    assert.equal(System.programPath, process.argv[1] || null);
    assert.deepEqual(programArgs, process.argv.slice(2));
    assert.ok(Array.isArray(System.programArgs));
});

test('stub members return GJS-shaped values without throwing', () => {
    assert.equal(version, 0);
    assert.equal(addressOf(), '0x0');
    assert.equal(addressOfGObject(), '0x0');
    assert.equal(refcount(), 0);
    // No-ops — must not throw.
    breakpoint();
    clearDateCaches();
    dumpHeap();
    dumpMemoryInfo();
});

test('gc is a no-throw function (calls globalThis.gc only when present)', () => {
    assert.equal(typeof gc, 'function');
    gc(); // safe whether or not --expose-gc is set
});
