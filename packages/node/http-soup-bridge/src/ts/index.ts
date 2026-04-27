// @gjsify/http-soup-bridge — thin TS wrapper around the GjsifyHttpSoupBridge
// GIR module.
//
// The real implementation lives in src/vala/*.vala, compiled to
// prebuilds/<platform>/libgjsifyhttpsoupbridge.so + GjsifyHttpSoupBridge-1.0
// .typelib by meson. This module only loads the typelib via `gi://` and
// re-exports it with TypeScript types. Consumers should import from here
// instead of using `imports.gi.GjsifyHttpSoupBridge` directly — this
// isolates the `gi://` resolution in one place and lets us adjust the
// load path (LD_LIBRARY_PATH / GI_TYPELIB_PATH) without touching consumers.
//
// Types provided by @girs/gjsifyhttpsoupbridge-1.0.

// `gjsify run` sets LD_LIBRARY_PATH / GI_TYPELIB_PATH from the package's
// "gjsify.prebuilds" field before the runtime resolves `gi://`.
import GjsifyHttpSoupBridge from 'gi://GjsifyHttpSoupBridge?version=1.0';

export const Server = GjsifyHttpSoupBridge.Server;
export type Server = GjsifyHttpSoupBridge.Server;

export const Request = GjsifyHttpSoupBridge.Request;
export type Request = GjsifyHttpSoupBridge.Request;

export const Response = GjsifyHttpSoupBridge.Response;
export type Response = GjsifyHttpSoupBridge.Response;
