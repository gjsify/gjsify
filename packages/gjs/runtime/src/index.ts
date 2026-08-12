// Runtime detection for the four runtimes gjsify targets. No `@gjsify/*`
// dependencies, so it stays importable from anywhere including a bare template.
//
// This module is the single READ of the host globals; the RULE it applies lives in
// `./detect.js`, where `detect.spec.ts` tables it against host shapes no CI leg
// runs (bare GJS, node-gi on Node). Keeping the two apart is what makes the claim
// checkable — see that file's header for why probe ORDER carries the whole thing.

import { detectRuntime, type RuntimeHost, type RuntimeTarget } from './detect.js';

export type { RuntimeHost, RuntimeIdentity, RuntimeLabel, RuntimeTarget } from './detect.js';
export { detectRuntime } from './detect.js';

const identity = detectRuntime(globalThis as RuntimeHost);

/** `true` when running on Bun. */
export const isBun: boolean = identity.target === 'bun';

/** `true` when running on Deno. */
export const isDeno: boolean = identity.target === 'deno';

/**
 * `true` when running on GJS (GNOME JavaScript) — the ENGINE, not the bindings.
 *
 * `@gjsify/node-gi` gives a Node process `imports.gi` and GObject introspection;
 * that process is still V8 and reports `isNode`. See `./detect.js`.
 */
export const isGJS: boolean = identity.target === 'gjs';

/** `true` when running on Node.js — and NOT on Bun, Deno or GJS. */
export const isNode: boolean = identity.target === 'node';

/**
 * Human-readable runtime name: `'GJS'`, `'Node.js'`, `'Bun'`, `'Deno'`, or
 * `'Unknown'`.
 *
 * For the lowercase token `gjsify run --runtime` accepts, use
 * {@link runtimeTarget}.
 */
export const runtimeName: string = identity.name;

/**
 * The runtime as the CLI spells it — the vocabulary of `--runtime` and of
 * `gjsify.example.runtimes`; `undefined` on an unrecognised host.
 *
 * Distinct from {@link runtimeName}, which is prose for a user interface: only this
 * one is safe to pass back to the tooling.
 */
export const runtimeTarget: RuntimeTarget | undefined = identity.target;

/**
 * Runtime version string, or `undefined` if it cannot be determined.
 *
 * Bun and Deno are read from their own globals, not `process.versions.node`, which
 * on both reports the Node version they emulate — a real number about a runtime you
 * are not on.
 */
export const runtimeVersion: string | undefined = identity.version;
