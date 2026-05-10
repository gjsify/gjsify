//! JsPluginProxy — a `Pluginable` implementation that ships hook
//! invocations through a crossbeam channel for a JavaScript-side
//! handler (running on the GJS main loop) to fulfill.
//!
//! Phase B.2 scope: all 12 hooks routed through the channel. JS-side
//! filter handling (a plugin declared as `{filter, handler}` short-
//! circuits before reaching us by virtue of register_hook_usage). The
//! actual per-call regex-against-id matching for `transform({filter})`
//! style plugins is performed JS-side for now; pushing it into Rust to
//! avoid the JSON roundtrip on no-match is the Phase B.4 optimization.
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
use regex::Regex;
use rolldown_plugin::{
    HookAddonArgs, HookBuildEndArgs, HookBuildStartArgs, HookCloseBundleArgs,
    HookGenerateBundleArgs, HookInjectionOutputReturn, HookLoadArgs, HookLoadOutput,
    HookLoadReturn, HookNoopReturn, HookRenderChunkArgs, HookRenderChunkOutput,
    HookRenderChunkReturn, HookResolveIdArgs, HookResolveIdOutput, HookResolveIdReturn,
    HookTransformArgs, HookTransformOutput, HookTransformReturn, HookUsage, HookWriteBundleArgs,
    Plugin, PluginContext, SharedLoadPluginContext, SharedTransformPluginContext,
};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

/// Per-plugin metadata we send with each request so the JS adapter
/// knows which user plugin to dispatch to.
///
/// `id_filter` lets a plugin pre-declare per-hook regex filters
/// (load/transform/resolveId only — the only hooks where a single
/// `id` string is the matchable input). When set, the proxy compiles
/// the regex once and skips the JS round-trip whenever the id doesn't
/// match. Mirrors rolldown's own `HookFilter.value` short-circuit
/// path; full token-tree boolean expressions stay JS-side for now.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub name: String,
    pub hooks: Vec<String>,
    #[serde(default)]
    pub id_filter: PluginIdFilter,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginIdFilter {
    #[serde(default)]
    pub load: Option<String>,
    #[serde(default)]
    pub transform: Option<String>,
    #[serde(default)]
    pub resolve_id: Option<String>,
}

/// Hook invocation flowing Rust → JS. Tagged so the Vala bridge can
/// route to the matching GObject signal.
///
/// Per-hook payloads are intentionally small — heavy data (transform
/// `code`) goes through as String today; Phase B.4 moves it to
/// zero-copy GBytes alongside a parallel signal-with-bytes overload.
#[derive(Debug, Serialize)]
#[serde(tag = "hook", rename_all = "camelCase")]
pub enum HookRequestPayload {
    #[serde(rename_all = "camelCase")]
    Load { id: String },
    #[serde(rename_all = "camelCase")]
    ResolveId { specifier: String, importer: Option<String>, is_entry: bool },
    #[serde(rename_all = "camelCase")]
    Transform { id: String, code: String, module_type: String },
    #[serde(rename_all = "camelCase")]
    RenderChunk { code: String, file_name: String, name: String, is_entry: bool },
    #[serde(rename_all = "camelCase")]
    Banner { file_name: String, name: String, is_entry: bool },
    #[serde(rename_all = "camelCase")]
    Footer { file_name: String, name: String, is_entry: bool },
    #[serde(rename_all = "camelCase")]
    Intro { file_name: String, name: String, is_entry: bool },
    #[serde(rename_all = "camelCase")]
    Outro { file_name: String, name: String, is_entry: bool },
    BuildStart {},
    #[serde(rename_all = "camelCase")]
    BuildEnd { error: Option<String> },
    GenerateBundle {},
    WriteBundle {},
    CloseBundle {},
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveIdHookValue {
    pub id: String,
    #[serde(default)]
    pub external: Option<bool>,
    #[serde(default)]
    pub side_effects: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformHookValue {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub module_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderChunkHookValue {
    pub code: String,
    // Source map deferred to Phase B.4 (zero-copy GBytes path).
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StringHookValue {
    pub text: String,
}

fn parse_module_type(s: Option<&str>) -> anyhow::Result<Option<rolldown_common::ModuleType>> {
    match s {
        None => Ok(None),
        Some("js") | Some("ecmascript") => Ok(Some(rolldown_common::ModuleType::Js)),
        Some("json") => Ok(Some(rolldown_common::ModuleType::Json)),
        Some("text") => Ok(Some(rolldown_common::ModuleType::Text)),
        Some(other) => Err(anyhow!("rolldown: unsupported moduleType '{}'", other)),
    }
}

impl HookResponse {
    pub fn into_load_return(self) -> HookLoadReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                let v: LoadHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed load response: {e}"))?;
                let module_type = parse_module_type(v.module_type.as_deref())?;
                Ok(Some(HookLoadOutput {
                    code: v.code.into(),
                    map: None,
                    side_effects: None,
                    module_type,
                }))
            }
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }

    pub fn into_resolve_id_return(self) -> HookResolveIdReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                let v: ResolveIdHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed resolveId response: {e}"))?;
                let external = match v.external {
                    Some(true) => Some(rolldown_common::ResolvedExternal::Absolute),
                    _ => None,
                };
                let side_effects = match v.side_effects {
                    Some(true) => Some(rolldown_common::side_effects::HookSideEffects::True),
                    Some(false) => Some(rolldown_common::side_effects::HookSideEffects::False),
                    None => None,
                };
                Ok(Some(HookResolveIdOutput {
                    id: v.id.into(),
                    external,
                    normalize_external_id: None,
                    side_effects,
                    package_json_path: None,
                }))
            }
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }

    pub fn into_transform_return(self) -> HookTransformReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                let v: TransformHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed transform response: {e}"))?;
                let module_type = parse_module_type(v.module_type.as_deref())?;
                Ok(Some(HookTransformOutput {
                    code: v.code,
                    map: None,
                    side_effects: None,
                    module_type,
                }))
            }
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }

    pub fn into_render_chunk_return(self) -> HookRenderChunkReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                let v: RenderChunkHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed renderChunk response: {e}"))?;
                Ok(Some(HookRenderChunkOutput {
                    code: v.code,
                    map: None,
                }))
            }
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }

    /// banner/footer/intro/outro all return `Result<Option<String>>`.
    pub fn into_injection_return(self) -> HookInjectionOutputReturn {
        match self {
            HookResponse::Skip => Ok(None),
            HookResponse::Ok { value } => {
                // Accept either {"text": "..."} or a raw string.
                if let serde_json::Value::String(s) = &value {
                    return Ok(Some(s.clone()));
                }
                let v: StringHookValue = serde_json::from_value(value)
                    .map_err(|e| anyhow!("rolldown: malformed injection response: {e}"))?;
                Ok(Some(v.text))
            }
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }

    /// build_start/build_end/generate_bundle/write_bundle/close_bundle
    /// all return `Result<()>`.
    pub fn into_noop_return(self) -> HookNoopReturn {
        match self {
            HookResponse::Skip | HookResponse::Ok { .. } => Ok(()),
            HookResponse::Error { message, stack } => Err(combine(message, stack)),
        }
    }
}

fn combine(message: String, stack: Option<String>) -> anyhow::Error {
    let mut msg = message;
    if let Some(s) = stack {
        msg.push('\n');
        msg.push_str(&s);
    }
    anyhow!(msg)
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
    /// build with a timeout error. Defaults to 60s.
    pub response_timeout: Duration,
    /// Compiled per-hook id regex. None means "always dispatch".
    pub load_id_filter: Option<Regex>,
    pub transform_id_filter: Option<Regex>,
    pub resolve_id_filter: Option<Regex>,
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

    fn proxies(&self, hook: &str) -> bool {
        self.hooks.iter().any(|h| h == hook)
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
                _ => {}
            }
        }
        usage
    }

    fn load(
        &self,
        _ctx: SharedLoadPluginContext,
        args: &HookLoadArgs<'_>,
    ) -> impl std::future::Future<Output = HookLoadReturn> + Send {
        let proxies = self.proxies("load");
        let id = args.id.to_string();
        let filtered = self
            .load_id_filter
            .as_ref()
            .map(|re| !re.is_match(&id))
            .unwrap_or(false);
        async move {
            if !proxies || filtered { return Ok(None); }
            let resp = self.dispatch(HookRequestPayload::Load { id }).await?;
            resp.into_load_return()
        }
    }

    fn resolve_id(
        &self,
        _ctx: &PluginContext,
        args: &HookResolveIdArgs<'_>,
    ) -> impl std::future::Future<Output = HookResolveIdReturn> + Send {
        let proxies = self.proxies("resolveId");
        let specifier = args.specifier.to_string();
        let importer = args.importer.map(|s| s.to_string());
        let is_entry = args.is_entry;
        let filtered = self
            .resolve_id_filter
            .as_ref()
            .map(|re| !re.is_match(&specifier))
            .unwrap_or(false);
        async move {
            if !proxies || filtered { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::ResolveId { specifier, importer, is_entry })
                .await?;
            resp.into_resolve_id_return()
        }
    }

    fn transform(
        &self,
        _ctx: SharedTransformPluginContext,
        args: &HookTransformArgs<'_>,
    ) -> impl std::future::Future<Output = HookTransformReturn> + Send {
        let proxies = self.proxies("transform");
        let id = args.id.to_string();
        let code = args.code.clone();
        let module_type = format!("{:?}", args.module_type).to_lowercase();
        let filtered = self
            .transform_id_filter
            .as_ref()
            .map(|re| !re.is_match(&id))
            .unwrap_or(false);
        async move {
            if !proxies || filtered { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::Transform { id, code, module_type })
                .await?;
            resp.into_transform_return()
        }
    }

    fn render_chunk(
        &self,
        _ctx: &PluginContext,
        args: &HookRenderChunkArgs<'_>,
    ) -> impl std::future::Future<Output = HookRenderChunkReturn> + Send {
        let proxies = self.proxies("renderChunk");
        let code = args.code.clone();
        let file_name = args.chunk.filename.to_string();
        let name = args.chunk.name.to_string();
        let is_entry = args.chunk.is_entry;
        async move {
            if !proxies { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::RenderChunk { code, file_name, name, is_entry })
                .await?;
            resp.into_render_chunk_return()
        }
    }

    fn banner(
        &self,
        _ctx: &PluginContext,
        args: &HookAddonArgs,
    ) -> impl std::future::Future<Output = HookInjectionOutputReturn> + Send {
        let proxies = self.proxies("banner");
        let file_name = args.chunk.filename.to_string();
        let name = args.chunk.name.to_string();
        let is_entry = args.chunk.is_entry;
        async move {
            if !proxies { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::Banner { file_name, name, is_entry })
                .await?;
            resp.into_injection_return()
        }
    }

    fn footer(
        &self,
        _ctx: &PluginContext,
        args: &HookAddonArgs,
    ) -> impl std::future::Future<Output = HookInjectionOutputReturn> + Send {
        let proxies = self.proxies("footer");
        let file_name = args.chunk.filename.to_string();
        let name = args.chunk.name.to_string();
        let is_entry = args.chunk.is_entry;
        async move {
            if !proxies { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::Footer { file_name, name, is_entry })
                .await?;
            resp.into_injection_return()
        }
    }

    fn intro(
        &self,
        _ctx: &PluginContext,
        args: &HookAddonArgs,
    ) -> impl std::future::Future<Output = HookInjectionOutputReturn> + Send {
        let proxies = self.proxies("intro");
        let file_name = args.chunk.filename.to_string();
        let name = args.chunk.name.to_string();
        let is_entry = args.chunk.is_entry;
        async move {
            if !proxies { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::Intro { file_name, name, is_entry })
                .await?;
            resp.into_injection_return()
        }
    }

    fn outro(
        &self,
        _ctx: &PluginContext,
        args: &HookAddonArgs,
    ) -> impl std::future::Future<Output = HookInjectionOutputReturn> + Send {
        let proxies = self.proxies("outro");
        let file_name = args.chunk.filename.to_string();
        let name = args.chunk.name.to_string();
        let is_entry = args.chunk.is_entry;
        async move {
            if !proxies { return Ok(None); }
            let resp = self
                .dispatch(HookRequestPayload::Outro { file_name, name, is_entry })
                .await?;
            resp.into_injection_return()
        }
    }

    fn build_start(
        &self,
        _ctx: &PluginContext,
        _args: &HookBuildStartArgs<'_>,
    ) -> impl std::future::Future<Output = HookNoopReturn> + Send {
        let proxies = self.proxies("buildStart");
        async move {
            if !proxies { return Ok(()); }
            let resp = self.dispatch(HookRequestPayload::BuildStart {}).await?;
            resp.into_noop_return()
        }
    }

    fn build_end(
        &self,
        _ctx: &PluginContext,
        args: Option<&HookBuildEndArgs>,
    ) -> impl std::future::Future<Output = HookNoopReturn> + Send {
        let proxies = self.proxies("buildEnd");
        let error = args.map(|a| format!("{:?}", a.errors));
        async move {
            if !proxies { return Ok(()); }
            let resp = self.dispatch(HookRequestPayload::BuildEnd { error }).await?;
            resp.into_noop_return()
        }
    }

    fn generate_bundle(
        &self,
        _ctx: &PluginContext,
        _args: &mut HookGenerateBundleArgs<'_>,
    ) -> impl std::future::Future<Output = HookNoopReturn> + Send {
        let proxies = self.proxies("generateBundle");
        async move {
            if !proxies { return Ok(()); }
            let resp = self.dispatch(HookRequestPayload::GenerateBundle {}).await?;
            resp.into_noop_return()
        }
    }

    fn write_bundle(
        &self,
        _ctx: &PluginContext,
        _args: &mut HookWriteBundleArgs,
    ) -> impl std::future::Future<Output = HookNoopReturn> + Send {
        let proxies = self.proxies("writeBundle");
        async move {
            if !proxies { return Ok(()); }
            let resp = self.dispatch(HookRequestPayload::WriteBundle {}).await?;
            resp.into_noop_return()
        }
    }

    fn close_bundle(
        &self,
        _ctx: &PluginContext,
        _args: Option<&HookCloseBundleArgs>,
    ) -> impl std::future::Future<Output = HookNoopReturn> + Send {
        let proxies = self.proxies("closeBundle");
        async move {
            if !proxies { return Ok(()); }
            let resp = self.dispatch(HookRequestPayload::CloseBundle {}).await?;
            resp.into_noop_return()
        }
    }
}
