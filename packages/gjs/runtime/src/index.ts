// Runtime detection for the four runtimes gjsify targets. No `@gjsify/*`
// dependencies, so it stays importable from anywhere including a bare template.
//
// PROBE ORDER IS LOAD-BEARING: Bun, Deno and GJS's `@gjsify/process` shim all set
// `process.versions.node` for npm compatibility, so reading that first is a false
// Node positive on three of the four runtimes — it made `runtimeName` report
// `'Node.js'` under Bun and Deno, and the scaffolding templates print that string
// on the screen whose job is to show which runtime is serving. Probe the
// distinguishing global (`Bun`, `Deno`) before the version table, the same order
// as `hostRuntime()` in `@gjsify/rolldown-plugin-gjsify/runtime`.

const proc = typeof process !== 'undefined' ? process : undefined;

/** `true` when running on Bun. */
export const isBun: boolean = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

/** `true` when running on Deno. */
export const isDeno: boolean = typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';

/**
 * `true` when running on GJS (GNOME JavaScript).
 *
 * Checks the ambient GJS host (`imports.gi`) as well as `process.versions.gjs`,
 * which only `@gjsify/process` sets: a bare GJS program that never pulls the Node
 * globals in has no `process` at all and would report `'Unknown'` about itself.
 */
export const isGJS: boolean =
    typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined' ||
    (!isBun && !isDeno && typeof proc?.versions?.gjs === 'string');

/** `true` when running on Node.js — and NOT on Bun, Deno or GJS. */
export const isNode: boolean = !isBun && !isDeno && !isGJS && typeof proc?.versions?.node === 'string';

/**
 * Human-readable runtime name: `'GJS'`, `'Node.js'`, `'Bun'`, `'Deno'`, or
 * `'Unknown'`.
 *
 * For the lowercase token `gjsify run --runtime` accepts, use
 * {@link runtimeTarget}.
 */
export const runtimeName: string = isBun ? 'Bun' : isDeno ? 'Deno' : isGJS ? 'GJS' : isNode ? 'Node.js' : 'Unknown';

/**
 * The runtime as the CLI spells it — the vocabulary of `--runtime` and of
 * `gjsify.example.runtimes`; `undefined` on an unrecognised host.
 *
 * Distinct from {@link runtimeName}, which is prose for a user interface: only this
 * one is safe to pass back to the tooling.
 */
export const runtimeTarget: 'gjs' | 'node' | 'bun' | 'deno' | undefined = isBun
    ? 'bun'
    : isDeno
      ? 'deno'
      : isGJS
        ? 'gjs'
        : isNode
          ? 'node'
          : undefined;

/**
 * Runtime version string, or `undefined` if it cannot be determined.
 *
 * Bun and Deno are read from their own globals, not `process.versions.node`, which
 * on both reports the Node version they emulate — a real number about a runtime you
 * are not on.
 */
export const runtimeVersion: string | undefined = isBun
    ? (globalThis as { Bun?: { version?: string } }).Bun?.version
    : isDeno
      ? (globalThis as { Deno?: { version?: { deno?: string } } }).Deno?.version?.deno
      : isGJS
        ? proc?.versions?.gjs
        : isNode
          ? proc?.versions?.node
          : undefined;
