//! BundleSession — owns the tokio runtime, the plugin-channel pump,
//! the eventfd wakeup pair, and the BundleHandle the JS layer uses
//! to drive the build.
//!
//! Lifecycle:
//!   1. `start()` — caller passes options + plugin metadata. We
//!      construct N JsPluginProxy instances, hand them to
//!      Bundler::with_plugins, spawn a tokio task that drives
//!      `Bundler::generate()` to completion, return the session.
//!   2. While the build runs, the worker pool calls into the proxies,
//!      pushing HookRequests to the channel + writing the request
//!      eventfd. JS drains via `next_request()` and replies via
//!      `respond()`.
//!   3. When the bundle task completes, the result is stored on the
//!      session. The Vala side polls `try_take_result()` after
//!      seeing the request_eventfd close (or its own completion
//!      eventfd, see Phase B.2 — for B.1 we expose `wait()` only).

use std::ffi::CString;
use std::os::raw::{c_char, c_int};
use std::ptr;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicU64;
use std::time::Duration;

use crossbeam_channel::{Receiver, Sender, unbounded};
use rolldown::Bundler;
use rolldown_common::BundlerOptions;
use rolldown_plugin::__inner::SharedPluginable;
use rolldown_plugin::{PluginContext, PluginContextResolveOptions};
use serde::{Deserialize, Serialize};
use tokio::runtime::{Builder, Runtime};
use tokio::sync::oneshot;

use crate::plugin_proxy::{HookRequest, HookResponse, JsPluginProxy, PluginMeta};
use crate::{BundleOutputJson, OutputJson, convert_output};

#[derive(Debug, Deserialize)]
pub struct StartArgs {
    pub options: BundlerOptions,
    pub plugins: Vec<PluginMeta>,
}

/// One context-resolve sub-result flowing Rust → JS. Surfaces through
/// the `context_response_eventfd` queue.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextResolveResponse {
    pub child_id: u64,
    /// Resolved id, when the call succeeded and produced one.
    pub id: Option<String>,
    /// Whether the resolved module is external. Mirrors rolldown's
    /// `ResolvedId.is_external`.
    pub external: Option<bool>,
    /// Set when `ctx.resolve()` failed. Maps to rolldown's
    /// `ResolveError` variants serialized as `Display`. JS handler
    /// rejects its `await` Promise with this message.
    pub error: Option<String>,
}

/// Slice of session state shared with `JsPluginProxy`. Wrapped in
/// `Arc` and cloned into each proxy. Holds everything the proxies
/// need to (a) register/unregister parent `PluginContext` snapshots
/// for nested-protocol callbacks, (b) deliver context-resolve results
/// to JS via the dedicated eventfd, and (c) accumulate `this.warn()`
/// strings into the final BundleOutput.
pub struct SessionShared {
    pub contexts: Mutex<std::collections::HashMap<u64, PluginContext>>,
    pub next_child_id: AtomicU64,
    pub context_response_tx: Sender<ContextResolveResponse>,
    pub context_response_eventfd: c_int,
    pub context_warnings: Mutex<Vec<String>>,
    /// Phase B.4 — parallel bytes-payload slots keyed by req_id.
    /// `request_payloads` holds Rust → JS payloads (e.g. transform
    /// `code` source bytes), drained by the JS adapter via
    /// `take_request_payload(reqId)`. `response_payloads` holds JS →
    /// Rust payloads (e.g. transform output bytes), stashed by JS
    /// before `respond()` and consumed by the Rust dispatch site.
    pub request_payloads: Mutex<std::collections::HashMap<u64, Vec<u8>>>,
    pub response_payloads: Mutex<std::collections::HashMap<u64, Vec<u8>>>,
}

/// Public session handle. Owned via raw pointer on the C side.
pub struct BundleSession {
    /// Runtime kept alive for the lifetime of the session. multi_thread
    /// because rolldown internally spawns parallel module-graph tasks
    /// that would otherwise serialize behind plugin-callback awaits.
    pub runtime: Runtime,
    /// Channel: many proxies → single drain. Sender side is cloned
    /// into each JsPluginProxy.
    pub request_rx: Receiver<HookRequest>,
    /// Pending requests waiting on JS reply. Keyed by req_id.
    pub pending: Mutex<std::collections::HashMap<u64, oneshot::Sender<HookResponse>>>,
    /// eventfd for "request available" wakeup → GLib main loop watches.
    pub request_eventfd: c_int,
    /// Result of the bundle task once complete. None while still running.
    pub result: Mutex<Option<Result<String, String>>>,
    /// Completion eventfd: written exactly once when `result` is set.
    pub complete_eventfd: c_int,
    /// Cancel flag — set by the C side via `cancel()`. tokio task
    /// observes via shared atomic and aborts.
    pub cancelled: Arc<std::sync::atomic::AtomicBool>,
    /// Phase B.3 — shared with each `JsPluginProxy` for nested
    /// plugin-context callbacks.
    pub shared: Arc<SessionShared>,
    /// Receiver side of the context-response channel. Drained by
    /// `gjsify_rolldown_session_next_context_response` from the GLib
    /// main loop after waking on `context_response_eventfd`.
    pub context_response_rx: Receiver<ContextResolveResponse>,
}

impl BundleSession {
    /// Drain at most one pending HookRequest non-blockingly. Returns
    /// None if the channel is empty (or if the receiver was dropped).
    pub fn try_next_request(&self) -> Option<HookRequest> {
        self.request_rx.try_recv().ok()
    }

    /// Park the JS-supplied response into the matching pending slot.
    /// Returns true if a waiter was found (and woken).
    pub fn deliver_response(&self, req_id: u64, response: HookResponse) -> bool {
        let mut pending = self.pending.lock().unwrap();
        if let Some(tx) = pending.remove(&req_id) {
            let _ = tx.send(response);
            true
        } else {
            false
        }
    }

    /// Snapshot the bundle result. Returns None if the build is
    /// still running. On completion: Some(Ok(json)) or
    /// Some(Err(message)).
    pub fn try_take_result(&self) -> Option<Result<String, String>> {
        self.result.lock().unwrap().take()
    }

    /// Mark cancelled. The tokio task observes this on its next
    /// poll and aborts. Pending JS-replies will fail with timeout
    /// or "channel closed".
    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        // Drop the channel sender by dropping the proxies on shutdown.
        // The tokio runtime drop will abort all spawned tasks.
    }
}

/// FFI: start a new bundle session. Returns NULL on error +
/// `*err_out` set to a heap-allocated message (caller frees via
/// `gjsify_rolldown_session_free_error`).
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_start(
    args_json: *const c_char,
    args_json_len: usize,
    err_out: *mut *mut c_char,
) -> *mut BundleSession {
    let args: StartArgs = match parse_json_args(args_json, args_json_len) {
        Ok(a) => a,
        Err(msg) => {
            unsafe { *err_out = err_to_cstr(msg) };
            return ptr::null_mut();
        }
    };

    // Create the eventfd pair. EFD_NONBLOCK so writes never block;
    // EFD_SEMAPHORE off (we use counter-mode so JS can read once
    // per drain cycle and process all pending requests in a loop).
    let request_eventfd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
    if request_eventfd < 0 {
        unsafe { *err_out = err_to_cstr("rolldown: eventfd(request) failed".to_string()) };
        return ptr::null_mut();
    }
    let complete_eventfd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
    if complete_eventfd < 0 {
        unsafe { libc::close(request_eventfd) };
        unsafe { *err_out = err_to_cstr("rolldown: eventfd(complete) failed".to_string()) };
        return ptr::null_mut();
    }

    let context_response_eventfd =
        unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
    if context_response_eventfd < 0 {
        unsafe { libc::close(request_eventfd) };
        unsafe { libc::close(complete_eventfd) };
        unsafe { *err_out = err_to_cstr("rolldown: eventfd(context_response) failed".to_string()) };
        return ptr::null_mut();
    }

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (request_tx, request_rx) = unbounded::<HookRequest>();
    let (context_response_tx, context_response_rx) = unbounded::<ContextResolveResponse>();
    let next_request_id = Arc::new(AtomicU64::new(1));

    let shared = Arc::new(SessionShared {
        contexts: Mutex::new(std::collections::HashMap::new()),
        next_child_id: AtomicU64::new(1),
        context_response_tx,
        context_response_eventfd,
        context_warnings: Mutex::new(Vec::new()),
        request_payloads: Mutex::new(std::collections::HashMap::new()),
        response_payloads: Mutex::new(std::collections::HashMap::new()),
    });

    // Build N proxies, one per user plugin. Order in this Vec is the
    // plugin order rolldown sees — matches plugin_index in the
    // request payload so JS dispatches to the right plugin.
    let proxies: Vec<SharedPluginable> = match args
        .plugins
        .iter()
        .enumerate()
        .map(|(idx, meta)| {
            let load_id_filter = compile_filter(&meta.id_filter.load, &meta.name, "load")?;
            let transform_id_filter =
                compile_filter(&meta.id_filter.transform, &meta.name, "transform")?;
            let resolve_id_filter =
                compile_filter(&meta.id_filter.resolve_id, &meta.name, "resolveId")?;
            Ok::<_, String>(Arc::new(JsPluginProxy {
                name: meta.name.clone(),
                plugin_index: idx,
                hooks: meta.hooks.clone(),
                request_tx: request_tx.clone(),
                next_request_id: next_request_id.clone(),
                request_eventfd,
                response_timeout: Duration::from_secs(60),
                load_id_filter,
                transform_id_filter,
                resolve_id_filter,
                shared: shared.clone(),
            }) as SharedPluginable)
        })
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(v) => v,
        Err(msg) => {
            unsafe { libc::close(request_eventfd) };
            unsafe { libc::close(complete_eventfd) };
            unsafe { libc::close(context_response_eventfd) };
            unsafe { *err_out = err_to_cstr(msg) };
            return ptr::null_mut();
        }
    };

    // Drop the original sender so the channel naturally closes when
    // all proxies are dropped (which happens after the bundle task
    // exits).
    drop(request_tx);

    let runtime = match Builder::new_multi_thread()
        .worker_threads(num_cpus_capped())
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            unsafe { libc::close(request_eventfd) };
            unsafe { libc::close(complete_eventfd) };
            unsafe { libc::close(context_response_eventfd) };
            unsafe { *err_out = err_to_cstr(format!("rolldown: tokio init: {e}")) };
            return ptr::null_mut();
        }
    };

    let result_slot: Arc<Mutex<Option<Result<String, String>>>> = Arc::new(Mutex::new(None));
    let result_slot_clone = result_slot.clone();
    let complete_eventfd_for_task = complete_eventfd;
    let cancelled_for_task = cancelled.clone();
    let shared_for_task = shared.clone();

    runtime.spawn(async move {
        let res = run_bundle(args.options, proxies, cancelled_for_task, shared_for_task).await;
        let final_json = match res {
            Ok(json) => Ok(json),
            Err(msg) => Err(msg),
        };
        *result_slot_clone.lock().unwrap() = Some(final_json);
        // Signal completion to the GLib main loop.
        let one: u64 = 1;
        unsafe {
            libc::write(
                complete_eventfd_for_task,
                &one as *const u64 as *const libc::c_void,
                8,
            );
        }
    });

    let session = Box::new(BundleSession {
        runtime,
        request_rx,
        pending: Mutex::new(std::collections::HashMap::new()),
        request_eventfd,
        result: Mutex::new(None),
        complete_eventfd,
        cancelled,
        shared,
        context_response_rx,
    });

    // Move the result slot into the session AFTER spawn (the spawn
    // closure has its own clone; the session reads from the same
    // shared slot).
    let session_ptr = Box::into_raw(session);
    // Patch: the session owns its own Mutex<Option<Result>> — but
    // the spawn closure was given a clone via result_slot_clone.
    // To make `try_take_result` see the same slot, we re-point.
    // Simplest fix: stash result_slot Arc inside the session via
    // a side-table. For B.1 we route through an interior-mutability
    // helper — the result Mutex inside the session IS the slot;
    // the closure already has a separate Arc. To unify, we drop
    // the session-internal slot and instead use the Arc directly.
    //
    // Implementation: replace session.result with a method that
    // pulls from result_slot. Done below via `ResultSlotRegistry`.
    register_result_slot(session_ptr, result_slot);

    unsafe { *err_out = ptr::null_mut() };
    session_ptr
}

// --- result-slot registry ----------------------------------------------
//
// The clean way would be to put the Arc<Mutex<...>> straight on the
// session. We do that here via an interior swap: the session's own
// `result` Mutex<Option<...>> is unused; `register_result_slot`
// stores the *real* slot in a static map keyed by session pointer.
// `try_take_result` is rewritten to consult the map.
//
// Reason for this indirection: we needed to spawn the task before
// constructing the Box<Session> (because moving the proxies into
// the spawn future requires them by value), and we couldn't
// reference `session.result` from inside the spawn closure
// without &mut Box ownership shenanigans.

use std::collections::HashMap as StdHashMap;
use std::sync::OnceLock;

type ResultSlot = Arc<Mutex<Option<Result<String, String>>>>;

static RESULT_SLOTS: OnceLock<Mutex<StdHashMap<usize, ResultSlot>>> = OnceLock::new();

fn registry() -> &'static Mutex<StdHashMap<usize, ResultSlot>> {
    RESULT_SLOTS.get_or_init(|| Mutex::new(StdHashMap::new()))
}

fn register_result_slot(session_ptr: *mut BundleSession, slot: ResultSlot) {
    registry().lock().unwrap().insert(session_ptr as usize, slot);
}

fn lookup_result_slot(session_ptr: *mut BundleSession) -> Option<ResultSlot> {
    registry().lock().unwrap().get(&(session_ptr as usize)).cloned()
}

fn unregister_result_slot(session_ptr: *mut BundleSession) {
    registry().lock().unwrap().remove(&(session_ptr as usize));
}

// --- bundle driver -----------------------------------------------------

async fn run_bundle(
    options: BundlerOptions,
    plugins: Vec<SharedPluginable>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    shared: Arc<SessionShared>,
) -> Result<String, String> {
    if cancelled.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("rolldown: cancelled before start".to_string());
    }
    let mut bundler = Bundler::with_plugins(options, plugins)
        .map_err(|e| format!("rolldown: Bundler::new: {e:?}"))?;
    let bundle = bundler
        .generate()
        .await
        .map_err(|e| format!("rolldown: Bundler::generate: {e:?}"))?;

    let mut warnings: Vec<String> = bundle.warnings.iter().map(|w| format!("{w:?}")).collect();
    // Append `this.warn(...)` strings collected during the build so the
    // JS caller sees them alongside rolldown-internal warnings.
    warnings.extend(shared.context_warnings.lock().unwrap().drain(..));
    let output: Vec<OutputJson> = bundle.assets.into_iter().map(convert_output).collect();
    serde_json::to_string(&BundleOutputJson { warnings, output })
        .map_err(|e| format!("rolldown: serialize: {e}"))
}

// --- FFI surface -------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_request_fd(session: *mut BundleSession) -> c_int {
    if session.is_null() {
        return -1;
    }
    unsafe { (*session).request_eventfd }
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_complete_fd(session: *mut BundleSession) -> c_int {
    if session.is_null() {
        return -1;
    }
    unsafe { (*session).complete_eventfd }
}

/// Drain one pending request. Returns NULL when the channel is
/// momentarily empty (caller should retry on next eventfd wake).
/// Caller frees the returned string via `gjsify_rolldown_session_free_string`.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_next_request(
    session: *mut BundleSession,
    out_len: *mut usize,
) -> *mut c_char {
    if session.is_null() {
        unsafe { *out_len = 0 };
        return ptr::null_mut();
    }
    let session = unsafe { &*session };

    // Pull one request. Move its `reply` Sender into pending map
    // before we serialize the payload (so JS can respond as soon
    // as it sees the request_id).
    let req = match session.try_next_request() {
        Some(r) => r,
        None => {
            unsafe { *out_len = 0 };
            return ptr::null_mut();
        }
    };

    let req_id = req.req_id;
    let plugin_index = req.plugin_index;
    let payload = req.payload;
    session.pending.lock().unwrap().insert(req_id, req.reply);

    // Serialize the payload standalone so the per-variant
    // `#[serde(rename_all = "camelCase")]` inside HookRequestPayload
    // is honored. `#[serde(flatten)]` would silently drop those rules
    // (serde issue #1346) and re-emit fields like `module_type` /
    // `is_entry` in their original snake_case.
    let json = match serde_json::to_value(&payload) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("reqId".to_string(), serde_json::json!(req_id));
                obj.insert("pluginIndex".to_string(), serde_json::json!(plugin_index));
            }
            value.to_string()
        }
        Err(e) => format!("{{\"reqId\":{req_id},\"error\":\"serialize: {e}\"}}"),
    };
    let len = json.len();
    unsafe { *out_len = len };
    let cstr = match CString::new(json) {
        Ok(c) => c,
        Err(_) => return ptr::null_mut(),
    };
    cstr.into_raw()
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_respond(
    session: *mut BundleSession,
    req_id: u64,
    response_json: *const c_char,
    response_json_len: usize,
) -> bool {
    if session.is_null() || response_json.is_null() {
        return false;
    }
    let slice =
        unsafe { std::slice::from_raw_parts(response_json as *const u8, response_json_len) };
    let resp: HookResponse = match serde_json::from_slice(slice) {
        Ok(r) => r,
        Err(e) => HookResponse::Error {
            message: format!("rolldown: malformed response JSON: {e}"),
            stack: None,
        },
    };
    let session = unsafe { &*session };
    session.deliver_response(req_id, resp)
}

/// Returns NULL while still building. On completion: returns a
/// JSON document (caller frees via `gjsify_rolldown_session_free_string`).
/// `*is_error` is set to true when the response carries an error
/// message; in that case the JSON is the error text wrapped as
/// `{"error": "..."}`.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_try_result(
    session: *mut BundleSession,
    out_len: *mut usize,
    is_error: *mut bool,
) -> *mut c_char {
    if session.is_null() {
        unsafe { *out_len = 0 };
        unsafe { *is_error = true };
        return ptr::null_mut();
    }
    let slot = match lookup_result_slot(session) {
        Some(s) => s,
        None => {
            unsafe { *out_len = 0 };
            unsafe { *is_error = false };
            return ptr::null_mut();
        }
    };
    let result = match slot.lock().unwrap().take() {
        Some(r) => r,
        None => {
            unsafe { *out_len = 0 };
            unsafe { *is_error = false };
            return ptr::null_mut();
        }
    };
    match result {
        Ok(json) => {
            unsafe { *is_error = false };
            unsafe { *out_len = json.len() };
            CString::new(json).ok().map(|c| c.into_raw()).unwrap_or(ptr::null_mut())
        }
        Err(msg) => {
            unsafe { *is_error = true };
            let wrapped = format!("{{\"error\":{}}}", serde_json::to_string(&msg).unwrap_or_else(|_| "\"<unprintable>\"".to_string()));
            unsafe { *out_len = wrapped.len() };
            CString::new(wrapped).ok().map(|c| c.into_raw()).unwrap_or(ptr::null_mut())
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_cancel(session: *mut BundleSession) {
    if session.is_null() {
        return;
    }
    let session = unsafe { &*session };
    session.cancel();
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_free(session: *mut BundleSession) {
    if session.is_null() {
        return;
    }
    unregister_result_slot(session);
    let boxed = unsafe { Box::from_raw(session) };
    unsafe {
        libc::close(boxed.request_eventfd);
        libc::close(boxed.complete_eventfd);
        libc::close(boxed.shared.context_response_eventfd);
    }
    // Dropping the runtime aborts all in-flight tasks. shutdown_timeout
    // gives them up to 500ms to drain; any remaining workers are
    // terminated. Prevents the GJS process exit from hanging.
    boxed.runtime.shutdown_timeout(Duration::from_millis(500));
}

// ---------------------------------------------------------------------
// Phase B.3 — nested-protocol FFI surface
// ---------------------------------------------------------------------

/// JS-side request shape for `this.resolve()`. `args_json` is the
/// payload of `gjsify_rolldown_session_context_resolve`. We deserialize
/// it once, hand the values to `PluginContext.resolve()`, and surface
/// the result on the context-response channel.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextResolveRequest {
    pub specifier: String,
    #[serde(default)]
    pub importer: Option<String>,
    #[serde(default)]
    pub skip_self: Option<bool>,
    #[serde(default)]
    pub is_entry: Option<bool>,
}

/// FFI: trigger a `ctx.resolve()` callback on behalf of a JS plugin
/// hook handler. Returns a child request ID immediately; the actual
/// result lands on the context-response queue (drained via
/// `next_context_response()`).
///
/// Returns 0 on error (parent_req_id unknown / args malformed).
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_context_resolve(
    session: *mut BundleSession,
    parent_req_id: u64,
    args_json: *const c_char,
    args_json_len: usize,
) -> u64 {
    if session.is_null() || args_json.is_null() {
        return 0;
    }
    let session = unsafe { &*session };

    // Snapshot the parent context. Both load and transform hooks
    // register a `PluginContext::clone()` keyed by their req_id
    // before sending the JS request.
    let ctx = match session.shared.contexts.lock().unwrap().get(&parent_req_id).cloned() {
        Some(c) => c,
        None => return 0,
    };

    let slice = unsafe { std::slice::from_raw_parts(args_json as *const u8, args_json_len) };
    let req: ContextResolveRequest = match serde_json::from_slice(slice) {
        Ok(r) => r,
        Err(e) => {
            // Best effort: drop a synthetic child reply so JS doesn't
            // hang waiting on a Promise that will never resolve.
            let child_id = session.shared.next_child_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let resp = ContextResolveResponse {
                child_id,
                id: None,
                external: None,
                error: Some(format!("rolldown: malformed context_resolve args JSON: {e}")),
            };
            let _ = session.shared.context_response_tx.send(resp);
            wake_eventfd(session.shared.context_response_eventfd);
            return child_id;
        }
    };

    let child_id = session
        .shared
        .next_child_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let shared = session.shared.clone();

    session.runtime.spawn(async move {
        let opts = PluginContextResolveOptions {
            skip_self: req.skip_self.unwrap_or(true),
            is_entry: req.is_entry.unwrap_or(false),
            ..Default::default()
        };
        let resp = match ctx
            .resolve(&req.specifier, req.importer.as_deref(), Some(opts))
            .await
        {
            Ok(Ok(resolved)) => ContextResolveResponse {
                child_id,
                id: Some(resolved.id.to_string()),
                external: Some(matches!(
                    resolved.external,
                    rolldown_common::ResolvedExternal::Absolute
                        | rolldown_common::ResolvedExternal::Relative
                )),
                error: None,
            },
            Ok(Err(resolve_err)) => ContextResolveResponse {
                child_id,
                id: None,
                external: None,
                error: Some(format!("{resolve_err:?}")),
            },
            Err(e) => ContextResolveResponse {
                child_id,
                id: None,
                external: None,
                error: Some(format!("{e}")),
            },
        };
        let _ = shared.context_response_tx.send(resp);
        wake_eventfd(shared.context_response_eventfd);
    });

    child_id
}

/// JS-side `this.warn(msg)` — accumulate the message; it surfaces in
/// the final `BundleOutputJson.warnings` array.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_context_warn(
    session: *mut BundleSession,
    message: *const c_char,
    message_len: usize,
) {
    if session.is_null() || message.is_null() {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts(message as *const u8, message_len) };
    let msg = match std::str::from_utf8(slice) {
        Ok(s) => s.to_string(),
        Err(_) => "rolldown: this.warn() called with non-UTF-8 message".to_string(),
    };
    let session = unsafe { &*session };
    session.shared.context_warnings.lock().unwrap().push(msg);
}

/// FFI: get the eventfd that signals "a context-resolve sub-result is
/// available". GLib main loop watches this with `G_IO_IN`.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_context_response_fd(
    session: *mut BundleSession,
) -> c_int {
    if session.is_null() {
        return -1;
    }
    let session = unsafe { &*session };
    session.shared.context_response_eventfd
}

/// FFI: drain one pending context-resolve response. Returns NULL when
/// the channel is empty.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_next_context_response(
    session: *mut BundleSession,
    out_len: *mut usize,
) -> *mut c_char {
    if session.is_null() {
        unsafe { *out_len = 0 };
        return ptr::null_mut();
    }
    let session = unsafe { &*session };
    let resp = match session.context_response_rx.try_recv() {
        Ok(r) => r,
        Err(_) => {
            unsafe { *out_len = 0 };
            return ptr::null_mut();
        }
    };
    let json = match serde_json::to_string(&resp) {
        Ok(s) => s,
        Err(e) => format!("{{\"childId\":{},\"error\":\"serialize: {e}\"}}", resp.child_id),
    };
    unsafe { *out_len = json.len() };
    CString::new(json).ok().map(|c| c.into_raw()).unwrap_or(ptr::null_mut())
}

fn wake_eventfd(fd: c_int) {
    let one: u64 = 1;
    unsafe {
        libc::write(fd, &one as *const u64 as *const libc::c_void, 8);
    }
}

// ---------------------------------------------------------------------
// Phase B.4 — bytes-payload side-channel for the transform hook.
// ---------------------------------------------------------------------

/// FFI: drain the request-payload bytes the Rust side stashed for
/// `req_id` (transform's source code). Returns NULL if the slot is
/// empty or already consumed. Caller frees the returned buffer via
/// `gjsify_rolldown_session_free_payload(buf, len)`.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_take_request_payload(
    session: *mut BundleSession,
    req_id: u64,
    out_len: *mut usize,
) -> *mut u8 {
    if session.is_null() {
        unsafe { *out_len = 0 };
        return ptr::null_mut();
    }
    let session = unsafe { &*session };
    let bytes = match session.shared.request_payloads.lock().unwrap().remove(&req_id) {
        Some(b) => b,
        None => {
            unsafe { *out_len = 0 };
            return ptr::null_mut();
        }
    };
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    let len = boxed.len();
    std::mem::forget(boxed);
    unsafe { *out_len = len };
    ptr
}

/// FFI: JS-side stashes response payload bytes (the transform hook's
/// output code) for the Rust dispatch site to pick up after
/// `respond()`. Returns true on success.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_set_response_payload(
    session: *mut BundleSession,
    req_id: u64,
    bytes: *const u8,
    bytes_len: usize,
) -> bool {
    if session.is_null() || bytes.is_null() {
        return false;
    }
    let slice = unsafe { std::slice::from_raw_parts(bytes, bytes_len) };
    let owned = slice.to_vec();
    let session = unsafe { &*session };
    session
        .shared
        .response_payloads
        .lock()
        .unwrap()
        .insert(req_id, owned);
    true
}

/// Free a payload buffer returned by
/// `gjsify_rolldown_session_take_request_payload`. The caller MUST
/// pass back the same length they received.
#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_free_payload(buf: *mut u8, len: usize) {
    if buf.is_null() {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts_mut(buf, len) };
    let _boxed = unsafe { Box::from_raw(slice as *mut [u8]) };
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn gjsify_rolldown_session_free_error(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)) };
    }
}

// --- helpers -----------------------------------------------------------

fn parse_json_args(p: *const c_char, len: usize) -> Result<StartArgs, String> {
    if p.is_null() || len == 0 {
        return Err("rolldown: empty args JSON".to_string());
    }
    let slice = unsafe { std::slice::from_raw_parts(p as *const u8, len) };
    let s = std::str::from_utf8(slice).map_err(|_| "rolldown: invalid UTF-8 in args".to_string())?;
    serde_json::from_str(s).map_err(|e| format!("rolldown: args parse: {e}"))
}

fn err_to_cstr(s: String) -> *mut c_char {
    CString::new(s)
        .unwrap_or_else(|_| CString::new("rolldown: <unprintable error>").unwrap())
        .into_raw()
}

fn num_cpus_capped() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().min(4))
        .unwrap_or(2)
}

fn compile_filter(
    src: &Option<String>,
    plugin_name: &str,
    hook_name: &str,
) -> Result<Option<regex::Regex>, String> {
    match src {
        None => Ok(None),
        Some(pat) => regex::Regex::new(pat).map(Some).map_err(|e| {
            format!("rolldown: plugin '{plugin_name}' {hook_name} filter '{pat}' invalid: {e}")
        }),
    }
}
