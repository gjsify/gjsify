// @gjsify/devtools-mcp — MCP↔devtools bridge core (GJS).
// Pure named exports.

export { runDevtoolsMcp } from './run-server.js';
export { DbusDevtoolsClient } from './dbus-client.js';
export { registerGenericTools } from './generic-tools.js';
export { dbusError } from './error-map.js';
export { fail, image, ok } from './tool-result.js';
export type { ToolResult } from './tool-result.js';
export { GjsStdioTransport } from './stdio-transport.js';
export type { DevtoolsToolProfile, GenericToolName, McpToolContext } from './profile.js';
export { registerStorybookTools, storybookProfile } from './profiles/storybook.js';
export { registerBrowserTools, browserProfile } from './profiles/browser.js';
export { registerCdpTools, cdpProfile } from './profiles/cdp.js';

// Re-export the transport-agnostic contract so a profile needs one import.
export * from '@gjsify/devtools-protocol';
