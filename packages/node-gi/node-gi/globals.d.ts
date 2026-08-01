// SPDX-License-Identifier: MIT
// @gjsify/node-gi/globals — types for the GJS ambient-globals shim.

import type { SystemModule } from './system.js';
import type { GettextModule } from './gettext.js';

/** The legacy GJS `imports` object (a minimal Node-backed subset). */
export interface GjsImports {
    /** `imports.gi.<Ns>` resolves a namespace; `imports.gi.versions.<Ns>` pins a version. */
    gi: {
        versions: Record<string, string | undefined>;
        [namespace: string]: unknown;
    };
    /** `imports.system` — the `@gjsify/node-gi/system` module (process identity + lifecycle). */
    system: SystemModule;
    /** `imports.gettext` — the `@gjsify/node-gi/gettext` module (no-translation passthrough). */
    gettext: GettextModule;
    /** `imports.byteArray` — the legacy GJS byte-array module (GJS semantics: zero-terminated, fatal decode). */
    byteArray: {
        ByteArray: new (arg?: number | Uint8Array) => {
            length: number;
            toString(encoding?: string): string;
            toGBytes(): unknown;
        };
        fromArray(array: Iterable<number>): unknown;
        fromGBytes(bytes: unknown): Uint8Array;
        fromString(string: string, encoding?: string): Uint8Array;
        toGBytes(array: Uint8Array): unknown;
        toString(byteArray: Uint8Array, encoding?: string): string;
    };
    versions: Record<string, unknown>;
}

declare global {
    var print: (...args: unknown[]) => void;
    var printerr: (...args: unknown[]) => void;
    var log: (...args: unknown[]) => void;
    var logError: (error: unknown, prefix?: string) => void;
    var ARGV: string[];
    var imports: GjsImports;
}

/** Install the GJS ambient globals on `globalThis` (idempotent). */
export function installGjsGlobals(): GjsImports;

declare const _default: typeof installGjsGlobals;
export default _default;
