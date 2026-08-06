// Runtime detection for the four runtimes gjsify targets — original
// implementation, no `@gjsify/*` dependencies, so it stays importable from
// anywhere including a bare template.
//
// PROBE ORDER IS LOAD-BEARING: Bun and Deno both set `process.versions.node`
// for npm compatibility, and GJS's `@gjsify/process` shim sets it too, so
// reading `process.versions.node` FIRST is a false Node positive on three of
// the four runtimes. Probe the distinguishing global (`Bun`, `Deno`) before
// falling back to the version table — the same order, and for the same reason,
// as `hostRuntime()` in `@gjsify/rolldown-plugin-gjsify/runtime`, which is the
// single source of truth for host-derived build/launch defaults.
//
// Measured before this order existed: `runtimeName` returned `'Node.js'` under
// both Bun and Deno, never `'Unknown'` — a silently wrong answer rather than an
// absent one. The scaffolding templates that print it (`cli`,
// `web-server-hono`, `web-server-express`) therefore told a Bun user they were
// on Node.js, on the very screen whose job is to show which runtime is serving.

const proc = typeof process !== 'undefined' ? process : undefined;

/** `true` when running on Bun. */
export const isBun: boolean = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

/** `true` when running on Deno. */
export const isDeno: boolean = typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined';

/**
 * `true` when running on GJS (GNOME JavaScript).
 *
 * Checks the ambient GJS host (`imports.gi`) as well as `process.versions.gjs`:
 * the latter is set by `@gjsify/process` via `@gjsify/node-globals`, so a bare
 * GJS program that does not pull the Node globals in has no `process` at all
 * and used to report `'Unknown'` about itself.
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
 * The runtime as the CLI spells it — `'gjs' | 'node' | 'bun' | 'deno'`, the
 * vocabulary of `--runtime` and of `gjsify.example.runtimes`. `undefined` on an
 * unrecognised host.
 *
 * Kept distinct from {@link runtimeName}, which is prose for a user interface:
 * one of these two is safe to pass back to the tooling and the other is not.
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
 * Runtime version string, e.g. `'1.86.0'` (GJS), `'24.1.0'` (Node.js),
 * `'1.2.0'` (Bun), `'2.1.0'` (Deno). `undefined` if it cannot be determined.
 *
 * Bun and Deno are read from their own globals rather than
 * `process.versions.node`, which on both reports the Node version they emulate
 * — a real number, about a runtime you are not on.
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
