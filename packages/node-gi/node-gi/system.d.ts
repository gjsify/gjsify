// SPDX-License-Identifier: MIT
// @gjsify/node-gi/system — types for the GJS `System` module on Node.

/** Exit the process (GJS `System.exit`). */
export function exit(code?: number): void;
/** Trigger a garbage collection if the host exposed `globalThis.gc`. */
export function gc(): void;
/** The SpiderMonkey version number — reported as 0 on Node. */
export const version: number;
/** The script arguments (GJS ARGV) — `process.argv.slice(2)`. */
export const programArgs: string[];
/** The running script's invocation name — `process.argv[1]`. */
export const programInvocationName: string;
/** The running script's path — `process.argv[1]` (or null). */
export const programPath: string | null;
/** Return the address of a JS object as a string (Node stub). */
export function addressOf(): string;
/** Return the address of a GObject as a string (Node stub). */
export function addressOfGObject(): string;
/** Return the refcount of a GObject (Node stub). */
export function refcount(): number;
/** Trigger a debugger breakpoint (no-op on Node). */
export function breakpoint(): void;
/** Clear the Date timezone caches (no-op on Node). */
export function clearDateCaches(): void;
/** Dump the JS heap to a file (no-op on Node). */
export function dumpHeap(): void;
/** Dump memory info to a file (no-op on Node). */
export function dumpMemoryInfo(): void;

/** The GJS `System` module object (`import System from 'system'`). */
export interface SystemModule {
  exit(code?: number): void;
  gc(): void;
  version: number;
  readonly programArgs: string[];
  readonly programInvocationName: string;
  readonly programPath: string | null;
  addressOf(): string;
  addressOfGObject(): string;
  refcount(): number;
  breakpoint(): void;
  clearDateCaches(): void;
  dumpHeap(): void;
  dumpMemoryInfo(): void;
}

declare const System: SystemModule;
export default System;
