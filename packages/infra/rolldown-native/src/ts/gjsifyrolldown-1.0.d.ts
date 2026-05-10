/**
 * Hand-written ambient module for the GjsifyRolldown-1.0 typelib.
 *
 * Minimal POC surface: one `Bundler` GObject with a single `bundle()`
 * method taking JSON-encoded options and returning JSON-encoded
 * BundleOutput. Detailed shape lives in the TS facade (src/ts/index.ts).
 */

declare module 'gi://GjsifyRolldown?version=1.0' {
  import type GLib from '@girs/glib-2.0';
  import type GObject from '@girs/gobject-2.0';

  export namespace GjsifyRolldown {
    /**
     * Bundler — stateless one-shot bundle pipeline. Each `bundle()`
     * call constructs a fresh `rolldown::Bundler` on the Rust side
     * and runs `generate()` to completion on a per-call current-thread
     * tokio runtime.
     */
    class Bundler extends GObject.Object {
      constructor(properties?: Partial<GObject.Object.ConstructorProperties>);
      static new(): Bundler;
      bundle(options_json: GLib.Bytes): GLib.Bytes;
    }

    /**
     * BundlerSession — long-lived bundle session that drives a
     * rolldown build asynchronously and emits a GObject signal each
     * time a JS plugin hook needs to fire.
     *
     * Phase B.1 wires the `load` hook only; remaining 11 hooks come
     * in Phase B.2.
     *
     * Lifecycle:
     *   1. `new GjsifyRolldown.BundlerSession()`
     *   2. Connect signal handlers (`load_requested`, `completed`,
     *      `error_occurred`).
     *   3. `start(args_json)` with payload
     *      `{"options": <BundlerOptions>, "plugins": [{"name", "hooks"}]}`.
     *   4. JS handlers respond via `respond(req_id, response_json)`.
     *   5. On `completed` or `error_occurred`, the session is done.
     *      Call `cancel()` to abort early.
     */
    class BundlerSession extends GObject.Object {
      constructor(properties?: Partial<GObject.Object.ConstructorProperties>);
      static new(): BundlerSession;

      /**
       * Start the bundle session. May only be called once per
       * instance. Throws GError if already started or if Rust-side
       * setup fails.
       */
      start(args_json: GLib.Bytes): void;

      /**
       * Submit the JS-side response for a previously-pulled
       * request. The response JSON must match
       * `{kind:'skip'} | {kind:'ok', value:...} | {kind:'error', message, stack?}`.
       */
      respond(req_id: number, response_json: GLib.Bytes): void;

      /** Abort the build. Pending JS-replies will fail with timeout
       *  or "channel closed". */
      cancel(): void;

      // GObject signal accessors. GJS exposes `connect('signal', cb)`.
      //
      // `hook_requested` fires for every plugin hook invocation —
      // hook_name is one of: load, transform, resolveId, renderChunk,
      // banner, footer, intro, outro, buildStart, buildEnd,
      // generateBundle, writeBundle, closeBundle. The args_json
      // envelope shape depends on the hook (see HookRequestPayload
      // in src/rust/src/plugin_proxy.rs). JS handler MUST eventually
      // call respond(req_id, json) exactly once.
      connect(signal: 'hook_requested',
              cb: (self: BundlerSession, hook_name: string, req_id: number,
                   plugin_index: number, args_json: GLib.Bytes) => void): number;
      connect(signal: 'completed',
              cb: (self: BundlerSession, output_json: GLib.Bytes) => void): number;
      connect(signal: 'error_occurred',
              cb: (self: BundlerSession, message: string) => void): number;
      connect(signal: string, cb: (...args: unknown[]) => unknown): number;
    }
  }

  const GjsifyRolldownDefault: typeof GjsifyRolldown;
  export default GjsifyRolldownDefault;
}
