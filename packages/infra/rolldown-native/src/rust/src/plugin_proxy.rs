//! JsPluginProxy — a `Pluginable` implementation that ships hook
//! invocations through a crossbeam channel for a JavaScript-side
//! handler (running on the GJS main loop) to fulfill.
//!
//! Phase B.1 scope: only `load` is wired through the channel. All
//! other hooks fall back to the default `Plugin` impl (skip / no-op).
//! Phase B.2 fans this out to the remaining 11 hooks.
//!
//! Architecture mirrors `@gjsify/webrtc-native`'s signal-bridge
//! pattern (refs `packages/web/webrtc-native/src/vala/promise-bridge.vala`):
//!   - tokio-task running `Bundler::generate()` on the worker pool
//!   - calls into JsPluginProxy from various worker threads
//!   - JsPluginProxy serializes a `HookRequest`, pushes to channel
//!   - eventfd-write wakes the GLib main loop
//!   - Vala source pulls requests, emits GObject signal on main thread
//!   - JS handler runs, calls `session.respond(req_id, json)`
//!   - Vala forwards to `gjsify_rolldown_session_respond` extern
//!   - Rust pulls the matching oneshot::Sender from `pending`, sends response
//!   - tokio-task on the original thread wakes up from `oneshot::recv()`
//!     and continues with the parsed result.

use std::borrow::Cow;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::anyhow;
use crossbeam_channel::Sender;
use rolldown_plugin::{
    HookLoadArgs, HookLoadOutput, HookLoadReturn, HookUsage, Plugin, SharedLoadPluginContext,
};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

/// Per-plugin metadata we send with each request so the JS adapter
/// knows which user plugin to dispatch to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMeta {
    pub name: String,
    /// Hooks this plugin actually implements. Hooks not in this set
    /// short-circuit on the Rust side without a channel round-trip.
    pub hooks: Vec<String>,
}

/// Hook invocation flowing Rust → JS. Tagged so the Vala bridge can
/// route to the matching GObject signal.
#[derive(Debug, Serialize)]
#[serde(tag = "hook", rename_all = "camelCase")]
pub enum HookRequestPayload {
    Load {
        id: String,
        importer: Option<String>,
    },
}

/// Wire-format envelope for one hook invocation. Sent over
/// crossbeam channel; eventfd written after each push.
pub struct HookRequest {
    pub req_id: u64,
    pub plugin_index: usize,
    pub payload: HookRequestPayload,
    /// Filled in by JS via `session.respond()`.
    pub reply: oneshot::Sender<HookResponse>,
}

impl fmt::Debug for HookRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HookRequest")
            .field("req_id", &self.req_id)
            .field("plugin_index", &self.plugin_index)
            .field("payload", &self.payload)
            .finish()
    }
}

/// Tagged response from JS handler. Three states match rolldown's
/// `Result<Option<T>>` convention:
///   - `Skip`  → `Ok(None)` → next plugin in chain runs
///   - `Ok`    → `Ok(Some(value))` → this plugin's result wins
///   - `Error` → `Err(BuildDiagnostic)` → fail the build
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HookResponse {
    Skip,
    Ok { value: serde_json::Value },
    Error { message: String, stack: Option<String> },
}

/// Wire shape for a load-hook response. Mirrors the small subset of
/// `HookLoadOutput` we expose to JS plugins (no source-map yet — that
/// comes in Phase B.4 alongside the zero-copy GBytes path).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadHookValue {
    pub code: String,
    #[serde(default)]
    pub module_type: Option<String>,
}

impl HookResponse {
    pub fn into_load_return(self) -> HookLoadReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                let v: LoadHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed load response: {e}"))?;
                let module_type = match v.module_type.as_deref() {
                    None => None,
                    Some("js") | Some("ecmascript") => Some(rolldown_common::ModuleType::Js),
                    Some("json") => Some(rolldown_common::ModuleType::Json),
                    Some("text") => Some(rolldown_common::ModuleType::Text),
                    Some(other) => return Err(anyhow!("rolldown: unsupported moduleType '{}'", other)),
                };
                Ok(Some(HookLoadOutput {
                    code: v.code.into(),
                    map: None,
                    side_effects: None,
                    module_type,
                }))
            }
            HookResponse::Error { message, stack } => {
                let mut msg = message;
                if let Some(s) = stack {
                    msg.push('\n');
                    msg.push_str(&s);
                }
                Err(anyhow!(msg))
            }
        }
    }
}

/// `Pluginable` implementation that proxies a single user plugin.
/// Each plugin in the user's `plugins[]` array gets its own
/// `JsPluginProxy` so rolldown's per-hook ordering / first-non-null
/// chaining works unmodified.
pub struct JsPluginProxy {
    pub name: String,
    pub plugin_index: usize,
    pub hooks: Vec<String>,
    pub request_tx: Sender<HookRequest>,
    /// Atomic monotonic ID dispenser; shared across all proxies in
    /// the same session via Arc clone in the session constructor.
    pub next_request_id: std::sync::Arc<AtomicU64>,
    /// Wakeup pipe written after each request.send() so the Vala
    /// source on the main loop can react.
    pub request_eventfd: i32,
    /// Maximum time we wait for a JS response before failing the
    /// build with a timeout error. Defaults to 60s; prevents a
    /// forgotten `session.respond()` from hanging the build forever.
    pub response_timeout: Duration,
}

impl fmt::Debug for JsPluginProxy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("JsPluginProxy")
            .field("name", &self.name)
            .field("plugin_index", &self.plugin_index)
            .field("hooks", &self.hooks)
            .finish()
    }
}

impl JsPluginProxy {
    fn new_request_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::SeqCst)
    }

    /// Push a hook request onto the channel + wake the main loop via
    /// eventfd-write, then await the JS-side response.
    async fn dispatch(&self, payload: HookRequestPayload) -> anyhow::Result<HookResponse> {
        let (reply_tx, reply_rx) = oneshot::channel();
        let req = HookRequest {
            req_id: self.new_request_id(),
            plugin_index: self.plugin_index,
            payload,
            reply: reply_tx,
        };

        if self.request_tx.send(req).is_err() {
            return Err(anyhow!("rolldown: plugin channel closed (session aborted)"));
        }

        // Wake the GLib main loop. eventfd is a counter; one write per
        // request lets the Vala source track exactly how many drains
        // are pending. We ignore EAGAIN (would-block on a saturated
        // counter — the main loop will still wake up).
        let one: u64 = 1;
        unsafe {
            libc::write(
                self.request_eventfd,
                &one as *const u64 as *const libc::c_void,
                8,
            );
        }

        match tokio::time::timeout(self.response_timeout, reply_rx).await {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err(anyhow!(
                "rolldown: plugin {} dropped reply for request",
                self.name
            )),
            Err(_) => Err(anyhow!(
                "rolldown: plugin {} timed out after {}s waiting for JS response",
                self.name,
                self.response_timeout.as_secs()
            )),
        }
    }
}

impl Plugin for JsPluginProxy {
    fn name(&self) -> Cow<'static, str> {
        Cow::Owned(self.name.clone())
    }

    fn register_hook_usage(&self) -> HookUsage {
        // Tell rolldown which hooks this plugin actually implements
        // so its scheduler can skip dispatch attempts for unset
        // hooks. Mirror our own self.hooks list.
        let mut usage = HookUsage::empty();
        for h in &self.hooks {
            match h.as_str() {
                "load" => usage |= HookUsage::Load,
                "transform" => usage |= HookUsage::Transform,
                "resolveId" => usage |= HookUsage::ResolveId,
                "renderChunk" => usage |= HookUsage::RenderChunk,
                "buildStart" => usage |= HookUsage::BuildStart,
                "buildEnd" => usage |= HookUsage::BuildEnd,
                "generateBundle" => usage |= HookUsage::GenerateBundle,
                "writeBundle" => usage |= HookUsage::WriteBundle,
                "closeBundle" => usage |= HookUsage::CloseBundle,
                "banner" => usage |= HookUsage::Banner,
                "footer" => usage |= HookUsage::Footer,
                "intro" => usage |= HookUsage::Intro,
                "outro" => usage |= HookUsage::Outro,
                _ => {} // unknown hook — silently skip, B.2 fills these in
            }
        }
        usage
    }

    fn load(
        &self,
        _ctx: SharedLoadPluginContext,
        args: &HookLoadArgs<'_>,
    ) -> impl std::future::Future<Output = HookLoadReturn> + Send {
        // Phase B.1: only proxy to JS if this plugin declares the
        // `load` hook. Otherwise short-circuit with Ok(None) so
        // rolldown chains to the next plugin without a roundtrip.
        let proxies_load = self.hooks.iter().any(|h| h == "load");
        let id = args.id.to_string();
        let importer: Option<String> = None;

        async move {
            if !proxies_load {
                return Ok(None);
            }
            let resp = self
                .dispatch(HookRequestPayload::Load { id, importer })
                .await?;
            resp.into_load_return()
        }
    }
}
