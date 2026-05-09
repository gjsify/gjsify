//! gjsify_rolldown — single-call Rust→C FFI for the rolldown bundler.
//!
//! Phase D-2 POC. Mirrors the @gjsify/lightningcss-native pattern:
//! one `extern "C"` entry point that takes a JSON-encoded options blob
//! and returns either a JSON-encoded BundleOutput or a heap-allocated
//! error message. The C glue layer (src/vala/gjsify-rolldown-glue.c)
//! turns those into GBytes + GError; the Vala wrapper (src/vala/rolldown.vala)
//! exposes a GObject method.
//!
//! Why JSON for both directions?
//!   - rolldown's BundlerOptions has dozens of nested types with custom
//!     serde deserializers (browserslist, treeshake, code-splitting…);
//!     a flat C struct hand-binding would be many hundreds of lines and
//!     would drift each rolldown release. JSON keeps the boundary tiny.
//!   - The output side has the same problem (warnings, source maps,
//!     module dependency graph). Re-using rolldown's serde shape means
//!     gjsify-side TS code can lean on the exact same JSON the
//!     @rolldown/binding-wasm32-wasi loader emits for Node consumers.
//!
//! POC scope: no JS plugins, no watch mode, no incremental builds. Each
//! call constructs a fresh Bundler, runs `generate()` on a per-call
//! current-thread tokio runtime, and returns. This keeps the boundary
//! sync from the JS view (what GJS expects) at the cost of losing
//! parallel rolldown plugin workers — fine for the POC, addressed in
//! Phase B alongside JS plugin support.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use std::ffi::CString;
use std::os::raw::c_char;
use std::ptr;

use rolldown::Bundler;
use rolldown_common::BundlerOptions;
use serde::Serialize;
use tokio::runtime::Builder;

/// Serializable mirror of the parts of `rolldown_common::Output` we expose to JS.
///
/// Both the variant tag (`Chunk`/`Asset` → `chunk`/`asset`) and the per-variant
/// field names are camelCased so JS sees `{type:"chunk", fileName:"…"}`.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum OutputJson {
    #[serde(rename_all = "camelCase")]
    Chunk {
        file_name: String,
        name: String,
        is_entry: bool,
        is_dynamic_entry: bool,
        code: String,
        map: Option<String>,
        sourcemap_filename: Option<String>,
        imports: Vec<String>,
        dynamic_imports: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Asset {
        file_name: String,
        names: Vec<String>,
        original_file_names: Vec<String>,
        source_text: Option<String>,
        source_bytes_len: usize,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleOutputJson {
    warnings: Vec<String>,
    output: Vec<OutputJson>,
}

/// Result of `gjsify_rolldown_bundle`.
///
/// On success: `output` points at a heap-allocated NUL-terminated UTF-8
/// JSON document of `BundleOutputJson`; `error` is NULL.
/// On error: `output` is NULL; `error` points at a heap-allocated
/// NUL-terminated UTF-8 message.
///
/// Caller MUST pass the returned struct to
/// `gjsify_rolldown_result_free` exactly once.
#[repr(C)]
pub struct GjsifyRolldownResult {
    pub output: *mut c_char,
    pub output_len: usize,
    pub error: *mut c_char,
}

impl GjsifyRolldownResult {
    fn empty() -> Self {
        Self { output: ptr::null_mut(), output_len: 0, error: ptr::null_mut() }
    }

    fn err(msg: impl Into<String>) -> Self {
        let mut r = Self::empty();
        let cstr = CString::new(msg.into()).unwrap_or_else(|_| {
            CString::new("rolldown: error message contained interior NUL").unwrap()
        });
        r.error = cstr.into_raw();
        r
    }

    fn ok(json: String) -> Self {
        let len = json.len();
        let cstr = match CString::new(json) {
            Ok(c) => c,
            Err(_) => return Self::err("rolldown: output JSON contained interior NUL"),
        };
        Self { output: cstr.into_raw(), output_len: len, error: ptr::null_mut() }
    }
}

fn convert_output(out: rolldown_common::Output) -> OutputJson {
    use rolldown_common::Output;
    match out {
        Output::Chunk(chunk) => {
            let map_str = chunk.map.as_ref().map(|m| m.to_json_string());
            OutputJson::Chunk {
                file_name: chunk.filename.to_string(),
                name: chunk.name.to_string(),
                is_entry: chunk.is_entry,
                is_dynamic_entry: chunk.is_dynamic_entry,
                code: chunk.code.clone(),
                map: map_str,
                sourcemap_filename: chunk.sourcemap_filename.clone(),
                imports: chunk.imports.iter().map(|s| s.to_string()).collect(),
                dynamic_imports: chunk.dynamic_imports.iter().map(|s| s.to_string()).collect(),
            }
        }
        Output::Asset(asset) => {
            let bytes = asset.source.as_bytes();
            // Try to expose UTF-8 assets as text; fall back to byte-length only
            // for binary assets (PNG etc). Binary content can be read via the
            // emitted file when output.dir is set.
            let source_text = std::str::from_utf8(bytes).ok().map(str::to_owned);
            OutputJson::Asset {
                file_name: asset.filename.to_string(),
                names: asset.names.clone(),
                original_file_names: asset.original_file_names.clone(),
                source_text,
                source_bytes_len: bytes.len(),
            }
        }
    }
}

/// Bundle a JS project. `options_json` is a NUL-terminated UTF-8 JSON
/// document matching rolldown's `BundlerOptions` serde shape (camelCase).
///
/// Memory: the input pointer is borrowed; the returned struct owns its
/// allocations and must be released via `gjsify_rolldown_result_free`.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_bundle(
    options_json: *const c_char,
    options_json_len: usize,
) -> GjsifyRolldownResult {
    if options_json.is_null() || options_json_len == 0 {
        return GjsifyRolldownResult::err("rolldown: empty options JSON");
    }

    let json_slice = unsafe { std::slice::from_raw_parts(options_json as *const u8, options_json_len) };
    let json_str = match std::str::from_utf8(json_slice) {
        Ok(s) => s,
        Err(_) => return GjsifyRolldownResult::err("rolldown: invalid UTF-8 in options JSON"),
    };

    let opts: BundlerOptions = match serde_json::from_str(json_str) {
        Ok(o) => o,
        Err(e) => return GjsifyRolldownResult::err(format!("rolldown: options parse: {e}")),
    };

    // Per-call current-thread tokio runtime: lets GJS exit cleanly, no
    // background workers leak after bundle() returns. Phase B can move
    // to a long-lived runtime for plugin-callback support.
    let rt = match Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => return GjsifyRolldownResult::err(format!("rolldown: tokio init: {e}")),
    };

    let bundle_result = rt.block_on(async {
        let mut bundler = Bundler::new(opts).map_err(|e| format!("Bundler::new: {e:?}"))?;
        bundler.generate().await.map_err(|e| format!("Bundler::generate: {e:?}"))
    });

    let bundle = match bundle_result {
        Ok(b) => b,
        Err(msg) => return GjsifyRolldownResult::err(format!("rolldown: {msg}")),
    };

    let warnings: Vec<String> = bundle.warnings.iter().map(|w| format!("{w:?}")).collect();
    let output: Vec<OutputJson> = bundle
        .assets
        .into_iter()
        .map(convert_output)
        .collect();

    let json = match serde_json::to_string(&BundleOutputJson { warnings, output }) {
        Ok(s) => s,
        Err(e) => return GjsifyRolldownResult::err(format!("rolldown: serialize: {e}")),
    };

    GjsifyRolldownResult::ok(json)
}

/// Free the buffers owned by a `GjsifyRolldownResult`. Safe to call on
/// either an OK result (frees `output`) or an error result (frees
/// `error`). Must NOT be called twice on the same struct.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_result_free(result: GjsifyRolldownResult) {
    if !result.output.is_null() {
        unsafe { drop(CString::from_raw(result.output)) };
    }
    if !result.error.is_null() {
        unsafe { drop(CString::from_raw(result.error)) };
    }
}
