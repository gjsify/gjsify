// @gjsify/devtools-mcp — shared shapes for the NativeScript profile.
//
// The in-app agent lives in `@gjsify/devtools-nativescript` (a
// `nativescript:'native'` package that cannot be a dependency of this GJS host
// bridge). This file mirrors the small wire shapes the host needs to read from
// the agent's JSON responses, so the two stay in sync without a cross-runtime
// package dependency.

/**
 * The `Screenshot` result the NativeScript agent returns. The PNG is
 * base64-encoded (a `Uint8Array` cannot survive the CDP `returnByValue` JSON
 * round-trip), so the host decodes `data` into an MCP image result.
 *
 * MUST match `ScreenshotResult` in `@gjsify/devtools-nativescript/handlers`.
 */
export interface ScreenshotResult {
    format: 'png-base64';
    /** base64-encoded PNG, or `null` when the root view is not laid out yet. */
    data: string | null;
}
