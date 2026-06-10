// @gjsify/oxfmt-native — thin TS wrapper around the GjsifyOxfmt GIR module
// (Vala bridge) + Rust cdylib wrapping oxc's formatter.
//
// The real implementation lives in:
//   src/rust/   — Rust shim using oxc_formatter (refs/oxc), exposes extern "C"
//   src/vala/   — C glue (gjsify-oxfmt-glue.{h,c}) + oxfmt.vala
// Compiled by meson into:
//   prebuilds/<platform>/libgjsify_oxfmt.so   (Rust cdylib)
//   prebuilds/<platform>/libgjsifyoxfmt.so    (Vala bridge)
//   prebuilds/<platform>/GjsifyOxfmt-1.0.{gir,typelib}
//
// Loading is intentionally try/catch — same pattern as the other native
// bridges — so consuming code (`gjsify format` under GJS) can fall back to
// the Node `oxfmt` napi binary when the prebuild is unavailable. Callers
// MUST check `hasNativeOxfmt()` before using `format()`.
//
// LD_LIBRARY_PATH / GI_TYPELIB_PATH are set automatically by the CLI's
// `detectNativePackages()` walk when running under `gjsify`.

/** Minimal structural type of the `gi://GjsifyOxfmt` `Formatter` GObject. */
interface FormatterInstance {
    /** Format `code`, typed from `filename`'s extension. Throws on fatal error. */
    format(filename: string | null, code: unknown): unknown;
    /** Run the oxfmt CLI in-process (argv WITHOUT program name) → exit code. */
    run(args: string[]): number;
}
interface FormatterCtor {
    new (): FormatterInstance;
}
export interface NativeOxfmtModule {
    Formatter: FormatterCtor;
}

interface GLibBytesCtor {
    new (data: Uint8Array): unknown;
}
interface GLibNS {
    Bytes: GLibBytesCtor;
}

function gi(): { GjsifyOxfmt?: unknown; GLib?: unknown } | undefined {
    return (globalThis as unknown as { imports?: { gi?: { GjsifyOxfmt?: unknown; GLib?: unknown } } }).imports?.gi;
}

let _native: NativeOxfmtModule | null = null;
let _loaded = false;
let _loadError: Error | null = null;

export function loadNativeOxfmt(): NativeOxfmtModule | null {
    if (_loaded) return _native;
    _loaded = true;
    try {
        const g = gi();
        if (!g) {
            _loadError = new Error('imports.gi not available — not running under GJS?');
            return null;
        }
        const mod = g.GjsifyOxfmt;
        if (!mod) {
            _loadError = new Error('GjsifyOxfmt typelib not found on GI_TYPELIB_PATH');
            return null;
        }
        _native = mod as NativeOxfmtModule;
        return _native;
    } catch (err) {
        _loadError = err instanceof Error ? err : new Error(String(err));
        _native = null;
        return null;
    }
}

/** True when the native oxfmt prebuild is loadable under the current runtime. */
export function hasNativeOxfmt(): boolean {
    return loadNativeOxfmt() !== null;
}

/** The error from the last failed `loadNativeOxfmt()`, if any. */
export function getOxfmtLoadError(): Error | null {
    return _loadError;
}

/**
 * Format JS/TS/JSX `code` via oxc's formatter, under GJS, without Node.
 * `filename` selects the dialect by extension (default: TypeScript).
 * Throws if the native prebuild is unavailable or formatting fails.
 */
export function format(code: string, filename = 'input.ts'): string {
    const mod = loadNativeOxfmt();
    if (!mod) {
        throw _loadError ?? new Error('@gjsify/oxfmt-native: prebuild not available');
    }
    const GLib = gi()?.GLib as GLibNS | undefined;
    if (!GLib) throw new Error('@gjsify/oxfmt-native: GLib not available (not running under GJS?)');

    const bytes = new GLib.Bytes(new TextEncoder().encode(code));
    const fmt = new mod.Formatter();
    const out = fmt.format(filename, bytes) as { get_data(): Uint8Array | null } | null;
    const data = out?.get_data() ?? new Uint8Array();
    return new TextDecoder().decode(data);
}

/**
 * Run the full oxfmt CLI in-process, under GJS, without Node.
 *
 * `args` are the CLI arguments WITHOUT the program name
 * (`process.argv.slice(2)` shaped) — e.g.
 * `['--check', '--config', '/abs/.oxfmtrc.json', 'src']`. This covers the
 * complete pure-Rust oxfmt surface: `.oxfmtrc(.json)` + `.editorconfig`
 * resolution, ignore handling, parallel file walking, `--write` /
 * `--check` / `--list-different`. Reports to stdout/stderr exactly like
 * the npm `oxfmt` binary. The working directory is the current process
 * working directory.
 *
 * Not covered (requires oxfmt's Node-API host): embedded CSS/HTML/Vue/
 * Markdown via the Prettier ExternalFormatter, JS/TS config files
 * (`.oxfmtrc.ts`), `--init` / `--migrate`, LSP and stdin mode.
 *
 * Returns the process exit code (0 = success, 1 = config error or
 * `--check` mismatch, 2 = no files found / format failed). Throws if the
 * native prebuild is unavailable.
 */
export function runOxfmt(args: string[]): number {
    const mod = loadNativeOxfmt();
    if (!mod) {
        throw _loadError ?? new Error('@gjsify/oxfmt-native: prebuild not available');
    }
    const fmt = new mod.Formatter();
    return fmt.run(args);
}
