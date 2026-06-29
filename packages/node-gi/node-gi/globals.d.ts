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
  versions: Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var print: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var printerr: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var log: (...args: unknown[]) => void;
  // eslint-disable-next-line no-var
  var logError: (error: unknown, prefix?: string) => void;
  // eslint-disable-next-line no-var
  var ARGV: string[];
  // eslint-disable-next-line no-var
  var imports: GjsImports;
}

/** Install the GJS ambient globals on `globalThis` (idempotent). */
export function installGjsGlobals(): GjsImports;

declare const _default: typeof installGjsGlobals;
export default _default;
