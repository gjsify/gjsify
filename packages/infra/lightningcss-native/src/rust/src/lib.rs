//! gjsify_lightningcss — single-call Rust→C FFI for lightningcss.
//!
//! Adapted from refs/lightningcss/c/src/lib.rs (lightningcss_c_bindings,
//! Devon Govett, MIT). The upstream C bindings expose a 3-step pipeline
//! (parse → transform → to_css) plus separate Targets/PseudoClasses/etc
//! structs, which is more surface area than the Vala bridge needs.
//!
//! This crate collapses the warm-up POC's surface to a single call:
//!     gjsify_lightningcss_transform(opts) -> GjsifyResult
//! with browserslist resolved internally and the result owning all buffer
//! allocations until gjsify_lightningcss_result_free() is called.
//!
//! Modifications: combined pipeline, browserslist-as-string in the same
//! call, simplified result struct, no css-modules / no analyze-dependencies
//! / no pseudo-class rewrites. Those can be added back if Phase B needs
//! them.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;

use lightningcss::stylesheet::{
    MinifyOptions, ParserFlags, ParserOptions, PrinterOptions, StyleSheet,
};
use lightningcss::targets::{Browsers, Targets};
use parcel_sourcemap::SourceMap;

#[repr(C)]
pub struct GjsifyTransformOpts {
    pub filename: *const c_char,         // may be NULL → ""
    pub code: *const u8,
    pub code_len: usize,
    pub browserslist: *const c_char,     // may be NULL → no targets
    pub minify: bool,
    pub source_map: bool,
}

/// Result of a transform. On success `error` is NULL; otherwise `code`/`map`
/// are NULL and `error` points at a NUL-terminated UTF-8 message.
///
/// All non-NULL pointers were allocated on the Rust side and MUST be freed
/// via `gjsify_lightningcss_result_free` — never with libc free().
#[repr(C)]
pub struct GjsifyResult {
    pub code: *mut u8,
    pub code_len: usize,
    pub code_cap: usize,
    pub map: *mut u8,
    pub map_len: usize,
    pub map_cap: usize,
    pub error: *mut c_char,
}

impl GjsifyResult {
    fn empty() -> Self {
        GjsifyResult {
            code: ptr::null_mut(),
            code_len: 0,
            code_cap: 0,
            map: ptr::null_mut(),
            map_len: 0,
            map_cap: 0,
            error: ptr::null_mut(),
        }
    }

    fn err(msg: impl Into<String>) -> Self {
        let mut r = Self::empty();
        let cstr = CString::new(msg.into()).unwrap_or_else(|_| {
            CString::new("lightningcss: error message contained interior NUL byte").unwrap()
        });
        r.error = cstr.into_raw();
        r
    }
}

fn cstr_to_str<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(p) }.to_str().ok()
    }
}

fn vec_to_owned_ptr(mut v: Vec<u8>) -> (*mut u8, usize, usize) {
    let ptr = v.as_mut_ptr();
    let len = v.len();
    let cap = v.capacity();
    std::mem::forget(v);
    (ptr, len, cap)
}

/// One-shot CSS transform.
///
/// Steps internally: parse → resolve browserslist (if any) → minify (with
/// optional targets lowering) → print to CSS string + source map.
///
/// Returns a `GjsifyResult`. Caller MUST pass the result to
/// `gjsify_lightningcss_result_free` exactly once to release buffers.
#[no_mangle]
pub extern "C" fn gjsify_lightningcss_transform(opts: GjsifyTransformOpts) -> GjsifyResult {
    if opts.code.is_null() || opts.code_len == 0 {
        return GjsifyResult::err("lightningcss: empty input CSS");
    }
    let code = {
        let slice = unsafe { std::slice::from_raw_parts(opts.code, opts.code_len) };
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return GjsifyResult::err("lightningcss: invalid UTF-8 in input CSS"),
        }
    };

    let filename = cstr_to_str(opts.filename).unwrap_or("").to_owned();

    // Resolve browserslist → Targets (if requested).
    let targets: Targets = match cstr_to_str(opts.browserslist) {
        None => Targets::default(),
        Some(query) => match Browsers::from_browserslist([query]) {
            Ok(Some(browsers)) => Targets::from(browsers),
            Ok(None) => Targets::default(),
            Err(e) => {
                return GjsifyResult::err(format!("lightningcss: browserslist: {e}"))
            }
        },
    };

    let parser_opts = ParserOptions {
        filename: filename.clone(),
        flags: ParserFlags::empty(),
        css_modules: None,
        error_recovery: false,
        source_index: 0,
        warnings: None,
    };

    let mut stylesheet = match StyleSheet::parse(code, parser_opts) {
        Ok(ss) => ss,
        Err(e) => return GjsifyResult::err(format!("lightningcss: parse: {e}")),
    };

    // minify() must run regardless of options.minify — it's where the
    // targets-driven lowering (nesting flatten, vendor prefixes, …) happens.
    let minify_opts = MinifyOptions {
        targets,
        ..Default::default()
    };
    if let Err(e) = stylesheet.minify(minify_opts) {
        return GjsifyResult::err(format!("lightningcss: transform: {e}"));
    }

    // Optional source map.
    let mut source_map = if opts.source_map {
        let mut sm = SourceMap::new("/");
        let src_name = if filename.is_empty() { "input.css".to_owned() } else { filename.clone() };
        sm.add_source(&src_name);
        if let Err(e) = sm.set_source_content(0, code) {
            return GjsifyResult::err(format!("lightningcss: source-map: {e}"));
        }
        Some(sm)
    } else {
        None
    };

    let printer_opts = PrinterOptions {
        minify: opts.minify,
        project_root: None,
        source_map: source_map.as_mut(),
        targets,
        analyze_dependencies: None,
        pseudo_classes: None,
    };

    let printed = match stylesheet.to_css(printer_opts) {
        Ok(p) => p,
        Err(e) => return GjsifyResult::err(format!("lightningcss: print: {e}")),
    };

    let (code_ptr, code_len, code_cap) = vec_to_owned_ptr(printed.code.into_bytes());

    let (map_ptr, map_len, map_cap) = if let Some(mut sm) = source_map {
        match sm.to_json(None) {
            Ok(json) => vec_to_owned_ptr(json.into_bytes()),
            Err(e) => {
                // free code we just allocated
                unsafe { Vec::from_raw_parts(code_ptr, code_len, code_cap) };
                return GjsifyResult::err(format!("lightningcss: source-map serialize: {e}"));
            }
        }
    } else {
        (ptr::null_mut(), 0, 0)
    };

    GjsifyResult {
        code: code_ptr,
        code_len,
        code_cap,
        map: map_ptr,
        map_len,
        map_cap,
        error: ptr::null_mut(),
    }
}

/// Free the buffers owned by a `GjsifyResult`. Safe to call on a result
/// where `error` is set (only the error CString is freed in that case).
/// Safe to call on a zeroed/empty result.
#[no_mangle]
pub extern "C" fn gjsify_lightningcss_result_free(result: GjsifyResult) {
    if !result.code.is_null() {
        unsafe { drop(Vec::from_raw_parts(result.code, result.code_len, result.code_cap)) };
    }
    if !result.map.is_null() {
        unsafe { drop(Vec::from_raw_parts(result.map, result.map_len, result.map_cap)) };
    }
    if !result.error.is_null() {
        unsafe { drop(CString::from_raw(result.error)) };
    }
}
