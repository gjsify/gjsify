// The entry issue #2022 names: real `excalibur@0.32.0` bytes, nothing of the shape faked.
// `run.mjs` carries the incident; what is left here is what this FILE has to get right.
//
// `new Vector(...)` is there because the named import has to be USED: a bare
// `import * as ex` plus a read of a property a tree-shaker cannot see resolves to a 93-byte
// bundle and asserts nothing. No game loop is started, deliberately — the stub `window`
// carries no `setInterval`, so Excalibur's rAF fallback would throw on Node, and that is the
// upstream limitation #2022 names rather than a defect to fix here.
//
// The three markers are what the rewrite leaves behind, and they differ per host: VECTOR says
// the module body ran; GLOBALS_INTACT says `globalThis` is still the global object, which is
// the `--app gjs` claim (`globalThis = {…}` replaces it and does not crash — ADR 0079's
// addendum); STUB says the author's `audioContext` reached `window`, TRUE on Node where the
// guard ran and the plugin's rewrite is the only reason it could, FALSE on GJS where that
// target's `window → globalThis` define makes the guard vacuous.
import { Vector } from 'excalibur';

const g = globalThis as Record<string, unknown>;
const v = new Vector(3, 4);
const stub = (g.window as { audioContext?: unknown } | undefined)?.audioContext;

console.log(`IMPLICIT_GLOBAL_ASSIGN_VECTOR=${v.x === 3 && v.y === 4}`);
console.log(`IMPLICIT_GLOBAL_ASSIGN_GLOBALS_INTACT=${typeof g.setTimeout === 'function' && g.globalThis === g}`);
console.log(`IMPLICIT_GLOBAL_ASSIGN_STUB=${typeof stub === 'function'}`);
