//! gjsify_oxfmt — Rust→C FFI for oxc's formatter (the `oxfmt` app crate).
//!
//! Reference: refs/oxc/apps/oxfmt/src/main.rs (oxc-project/oxc, MIT) — the
//! pure-Rust (non-napi) oxfmt CLI entry point. Reimplemented for GJS as two
//! FFI surfaces:
//!
//!   * `gjsify_oxfmt_run(argv, argc) -> exit_code` — the full oxfmt CLI
//!     in-process: bpaf arg parsing, `.oxfmtrc(.json)` + `.editorconfig`
//!     resolution, ignore handling, parallel file walking (rayon),
//!     `--write` / `--check` / `--list-different` modes, stdout/stderr
//!     reporting. The same engine as the npm `oxfmt` launcher for
//!     JS/TS/JSX (+ JSON/TOML), minus the Node-hosted pieces: the
//!     `ExternalFormatter` (CSS/HTML/Vue/Markdown via Prettier-NAPI
//!     callbacks), JS/TS config files (`.oxfmtrc.ts`), `--init`/`--migrate`
//!     and the LSP — those all require a Node host by design (napi feature).
//!
//!   * `gjsify_oxfmt_format(opts) -> GjsifyResult` — single-shot in-memory
//!     format of one source string via `oxc_formatter::format` with default
//!     (Prettier-compatible) options. No config resolution — callers that
//!     need `.oxfmtrc` semantics use `gjsify_oxfmt_run`.
//!
//! The result struct owns its buffers until `gjsify_oxfmt_result_free()` is
//! called.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use std::ffi::{CStr, CString, OsString};
use std::os::raw::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::sync::Once;

use oxc_allocator::Allocator;
use oxc_formatter::JsFormatOptions;
use oxc_span::SourceType;
use oxfmt::cli::{format_command, init_miette, init_rayon, init_tracing, WalkRunner};

/// Input to `gjsify_oxfmt_format`.
#[repr(C)]
pub struct GjsifyFormatOpts {
    /// Logical filename — its extension selects JS/TS/JSX. NULL → `input.ts`.
    pub filename: *const c_char,
    pub code: *const u8,
    pub code_len: usize,
}

/// Result of a format. On success `error` is NULL and `code` holds the
/// formatted source; on failure `code` is NULL and `error` is a
/// NUL-terminated UTF-8 message. All non-NULL pointers were allocated on the
/// Rust side and MUST be freed via `gjsify_oxfmt_result_free` — never libc free.
#[repr(C)]
pub struct GjsifyResult {
    pub code: *mut u8,
    pub code_len: usize,
    pub code_cap: usize,
    pub error: *mut c_char,
}

impl GjsifyResult {
    fn ok(s: String) -> Self {
        let mut v = s.into_bytes();
        let code = v.as_mut_ptr();
        let code_len = v.len();
        let code_cap = v.capacity();
        std::mem::forget(v);
        GjsifyResult {
            code,
            code_len,
            code_cap,
            error: ptr::null_mut(),
        }
    }

    fn err(msg: impl Into<String>) -> Self {
        let cstr = CString::new(msg.into()).unwrap_or_else(|_| {
            CString::new("oxfmt: error message contained interior NUL byte").unwrap()
        });
        GjsifyResult {
            code: ptr::null_mut(),
            code_len: 0,
            code_cap: 0,
            error: cstr.into_raw(),
        }
    }
}

fn cstr_to_str<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(p) }.to_str().ok()
    }
}

/// Core: parse + format `source` (typed from `filename`'s extension, TS by
/// default) via `oxc_formatter::format` with default options. Pure Rust,
/// no FFI — unit-tested directly.
fn format_impl(source: &str, filename: &str) -> Result<String, String> {
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());
    let allocator = Allocator::new();
    let formatted = oxc_formatter::format(
        &allocator,
        source,
        source_type,
        JsFormatOptions::default(),
        None,
    )
    .map_err(|e| format!("oxfmt: parse error in {filename}: {e}"))?;
    formatted
        .print()
        .map(|printed| printed.into_code())
        .map_err(|e| format!("oxfmt: print failed: {e:?}"))
}

/// One-shot format. Caller MUST pass the result to
/// `gjsify_oxfmt_result_free` exactly once to release buffers.
#[no_mangle]
pub extern "C" fn gjsify_oxfmt_format(opts: GjsifyFormatOpts) -> GjsifyResult {
    if opts.code.is_null() {
        return GjsifyResult::err("oxfmt: NULL input code");
    }
    let source = {
        let slice = unsafe { std::slice::from_raw_parts(opts.code, opts.code_len) };
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return GjsifyResult::err("oxfmt: invalid UTF-8 in input"),
        }
    };
    let filename = cstr_to_str(opts.filename).unwrap_or("input.ts");
    match format_impl(source, filename) {
        Ok(code) => GjsifyResult::ok(code),
        Err(e) => GjsifyResult::err(e),
    }
}

/// Free a result returned by `gjsify_oxfmt_format`. Call exactly once.
#[no_mangle]
pub extern "C" fn gjsify_oxfmt_result_free(result: GjsifyResult) {
    if !result.code.is_null() {
        unsafe {
            drop(Vec::from_raw_parts(
                result.code,
                result.code_len,
                result.code_cap,
            ))
        };
    }
    if !result.error.is_null() {
        unsafe { drop(CString::from_raw(result.error)) };
    }
}

/// Process-global one-time init (tracing, miette hook, rayon pool). Mirrors
/// main.rs — these all panic or error when initialized twice, and a CLI
/// process only ever needs them once. The rayon thread count is taken from
/// the FIRST run's `--threads` option (subsequent in-process runs reuse the
/// pool — matches the one-run-per-process CLI model).
static INIT: Once = Once::new();

/// Run the oxfmt CLI in-process: `argv`/`argc` are the CLI arguments
/// (WITHOUT the program name — i.e. `process.argv.slice(2)` shaped, same as
/// the napi `run_cli`). Prints diagnostics/reports to stdout/stderr exactly
/// like the `oxfmt` binary. Returns the process exit code
/// (0 = success, 1 = config error/`--check` mismatch, 2 = no files/failed).
#[no_mangle]
pub extern "C" fn gjsify_oxfmt_run(argv: *const *const c_char, argc: usize) -> i32 {
    // Never unwind across the FFI boundary — a panic would abort the host
    // (GJS) process. Surface it as a non-zero exit code instead.
    match catch_unwind(AssertUnwindSafe(|| run_impl(argv, argc))) {
        Ok(code) => code,
        Err(_) => {
            eprintln!("oxfmt: internal panic during run (this is a bug in gjsify_oxfmt)");
            101
        }
    }
}

fn run_impl(argv: *const *const c_char, argc: usize) -> i32 {
    let mut args: Vec<OsString> = Vec::with_capacity(argc);
    if argc > 0 {
        if argv.is_null() {
            eprintln!("oxfmt: NULL argv with non-zero argc");
            return 2;
        }
        for i in 0..argc {
            let p = unsafe { *argv.add(i) };
            match cstr_to_str(p) {
                Some(s) => args.push(OsString::from(s)),
                None => {
                    eprintln!("oxfmt: argument {i} is NULL or not valid UTF-8");
                    return 2;
                }
            }
        }
    }

    // Use `run_inner()` to report errors instead of panicking (same as the
    // napi `run_cli`). bpaf returns exit code 0 for --help/--version and
    // non-0 for actual parse errors.
    let command = match format_command().run_inner(&*args) {
        Ok(cmd) => cmd,
        Err(e) => {
            e.print_message(100);
            return i32::from(e.exit_code() != 0);
        }
    };

    INIT.call_once(|| {
        init_tracing();
        init_miette();
        init_rayon(command.runtime_options.threads);
    });

    i32::from(WalkRunner::new(command).run().exit_code())
}

#[cfg(test)]
mod tests {
    use std::ffi::CString;
    use std::os::raw::c_char;

    use super::format_impl;

    #[test]
    fn formats_typescript() {
        let out = format_impl("const   x:number=1", "f.ts").unwrap();
        // oxc_formatter is Prettier-compatible: collapse whitespace, add the
        // type-annotation spacing + a trailing newline.
        assert!(out.contains("const x"), "expected reflow, got: {out:?}");
        assert!(
            out.ends_with('\n'),
            "expected trailing newline, got: {out:?}"
        );
    }

    #[test]
    fn formats_tsx() {
        let out = format_impl("const  el=<div className=\"x\">hi</div>;", "f.tsx").unwrap();
        assert!(out.contains("<div"), "got: {out:?}");
    }

    fn run(args: &[&str]) -> i32 {
        let cstrings: Vec<CString> = args.iter().map(|a| CString::new(*a).unwrap()).collect();
        let ptrs: Vec<*const c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
        super::gjsify_oxfmt_run(ptrs.as_ptr(), ptrs.len())
    }

    #[test]
    fn run_rejects_unknown_flags() {
        assert_eq!(run(&["--definitely-not-a-real-flag"]), 1);
    }

    #[test]
    fn run_help_exits_zero() {
        assert_eq!(run(&["--help"]), 0);
    }

    #[test]
    fn run_formats_a_file_in_place() {
        let dir =
            std::env::temp_dir().join(format!("gjsify-oxfmt-run-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("f.ts");
        std::fs::write(&file, "const   x:number=1").unwrap();
        let code = run(&["--write", file.to_str().unwrap()]);
        let out = std::fs::read_to_string(&file).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(code, 0, "expected exit 0, got {code}");
        assert!(
            out.contains("const x: number = 1;"),
            "expected formatted output, got: {out:?}"
        );
    }
}
