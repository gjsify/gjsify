// SPDX-License-Identifier: MIT
// @gjsify/node-gi/globals — types for the GJS ambient-globals shim.

/** The legacy GJS `imports` object (a minimal Node-backed subset). */
export interface GjsImports {
  /** `imports.gi.<Ns>` resolves a namespace; `imports.gi.versions.<Ns>` pins a version. */
  gi: {
    versions: Record<string, string | undefined>;
    [namespace: string]: unknown;
  };
  /** `imports.system` — process identity + lifecycle (Node-backed subset). */
  system: {
    exit(code?: number): void;
    gc(): void;
    readonly programInvocationName: string;
    readonly programPath: string | null;
    version: number;
    addressOf(): string;
    refcount(): number;
    breakpoint(): void;
    dumpHeap(): void;
    dumpMemoryInfo(): void;
  };
  /** `imports.gettext` — a no-translation passthrough. */
  gettext: {
    gettext(s: string): string;
    dgettext(domain: string, s: string): string;
    dcgettext(domain: string, s: string): string;
    ngettext(s: string, p: string, n: number): string;
    dngettext(domain: string, s: string, p: string, n: number): string;
    pgettext(ctx: string, s: string): string;
    dpgettext(domain: string, ctx: string, s: string): string;
    domain(domain: string): {
      gettext(s: string): string;
      ngettext(s: string, p: string, n: number): string;
      pgettext(ctx: string, s: string): string;
    };
    setlocale(): null;
    bindtextdomain(): null;
    textdomain(): null;
    bindtextdomainCodeset(): null;
    LocaleCategory: Record<string, number>;
  };
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
