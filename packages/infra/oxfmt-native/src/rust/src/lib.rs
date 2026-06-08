//! gjsify_oxfmt — single-call Rust→C FFI for oxc's formatter (`oxc_formatter`).
//!
//! Reference: refs/oxc/crates/oxc_formatter/examples/formatter.rs
//! (oxc-project/oxc, MIT). Reimplemented for GJS as a single-shot FFI:
//! `gjsify_oxfmt_format(opts) -> GjsifyResult`.
//!
//! The result owns its buffers until `gjsify_oxfmt_result_free()` is called.
//! Only the native JS/TS/JSX path is wrapped — oxfmt's `ExternalFormatter`
//! (CSS/HTML/Vue/Markdown via Prettier NAPI callbacks) is intentionally NOT
//! exposed: it requires a Node host, and gjsify formats JS/TS only.
//!
//! Modifications vs the example: no CLI/diff/IR plumbing, default
//! `FormatOptions` (Prettier-compatible), best-effort formatting on
//! recoverable syntax errors, single owned-buffer result struct.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;

use oxc_allocator::Allocator;
use oxc_formatter::{get_parse_options, FormatOptions, Formatter};
use oxc_parser::Parser;
use oxc_span::SourceType;

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
        GjsifyResult { code, code_len, code_cap, error: ptr::null_mut() }
    }

    fn err(msg: impl Into<String>) -> Self {
        let cstr = CString::new(msg.into()).unwrap_or_else(|_| {
            CString::new("oxfmt: error message contained interior NUL byte").unwrap()
        });
        GjsifyResult { code: ptr::null_mut(), code_len: 0, code_cap: 0, error: cstr.into_raw() }
    }
}

fn cstr_to_str<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(p) }.to_str().ok()
    }
}

/// Core: parse `source` (typed from `filename`'s extension, TS by default)
/// and format it via oxc_formatter. Pure Rust, no FFI — unit-tested directly.
fn format_impl(source: &str, filename: &str) -> Result<String, String> {
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());
    let allocator = Allocator::new();
    let ret = Parser::new(&allocator, source, source_type)
        .with_options(get_parse_options())
        .parse();

    // An empty program WITH diagnostics means nothing parsed — surface it
    // rather than returning "". Otherwise format best-effort (oxfmt's own
    // behaviour: recoverable syntax errors still format).
    if ret.program.body.is_empty() && !ret.errors.is_empty() {
        return Err(format!("oxfmt: {} parse error(s) in {filename}", ret.errors.len()));
    }

    Formatter::new(&allocator, FormatOptions::default())
        .format(&ret.program)
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
        unsafe { drop(Vec::from_raw_parts(result.code, result.code_len, result.code_cap)) };
    }
    if !result.error.is_null() {
        unsafe { drop(CString::from_raw(result.error)) };
    }
}

#[cfg(test)]
mod tests {
    use super::format_impl;

    #[test]
    fn formats_typescript() {
        let out = format_impl("const   x:number=1", "f.ts").unwrap();
        // oxc_formatter is Prettier-compatible: collapse whitespace, add the
        // type-annotation spacing + a trailing newline.
        assert!(out.contains("const x"), "expected reflow, got: {out:?}");
        assert!(out.ends_with('\n'), "expected trailing newline, got: {out:?}");
    }

    #[test]
    fn formats_tsx() {
        let out = format_impl("const  el=<div className=\"x\">hi</div>;", "f.tsx").unwrap();
        assert!(out.contains("<div"), "got: {out:?}");
    }
}
