// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.3 GATE (wrap + lifetime, THE CRASH CLASS).
//
// Runs as a legacy GJS script:
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 30 gjs test/p03-gate.js
//
// Deterministic GC points: `imports.system.gc()` forces a FULL GC (weak
// sweep runs at major-GC sweep — a JS::Heap-held nursery object is tenured
// by minor GC, so full GC is the deterministic death point). Finalizers are
// queued during GC and drained on the main context: `pump()` iterates
// GLib's default main context to run the idle drain — a tight synchronous
// script without pumping sees finalizers only at env teardown (documented
// §5c reality). The teardown-time CLEANUP/FINALIZE stdout lines that print
// AFTER this script are asserted by test/run-p03-gate.sh.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
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
function checkArr(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures++;
        printerr(`FAIL ${name}: got ${a}, expected ${e}`);
    }
}
function gc() {
    imports.system.gc();
}
function pump() {
    // Drain pending idle sources (the §5c finalizer drain).
    const ctx = GLib.MainContext.default();
    while (ctx.iteration(false)) { /* drain */ }
}

const t = loadAddon('test/lifetime-addon/build/Release/lifetime.node');
const t8 = loadAddon('test/refs8-addon/build/Release/refs8.node');

// ---- strong ref: keeps the object alive across GC ----
let strongObj = { marker: 'strong' };
const strongId = t.makeRef(strongObj, 1);
strongObj = null;
gc();
check('strong ref survives GC', t.refGet(strongId).marker, 'strong');
check('strong not empty', t.refIsEmpty(strongId), false);
// Unref to 0 → weak; the object is garbage → next GC kills it.
check('unref to 0', t.refUnref(strongId), 0);
gc();
check('weak ref died', t.refIsEmpty(strongId), true);
check('dead ref get -> undefined', t.refGet(strongId), undefined);
// Ref() on a dead weak ref cannot resurrect (Node parity).
check('ref on dead ref counts', t.refRef(strongId), 1);
check('dead ref stays empty', t.refIsEmpty(strongId), true);
t.refDelete(strongId);

// ---- weak ref: alive while JS holds it, resurrectable at 0 ----
let weakObj = { marker: 'weak' };
const weakId = t.makeRef(weakObj, 0);
gc();
check('weak ref alive while held', t.refIsEmpty(weakId), false);
check('weak get identity', t.refGet(weakId) === weakObj, true);
// Resurrect: 0→1 strong again, then drop the JS var — object must survive.
check('resurrect 0->1', t.refRef(weakId), 1);
weakObj = null;
gc();
check('resurrected survives GC', t.refGet(weakId).marker, 'weak');
check('unref back to 0', t.refUnref(weakId), 0);
gc();
check('then dies', t.refIsEmpty(weakId), true);
t.refDelete(weakId);

// ---- unref below zero = napi_generic_failure(9) ----
const zeroId = t.makeRef({}, 0);
check('unref at 0 -> generic_failure', t.refUnrefStatus(zeroId), 9);
t.refDelete(zeroId);

// ---- v10 primitive refs (the better-sqlite3 semantic) ----
const strId = t.makeRef('primitive-string', 1);
check('primitive ref get', t.refGet(strId), 'primitive-string');
gc();
check('primitive ref survives GC', t.refGet(strId), 'primitive-string');
// At refcount 0 a primitive releases IMMEDIATELY (SetWeak-on-non-weakable).
check('primitive unref to 0', t.refUnref(strId), 0);
check('primitive released at 0', t.refIsEmpty(strId), true);
t.refDelete(strId);
const symId = t.makeRef(Symbol('tagged'), 1);
check('symbol ref alive', t.refIsEmpty(symId), false);
check('symbol ref typeof', typeof t.refGet(symId), 'symbol');
// Symbols are treated as primitives (§5b ledger deviation): released at 0.
check('symbol unref to 0', t.refUnref(symId), 0);
check('symbol released at 0 (ledger)', t.refIsEmpty(symId), true);
t.refDelete(symId);

// ---- <10 module version gate (second env, NAPI_VERSION=8 addon) ----
check('v8 module: string ref -> invalid_arg(1)', t8.refStatus('nope'), 1);
check('v8 module: number ref -> invalid_arg(1)', t8.refStatus(42), 1);
check('v8 module: object ref ok', t8.refStatus({}), 0);
check('v8 module: symbol ref ok', t8.refStatus(Symbol('s')), 0);
// The v10 env accepts primitives (per-env gating, same process).
check('v10 module: string ref ok', t.makeRefStatus('yes', 0), 0);

// ---- wrap + finalizer: GC death fires EXACTLY once ----
t.resetLog();
let wrapped = t.wrapFinalize({}, 11);
check('unwrap', t.unwrapId(wrapped), 11);
// Double wrap = napi_invalid_arg(1).
check('double wrap -> invalid_arg', t.wrapStatus(wrapped, 12), 1);
wrapped = null;
gc();     // death detected at sweep → finalizer QUEUED, not run
checkArr('finalizer queued not run during GC', t.finalizeLog(), []);
pump();   // idle drain runs it
checkArr('wrap finalizer ran once after pump', t.finalizeLog(), [11]);
gc();
pump();
checkArr('wrap finalizer never re-runs', t.finalizeLog(), [11]);

// ---- remove_wrap: finalizer must NOT run (ownership returned) ----
t.resetLog();
let removed = t.wrapFinalize({}, 13);
check('remove wrap returns data', t.removeWrapId(removed), 13);
removed = null;
gc();
pump();
checkArr('removed wrap: no finalizer', t.finalizeLog(), []);

// ---- napi_add_finalizer ----
t.resetLog();
let finalized = t.addFinalizer({}, 21);
finalized = null;
gc();
pump();
checkArr('add_finalizer fired once', t.finalizeLog(), [21]);

// ---- externals ----
t.resetLog();
let ext = t.makeExternal(31);
check('external data', t.externalId(ext), 31);
check('external typeof', t.typeofName(ext), 'external');
ext = null;
gc();
pump();
checkArr('external finalizer fired once', t.finalizeLog(), [31]);

// ---- type tags: fast tier (external) + foreign tier (plain object) ----
const taggedExt = t.makeExternal(0);
check('tag external', t.tagObject(taggedExt, 7), 0);
check('re-tag -> invalid_arg', t.tagObject(taggedExt, 8), 1);
check('tag check pass', t.checkTag(taggedExt, 7), true);
check('tag check fail', t.checkTag(taggedExt, 8), false);
const foreign = {};
check('tag foreign object', t.tagObject(foreign, 9), 0);
check('foreign tag check pass', t.checkTag(foreign, 9), true);
check('foreign re-tag -> invalid_arg', t.tagObject(foreign, 10), 1);
check('untagged check false', t.checkTag({}, 9), false);
gc();
check('foreign tag survives GC (WeakMap tier)', t.checkTag(foreign, 9), true);

// ---- wrap on a FOREIGN object (WeakMap tier) dies + finalizes too ----
t.resetLog();
let foreignWrapped = { plain: true };
t.wrapFinalize(foreignWrapped, 41);
check('foreign unwrap', t.unwrapId(foreignWrapped), 41);
gc();
pump();
checkArr('foreign wrap alive while held', t.finalizeLog(), []);
foreignWrapped = null;
gc();
pump();
checkArr('foreign wrap finalized once', t.finalizeLog(), [41]);

// ---- instance data: overwrite deletes UN-finalized ----
t.resetLog();
t.setInstanceData(51);
check('instance data get', t.getInstanceData(), 51);
t.setInstanceData(52);  // old holder deleted WITHOUT finalizing
check('instance data overwritten', t.getInstanceData(), 52);
checkArr('overwrite did not finalize old', t.finalizeLog(), []);
// id 52's finalizer fires at TEARDOWN (asserted post-exit by the runner).

// ---- cleanup hooks (run LIFO at teardown; 103 removed → must not run) ----
t.registerCleanupHooks();

// ---- teardown-time finalization: leave live state behind ----
// A wrapped object that stays ALIVE until process end: its finalizer must
// run at env teardown (exactly once — post-exit assert via run-p03-gate.sh).
globalThis.__keepAliveWrapped = t.wrapFinalize({ keep: true }, 61);
// And a strong ref that is never unrefd (released at teardown, no finalizer).
t.makeRef({ pinned: true }, 1);

t.resetLog();
if (failures > 0) throw new Error(`${failures} check(s) failed`);
print('P0.3 GATE: PASS');
